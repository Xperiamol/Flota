// 待确认动作的跨入口兼容读取。
//
// 历史原因：AI 功能页（AIChatView）把待确认动作挂在 msg.toolCalls[].action 上，
// AI 浮窗（AICommandCenter）则挂在 msg.actions[] 上。两者共享同一份会话存储，
// 因此一条会话可能在另一个入口被打开。这里提供统一读取，让任一入口都能渲染
// 另一入口产生的确认卡，避免确认卡“消失”。

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

  if (Array.isArray(msg.actions)) {
    msg.actions.forEach(push)
  }
  if (Array.isArray(msg.toolCalls)) {
    msg.toolCalls.forEach((tc) => push(tc?.action))
  }
  return collected
}

// 给一条消息里某个 actionId 的待确认动作打补丁（同时覆盖 toolCalls[].action 与 actions[] 两种 schema）。
// patch 会浅合并进动作对象；返回新的 message（未命中则原样返回）。
export const patchMessagePendingAction = (msg, actionId, patch) => {
  if (!msg || typeof msg !== 'object' || !actionId) return msg

  let changed = false
  const next = { ...msg }

  if (Array.isArray(msg.toolCalls)) {
    next.toolCalls = msg.toolCalls.map((tc) => {
      if (!isPendingAction(tc?.action) || tc.action.actionId !== actionId) return tc
      changed = true
      return { ...tc, action: { ...tc.action, ...patch } }
    })
  }
  if (Array.isArray(msg.actions)) {
    next.actions = msg.actions.map((a) => {
      if (!isPendingAction(a) || a.actionId !== actionId) return a
      changed = true
      return { ...a, ...patch }
    })
  }

  return changed ? next : msg
}

export default getMessagePendingActions
