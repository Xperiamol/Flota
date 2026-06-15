/**
 * 长文档生成管线（对话内工具的内部引擎）
 *
 * 思路对齐 AIDA 的 summary_pipeline：
 *   1) Planner：LLM 先产出大纲 IR（标题 + 章节列表，每节含目标/要点/预计字数）
 *   2) SectionAgent：逐章节调用子 agent 流式写作，携带「滚动摘要」上下文保证连贯
 *   3) Merge：按顺序归并为最终成稿
 *
 * 全程通过 onProgress / onToken 回调把过程与正文流式抛给上层（最终进对话），
 * 支持 abortSignal 中断。
 */
const { extractJSON } = require('./jsonUtils');
const { resolveDocType, getBlueprint } = require('./docBlueprints');

const DEFAULT_MAX_SECTIONS = 12;
const HARD_MAX_SECTIONS = 60;
// 单次 LLM 调用可稳定产出的中文字数经验值，用于估算章节数与续写轮次
const WORDS_PER_CALL = 2200;
// 单章续写最多追加轮次，避免模型反复不达标导致无限循环
const MAX_SECTION_ROUNDS = 8;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

// 估算字数：中文按非空白字符计，英文按单词折算后相加（近似「字数」口径）
function countWords(text) {
  if (!text) return 0;
  const stripped = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-]/g, ' ');
  const cjk = (stripped.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latin = (stripped.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

function checkAbortSignal(abortSignal) {
  if (abortSignal && abortSignal.aborted) {
    const err = new Error('长文档生成已取消');
    err.aborted = true;
    throw err;
  }
}

class LongDocumentPipeline {
  /**
   * @param {LongTaskLLMClient} llm 流式 LLM 客户端
   */
  constructor(llm) {
    this.llm = llm;
  }

  /**
   * @param {Object} params
   *   - topic: string 用户需求/主题（必填）
   *   - docType: string 文档类型提示（可选，如 小说/报告/方案/技术文档）
   *   - targetWords: number 目标总字数（可选）
   *   - extraContext: string 额外参考资料/约束（可选）
   * @param {Object} hooks
   *   - onProgress(evt): { phase, message, sectionIndex?, sectionTitle?, totalSections? }
   *   - onToken(delta, meta): meta = { phase, sectionIndex, sectionTitle }
   *   - abortSignal
   * @returns {Promise<{ title, sections:[{title, content}], markdown, planning, usage }>}
   */
  async run(params, hooks = {}) {
    const { topic, docType, targetWords, extraContext } = params || {};
    if (!topic || !String(topic).trim()) {
      throw new Error('缺少长文档主题/需求 topic');
    }
    const onProgress = typeof hooks.onProgress === 'function' ? hooks.onProgress : () => {};
    const onToken = typeof hooks.onToken === 'function' ? hooks.onToken : () => {};
    const abortSignal = hooks.abortSignal;

    const checkAbort = () => checkAbortSignal(abortSignal);

    // ---- 1) 规划大纲 ----
    onProgress({ phase: 'planning', message: '正在分析需求并规划文档大纲…' });
    const plan = await this._plan({ topic, docType, targetWords, extraContext }, { abortSignal });
    checkAbort();

    const sections = Array.isArray(plan.sections) ? plan.sections : [];
    if (sections.length === 0) {
      throw new Error('大纲规划失败：未生成任何章节');
    }
    onProgress({
      phase: 'planned',
      message: `大纲就绪：《${plan.title}》，共 ${sections.length} 个章节`,
      totalSections: sections.length
    });

    // ---- 2) 逐章节写作（携带滚动摘要） ----
    const written = [];
    let rollingSummary = '';
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    for (let i = 0; i < sections.length; i += 1) {
      checkAbort();
      const sec = sections[i];
      onProgress({
        phase: 'writing',
        message: `正在撰写第 ${i + 1}/${sections.length} 章：${sec.title}`,
        sectionIndex: i,
        sectionTitle: sec.title,
        totalSections: sections.length
      });

      let result;
      try {
        result = await this._writeSection({
          plan,
          section: sec,
          sectionIndex: i,
          totalSections: sections.length,
          rollingSummary,
          topic,
          extraContext
        }, {
          abortSignal,
          onToken: (delta) => onToken(delta, { phase: 'writing', sectionIndex: i, sectionTitle: sec.title }),
          onProgress: (words, targetWords) => onProgress({
            phase: 'section_progress',
            sectionIndex: i,
            sectionTitle: sec.title,
            totalSections: sections.length,
            words,
            targetWords
          })
        });
      } catch (e) {
        if (e && e.aborted) throw e;
        // 单章失败降级为保底内容，不影响整体（对齐 AIDA 的 _build_fallback_section_markdown）
        result = { content: this._fallbackSection(sec), usage: null };
        onProgress({
          phase: 'section_failed',
          message: `第 ${i + 1} 章生成失败，已降级为保底内容`,
          sectionIndex: i,
          sectionTitle: sec.title,
          totalSections: sections.length
        });
      }

      written.push({ title: sec.title, content: result.content });
      if (result.usage) this._accUsage(totalUsage, result.usage);

      onProgress({
        phase: 'section_done',
        message: `第 ${i + 1} 章完成`,
        sectionIndex: i,
        sectionTitle: sec.title,
        totalSections: sections.length
      });

      // 更新滚动摘要（除最后一章外）
      if (i < sections.length - 1) {
        checkAbort();
        const summary = await this._summarize(written, { abortSignal });
        if (summary) rollingSummary = summary;
      }
    }

    // ---- 3) 归并成稿 ----
    onProgress({ phase: 'merging', message: '正在归并成稿…' });
    const markdown = this._merge(plan, written);
    onProgress({ phase: 'done', message: '长文档生成完成' });

    return {
      title: plan.title,
      sections: written,
      markdown,
      planning: plan,
      usage: totalUsage
    };
  }

  async _plan({ topic, docType, targetWords, extraContext }, { abortSignal }) {
    // 根据目标字数动态推荐章节数：每章约 2-3 个 WORDS_PER_CALL 的体量较合理
    const tw = Number(targetWords) > 0 ? Math.floor(targetWords) : 0;
    const recommended = tw > 0
      ? clampInt(Math.ceil(tw / (WORDS_PER_CALL * 2.5)), 3, HARD_MAX_SECTIONS, DEFAULT_MAX_SECTIONS)
      : DEFAULT_MAX_SECTIONS;
    const maxSections = HARD_MAX_SECTIONS;

    const wordsHint = tw > 0
      ? `目标总字数约 ${tw} 字，建议拆分为约 ${recommended} 个章节，请合理分配各章节字数，使各章 targetWords 之和接近总字数。`
      : '请根据主题复杂度合理决定章节数量与篇幅。';

    // 体裁蓝图：根据用户提示词/主题推断文档类型，注入对应的结构性指引
    const resolvedDocType = resolveDocType({ docTypeHint: docType, topic });
    const blueprint = getBlueprint(resolvedDocType);

    const sys = '你是一名资深的长文档结构规划专家。你的任务是把用户需求拆解为清晰、可逐章撰写的章节大纲。严格只输出一个 JSON 对象，不要 Markdown 代码块标记，不要任何额外解释或前后缀文字。';
    const user = [
      `用户需求：${topic}`,
      docType ? `用户指定的文档类型：${docType}。` : '',
      '',
      '【体裁结构指引】',
      blueprint,
      '请优先依据用户需求与上述体裁指引设计章节，不要机械照搬，可灵活增删、重命名、调整顺序。',
      '',
      wordsHint,
      extraContext ? `补充参考/约束：${extraContext}` : '',
      '',
      `请输出如下 JSON（章节数不超过 ${maxSections}，keyPoints 控制在 2-4 条，描述精炼）：`,
      '{',
      '  "title": "整篇文档的标题",',
      '  "docType": "判定的文档类型",',
      '  "summary": "全文一句话主旨",',
      '  "sections": [',
      '    {',
      '      "title": "章节标题",',
      '      "goal": "本章要达成的目标",',
      '      "keyPoints": ["要点1", "要点2"],',
      '      "targetWords": 估计字数(数字)',
      '    }',
      '  ]',
      '}'
    ].filter(Boolean).join('\n');

    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ];

    let lastContent = '';
    let usage = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await this.llm.generate(
        attempt === 0
          ? messages
          : [...messages, { role: 'user', content: '上次输出无法解析为 JSON。请重新仅输出一个完整、合法的 JSON 对象，不要任何额外文字或代码块标记。' }],
        { abortSignal }
      );
      lastContent = res.content || '';
      usage = res.usage;

      const parsed = extractJSON(lastContent, null);
      if (parsed && parsed.title && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
        parsed.docType = parsed.docType ? String(parsed.docType).trim() : resolvedDocType;
        parsed.sections = parsed.sections
          .filter((s) => s && s.title)
          .slice(0, maxSections)
          .map((s) => ({
            title: String(s.title).trim(),
            goal: s.goal ? String(s.goal).trim() : '',
            keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.map((k) => String(k)).filter(Boolean) : [],
            targetWords: clampInt(s.targetWords, 100, 20000, 800)
          }));
        parsed._usage = usage;
        return parsed;
      }

      if (res.truncated) {
        // 被 max_tokens 截断，重试也大概率截断，直接报更明确的错
        break;
      }
    }

    const preview = lastContent.slice(0, 500).replace(/\s+/g, ' ');
    const err = new Error(`大纲规划失败：无法解析 LLM 返回的 JSON。原始返回片段：${preview}`);
    err.rawContent = lastContent;
    throw err;
  }

  async _writeSection({ plan, section, sectionIndex, totalSections, rollingSummary, topic, extraContext }, { abortSignal, onToken, onProgress }) {
    const reportProgress = typeof onProgress === 'function' ? onProgress : () => {};
    const sys = [
      `你是负责撰写《${plan.title}》中某一章节的写作子 agent。`,
      `文档类型：${plan.docType || '通用文档'}。全文主旨：${plan.summary || topic}。`,
      '请只输出本章节的正文 Markdown，不要重复全文标题，不要输出本章之外的内容，不要添加额外说明。'
    ].join('\n');

    const keyPointsText = section.keyPoints && section.keyPoints.length
      ? `本章要点：\n${section.keyPoints.map((k) => `- ${k}`).join('\n')}`
      : '';

    const target = clampInt(section.targetWords, 0, 50000, 0);

    const user = [
      `这是第 ${sectionIndex + 1}/${totalSections} 章，标题：${section.title}`,
      section.goal ? `本章目标：${section.goal}` : '',
      keyPointsText,
      target ? `本章篇幅约 ${target} 字，请尽量写足，不要草草收尾。` : '',
      rollingSummary ? `\n【前文摘要（保持连贯，勿重复）】\n${rollingSummary}` : '',
      extraContext ? `\n【参考资料/约束】\n${extraContext}` : '',
      '',
      `请以 "## ${section.title}" 作为本章节的二级标题开头，然后撰写正文。`
    ].filter(Boolean).join('\n');

    const usageAcc = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ];

    let accumulated = '';
    let lastDelta = '';
    // 续写轮次：仅在设置了目标字数时启用补足；否则单轮即可
    const maxRounds = target > 0 ? MAX_SECTION_ROUNDS : 1;
    for (let round = 0; round < maxRounds; round += 1) {
      checkAbortSignal(abortSignal);
      const { content, usage } = await this.llm.generate(messages, { abortSignal, onToken });
      if (usage) this._accUsage(usageAcc, usage);
      lastDelta = (content || '').trim();
      if (!lastDelta) break;

      accumulated = accumulated ? `${accumulated}\n\n${lastDelta}` : lastDelta;

      if (target <= 0) {
        reportProgress(countWords(accumulated), target);
        break;
      }
      const written = countWords(accumulated);
      reportProgress(written, target);
      // 达到目标的 90% 即视为合格，避免为了凑字数过度续写
      if (written >= target * 0.9) break;

      // 还差较多，让模型从上次结尾继续写（把已写正文作为上下文，要求无缝衔接）
      messages.push({ role: 'assistant', content: lastDelta });
      messages.push({
        role: 'user',
        content: `本章当前约 ${written} 字，目标约 ${target} 字，还不够。请直接接着上文继续写后续正文，保持情节/逻辑连贯，不要重复已写内容，不要重写标题，不要做总结收尾。`
      });
    }

    const normalized = this._normalizeSection(section.title, accumulated);
    return { content: normalized, usage: usageAcc };
  }

  async _summarize(written, { abortSignal }) {
    // 只摘要最近写完的章节，控制成本
    const recent = written.slice(-2);
    const text = recent.map((s) => `## ${s.title}\n${s.content}`).join('\n\n');
    if (!text.trim()) return '';

    try {
      const { content } = await this.llm.generate(
        [
          { role: 'system', content: '你是一名摘要助手，请用要点形式精炼概括给定章节，保留关键情节/结论/人物/数据，便于后续章节衔接。控制在 300 字以内。' },
          { role: 'user', content: text.slice(0, 8000) }
        ],
        { abortSignal }
      );
      return (content || '').trim();
    } catch (e) {
      if (e && e.aborted) throw e;
      return '';
    }
  }

  _fallbackSection(section) {
    const title = (section.title || '未命名章节').trim();
    const lines = [`## ${title}`, '', `本章节生成失败，已降级为保底内容，请人工补写。`];
    const points = (section.keyPoints || []).filter(Boolean);
    if (points.length) {
      lines.push('', '应覆盖要点：', ...points.map((p) => `- ${p}`));
    }
    return lines.join('\n');
  }

  _normalizeSection(title, content) {
    let text = (content || '').trim();
    if (!text) {
      return `## ${title}\n\n(本章节生成失败)`;
    }
    // 去掉可能的 ```markdown 包裹
    const fenced = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
    if (fenced) text = fenced[1].trim();
    // 确保以二级标题开头
    if (!/^#{1,6}\s/.test(text)) {
      text = `## ${title}\n\n${text}`;
    }
    return text;
  }

  _merge(plan, written) {
    const parts = [`# ${plan.title}`];
    if (plan.summary) parts.push(`> ${plan.summary}`);
    parts.push('');
    for (const sec of written) {
      parts.push(sec.content.trim());
      parts.push('');
    }
    return parts.join('\n').trim() + '\n';
  }

  _accUsage(acc, usage) {
    if (!usage) return;
    acc.prompt_tokens += usage.prompt_tokens || 0;
    acc.completion_tokens += usage.completion_tokens || 0;
    acc.total_tokens += usage.total_tokens || 0;
  }
}

module.exports = LongDocumentPipeline;
