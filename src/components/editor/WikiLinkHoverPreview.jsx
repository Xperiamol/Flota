import { useEffect, useRef, useState } from 'react'
import { Box, Typography, Stack, Portal } from '@mui/material'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import { useStore } from '../../store/useStore'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import { floatingGlassSx } from '../../utils/floatingGlassSx'
import { getWhiteboardPreviewUrl } from '../../utils/whiteboardPreview'

const HOVER_OPEN_DELAY = 280
const HOVER_CLOSE_DELAY = 180
const PREVIEW_WIDTH = 360
const PREVIEW_MAX_HEIGHT = 220

// 在内容里截取章节区段（标题文本不区分大小写匹配）
const sliceSection = (content, section) => {
  if (!content || !section) return content || ''
  const lines = content.split('\n')
  const want = section.toLowerCase().trim()
  let startIdx = -1
  let startLevel = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (m && m[2].trim().toLowerCase() === want) {
      startIdx = i
      startLevel = m[1].length
      break
    }
  }
  if (startIdx < 0) return ''
  // 截到下一个同级或更高级标题
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= startLevel) { endIdx = i; break }
  }
  return lines.slice(startIdx, endIdx).join('\n')
}

// 取一个用于 preview 的精简文本
const buildPreview = (content, section) => {
  let raw = section ? sliceSection(content || '', section) : (content || '')
  if (!raw) return ''
  // 去掉 frontmatter
  if (/^---\s*\n/.test(raw)) {
    const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n/)
    if (m) raw = raw.slice(m[0].length)
  }
  // 去除多余空白
  return String(raw).slice(0, 1200)
}

const WikiLinkHoverPreview = () => {
  const notes = useStore((s) => s.notes)
  const setSelectedNoteId = useStore((s) => s.setSelectedNoteId)
  const [state, setState] = useState({ open: false })
  const [whiteboardPreviewFailed, setWhiteboardPreviewFailed] = useState(false)
  const openTimerRef = useRef(0)
  const closeTimerRef = useRef(0)
  const lastTriggerRef = useRef(null)

  // notes 用 ref，避免 hover handler 因 notes 引用变化反复重挂
  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])

  const cancelOpen = () => { if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = 0 } }
  const cancelClose = () => { if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = 0 } }

  useEffect(() => {
    const onOver = (e) => {
      const el = e.target?.closest?.('a[data-wiki-target]')
      if (!el) return
      // 与右键菜单 / [[ 自动补全互斥：这两类浮窗已存在时不再弹 hover 预览
      if (
        document.querySelector('[data-editor-context-menu]') ||
        document.querySelector('[data-wiki-suggestion-popup]')
      ) {
        return
      }
      // 已为同一元素打开 / 已在排队，不重复触发
      if (lastTriggerRef.current === el) {
        cancelClose()
        return
      }
      cancelOpen()
      cancelClose()
      const target = el.getAttribute('data-wiki-target') || ''
      const section = el.getAttribute('data-wiki-section') || ''
      if (!target) return
      const rect = el.getBoundingClientRect()
      const anchor = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, centerX: rect.left + rect.width / 2 }
      openTimerRef.current = setTimeout(() => {
        const list = notesRef.current || []
        const lower = target.toLowerCase()
        const note = list.find((n) => (n.title || '').toLowerCase() === lower)
        if (!note) {
          setState({
            open: true,
            anchor,
            title: target,
            preview: '',
            notFound: true,
          })
        } else {
          const preview = buildPreview(note.content || '', section)
          setState({
            open: true,
            anchor,
            title: note.title || target,
            section,
            preview,
            noteId: note.id,
            notFound: false,
            isWhiteboard: note.note_type === 'whiteboard',
            whiteboardPreviewUrl: note.note_type === 'whiteboard' ? getWhiteboardPreviewUrl(note) : '',
          })
        }
        lastTriggerRef.current = el
      }, HOVER_OPEN_DELAY)
    }

    const onOut = (e) => {
      const el = e.target?.closest?.('a[data-wiki-target]')
      if (!el) return
      // 鼠标进入预览卡时不要关
      const next = e.relatedTarget
      if (next && next.closest?.('[data-wiki-hover-card]')) return
      cancelOpen()
      cancelClose()
      closeTimerRef.current = setTimeout(() => {
        lastTriggerRef.current = null
        setState({ open: false })
      }, HOVER_CLOSE_DELAY)
    }

    const closeImmediately = () => {
      cancelOpen()
      cancelClose()
      lastTriggerRef.current = null
      setState({ open: false })
    }

    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mouseout', onOut, true)
    document.addEventListener('contextmenu', closeImmediately, true)
    return () => {
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mouseout', onOut, true)
      document.removeEventListener('contextmenu', closeImmediately, true)
      cancelOpen()
      cancelClose()
    }
  }, [])

  useEffect(() => {
    setWhiteboardPreviewFailed(false)
  }, [state.noteId, state.whiteboardPreviewUrl])

  if (!state.open) return null

  const { anchor, title, section, preview, notFound, noteId, isWhiteboard, whiteboardPreviewUrl } = state
  // 以双链中心为锚点：popup 中心对齐 anchor.centerX；下方放不下则翻到上方
  const margin = 8
  const idealLeft = (anchor?.centerX ?? 0) - PREVIEW_WIDTH / 2
  const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - PREVIEW_WIDTH - margin))
  let top = (anchor?.bottom ?? 0) + 6
  if (top + PREVIEW_MAX_HEIGHT > window.innerHeight - margin) {
    const above = (anchor?.top ?? 0) - 6 - PREVIEW_MAX_HEIGHT
    if (above >= margin) top = above
    else top = Math.max(margin, window.innerHeight - PREVIEW_MAX_HEIGHT - margin)
  }

  return (
    <Portal>
      <Box
        data-wiki-hover-card
        onMouseEnter={() => { cancelClose() }}
        onMouseLeave={() => {
          cancelClose()
          closeTimerRef.current = setTimeout(() => {
            lastTriggerRef.current = null
            setState({ open: false })
          }, HOVER_CLOSE_DELAY)
        }}
        onClick={() => {
          if (noteId) setSelectedNoteId(noteId)
          setState({ open: false })
          lastTriggerRef.current = null
        }}
        sx={{
          position: 'fixed',
          zIndex: 2000,
          left,
          top,
          width: PREVIEW_WIDTH,
          maxHeight: PREVIEW_MAX_HEIGHT,
          overflow: 'hidden',
          cursor: noteId ? 'pointer' : 'default',
          ...floatingGlassSx({ radius: '14px', shadow: 'menu' }),
        }}
      >
        <Box sx={{ px: 1.25, py: 0.85, display: 'flex', alignItems: 'center', gap: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <DescriptionOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 700 }}>
              {title || '(无标题)'}
              {section ? <Typography component="span" sx={{ fontSize: 11, color: 'text.disabled', ml: 0.5 }}>#{section}</Typography> : null}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ px: 1.25, py: 1, fontSize: 12, lineHeight: 1.55, color: 'text.secondary', maxHeight: PREVIEW_MAX_HEIGHT - 38, overflow: 'auto' }}>
          {notFound ? (
            <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic' }}>
              笔记不存在 · 点击此双链将创建
            </Typography>
          ) : isWhiteboard ? (
            whiteboardPreviewUrl && !whiteboardPreviewFailed ? (
              <Box
                sx={{
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Box
                  component="img"
                  src={whiteboardPreviewUrl}
                  alt="白板缩略预览"
                  onError={() => setWhiteboardPreviewFailed(true)}
                  sx={{
                    width: '100%',
                    maxHeight: PREVIEW_MAX_HEIGHT - 58,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </Box>
            ) : (
              <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic' }}>
                白板内容暂时无法预览
              </Typography>
            )
          ) : !preview ? (
            <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic' }}>
              （空内容）
            </Typography>
          ) : (
            <Stack spacing={0.4}>
              {preview.split('\n').slice(0, 18).map((line, i) => {
                const t = line.trim()
                if (!t) return <Box key={i} sx={{ height: 4 }} />
                const heading = t.match(/^(#{1,6})\s+(.*)$/)
                if (heading) {
                  return (
                    <Typography key={i} sx={{
                      fontSize: heading[1].length <= 2 ? 12.5 : 12,
                      fontWeight: 700,
                      color: 'text.primary',
                    }}>
                      {heading[2]}
                    </Typography>
                  )
                }
                const display = (() => {
                  try { return stripMarkdownToPreviewText(t) } catch { return t }
                })()
                return (
                  <Typography key={i} noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {display}
                  </Typography>
                )
              })}
            </Stack>
          )}
        </Box>
      </Box>
    </Portal>
  )
}

export default WikiLinkHoverPreview
