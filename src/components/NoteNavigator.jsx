import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  IconButton,
  TextField,
  Tooltip,
  Typography,
  alpha
} from '@mui/material'
import {
  Close as CloseIcon,
  DragIndicator as DragIcon,
  Explore as NavIcon,
  Search as SearchIcon,
  Article as NoteIcon,
  Subject as OutlineIcon,
  History as RecentIcon
} from '@mui/icons-material'
import FloatingGlassSurface from './FloatingGlassSurface'
import useDraggableFloatingPanel from '../hooks/useDraggableFloatingPanel'

const PANEL_WIDTH = 360
const PANEL_BOTTOM_OFFSET = 24
const PANEL_RIGHT_OFFSET = 24
const PANEL_ESTIMATED_HEIGHT = 460
const PANEL_MARGIN = 12

const getDefaultPosition = () => ({
  x: Math.max(PANEL_MARGIN, window.innerWidth - PANEL_WIDTH - PANEL_RIGHT_OFFSET),
  y: Math.max(PANEL_MARGIN, window.innerHeight - PANEL_ESTIMATED_HEIGHT - PANEL_BOTTOM_OFFSET)
})

// 从 markdown 文本提取一级到三级标题作为大纲
const extractHeadings = (markdown) => {
  if (!markdown || typeof markdown !== 'string') return []
  const headings = []
  const lines = markdown.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      const level = m[1].length
      const text = m[2].trim()
      if (text) headings.push({ level, text, lineIndex: i })
    }
  }
  return headings
}

const NoteNavigator = ({
  open,
  onClose,
  portalContainer,
  notes,
  selectedNoteId,
  onSelectNote,
  noteContent,
  noteContainerRef,
  positionPersistKey = 'flota.noteNavigator.position'
}) => {
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const [position, setPosition] = useState(null)
  const [keyword, setKeyword] = useState('')

  const { dragging, handleDragStart, restorePosition } = useDraggableFloatingPanel({
    panelRef,
    position,
    setPosition,
    margin: PANEL_MARGIN,
    estimatedWidth: PANEL_WIDTH,
    estimatedHeight: PANEL_ESTIMATED_HEIGHT,
    persistKey: positionPersistKey
  })

  useEffect(() => {
    if (!open) return
    setPosition((prev) => prev || restorePosition(getDefaultPosition()))
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [open, restorePosition])

  useEffect(() => {
    if (!open) setKeyword('')
  }, [open])

  const headings = useMemo(() => extractHeadings(noteContent || ''), [noteContent])

  const filteredHeadings = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return headings
    return headings.filter((h) => h.text.toLowerCase().includes(kw))
  }, [headings, keyword])

  const recentNotes = useMemo(() => {
    if (!Array.isArray(notes)) return []
    const list = notes
      .filter((n) => n && (n.note_type || 'markdown') !== 'whiteboard')
      .filter((n) => String(n.id) !== String(selectedNoteId))
      .slice()
      .sort((a, b) => {
        const at = a.updated_at || a.created_at || ''
        const bt = b.updated_at || b.created_at || ''
        return bt.localeCompare(at)
      })
    const kw = keyword.trim().toLowerCase()
    const filtered = kw
      ? list.filter((n) => (n.title || '').toLowerCase().includes(kw))
      : list
    return filtered.slice(0, 8)
  }, [notes, selectedNoteId, keyword])

  // 跳转到指定标题：在编辑器容器内根据顺序匹配 h1~h6
  const jumpToHeading = useCallback((heading) => {
    if (!heading) return
    // 优先在编辑器容器内查找；退化时找全屏元素或 ProseMirror 根
    let containerEl = noteContainerRef?.current || null
    if (!containerEl || containerEl === document.body) {
      containerEl = document.querySelector('[data-flota-note-editor="true"]')
        || document.querySelector('.ProseMirror')
        || document.body
    }
    if (!containerEl) return
    const allHeads = containerEl.querySelectorAll('h1, h2, h3, h4, h5, h6')
    if (!allHeads.length) return

    const myIndex = headings.indexOf(heading)
    let sameLevelBefore = 0
    for (let i = 0; i <= myIndex; i += 1) {
      if (headings[i].level === heading.level) sameLevelBefore += 1
    }

    let counter = 0
    let target = null
    for (const el of allHeads) {
      const tag = el.tagName.toLowerCase()
      const lv = Number(tag.slice(1))
      if (lv === heading.level) {
        counter += 1
        if (counter === sameLevelBefore) {
          target = el
          break
        }
      }
    }
    // 兜底：按文本匹配
    if (!target) {
      for (const el of allHeads) {
        if ((el.textContent || '').trim() === heading.text) {
          target = el
          break
        }
      }
    }
    if (target) {
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        target.classList.add('flota-nav-flash')
        window.setTimeout(() => target.classList.remove('flota-nav-flash'), 1200)
      } catch (_) {
        target.scrollIntoView()
      }
    }
  }, [headings, noteContainerRef])

  const handlePickNote = useCallback((noteId) => {
    if (typeof onSelectNote === 'function') onSelectNote(noteId)
    onClose?.()
  }, [onSelectNote, onClose])

  const resolvedPosition = position || getDefaultPosition()

  return (
    <FloatingGlassSurface
      ref={panelRef}
      open={open}
      layer="aiPanel"
      ariaLabel="笔记导航"
      position={resolvedPosition}
      width={PANEL_WIDTH}
      maxWidth={`calc(100vw - ${PANEL_RIGHT_OFFSET * 2}px)`}
      maxHeight={`min(540px, calc(100vh - ${PANEL_BOTTOM_OFFSET * 2}px))`}
      portalContainer={portalContainer}
      sx={{ display: 'flex', flexDirection: 'column' }}
    >
      <Box
        onMouseDown={handleDragStart}
        sx={(theme) => ({
          px: 1.5,
          py: 0.75,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          boxShadow: `inset 0 -1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.36)}`,
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.09 : 0.1)
        })}
      >
        <DragIcon sx={{ fontSize: 15, color: 'text.disabled', opacity: 0.55 }} />
        <NavIcon sx={{ fontSize: 16, color: 'primary.main' }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>笔记导航</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="关闭">
          <IconButton
            size="small"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label="关闭"
            sx={(theme) => ({
              width: 26,
              height: 26,
              borderRadius: 1,
              color: 'text.secondary',
              '&:hover': {
                color: 'text.primary',
                bgcolor: alpha(theme.palette.text.primary, 0.06)
              }
            })}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ px: 1.25, pt: 1, pb: 0.75 }}>
        <TextField
          inputRef={inputRef}
          size="small"
          fullWidth
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索大纲或最近笔记…"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose?.()
            }
          }}
          slotProps={{
            input: {
              startAdornment: <SearchIcon sx={{ fontSize: 16, mr: 0.75, color: 'text.disabled' }} />
            }
          }}
          sx={(theme) => ({
            '& .MuiInputBase-root': {
              fontSize: 13,
              borderRadius: 1.25,
              bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.04 : 0.04)
            }
          })}
        />
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, pt: 0.5, pb: 0.5 }}>
          <OutlineIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          <Typography sx={{ fontSize: 11, color: 'text.disabled', letterSpacing: 0.5 }}>
            大纲（{filteredHeadings.length}）
          </Typography>
        </Box>
        {filteredHeadings.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: 'text.disabled', px: 1, py: 0.75 }}>
            {headings.length === 0 ? '当前笔记没有标题' : '没有匹配的标题'}
          </Typography>
        ) : (
          filteredHeadings.map((h) => (
            <Box
              key={`${h.lineIndex}-${h.level}-${h.text}`}
              onClick={() => jumpToHeading(h)}
              sx={(theme) => ({
                pl: 0.75 + (h.level - 1) * 1.25,
                pr: 1,
                py: 0.5,
                fontSize: h.level === 1 ? 13 : 12.5,
                fontWeight: h.level <= 2 ? 600 : 500,
                color: h.level === 1 ? 'text.primary' : 'text.secondary',
                borderRadius: 1,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.08),
                  color: 'primary.main'
                }
              })}
            >
              {h.text}
            </Box>
          ))
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, pt: 1.25, pb: 0.5 }}>
          <RecentIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          <Typography sx={{ fontSize: 11, color: 'text.disabled', letterSpacing: 0.5 }}>
            最近笔记
          </Typography>
        </Box>
        {recentNotes.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: 'text.disabled', px: 1, py: 0.75 }}>
            没有可切换的笔记
          </Typography>
        ) : (
          recentNotes.map((n) => (
            <Box
              key={n.id}
              onClick={() => handlePickNote(n.id)}
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 0.75,
                py: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.08),
                  color: 'primary.main'
                }
              })}
            >
              <NoteIcon sx={{ fontSize: 14, flexShrink: 0 }} />
              <Typography sx={{
                fontSize: 12.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1
              }}>
                {n.title || '未命名'}
              </Typography>
            </Box>
          ))
        )}
      </Box>
    </FloatingGlassSurface>
  )
}

export default NoteNavigator
