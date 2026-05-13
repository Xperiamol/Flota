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
    dragStateRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    }
    setDragging(true)
    setPosition({ x: rect.left, y: rect.top })
  }, [panelRef, setPosition])

  useEffect(() => {
    if (!dragging) return undefined

    const handleMove = (event) => {
      const state = dragStateRef.current
      if (!state) return
      setPosition(clampPosition(event.clientX - state.offsetX, event.clientY - state.offsetY))
    }

    const handleUp = () => {
      dragStateRef.current = null
      setDragging(false)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [clampPosition, dragging, setPosition])

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
