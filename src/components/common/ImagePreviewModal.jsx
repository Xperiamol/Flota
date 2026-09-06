import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Fade, IconButton, Modal, Typography } from '@mui/material'
import { Close as CloseIcon } from './AppIcons'
import { ZoomIn as ZoomInIcon } from './AppIcons'
import { ZoomOut as ZoomOutIcon } from './AppIcons'

const clampImageZoom = (value) => Math.min(3, Math.max(0.5, Math.round(value * 100) / 100))

const getTouchDistance = (touches) => {
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.hypot(dx, dy)
}

const getTouchCenter = (touches) => ({
  x: (touches[0].clientX + touches[1].clientX) / 2,
  y: (touches[0].clientY + touches[1].clientY) / 2,
})

export const canvasToPngBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('图片转换失败'))
  }, 'image/png')
})

const ImagePreviewModal = ({ src, alt = '预览', onClose }) => {
  const [visible, setVisible] = useState(Boolean(src))
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const modalRef = useRef(null)
  const touchStateRef = useRef(null)
  const suppressNextClickRef = useRef(false)
  const suppressClickTimerRef = useRef(null)
  const zoomRef = useRef(zoom)
  const gestureStartZoomRef = useRef(zoom)

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  const suppressNextClick = useCallback((delay = 120) => {
    suppressNextClickRef.current = true
    if (suppressClickTimerRef.current) {
      window.clearTimeout(suppressClickTimerRef.current)
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false
      suppressClickTimerRef.current = null
    }, delay)
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPosition({ x: 0, y: 0 })
    setDragging(false)
  }, [])

  useEffect(() => {
    setVisible(Boolean(src))
    resetView()
  }, [src, resetView])

  useEffect(() => {
    if (zoom > 1) return
    setPosition({ x: 0, y: 0 })
    setDragging(false)
  }, [zoom])

  const zoomBy = useCallback((delta) => {
    setZoom((prev) => clampImageZoom(prev + delta))
  }, [])

  const handleWheel = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()

    if (event.ctrlKey || event.metaKey) {
      suppressNextClick()
      const speed = Math.abs(event.deltaY) > 50 ? 0.002 : 0.01
      setZoom((prev) => clampImageZoom(prev * Math.exp(-event.deltaY * speed)))
      return
    }

    suppressNextClick()
    setZoom((prev) => clampImageZoom(prev * Math.exp(-event.deltaY * 0.0018)))
  }, [suppressNextClick])

  useEffect(() => {
    if (!src) return undefined
    const handleGestureStart = (event) => {
      event.preventDefault()
      event.stopPropagation()
      gestureStartZoomRef.current = zoomRef.current
      suppressNextClick(200)
    }

    const handleGestureChange = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const scale = Number(event.scale) || 1
      setZoom(clampImageZoom(gestureStartZoomRef.current * scale))
      suppressNextClick(200)
    }

    const handleGestureEnd = (event) => {
      event.preventDefault()
      event.stopPropagation()
      suppressNextClick(200)
    }

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    window.addEventListener('gesturestart', handleGestureStart, { passive: false, capture: true })
    window.addEventListener('gesturechange', handleGestureChange, { passive: false, capture: true })
    window.addEventListener('gestureend', handleGestureEnd, { passive: false, capture: true })

    return () => {
      window.removeEventListener('wheel', handleWheel, true)
      window.removeEventListener('gesturestart', handleGestureStart, true)
      window.removeEventListener('gesturechange', handleGestureChange, true)
      window.removeEventListener('gestureend', handleGestureEnd, true)
    }
  }, [handleWheel, src, suppressNextClick])

  useEffect(() => () => {
    if (suppressClickTimerRef.current) {
      window.clearTimeout(suppressClickTimerRef.current)
    }
  }, [])

  const handleMouseDown = (event) => {
    if (zoom <= 1) return
    event.preventDefault()
    setDragging(true)
    setDragStart({
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    })
  }

  const handleMouseMove = (event) => {
    if (!dragging || zoom <= 1) return
    setPosition({
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y,
    })
  }

  const handleTouchStart = (event) => {
    event.stopPropagation()

    if (event.touches.length === 1) {
      const touch = event.touches[0]
      touchStateRef.current = {
        mode: 'pan',
        startX: touch.clientX,
        startY: touch.clientY,
        startPosition: position,
        moved: false,
      }
      setDragging(zoom > 1)
      return
    }

    if (event.touches.length === 2) {
      event.preventDefault()
      touchStateRef.current = {
        mode: 'pinch',
        startDistance: getTouchDistance(event.touches),
        startZoom: zoom,
        startPosition: position,
        startCenter: getTouchCenter(event.touches),
        moved: false,
      }
      setDragging(false)
    }
  }

  const handleTouchMove = (event) => {
    const state = touchStateRef.current
    if (!state) return

    if (state.mode === 'pan' && event.touches.length === 1) {
      if (zoom <= 1) return
      event.preventDefault()
      const touch = event.touches[0]
      const dx = touch.clientX - state.startX
      const dy = touch.clientY - state.startY
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) state.moved = true
      setPosition({
        x: state.startPosition.x + dx,
        y: state.startPosition.y + dy,
      })
      return
    }

    if (state.mode === 'pinch' && event.touches.length === 2) {
      event.preventDefault()
      const distance = getTouchDistance(event.touches)
      const center = getTouchCenter(event.touches)
      const nextZoom = clampImageZoom(state.startZoom * (distance / state.startDistance))

      state.moved = true
      setZoom(nextZoom)
      setPosition({
        x: state.startPosition.x + center.x - state.startCenter.x,
        y: state.startPosition.y + center.y - state.startCenter.y,
      })
    }
  }

  const handleTouchEnd = () => {
    const state = touchStateRef.current
    if (state?.moved || state?.mode === 'pinch') {
      suppressNextClick()
    }

    if (!state || state.mode !== 'pinch' || !state.moved) {
      setDragging(false)
    }
    touchStateRef.current = null
  }

  const close = () => {
    setVisible(false)
  }

  if (!src) return null

  return (
    <Modal
      open={visible}
      closeAfterTransition
      onClose={close}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Fade
        in={visible}
        timeout={160}
        onExited={() => {
          resetView()
          onClose?.()
        }}
      >
        <Box
          ref={modalRef}
          sx={{
            position: 'relative',
            width: '100vw',
            height: '100vh',
            outline: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
            touchAction: 'none',
          }}
          onClick={(event) => {
            if (suppressNextClickRef.current) {
              event.stopPropagation()
              return
            }
            close()
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
        >
          <Box
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              display: 'flex',
              gap: 1,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              borderRadius: 2,
              padding: '4px 8px',
              zIndex: 10,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton size="small" onClick={() => zoomBy(-0.25)} sx={{ color: 'white' }} title="缩小">
              <ZoomOutIcon />
            </IconButton>
            <Typography
              sx={{ color: 'white', lineHeight: '32px', minWidth: 60, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
              onClick={resetView}
              title="点击重置"
            >
              {Math.round(zoom * 100)}%
            </Typography>
            <IconButton size="small" onClick={() => zoomBy(0.25)} sx={{ color: 'white' }} title="放大">
              <ZoomInIcon />
            </IconButton>
            <IconButton size="small" onClick={close} sx={{ color: 'white' }} title="关闭 (Esc)">
              <CloseIcon />
            </IconButton>
          </Box>

          {zoom > 1 && (
            <Typography
              sx={{
                position: 'absolute',
                bottom: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                color: 'rgba(255, 255, 255, 0.7)',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                padding: '4px 12px',
                borderRadius: 2,
                fontSize: 12,
                zIndex: 10,
              }}
            >
              拖动查看 · 滚轮/双指缩放 · 点击背景关闭
            </Typography>
          )}

          <img
            src={src}
            alt={alt}
            draggable={false}
            style={{
              maxWidth: '95vw',
              maxHeight: '90vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              transformOrigin: 'center center',
              transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
              transition: dragging ? 'none' : 'transform 0.2s ease',
              borderRadius: '8px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
              userSelect: 'none',
              touchAction: 'none',
            }}
            onClick={(event) => {
              event.stopPropagation()
              if (suppressNextClickRef.current) return
              if (zoom <= 1) setZoom(2)
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              if (zoom > 1) resetView()
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          />
        </Box>
      </Fade>
    </Modal>
  )
}

export default ImagePreviewModal
