import { useCallback } from 'react'
import { useStore } from '../store/useStore'
import { executeConversationAction } from '../utils/aiCore/pendingActions'
import { runPendingAction } from '../utils/aiCore/pendingActionExecutor'

// 两个聊天入口共用同一执行状态；异步结果始终写回发起会话。
export default function usePendingActionExecution({ conversationIdRef, messagesRef, setMessages, deps, onTodoUpdated }) {
  return useCallback(async (action, overrides = null) => {
    const conversationId = conversationIdRef.current
    if (!conversationId || !action?.actionId) return
    const read = () => useStore.getState().aiConversations.find(c => c.id === conversationId)?.messages
    const write = (messages) => {
      useStore.getState().aiUpdateConv(conversationId, { messages })
      if (conversationIdRef.current === conversationId) {
        messagesRef.current = messages
        setMessages(messages)
      }
    }
    const result = await executeConversationAction({
      actionId: action.actionId, read, write,
      execute: storedAction => runPendingAction({ action: storedAction, overrides, deps }),
    })
    if (result?.reloadTodos) onTodoUpdated?.()
    if (result?.reloadNotes) await deps.loadNotes?.()
  }, [conversationIdRef, messagesRef, setMessages, deps, onTodoUpdated])
}
