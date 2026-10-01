import { useCallback, useEffect } from 'react'
import { useStore } from '../store/useStore'

// 自动记忆在回复结束后才完成，通知到达时这条回复可能还没写进会话（极少见），稍后重试几次
const ATTACH_RETRIES = 10
const ATTACH_INTERVAL_MS = 800

const patchMessage = (conversationId, requestId, patch) => {
  const { aiConversations, aiUpdateConv } = useStore.getState()
  const conv = aiConversations.find((c) => c.id === conversationId)
  if (!conv) return 'gone'
  const index = (conv.messages || []).findIndex((m) => m.role === 'assistant' && m.metadata?.requestId === requestId)
  if (index === -1) return 'missing'
  const messages = conv.messages.map((m, i) => (i === index ? patch(m) : m))
  aiUpdateConv(conversationId, { messages })
  return 'ok'
}

/**
 * 在应用根部挂一次：把后端的「记忆已更新」通知写到对应回复的 memoryUpdates 上（随会话持久化）。
 * 两个对话入口都从会话 store 同步消息，所以这里改 store 即可。
 */
export const useAutoMemoryNotices = () => {
  useEffect(() => {
    const off = window.electronAPI?.mem0?.onAutoUpdated?.(({ requestId, conversationId, changes }) => {
      if (!requestId || !conversationId || !Array.isArray(changes) || changes.length === 0) return
      let tries = 0
      const attach = () => {
        const result = patchMessage(conversationId, requestId, (m) => ({ ...m, memoryUpdates: { changes, reverted: false } }))
        if (result === 'missing' && ++tries < ATTACH_RETRIES) setTimeout(attach, ATTACH_INTERVAL_MS)
      }
      attach()
    })
    return () => off?.()
  }, [])
}

/**
 * 撤销某条回复上的自动记忆变更
 */
export const useUndoMemoryUpdate = () => useCallback(async (conversationId, msg) => {
  const changes = msg?.memoryUpdates?.changes
  if (!conversationId || !Array.isArray(changes)) return
  const result = await window.electronAPI?.mem0?.revertChanges?.({ changes })
  if (!result?.success) throw new Error(result?.error || '撤销失败')
  patchMessage(conversationId, msg.metadata?.requestId, (m) => ({ ...m, memoryUpdates: { ...m.memoryUpdates, reverted: true } }))
}, [])
