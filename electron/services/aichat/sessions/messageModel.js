/**
 * 会话展示消息的纯函数（主进程是唯一写入方，渲染层只读取和展示）。
 *
 * 展示消息 schema：{ role, content, actions?, toolCalls?, steps?, contextSources?, stopped?, metadata?, memoryUpdates? }
 *   - actions：待确认动作的唯一写入位置（读取兼容历史 toolCalls[].action）
 *   - toolCalls：只作工具执行标记，不带动作
 */

const buildMessageMetadata = ({ conversationId, noteId, source, requestId } = {}) => {
  const metadata = {};
  if (conversationId != null) metadata.conversationId = conversationId;
  if (noteId != null) metadata.noteId = noteId;
  if (source != null) metadata.source = source;
  if (requestId != null) metadata.requestId = requestId;
  return metadata;
};

const createUserMessage = ({ content, metadata } = {}) => ({
  role: 'user',
  content,
  ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
});

const createAssistantMessage = ({ content, actions, toolCalls, steps, contextSources, stopped, metadata } = {}) => {
  const message = { role: 'assistant', content: String(content || '') };
  if (actions?.length) message.actions = actions;
  if (toolCalls?.length) message.toolCalls = toolCalls.map(({ action, ...rest }) => rest);
  if (steps?.length) message.steps = steps;
  if (contextSources?.length) message.contextSources = contextSources;
  if (stopped) message.stopped = true;
  if (metadata && Object.keys(metadata).length) message.metadata = metadata;
  return message;
};

const messageText = (content) => (Array.isArray(content)
  ? content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n')
  : String(content || ''));

const titleFromMessages = (messages, fallback = '新对话') => {
  const first = messages.find((message) => message.role === 'user');
  if (!first?.content) return fallback;
  const text = (messageText(first.content) || '[图片]').replace(/\n/g, ' ').trim();
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
};

// 长文档正文已落盘为笔记，步骤树里只保留开头，避免超长内容撑大会话存储
const SECTION_PERSIST_LIMIT = 400;
const slimStepsForPersist = (steps) => steps.map((step) => {
  const content = typeof step.content === 'string' ? step.content : '';
  if (content.length <= SECTION_PERSIST_LIMIT) return step;
  return { ...step, content: `${content.slice(0, SECTION_PERSIST_LIMIT)}…`, contentTruncated: true };
});

const truncate = (text, max) => {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

/** 回复里引用了哪些上下文（界面上显示成来源标签） */
const getContextSources = (contextPackage = {}) => [
  ...(contextPackage.currentNote ? [{ type: 'currentNote', id: contextPackage.currentNote.id, label: `当前：${contextPackage.currentNote.title || '未命名'}` }] : []),
  ...(contextPackage.relatedNotes || []).map((note) => ({ type: 'relatedNote', id: note.id, label: `相关：${note.title || '未命名'}` })),
  ...(contextPackage.memories || []).map((memory) => ({ type: 'memory', id: memory.id, label: `记忆：${truncate(memory.content, 18)}` })),
];

const formatAssistantCompletion = (content, result) => {
  if (result?.taskStatus === 'incomplete') return `${content}\n\n本轮已暂停，任务尚未完成。可以缩小范围后继续。`;
  if (!result?.truncated) return content;
  const hint = result.outputLimitApplied
    ? '⚠️ 回复达到当前最大 token 限制，可能未完整输出。可以在高级设置里调高最大输出长度，或发送“继续”。'
    : '⚠️ 回复达到模型或服务商的输出上限，可能未完整输出。可以发送“继续”让 AI 接着写。';
  return `${content}\n\n${hint}`;
};

// ── 待确认动作 ──

const isAction = (action) => Boolean(action && typeof action === 'object' && action.actionId);

/** 一条消息里的所有待确认动作（msg.actions 与历史 toolCalls[].action 合并去重） */
const getMessagePendingActions = (message) => {
  if (!message || typeof message !== 'object') return [];
  const seen = new Set();
  return [...(message.actions || []), ...(message.toolCalls || []).map((call) => call?.action)]
    .filter((action) => isAction(action) && !seen.has(action.actionId) && seen.add(action.actionId));
};

const findAction = (messages, actionId) => (messages || []).flatMap(getMessagePendingActions)
  .find((action) => action.actionId === actionId) || null;

/** 给某个 actionId 的动作打补丁（同时覆盖 actions[] 与历史 toolCalls[].action） */
const patchMessagePendingAction = (message, actionId, patch) => {
  if (!message || typeof message !== 'object' || !actionId) return message;
  let changed = false;
  const next = { ...message };
  if (Array.isArray(message.actions)) {
    next.actions = message.actions.map((action) => {
      if (!isAction(action) || action.actionId !== actionId) return action;
      changed = true;
      return { ...action, ...patch };
    });
  }
  if (Array.isArray(message.toolCalls)) {
    next.toolCalls = message.toolCalls.map((call) => {
      if (!isAction(call?.action) || call.action.actionId !== actionId) return call;
      changed = true;
      return { ...call, action: { ...call.action, ...patch } };
    });
  }
  return changed ? next : message;
};

const patchAction = (messages, actionId, patch) => messages.map((message) => patchMessagePendingAction(message, actionId, patch));

// 可以开始执行的状态：待确认、失败后重试、停止后重试
const EXECUTABLE_STATUSES = new Set(['pending', 'failed', 'cancelled']);
const canExecute = (action) => Boolean(action) && (!action.status || EXECUTABLE_STATUSES.has(action.status));

/**
 * AI 给出新的待确认方案时，之前仍在等待的卡片视为被替代，避免同屏出现多个可点的「确认」。
 * 仅当最后一条 assistant 消息带有 pending 卡片时生效。
 */
const supersedeStalePendingActions = (messages) => {
  if (!Array.isArray(messages) || messages.length < 2) return messages;
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (last?.role !== 'assistant') return messages;
  if (!getMessagePendingActions(last).some((action) => !action.status || action.status === 'pending')) return messages;
  let changed = false;
  const next = messages.map((message, index) => {
    if (index === lastIndex) return message;
    let patched = message;
    for (const action of getMessagePendingActions(message)) {
      if (action.status && action.status !== 'pending') continue;
      patched = patchMessagePendingAction(patched, action.actionId, { status: 'superseded' });
    }
    if (patched !== message) changed = true;
    return patched;
  });
  return changed ? next : messages;
};

// ── 生成过程中的草稿：流式文字、工具标记、长文档步骤 ──

const emptyDraft = () => ({ streamContent: '', toolCalls: [], steps: [], activeTool: null });

const parseJson = (text) => {
  try { return typeof text === 'string' ? JSON.parse(text) : text; } catch (_) { return null; }
};

// tool_end 结果 → 存进消息的待确认动作（去掉只给模型看的提示字段）
const toPendingAction = (parsed, toolName) => ({
  actionId: parsed.actionId,
  name: parsed.name || toolName,
  args: parsed.args || {},
  context: parsed.context || null,
  summary: parsed.summary,
  label: parsed.label,
  ...(parsed.preview ? { preview: parsed.preview } : {}),
  ...(parsed.memoryReview ? { memoryReview: parsed.memoryReview } : {}),
});

const upsertStep = (steps, stepId, patch) => {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index === -1) return [...steps, { id: stepId, ...patch }];
  return steps.map((step) => (step.id === stepId ? { ...step, ...patch, meta: { ...step.meta, ...patch.meta } } : step));
};

/** 把一个流式事件累积进草稿；返回新草稿（未变化时返回原对象） */
const applyChunk = (draft, chunk) => {
  switch (chunk?.type) {
    case 'content':
      return { ...draft, streamContent: draft.streamContent + (chunk.content || '') };
    case 'error':
      return { ...draft, streamContent: `${draft.streamContent}\n\n⚠️ ${chunk.content}` };
    case 'tool_call_prepare':
      return { ...draft, activeTool: chunk.name || null };
    case 'tool_start':
      return { ...draft, activeTool: chunk.name || null, toolCalls: [...draft.toolCalls, { name: chunk.name, args: chunk.args, done: false }] };
    case 'tool_end': {
      const parsed = parseJson(chunk.result);
      let matched = false;
      const toolCalls = draft.toolCalls.map((call) => {
        if (matched || call.name !== chunk.name || call.done) return call;
        matched = true;
        return {
          ...call,
          done: true,
          action: parsed?.requiresConfirmation && parsed.actionId ? toPendingAction(parsed, chunk.name) : undefined,
          summary: parsed?.summary || parsed?.message || parsed?.error,
          error: parsed?.error,
        };
      });
      return { ...draft, activeTool: null, toolCalls };
    }
    case 'step_start':
      return { ...draft, steps: upsertStep(draft.steps, chunk.stepId, { parentId: chunk.parentId, stepType: chunk.stepType, title: chunk.title || '', status: 'running', content: '', meta: chunk.meta || {} }) };
    case 'step_token': {
      const node = draft.steps.find((step) => step.id === chunk.stepId);
      return { ...draft, steps: upsertStep(draft.steps, chunk.stepId, { content: (node?.content || '') + (chunk.token || '') }) };
    }
    case 'step_update':
      return { ...draft, steps: upsertStep(draft.steps, chunk.stepId, { ...(chunk.title ? { title: chunk.title } : {}), ...(chunk.status ? { status: chunk.status } : {}), ...(chunk.meta ? { meta: chunk.meta } : {}) }) };
    case 'step_end':
      return { ...draft, steps: upsertStep(draft.steps, chunk.stepId, { status: chunk.status || 'done', ...(chunk.title ? { title: chunk.title } : {}), ...(chunk.content ? { content: chunk.content } : {}), ...(chunk.meta ? { meta: chunk.meta } : {}) }) };
    default:
      return draft;
  }
};

module.exports = {
  buildMessageMetadata,
  createUserMessage,
  createAssistantMessage,
  messageText,
  titleFromMessages,
  slimStepsForPersist,
  getContextSources,
  formatAssistantCompletion,
  getMessagePendingActions,
  findAction,
  patchAction,
  canExecute,
  supersedeStalePendingActions,
  emptyDraft,
  applyChunk,
};
