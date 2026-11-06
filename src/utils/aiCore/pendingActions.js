// 会话消息里的待确认动作：渲染层只读取和展示。
//
// 卡片状态（执行中 / 完成 / 失败 / 忽略 / 被新方案替代）由主进程的会话服务写入
// （electron/services/aichat/sessions/messageModel.js），所有窗口通过广播同步。
//
// 历史原因：旧会话的待确认动作挂在 msg.toolCalls[].action 上，新写入只用 msg.actions[]，
// 这里两种都读，保证旧会话的确认卡也能显示。

const isPendingAction = (action) =>
  Boolean(action && typeof action === 'object' && action.actionId)

// 从一条 assistant 消息里提取所有待确认动作（两种 schema 合并去重）。
export const getMessagePendingActions = (msg) => {
  if (!msg || typeof msg !== 'object') return []
  const collected = []
  const seen = new Set()
  const push = (action) => {
    if (!isPendingAction(action) || seen.has(action.actionId)) return
    seen.add(action.actionId)
    collected.push(action)
  }
  if (Array.isArray(msg.actions)) msg.actions.forEach(push)
  if (Array.isArray(msg.toolCalls)) msg.toolCalls.forEach((tc) => push(tc?.action))
  return collected
}

// 输入框也可以完成确认：仅接受单独、明确的确认短句。带有补充要求的句子仍交给模型处理，避免误执行旧计划。
export const isExplicitPendingActionConfirmation = (text) => {
  const normalized = String(text || '')
    .trim()
    .replace(/[。！!，,；;]+$/g, '')
    .trim()
    .toLowerCase()
  return /^(可以|好|好的|确认|确定|同意|执行|开始|开始吧|就这样|按这个来|ok|okay|yes)$/.test(normalized)
}

// 旧版本曾把「本条回复实际生成的确认卡」之类的注释写进历史，已保存的旧回复显示时去掉
export const stripInternalActionAnnotations = (content) => typeof content === 'string'
  ? content.replace(/[\[［]\s*(?:本条回复实际生成的确认卡|注意[：:]\s*本条回复没有调用任何写入工具)[\s\S]*?[\]］]/g, '').trim()
  : content

// 文字确认（「好的 / 确认」）能执行的卡：最后一条 assistant 消息里所有仍在等待的动作。
// 多张卡时依次执行；只要含有批量卡（勾选保存在卡片内，文字确认拿不到用户改过的选择）
// 就整体放弃，交给用户在卡片上点确认，避免部分执行造成困惑。
export const getLatestConfirmableActions = (messages) => {
  if (!Array.isArray(messages)) return []
  const message = messages[messages.length - 1]
  if (message?.role !== 'assistant') return []
  const actions = getMessagePendingActions(message)
    .filter((action) => !action.status || action.status === 'pending')
  if (actions.some((action) => ['create_todos', 'edit_notes'].includes(action.name))) return []
  return actions
}

// 结果仍保留在会话中供 AI 读取；卡片已显示同一结果时，不再重复渲染一条气泡。
export const getDisplayMessages = (messages) => {
  const completed = new Map((messages || []).flatMap(getMessagePendingActions)
    .filter((action) => action.status === 'done').map((action) => [action.actionId, action.resultMessage]))
  return (messages || []).filter((message) => !message.actionResultFor
    || !completed.has(message.actionResultFor)
    || completed.get(message.actionResultFor) !== message.content)
}

export default getMessagePendingActions
