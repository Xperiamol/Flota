import { useCallback, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { dismissConversationAction, executeConversationAction } from '../utils/aiCore/pendingActions'
import { runPendingAction } from '../utils/aiCore/pendingActionExecutor'
import { notifyAINotesUpdated } from '../utils/aiCore/noteRefresh'

// 两个聊天入口共用同一执行状态；异步结果始终写回发起会话。
// 返回 { execute, dismiss }：execute 用于确认 / 重试，dismiss 用于忽略卡片。
export default function usePendingActionExecution({ conversationIdRef, messagesRef, setMessages, deps, onTodoUpdated }) {
  const bindConversation = useCallback(() => {
    const conversationId = conversationIdRef.current
    if (!conversationId) return null
    const read = () => useStore.getState().aiConversations.find(c => c.id === conversationId)?.messages
    const write = (messages) => {
      useStore.getState().aiUpdateConv(conversationId, { messages })
      if (conversationIdRef.current === conversationId) {
        messagesRef.current = messages
        setMessages(messages)
      }
    }
    return { read, write }
  }, [conversationIdRef, messagesRef, setMessages])

  const execute = useCallback(async (action, overrides = null) => {
    const bound = bindConversation()
    if (!bound || !action?.actionId) return
    const result = await executeConversationAction({
      actionId: action.actionId, ...bound,
      execute: storedAction => runPendingAction({ action: storedAction, overrides, deps }),
    })
    if (result?.reloadTodos) onTodoUpdated?.()
    if (result?.reloadNotes) {
      await deps.loadNotes?.()
      notifyAINotesUpdated(result.finalAction)
    }
  }, [bindConversation, deps, onTodoUpdated])

  const dismiss = useCallback((action) => {
    const bound = bindConversation()
    if (!bound || !action?.actionId) return
    if (dismissConversationAction({ actionId: action.actionId, ...bound })) {
      // 同时丢弃后端暂存的动作，避免之后被文字确认或重建执行
      window.electronAPI?.ai?.consumePendingAction?.(action.actionId)?.catch?.(() => {})
    }
  }, [bindConversation])

  return useMemo(() => ({ execute, dismiss }), [execute, dismiss])
}
