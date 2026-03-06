import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Paper, IconButton, TextField, CircularProgress, Tooltip, Fade, ClickAwayListener } from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import SummarizeIcon from '@mui/icons-material/Summarize'
import TranslateIcon from '@mui/icons-material/Translate'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import ChatIcon from '@mui/icons-material/Chat'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CloseIcon from '@mui/icons-material/Close'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import AddIcon from '@mui/icons-material/Add'

const ACTIONS = [
  { id: 'rewrite',   icon: AutoFixHighIcon,  label: '改写', prompt: '请改写以下文本，保持原意但使其更流畅自然：\n\n' },
  { id: 'summarize', icon: SummarizeIcon,     label: '摘要', prompt: '请用简洁的语言总结以下文本的要点：\n\n' },
  { id: 'translate',  icon: TranslateIcon,    label: '翻译', prompt: '请将以下文本翻译为英文（如果原文是英文则翻译为中文）：\n\n' },
  { id: 'continue',  icon: AutoAwesomeIcon,   label: '续写', prompt: '请根据上下文自然地续写以下文本：\n\n' },
]

/**
 * AI 辅助面板 — 选中文字后浮现，提供改写/摘要/翻译/续写/自由提问
 */
const AIAssistPanel = ({ editor }) => {
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

  // 计算面板位置
  const updatePosition = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const coords = editor.view.coordsAtPos(from)
    const editorRect = editor.view.dom.closest('.MuiBox-root')?.getBoundingClientRect()
      || editor.view.dom.parentElement.getBoundingClientRect()
    setPosition({
      top: coords.top - editorRect.top - 44,
      left: Math.min(coords.left - editorRect.left, editorRect.width - 280),
    })
  }, [editor])

  // 监听鼠标按下/释放来确定选区完成时机
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const onMouseDown = () => { mouseDownRef.current = true }

    const onMouseUp = (e) => {
      mouseDownRef.current = false
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
        }
      }, 50)
    }

    dom.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      dom.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [editor, updatePosition])

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
      if (text.trim().length <= 1 && !result && !loading) {
        setVisible(false)
        lastSelRef.current = ''
      }
    }
    editor.on('selectionUpdate', onSelectionUpdate)
    return () => editor.off('selectionUpdate', onSelectionUpdate)
  }, [editor, result, loading])

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
    if (!editor || !result) return
    const { from, to } = editor.state.selection
    editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, result).run()
    dismiss()
  }, [editor, result, dismiss])

  // 插入到选区后面
  const insertAfter = useCallback(() => {
    if (!editor || !result) return
    const { to } = editor.state.selection
    editor.chain().focus().insertContentAt(to, '\n\n' + result).run()
    dismiss()
  }, [editor, result, dismiss])

  // 复制结果
  const copyResult = useCallback(() => {
    if (result) navigator.clipboard?.writeText(result)
  }, [result])

  if (!visible) return null

  return (
    <ClickAwayListener onClickAway={() => { if (!loading) dismiss() }} mouseEvent="onMouseDown" touchEvent="onTouchStart">
      <Fade in={visible}>
        <Paper
          ref={panelRef}
          elevation={8}
          sx={{
            position: 'absolute',
            top: position.top,
            left: Math.max(0, position.left),
            zIndex: 1200,
            borderRadius: '12px',
            overflow: 'hidden',
            minWidth: 240,
            maxWidth: 420,
          }}
        >
          {/* 操作按钮行 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5,
            borderBottom: (result || error || loading || showCustom) ? 1 : 0, borderColor: 'divider' }}>
            {ACTIONS.map(a => (
              <Tooltip key={a.id} title={a.label} arrow>
                <IconButton
                  size="small"
                  onClick={() => runAction(a.prompt, a.id)}
                  disabled={loading}
                  color={activeAction === a.id ? 'primary' : 'default'}
                  sx={{ p: '5px' }}
                >
                  <a.icon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            ))}
            <Tooltip title="自由提问" arrow>
              <IconButton size="small" onClick={() => setShowCustom(v => !v)} disabled={loading}
                color={showCustom ? 'primary' : 'default'} sx={{ p: '5px' }}>
                <ChatIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={dismiss} sx={{ p: '3px', opacity: 0.5 }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>

          {/* 自由提问输入 */}
          {showCustom && (
            <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1 }}>
              <TextField
                size="small" fullWidth variant="outlined" placeholder="输入你的指令…"
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
  )
}

export default AIAssistPanel
