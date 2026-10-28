/**
 * AI Chat 通用工具函数：纯函数，无外部依赖。
 */

const isEnabledSetting = (value) => value === true || value === 'true' || value === 1 || value === '1';

const getLocalDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodoTemporalStatus = (todo) => {
  if (!todo?.due_date || todo.is_completed) {
    return { label: todo?.is_completed ? '已完成' : '无截止日期', isOverdue: false, isDueToday: false, isUpcoming: false };
  }

  const dueKey = String(todo.due_date).substring(0, 10);
  const todayKey = getLocalDateKey();
  const dueTime = new Date(`${dueKey}T00:00:00`).getTime();
  const todayTime = new Date(`${todayKey}T00:00:00`).getTime();
  const daysUntilDue = Math.round((dueTime - todayTime) / 86400000);

  if (dueKey < todayKey) return { label: `已过期 ${Math.abs(daysUntilDue)} 天`, isOverdue: true, isDueToday: false, isUpcoming: false };
  if (dueKey === todayKey) return { label: '今天到期', isOverdue: false, isDueToday: true, isUpcoming: false };
  if (daysUntilDue <= 7) return { label: `${daysUntilDue} 天后到期`, isOverdue: false, isDueToday: false, isUpcoming: true };
  return { label: '未来待办', isOverdue: false, isDueToday: false, isUpcoming: false };
};

const safeJsonParse = (value) => {
  try { return JSON.parse(value); } catch (_) { return value; }
};

/** 把一段较长的写作主题压缩成适合联网检索的精炼关键词（取首句/首行，截断长度）。 */
const compactSearchQuery = (topic) => {
  const raw = String(topic || '').trim();
  if (raw.length <= 40) return raw;
  const firstChunk = raw.split(/[\n。；;！!？?]/).map((s) => s.trim()).find(Boolean) || raw;
  return firstChunk.slice(0, 40);
};

/** 粗估文本 token 数：中文约 1 字/token，英文约 4 字符/token，取折中按 2 字符/token 估算。 */
const estimateTokens = (text) => Math.ceil(String(text || '').length / 2);

/** 估算消息体 token：兼容字符串与多模态 content array（图片按 1500 tokens/张粗估）。 */
const estimateMessageTokens = (content) => {
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (part?.type === 'image_url') return sum + 1500;
      if (part?.type === 'text') return sum + estimateTokens(part.text);
      return sum;
    }, 0);
  }
  return estimateTokens(content);
};

/** 估算完整消息对象（含 assistant.tool_calls 参数）的 token 占用 */
const estimateFullMessageTokens = (msg) => {
  if (!msg || typeof msg !== 'object') return 0;
  let total = estimateMessageTokens(msg.content);
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(tc?.function?.name) + estimateTokens(tc?.function?.arguments);
    }
  }
  return total;
};

const compactStringMiddle = (text, headChars = 260, tailChars = 140, label = '已折叠') => {
  const str = String(text || '');
  if (str.length <= headChars + tailChars + 60) return str;
  const omitted = str.length - headChars - tailChars;
  return `${str.slice(0, headChars)}\n…[${label} ${omitted} 字符]…\n${str.slice(-tailChars)}`;
};

/**
 * L1 级压缩：对非当前轮的历史 tool 消息输出做结构化瘦身。
 * - read_skill：剥离长篇 instructions Markdown，仅保留已开放的 skill 与 tools 清单
 * - 笔记/检索/搜索类大 payload：保留结构化元信息（id/title/行号/游标），折叠长正文段
 */
const compactToolMessageContent = (rawContent) => {
  if (typeof rawContent !== 'string' || rawContent.length <= 420) return rawContent;
  const parsed = safeJsonParse(rawContent);
  if (!parsed || typeof parsed !== 'object') {
    return compactStringMiddle(rawContent, 240, 120, 'L1历史工具输出已压缩');
  }
  if (parsed.skill && typeof parsed.instructions === 'string' && parsed.instructions.length > 160) {
    return JSON.stringify({
      success: parsed.success,
      skill: parsed.skill,
      title: parsed.title,
      tools: parsed.tools,
      instructions: `[L1已压缩 ${parsed.skill} 技能说明（原长 ${parsed.instructions.length} 字符），工具已开放]`,
    });
  }
  const clone = Array.isArray(parsed) ? [...parsed] : { ...parsed };
  let mutated = false;
  for (const key of ['content', 'preview_head', 'preview_tail', 'summary']) {
    if (typeof clone[key] === 'string' && clone[key].length > 360) {
      clone[key] = compactStringMiddle(clone[key], 200, 100, `L1字段 ${key} 已压缩`);
      mutated = true;
    }
  }
  for (const listKey of ['matches', 'results', 'notes', 'items']) {
    if (Array.isArray(clone[listKey])) {
      clone[listKey] = clone[listKey].map((item) => {
        if (!item || typeof item !== 'object') return item;
        const nextItem = { ...item };
        for (const field of ['content', 'snippet', 'excerpt', 'description']) {
          if (typeof nextItem[field] === 'string' && nextItem[field].length > 200) {
            nextItem[field] = compactStringMiddle(nextItem[field], 120, 60, 'L1摘要');
            mutated = true;
          }
        }
        return nextItem;
      });
    }
  }
  if (mutated) return JSON.stringify(clone);
  return compactStringMiddle(rawContent, 260, 120, 'L1历史工具输出已压缩');
};

/**
 * L2 级压缩：对较早轮次的 user / assistant 消息折叠长代码块、长段落与历史内联图片。
 * 保留首部意图与尾部结论（含 [本条回复实际生成的确认卡：...] 标记）。
 */
const compactEarlyTurnMessage = (msg) => {
  if (!msg || typeof msg !== 'object') return msg;
  if (msg.role === 'tool') {
    return { ...msg, content: compactToolMessageContent(msg.content) };
  }
  if (Array.isArray(msg.content)) {
    const nextParts = msg.content.map((part) => {
      if (part?.type === 'image_url') {
        return { type: 'text', text: '[L2历史图片已省略]' };
      }
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 500) {
        return { ...part, text: compactStringMiddle(part.text, 260, 140, 'L2历史长文本已折叠') };
      }
      return part;
    });
    return { ...msg, content: nextParts };
  }
  if (typeof msg.content === 'string' && msg.content.length > 520) {
    const foldedCode = msg.content.replace(/```[\w-]*\n([\s\S]*?)```/g, (full, body) => {
      const lines = String(body || '').split('\n').length;
      return lines > 8 ? `[L2历史代码块已折叠，共 ${lines} 行]` : full;
    });
    return {
      ...msg,
      content: compactStringMiddle(foldedCode, 280, 180, 'L2历史对话已折叠'),
    };
  }
  return msg;
};

/**
 * 将消息序列按语义原子轮次切分：
 * - assistant(带 tool_calls) 与紧随其后的 role='tool' 消息绑定在一起；
 * - 若其前紧邻一条 user 消息，则将该 user 消息与后续工具轮次归为同一语义轮次组，
 *   保证 L3 滑窗淘汰时同进同退，绝不产生孤立的 tool 消息或丢失当前轮的 user 提问。
 */
const groupMessagesAtomically = (messages) => {
  const groups = [];
  let i = 0;
  while (i < messages.length) {
    const current = messages[i];
    if (
      current?.role === 'user' &&
      messages[i + 1]?.role === 'assistant' &&
      Array.isArray(messages[i + 1]?.tool_calls) &&
      messages[i + 1].tool_calls.length > 0
    ) {
      const group = [current];
      i++;
      while (
        i < messages.length &&
        (messages[i]?.role === 'tool' ||
          (messages[i]?.role === 'assistant' && Array.isArray(messages[i]?.tool_calls) && messages[i].tool_calls.length > 0))
      ) {
        group.push(messages[i]);
        i++;
      }
      groups.push(group);
      continue;
    }
    if (current?.role === 'assistant' && Array.isArray(current.tool_calls) && current.tool_calls.length > 0) {
      const group = [current];
      i++;
      while (i < messages.length && messages[i]?.role === 'tool') {
        group.push(messages[i]);
        i++;
      }
      groups.push(group);
    } else {
      groups.push([current]);
      i++;
    }
  }
  return groups;
};

/**
 * 内部辅助：执行 L0 -> L1 -> L2 规则压缩，并在仍超预算时切分出「待压缩/淘汰的早期原子轮次」与「保留的近期原子轮次」。
 */
const prepareBudgetSplit = (systemPrompt, messages, maxTokens, summaryReserveTokens = 0) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { level: 0, evictedMessages: [], keptMessages: [] };
  }
  const sysCost = estimateTokens(systemPrompt);
  const sumTokens = (list) => sysCost + list.reduce((sum, m) => sum + estimateFullMessageTokens(m), 0);

  let working = messages.map((m) => ({ ...m }));

  // L0：预算充裕（<= 55%），无损直通
  if (sumTokens(working) <= maxTokens * 0.55) {
    return { level: 0, evictedMessages: [], keptMessages: working };
  }

  // L1：压缩非最后一组工具轮次的 role='tool' 消息负载
  let lastToolAssistantIdx = -1;
  for (let i = working.length - 1; i >= 0; i--) {
    if (working[i]?.role === 'assistant' && Array.isArray(working[i].tool_calls) && working[i].tool_calls.length > 0) {
      lastToolAssistantIdx = i;
      break;
    }
  }
  working = working.map((msg, idx) => {
    if (msg?.role === 'tool' && (lastToolAssistantIdx < 0 || idx < lastToolAssistantIdx)) {
      return { ...msg, content: compactToolMessageContent(msg.content) };
    }
    return msg;
  });

  if (sumTokens(working) <= maxTokens * 0.75) {
    return { level: 1, evictedMessages: [], keptMessages: working };
  }

  // L2：保护最近 6 条消息（以及最后一组工具调用），折叠更早的历史消息
  const protectedStart = Math.max(
    0,
    lastToolAssistantIdx >= 0 ? Math.min(working.length - 6, lastToolAssistantIdx) : working.length - 6
  );
  working = working.map((msg, idx) => (idx < protectedStart ? compactEarlyTurnMessage(msg) : msg));

  if (sumTokens(working) <= maxTokens) {
    return { level: 2, evictedMessages: [], keptMessages: working };
  }

  // 超出 maxTokens：按原子消息组从后往前保留，切分出早期被挤出的组（供 L3 大模型摘要或 L4 滑窗丢弃）
  const groups = groupMessagesAtomically(working);
  const effectiveBudget = Math.max(sysCost + 200, maxTokens - summaryReserveTokens);
  let used = sysCost;
  let splitGroupIdx = groups.length;
  for (let g = groups.length - 1; g >= 0; g--) {
    const groupCost = groups[g].reduce((sum, m) => sum + estimateFullMessageTokens(m), 0);
    if (used + groupCost > effectiveBudget && splitGroupIdx < groups.length) break;
    used += groupCost;
    splitGroupIdx = g;
  }

  const evictedMessages = groups.slice(0, splitGroupIdx).flat();
  const keptMessages = groups.slice(splitGroupIdx).flat();
  return { level: 3, evictedMessages, keptMessages };
};

/**
 * 同步版预算裁剪（L0 -> L1 -> L2 -> L4 原子滑窗兜底）
 */
const trimMessagesToBudget = (systemPrompt, messages, maxTokens) => {
  const { keptMessages } = prepareBudgetSplit(systemPrompt, messages, maxTokens, 0);
  return keptMessages;
};

/**
 * 将被挤出的早期消息格式化为供大模型摘要的紧凑剧本
 */
const formatEvictedMessagesForSummary = (evictedMessages, maxInputChars = 12000) => {
  const lines = [];
  for (const msg of evictedMessages) {
    if (!msg || typeof msg !== 'object') continue;
    const roleLabel = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '工具结果';
    let text = '';
    if (Array.isArray(msg.content)) {
      text = msg.content.map((p) => (p?.type === 'text' ? p.text : '[图片]')).join(' ');
    } else if (typeof msg.content === 'string') {
      text = msg.content;
    }
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const calls = msg.tool_calls.map((tc) => `${tc?.function?.name || 'tool'}`).join(', ');
      text = `${text ? `${text} ` : ''}[调用工具: ${calls}]`;
    }
    const compactLine = compactStringMiddle(text.trim(), 300, 150, '省略');
    if (compactLine) lines.push(`${roleLabel}：${compactLine}`);
  }
  const joined = lines.join('\n');
  return joined.length > maxInputChars
    ? compactStringMiddle(joined, Math.floor(maxInputChars * 0.6), Math.floor(maxInputChars * 0.35), '中间轮次省略')
    : joined;
};

const COMPACTION_SUMMARY_PROMPT = `你是对话上下文压缩器。请将以下早期对话历史浓缩为一段高信息密度的中文摘要（不超过 350 字），供后续对话作为上下文记忆使用。
必须保留：
1. 用户的核心目标、偏好与明确约束；
2. 已查询、创建或修改的笔记/画布/待办/组件的 ID、标题或关键数据；
3. 已生成确认卡或已完成的操作状态，以及尚未完成的事项。
直接输出摘要条目，不要寒暄或解释。`;

/**
 * 包含 L3 大模型参与压缩的完整多级上下文整理：
 * - L0（<= 55% 预算）：无损保留
 * - L1（> 55% 预算）：旧工具输出结构化瘦身
 * - L2（> 75% 预算）：早期轮次代码块/长段落规则折叠
 * - L3（> 100% 预算，大模型摘要压缩）：将被滑窗挤出的早期轮次交由 LLM 生成结构化记忆摘要，并按指纹缓存复用（后续轮次 0 延迟）
 * - L4（降级兜底）：若未提供 summarize 或 LLM 调用失败/超时，自动回退到原子组滑窗裁剪
 */
const compactHistoryWithLLM = async (
  systemPrompt,
  messages,
  maxTokens,
  { summarize, cache, cacheKey = 'default' } = {}
) => {
  const summaryReserveTokens = Math.min(450, Math.floor(maxTokens * 0.2));
  const { evictedMessages, keptMessages } = prepareBudgetSplit(
    systemPrompt,
    messages,
    maxTokens,
    typeof summarize === 'function' ? summaryReserveTokens : 0
  );

  if (evictedMessages.length === 0 || typeof summarize !== 'function') {
    return keptMessages;
  }

  // 若保留区首条不是 user（极端情况下只有单组），不强行插入 user/assistant 摘要对，直接返回保留区
  const fingerprint = `${evictedMessages.length}:${String(evictedMessages[0]?.content || '').slice(0, 48)}:${String(evictedMessages.at(-1)?.content || '').slice(0, 48)}`;
  const cachedEntry = cache instanceof Map ? cache.get(cacheKey) : null;

  let summaryText = '';
  if (cachedEntry && cachedEntry.fingerprint === fingerprint && cachedEntry.summaryText) {
    summaryText = cachedEntry.summaryText;
  } else {
    try {
      const transcript = formatEvictedMessagesForSummary(evictedMessages);
      if (transcript.trim()) {
        const prevSummaryPrefix = cachedEntry?.summaryText
          ? `此前已压缩摘要：\n${cachedEntry.summaryText}\n\n新增早期对话：\n`
          : '';
        const rawSummary = await summarize([
          { role: 'system', content: COMPACTION_SUMMARY_PROMPT },
          { role: 'user', content: `${prevSummaryPrefix}${transcript}` },
        ]);
        summaryText = String(rawSummary || '').trim();
        if (summaryText && cache instanceof Map) {
          cache.set(cacheKey, { fingerprint, summaryText, updatedAt: Date.now() });
        }
      }
    } catch (_) {
      // L3 大模型压缩失败或超时时静默降级至 L4 原子滑窗结果
      summaryText = cachedEntry?.summaryText || '';
    }
  }

  if (!summaryText) {
    return trimMessagesToBudget(systemPrompt, messages, maxTokens);
  }

  const summaryPair = [
    { role: 'user', content: `[L3早期对话记忆摘要]\n${summaryText}` },
    { role: 'assistant', content: '明白，我已记住上述早期对话的目标、涉及的笔记/待办/画布信息与阶段进展。' },
  ];
  const combined = [...summaryPair, ...keptMessages];
  const totalCost = estimateTokens(systemPrompt) + combined.reduce((sum, m) => sum + estimateFullMessageTokens(m), 0);
  if (totalCost <= maxTokens) {
    return combined;
  }
  return trimMessagesToBudget(systemPrompt, messages, maxTokens);
};

/**
 * 在多轮 toolLoop 内部对已完成的旧工具轮次（非最新一轮 tool 输出）做原位 L1 结构化压缩，
 * 避免连续读取多篇长笔记或技能说明后撑爆上下文，同时保留当前用户提问与最新工具结果完整。
 */
const compactMessagesInPlace = (messages) => {
  if (!Array.isArray(messages) || messages.length <= 2) return messages;
  let lastToolAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant' && Array.isArray(messages[i].tool_calls) && messages[i].tool_calls.length > 0) {
      lastToolAssistantIdx = i;
      break;
    }
  }
  if (lastToolAssistantIdx <= 0) return messages;
  for (let i = 0; i < lastToolAssistantIdx; i++) {
    if (messages[i]?.role === 'tool') {
      messages[i] = { ...messages[i], content: compactToolMessageContent(messages[i].content) };
    }
  }
  return messages;
};

module.exports = {
  isEnabledSetting,
  getLocalDateKey,
  getTodoTemporalStatus,
  safeJsonParse,
  compactSearchQuery,
  estimateTokens,
  estimateMessageTokens,
  estimateFullMessageTokens,
  compactToolMessageContent,
  compactEarlyTurnMessage,
  trimMessagesToBudget,
  compactHistoryWithLLM,
  compactMessagesInPlace
};
