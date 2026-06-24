import { useCallback, useEffect, useRef } from 'react'
import { aiLog } from '../utils/logger'

const createRequestId = (prefix = 'ai') => (
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
)

/**
 * 统一的 AI 流式请求生命周期：负责 requestId、取消、chunk 监听注册/清理、错误归一化。
 * 两个入口（AIChatView 功能页 / AICommandCenter 浮窗）共用同一套逻辑，避免各写一份流式代码。
 * 切会话保护由调用方用 conversationId 自行判断 isActiveView（哪个对话当前可见），
 * 本 hook 负责保证陈旧请求的 chunk 按 requestId 过滤掉，不会串台。
 */
export const useAIStream = () => {
  const activeRequestIdRef = useRef(null)
  const chunkListenerRef = useRef(null)
  const cancelRequestedRef = useRef(false)

  const cleanupListener = useCallback(() => {
    if (chunkListenerRef.current) {
      chunkListenerRef.current()
      chunkListenerRef.current = null
    }
  }, [])

  const cancel = useCallback(async () => {
    const requestId = activeRequestIdRef.current
    if (!requestId) return
    cancelRequestedRef.current = true
    aiLog.info('stream.cancel', { requestId })
    try {
      await window.electronAPI?.ai?.cancelStream?.(requestId)
    } catch (_) {
      // cancel failures should not block UI state
    }
  }, [])

  const runStream = useCallback(async ({
    conversationId = null,
    messages,
    contextPackage,
    requestPrefix = 'ai',
    options = {},
    onContent,
    onChunk,
    onChunkError
  }) => {
    cleanupListener()
    const requestId = createRequestId(requestPrefix)
    activeRequestIdRef.current = requestId
    cancelRequestedRef.current = false
    const startedAt = Date.now()
    aiLog.info('stream.start', { requestId, conversationId, scene: options?.scene || null })

    let content = ''
    chunkListenerRef.current = window.electronAPI?.ai?.onChatChunk?.((chunk) => {
      if (!chunk || chunk.requestId !== activeRequestIdRef.current) return
      onChunk?.(chunk)

      if (chunk.type === 'content') {
        content += chunk.content
        onContent?.(content, chunk)
      } else if (chunk.type === 'error') {
        aiLog.warn('stream.chunkError', { requestId, conversationId, error: chunk.content })
        onChunkError?.(chunk)
      }
    })

    try {
      const result = await window.electronAPI?.ai?.chatStream?.(messages, {
        requestId,
        conversationId,
        contextPackage,
        ...options
      })
      aiLog.info('stream.done', {
        requestId,
        conversationId,
        success: result?.success,
        cancelled: result?.cancelled || cancelRequestedRef.current,
        durationMs: Date.now() - startedAt,
      })
      return {
        result,
        content,
        requestId,
        cancelledByUser: cancelRequestedRef.current
      }
    } catch (error) {
      aiLog.error('stream.failed', { requestId, conversationId, error: error?.message })
      throw error
    } finally {
      cleanupListener()
      activeRequestIdRef.current = null
      cancelRequestedRef.current = false
    }
  }, [cleanupListener])

  useEffect(() => cleanupListener, [cleanupListener])

  return {
    runStream,
    cancel
  }
}

export default useAIStream
