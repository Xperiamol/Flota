import { useCallback, useEffect, useRef } from 'react'
import { getAppSettingsSnapshot } from '../utils/aiCore/appSettings'
import { aiLog } from '../utils/logger'

const createRequestId = (prefix = 'ai') => (
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
)

// 每个请求独立保存监听器与取消状态。旧请求的 finally 不能清掉新会话的监听器。
export const useAIStream = () => {
  const requestsRef = useRef(new Map())
  const activeRequestIdRef = useRef(null)

  const cancel = useCallback(async (conversationId) => {
    const requestId = conversationId == null ? activeRequestIdRef.current
      : [...requestsRef.current].find(([, request]) => request.conversationId === conversationId)?.[0]
    const request = requestsRef.current.get(requestId)
    if (!request) return
    request.cancelledByUser = true
    request.cancelPreparation?.()
    aiLog.info('stream.cancel', { requestId })
    if (request.started) {
      try { await window.electronAPI?.ai?.cancelStream?.(requestId) } catch (_) {}
    }
  }, [])

  const runStream = useCallback(async ({
    conversationId = null, messages, contextPackage, requestPrefix = 'ai', options = {},
    onContent, onChunk, onChunkError, prepareContext,
  }) => {
    const requestId = createRequestId(requestPrefix)
    const request = { conversationId, cancelledByUser: false, cleanup: null }
    requestsRef.current.set(requestId, request)
    activeRequestIdRef.current = requestId
    const startedAt = Date.now()
    aiLog.info('stream.start', { requestId, conversationId, scene: options?.scene || null })
    let content = ''
    request.cleanup = window.electronAPI?.ai?.onChatChunk?.((chunk) => {
      if (!chunk || chunk.requestId !== requestId) return
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
      let resolvedContext = contextPackage
      if (prepareContext) {
        const cancelled = new Promise(resolve => { request.cancelPreparation = () => resolve(null) })
        resolvedContext = await Promise.race([prepareContext(), cancelled])
      }
      if (request.cancelledByUser) return { result: { cancelled: true }, content, requestId, contextPackage: {}, cancelledByUser: true }
      resolvedContext = { ...resolvedContext, appSettings: getAppSettingsSnapshot() }
      request.started = true
      const result = await window.electronAPI?.ai?.chatStream?.(messages, {
        ...options, requestId, conversationId, contextPackage: resolvedContext,
      })
      aiLog.info('stream.done', { requestId, conversationId, success: result?.success, cancelled: result?.cancelled, durationMs: Date.now() - startedAt })
      return { result, content, requestId, contextPackage: resolvedContext, cancelledByUser: request.cancelledByUser }
    } catch (error) {
      aiLog.error('stream.failed', { requestId, conversationId, error: error?.message })
      throw error
    } finally {
      request.cleanup?.()
      requestsRef.current.delete(requestId)
      if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null
    }
  }, [])

  useEffect(() => () => {
    for (const request of requestsRef.current.values()) request.cleanup?.()
  }, [])

  return { runStream, cancel }
}

export default useAIStream
