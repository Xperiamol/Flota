import { useCallback, useEffect, useRef, useState } from 'react'

const readStoredPosition = (key) => {
  if (!key || typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null')
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return parsed
  } catch (_) {
    // ignore invalid stored position
  }
  return null
}

const writeStoredPosition = (key, position) => {
  if (!key || typeof window === 'undefined' || !position) return
  try {
    window.localStorage.setItem(key, JSON.stringify(position))
  } catch (_) {
    // ignore storage failures
  }
}

export const useDraggableFloatingPanel = ({
  panelRef,
  position,
  setPosition,
  margin = 12,
  estimatedWidth = 320,
  estimatedHeight = 240,
  persistKey
}) => {
  const dragStateRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const clampPosition = useCallback((nextX, nextY) => {
    const panelRect = panelRef.current?.getBoundingClientRect()
    const width = panelRect?.width || estimatedWidth
    const height = panelRect?.height || estimatedHeight
    const maxX = Math.max(margin, window.innerWidth - width - margin)
    const maxY = Math.max(margin, window.innerHeight - height - margin)
    return {
      x: Math.min(Math.max(margin, nextX), maxX),
      y: Math.min(Math.max(margin, nextY), maxY)
    }
  }, [estimatedHeight, estimatedWidth, margin, panelRef])

  const restorePosition = useCallback((fallback) => {
    const stored = readStoredPosition(persistKey)
    const next = stored || fallback
    return clampPosition(next.x, next.y)
  }, [clampPosition, persistKey])

  const handleDragStart = useCallback((event) => {
    if (event.button !== 0) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    // 尺寸在按下时量一次，拖动中不再读布局
    dragStateRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      next: { x: rect.left, y: rect.top },
      frame: null
    }
    setDragging(true)
    setPosition({ x: rect.left, y: rect.top })
  }, [panelRef, setPosition])

  // 拖动中每帧直接改面板的 left/top，松手才写回 state：
  // 每次 mousemove 都 setPosition 会让整个面板（AI 小窗含整段对话）跟着重渲染。
  useEffect(() => {
    if (!dragging) return undefined

    const handleMove = (event) => {
      const state = dragStateRef.current
      if (!state) return
      const maxX = Math.max(margin, window.innerWidth - state.width - margin)
      const maxY = Math.max(margin, window.innerHeight - state.height - margin)
      state.next = {
        x: Math.min(Math.max(margin, event.clientX - state.offsetX), maxX),
        y: Math.min(Math.max(margin, event.clientY - state.offsetY), maxY)
      }
      if (state.frame) return
      state.frame = window.requestAnimationFrame(() => {
        state.frame = null
        const panel = panelRef.current
        if (!panel) return
        panel.style.left = `${state.next.x}px`
        panel.style.top = `${state.next.y}px`
      })
    }

    const handleUp = () => {
      const state = dragStateRef.current
      dragStateRef.current = null
      if (state) {
        if (state.frame) window.cancelAnimationFrame(state.frame)
        // 先落到 DOM：最终位置若与按下时相同，React 不会重写样式
        const panel = panelRef.current
        if (panel) {
          panel.style.left = `${state.next.x}px`
          panel.style.top = `${state.next.y}px`
        }
        setPosition(state.next)
      }
      setDragging(false)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      const state = dragStateRef.current
      if (state?.frame) window.cancelAnimationFrame(state.frame)
    }
  }, [dragging, margin, panelRef, setPosition])

  useEffect(() => {
    if (!position) return
    writeStoredPosition(persistKey, clampPosition(position.x, position.y))
  }, [clampPosition, persistKey, position])

  useEffect(() => {
    if (!position) return undefined
    const handleResize = () => {
      setPosition(prev => prev ? clampPosition(prev.x, prev.y) : prev)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampPosition, position, setPosition])

  return {
    dragging,
    handleDragStart,
    clampPosition,
    restorePosition
  }
}

export default useDraggableFloatingPanel
