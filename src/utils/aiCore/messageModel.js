import { stripInternalActionAnnotations } from './pendingActions'
// 统一消息模型（问题3）。
//
// 标准 schema：{ role, content, parts?, actions?, toolCalls?, steps?, metadata }
//   - role/content：与 OpenAI 兼容接口一致，content 可为字符串或多模态 parts 数组。
//   - actions：待确认动作的唯一写入位置（废弃 toolCalls[].action 双轨）。
//   - toolCalls：仅作工具执行指示器（chip），不再承载待确认动作。
//   - metadata：贯穿前端/IPC/服务端/画布写入的关联信息，便于定位“哪个请求写错了哪个画布”。
//
// 兼容策略：读取仍兼容历史 toolCalls[].action（见 pendingActions.getMessagePendingActions），
// 但所有新写入只使用本模块构造的新 schema。

// 构造消息 metadata，自动剔除空值，避免持久化无意义字段。
export const buildMessageMetadata = ({ conversationId, noteId, source, requestId } = {}) => {
  const metadata = {}
  if (conversationId != null) metadata.conversationId = conversationId
  if (noteId != null) metadata.noteId = noteId
  if (source != null) metadata.source = source
  if (requestId != null) metadata.requestId = requestId
  return metadata
}

// 构造用户消息。
export const createUserMessage = ({ content, metadata } = {}) => {
  const msg = { role: 'user', content }
  if (metadata && Object.keys(metadata).length > 0) msg.metadata = metadata
  return msg
}

// 构造助手消息：actions 为唯一待确认动作位置；toolCalls 仅作指示器（自动剥离 action 字段）。
export const createAssistantMessage = ({
  content,
  actions,
  toolCalls,
  steps,
  contextSources,
  stopped,
  metadata,
} = {}) => {
  const msg = { role: 'assistant', content: stripInternalActionAnnotations(content) }
  if (Array.isArray(actions) && actions.length > 0) msg.actions = actions
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    // 剥离历史的内联 action，待确认动作只走 msg.actions
    msg.toolCalls = toolCalls.map(({ action, ...rest }) => rest)
  }
  if (Array.isArray(steps) && steps.length > 0) msg.steps = steps
  if (Array.isArray(contextSources) && contextSources.length > 0) msg.contextSources = contextSources
  if (stopped) msg.stopped = true
  if (metadata && Object.keys(metadata).length > 0) msg.metadata = metadata
  return msg
}

// 从流式 toolCalls 中抽取待确认动作（requiresConfirmation 的 tool_end 结果）。
export const extractPendingActions = (toolCalls) => {
  if (!Array.isArray(toolCalls)) return []
  const seen = new Set()
  const result = []
  toolCalls.forEach((tc) => {
    const action = tc?.action
    if (!action || !action.actionId || seen.has(action.actionId)) return
    seen.add(action.actionId)
    result.push(action)
  })
  return result
}

// 消息展示、重试、取回输入使用同一种文本提取规则，保留多模态消息中的文本顺序。
export const messageText = (content) => (Array.isArray(content)
  ? content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n')
  : String(content || ''))

export const parseToolResult = (result) => {
  try {
    return typeof result === 'string' ? JSON.parse(result) : result
  } catch (_) {
    return null
  }
}

// Shared by the AI page and floating panel so completion states stay consistent.
export const formatAssistantCompletion = (content, result) => {
  if (result?.taskStatus === 'incomplete') return `${content}\n\n本轮已暂停，任务尚未完成。可以缩小范围后继续。`
  if (!result?.truncated) return content
  const hint = result.outputLimitApplied
    ? '⚠️ 回复达到当前最大 token 限制，可能未完整输出。可以在高级设置里调高最大输出长度，或发送“继续”。'
    : '⚠️ 回复达到模型或服务商的输出上限，可能未完整输出。可以发送“继续”让 AI 接着写。'
  return `${content}\n\n${hint}`
}
