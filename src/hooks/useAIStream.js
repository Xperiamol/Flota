import { useCallback, useEffect, useRef } from 'react'

const createRequestId = (prefix = 'ai') => (
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
)

export const useAIStream = () => {
  const activeRequestIdRef = useRef(null)
  const chunkListenerRef = useRef(null)

  const cleanupListener = useCallback(() => {
    if (chunkListenerRef.current) {
      chunkListenerRef.current()
      chunkListenerRef.current = null
    }
  }, [])

  const cancel = useCallback(async () => {
    const requestId = activeRequestIdRef.current
    if (!requestId) return
    try {
      await window.electronAPI?.ai?.cancelStream?.(requestId)
    } catch (_) {
      // cancel failures should not block UI state
    }
  }, [])

  const runStream = useCallback(async ({
    messages,
    contextPackage,
    requestPrefix = 'ai',
    options = {},
    onContent,
    onChunkError
  }) => {
    cleanupListener()
    const requestId = createRequestId(requestPrefix)
    activeRequestIdRef.current = requestId

    let content = ''
    chunkListenerRef.current = window.electronAPI?.ai?.onChatChunk?.((chunk) => {
      if (!chunk || chunk.requestId !== activeRequestIdRef.current) return

      if (chunk.type === 'content') {
        content += chunk.content
        onContent?.(content, chunk)
      } else if (chunk.type === 'error') {
        onChunkError?.(chunk)
      }
    })

    try {
      const result = await window.electronAPI?.ai?.chatStream?.(messages, {
        requestId,
        contextPackage,
        ...options
      })
      return { result, content, requestId }
    } finally {
      cleanupListener()
      activeRequestIdRef.current = null
    }
  }, [cleanupListener])

  useEffect(() => cleanupListener, [cleanupListener])

  return {
    runStream,
    cancel
  }
}

export default useAIStream
