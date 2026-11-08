/**
 * AI 会话由主进程持有：一轮对话的发送、流式进度、结果保存、确认卡状态都在这里完成，
 * 再广播给所有窗口（主窗口、独立笔记窗口……），各窗口只订阅和展示。
 *
 * 广播：
 *   ai:session-conversation  { conversation }                    会话内容变化（不含完整记录）
 *   ai:session-stream        { conversationId, requestId, draft } 生成中的草稿；draft 为 null 表示结束
 *
 * 每个会话同一时间只跑一轮；不同会话可以并行。
 */
const {
  buildMessageMetadata,
  createUserMessage,
  createAssistantMessage,
  titleFromMessages,
  slimStepsForPersist,
  getContextSources,
  formatAssistantCompletion,
  findAction,
  latestCardsOnly,
  patchAction,
  canExecute,
  supersedeStalePendingActions,
  emptyDraft,
  applyChunk,
} = require('./messageModel');
const { fromDisplayMessages, toPersisted, dropLastTurn } = require('./transcript');
const { buildModel } = require('../../llm/model');

// 流式草稿最多每 50ms 广播一次：逐字推送会让长回答在 IPC 上反复传输整段文字
const DRAFT_BROADCAST_MS = 50;
// 对话后自动记忆只在这两个入口做
const AUTO_MEMORY_SCENES = new Set(['chat_panel', 'floating_panel']);

class ConversationSessions {
  /**
   * @param {object} deps
   * @param {object} deps.dao             ConversationDAO
   * @param {object} deps.aiChatService   提供 runTurn / processTurnMemories
   * @param {object} deps.aiService       读取配置（旧会话重建完整记录时需要模型信息）
   * @param {(channel, payload) => void} deps.broadcast  发给所有窗口
   * @param {object} [deps.logger]
   */
  constructor({ dao, aiChatService, aiService, broadcast, logger }) {
    this.dao = dao;
    this.aiChatService = aiChatService;
    this.aiService = aiService;
    this.broadcast = broadcast;
    this.logger = logger;
    this.runs = new Map(); // conversationId → { requestId, controller, draft }
  }

  // ── 读写 ──

  _load(conversationId) {
    return this.dao.getById(conversationId, { withTranscript: true });
  }

  _publish(conversation) {
    if (!conversation) return;
    const { transcript, ...visible } = conversation;
    this.broadcast('ai:session-conversation', { conversation: visible });
  }

  /** 修改展示消息（以及可选的完整记录）并广播 */
  _save(conversationId, { messages, transcript, title }) {
    const saved = this.dao.saveSession(conversationId, { messages, transcript, title });
    this._publish(saved);
    return saved;
  }

  async _transcriptOf(conversation) {
    if (Array.isArray(conversation.transcript)) return conversation.transcript;
    // 旧会话没有完整记录：用展示消息里的文字重建
    const config = (await this.aiService.getConfig())?.data || {};
    return fromDisplayMessages(conversation.messages, buildModel(config, this.aiService));
  }

  _publishDraft(conversationId, run, { force = false } = {}) {
    const now = Date.now();
    if (!force && now - run.lastBroadcastAt < DRAFT_BROADCAST_MS) {
      if (!run.pendingTimer) {
        run.pendingTimer = setTimeout(() => {
          run.pendingTimer = null;
          this._publishDraft(conversationId, run, { force: true });
        }, DRAFT_BROADCAST_MS);
      }
      return;
    }
    clearTimeout(run.pendingTimer);
    run.pendingTimer = null;
    run.lastBroadcastAt = now;
    this.broadcast('ai:session-stream', { conversationId, requestId: run.requestId, draft: run.draft });
  }

  /** 正在生成的会话（窗口刚打开时用来恢复「生成中」状态） */
  activeStreams() {
    return [...this.runs].map(([conversationId, run]) => ({ conversationId, requestId: run.requestId, draft: run.draft }));
  }

  // ── 一轮对话 ──

  /**
   * @param {object} params
   * @param {string} params.conversationId
   * @param {object} [params.meta]          会话还不存在时创建用：{ title, noteId, source }
   * @param {string|Array} params.content   用户消息（文字或多模态数组）
   * @param {string} params.text            用户消息的文字（检索、记忆、标题用）
   * @param {object} params.options         scene / requestPrefix / contextPackage / actionContext / requireConfirmation / defaultTitle
   */
  async send({ conversationId, meta = {}, content, text = '', options = {} }) {
    if (!conversationId) return { success: false, error: '缺少会话 ID' };
    if (this.runs.has(conversationId)) return { success: false, error: '这个对话正在生成，请等它结束或先停止' };
    const requestId = `${options.requestPrefix || 'ai'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const run = { requestId, controller: new AbortController(), draft: emptyDraft(), lastBroadcastAt: 0, pendingTimer: null };
    this.runs.set(conversationId, run);
    try {
      let conversation = this._load(conversationId);
      if (!conversation) {
        this.dao.upsert({ id: conversationId, title: meta.title || '新对话', noteId: meta.noteId ?? null, source: meta.source });
        conversation = this._load(conversationId);
      }
      const scope = { noteId: conversation.noteId ?? null, source: conversation.source };
      const defaultTitle = options.defaultTitle || conversation.title || '新对话';
      const transcript = await this._transcriptOf(conversation);

      const userMessage = createUserMessage({ content, metadata: buildMessageMetadata({ conversationId, ...scope }) });
      const messagesWithUser = [...conversation.messages, userMessage];
      this._save(conversationId, { messages: messagesWithUser, title: titleFromMessages(messagesWithUser, defaultTitle) });
      this._publishDraft(conversationId, run, { force: true });

      const result = await this.aiChatService.runTurn({
        transcript,
        userContent: content,
        onChunk: (chunk) => {
          run.draft = applyChunk(run.draft, chunk);
          this._publishDraft(conversationId, run);
        },
        options: {
          ...options,
          memoryQuery: text,
          conversationId,
          requestId,
          abortSignal: run.controller.signal,
          actionContext: { ...options.actionContext, selectedNoteId: scope.noteId, source: scope.source },
        },
      });

      return this._finishTurn({ conversationId, run, result, transcript, defaultTitle, scope, text, options });
    } catch (error) {
      this.logger?.error?.('ConversationSessions', 'send failed', { conversationId, error: error.message });
      const latest = this._load(conversationId);
      if (latest) {
        this._save(conversationId, { messages: [...latest.messages, { role: 'assistant', content: `❌ 发生错误: ${error.message}` }] });
      }
      return { success: false, error: error.message, requestId };
    } finally {
      clearTimeout(run.pendingTimer);
      this.runs.delete(conversationId);
      this.broadcast('ai:session-stream', { conversationId, requestId, draft: null });
    }
  }

  _finishTurn({ conversationId, run, result, transcript, defaultTitle, scope, text, options }) {
    const latest = this._load(conversationId);
    if (!latest) return { success: false, cancelled: true, requestId: run.requestId }; // 生成期间会话被删除
    const { draft } = run;
    const stoppedByUser = Boolean(result?.cancelled);
    const base = stoppedByUser
      ? (draft.streamContent || result.fullContent || '已停止生成。')
      : result?.success
        ? (result.fullContent || draft.streamContent || '')
        : (draft.streamContent || `❌ ${result?.error || '请求失败'}`);
    const assistant = createAssistantMessage({
      content: formatAssistantCompletion(base, result),
      toolCalls: draft.toolCalls,
      actions: latestCardsOnly(draft.toolCalls.map((call) => call.action).filter(Boolean)),
      steps: draft.steps.length ? slimStepsForPersist(draft.steps) : undefined,
      contextSources: result?.contextPackage ? getContextSources(result.contextPackage) : undefined,
      stopped: stoppedByUser,
      metadata: buildMessageMetadata({ conversationId, ...scope, requestId: run.requestId }),
    });
    const messages = supersedeStalePendingActions([...latest.messages, assistant]);
    // 只有成功的一轮才追加进完整记录；失败 / 停止的这一轮下次不作为上下文
    const nextTranscript = result?.success ? [...transcript, ...toPersisted(result.newMessages)] : undefined;
    this._save(conversationId, { messages, transcript: nextTranscript, title: titleFromMessages(messages, defaultTitle) });

    if (result?.success && !result.memoryToolUsed && AUTO_MEMORY_SCENES.has(options.scene)) {
      this._autoMemory(conversationId, run.requestId, text, result.fullContent);
    }
    return {
      success: Boolean(result?.success),
      cancelled: stoppedByUser || undefined,
      error: result?.success ? undefined : result?.error,
      requestId: run.requestId,
    };
  }

  // 对话后自动记忆：不阻塞回复，有变更时挂到这条回复上
  _autoMemory(conversationId, requestId, userText, assistantText) {
    this.aiChatService.processTurnMemories({
      conversationId,
      messages: [{ role: 'user', content: userText }],
      assistantText,
    }).then((changes) => {
      if (!changes?.length) return;
      this._patchReply(conversationId, requestId, (message) => ({ ...message, memoryUpdates: { changes, reverted: false } }));
    }).catch((error) => {
      this.logger?.warn?.('ConversationSessions', 'auto memory failed', { requestId, error: error.message });
    });
  }

  _patchReply(conversationId, requestId, patch) {
    const conversation = this._load(conversationId);
    if (!conversation) return false;
    const index = conversation.messages.findIndex((message) => message.role === 'assistant' && message.metadata?.requestId === requestId);
    if (index === -1) return false;
    this._save(conversationId, { messages: conversation.messages.map((message, i) => (i === index ? patch(message) : message)) });
    return true;
  }

  cancel(conversationId) {
    const run = this.runs.get(conversationId);
    if (!run) return { success: false, error: '没有正在生成的回复' };
    run.controller.abort();
    return { success: true };
  }

  /** 重新生成最后一条回复：去掉最后一轮（展示消息与完整记录），用同一条用户消息再问一次 */
  async retry({ conversationId, options = {} }) {
    if (this.runs.has(conversationId)) return { success: false, error: '这个对话正在生成' };
    const conversation = this._load(conversationId);
    if (!conversation) return { success: false, error: '对话不存在' };
    const lastUserIndex = conversation.messages.map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex < 0) return { success: false, error: '没有可以重新生成的消息' };
    const lastUser = conversation.messages[lastUserIndex];
    const [transcript] = dropLastTurn(await this._transcriptOf(conversation));
    this._save(conversationId, { messages: conversation.messages.slice(0, lastUserIndex), transcript });
    const text = Array.isArray(lastUser.content)
      ? lastUser.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
      : String(lastUser.content || '');
    return this.send({ conversationId, content: lastUser.content, text, options });
  }

  // ── 确认卡 ──

  /** 开始执行：只有待确认 / 失败 / 已停止的卡能开始；同一张卡在多个窗口里只会被执行一次 */
  beginAction(conversationId, actionId) {
    const conversation = this._load(conversationId);
    const action = findAction(conversation?.messages, actionId);
    if (!action || !canExecute(action)) return { success: false, error: '这张卡片已经执行过或已失效' };
    this._save(conversationId, { messages: patchAction(conversation.messages, actionId, { status: 'running', error: undefined }) });
    return { success: true, action };
  }

  /**
   * 执行结束：写回状态与结果。成功时追加一条结果消息，并记进完整记录，下一轮 AI 知道这件事已经做完。
   * @param {object} outcome { success, cancelled, message, error, resultNoteId, resultData }
   */
  async finishAction(conversationId, actionId, outcome = {}) {
    const conversation = this._load(conversationId);
    if (!conversation || !findAction(conversation.messages, actionId)) return { success: false, error: '对话或卡片不存在' };
    const { success, cancelled, message, error, resultNoteId, resultData } = outcome;
    let messages = patchAction(conversation.messages, actionId, {
      status: success ? 'done' : cancelled ? 'cancelled' : 'failed',
      resultMessage: message,
      error,
      ...(resultNoteId != null ? { resultNoteId } : {}),
      ...(resultData ? { resultData } : {}),
    });
    let transcript;
    if (success && message) {
      messages = [...messages, { role: 'assistant', content: message, actionResultFor: actionId }];
      const base = await this._transcriptOf(conversation);
      const config = (await this.aiService.getConfig())?.data || {};
      const model = buildModel(config, this.aiService);
      transcript = [...base, {
        role: 'assistant',
        content: [{ type: 'text', text: `（用户已确认，操作已执行）${message}${resultNoteId != null ? `，结果笔记 ID：${resultNoteId}` : ''}` }],
        api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      }];
    }
    this._save(conversationId, { messages, transcript });
    return { success: true };
  }

  dismissAction(conversationId, actionId) {
    const conversation = this._load(conversationId);
    const action = findAction(conversation?.messages, actionId);
    if (!action || (action.status && action.status !== 'pending')) return { success: false };
    this._save(conversationId, { messages: patchAction(conversation.messages, actionId, { status: 'dismissed' }) });
    return { success: true };
  }

  /** 误触忽略后恢复：仅 dismissed → pending（执行时后端会用卡片里保存的参数重建动作） */
  restoreAction(conversationId, actionId) {
    const conversation = this._load(conversationId);
    const action = findAction(conversation?.messages, actionId);
    if (action?.status !== 'dismissed') return { success: false };
    this._save(conversationId, { messages: patchAction(conversation.messages, actionId, { status: 'pending', error: undefined }) });
    return { success: true };
  }

  /** 撤销自动记忆后在回复上标记已撤销 */
  markMemoryReverted(conversationId, requestId) {
    const ok = this._patchReply(conversationId, requestId, (message) => ({ ...message, memoryUpdates: { ...message.memoryUpdates, reverted: true } }));
    return { success: ok };
  }
}

module.exports = ConversationSessions;
