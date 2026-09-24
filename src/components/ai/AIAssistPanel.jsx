import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, IconButton, Tooltip, alpha } from '@mui/material'
import { Close as CloseIcon } from '../common/AppIcons'
import { DragIndicator as DragIndicatorIcon } from '../common/AppIcons'
import FloatingGlassSurface from '../common/FloatingGlassSurface'
import { useStore } from '../../store/useStore'
import useDraggableFloatingPanel from '../../hooks/useDraggableFloatingPanel'
import { ALL_TOOLBAR_ITEMS, DEFAULT_FLOATING_ORDER, execWYSIWYGCommand } from '../editor/MarkdownToolbar'
import { hideAIAssistSelection, showAIAssistSelection } from '../editor/extensions/AIAssistSelection'
import PanelIconButton from '../common/PanelIconButton'

const PANEL_MARGIN = 8
const PANEL_ESTIMATED_WIDTH = 280
const PANEL_ESTIMATED_HEIGHT = 52

/**
 * 浮动面板 — 右键选中文字后显示在上下文菜单上方，操作统一转入 AI 小窗
 * 支持两种模式：
 *   1. WYSIWYG 模式：传入 editor (TipTap)
 *   2. 源码模式：传入 textareaRef + onInsert
 */
const AIAssistPanel = ({ editor, textareaRef, onInsert, onOpenAI }) => {
  const aiPanelMode = useStore((s) => s.aiPanelMode) || 'selection'
  const floatingPanelItems = useStore((s) => s.floatingPanelItems) || DEFAULT_FLOATING_ORDER
  const [visible, setVisible] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const panelRef = useRef(null)
  const lastSelRef = useRef('')
  const mouseDownRef = useRef(false)
  const selRangeRef = useRef({ start: 0, end: 0 })
  const isTextareaMode = !editor && !!textareaRef
  const isContextSelectionMode = aiPanelMode === 'selection' || aiPanelMode === 'contextmenu'
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

  const getSelectionText = useCallback(() => (
    lastSelRef.current || selectedText
  ), [selectedText])

  const alignWithContextMenu = useCallback(() => {
    // 编辑器菜单会根据剩余空间自动翻到鼠标上方，因此必须等菜单完成布局后，
    // 再依据它的真实矩形定位 AI 栏，不能只依据右键坐标猜测。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const menu = document.querySelector('[data-editor-context-menu]')
        const panel = panelRef.current
        if (!menu || !panel) return
        const menuRect = menu.getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        const gap = 8
        const aboveY = menuRect.top - panelRect.height - gap
        const belowY = menuRect.bottom + gap
        const y = aboveY >= PANEL_MARGIN ? aboveY : belowY
        setPosition(clampPosition(menuRect.left, y))
      })
    })
  }, [clampPosition])

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
    if (!editor || editor.isDestroyed) return
    // TipTap v3 的 editor.view 是 getter，未挂载时会 throw —— 用 try/catch 兜底
    let dom
    try {
      dom = editor.view?.dom
    } catch {
      return
    }
    if (!dom) return

    const onMouseDown = (e) => {
      mouseDownRef.current = true
      // 右键交给编辑器上下文菜单，避免 AI 浮层遮住菜单。
      if (e.button === 2 && aiPanelMode !== 'always') setVisible(false)
    }

    const onMouseUp = (e) => {
      mouseDownRef.current = false
      if (aiPanelMode === 'disabled') return
      if (panelRef.current?.contains(e.target)) return
      if (e.button !== 0 || isContextSelectionMode) return
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
        } else if (aiPanelMode === 'always') {
          setSelectedText('')
          updatePosition(mouseSnapshot)
          setVisible(true)
        }
      }, 50)
    }

    const onContextMenu = (e) => {
      if (!isContextSelectionMode || panelRef.current?.contains(e.target)) return
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, ' ')
      if (text.trim().length <= 1) return

      // 不阻止事件传播：编辑器原有右键菜单仍会正常打开。
      selRangeRef.current = { from, to }
      lastSelRef.current = text
      setSelectedText(text)
      updatePosition({ clientX: e.clientX, clientY: e.clientY })
      setVisible(true)
      alignWithContextMenu()
    }

    dom.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    dom.addEventListener('contextmenu', onContextMenu)
    return () => {
      dom.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
      dom.removeEventListener('contextmenu', onContextMenu)
    }
  }, [editor, updatePosition, aiPanelMode, isContextSelectionMode, alignWithContextMenu])

  useEffect(() => {
    if (!editor) return
    const onSelectionUpdate = () => {
      if (mouseDownRef.current) return
      if (panelRef.current?.contains(document.activeElement)) return
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, ' ')
      if (aiPanelMode !== 'always' && !mouseDownRef.current) {
        setVisible(false)
        if (text.trim().length <= 1) lastSelRef.current = ''
      }
    }
    editor.on('selectionUpdate', onSelectionUpdate)
    return () => editor.off('selectionUpdate', onSelectionUpdate)
  }, [editor, aiPanelMode])

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
      if (e.button !== 0 || isContextSelectionMode) return
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
        }
      }, 50)
    }

    const onContextMenu = (e) => {
      if (!isContextSelectionMode || panelRef.current?.contains(e.target)) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = textarea.value.substring(start, end)
      if (text.trim().length <= 1) return
      selRangeRef.current = { start, end }
      lastSelRef.current = text
      setSelectedText(text)
      updatePosition({ clientX: e.clientX, clientY: e.clientY })
      setVisible(true)
    }

    textarea.addEventListener('mouseup', onMouseUp)
    textarea.addEventListener('contextmenu', onContextMenu)
    return () => {
      textarea.removeEventListener('mouseup', onMouseUp)
      textarea.removeEventListener('contextmenu', onContextMenu)
    }
  }, [isTextareaMode, textareaRef, aiPanelMode, isContextSelectionMode, updatePosition])

  useEffect(() => {
    if (!editor) return undefined
    if (visible && selectedText) {
      showAIAssistSelection(editor, selRangeRef.current)
    } else {
      hideAIAssistSelection(editor)
    }
    return () => hideAIAssistSelection(editor)
  }, [editor, selectedText, visible])

  const dismiss = useCallback(() => {
    setVisible(false)
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

  const openAICommand = useCallback((prompt, { autoSend = true } = {}) => {
    saveEditorSelection()
    const text = getSelectionText()
    if (!text.trim()) return
    onOpenAI?.(`${prompt}${text}`, { autoSend })
    dismiss()
  }, [dismiss, getSelectionText, onOpenAI, saveEditorSelection])

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
      onClickAway={() => { if (aiPanelMode !== 'always') dismiss() }}
      clickAwayDisabled={aiPanelMode === 'always'}
      sx={{ overflow: 'hidden' }}
    >
      <Box sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.5,
        py: 0.5,
        boxShadow: 'none',
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
              if (def.aiAction.isChat) {
                openAICommand('请围绕以下选中文本与我继续对话：\n\n', { autoSend: false })
                return
              }
              openAICommand(def.aiAction.prompt, { autoSend: true })
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
        <PanelIconButton title="关闭" onClick={dismiss}>
          <CloseIcon />
        </PanelIconButton>
      </Box>

    </FloatingGlassSurface>
  )
}

export default AIAssistPanel
