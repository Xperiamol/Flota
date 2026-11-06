const { createSkillSession } = require('./skills');
const { referencesFromMessages } = require('../aiReferences');
/**
 * AI Chat Service - 为 AI 助手提供带工具调用的流式聊天
 *
 * 复用 AIService 的配置和提供商抽象层，
 * 新增服务端流式推送和 function calling 支持，
 * 允许 AI 操作笔记、待办、记忆等应用功能。
 *
 * 模块划分：
 *   - tools/schema + tools/dispatcher：工具 schema 与 handler registry
 *   - agent/：基于 pi-agent-core + pi-ai 的对话循环与模型请求（runChat / generateText）
 *   - systemPrompt：系统提示词与上下文注入
 *   - noteSummary：当前笔记摘要（共享）
 *   - PendingActionStore：写入类工具的二次确认
 */

const { getInstance: getLogger } = require('../LoggerService');
const LongDocumentPipeline = require('../longtask/longDocumentPipeline');

const { WRITE_TOOL_NAMES, MAX_CONTEXT_TOKENS } = require('./constants');

// 会改动笔记内容 / 标题 / 标签的工具（白板由渲染层执行器自行保存并刷新）
const NOTE_WRITE_TOOLS = new Set(['create_note', 'edit_note', 'edit_notes', 'write_long_document']);
const { isEnabledSetting, safeJsonParse } = require('./utils');
const { dispatchTool } = require('./tools/dispatcher');
const { getSystemPrompt, buildContextSection } = require('./systemPrompt');
const { enrichContextPackageWithMemories } = require('./memoryContext');
const { buildModel, buildRequestOptions } = require('../llm/model');
const { generateText } = require('../llm/generateText');
const { normalizeModelError } = require('../llm/errors');
const { runChat } = require('./agent/runChat');
const { toAgentMessages } = require('../llm/messages');
const { compactTranscript } = require('./sessions/transcript');
const PendingActionStore = require('./PendingActionStore');
const { MemoryExtractor } = require('./memoryExtractor');

// 本轮已经由模型显式调用过记忆工具时，不再做对话后自动提取，避免同一信息写两遍
const MEMORY_TOOLS = new Set(['add_memory', 'update_memory']);

const isToolDisabled = (options, name) =>
  Array.isArray(options?.disabledTools) && options.disabledTools.includes(name);

// 模型有时只在文字里说“已准备好，请确认执行”却没有调用写入工具，前端没有确认卡可显示，
// 用户反复重试也只会得到同样的空话。本次请求没产生待确认动作、回复却声称有确认卡时追加一轮纠正。
const CONFIRMATION_CLAIM_RE = /确认卡|确认执行|点(?:击)?确认/;
const PHANTOM_CONFIRMATION_NUDGE = '（系统提示）你刚才的回复声称已准备好确认卡，但本轮没有调用任何写入工具，用户看不到确认卡。现在按需 read_skill 加载对应能力并调用写入工具生成确认卡，不要先输出说明文字。';

class AIChatService {
  constructor(aiService, noteDAO, todoDAO, mem0Service, webSearchService = null) {
    this.aiService = aiService;
    this.noteDAO = noteDAO;
    this.todoDAO = todoDAO;
    this.mem0Service = mem0Service;
    this.webSearchService = webSearchService;
    this.logger = getLogger();
    this._currentNoteGetter = null; // 由 main.js 注入
    this._pendingActions = new PendingActionStore({ mem0Service });
    this._longDocPipeline = null;
    this._memoryExtractor = new MemoryExtractor({
      mem0Service,
      generate: (messages, opts) => this._generatePlainText(messages, opts),
      logger: this.logger,
    });
  }

  /**
   * 对话后自动记忆：返回实际发生的记忆变更（未开启 / 无变化时为空数组）
   */
  processTurnMemories({ conversationId, messages, assistantText }) {
    return this._memoryExtractor.processTurn({ conversationId, messages, assistantText });
  }

  setCurrentNoteGetter(fn) {
    this._currentNoteGetter = fn;
  }

  setWidgetService(widgetService) {
    this._widgetService = widgetService;
  }

  /** 懒加载长文档生成管线（复用 _streamRequest 路径作为生成引擎，避免分歧） */
  _getLongDocPipeline() {
    if (!this._longDocPipeline) {
      const client = {
        generate: (messages, opts = {}) => this._generatePlainText(messages, opts)
      };
      this._longDocPipeline = new LongDocumentPipeline(client);
    }
    return this._longDocPipeline;
  }

  /** 纯文本流式生成（无工具调用） */
  async _generatePlainText(messages, opts = {}) {
    const configResult = await this.aiService.getConfig();
    if (!configResult.success) throw new Error(configResult.error || '获取AI配置失败');
    const config = configResult.data;
    if (!config.enabled) throw new Error('AI功能未启用，请在设置中开启');
    if (!config.apiKey) throw new Error('请先在设置中配置API密钥');

    // 与主聊天一致：关闭限长时不发送 max_tokens，由服务商决定单次输出长度。
    const limitMaxTokensEnabled = isEnabledSetting(config.limitMaxTokens);
    const maxTokens = Number(opts.maxTokens) > 0
      ? Math.floor(opts.maxTokens)
      : (opts.bypassTokenLimit ? undefined : (limitMaxTokensEnabled ? config.maxTokens : undefined));

    return generateText({
      model: buildModel(config, this.aiService),
      messages,
      requestOptions: buildRequestOptions(config, {
        temperature: typeof opts.temperature === 'number' ? opts.temperature : (config.temperature || 0.7),
        maxTokens,
        timeoutMs: opts.timeoutMs,
        signal: opts.abortSignal,
      }),
      onToken: typeof opts.onToken === 'function' ? opts.onToken : null,
      autoContinue: Boolean(opts.autoContinue),
    });
  }

  /**
   * 把工具 dispatcher 需要的 services 容器组装出来。
   * 对话请求带有上下文时，“当前笔记”就是上下文里注入的那篇（没有则视为未打开笔记），
   * 不再向主窗口询问——发起请求的可能是待办页、AI 页或独立笔记窗口。
   */
  _toolServices(contextPackage) {
    const getCurrentNote = contextPackage
      ? async () => (contextPackage.currentNote?.id != null ? this.noteDAO.findById(contextPackage.currentNote.id) : null)
      : this._currentNoteGetter
    return {
      aiService: this.aiService,
      noteDAO: this.noteDAO,
      todoDAO: this.todoDAO,
      mem0Service: this.mem0Service,
      webSearchService: this.webSearchService,
      longDocPipeline: this._getLongDocPipeline(),
      logger: this.logger,
      getCurrentNote,
      appSettings: contextPackage?.appSettings || {},
      settingDAO: this.aiService?.settingDAO,
      widgetService: this._widgetService || null
    };
  }

  /** 执行单个工具：写入类先转待确认计划，其它直接路由到 handler */
  async _executeTool(name, args, options = {}) {
    if (isToolDisabled(options, name)) {
      return JSON.stringify({
        success: false,
        error: `工具 ${name} 在本次请求中不可用，请不要再次调用它，直接基于已有文本信息回答。`,
        disabled: true
      });
    }
    if (options.requireConfirmation !== false && WRITE_TOOL_NAMES.has(name)) {
      if (name === 'update_settings') {
        try {
          const { validateChanges } = require('./tools/handlers/settings');
          args = { changes: validateChanges(args?.changes) };
        } catch (error) { return JSON.stringify({ success: false, error: error.message }); }
      }
      const { referenceImages, ...targetContext } = options.actionContext || {};
      const usesReferences = ['create_whiteboard', 'update_whiteboard', 'create_widget', 'update_widget'].includes(name);
      const context = options.actionContext ? (usesReferences ? options.actionContext : targetContext) : null;
      if (name === 'edit_note') {
        const prepared = this._prepareNoteEdit(args);
        if (prepared.error) return JSON.stringify({ success: false, error: prepared.error });
        return JSON.stringify(await this._pendingActions.create(name, prepared.args, context, { preview: prepared.preview }));
      }
      return JSON.stringify(await this._pendingActions.create(name, args, context));
    }
    const result = await dispatchTool(name, args, {
      onChunk: typeof options.onChunk === 'function' ? options.onChunk : null,
      abortSignal: options.abortSignal
    }, this._toolServices(options.contextPackage));
    this._notifyNotesChanged(name, args, result);
    if (['create_todo', 'create_todos'].includes(name)) {
      const parsed = safeJsonParse(result);
      if (parsed?.success) this._todosChangedListener?.();
    }
    return result;
  }

  /**
   * 提出笔记修改时先按当前正文试算一次：片段找不到或不唯一时立即把错误交还给模型修正，不生成确认卡；
   * 成功则记下正文指纹（确认时用来发现期间的改动）并生成修改前后对比，显示在确认卡上。
   */
  _prepareNoteEdit(args = {}) {
    const existing = args.id != null ? this.noteDAO?.findById?.(args.id) : null;
    if (!existing) return { args };
    const { resolveNoteContentEdit } = require('./tools/handlers/notes');
    const resolved = resolveNoteContentEdit(existing, { ...args, _base_hash: undefined });
    if (resolved.error) return { error: resolved.error };
    const { contentHash, previewRewrite } = require('./noteEdits');
    let preview = null;
    if (resolved.changes) {
      preview = { mode: 'partial', changes: resolved.changes.slice(0, 8), total: resolved.changes.length };
    } else if (typeof resolved.content === 'string' && resolved.content !== existing.content) {
      preview = { mode: 'rewrite', ...previewRewrite(existing.content || '', resolved.content) };
    }
    return { args: { ...args, _base_hash: contentHash(existing.content || '') }, preview };
  }

  // 由 main.js 注入：AI 工具直接写库（不经 NoteService），需要主动通知渲染层刷新已打开的笔记
  setNotesChangedListener(fn) {
    this._notesChangedListener = typeof fn === 'function' ? fn : null;
  }

  setTodosChangedListener(fn) { this._todosChangedListener = typeof fn === 'function' ? fn : null; }

  _notifyNotesChanged(name, args, rawResult) {
    const linkedTasks = ['create_todo', 'create_todos'].includes(name) && args?.embed_in_note;
    if (!this._notesChangedListener || (!NOTE_WRITE_TOOLS.has(name) && !linkedTasks)) return;
    try {
      const parsed = safeJsonParse(rawResult);
      if (!parsed || parsed.error || parsed.success === false || parsed.cancelled) return;
      let ids = [];
      if (linkedTasks) ids = [args.source_note_id];
      else if (name === 'edit_note') ids = [args?.id];
      else if (name === 'create_note') ids = [parsed.id];
      else if (name === 'write_long_document') ids = [parsed.note_id];
      else if (name === 'edit_notes') {
        ids = (parsed.results || []).filter((item) => item?.success).map((item) => item.id);
      }
      const notes = [...new Set(ids.filter((id) => id != null).map(String))]
        .map((id) => this.noteDAO?.findById?.(id) || this.noteDAO?.findBySyncId?.(id))
        .filter(Boolean);
      if (notes.length) this._notesChangedListener(notes, name);
    } catch (error) {
      this.logger?.warn?.('AIChatService', 'notify notes changed failed', { name, error: error.message });
    }
  }

  // 内存条目丢失（应用重启 / 超过 TTL）时，用确认卡持久化的快照重建动作，
  // 避免历史确认卡“点了报已过期”。仅接受白名单内的写入类工具，args/context 必须是对象。
  _rebuildPendingAction(actionId, fallback) {
    if (!fallback || typeof fallback !== 'object') return null;
    const { name } = fallback;
    if (!WRITE_TOOL_NAMES.has(name)) return null;
    return {
      id: actionId,
      name,
      args: fallback.args && typeof fallback.args === 'object' ? fallback.args : {},
      context: fallback.context && typeof fallback.context === 'object' ? fallback.context : null
    };
  }

  // 取出待确认动作：优先内存条目，失效时用快照重建。
  _takePendingAction(actionId, fallback) {
    return this._pendingActions.take(actionId) || this._rebuildPendingAction(actionId, fallback);
  }

  /**
   * @param {object} [runtime] { onChunk }：长文档等耗时动作的步骤进度（规划 / 第 N 章 / 归并）
   */
  async executePendingAction(actionId, overrides = null, fallback = null, runtime = {}) {
    const action = this._takePendingAction(actionId, fallback);
    if (!action) return { success: false, error: '待确认操作不存在或已过期' };

    const finalArgs = (action.name === 'create_todos' && overrides && Array.isArray(overrides.todos))
      ? { ...action.args, todos: overrides.todos }
      : (action.name === 'edit_notes' && overrides && Array.isArray(overrides.edits))
        ? { ...action.args, edits: overrides.edits }
        : action.args;
    const finalAction = finalArgs === action.args ? action : { ...action, args: finalArgs };

    try {
      const result = await this._executeTool(action.name, finalArgs, {
        requireConfirmation: false,
        onChunk: typeof runtime.onChunk === 'function' ? runtime.onChunk : null,
      });
      const parsed = safeJsonParse(result);
      const success = !(parsed?.error || parsed?.success === false);
      return {
        success,
        error: success ? undefined : parsed.error || '操作执行失败',
        action: finalAction,
        result: parsed
      };
    } catch (error) {
      return { success: false, error: error.message, action: finalAction };
    }
  }

  consumePendingAction(actionId, fallback = null) {
    const action = this._takePendingAction(actionId, fallback);
    if (!action) return { success: false, error: '待确认操作不存在或已过期' };
    return { success: true, action };
  }

  /**
   * 旧的按 OpenAI 格式历史调用的入口：把历史转成完整记录后走 runTurn。
   * @param {Array} messages OpenAI 格式历史，最后一条是本次用户消息
   */
  async chatStream(messages, onChunk, options = {}) {
    const history = Array.isArray(messages) ? messages : [];
    const last = history.at(-1);
    const configResult = await this.aiService.getConfig();
    const model = buildModel(configResult?.data || {}, this.aiService);
    return this.runTurn({
      transcript: toAgentMessages(last?.role === 'user' ? history.slice(0, -1) : history, model),
      userContent: last?.role === 'user' ? last.content : '',
      onChunk,
      options,
    });
  }

  /**
   * 一轮带工具的对话。
   * @param {object} params
   * @param {Array}  params.transcript   完整记录（pi 消息，不含本次用户消息）
   * @param {string|Array} params.userContent  本次用户消息（文字或 OpenAI 格式多模态数组）
   * @param {(chunk) => void} params.onChunk
   * @param {object} params.options      scene / memoryQuery / contextPackage / actionContext / requireConfirmation / disabledTools / disableTools / abortSignal / conversationId / requestId
   * @returns 结果中 newMessages 是本轮新增的消息，contextPackage 是补充记忆后的上下文
   */
  async runTurn({ transcript = [], userContent, onChunk, options = {} }) {
    const referenceImages = referencesFromMessages([{ role: 'user', content: userContent }]);
    options = { ...options, actionContext: { ...options.actionContext, referenceImages } };
    let accumulatedContent = '';
    let pendingActionCreated = false;
    let memoryToolUsed = false;
    const wrappedOnChunk = (chunk) => {
      if (chunk && chunk.type === 'content' && typeof chunk.content === 'string') {
        accumulatedContent += chunk.content;
      }
      if (chunk && chunk.type === 'tool_start' && MEMORY_TOOLS.has(chunk.name)) {
        memoryToolUsed = true;
      }
      if (chunk && chunk.type === 'tool_end' && safeJsonParse(chunk.result)?.requiresConfirmation) {
        pendingActionCreated = true;
      }
      return onChunk(chunk);
    };

    try {
      const configResult = await this.aiService.getConfig();
      if (!configResult.success) throw new Error(configResult.error || '获取AI配置失败');
      const config = configResult.data;
      if (!config.enabled) throw new Error('AI功能未启用，请在设置中开启');
      if (!config.apiKey) throw new Error('请先在设置中配置API密钥');

      this.aiService._checkRateLimit();

      const limitMaxTokensEnabled = isEnabledSetting(config.limitMaxTokens);
      const hasExplicitMaxTokens = options.maxTokens != null;
      const userOutputLimitApplied = hasExplicitMaxTokens || limitMaxTokensEnabled;
      const maxTk = hasExplicitMaxTokens
        ? options.maxTokens
        : (limitMaxTokensEnabled ? config.maxTokens : undefined);

      const enrichedPackage = await enrichContextPackageWithMemories(
        options.contextPackage,
        this.mem0Service,
        { query: options.memoryQuery || '', scene: options.scene || 'chat_panel' }
      );

      // 图片理解（多模态）由后端 config.visionEnabled 统一裁决：关闭时把 read_note_image
      // 并入 disabledTools，让请求工具过滤、工具执行拦截、系统提示词三处口径一致。
      const imageReadingEnabled = isEnabledSetting(config.visionEnabled) && !isToolDisabled(options, 'read_note_image');
      if (!imageReadingEnabled && !isToolDisabled(options, 'read_note_image')) {
        options = { ...options, disabledTools: [...(options.disabledTools || []), 'read_note_image'] };
      }

      const toolSession = createSkillSession({
        disabledTools: options.disabledTools,
        webSearchEnabled: isEnabledSetting(config.webSearchEnabled) && Boolean(config.webSearchApiKey),
        memoryEnabled: Boolean(this.mem0Service?.isAvailable?.()),
      });

      const model = buildModel(config, this.aiService, { vision: imageReadingEnabled });
      const [prompt] = toAgentMessages([{ role: 'user', content: userContent }], model);
      const systemPrompt = `${await getSystemPrompt({ mem0Service: this.mem0Service, imageReadingEnabled })}${buildContextSection(enrichedPackage)}`;
      this._compactionCache ||= new Map();
      // 完整记录可能很长：按预算压缩后再发（压缩只影响本次请求，不改动保存的记录）
      const compacted = await compactTranscript(systemPrompt, [...transcript, prompt], MAX_CONTEXT_TOKENS, {
        cache: this._compactionCache,
        cacheKey: options.conversationId || 'default',
        summarize: async (summaryMessages) => {
          wrappedOnChunk({ type: 'tool_call_prepare', name: 'summarize_current_note_section' });
          const res = await this._generatePlainText(summaryMessages, {
            temperature: 0.2,
            bypassTokenLimit: true,
            timeoutMs: 25000,
            abortSignal: options.abortSignal,
          });
          return res?.content || '';
        },
      }, model);

      const result = await runChat({
        model,
        requestOptions: buildRequestOptions(config, { temperature: options.temperature || config.temperature, maxTokens: maxTk }),
        systemPrompt,
        history: compacted.slice(0, -1),
        prompt: compacted.at(-1),
        toolSession,
        disableTools: options.disableTools === true,
        abortSignal: options.abortSignal,
        onChunk: wrappedOnChunk,
        executeTool: (name, args, runtime) => {
          if (!toolSession.canExecute(name)) return JSON.stringify({ success: false, error: '工具尚未开放或已禁用。请先用 read_skill 加载对应技能，不要猜测调用。' });
          if (name === 'read_skill') return JSON.stringify(toolSession.read(args?.skill));
          return this._executeTool(name, args, {
            requireConfirmation: options.requireConfirmation !== false,
            disabledTools: options.disabledTools,
            actionContext: options.actionContext || null,
            contextPackage: options.contextPackage,
            onChunk: runtime.onChunk,
            abortSignal: runtime.abortSignal,
          });
        },
        // 回复声称已准备好确认卡、本轮却没有调用写入工具：追加一轮纠正
        phantomNudge: (text) => (options.requireConfirmation !== false && CONFIRMATION_CLAIM_RE.test(text) ? PHANTOM_CONFIRMATION_NUDGE : null),
      });
      if (result.retriedPhantomClaim) {
        this.logger.warn('AIChatService', 'Phantom confirmation claim, retried', {
          requestId: options.requestId || null,
          conversationId: options.conversationId || null,
        });
      }
      const finalContent = accumulatedContent || result.content;
      this.logger.info('AIChatService', 'Stream chat result', {
        requestId: options.requestId || null,
        conversationId: options.conversationId || null,
        path: result.newMessages.some((message) => message.role === 'toolResult') ? 'toolLoop' : 'direct',
        finishReason: result.finishReason || null,
        maxTk: maxTk ?? null,
        contentLen: String(finalContent || '').length,
        pendingActionCreated,
      });
      return {
        success: true,
        fullContent: finalContent,
        usage: result.usage,
        finishReason: result.finishReason,
        truncated: result.truncated,
        outputLimitApplied: userOutputLimitApplied,
        ...(result.taskStatus ? { taskStatus: result.taskStatus } : {}),
        ...(result.stopReason ? { stopReason: result.stopReason } : {}),
        memoryToolUsed,
        newMessages: result.newMessages,
        contextPackage: enrichedPackage,
      };
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted|取消|cancel/i.test(error?.message || '')) {
        return { success: false, cancelled: true, error: '已取消生成', fullContent: accumulatedContent };
      }
      const normalizedError = normalizeModelError(error);
      this.logger.error('AIChatService', 'Stream chat failed', {
        requestId: options.requestId || null,
        conversationId: options.conversationId || null,
        error: error?.stack || error?.message || String(error),
        normalizedError,
      });
      onChunk({ type: 'error', content: normalizedError });
      return { success: false, error: normalizedError, fullContent: accumulatedContent };
    }
  }

  /** 非流式聊天（简单模式，用于快速操作）。该路径不走工具循环，关掉取图指令避免无效负载。 */
  async chat(messages, options = {}) {
    const systemPrompt = await getSystemPrompt({ mem0Service: this.mem0Service, imageReadingEnabled: false });
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    return this.aiService.chat(fullMessages, options);
  }

  /**
   * 为笔记自动生成标题与标签建议（不写库，调用方自行决定如何应用）。
   * - 内容过短直接返回空建议，避免无意义请求。
   * - 走 _generatePlainText（无工具、低温度、JSON 输出），尽量短小快速。
   */
  async autoAnnotate({ title = '', content = '', existingTags = [], libraryTags = [] } = {}) {
    const text = String(content || '').trim();
    if (text.length < 30) {
      return { success: true, data: { title: '', tags: [] } };
    }
    const truncated = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
    const existing = Array.isArray(existingTags)
      ? existingTags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10)
      : [];
    const library = Array.isArray(libraryTags)
      ? libraryTags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 60)
      : [];

    const sys = '你是笔记元数据助手。仅根据用户给出的笔记内容，输出一个简洁标题和最多 5 个高相关中文标签。严格只返回 JSON，不要任何解释、前后缀或代码块包裹。';
    const user = [
      `当前标题：${title || '（空）'}`,
      `已有标签：${existing.length ? existing.join('、') : '（无）'}`,
      `标签库（请优先从中复用贴切的标签，仅当库中确实没有合适项时才创造新标签）：${library.length ? library.join('、') : '（空）'}`,
      `笔记内容：\n${truncated}`,
      '',
      '请输出 JSON：{"title": "不超过 18 字、概括主题、不要句号", "tags": ["最多 5 个，单词或短语，1~6 字，不带 #"]}',
      '标签选择规则：优先复用「标签库」中语义贴切的现有标签；只有当库中没有合适标签时，才生成新的标签。tags 中不要重复「已有标签」。',
      '若已有标题非空且贴切，title 请保留为空字符串。'
    ].join('\n');

    try {
      const result = await this._generatePlainText(
        [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        { temperature: 0.2 }
      );
      const raw = String(result?.content || '').trim();
      // 从文本中提取第一个 JSON 对象（兼容模型在前后加解释/代码块围栏的情况）
      let cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      const braceMatch = cleaned.match(/\{[\s\S]*\}/);
      if (braceMatch) cleaned = braceMatch[0];
      const parsed = safeJsonParse(cleaned) || {};
      const suggestedTitle = typeof parsed.title === 'string' ? parsed.title.trim() : '';
      const rawTags = Array.isArray(parsed.tags) ? parsed.tags : [];
      const seen = new Set(existing.map((t) => t.toLowerCase()));
      const tags = [];
      for (const t of rawTags) {
        const v = String(t || '').replace(/^#+/, '').trim();
        if (!v || v.length > 12) continue;
        if (seen.has(v.toLowerCase())) continue;
        seen.add(v.toLowerCase());
        tags.push(v);
        if (tags.length >= 5) break;
      }
      return {
        success: true,
        data: {
          title: suggestedTitle.slice(0, 30),
          tags
        }
      };
    } catch (error) {
      this.logger.warn('AI', 'autoAnnotate failed', error?.message);
      return { success: false, error: error?.message || 'autoAnnotate failed' };
    }
  }
}

module.exports = AIChatService;
