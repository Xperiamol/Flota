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

// 输入框也可以完成确认：仅接受单独、明确的确认短句，并且只执行最近一条消息里
// 唯一的待确认动作。带有补充要求的句子仍交给模型处理，避免误执行旧计划。
export const isExplicitPendingActionConfirmation = (text) => {
  const normalized = String(text || '')
    .trim()
    .replace(/[。！!，,；;]+$/g, '')
    .trim()
    .toLowerCase()
  return /^(可以|好|好的|确认|确定|同意|执行|开始|开始吧|就这样|按这个来|ok|okay|yes)$/.test(normalized)
}

export const getLatestConfirmableAction = (messages) => {
  if (!Array.isArray(messages)) return null
  const message = messages[messages.length - 1]
  if (message?.role !== 'assistant') return null
  const actions = getMessagePendingActions(message)
  if (actions.length !== 1) return null
  const action = actions[0]
  // 批量卡片的勾选保存在卡片内，文字确认无法取得用户改过的选择。
  if (['create_todos', 'edit_notes'].includes(action.name)) return null
  return (!action.status || action.status === 'pending') ? action : null
}

// read/write 必须绑定发起会话；每次写入前读取最新消息，保留执行期间的新消息。
export const executeConversationAction = async ({ actionId, read, write, execute }) => {
  const messages = read()
  const action = messages?.flatMap(getMessagePendingActions).find(item => item.actionId === actionId)
  if (!action || (action.status && action.status !== 'pending')) return null
  write(messages.map(msg => patchMessagePendingAction(msg, actionId, { status: 'running' })))

  let result
  try {
    result = await execute(action)
  } catch (error) {
    result = { success: false, error: error.message, message: `操作失败：${error.message}` }
  }
  const latest = read()
  if (!latest) return result // 执行期间会话已删除。
  const { success, message, error } = result
  write([
    ...latest.map(msg => patchMessagePendingAction(msg, actionId, {
      status: success ? 'done' : 'failed', resultMessage: message, error,
    })),
    { role: 'assistant', content: message },
  ])
  return result
}

export default getMessagePendingActions
