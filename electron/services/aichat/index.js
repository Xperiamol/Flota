/**
 * AI Chat Service - 为 AI 助手提供带工具调用的流式聊天
 *
 * 复用 AIService 的配置和提供商抽象层，
 * 新增服务端流式推送和 function calling 支持，
 * 允许 AI 操作笔记、待办、记忆等应用功能。
 *
 * 模块划分：
 *   - tools/schema + tools/dispatcher：工具 schema 与 handler registry
 *   - stream/streamRequest + stream/sseParser + stream/toolLoop：流式 chat 的请求/解析/工具循环
 *   - systemPrompt：系统提示词与上下文注入
 *   - noteSummary：当前笔记摘要（共享）
 *   - PendingActionStore：写入类工具的二次确认
 */

const { getInstance: getLogger } = require('../LoggerService');
const LongDocumentPipeline = require('../longtask/longDocumentPipeline');

const { WRITE_TOOL_NAMES, DEFAULT_CHAT_MAX_TOKENS, MAX_CONTEXT_TOKENS } = require('./constants');
const { isEnabledSetting, safeJsonParse, trimMessagesToBudget } = require('./utils');
const { dispatchTool } = require('./tools/dispatcher');
const { getSystemPrompt, buildContextSection } = require('./systemPrompt');
const { enrichContextPackageWithMemories } = require('./memoryContext');
const { streamRequest } = require('./stream/streamRequest');
const { handleToolCalls } = require('./stream/toolLoop');
const PendingActionStore = require('./PendingActionStore');

const isContentBlockedError = (error) => /blocked|content.*blocked|machine outputted|安全|拦截|审核|风控/i.test(String(error?.message || error || ''));
const isGatewayError = (error) => /请求失败 \((?:429|502|503|504)\)|\b(?:429|502|503|504)\b|bad gateway|gateway timeout|service unavailable|too many requests|rate limit/i.test(String(error?.message || error || ''));
const isNetworkError = (error) => /fetch failed|network|网络|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|timeout|超时/i.test(String(error?.message || error || ''));

const normalizeChatErrorMessage = (error) => {
  if (isContentBlockedError(error)) return '模型内容审核拦截，请调整表述后重试';
  if (isGatewayError(error)) return 'AI 服务暂时不可用，请稍后重试';
  if (isNetworkError(error)) return '网络请求失败，请检查网络或 AI 配置后重试';
  return error?.message || String(error || '请求失败');
};

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
  }

  setCurrentNoteGetter(fn) {
    this._currentNoteGetter = fn;
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

    const temp = Math.min(Math.max(typeof opts.temperature === 'number' ? opts.temperature : (config.temperature || 0.7), 0), 2);
    // maxTokens 与主 AI 聊天保持一致：显式传入优先，否则按 limitMaxTokens 开关取 config.maxTokens 或默认值
    const limitMaxTokensEnabled = isEnabledSetting(config.limitMaxTokens);
    const maxTk = Number(opts.maxTokens) > 0
      ? Math.floor(opts.maxTokens)
      : (limitMaxTokensEnabled ? config.maxTokens : DEFAULT_CHAT_MAX_TOKENS);
    const onToken = typeof opts.onToken === 'function' ? opts.onToken : null;

    const innerOnChunk = (chunk) => {
      if (chunk && chunk.type === 'content' && onToken) onToken(chunk.content);
    };

    const result = await streamRequest(
      config, messages, temp, maxTk, innerOnChunk, opts.abortSignal,
      { disableTools: true }, this.aiService
    );

    return {
      content: result.content,
      finishReason: result.finishReason,
      truncated: result.finishReason === 'length',
      usage: result.usage
    };
  }

  /** 把工具 dispatcher 需要的 services 容器组装出来 */
  _toolServices() {
    return {
      aiService: this.aiService,
      noteDAO: this.noteDAO,
      todoDAO: this.todoDAO,
      mem0Service: this.mem0Service,
      webSearchService: this.webSearchService,
      longDocPipeline: this._getLongDocPipeline(),
      logger: this.logger,
      getCurrentNote: this._currentNoteGetter
    };
  }

  /** 执行单个工具：写入类先转待确认计划，其它直接路由到 handler */
  async _executeTool(name, args, options = {}) {
    if (Array.isArray(options.disabledTools) && options.disabledTools.includes(name)) {
      return JSON.stringify({
        success: false,
        error: `工具 ${name} 已被当前请求禁用`,
        disabled: true
      });
    }
    if (options.requireConfirmation !== false && WRITE_TOOL_NAMES.has(name)) {
      return JSON.stringify(await this._pendingActions.create(name, args, options.actionContext || null));
    }
    return dispatchTool(name, args, {
      onChunk: typeof options.onChunk === 'function' ? options.onChunk : null,
      abortSignal: options.abortSignal
    }, this._toolServices());
  }

  async executePendingAction(actionId, overrides = null) {
    const action = this._pendingActions.take(actionId);
    if (!action) return { success: false, error: '待确认操作不存在或已过期' };

    const finalArgs = (action.name === 'create_todos' && overrides && Array.isArray(overrides.todos))
      ? { ...action.args, todos: overrides.todos }
      : action.args;
    const finalAction = finalArgs === action.args ? action : { ...action, args: finalArgs };

    try {
      const result = await this._executeTool(action.name, finalArgs, { requireConfirmation: false });
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

  consumePendingAction(actionId) {
    const action = this._pendingActions.take(actionId);
    if (!action) return { success: false, error: '待确认操作不存在或已过期' };
    return { success: true, action };
  }

  /** 流式聊天，支持工具调用 */
  async chatStream(messages, onChunk, options = {}) {
    let accumulatedContent = '';
    const wrappedOnChunk = (chunk) => {
      if (chunk && chunk.type === 'content' && typeof chunk.content === 'string') {
        accumulatedContent += chunk.content;
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

      const temp = Math.min(Math.max(options.temperature || config.temperature, 0), 2);
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
      const systemPrompt = `${await getSystemPrompt({ mem0Service: this.mem0Service })}${buildContextSection(enrichedPackage)}`;
      const budgetedHistory = trimMessagesToBudget(systemPrompt, messages, MAX_CONTEXT_TOKENS);
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...budgetedHistory
      ];

      const stream = (cfg, msgs, t, mt, oc, ab, opts) => streamRequest(cfg, msgs, t, mt, oc, ab, opts, this.aiService);
      const result = await stream(config, fullMessages, temp, maxTk, wrappedOnChunk, options.abortSignal, options);

      if (result.toolCalls && result.toolCalls.length > 0) {
        const toolResult = await handleToolCalls({
          config,
          messages: fullMessages,
          prevResult: result,
          onChunk: wrappedOnChunk,
          temp,
          maxTk,
          depth: 0,
          abortSignal: options.abortSignal,
          options,
          streamRequest: stream,
          executeTool: (name, args, opts) => this._executeTool(name, args, opts),
          logger: this.logger
        });
        return { ...toolResult, fullContent: accumulatedContent || toolResult.fullContent };
      }

      return {
        success: true,
        fullContent: accumulatedContent || result.content,
        usage: result.usage,
        finishReason: result.finishReason,
        truncated: result.finishReason === 'length',
        outputLimitApplied: userOutputLimitApplied
      };
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted|取消|cancel/i.test(error?.message || '')) {
        return { success: false, cancelled: true, error: '已取消生成', fullContent: accumulatedContent };
      }
      const normalizedError = normalizeChatErrorMessage(error);
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

  /** 非流式聊天（简单模式，用于快速操作） */
  async chat(messages, options = {}) {
    const systemPrompt = await getSystemPrompt({ mem0Service: this.mem0Service });
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
