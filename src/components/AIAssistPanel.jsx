import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, IconButton, TextField, CircularProgress, Tooltip, alpha } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CloseIcon from '@mui/icons-material/Close'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import AddIcon from '@mui/icons-material/Add'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import FloatingGlassSurface from './FloatingGlassSurface'
import { useStore } from '../store/useStore'
import useAIStream from '../hooks/useAIStream'
import useDraggableFloatingPanel from '../hooks/useDraggableFloatingPanel'
import { ALL_TOOLBAR_ITEMS, DEFAULT_FLOATING_ORDER, execWYSIWYGCommand } from './MarkdownToolbar'
import { buildContextPackageFromNotes, truncateText } from '../utils/aiContextUtils'
import { toListResult } from '../utils/todoDisplayUtils'

const PANEL_MARGIN = 8
const PANEL_ESTIMATED_WIDTH = 280
const PANEL_ESTIMATED_HEIGHT = 52

/**
 * 浮动面板 — 选中文字后浮现，提供改写/摘要/翻译/续写/自由提问 + 自定义格式工具
 * 支持两种模式：
 *   1. WYSIWYG 模式：传入 editor (TipTap)
 *   2. 源码模式：传入 textareaRef + onInsert
 */
const AIAssistPanel = ({ editor, textareaRef, onInsert }) => {
  const aiPanelMode = useStore((s) => s.aiPanelMode) || 'selection'
  const floatingPanelItems = useStore((s) => s.floatingPanelItems) || DEFAULT_FLOATING_ORDER
  const notes = useStore((s) => s.notes)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const [visible, setVisible] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [activeAction, setActiveAction] = useState(null)
  const panelRef = useRef(null)
  const lastSelRef = useRef('')
  const mouseDownRef = useRef(false)
  const selRangeRef = useRef({ start: 0, end: 0 })
  const isTextareaMode = !editor && !!textareaRef
  const { runStream } = useAIStream()
  const { dragging, handleDragStart, clampPosition } = useDraggableFloatingPanel({
    panelRef,
    position,
    setPosition,
    margin: PANEL_MARGIN,
    estimatedWidth: PANEL_ESTIMATED_WIDTH,
    estimatedHeight: PANEL_ESTIMATED_HEIGHT
  })

  const saveEditorSelection = useCallback(() => {
    if (!editor || isTextareaMode) return
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, ' ')
    if (text.trim().length > 1) {
      selRangeRef.current = { from, to }
      lastSelRef.current = text
      setSelectedText(text)
    }
  }, [editor, isTextareaMode])

  const restoreEditorSelection = useCallback(() => {
    if (!editor || isTextareaMode) return false
    const { from, to } = selRangeRef.current || {}
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false
    editor.chain().focus().setTextSelection({ from, to }).run()
    return true
  }, [editor, isTextareaMode])

  const getSelectionText = useCallback(() => (
    lastSelRef.current || selectedText
  ), [selectedText])

  const updatePosition = useCallback((mouseEvent) => {
    const positionNearPoint = (x, y) => {
      const panelHeight = panelRef.current?.offsetHeight || PANEL_ESTIMATED_HEIGHT
      let nextY = y - panelHeight - 8
      if (nextY < PANEL_MARGIN) nextY = y + 16
      setPosition(clampPosition(x, nextY))
    }

    if (isTextareaMode) {
      if (mouseEvent) {
        positionNearPoint(mouseEvent.clientX, mouseEvent.clientY)
      }
      return
    }
    if (!editor) return

    // 1) 优先使用鼠标抬起位置：用户视线就在这里，大范围拖选也能贴脸出现
    if (mouseEvent && Number.isFinite(mouseEvent.clientX) && Number.isFinite(mouseEvent.clientY)) {
      positionNearPoint(mouseEvent.clientX, mouseEvent.clientY)
      return
    }

    // 2) 无鼠标事件：用选区 head（拖选结束端 / 光标当前端），而不是 from。
    //    这样大范围拖选时不会跑到不可见的起点位置。
    try {
      const sel = editor.state.selection
      const headPos = sel.$head?.pos ?? sel.to ?? sel.from
      const headCoords = editor.view.coordsAtPos(headPos)

      // 取选区的可视边界，作为兜底防止 head 在视口外
      let anchorTop = headCoords.top
      let anchorBottom = headCoords.bottom
      let anchorLeft = headCoords.left
      if (sel.from !== sel.to) {
        try {
          const fromCoords = editor.view.coordsAtPos(sel.from)
          const toCoords = editor.view.coordsAtPos(sel.to)
          anchorTop = Math.min(fromCoords.top, toCoords.top, headCoords.top)
          anchorBottom = Math.max(fromCoords.bottom, toCoords.bottom, headCoords.bottom)
          anchorLeft = headCoords.left
        } catch (_) { /* ignore */ }
      }

      const viewportH = window.innerHeight || document.documentElement.clientHeight
      // 若 head 在视口外（拖选起点被滚走），把锚点夹到当前视口内，
      // 防止面板被 clampPosition 强行拍回屏幕角落。
      const clampedBottom = Math.min(Math.max(anchorBottom, PANEL_MARGIN), viewportH - PANEL_MARGIN)
      const clampedTop = Math.min(Math.max(anchorTop, PANEL_MARGIN), viewportH - PANEL_MARGIN)

      const panelHeight = panelRef.current?.offsetHeight || PANEL_ESTIMATED_HEIGHT
      let y = clampedTop - panelHeight - 8
      if (y < PANEL_MARGIN) y = clampedBottom + 8
      setPosition(clampPosition(anchorLeft, y))
    } catch (_) {
      // pos invalid, skip
    }
  }, [clampPosition, editor, isTextareaMode])

  useEffect(() => {
    if (!editor || aiPanelMode !== 'always') return
    const raf = requestAnimationFrame(() => {
      updatePosition()
      setVisible(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [editor, aiPanelMode, updatePosition])

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const onMouseDown = () => { mouseDownRef.current = true }

    const onMouseUp = (e) => {
      mouseDownRef.current = false
      if (aiPanelMode === 'disabled') return
      if (panelRef.current?.contains(e.target)) return
      // 缓存当前 mouseup 的位置，setTimeout 内 e 仍可用，但显式拷贝更稳
      const mouseSnapshot = { clientX: e.clientX, clientY: e.clientY }
      setTimeout(() => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        if (text.trim().length > 1) {
          selRangeRef.current = { from, to }
          lastSelRef.current = text
          setSelectedText(text)
          updatePosition(mouseSnapshot)
          setVisible(true)
          setResult('')
          setError('')
          setShowCustom(false)
          setActiveAction(null)
        } else if (aiPanelMode === 'always') {
          setSelectedText('')
          updatePosition(mouseSnapshot)
          setVisible(true)
        }
      }, 50)
    }

    dom.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      dom.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [editor, updatePosition, aiPanelMode])

  useEffect(() => {
    if (!editor) return
    const onSelectionUpdate = () => {
      if (mouseDownRef.current) return
      if (panelRef.current?.contains(document.activeElement)) return
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, ' ')
      if (text.trim().length <= 1 && !result && !loading && aiPanelMode !== 'always') {
        setVisible(false)
        lastSelRef.current = ''
      }
    }
    editor.on('selectionUpdate', onSelectionUpdate)
    return () => editor.off('selectionUpdate', onSelectionUpdate)
  }, [editor, result, loading, aiPanelMode])

  useEffect(() => {
    if (!editor || aiPanelMode !== 'always') return
    const onUpdate = () => {
      if (dragging) return
      updatePosition()
    }
    editor.on('selectionUpdate', onUpdate)
    editor.on('transaction', onUpdate)
    return () => {
      editor.off('selectionUpdate', onUpdate)
      editor.off('transaction', onUpdate)
    }
  }, [dragging, editor, aiPanelMode, updatePosition])

  useEffect(() => {
    if (!isTextareaMode) return
    const textarea = textareaRef.current?.querySelector?.('textarea') || textareaRef.current
    if (!textarea) return

    const onMouseUp = (e) => {
      if (aiPanelMode === 'disabled') return
      if (panelRef.current?.contains(e.target)) return
      setTimeout(() => {
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const text = textarea.value.substring(start, end)
        if (text.trim().length > 1) {
          selRangeRef.current = { start, end }
          lastSelRef.current = text
          setSelectedText(text)
          updatePosition(e)
          setVisible(true)
          setResult('')
          setError('')
          setShowCustom(false)
          setActiveAction(null)
        } else if (aiPanelMode !== 'always') {
          setVisible(false)
          lastSelRef.current = ''
        }
      }, 50)
    }

    textarea.addEventListener('mouseup', onMouseUp)
    return () => textarea.removeEventListener('mouseup', onMouseUp)
  }, [isTextareaMode, textareaRef, aiPanelMode, updatePosition])

  const dismiss = useCallback(() => {
    setVisible(false)
    setResult('')
    setError('')
    setLoading(false)
    setShowCustom(false)
    setActiveAction(null)
    lastSelRef.current = ''
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dismiss, visible])

  const runAction = useCallback(async (prompt, actionId) => {
    saveEditorSelection()
    const text = getSelectionText()
    if (!text.trim()) return
    setLoading(true)
    setError('')
    setResult('')
    setActiveAction(actionId)
    try {
      const messages = [
        { role: 'system', content: '你是一个专业的写作助手。直接输出结果，不要包含额外的解释或前缀。' },
        { role: 'user', content: prompt + text },
      ]
      const [todoResult, memoryResult] = await Promise.allSettled([
        window.electronAPI?.todos?.getAll?.({ includeCompleted: false, limit: 80 }),
        window.electronAPI?.mem0?.search?.({
          userId: 'current_user',
          query: truncateText(text, 260),
          options: { limit: 3 }
        })
      ])
      const todos = todoResult.status === 'fulfilled'
        ? toListResult(todoResult.value)
        : []
      const memories = memoryResult.status === 'fulfilled' && Array.isArray(memoryResult.value?.results)
        ? memoryResult.value.results
        : []
      const contextPackage = buildContextPackageFromNotes({
        notes,
        todos,
        memories,
        selectedNoteId,
        query: text,
        contextEnabled: { currentNote: true, relatedNotes: true, todos: true, memories: true }
      })
      const { result: res, content } = await runStream({
        messages,
        contextPackage,
        requestPrefix: 'assist',
        options: { requireConfirmation: true, disableTools: true },
        onContent: setResult
      })
      const finalContent = content || res?.fullContent || res?.data?.content
      if (res?.success && finalContent) {
        setResult(finalContent)
      } else if (!finalContent) {
        setError(res?.error || '调用失败')
      }
    } catch (e) {
      setError(e.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }, [getSelectionText, notes, runStream, saveEditorSelection, selectedNoteId])

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return
    runAction(customPrompt.trim() + '\n\n', 'custom')
  }, [customPrompt, runAction])

  const replaceSelection = useCallback(() => {
    if (!result) return
    if (isTextareaMode) {
      const textarea = textareaRef.current?.querySelector?.('textarea') || textareaRef.current
      if (textarea) {
        const { start, end } = selRangeRef.current
        textarea.focus()
        textarea.setSelectionRange(start, end)
        document.execCommand('insertText', false, result)
      }
      dismiss()
      return
    }
    if (!editor) return
    restoreEditorSelection()
    const { from, to } = selRangeRef.current
    editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, result).run()
    dismiss()
  }, [editor, result, dismiss, isTextareaMode, restoreEditorSelection, textareaRef])

  const insertAfter = useCallback(() => {
    if (!result) return
    if (isTextareaMode) {
      const textarea = textareaRef.current?.querySelector?.('textarea') || textareaRef.current
      if (textarea) {
        const { end } = selRangeRef.current
        textarea.focus()
        textarea.setSelectionRange(end, end)
        document.execCommand('insertText', false, '\n\n' + result)
      }
      dismiss()
      return
    }
    if (!editor) return
    restoreEditorSelection()
    const { to } = selRangeRef.current
    editor.chain().focus().insertContentAt(to, '\n\n' + result).run()
    dismiss()
  }, [editor, result, dismiss, isTextareaMode, restoreEditorSelection, textareaRef])

  const copyResult = useCallback(() => {
    if (result) navigator.clipboard?.writeText(result)
  }, [result])

  const continueWithResult = useCallback(() => {
    if (!result) return
    setCustomPrompt(`基于上面的结果继续优化：\n\n${result}\n\n`)
    setShowCustom(true)
  }, [result])

  if (!visible) return null

  return (
    <FloatingGlassSurface
      ref={panelRef}
      open={visible}
      layer="selectionPanel"
      density="compact"
      position={position}
      minWidth={240}
      maxWidth={420}
      onClickAway={() => { if (!loading && aiPanelMode !== 'always') dismiss() }}
      clickAwayDisabled={loading || aiPanelMode === 'always'}
      sx={{ overflow: 'hidden' }}
    >
      <Box sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.5,
        py: 0.5,
        boxShadow: (result || error || loading || showCustom)
          ? `inset 0 -1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.035 : 0.28)}`
          : 'none',
        bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.05 : 0.08)
      })}>
        <Box
          onMouseDown={handleDragStart}
          sx={{
            display: 'flex',
            alignItems: 'center',
            cursor: dragging ? 'grabbing' : 'grab',
            px: '2px',
            opacity: 0.28,
            transition: 'opacity 140ms ease',
            '&:hover': { opacity: 0.52 },
            userSelect: 'none'
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 16 }} />
        </Box>
        {floatingPanelItems.map(id => {
          const def = ALL_TOOLBAR_ITEMS[id]
          if (!def) return null
          const Icon = def.icon
          const handleClick = () => {
            if (def.aiAction) {
              if (def.aiAction.isChat) { setShowCustom(v => !v); return }
              runAction(def.aiAction.prompt, id)
              return
            }
            if (isTextareaMode && onInsert && def.inline) {
              onInsert(...def.inline)
            } else if (editor) {
              execWYSIWYGCommand(editor, def)
            }
          }
          return (
            <Tooltip key={id} title={def.label} arrow>
              <IconButton
                size="small"
                onClick={handleClick}
                disabled={def.aiAction && !def.aiAction.isChat ? loading : false}
                color={def.aiAction?.isChat ? (showCustom ? 'primary' : 'default') : (activeAction === id ? 'primary' : 'default')}
                sx={(theme) => ({
                  p: '5px',
                  borderRadius: 1,
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) }
                })}
              >
                {Icon ? <Icon sx={{ fontSize: 18 }} /> : <Box sx={{ fontSize: 11, fontWeight: 700 }}>{def.label?.[0]}</Box>}
              </IconButton>
            </Tooltip>
          )
        })}
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={dismiss} sx={{ p: '3px', opacity: 0.5, borderRadius: 1 }} aria-label="关闭">
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {showCustom && (
        <Box
          onMouseDown={(event) => {
            event.stopPropagation()
            saveEditorSelection()
          }}
          onClick={(event) => event.stopPropagation()}
          sx={{ px: 1.25, py: 0.9, display: 'flex', gap: 1 }}
        >
          <TextField
            size="small"
            fullWidth
            variant="outlined"
            placeholder="输入你的指令…"
            aria-label="AI指令输入"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCustomSubmit() } }}
            disabled={loading}
            sx={{
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
              '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' }
            }}
          />
        </Box>
      )}

      {loading && !result && (
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={16} />
          <Box sx={{ fontSize: 13, color: 'text.secondary' }}>AI 思考中…</Box>
        </Box>
      )}

      {error && <Box sx={{ px: 2, py: 1, fontSize: 12, color: 'error.main' }}>{error}</Box>}

      {result && (
        <Box>
          <Box sx={{
            px: 2,
            py: 1.5,
            fontSize: 13,
            lineHeight: 1.7,
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            color: 'text.primary'
          }}>
            {result}
          </Box>
          <Box sx={(theme) => ({
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 0.5,
            px: 1,
            py: 0.5,
            boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.035 : 0.28)}`
          })}>
            <Tooltip title="替换选中" arrow>
              <IconButton size="small" onClick={replaceSelection} disabled={loading} color="primary" sx={{ p: '4px', borderRadius: 1 }}>
                <SwapHorizIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="插入到后面" arrow>
              <IconButton size="small" onClick={insertAfter} disabled={loading} sx={{ p: '4px', borderRadius: 1 }}>
                <AddIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="复制" arrow>
              <IconButton size="small" onClick={copyResult} disabled={loading} sx={{ p: '4px', borderRadius: 1 }}>
                <ContentCopyIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="继续追问/优化" arrow>
              <IconButton size="small" onClick={continueWithResult} disabled={loading} sx={{ p: '4px', borderRadius: 1 }}>
                <AutoAwesomeIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="关闭" arrow>
              <IconButton size="small" onClick={dismiss} sx={{ p: '4px', borderRadius: 1 }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}
    </FloatingGlassSurface>
  )
}

export default AIAssistPanel
