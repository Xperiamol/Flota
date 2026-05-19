import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  Box,
  Chip,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
  alpha
} from '@mui/material'
import {
  AutoAwesome as AIIcon,
  Close as CloseIcon,
  DragIndicator as DragIcon,
  Add as AddIcon,
  EditNote as NoteIcon,
  Send as SendIcon,
  Stop as StopIcon
} from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import FloatingGlassSurface from './FloatingGlassSurface'
import { useStore } from '../store/useStore'
import useAIStream from '../hooks/useAIStream'
import useDraggableFloatingPanel from '../hooks/useDraggableFloatingPanel'
import { buildContextPackageFromNotes, truncateText } from '../utils/aiContextUtils'
import { handleWhiteboardAIRequest } from '../utils/whiteboardAI'
import logger from '../utils/logger'

const QUICK_PROMPTS = [
  { id: 'summarize', label: '总结当前笔记', prompt: '请总结当前笔记，输出：核心要点、关键结论、待办事项、潜在风险。' },
  { id: 'next-step', label: '下一步建议', prompt: '基于当前笔记，给我 3 条具体可执行的下一步行动建议。' },
  { id: 'extract-todos', label: '提取待办', prompt: '请从当前笔记提取待办事项，并按优先级排序。' },
  { id: 'related', label: '关联内容', prompt: '找出和当前笔记最相关的笔记、待办和记忆，并简要说明关联原因。' }
]

const mdComponents = {
  p: ({ children }) => (
    <Typography component="p" variant="body2" sx={{ my: 0.4, lineHeight: 1.65 }}>
      {children}
    </Typography>
  ),
  ul: ({ children }) => <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>{children}</Box>,
  ol: ({ children }) => <Box component="ol" sx={{ pl: 2.5, my: 0.5 }}>{children}</Box>,
  li: ({ children }) => (
    <Typography component="li" variant="body2" sx={{ lineHeight: 1.65 }}>
      {children}
    </Typography>
  ),
  code: ({ inline, children }) => inline
    ? (
      <Box component="code" sx={(theme) => ({
        px: 0.6,
        py: 0.15,
        borderRadius: 0.75,
        fontSize: '0.78rem',
        bgcolor: alpha(theme.palette.text.primary, 0.06),
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
      })}>
        {children}
      </Box>
    )
    : (
      <Box component="pre" sx={(theme) => ({
        my: 0.75,
        p: 1,
        borderRadius: 1,
        overflowX: 'auto',
        bgcolor: alpha(theme.palette.text.primary, 0.05),
        fontSize: '0.78rem',
        lineHeight: 1.55,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
      })}>
        <code>{children}</code>
      </Box>
    )
}

const PANEL_WIDTH = 400
const PANEL_BOTTOM_OFFSET = 24
const PANEL_RIGHT_OFFSET = 24
const PANEL_ESTIMATED_HEIGHT = 520
const PANEL_MARGIN = 12

const getDefaultPosition = () => ({
  x: Math.max(PANEL_MARGIN, window.innerWidth - PANEL_WIDTH - PANEL_RIGHT_OFFSET),
  y: Math.max(PANEL_MARGIN, window.innerHeight - PANEL_ESTIMATED_HEIGHT - PANEL_BOTTOM_OFFSET)
})

const AICommandCenter = ({
  open,
  onClose,
  portalContainer,
  notesOverride,
  selectedNoteIdOverride,
  updateNoteOverride,
  loadNotesOverride,
  userAvatarOverride,
  positionPersistKey = 'flota.aiCommandCenter.position'
}) => {
  const inputRef = useRef(null)
  const scrollRef = useRef(null)
  const panelRef = useRef(null)

  const {
    notes: storeNotes,
    selectedNoteId: storeSelectedNoteId,
    userAvatar,
    aiConversations,
    aiActiveConvId,
    aiNoteConversationMap,
    aiNewChat,
    aiEnsureNoteChat,
    aiSwitchConv,
    aiUpdateConv,
    updateNote: storeUpdateNote,
    loadNotes: storeLoadNotes
  } = useStore()
  const notes = notesOverride ?? storeNotes
  const selectedNoteId = selectedNoteIdOverride !== undefined ? selectedNoteIdOverride : storeSelectedNoteId
  const updateNote = updateNoteOverride ?? storeUpdateNote
  const loadNotes = loadNotesOverride ?? storeLoadNotes
  const resolvedUserAvatar = userAvatarOverride !== undefined ? userAvatarOverride : userAvatar
  const noteConversationId = selectedNoteId == null ? null : aiNoteConversationMap?.[String(selectedNoteId)] || null
  const currentConversationId = noteConversationId || (selectedNoteId == null ? aiActiveConvId : null)
  const currentConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === currentConversationId) || null,
    [aiConversations, currentConversationId]
  )

  const [input, setInput] = useState('')
  const [messages, setMessages] = useState(() => currentConversation?.messages || [])
  const [streamContent, setStreamContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState(null)

  const { runStream, cancel } = useAIStream()
  const { dragging, handleDragStart, restorePosition } = useDraggableFloatingPanel({
    panelRef,
    position,
    setPosition,
    margin: PANEL_MARGIN,
    estimatedWidth: PANEL_WIDTH,
    estimatedHeight: PANEL_ESTIMATED_HEIGHT,
    persistKey: positionPersistKey
  })

  const currentNote = useMemo(
    () => notes.find(note => String(note.id) === String(selectedNoteId)),
    [notes, selectedNoteId]
  )

  const previousConversationIdRef = useRef(currentConversationId)
  const pendingConversationIdRef = useRef(null)
  useEffect(() => {
    if (previousConversationIdRef.current !== currentConversationId) {
      const isSendInitiatedSwitch = (
        pendingConversationIdRef.current &&
        pendingConversationIdRef.current === currentConversationId
      )
      previousConversationIdRef.current = currentConversationId
      if (isSendInitiatedSwitch) {
        return
      }
      cancel()
      setMessages(currentConversation?.messages || [])
      setStreamContent('')
      setInput('')
      setLoading(false)
    }
  }, [cancel, currentConversation, currentConversationId])

  useEffect(() => {
    if (!currentConversationId || previousConversationIdRef.current !== currentConversationId || loading) return
    setMessages(currentConversation?.messages || [])
  }, [currentConversation, currentConversationId, loading])

  const getConversationTitle = useCallback((nextMessages) => {
    const firstUserMessage = nextMessages.find((message) => message.role === 'user')
    if (!firstUserMessage?.content) {
      return currentNote ? `关于「${truncateText(currentNote.title || '未命名', 18)}」` : '新对话'
    }
    const text = firstUserMessage.content.replace(/\n/g, ' ').trim()
    return text.length > 24 ? `${text.slice(0, 24)}…` : text
  }, [currentNote])

  useEffect(() => {
    if (!open) return
    setPosition(prev => prev || restorePosition(getDefaultPosition()))
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [open, restorePosition])

  useEffect(() => {
    if (!open) return
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, streamContent, open])

  const buildContextPackage = useCallback((query) => {
    return buildContextPackageFromNotes({
      notes,
      todos: [],
      memories: [],
      selectedNoteId,
      query,
      contextEnabled: { currentNote: true, relatedNotes: false, todos: false, memories: false }
    })
  }, [notes, selectedNoteId])

  const parseToolResult = useCallback((result) => {
    try {
      return typeof result === 'string' ? JSON.parse(result) : result
    } catch (_) {
      return null
    }
  }, [])

  const handleCancel = useCallback(() => {
    if (loading) cancel()
  }, [cancel, loading])

  const handleNewChat = useCallback(() => {
    if (loading) return
    if (selectedNoteId == null) {
      aiNewChat()
      return
    }
    aiNewChat({
      noteId: selectedNoteId,
      title: currentNote ? `关于「${truncateText(currentNote.title || '未命名', 18)}」` : '新对话'
    })
  }, [aiNewChat, currentNote, loading, selectedNoteId])

  const handleSend = useCallback(async (overridePrompt) => {
    const text = (overridePrompt ?? input).trim()
    if (!text || loading) return

    let conversationId = currentConversationId
    if (!conversationId) {
      conversationId = selectedNoteId == null
        ? aiNewChat()
        : aiEnsureNoteChat(selectedNoteId, {
          title: currentNote ? `关于「${truncateText(currentNote.title || '未命名', 18)}」` : '新对话'
        })
    } else {
      aiSwitchConv(conversationId)
    }
    pendingConversationIdRef.current = conversationId

    const userMsg = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setStreamContent('')
    setLoading(true)
    aiUpdateConv(conversationId, {
      messages: nextMessages,
      title: getConversationTitle(nextMessages),
      noteId: selectedNoteId == null ? null : String(selectedNoteId),
      source: selectedNoteId == null ? 'general' : 'note'
    })

    const apiMessages = nextMessages.map(m => ({ role: m.role, content: m.content }))
    const contextPackage = buildContextPackage(text)
    let shouldReloadNotes = false

    try {
      const whiteboardResult = await handleWhiteboardAIRequest({
        note: currentNote,
        prompt: text,
        messages: nextMessages,
        updateNote,
        loadNotes,
      })

      if (whiteboardResult) {
        const finalMessages = [...nextMessages, {
          role: 'assistant',
          content: whiteboardResult.content,
        }]
        setMessages(finalMessages)
        aiUpdateConv(conversationId, {
          messages: finalMessages,
          title: getConversationTitle(finalMessages),
          noteId: selectedNoteId == null ? null : String(selectedNoteId),
          source: selectedNoteId == null ? 'general' : 'note'
        })
        setStreamContent('')
        return
      }

      const { result, content, cancelledByUser } = await runStream({
        messages: apiMessages,
        contextPackage,
        requestPrefix: 'aicc',
        options: { requireConfirmation: false },
        onContent: setStreamContent,
        onChunk: (chunk) => {
          if (chunk?.type !== 'tool_end') return
          const parsed = parseToolResult(chunk.result)
          if (parsed?.error || parsed?.success === false) {
            logger.warn('[AICommandCenter] tool failed', { name: chunk.name, result: parsed })
          }
          if (['create_note', 'edit_note'].includes(chunk.name) && parsed?.success !== false && !parsed?.error) {
            shouldReloadNotes = true
          }
        },
        onChunkError: (chunk) => setStreamContent(prev => prev + `\n\n⚠️ ${chunk.content}`)
      })

      const stoppedByUser = Boolean(result?.cancelled && cancelledByUser)
      const assistantContent = result?.cancelled
        ? (content || (stoppedByUser ? '已停止生成。' : '❌ 生成已中断，请重试'))
        : result?.success
          ? (content || result.fullContent || '')
          : (content || `❌ ${result?.error || '请求失败'}`)

      const finalMessages = [...nextMessages, {
        role: 'assistant',
        content: assistantContent,
        stopped: stoppedByUser
      }]
      setMessages(finalMessages)
      aiUpdateConv(conversationId, {
        messages: finalMessages,
        title: getConversationTitle(finalMessages),
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note'
      })
      if (shouldReloadNotes) {
        await loadNotes?.()
      }
      setStreamContent('')
    } catch (error) {
      logger.warn('[AICommandCenter] chatStream failed', error)
      const errorMessages = [...nextMessages, {
        role: 'assistant',
        content: `❌ 发生错误: ${error?.message || '未知错误'}`
      }]
      setMessages(errorMessages)
      aiUpdateConv(conversationId, {
        messages: errorMessages,
        title: getConversationTitle(errorMessages),
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note'
      })
      setStreamContent('')
    } finally {
      pendingConversationIdRef.current = null
      setLoading(false)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [aiEnsureNoteChat, aiNewChat, aiSwitchConv, aiUpdateConv, buildContextPackage, currentConversationId, currentNote, getConversationTitle, input, loadNotes, loading, messages, parseToolResult, runStream, selectedNoteId, updateNote])

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const showQuickPrompts = messages.length === 0 && !loading && !streamContent
  const resolvedPosition = position || getDefaultPosition()

  return (
    <FloatingGlassSurface
      ref={panelRef}
      open={open}
      layer="aiPanel"
      ariaLabel="问 AI"
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
        <AIIcon sx={{ fontSize: 16, color: 'primary.main' }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>问 AI</Typography>
        {currentNote && (
          <Chip
            size="small"
            icon={<NoteIcon sx={{ fontSize: 14 }} />}
            label={truncateText(currentNote.title || '未命名', 18)}
            variant="outlined"
            sx={(theme) => ({
              height: 22,
              fontSize: 11,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.18),
              boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.035 : 0.32)}`,
              borderColor: 'transparent',
              '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
              '& .MuiChip-label': { px: 0.75 }
            })}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="新建对话">
          <span>
            <IconButton
              size="small"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={handleNewChat}
              disabled={loading}
              aria-label="新建对话"
              sx={(theme) => ({
                width: 26,
                height: 26,
                mr: 0.25,
                borderRadius: 1,
                color: 'text.secondary',
                '&:hover': {
                  color: 'text.primary',
                  bgcolor: alpha(theme.palette.text.primary, 0.06)
                }
              })}
            >
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
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
      </Box>

      <Box
        ref={scrollRef}
        sx={(theme) => ({
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 1.5,
          py: 1.1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.03 : 0.045)
        })}
      >
        {showQuickPrompts && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="caption" color="text.secondary" sx={{ px: 0.25 }}>
              快速开始
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {QUICK_PROMPTS.map((item) => (
                <Chip
                  key={item.id}
                  size="small"
                  label={item.label}
                  onClick={() => handleSend(item.prompt)}
                  sx={(theme) => ({
                    height: 26,
                    fontSize: 12,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.16),
                    color: 'text.primary',
                    boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.3)}`,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) }
                  })}
                />
              ))}
            </Box>
          </Box>
        )}

        {messages.map((msg, index) => (
          <ChatBubble key={index} msg={msg} userAvatar={resolvedUserAvatar} />
        ))}

        {loading && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Avatar sx={(theme) => ({
              width: 24,
              height: 24,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main
            })}>
              <AIIcon sx={{ fontSize: 14 }} />
            </Avatar>
            <Paper elevation={0} sx={(theme) => ({
              flex: 1,
              minWidth: 0,
              px: 1.25,
              py: 0.75,
              borderRadius: '8px 8px 8px 2px',
              bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.16),
              boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.26)}`,
              fontSize: 13,
              lineHeight: 1.65
            })}>
              {streamContent
                ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{streamContent}</ReactMarkdown>
                : <TypingDots />}
            </Paper>
          </Box>
        )}
      </Box>

      <Box sx={(theme) => ({
        px: 1.25,
        py: 0.9,
        boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.34)}`,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 0.75,
        bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.1)
      })}>
        <TextField
          inputRef={inputRef}
          fullWidth
          multiline
          maxRows={4}
          placeholder={currentNote ? `就「${truncateText(currentNote.title || '未命名', 14)}」问点什么…` : '问 AI 任何问题…'}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          variant="outlined"
          size="small"
          slotProps={{
            input: {
              sx: {
                fontSize: 13,
                borderRadius: 1,
                bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.22 : 0.34),
                backdropFilter: 'blur(14px)'
              }
            }
          }}
          sx={{
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' }
          }}
        />
        <IconButton
          size="small"
          onClick={loading ? handleCancel : () => handleSend()}
          disabled={loading ? false : !input.trim()}
          aria-label={loading ? '停止生成' : '发送'}
          sx={(theme) => ({
            width: 32,
            height: 32,
            borderRadius: 1,
            bgcolor: loading
              ? alpha(theme.palette.error.main, 0.12)
              : (input.trim() ? theme.palette.primary.main : 'transparent'),
            color: loading
              ? theme.palette.error.main
              : (input.trim() ? theme.palette.primary.contrastText : theme.palette.action.disabled),
            '&:hover': {
              bgcolor: loading
                ? alpha(theme.palette.error.main, 0.2)
                : (input.trim() ? theme.palette.primary.dark : 'transparent')
            },
            transition: 'background-color 140ms ease, color 140ms ease'
          })}
        >
          {loading ? <StopIcon sx={{ fontSize: 16 }} /> : <SendIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>
    </FloatingGlassSurface>
  )
}

const ChatBubble = ({ msg, userAvatar }) => {
  const isUser = msg.role === 'user'
  return (
    <Box sx={{
      display: 'flex',
      gap: 1,
      alignItems: 'flex-start',
      flexDirection: isUser ? 'row-reverse' : 'row'
    }}>
      <Avatar
        src={isUser ? userAvatar : undefined}
        sx={(theme) => ({
          width: 24,
          height: 24,
          fontSize: 12,
          bgcolor: isUser ? alpha(theme.palette.text.primary, 0.08) : alpha(theme.palette.primary.main, 0.1),
          color: isUser ? theme.palette.text.primary : theme.palette.primary.main
        })}
      >
        {isUser ? (userAvatar ? null : '我') : <AIIcon sx={{ fontSize: 14 }} />}
      </Avatar>
      <Paper elevation={0} sx={(theme) => ({
        maxWidth: 'calc(100% - 36px)',
        minWidth: 0,
        px: 1.25,
        py: 0.75,
        borderRadius: isUser ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
        bgcolor: isUser
          ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.08)
          : alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.14),
        boxShadow: isUser
          ? 'none'
          : `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.028 : 0.22)}`,
        color: 'text.primary',
        fontSize: 13,
        lineHeight: 1.65,
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
        userSelect: 'text'
      })}>
        {isUser
          ? <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{msg.content}</Typography>
          : (
            <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content || ''}</ReactMarkdown>
            </Box>
          )}
      </Paper>
    </Box>
  )
}

const TypingDots = () => (
  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, py: 0.25 }}>
    {[0, 1, 2].map((i) => (
      <Box
        key={i}
        sx={(theme) => ({
          width: 5,
          height: 5,
          borderRadius: '50%',
          bgcolor: alpha(theme.palette.text.primary, 0.35),
          animation: 'aicc-typing 1.2s infinite ease-in-out',
          animationDelay: `${i * 0.15}s`,
          '@keyframes aicc-typing': {
            '0%, 80%, 100%': { opacity: 0.25, transform: 'translateY(0)' },
            '40%': { opacity: 1, transform: 'translateY(-2px)' }
          }
        })}
      />
    ))}
  </Box>
)

export default AICommandCenter
