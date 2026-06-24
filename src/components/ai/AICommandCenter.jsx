import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
  alpha
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
  Close as CloseIcon,
  DragIndicator as DragIcon,
  Add as AddIcon,
  EditNote as NoteIcon,
  Send as SendIcon,
  Stop as StopIcon,
  Search as SearchIcon,
  CheckCircle as CheckIcon,
  Image as ImageIcon,
  MenuBook as ReadIcon,
  Edit as EditIcon,
  Psychology as MemoryIcon,
  CalendarToday as CalendarIcon
} from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import FloatingGlassSurface from '../common/FloatingGlassSurface'
import FlotaAIIcon from '../common/FlotaAIIcon'
import { useStore } from '../../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import useAIStream from '../../hooks/useAIStream'
import useDraggableFloatingPanel from '../../hooks/useDraggableFloatingPanel'
import { truncateText } from '../../utils/aiContextUtils'
import { routeIntent } from '../../utils/aiCore/intentRouter'
import { buildContext, CONTEXT_PROFILES } from '../../utils/aiCore/contextBuilder'
import { getMessagePendingActions, patchMessagePendingAction } from '../../utils/aiCore/pendingActions'
import { buildMessageMetadata, createUserMessage, createAssistantMessage } from '../../utils/aiCore/messageModel'
import { runPendingAction } from '../../utils/aiCore/pendingActionExecutor'
import logger from '../../utils/logger'

const QUICK_PROMPTS = [
  { id: 'summarize', label: '总结当前笔记', prompt: '请总结当前笔记，输出：核心要点、关键结论、待办事项、潜在风险。' },
  { id: 'next-step', label: '下一步建议', prompt: '基于当前笔记，给我 3 条具体可执行的下一步行动建议。' },
  { id: 'extract-todos', label: '提取待办', prompt: '请从当前笔记提取待办事项，并按优先级排序。' },
  { id: 'related', label: '关联内容', prompt: '找出和当前笔记最相关的笔记、待办和记忆，并简要说明关联原因。' }
]

const mdComponents = {
  p: ({ children }) => (
    <Typography component="div" variant="body2" sx={{ my: 0.4, lineHeight: 1.65 }}>
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

const ACTION_LABELS = {
  create_note: '创建笔记',
  edit_note: '编辑笔记',
  create_whiteboard: '创建画布',
  update_whiteboard: '修改画布',
  create_todo: '创建待办',
  create_todos: '批量创建待办',
  add_memory: '保存记忆',
  update_memory: '更新记忆',
  write_long_document: '生成并保存长文档'
}

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
  const messagesRef = useRef([])
  const conversationIdRef = useRef(null)

  const {
    notes: storeNotes,
    selectedNoteId: storeSelectedNoteId,
    setSelectedNoteId,
    userAvatar,
    aiConversations,
    aiActiveConvId,
    aiNoteConversationMap,
    aiNewChat,
    aiEnsureNoteChat,
    aiSetActiveConv,
    aiUpdateConv,
    createNote: storeCreateNote,
    deleteNote: storeDeleteNote,
    updateNote: storeUpdateNote,
    loadNotes: storeLoadNotes
  } = useStore(useShallow((state) => ({
    notes: state.notes,
    selectedNoteId: state.selectedNoteId,
    setSelectedNoteId: state.setSelectedNoteId,
    userAvatar: state.userAvatar,
    aiConversations: state.aiConversations,
    aiActiveConvId: state.aiActiveConvId,
    aiNoteConversationMap: state.aiNoteConversationMap,
    aiNewChat: state.aiNewChat,
    aiEnsureNoteChat: state.aiEnsureNoteChat,
    aiSetActiveConv: state.aiSetActiveConv,
    aiUpdateConv: state.aiUpdateConv,
    createNote: state.createNote,
    deleteNote: state.deleteNote,
    updateNote: state.updateNote,
    loadNotes: state.loadNotes,
  })))
  const notes = notesOverride ?? storeNotes
  const selectedNoteId = selectedNoteIdOverride !== undefined ? selectedNoteIdOverride : storeSelectedNoteId
  const createNote = storeCreateNote
  const deleteNote = storeDeleteNote
  const updateNote = updateNoteOverride ?? storeUpdateNote
  const loadNotes = loadNotesOverride ?? storeLoadNotes
  const resolvedUserAvatar = userAvatarOverride !== undefined ? userAvatarOverride : userAvatar
  const noteConversationId = selectedNoteId == null ? null : aiNoteConversationMap?.[String(selectedNoteId)] || null
  // 选中了笔记 → 只显示该笔记自己的对话（没有则为空，开新对话）。
  // 未选中任何笔记（通用聊天）→ 跟随全局活动对话。
  // 关键：选中笔记时绝不回退到 aiActiveConvId，否则切到「尚无对话的笔记」会串显示上一条/通用对话。
  const currentConversationId = selectedNoteId != null ? noteConversationId : (aiActiveConvId || null)
  const currentConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === currentConversationId) || null,
    [aiConversations, currentConversationId]
  )

  const [input, setInput] = useState('')
  const [messages, setMessages] = useState(() => currentConversation?.messages || [])
  const [streamContent, setStreamContent] = useState('')
  const [activeTool, setActiveTool] = useState(null)
  // 工具执行可能极快（毫秒级），保证头像至少展示一段时间
  const activeToolClearTimerRef = useRef(null)
  const activeToolStartedAtRef = useRef(0)
  const ACTIVE_TOOL_MIN_DURATION = 1500
  const showActiveTool = useCallback((name) => {
    if (activeToolClearTimerRef.current) {
      window.clearTimeout(activeToolClearTimerRef.current)
      activeToolClearTimerRef.current = null
    }
    activeToolStartedAtRef.current = Date.now()
    setActiveTool(name || null)
  }, [])
  const clearActiveTool = useCallback(() => {
    const elapsed = Date.now() - (activeToolStartedAtRef.current || 0)
    const remaining = Math.max(0, ACTIVE_TOOL_MIN_DURATION - elapsed)
    if (activeToolClearTimerRef.current) {
      window.clearTimeout(activeToolClearTimerRef.current)
      activeToolClearTimerRef.current = null
    }
    if (remaining === 0) {
      setActiveTool(null)
      return
    }
    activeToolClearTimerRef.current = window.setTimeout(() => {
      setActiveTool(null)
      activeToolClearTimerRef.current = null
    }, remaining)
  }, [])
  useEffect(() => () => {
    if (activeToolClearTimerRef.current) window.clearTimeout(activeToolClearTimerRef.current)
  }, [])
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState(null)
  const [thinkingPhrase, setThinkingPhrase] = useState('Thinking… 思考中')
  const [visionEnabled, setVisionEnabled] = useState(false)
  const [executingActionId, setExecutingActionId] = useState(null)

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
    let cancelled = false
    ;(async () => {
      try {
        const r = await window.electronAPI.ai.getConfig()
        if (!cancelled && r?.success) setVisionEnabled(Boolean(r.data?.visionEnabled))
      } catch (e) {
        logger.warn('[AICommandCenter] load vision setting failed', e?.message)
      }
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (previousConversationIdRef.current !== currentConversationId) {
      const isSendInitiatedSwitch = (
        pendingConversationIdRef.current &&
        pendingConversationIdRef.current === currentConversationId
      )
      previousConversationIdRef.current = currentConversationId
      conversationIdRef.current = currentConversationId
      if (isSendInitiatedSwitch) {
        return
      }
      cancel()
      setMessages(currentConversation?.messages || [])
      messagesRef.current = currentConversation?.messages || []
      setStreamContent('')
      setInput('')
      setLoading(false)
    }
  }, [cancel, currentConversation, currentConversationId])

  useEffect(() => {
    if (!currentConversationId || previousConversationIdRef.current !== currentConversationId || loading) return
    setMessages(currentConversation?.messages || [])
    messagesRef.current = currentConversation?.messages || []
  }, [currentConversation, currentConversationId, loading])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // loading 期间定时轮换 thinking 短语，间隔较长避免视觉抖动
  useEffect(() => {
    if (!loading) return undefined
    const id = window.setInterval(() => setThinkingPhrase(pickThinkingPhrase()), 3500)
    return () => window.clearInterval(id)
  }, [loading])

  const getConversationTitle = useCallback((nextMessages) => {
    const firstUserMessage = nextMessages.find((message) => message.role === 'user')
    if (!firstUserMessage?.content) {
      return currentNote ? `关于「${truncateText(currentNote.title || '未命名', 18)}」` : '新对话'
    }
    // content 可能是多模态数组（文本 + 图片），直接 .replace 会抛 TypeError，这里兼容取文本。
    const raw = Array.isArray(firstUserMessage.content)
      ? (firstUserMessage.content.find((p) => p?.type === 'text')?.text || '[图片]')
      : firstUserMessage.content
    const text = String(raw).replace(/\n/g, ' ').trim()
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
    if (!node) return
    // 只在用户已经接近底部时才自动跟随，避免强行把上滑查看的用户拽回底部
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    if (distance <= 80) node.scrollTop = node.scrollHeight
  }, [messages, streamContent, open])

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

  const handleExecuteAction = useCallback(async (action, overrides = null) => {
    if (!action?.actionId || executingActionId) return
    setExecutingActionId(action.actionId)
    const persist = (msgs) => {
      messagesRef.current = msgs
      setMessages(msgs)
      if (conversationIdRef.current) {
        aiUpdateConv(conversationIdRef.current, {
          messages: msgs,
          title: getConversationTitle(msgs),
          noteId: selectedNoteId == null ? null : String(selectedNoteId),
          source: selectedNoteId == null ? 'general' : 'note'
        })
      }
    }
    persist((messagesRef.current || []).map((m) =>
      patchMessagePendingAction(m, action.actionId, { status: 'running' })
    ))
    try {
      const { success, message, error, reloadNotes } = await runPendingAction({
        action,
        overrides,
        deps: { currentNote, notes, createNote, deleteNote, updateNote, loadNotes, setSelectedNoteId },
      })
      const okText = success ? `✅ ${message}` : `❌ ${message}`
      persist((messagesRef.current || []).map((m) => {
        const patched = patchMessagePendingAction(m, action.actionId, {
          status: success ? 'done' : 'failed',
          resultMessage: okText,
        })
        if (patched === m) return m
        return success
          ? { ...patched, content: `${m.content || ''}\n\n${okText}`.trim() }
          : patched
      }))
      if (reloadNotes) await loadNotes?.()
      if (!success) logger.warn('[AICommandCenter] executePendingAction failed', error)
    } finally {
      setExecutingActionId(null)
    }
  }, [aiUpdateConv, createNote, currentNote, deleteNote, executingActionId, getConversationTitle, loadNotes, notes, selectedNoteId, setSelectedNoteId, updateNote])

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
      // 仅高亮当前对话，绝不联动 selectedNoteId（否则会把编辑器正在显示的笔记切走/切成空白页）
      aiSetActiveConv(conversationId)
    }
    pendingConversationIdRef.current = conversationId
    conversationIdRef.current = conversationId

    // 该请求归属的对话；用户切走后旧请求只更新持久化数据，不写当前视图，避免“串台”。
    const isActiveView = () => conversationIdRef.current === conversationId

    const userMsg = createUserMessage({
      content: text,
      metadata: buildMessageMetadata({
        conversationId,
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note',
      }),
    })
    const nextMessages = [...(messagesRef.current || []), userMsg]
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    setInput('')
    setStreamContent('')
    setThinkingPhrase(pickThinkingPhrase())
    setLoading(true)
    aiUpdateConv(conversationId, {
      messages: nextMessages,
      title: getConversationTitle(nextMessages),
      noteId: selectedNoteId == null ? null : String(selectedNoteId),
      source: selectedNoteId == null ? 'general' : 'note'
    })

    let shouldReloadNotes = false
    const pendingActions = []

    try {
      const apiMessages = nextMessages.map(m => ({ role: m.role, content: m.content }))
      const { disabledTools, needClarification, clarifyQuestion } = await routeIntent({
        prompt: text,
        messages: nextMessages,
        currentNote,
      })
      if (needClarification) {
        const finalMessages = [...nextMessages, { role: 'assistant', content: clarifyQuestion }]
        messagesRef.current = finalMessages
        if (isActiveView()) {
          setMessages(finalMessages)
          setStreamContent('')
        }
        aiUpdateConv(conversationId, {
          messages: finalMessages,
          title: getConversationTitle(finalMessages),
          noteId: selectedNoteId == null ? null : String(selectedNoteId),
          source: selectedNoteId == null ? 'general' : 'note'
        })
        return
      }
      const contextPackage = await buildContext({ notes, selectedNoteId, query: text, contextEnabled: CONTEXT_PROFILES.floating_panel })

      const { result, content, cancelledByUser, requestId } = await runStream({
        conversationId,
        messages: apiMessages,
        contextPackage,
        requestPrefix: 'aicc',
        options: {
          scene: 'floating_panel',
          memoryQuery: text,
          requireConfirmation: true,
          actionContext: {
            selectedNoteId: selectedNoteId == null ? null : String(selectedNoteId),
            source: selectedNoteId == null ? 'general' : 'note',
          },
          disabledTools: visionEnabled ? disabledTools : [...(disabledTools || []), 'read_note_image'],
        },
        onContent: (c) => { if (isActiveView()) setStreamContent(c) },
        onChunk: (chunk) => {
          if (chunk?.type === 'tool_start') {
            showActiveTool(chunk.name || null)
            return
          }
          if (chunk?.type !== 'tool_end') return
          clearActiveTool()
          const parsed = parseToolResult(chunk.result)
          if (parsed?.error || parsed?.success === false) {
            logger.warn('[AICommandCenter] tool failed', { name: chunk.name, result: parsed })
          }
          if (parsed?.requiresConfirmation && parsed?.actionId) {
            pendingActions.push({
              actionId: parsed.actionId,
              name: chunk.name,
              args: parsed.args || {},
              context: parsed.context || null,
              summary: parsed.summary,
              label: parsed.label
            })
          }
          if (['create_note', 'edit_note'].includes(chunk.name) && parsed?.success !== false && !parsed?.error) {
            shouldReloadNotes = true
          }
        },
        onChunkError: (chunk) => { if (isActiveView()) setStreamContent(prev => prev + `\n\n⚠️ ${chunk.content}`) }
      })

      const stoppedByUser = Boolean(result?.cancelled && cancelledByUser)
      const assistantContentBase = result?.cancelled
        ? (content || (stoppedByUser ? '已停止生成。' : '❌ 生成已中断，请重试'))
        : result?.success
          ? (result.fullContent || content || '')
          : (content || `❌ ${result?.error || '请求失败'}`)
      const truncatedHint = result?.outputLimitApplied
        ? '⚠️ 回复达到当前最大 token 限制，可能未完整输出。可以在高级设置里调高最大输出长度，或发送“继续”。'
        : '⚠️ 回复达到模型或服务商的输出上限，可能未完整输出。可以发送“继续”让 AI 接着写。'
      const assistantContent = result?.truncated
        ? `${assistantContentBase}\n\n${truncatedHint}`
        : assistantContentBase

      const finalMessages = [...nextMessages, createAssistantMessage({
        content: assistantContent,
        stopped: stoppedByUser,
        actions: pendingActions,
        metadata: buildMessageMetadata({
          conversationId,
          noteId: selectedNoteId == null ? null : String(selectedNoteId),
          source: selectedNoteId == null ? 'general' : 'note',
          requestId,
        }),
      })]
      messagesRef.current = finalMessages
      if (isActiveView()) {
        setMessages(finalMessages)
        setStreamContent('')
      }
      aiUpdateConv(conversationId, {
        messages: finalMessages,
        title: getConversationTitle(finalMessages),
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note'
      })
      if (shouldReloadNotes) {
        await loadNotes?.()
      }
    } catch (error) {
      logger.warn('[AICommandCenter] chatStream failed', error)
      const errorMessages = [...nextMessages, {
        role: 'assistant',
        content: `❌ 发生错误: ${error?.message || '未知错误'}`
      }]
      messagesRef.current = errorMessages
      if (isActiveView()) {
        setMessages(errorMessages)
        setStreamContent('')
      }
      aiUpdateConv(conversationId, {
        messages: errorMessages,
        title: getConversationTitle(errorMessages),
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note'
      })
    } finally {
      pendingConversationIdRef.current = null
      setActiveTool(null)
      setLoading(false)
      if (isActiveView()) window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [aiEnsureNoteChat, aiNewChat, aiSetActiveConv, aiUpdateConv, clearActiveTool, currentConversationId, currentNote, getConversationTitle, input, loadNotes, loading, notes, parseToolResult, runStream, selectedNoteId, showActiveTool, visionEnabled])

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
        <FlotaAIIcon sx={{ fontSize: 18 }} />
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
          <ChatBubble
            key={index}
            msg={msg}
            userAvatar={resolvedUserAvatar}
            executingActionId={executingActionId}
            onExecuteAction={handleExecuteAction}
          />
        ))}

        {loading && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Avatar sx={(theme) => ({
              width: 24,
              height: 24,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main
            })}>
              <LoadingAvatarContent activeTool={activeTool} />
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
                : (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <TypewriterText text={thinkingPhrase} />
                  </Box>
                )}
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

const BatchTodoActionCard = ({ action, theme, executing, onExecute }) => {
  const initialTodos = Array.isArray(action.args?.todos) ? action.args.todos : []
  const [localTodos, setLocalTodos] = useState(() =>
    initialTodos.map((t, i) => ({ ...t, _key: `${i}-${t.content || ''}`, _selected: true }))
  )
  const intro = action.args?.intro || ''
  const selectedCount = localTodos.filter((t) => t._selected).length
  const toggle = (key) => setLocalTodos((p) => p.map((t) => t._key === key ? { ...t, _selected: !t._selected } : t))
  const remove = (key) => setLocalTodos((p) => p.filter((t) => t._key !== key))
  const submit = () => {
    const final = localTodos.filter((t) => t._selected).map(({ _key, _selected, ...rest }) => rest)
    if (final.length === 0) return
    onExecute?.(action, { todos: final })
  }
  const formatDue = (s) => {
    if (!s) return ''
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return (
    <Paper
      elevation={0}
      sx={{
        mt: 0.75,
        px: 1.1,
        py: 0.85,
        borderRadius: '12px',
        border: '1px solid',
        borderColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.28 : 0.26),
        bgcolor: theme.palette.mode === 'dark'
          ? alpha(theme.palette.warning.dark, 0.12)
          : alpha(theme.palette.warning.light, 0.16),
      }}
    >
      <Typography variant="caption" sx={{ display: 'block', color: 'warning.main', fontWeight: 800, mb: 0.5 }}>
        AI 为你规划了 {localTodos.length} 条待办
      </Typography>
      {intro && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5, lineHeight: 1.45, fontSize: 12 }}>
          {intro}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, maxHeight: 220, overflowY: 'auto', pr: 0.5 }}>
        {localTodos.map((t) => (
          <Box
            key={t._key}
            sx={{
              display: 'flex', alignItems: 'flex-start', gap: 0.6,
              px: 0.6, py: 0.45, borderRadius: '8px',
              bgcolor: t._selected
                ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.1 : 0.08)
                : alpha(theme.palette.action.disabledBackground, 0.4),
              opacity: t._selected ? 1 : 0.55,
            }}
          >
            <Box
              component="input"
              type="checkbox"
              checked={t._selected}
              onChange={() => toggle(t._key)}
              sx={{ mt: 0.35, cursor: 'pointer', accentColor: theme.palette.warning.main }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35, fontSize: 12.5, wordBreak: 'break-word' }}>
                {t.content}
              </Typography>
              {t.description && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2, lineHeight: 1.35, fontSize: 11 }}>
                  {t.description}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 0.3, mt: 0.3, flexWrap: 'wrap' }}>
                {t.due_date && <Chip size="small" label={formatDue(t.due_date)} sx={{ height: 16, fontSize: '0.65rem' }} />}
                {t.is_important && <Chip size="small" label="重要" color="error" sx={{ height: 16, fontSize: '0.65rem' }} />}
                {t.is_urgent && <Chip size="small" label="紧急" color="warning" sx={{ height: 16, fontSize: '0.65rem' }} />}
              </Box>
            </Box>
            <IconButton size="small" onClick={() => remove(t._key)} sx={{ p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.75 }}>
        <Button
          size="small"
          variant="contained"
          color="warning"
          onClick={submit}
          disabled={executing || selectedCount === 0}
          sx={{ minWidth: 88, height: 28, borderRadius: '999px', textTransform: 'none', fontWeight: 700 }}
        >
          {executing ? '添加中…' : `添加 ${selectedCount} 条`}
        </Button>
      </Box>
    </Paper>
  )
}

const SimpleActionCard = ({ action, theme, executing, onExecute }) => {
  const status = action.status || (executing ? 'running' : 'pending')
  const isDone = status === 'done'
  const isFailed = status === 'failed'
  const paletteKey = isDone ? 'success' : isFailed ? 'error' : 'warning'
  const title = isDone ? '已完成' : isFailed ? '执行失败' : executing ? '执行中' : '待你确认'
  const detail = action.resultMessage || action.summary || action.label || ACTION_LABELS[action.name] || action.name

  return (
    <Paper
      elevation={0}
      sx={{
        mt: 0.75,
        px: 1.1,
        py: 0.75,
        borderRadius: '12px',
        border: '1px solid',
        borderColor: alpha(theme.palette[paletteKey].main, theme.palette.mode === 'dark' ? 0.28 : 0.26),
        bgcolor: theme.palette.mode === 'dark'
          ? alpha(theme.palette[paletteKey].dark, 0.12)
          : alpha(theme.palette[paletteKey].light, 0.16),
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.75
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: 'block', color: `${paletteKey}.main`, fontWeight: 800, mb: 0.25 }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.4, fontSize: 12.5, wordBreak: 'break-word' }}>
          {detail}
        </Typography>
      </Box>
      {!isDone && !isFailed && (
        <Button
          size="small"
          variant="contained"
          color="warning"
          onClick={() => onExecute?.(action)}
          disabled={executing}
          sx={{ flexShrink: 0, minWidth: 72, height: 26, borderRadius: '999px', textTransform: 'none', fontWeight: 700 }}
        >
          {executing ? '执行中…' : '确认'}
        </Button>
      )}
    </Paper>
  )
}

const ChatBubble = ({ msg, userAvatar, executingActionId, onExecuteAction }) => {
  const theme = useTheme()
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
        {isUser ? (userAvatar ? null : '我') : <FlotaAIIcon sx={{ fontSize: 16 }} />}
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
        {(() => {
          const c = msg.content
          const text = Array.isArray(c)
            ? c.filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n')
            : (c || '')
          const images = Array.isArray(c) ? c.filter((p) => p?.type === 'image_url') : []
          return isUser ? (
            <>
              {images.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: text ? 0.75 : 0 }}>
                  {images.map((p, i) => (
                    <Box key={i} component="img" src={p.image_url?.url} sx={{ maxWidth: 140, maxHeight: 140, borderRadius: 1, objectFit: 'cover' }} />
                  ))}
                </Box>
              )}
              {text && <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{text}</Typography>}
            </>
          ) : (
            <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
              {/* 待确认动作卡（统一读取 msg.actions 与历史 toolCalls[].action） */}
              {getMessagePendingActions(msg).map((action) => (
                action.name === 'create_todos' ? (
                  <BatchTodoActionCard
                    key={action.actionId}
                    action={action}
                    theme={theme}
                    executing={executingActionId === action.actionId}
                    onExecute={onExecuteAction}
                  />
                ) : (
                  <SimpleActionCard
                    key={action.actionId}
                    action={action}
                    theme={theme}
                    executing={executingActionId === action.actionId}
                    onExecute={onExecuteAction}
                  />
                )
              ))}
            </Box>
          )
        })()}
      </Paper>
    </Box>
  )
}

const THINKING_PHRASES = [
  'Absorbing', 'Aggregating', 'Aligning', 'Analyzing', 'Assembling',
  'Baking', 'Blending', 'Brewing', 'Building', 'Bundling',
  'Calculating', 'Churning', 'Clustering', 'Coalescing', 'Composing',
  'Compressing', 'Computing', 'Crunching', 'Smooshing',
  'Decoding', 'Decomposing', 'Diagnosing', 'Digesting',
  'Encoding', 'Evaluating', 'Exploring', 'Extracting',
  'Filtering', 'Formatting', 'Formulating',
  'Generating', 'Gathering', 'Grokking',
  'Hashing', 'Harvesting',
  'Indexing', 'Inferring', 'Initializing', 'Integrating', 'Iterating',
  'Joining', 'Judging',
  'Loading', 'Linking', 'Layering',
  'Mapping', 'Matching', 'Merging', 'Mining', 'Modelling',
  'Normalizing', 'Narrowing',
  'Optimizing', 'Organizing',
  'Parsing', 'Processing', 'Polishing', 'Programming', 'Projecting',
  'Quantizing', 'Querying', 'Queueing',
  'Rendering', 'Refactoring', 'Retrieving', 'Routing',
  'Sampling', 'Scraping', 'Searching', 'Sorting', 'Synthesizing', 'Solving',
  'Translating', 'Traversing', 'Tracing', 'Trimming',
  'Updating', 'Unifying',
  'Validating', 'Vectorizing', 'Verifying',
  'Weaving', 'Wrangling',
]

const recentThinkingPhrases = []
const RECENT_PHRASE_MEMORY = 8
const pickThinkingPhrase = () => {
  if (THINKING_PHRASES.length <= 1) return THINKING_PHRASES[0] || ''
  const memory = Math.min(RECENT_PHRASE_MEMORY, THINKING_PHRASES.length - 1)
  let next
  do {
    next = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)]
  } while (recentThinkingPhrases.includes(next))
  recentThinkingPhrases.push(next)
  while (recentThinkingPhrases.length > memory) recentThinkingPhrases.shift()
  return next
}

const TOOL_AVATAR_ICON = {
  search_notes: SearchIcon,
  web_search: SearchIcon,
  get_current_note: NoteIcon,
  read_current_note: ReadIcon,
  read_note_image: ImageIcon,
  search_in_current_note: SearchIcon,
  summarize_current_note_section: ReadIcon,
  create_note: NoteIcon,
  edit_note: EditIcon,
  write_long_document: NoteIcon,
  search_todos: CheckIcon,
  get_today_todos: CalendarIcon,
  create_todo: CheckIcon,
  search_memory: MemoryIcon,
  add_memory: MemoryIcon,
  update_memory: MemoryIcon,
  list_memories: MemoryIcon,
}

// 切换短语时直接换内容并伴随淡入动画，避免中间整段透明导致的"空白"
const TypewriterText = ({ text }) => {
  const [display, setDisplay] = useState(text || '')
  const [animKey, setAnimKey] = useState(0)
  useEffect(() => {
    const next = text || ''
    if (next === display) return
    setDisplay(next)
    setAnimKey((k) => k + 1)
  }, [text, display])
  return (
    <Typography
      key={animKey}
      component="span"
      variant="caption"
      sx={(theme) => ({
        fontSize: 12,
        lineHeight: 1.4,
        color: alpha(theme.palette.text.primary, 0.7),
        animation: 'aicc-phrase-fade 280ms ease',
        '@keyframes aicc-phrase-fade': {
          '0%': { opacity: 0, transform: 'translateY(2px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' }
        }
      })}
    >
      {display}
      <Box component="span" sx={{ opacity: 0.5, ml: 0.25 }}>…</Box>
    </Typography>
  )
}

const ThinkingDots = ({ dotSize = 4, gap = 3 }) => (
  <Box
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: `${gap}px`,
      '@keyframes aicc-thinking-dot': {
        '0%, 80%, 100%': { opacity: 0.35, transform: 'translateY(0) scale(0.92)' },
        '40%': { opacity: 1, transform: 'translateY(-1.5px) scale(1)' }
      }
    }}
  >
    {[0, 1, 2].map((i) => (
      <Box
        key={i}
        component="span"
        sx={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          bgcolor: 'currentColor',
          animation: 'aicc-thinking-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.16}s`
        }}
      />
    ))}
  </Box>
)

// 头像内容根据 activeTool 在「三点动画」与「对应工具图标」之间淡入切换
const LoadingAvatarContent = ({ activeTool }) => {
  const targetKey = activeTool && TOOL_AVATAR_ICON[activeTool] ? activeTool : '__dots__'
  const Icon = targetKey !== '__dots__' ? TOOL_AVATAR_ICON[targetKey] : null
  return (
    <Box
      key={targetKey}
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'inherit',
        animation: 'aicc-avatar-fade 280ms ease',
        '@keyframes aicc-avatar-fade': {
          '0%': { opacity: 0, transform: 'scale(0.85)' },
          '100%': { opacity: 1, transform: 'scale(1)' }
        }
      }}
    >
      {Icon ? <Icon sx={{ fontSize: 14 }} /> : <ThinkingDots />}
    </Box>
  )
}

export default AICommandCenter
