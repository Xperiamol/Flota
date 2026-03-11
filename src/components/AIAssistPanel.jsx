import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Paper, IconButton, TextField, CircularProgress, Tooltip, Fade, ClickAwayListener, Portal } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CloseIcon from '@mui/icons-material/Close'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import AddIcon from '@mui/icons-material/Add'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { useStore } from '../store/useStore'
import { ALL_TOOLBAR_ITEMS, DEFAULT_FLOATING_ORDER, execWYSIWYGCommand } from './MarkdownToolbar'

/**
 * 浮动面板 — 选中文字后浮现，提供改写/摘要/翻译/续写/自由提问 + 自定义格式工具
 * 支持两种模式：
 *   1. WYSIWYG 模式：传入 editor (TipTap)
 *   2. 源码模式：传入 textareaRef + onInsert
 */
const AIAssistPanel = ({ editor, textareaRef, onInsert }) => {
  const aiPanelMode = useStore((s) => s.aiPanelMode) || 'selection'
  const floatingPanelItems = useStore((s) => s.floatingPanelItems) || DEFAULT_FLOATING_ORDER
  const [visible, setVisible] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [activeAction, setActiveAction] = useState(null)
  const panelRef = useRef(null)
  const lastSelRef = useRef('')
  const mouseDownRef = useRef(false)
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, origTop: 0, origLeft: 0 })
  const selRangeRef = useRef({ start: 0, end: 0 }) // textarea 选区范围
  const isTextareaMode = !editor && !!textareaRef

  // 计算面板位置（视口坐标 + Portal 渲染到 body，彻底避免 overflow 裁剪）
  const updatePosition = useCallback((mouseEvent) => {
    if (isTextareaMode) {
      // 源码模式：用鼠标释放位置作为锚点
      if (mouseEvent) {
        const panelHeight = panelRef.current?.offsetHeight || 44
        let top = mouseEvent.clientY - panelHeight - 8
        if (top < 8) top = mouseEvent.clientY + 16
        const left = Math.max(8, Math.min(mouseEvent.clientX, window.innerWidth - 280))
        setPosition({ top, left })
      }
      return
    }
    if (!editor) return
    const { from, to } = editor.state.selection
    // 有选区时定位到选区开头；无选区时定位到光标
    const pos = from !== to ? from : editor.state.selection.$head.pos
    try {
      const coords = editor.view.coordsAtPos(pos)
      const panelHeight = panelRef.current?.offsetHeight || 44
      let top = coords.top - panelHeight - 8
      if (top < 8) top = coords.bottom + 8
      const left = Math.max(8, Math.min(coords.left, window.innerWidth - 280))
      setPosition({ top, left })
    } catch { /* pos invalid, skip */ }
  }, [editor, isTextareaMode])

  // "始终显示"模式：编辑器就绪后立即显示面板
  useEffect(() => {
    if (!editor || aiPanelMode !== 'always') return
    // 等编辑器首次渲染完成后定位并显示
    const show = () => {
      updatePosition()
      setVisible(true)
    }
    // 延迟一帧保证 DOM 已布局
    const raf = requestAnimationFrame(show)
    return () => cancelAnimationFrame(raf)
  }, [editor, aiPanelMode, updatePosition])

  // 监听鼠标按下/释放来确定选区完成时机
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const onMouseDown = () => { mouseDownRef.current = true }

    const onMouseUp = (e) => {
      mouseDownRef.current = false
      // AI 面板禁用时不显示
      if (aiPanelMode === 'disabled') return
      // 点击面板内的按钮时，不重新检查选区（避免误关闭）
      if (panelRef.current?.contains(e.target)) return
      // 延迟检查选区，确保选区已稳定
      setTimeout(() => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        if (text.trim().length > 1) {
          lastSelRef.current = text
          setSelectedText(text)
          updatePosition()
          setVisible(true)
          setResult('')
          setError('')
          setShowCustom(false)
          setActiveAction(null)
        } else if (aiPanelMode === 'always') {
          // 始终显示模式：即使没有选中文字也保持面板可见
          setSelectedText('')
          updatePosition()
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

  // 监听编辑器选区变化 — 仅处理选区消失（如点击别处）
  useEffect(() => {
    if (!editor) return
    const onSelectionUpdate = () => {
      // 拖选过程中不做任何处理
      if (mouseDownRef.current) return
      // 焦点在面板内时不处理（用户在操作面板按钮）
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

  // "始终显示"模式：光标移动时跟踪位置
  useEffect(() => {
    if (!editor || aiPanelMode !== 'always') return
    const onUpdate = () => {
      if (dragRef.current?.dragging) return  // 面板拖动中不跟踪
      updatePosition()
    }
    editor.on('selectionUpdate', onUpdate)
    editor.on('transaction', onUpdate)
    return () => {
      editor.off('selectionUpdate', onUpdate)
      editor.off('transaction', onUpdate)
    }
  }, [editor, aiPanelMode, updatePosition])

  // ── 源码模式：监听 textarea 选区变化 ──
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

  const runAction = useCallback(async (prompt, actionId) => {
    setLoading(true)
    setError('')
    setResult('')
    setActiveAction(actionId)
    try {
      const messages = [
        { role: 'system', content: '你是一个专业的写作助手。直接输出结果，不要包含额外的解释或前缀。' },
        { role: 'user', content: prompt + selectedText },
      ]
      const res = await window.electronAPI.ai.chat(messages, {})
      if (res?.success && res.data?.content) {
        setResult(res.data.content)
      } else {
        setError(res?.error || '调用失败')
      }
    } catch (e) {
      setError(e.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }, [selectedText])

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return
    runAction(customPrompt.trim() + '\n\n', 'custom')
  }, [customPrompt, runAction])

  // 替换选中文本
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
    const { from, to } = editor.state.selection
    editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, result).run()
    dismiss()
  }, [editor, result, dismiss, isTextareaMode, textareaRef])

  // 插入到选区后面
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
    const { to } = editor.state.selection
    editor.chain().focus().insertContentAt(to, '\n\n' + result).run()
    dismiss()
  }, [editor, result, dismiss, isTextareaMode, textareaRef])

  // 复制结果
  const copyResult = useCallback(() => {
    if (result) navigator.clipboard?.writeText(result)
  }, [result])

  // ── 拖动逻辑 ──
  const handleDragStart = useCallback((e) => {
    // 只响应拖动手柄区域的按下
    e.preventDefault()
    const d = dragRef.current
    d.dragging = true
    d.startX = e.clientX
    d.startY = e.clientY
    d.origTop = position.top
    d.origLeft = position.left

    const onMove = (ev) => {
      if (!d.dragging) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      setPosition({
        top: Math.max(0, Math.min(d.origTop + dy, window.innerHeight - 48)),
        left: Math.max(0, Math.min(d.origLeft + dx, window.innerWidth - 120)),
      })
    }
    const onUp = () => {
      d.dragging = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [position])

  if (!visible) return null

  return (
    <Portal>
      <ClickAwayListener onClickAway={() => { if (!loading && aiPanelMode !== 'always') dismiss() }} mouseEvent="onMouseDown" touchEvent="onTouchStart">
        <Fade in={visible}>
          <Paper
          ref={panelRef}
          elevation={0}
          sx={(theme) => {
            const dark = theme.palette.mode === 'dark'
            return {
              position: 'fixed',
              top: position.top,
              left: Math.max(0, position.left),
              zIndex: 2147483647,
              borderRadius: '10px',
              overflow: 'hidden',
              minWidth: 240,
              maxWidth: 420,
              // 液态玻璃效果
              background: dark
                ? 'linear-gradient(135deg, rgba(30,41,59,0.72) 0%, rgba(15,23,42,0.68) 100%)'
                : 'linear-gradient(135deg, rgba(255,255,255,0.82) 0%, rgba(240,244,248,0.78) 100%)',
              backdropFilter: 'blur(18px) saturate(180%)',
              WebkitBackdropFilter: 'blur(18px) saturate(180%)',
              border: dark
                ? '1px solid rgba(255,255,255,0.12)'
                : '1px solid rgba(0,0,0,0.10)',
              boxShadow: dark
                ? '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)'
                : '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)',
            }
          }}
        >
          {/* 操作按钮行（同时作为拖动把手） */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, py: 0.5,
            borderBottom: (result || error || loading || showCustom) ? 1 : 0, borderColor: 'divider' }}>
            {/* 拖动手柄 */}
            <Box
              onMouseDown={handleDragStart}
              sx={{ display: 'flex', alignItems: 'center', cursor: 'grab', px: '2px', opacity: 0.35,
                '&:active': { cursor: 'grabbing', opacity: 0.6 }, userSelect: 'none' }}
            >
              <DragIndicatorIcon sx={{ fontSize: 16 }} />
            </Box>
            {floatingPanelItems.map(id => {
              const def = ALL_TOOLBAR_ITEMS[id]
              if (!def) return null
              const Icon = def.icon
              const handleClick = () => {
                // AI 动作
                if (def.aiAction) {
                  if (def.aiAction.isChat) { setShowCustom(v => !v); return }
                  runAction(def.aiAction.prompt, id)
                  return
                }
                // 格式工具
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
                    sx={{ p: '5px' }}
                  >
                    {Icon ? <Icon sx={{ fontSize: 18 }} /> : <Box sx={{ fontSize: 11, fontWeight: 700 }}>{def.label?.[0]}</Box>}
                  </IconButton>
                </Tooltip>
              )
            })}
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={dismiss} sx={{ p: '3px', opacity: 0.5 }} aria-label="关闭">
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>

          {/* 自由提问输入 */}
          {showCustom && (
            <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1 }}>
              <TextField
                size="small" fullWidth variant="outlined" placeholder="输入你的指令…"
                aria-label="AI指令输入"
                value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCustomSubmit() } }}
                disabled={loading}
                sx={{ '& .MuiInputBase-root': { fontSize: 13, borderRadius: '8px' } }}
              />
            </Box>
          )}

          {/* 加载中 */}
          {loading && (
            <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Box sx={{ fontSize: 13, color: 'text.secondary' }}>AI 思考中…</Box>
            </Box>
          )}

          {/* 错误 */}
          {error && (
            <Box sx={{ px: 2, py: 1, fontSize: 12, color: 'error.main' }}>{error}</Box>
          )}

          {/* 结果 */}
          {result && (
            <Box>
              <Box sx={{
                px: 2, py: 1.5, fontSize: 13, lineHeight: 1.7,
                maxHeight: 240, overflow: 'auto',
                whiteSpace: 'pre-wrap', color: 'text.primary',
              }}>
                {result}
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, px: 1, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
                <Tooltip title="替换选中" arrow>
                  <IconButton size="small" onClick={replaceSelection} color="primary" sx={{ p: '4px' }}>
                    <SwapHorizIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="插入到后面" arrow>
                  <IconButton size="small" onClick={insertAfter} sx={{ p: '4px' }}>
                    <AddIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="复制" arrow>
                  <IconButton size="small" onClick={copyResult} sx={{ p: '4px' }}>
                    <ContentCopyIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="关闭" arrow>
                  <IconButton size="small" onClick={dismiss} sx={{ p: '4px' }}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          )}
          </Paper>
        </Fade>
      </ClickAwayListener>
    </Portal>
  )
}

export default AIAssistPanel
