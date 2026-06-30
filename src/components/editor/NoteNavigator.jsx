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
  Subject as OutlineIcon,
  BookmarkBorder as BookmarkIcon,
  TextSnippet as ContentIcon,
  Add as AddIcon,
  DeleteOutline as DeleteIcon,
  KeyboardArrowUp as PrevIcon,
  KeyboardArrowDown as NextIcon
} from '@mui/icons-material'
import FloatingGlassSurface from '../common/FloatingGlassSurface'
import useDraggableFloatingPanel from '../../hooks/useDraggableFloatingPanel'
import { useBookmarks } from '../../store/useBookmarks'

const PANEL_WIDTH = 360
const PANEL_BOTTOM_OFFSET = 24
const PANEL_RIGHT_OFFSET = 24
const PANEL_ESTIMATED_HEIGHT = 460
const PANEL_MARGIN = 12

const ANCHOR_SNIPPET_LEN = 80
const SNIPPET_RADIUS = 28
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td'

const HIGHLIGHT_NAME = 'flota-note-search'
const HIGHLIGHT_ACTIVE_NAME = 'flota-note-search-active'
const supportsHighlightApi = typeof CSS !== 'undefined' && typeof window !== 'undefined' && 'highlights' in CSS

const getDefaultPosition = () => ({
  x: Math.max(PANEL_MARGIN, window.innerWidth - PANEL_WIDTH - PANEL_RIGHT_OFFSET),
  y: Math.max(PANEL_MARGIN, window.innerHeight - PANEL_ESTIMATED_HEIGHT - PANEL_BOTTOM_OFFSET)
})

const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// 从 markdown 文本提取一级到六级标题作为大纲
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

const clearHighlights = () => {
  if (!supportsHighlightApi) return
  try {
    CSS.highlights.delete(HIGHLIGHT_NAME)
    CSS.highlights.delete(HIGHLIGHT_ACTIVE_NAME)
  } catch (_) { /* ignore */ }
}

// 围绕匹配位置裁出片段（前/匹配/后），用于面板展示
const makeSnippet = (text, start, len) => {
  const safe = String(text || '')
  const head = safe.slice(Math.max(0, start - SNIPPET_RADIUS), start)
  const mid = safe.slice(start, start + len)
  const tail = safe.slice(start + len, start + len + SNIPPET_RADIUS)
  return {
    before: (start - SNIPPET_RADIUS > 0 ? '…' : '') + head,
    mid,
    after: tail + (start + len + SNIPPET_RADIUS < safe.length ? '…' : '')
  }
}

const NoteNavigator = ({
  open,
  onClose,
  portalContainer,
  noteId,
  noteContent,
  noteContainerRef,
  positionPersistKey = 'flota.noteNavigator.position'
}) => {
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const [position, setPosition] = useState(null)
  const [keyword, setKeyword] = useState('')

  const bookmarksMap = useBookmarks((s) => s.bookmarks)
  const addBookmark = useBookmarks((s) => s.addBookmark)
  const removeBookmark = useBookmarks((s) => s.removeBookmark)

  // 正文内容搜索：DOM 命中区间 + 片段列表 + 当前激活项
  const [contentMatches, setContentMatches] = useState([])
  const [activeContentIdx, setActiveContentIdx] = useState(0)
  const contentTargetRef = useRef({ kind: null, el: null })
  const editableRangesRef = useRef([])
  const textareaOffsetsRef = useRef([])

  const { dragging, handleDragStart, restorePosition } = useDraggableFloatingPanel({
    panelRef,
    position,
    setPosition,
    margin: PANEL_MARGIN,
    estimatedWidth: PANEL_WIDTH,
    estimatedHeight: PANEL_ESTIMATED_HEIGHT,
    persistKey: positionPersistKey
  })

  // 解析当前正文容器：noteContainerRef → 全屏笔记元素 → ProseMirror 根
  const getContainer = useCallback(() => {
    let el = noteContainerRef?.current || null
    if (!el || el === document.body) {
      el = document.querySelector('[data-flota-note-editor="true"]')
        || document.querySelector('.ProseMirror')
        || document.body
    }
    return el
  }, [noteContainerRef])

  useEffect(() => {
    if (!open) return
    setPosition((prev) => prev || restorePosition(getDefaultPosition()))
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [open, restorePosition])

  useEffect(() => {
    if (!open) {
      setKeyword('')
      clearHighlights()
    }
  }, [open])

  // 卸载时清理高亮
  useEffect(() => () => clearHighlights(), [])

  const headings = useMemo(() => extractHeadings(noteContent || ''), [noteContent])

  const filteredHeadings = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return headings
    return headings.filter((h) => h.text.toLowerCase().includes(kw))
  }, [headings, keyword])

  const bookmarks = useMemo(
    () => (noteId != null ? bookmarksMap[String(noteId)] || [] : []),
    [bookmarksMap, noteId]
  )

  const filteredBookmarks = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return bookmarks
    return bookmarks.filter((b) => (b.label || '').toLowerCase().includes(kw))
  }, [bookmarks, keyword])

  // ── 正文内容搜索（CSS Highlight API + 片段列表）────────────────────────────
  const resolveContentTarget = useCallback(() => {
    const root = getContainer()
    if (!root) return { kind: null, el: null }
    const textarea = root.querySelector('textarea')
    if (textarea && textarea.offsetParent !== null) return { kind: 'textarea', el: textarea }
    const editable = root.querySelector('.ProseMirror') || root.querySelector('.markdown-preview')
    if (editable) return { kind: 'editable', el: editable }
    return { kind: null, el: null }
  }, [getContainer])

  const applyEditableHighlight = useCallback((ranges, active) => {
    if (!supportsHighlightApi) return
    clearHighlights()
    if (!ranges.length) return
    try {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
      const activeRange = ranges[active]
      if (activeRange) CSS.highlights.set(HIGHLIGHT_ACTIVE_NAME, new Highlight(activeRange))
    } catch (_) { /* ignore */ }
  }, [])

  const scrollEditableInto = useCallback((range) => {
    if (!range) return
    try {
      const target = range.startContainer.parentElement
      if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch (_) { /* ignore */ }
  }, [])

  const selectTextareaMatch = useCallback((el, offset, len) => {
    if (!el || offset == null) return
    try {
      el.focus({ preventScroll: true })
      el.setSelectionRange(offset, offset + len)
      const before = el.value.slice(0, offset)
      const line = before.split('\n').length
      const lineHeight = 24
      el.scrollTop = Math.max(0, (line - 4) * lineHeight)
    } catch (_) { /* ignore */ }
  }, [])

  const runContentSearch = useCallback((kw) => {
    const target = resolveContentTarget()
    contentTargetRef.current = target
    const trimmed = (kw || '').trim()
    if (!trimmed || !target.el) {
      editableRangesRef.current = []
      textareaOffsetsRef.current = []
      clearHighlights()
      setContentMatches([])
      setActiveContentIdx(0)
      return
    }
    const lowerKw = trimmed.toLowerCase()
    const len = trimmed.length

    if (target.kind === 'editable') {
      const ranges = []
      const snippets = []
      const walker = document.createTreeWalker(target.el, NodeFilter.SHOW_TEXT, null)
      let node = walker.nextNode()
      while (node) {
        const text = node.nodeValue || ''
        if (text) {
          const lower = text.toLowerCase()
          let from = 0
          let idx = lower.indexOf(lowerKw, from)
          while (idx !== -1) {
            try {
              const range = document.createRange()
              range.setStart(node, idx)
              range.setEnd(node, idx + len)
              ranges.push(range)
              snippets.push(makeSnippet(text, idx, len))
            } catch (_) { /* ignore */ }
            from = idx + len
            idx = lower.indexOf(lowerKw, from)
          }
        }
        node = walker.nextNode()
      }
      editableRangesRef.current = ranges
      textareaOffsetsRef.current = []
      setContentMatches(snippets)
      setActiveContentIdx(0)
      applyEditableHighlight(ranges, 0)
      if (ranges.length) scrollEditableInto(ranges[0])
    } else {
      const value = target.el.value || ''
      const lower = value.toLowerCase()
      const offsets = []
      const snippets = []
      let from = 0
      let idx = lower.indexOf(lowerKw, from)
      while (idx !== -1) {
        offsets.push(idx)
        snippets.push(makeSnippet(value, idx, len))
        from = idx + len
        idx = lower.indexOf(lowerKw, from)
      }
      textareaOffsetsRef.current = offsets
      editableRangesRef.current = []
      clearHighlights()
      setContentMatches(snippets)
      setActiveContentIdx(0)
      if (offsets.length) selectTextareaMatch(target.el, offsets[0], len)
    }
  }, [resolveContentTarget, applyEditableHighlight, scrollEditableInto, selectTextareaMatch])

  // 关键字 / 正文变化时重新搜索（仅打开时）
  useEffect(() => {
    if (!open) return
    runContentSearch(keyword)
  }, [keyword, open, noteContent, runContentSearch])

  const goToContentMatch = useCallback((nextIndex) => {
    const total = contentMatches.length
    if (!total) return
    const wrapped = ((nextIndex % total) + total) % total
    setActiveContentIdx(wrapped)
    const target = contentTargetRef.current
    const len = keyword.trim().length
    if (target?.kind === 'editable') {
      const ranges = editableRangesRef.current
      applyEditableHighlight(ranges, wrapped)
      scrollEditableInto(ranges[wrapped])
    } else if (target?.kind === 'textarea') {
      selectTextareaMatch(target.el, textareaOffsetsRef.current[wrapped], len)
    }
  }, [contentMatches.length, keyword, applyEditableHighlight, scrollEditableInto, selectTextareaMatch])

  // ── 大纲跳转 ────────────────────────────────────────────────────────────────
  const jumpToHeading = useCallback((heading) => {
    if (!heading) return
    const containerEl = getContainer()
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
      const lv = Number(el.tagName.slice(1))
      if (lv === heading.level) {
        counter += 1
        if (counter === sameLevelBefore) { target = el; break }
      }
    }
    if (!target) {
      for (const el of allHeads) {
        if ((el.textContent || '').trim() === heading.text) { target = el; break }
      }
    }
    if (target) {
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        target.classList.add('wiki-section-flash')
        window.setTimeout(() => target.classList.remove('wiki-section-flash'), 1500)
      } catch (_) {
        target.scrollIntoView()
      }
    }
  }, [headings, getContainer])

  // ── 书签：捕获当前位置 / 跳转 ─────────────────────────────────────────────────
  const findScrollEl = useCallback((root) => {
    if (!root) return null
    const flagged = root.querySelector('[data-flota-scroll-source]')
    if (flagged && flagged.scrollHeight > flagged.clientHeight) return flagged
    const ta = root.querySelector('textarea')
    if (ta && ta.scrollHeight > ta.clientHeight) return ta
    const pm = root.querySelector('.ProseMirror')
    if (pm) {
      let cur = pm
      while (cur && cur !== root.parentElement) {
        if (cur.scrollHeight > cur.clientHeight) return cur
        cur = cur.parentElement
      }
    }
    return null
  }, [])

  const captureAnchor = useCallback(() => {
    const root = getContainer()
    if (!root) return null
    const ta = root.querySelector('textarea')
    if (ta && ta.offsetParent !== null) {
      const value = ta.value || ''
      const pos = ta.selectionStart || 0
      const lineStart = value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
      let lineEnd = value.indexOf('\n', pos)
      if (lineEnd < 0) lineEnd = value.length
      let line = normalize(value.slice(lineStart, lineEnd))
      if (!line) {
        const rest = value.slice(pos).split('\n').map(normalize).filter(Boolean)
        line = rest[0] || ''
      }
      if (!line) return null
      return line.slice(0, ANCHOR_SNIPPET_LEN)
    }

    const scrollEl = findScrollEl(root)
    const content = root.querySelector('.ProseMirror, .markdown-preview')
    if (!content) return null
    const containerTop = (scrollEl || content).getBoundingClientRect().top
    const blocks = content.querySelectorAll(BLOCK_SELECTOR)
    let best = null
    let bestDelta = Infinity
    for (const el of blocks) {
      const txt = normalize(el.textContent)
      if (!txt) continue
      const top = el.getBoundingClientRect().top
      const delta = top - containerTop
      if (delta >= -8 && delta < bestDelta) { bestDelta = delta; best = txt }
    }
    if (!best) {
      for (const el of blocks) {
        const txt = normalize(el.textContent)
        if (txt) { best = txt; break }
      }
    }
    return best ? best.slice(0, ANCHOR_SNIPPET_LEN) : null
  }, [getContainer, findScrollEl])

  const handleAddBookmark = useCallback(() => {
    const anchorText = captureAnchor()
    if (!anchorText) return
    addBookmark(noteId, { label: anchorText, anchorText })
  }, [captureAnchor, addBookmark, noteId])

  const jumpToBookmark = useCallback((anchorText) => {
    const root = getContainer()
    if (!root || !anchorText) return
    const wanted = normalize(anchorText)

    const ta = root.querySelector('textarea')
    if (ta && ta.offsetParent !== null) {
      const value = ta.value || ''
      const idx = value.indexOf(anchorText)
      if (idx >= 0) {
        ta.focus()
        ta.setSelectionRange(idx, idx + anchorText.length)
        const before = value.slice(0, idx)
        const totalLines = (value.match(/\n/g) || []).length + 1
        const lineNo = (before.match(/\n/g) || []).length
        const max = ta.scrollHeight - ta.clientHeight
        if (max > 0 && totalLines > 1) {
          ta.scrollTop = Math.max(0, (lineNo / totalLines) * ta.scrollHeight - ta.clientHeight / 3)
        }
      }
      return
    }

    const content = root.querySelector('.ProseMirror, .markdown-preview')
    if (!content) return
    const blocks = content.querySelectorAll(BLOCK_SELECTOR)
    let target = null
    for (const el of blocks) {
      const txt = normalize(el.textContent)
      if (!txt) continue
      if (txt === wanted || txt.startsWith(wanted) || txt.includes(wanted)) { target = el; break }
    }
    if (target) {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { target.scrollIntoView() }
      try {
        target.classList.add('wiki-section-flash')
        setTimeout(() => target.classList.remove('wiki-section-flash'), 1500)
      } catch {}
    }
  }, [getContainer])

  const hasKeyword = keyword.trim().length > 0
  const noResults = hasKeyword && filteredHeadings.length === 0 && filteredBookmarks.length === 0 && contentMatches.length === 0
  const resolvedPosition = position || getDefaultPosition()

  const sectionHeaderSx = { display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, pt: 1.25, pb: 0.5 }

  return (
    <FloatingGlassSurface
      ref={panelRef}
      open={open}
      layer="aiPanel"
      ariaLabel="笔记导航"
      position={resolvedPosition}
      width={PANEL_WIDTH}
      maxWidth={`calc(100vw - ${PANEL_RIGHT_OFFSET * 2}px)`}
      maxHeight={`min(560px, calc(100vh - ${PANEL_BOTTOM_OFFSET * 2}px))`}
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
          placeholder="搜索大纲 / 书签 / 正文内容…"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose?.()
            } else if (e.key === 'Enter' && contentMatches.length) {
              e.preventDefault()
              goToContentMatch(activeContentIdx + (e.shiftKey ? -1 : 1))
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
        {noResults && (
          <Typography sx={{ fontSize: 12, color: 'text.disabled', px: 1, py: 1.5, textAlign: 'center' }}>
            没有匹配的大纲、书签或正文内容
          </Typography>
        )}

        {/* ── 大纲 ── */}
        {(!hasKeyword || filteredHeadings.length > 0) && (
          <>
            <Box sx={{ ...sectionHeaderSx, pt: 0.5 }}>
              <OutlineIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              <Typography sx={{ fontSize: 11, color: 'text.disabled', letterSpacing: 0.5 }}>
                大纲（{filteredHeadings.length}）
              </Typography>
            </Box>
            {filteredHeadings.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: 'text.disabled', px: 1, py: 0.75 }}>
                当前笔记没有标题
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
          </>
        )}

        {/* ── 正文内容匹配（仅搜索时）── */}
        {hasKeyword && contentMatches.length > 0 && (
          <>
            <Box sx={sectionHeaderSx}>
              <ContentIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              <Typography sx={{ fontSize: 11, color: 'text.disabled', letterSpacing: 0.5 }}>
                正文内容（{activeContentIdx + 1}/{contentMatches.length}）
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Tooltip title="上一个 (Shift+Enter)">
                <IconButton size="small" onClick={() => goToContentMatch(activeContentIdx - 1)} sx={{ width: 22, height: 22 }}>
                  <PrevIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="下一个 (Enter)">
                <IconButton size="small" onClick={() => goToContentMatch(activeContentIdx + 1)} sx={{ width: 22, height: 22 }}>
                  <NextIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            </Box>
            {contentMatches.map((sn, i) => (
              <Box
                key={i}
                onClick={() => goToContentMatch(i)}
                sx={(theme) => ({
                  px: 1,
                  py: 0.5,
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  borderRadius: 1,
                  cursor: 'pointer',
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  bgcolor: i === activeContentIdx
                    ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1)
                    : 'transparent',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.08)
                  }
                })}
              >
                <span>{sn.before}</span>
                <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>{sn.mid}</Box>
                <span>{sn.after}</span>
              </Box>
            ))}
          </>
        )}

        {/* ── 书签 ── */}
        {(!hasKeyword || filteredBookmarks.length > 0) && (
          <>
            <Box sx={sectionHeaderSx}>
              <BookmarkIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              <Typography sx={{ fontSize: 11, color: 'text.disabled', letterSpacing: 0.5 }}>
                书签（{filteredBookmarks.length}）
              </Typography>
              <Box sx={{ flex: 1 }} />
              {!hasKeyword && (
                <Tooltip title="标记当前位置">
                  <IconButton size="small" onClick={handleAddBookmark} sx={{ width: 22, height: 22 }}>
                    <AddIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            {filteredBookmarks.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: 'text.disabled', px: 1, py: 0.75 }}>
                {bookmarks.length === 0 ? '滚动到想标记的位置，点「+」标记' : '没有匹配的书签'}
              </Typography>
            ) : (
              filteredBookmarks.map((bm) => (
                <Box
                  key={bm.id}
                  onClick={() => jumpToBookmark(bm.anchorText)}
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 0.5,
                    pl: 0.75,
                    pr: 0.5,
                    py: 0.5,
                    borderRadius: 1,
                    cursor: 'pointer',
                    color: 'text.secondary',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.08),
                      color: 'primary.main',
                      '& .bm-del': { opacity: 1 }
                    }
                  })}
                >
                  <Typography sx={{
                    flex: 1,
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {bm.label}
                  </Typography>
                  <Tooltip title="删除书签">
                    <IconButton
                      className="bm-del"
                      size="small"
                      onClick={(e) => { e.stopPropagation(); removeBookmark(noteId, bm.id) }}
                      sx={{ width: 20, height: 20, opacity: 0, flexShrink: 0 }}
                    >
                      <DeleteIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))
            )}
          </>
        )}
      </Box>
    </FloatingGlassSurface>
  )
}

export default NoteNavigator
