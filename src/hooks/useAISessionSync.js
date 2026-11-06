import { useEffect } from 'react'
import { useStore } from '../store/useStore'

/**
 * 把主进程持有的 AI 会话同步进本窗口的 store。主窗口和独立笔记窗口各挂一次。
 *
 * - ai:session-conversation：会话内容变化（新消息、确认卡状态、自动记忆……）
 * - ai:session-stream：生成中的草稿；draft 为 null 表示这一轮结束
 * 窗口刚打开时先拉一次正在生成的会话，避免错过已经开始的回复。
 */
export const useAISessionSync = ({ loadConversations = false } = {}) => {
  useEffect(() => {
    const session = window.electronAPI?.ai?.session
    if (!session) return undefined
    const { aiApplyConversation, aiSetStream } = useStore.getState()
    if (loadConversations) useStore.getState().loadAiConversations?.()

    const offConversation = session.onConversation?.(({ conversation }) => aiApplyConversation(conversation))
    const offStream = session.onStream?.(({ conversationId, requestId, draft }) => {
      aiSetStream(conversationId, draft ? { requestId, draft } : null)
    })
    session.activeStreams?.().then((result) => {
      for (const stream of result?.data || []) aiSetStream(stream.conversationId, { requestId: stream.requestId, draft: stream.draft })
    }).catch(() => {})

    return () => {
      offConversation?.()
      offStream?.()
    }
  }, [loadConversations])
}

export default useAISessionSync
