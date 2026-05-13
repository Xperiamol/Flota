import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box, Typography, TextField, IconButton, Paper, CircularProgress,
  Chip, Fade, Avatar, Menu, MenuItem, Button, Tooltip
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import {
  Send as SendIcon,
  AutoAwesome as SparkleIcon,
  ContentCopy as CopyIcon,
  Search as SearchIcon,
  CheckCircle as CheckIcon,
  NoteAlt as NoteIcon,
  Psychology as MemoryIcon,
  CalendarToday as CalendarIcon,
  Edit as EditIcon,
  Stop as StopIcon,
} from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'
import { buildContextPackageFromNotes, getContextSources, truncateText } from '../utils/aiContextUtils'

// ─── Markdown 渲染（react-markdown + remark-gfm） ───

const mdComponents = {
  h1: ({ children }) => <Typography variant="h6" sx={{ mt: 1.5, mb: 0.5, fontWeight: 700, lineHeight: 1.4 }}>{children}</Typography>,
  h2: ({ children }) => <Typography variant="subtitle1" sx={{ mt: 1.5, mb: 0.5, fontWeight: 700, lineHeight: 1.4 }}>{children}</Typography>,
  h3: ({ children }) => <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5, fontWeight: 700, lineHeight: 1.4 }}>{children}</Typography>,
  p: ({ children }) => <Typography component="p" variant="body2" sx={{ my: 0.5, lineHeight: 1.7 }}>{children}</Typography>,
  ul: ({ children }) => <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>{children}</Box>,
  ol: ({ children }) => <Box component="ol" sx={{ pl: 2.5, my: 0.5 }}>{children}</Box>,
  li: ({ children }) => <Box component="li" sx={{ mb: 0.25, '& p': { my: 0 } }}>{children}</Box>,
  blockquote: ({ children }) => (
    <Box sx={{ borderLeft: '3px solid', borderColor: 'primary.main', pl: 1.5, my: 1, opacity: 0.85 }}>
      {children}
    </Box>
  ),
  code: ({ inline, children }) => inline
    ? <Box component="code" sx={{ bgcolor: 'action.hover', px: '5px', py: '1px', borderRadius: '3px', fontSize: '0.85em', fontFamily: 'monospace' }}>{children}</Box>
    : null,
  pre: ({ children }) => (
    <Box component="pre" sx={{
      bgcolor: 'action.hover', borderRadius: 1, p: 1.5, my: 1,
      overflow: 'auto', fontSize: '0.82rem', fontFamily: 'monospace',
      lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      userSelect: 'text',
    }}>
      {children}
    </Box>
  ),
  table: ({ children }) => (
    <Box sx={{ overflowX: 'auto', my: 1 }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>{children}</Box>
    </Box>
  ),
  th: ({ children }) => <Box component="th" sx={{ border: '1px solid', borderColor: 'divider', px: 1.5, py: 0.75, fontWeight: 600, bgcolor: 'action.hover', textAlign: 'left' }}>{children}</Box>,
  td: ({ children }) => <Box component="td" sx={{ border: '1px solid', borderColor: 'divider', px: 1.5, py: 0.75 }}>{children}</Box>,
  hr: () => <Box component="hr" sx={{ border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 1.5 }} />,
  a: ({ href, children }) => <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>{children}</Box>,
  strong: ({ children }) => <Box component="strong" sx={{ fontWeight: 700 }}>{children}</Box>,
  em: ({ children }) => <Box component="em" sx={{ fontStyle: 'italic' }}>{children}</Box>,
  del: ({ children }) => <Box component="del" sx={{ opacity: 0.6 }}>{children}</Box>,
}

const MarkdownContent = React.memo(({ content }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
    {content}
  </ReactMarkdown>
))

// ─── 工具调用相关常量 ───

const TOOL_ICONS = {
  search_notes: <SearchIcon fontSize="small" />,
  get_current_note: <NoteIcon fontSize="small" />,
  create_note: <NoteIcon fontSize="small" />,
  edit_note: <EditIcon fontSize="small" />,
  search_todos: <CheckIcon fontSize="small" />,
  get_today_todos: <CalendarIcon fontSize="small" />,
  create_todo: <CheckIcon fontSize="small" />,
  search_memory: <MemoryIcon fontSize="small" />,
  add_memory: <MemoryIcon fontSize="small" />,
  list_memories: <MemoryIcon fontSize="small" />,
}

const TOOL_LABELS = {
  search_notes: '搜索笔记',
  get_current_note: '读取当前笔记',
  create_note: '创建笔记',
  edit_note: '编辑笔记',
  search_todos: '搜索待办',
  get_today_todos: '获取今日待办',
  create_todo: '创建待办',
  search_memory: '搜索记忆',
  add_memory: '保存记忆',
  list_memories: '查看记忆库',
}

const QUICK_ACTIONS = [
  { label: '📋 今日待办', prompt: '帮我看看今天有哪些待办事项' },
  { label: '📝 总结笔记', prompt: '帮我总结一下当前笔记的要点' },
  { label: '🔍 搜索记忆', prompt: '搜索我的记忆库' },
  { label: '✨ 新建笔记', prompt: '帮我创建一个新笔记' },
  { label: '🧭 规划任务', prompt: '根据当前上下文，帮我拆解下一步行动计划' },
  { label: '🔗 关联笔记', prompt: '找出和当前笔记最相关的内容，并说明关联原因' },
]

const CONTEXT_OPTIONS = [
  { key: 'currentNote', label: '当前笔记' },
  { key: 'relatedNotes', label: '相关笔记' },
  { key: 'todos', label: '近期待办' },
  { key: 'memories', label: '相关记忆' },
]

// ─── 聊天消息组件 ───

const ChatMessage = React.memo(({ msg, theme, userAvatar, onExecuteAction, executingActionId, onSaveAsNote, onAskFollowUp, onOpenSource }) => {
  const isUser = msg.role === 'user'

  return (
    <Fade in timeout={300}>
      <Box sx={{
        display: 'flex',
        gap: 1.5,
        mb: 2,
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
      }}>
        <Avatar
          sx={{
            width: 32, height: 32,
            bgcolor: isUser
              ? (userAvatar ? 'transparent' : theme.palette.primary.main)
              : alpha(theme.palette.primary.main, 0.1),
            color: isUser ? theme.palette.primary.contrastText : theme.palette.primary.main,
          }}
          {...(isUser && userAvatar ? { src: userAvatar } : {})}
        >
          {isUser ? null : <SparkleIcon sx={{ fontSize: 18 }} />}
        </Avatar>

        <Box sx={{ maxWidth: '80%', minWidth: 0 }}>
          {/* 工具调用指示器 */}
          {msg.toolCalls?.map((tc, i) => (
            <Box key={`${tc.name}-${i}`} sx={{ mb: 0.75 }}>
              <Tooltip title={tc.summary || tc.error || 'AI 正在调用应用能力'} arrow>
                <Chip
                  size="small"
                  icon={TOOL_ICONS[tc.name] || <SparkleIcon fontSize="small" />}
                  label={`${TOOL_LABELS[tc.name] || tc.name}${tc.action ? ' · 待确认' : tc.done ? ' ✓' : '...'}`}
                  variant="outlined"
                  color={tc.action ? 'warning' : tc.done ? 'success' : 'default'}
                  sx={{ mr: 0.5, height: 24, fontSize: '0.75rem' }}
                />
              </Tooltip>
              {tc.action && (
                <Paper
                  elevation={0}
                  sx={{
                    mt: 0.75,
                    p: 1,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: alpha(theme.palette.warning.main, 0.35),
                    bgcolor: alpha(theme.palette.warning.main, 0.08),
                  }}
                >
                  <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                    待你确认：{tc.action.summary || tc.action.label}
                  </Typography>
                  {tc.action.memoryReview?.summary && (
                    <Box sx={{ mb: 0.75 }}>
                      <Typography variant="caption" color={tc.action.memoryReview.level === 'warning' ? 'warning.main' : 'text.secondary'} sx={{ display: 'block' }}>
                        {tc.action.memoryReview.summary}
                      </Typography>
                      {tc.action.memoryReview.candidates?.slice(0, 2).map(candidate => (
                        <Typography key={candidate.id || candidate.content} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1, mt: 0.25 }}>
                          相似记忆：{candidate.content}
                        </Typography>
                      ))}
                    </Box>
                  )}
                  <Button
                    size="small"
                    variant="contained"
                    color="warning"
                    disabled={executingActionId === tc.action.actionId}
                    onClick={() => onExecuteAction?.(tc.action)}
                    sx={{ borderRadius: 2, textTransform: 'none' }}
                  >
                    {executingActionId === tc.action.actionId ? '执行中…' : '确认执行'}
                  </Button>
                </Paper>
              )}
            </Box>
          ))}

          {/* 消息内容 */}
          {msg.content && (
            <Paper
              elevation={0}
              sx={{
                px: 2, py: 1.5,
                borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                bgcolor: isUser
                  ? theme.palette.primary.main
                  : theme.palette.mode === 'dark' ? alpha(theme.palette.background.paper, 0.8) : alpha(theme.palette.grey[100], 0.8),
                color: isUser ? theme.palette.primary.contrastText : theme.palette.text.primary,
                backdropFilter: 'blur(8px)',
                lineHeight: 1.6,
                fontSize: '0.9rem',
                wordBreak: 'break-word',
                userSelect: 'text',
              }}
            >
              <Box sx={{ userSelect: 'text', cursor: 'text', '& > p:first-of-type': { mt: 0 }, '& > p:last-of-type': { mb: 0 } }}>
                <MarkdownContent content={msg.content} />
              </Box>
            </Paper>
          )}
          {!isUser && msg.content && (
            <Box sx={{ display: 'flex', gap: 0.75, mt: 0.75, flexWrap: 'wrap', opacity: 0.9 }}>
              <Chip size="small" label="存为笔记" onClick={() => onSaveAsNote?.(msg.content)} variant="outlined" sx={{ height: 24 }} />
              <Chip size="small" label="继续追问" onClick={() => onAskFollowUp?.(msg.content)} variant="outlined" sx={{ height: 24 }} />
            </Box>
          )}
          {!isUser && msg.contextSources?.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>
              {msg.contextSources.map(source => (
                <Chip
                  key={`${source.type}-${source.id || source.title}`}
                  size="small"
                  label={source.label}
                  clickable={Boolean(source.id && source.type !== 'memory')}
                  onClick={() => source.id && source.type !== 'memory' && onOpenSource?.(source.id)}
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.7rem', opacity: 0.75 }}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Fade>
  )
})

export default function AIChatView({ onTodoUpdated }) {
  const theme = useTheme()
  const { userAvatar, notes, selectedNoteId, setSelectedNoteId, aiConversations, aiActiveConvId, aiNewChat, aiUpdateConv, aiCommandRequest, aiClearCommandRequest, loadNotes } = useStore()

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [toolCalls, setToolCalls] = useState([])
  const [contextEnabled, setContextEnabled] = useState({ currentNote: true, relatedNotes: true, todos: true, memories: true })
  const [executingActionId, setExecutingActionId] = useState(null)
  const [messageContextMenu, setMessageContextMenu] = useState(null)
  const [inputContextMenu, setInputContextMenu] = useState(null)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const chunkListenerRef = useRef(null)
  const activeRequestIdRef = useRef(null)

  // 切换对话时加载消息
  useEffect(() => {
    const conv = aiConversations.find(c => c.id === aiActiveConvId)
    setMessages(conv?.messages || [])
    setStreamContent('')
    setToolCalls([])
    setInput('')
  }, [aiActiveConvId, aiConversations])

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamContent, scrollToBottom])

  // 清理 chunk 监听器
  useEffect(() => {
    return () => {
      if (chunkListenerRef.current) {
        chunkListenerRef.current()
        chunkListenerRef.current = null
      }
    }
  }, [])

  const getConversationTitle = (msgs) => {
    const first = msgs.find(m => m.role === 'user')
    if (!first) return '新对话'
    const text = first.content.replace(/\n/g, ' ').trim()
    return text.length > 24 ? text.slice(0, 24) + '…' : text
  }

  const buildContextPackage = useCallback((query, todos = [], memories = []) => {
    return buildContextPackageFromNotes({ notes, todos, memories, selectedNoteId, query, contextEnabled })
  }, [contextEnabled, notes, selectedNoteId])

  const parseToolResult = (result) => {
    try {
      return typeof result === 'string' ? JSON.parse(result) : result
    } catch (_) {
      return null
    }
  }

  // 发送消息
  const handleSend = useCallback(async (customPrompt) => {
    const text = (customPrompt || input).trim()
    if (!text || loading) return

    // 无活跃对话则自动新建
    let currentId = aiActiveConvId
    if (!currentId) {
      currentId = aiNewChat()
    }

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setStreamContent('')
    setToolCalls([])

    // 持久化用户消息
    aiUpdateConv(currentId, { messages: newMessages, title: getConversationTitle(newMessages) })

    const requestId = `${currentId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    activeRequestIdRef.current = requestId

    // 构建发送给 API 的消息（只含 role + content）
    const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))
    let todoContext = []
    let memoryContext = []
    if (contextEnabled.todos) {
      try {
        const todoResult = await window.electronAPI?.todos?.getAll?.({ includeCompleted: false, limit: 100 })
        todoContext = Array.isArray(todoResult?.data) ? todoResult.data : Array.isArray(todoResult) ? todoResult : []
      } catch (_) {
        todoContext = []
      }
    }
    if (contextEnabled.memories) {
      try {
        const memoryQuery = truncateText(text, 260)
        const memoryResult = await window.electronAPI?.mem0?.search?.({
          userId: 'current_user',
          query: memoryQuery,
          options: { limit: 5 }
        })
        memoryContext = Array.isArray(memoryResult?.results) ? memoryResult.results : []
      } catch (_) {
        memoryContext = []
      }
    }
    const contextPackage = buildContextPackage(text, todoContext, memoryContext)

    try {
      // 注册 chunk 监听
      if (chunkListenerRef.current) chunkListenerRef.current()
      let currentContent = ''
      let currentToolCalls = []

      chunkListenerRef.current = window.electronAPI.ai.onChatChunk((chunk) => {
        if (!chunk || chunk.requestId !== activeRequestIdRef.current) {
          return
        }

        switch (chunk.type) {
          case 'content':
            currentContent += chunk.content
            setStreamContent(currentContent)
            break
          case 'tool_start':
            currentToolCalls = [...currentToolCalls, { name: chunk.name, args: chunk.args, done: false }]
            setToolCalls([...currentToolCalls])
            break
          case 'tool_end': {
            const parsed = parseToolResult(chunk.result)
            currentToolCalls = currentToolCalls.map(tc =>
              tc.name === chunk.name && !tc.done
                ? {
                  ...tc,
                  done: true,
                  result: parsed,
                  action: parsed?.requiresConfirmation ? parsed : undefined,
                  summary: parsed?.summary || parsed?.message || parsed?.error,
                  error: parsed?.error,
                }
                : tc
            )
            setToolCalls([...currentToolCalls])
            break
          }
          case 'error':
            setStreamContent(prev => prev + `\n\n⚠️ ${chunk.content}`)
            break
          case 'done':
            break
        }
      })

      const result = await window.electronAPI.ai.chatStream(apiMessages, {
        requestId,
        contextPackage,
        requireConfirmation: true,
      })

      // 将流式结果添加为完整助手消息
      const assistantContent = result.cancelled
        ? (currentContent || '已停止生成。')
        : result.success
        ? (currentContent || result.fullContent || '')
        : (currentContent || `❌ ${result.error}`)

      const finalMessages = [...newMessages, {
        role: 'assistant',
        content: assistantContent,
        toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
        contextSources: getContextSources(contextPackage),
        stopped: Boolean(result.cancelled)
      }]
      setMessages(finalMessages)
      setStreamContent('')
      setToolCalls([])

      // 持久化完整对话
      aiUpdateConv(currentId, { messages: finalMessages, title: getConversationTitle(finalMessages) })
    } catch (error) {
      const errMessages = [...newMessages, {
        role: 'assistant',
        content: `❌ 发生错误: ${error.message}`
      }]
      setMessages(errMessages)
      setStreamContent('')
      setToolCalls([])
      aiUpdateConv(currentId, { messages: errMessages })
    } finally {
      if (chunkListenerRef.current) {
        chunkListenerRef.current()
        chunkListenerRef.current = null
      }
      activeRequestIdRef.current = null
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages, aiActiveConvId, aiNewChat, aiUpdateConv, buildContextPackage, contextEnabled.todos, contextEnabled.memories])

  const handleCancel = useCallback(async () => {
    const requestId = activeRequestIdRef.current
    if (!loading || !requestId) return

    try {
      await window.electronAPI?.ai?.cancelStream?.(requestId)
    } catch (_) {
      // 取消失败时不阻断界面，等待请求自然结束
    }
  }, [loading])

  useEffect(() => {
    if (!aiCommandRequest?.prompt) return
    const { prompt, autoSend } = aiCommandRequest
    if (loading) {
      setInput(prompt)
      return
    }
    aiClearCommandRequest?.()
    if (autoSend) {
      handleSend(prompt)
    } else {
      setInput(prompt)
      inputRef.current?.focus()
    }
  }, [aiCommandRequest, aiClearCommandRequest, handleSend, loading])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content).catch(() => {})
  }

  const updateCurrentConversationMessages = useCallback((updater) => {
    const nextMessages = updater(messages)
    setMessages(nextMessages)
    if (aiActiveConvId) {
      aiUpdateConv(aiActiveConvId, { messages: nextMessages, title: getConversationTitle(nextMessages) })
    }
    return nextMessages
  }, [aiActiveConvId, aiUpdateConv, messages])

  const handleExecuteAction = useCallback(async (action) => {
    if (!action?.actionId || executingActionId) return
    setExecutingActionId(action.actionId)
    try {
      const result = await window.electronAPI?.ai?.executePendingAction?.(action.actionId)
      const content = result?.success
        ? `已执行：${action.summary || action.label || 'AI 操作'}`
        : `执行失败：${result?.error || '未知错误'}`
      updateCurrentConversationMessages(prev => [...prev.map(msg => ({
        ...msg,
        toolCalls: msg.toolCalls?.map(tc =>
          tc.action?.actionId === action.actionId
            ? { ...tc, action: undefined, done: Boolean(result?.success), summary: content, error: result?.success ? undefined : result?.error }
            : tc
        )
      })), {
        role: 'assistant',
        content,
        toolCalls: [{
          name: action.name,
          done: Boolean(result?.success),
          summary: content,
          error: result?.success ? undefined : result?.error,
        }]
      }])
      if (result?.success) {
        if (action.name === 'create_todo') {
          onTodoUpdated?.()
        } else if (['create_note', 'edit_note'].includes(action.name)) {
          loadNotes?.()
        }
      }
    } catch (error) {
      updateCurrentConversationMessages(prev => [...prev, {
        role: 'assistant',
        content: `执行失败：${error.message}`
      }])
    } finally {
      setExecutingActionId(null)
    }
  }, [executingActionId, loadNotes, onTodoUpdated, updateCurrentConversationMessages])

  const handleSaveAsNote = useCallback(async (content) => {
    if (!content?.trim()) return
    try {
      const title = content.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 40) || 'AI 回答'
      const result = await window.electronAPI?.notes?.create?.({
        title,
        content,
        tags: 'AI',
        category: 'AI'
      })
      if (result?.success !== false) {
        loadNotes?.()
        updateCurrentConversationMessages(prev => [...prev, { role: 'assistant', content: `已保存为笔记：${title}` }])
      }
    } catch (error) {
      updateCurrentConversationMessages(prev => [...prev, { role: 'assistant', content: `保存笔记失败：${error.message}` }])
    }
  }, [loadNotes, updateCurrentConversationMessages])

  const handleAskFollowUp = useCallback((content) => {
    const excerpt = truncateText(content, 500)
    setInput(`基于这段回答继续深入：\n\n${excerpt}\n\n`)
    inputRef.current?.focus()
  }, [])

  const handleOpenSource = useCallback((noteId) => {
    setSelectedNoteId?.(noteId)
  }, [setSelectedNoteId])

  const handleContinueGeneration = useCallback(() => {
    if (loading) return
    handleSend('请继续上一条回答，从刚才中断的位置继续，避免重复已输出内容。')
  }, [loading, handleSend])

  const handleMessageContextMenu = useCallback((event, msg, index) => {
    event.preventDefault()
    setMessageContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      msg,
      index,
    })
  }, [])

  const closeMessageContextMenu = useCallback(() => {
    setMessageContextMenu(null)
  }, [])

  const handleInputContextMenu = useCallback((event) => {
    event.preventDefault()
    setInputContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
    })
  }, [])

  const closeInputContextMenu = useCallback(() => {
    setInputContextMenu(null)
  }, [])

  const handlePasteToInput = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setInput(prev => prev + text)
    } catch (_) {
      // 忽略剪贴板读取异常
    } finally {
      closeInputContextMenu()
    }
  }, [closeInputContextMenu])

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', height: '100%',
      flex: 1, minWidth: 0,
    }}>
      {/* 消息区域 */}
      <Box ref={scrollRef} sx={{
        flex: 1, overflow: 'auto', px: 3, py: 2,
        maxWidth: 900, mx: 'auto', width: '100%',
        scrollbarGutter: 'stable',
      }}>
        {/* 空状态 */}
        {messages.length === 0 && !loading && (
          <Box sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 3, py: 4,
          }}>
            <Box sx={{
              width: 72, height: 72, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
            }}>
              <SparkleIcon sx={{ fontSize: 36, color: theme.palette.primary.main }} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                你好！我是 FlotaAI
              </Typography>
              <Typography variant="body2" color="text.secondary">
                我可以帮你管理笔记、查询待办、搜索记忆，或者聊聊天
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', mt: 1 }}>
              {QUICK_ACTIONS.map((qa) => (
                <Chip
                  key={qa.label}
                  label={qa.label}
                  variant="outlined"
                  clickable
                  onClick={() => handleSend(qa.prompt)}
                  sx={{
                    borderRadius: '16px',
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) }
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* 历史消息 */}
        {messages.map((msg, i) => (
          <Box
            key={i}
            onContextMenu={(e) => handleMessageContextMenu(e, msg, i)}
            sx={{ position: 'relative', '&:hover .copy-btn': { opacity: 1 } }}
          >
            <ChatMessage
              msg={msg}
              theme={theme}
              userAvatar={userAvatar}
              onExecuteAction={handleExecuteAction}
              executingActionId={executingActionId}
              onSaveAsNote={handleSaveAsNote}
              onAskFollowUp={handleAskFollowUp}
              onOpenSource={handleOpenSource}
            />
            {msg.role === 'assistant' && msg.content && (
              <IconButton
                className="copy-btn"
                size="small"
                onClick={() => handleCopy(msg.content)}
                sx={{
                  position: 'absolute', top: 4, right: 4,
                  opacity: 0, transition: 'opacity 0.2s',
                }}
              >
                <CopyIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
            {msg.role === 'assistant' && msg.stopped && i === messages.length - 1 && !loading && (
              <Box sx={{ mt: -0.5, mb: 1.5, ml: 6 }}>
                <Chip
                  size="small"
                  label="已手动停止，点击继续生成"
                  clickable
                  onClick={handleContinueGeneration}
                  color="warning"
                  variant="outlined"
                />
              </Box>
            )}
          </Box>
        ))}

        {/* 流式输出中 */}
        {loading && (streamContent || toolCalls.length > 0) && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start' }}>
            <Avatar sx={{
              width: 32, height: 32,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
            }}>
              <SparkleIcon sx={{ fontSize: 18 }} />
            </Avatar>
            <Box sx={{ maxWidth: '80%' }}>
              {toolCalls.map((tc, i) => (
                <Chip
                  key={i}
                  size="small"
                  icon={TOOL_ICONS[tc.name] || <SparkleIcon fontSize="small" />}
                  label={`${TOOL_LABELS[tc.name] || tc.name}${tc.action ? ' · 待确认' : tc.done ? ' ✓' : '...'}`}
                  variant="outlined"
                  color={tc.action ? 'warning' : tc.done ? 'success' : 'default'}
                  sx={{ mb: 0.5, mr: 0.5, height: 24, fontSize: '0.75rem' }}
                />
              ))}
              {streamContent && (
                <Paper elevation={0} sx={{
                  px: 2, py: 1.5,
                  borderRadius: '16px 16px 16px 4px',
                  bgcolor: theme.palette.mode === 'dark'
                    ? alpha(theme.palette.background.paper, 0.8)
                    : alpha(theme.palette.grey[100], 0.8),
                  backdropFilter: 'blur(8px)',
                  lineHeight: 1.6, fontSize: '0.9rem',
                  userSelect: 'text',
                }}>
                  <Box sx={{ userSelect: 'text', cursor: 'text', '& > p:first-of-type': { mt: 0 }, '& > p:last-of-type': { mb: 0 } }}>
                    <MarkdownContent content={streamContent} />
                  </Box>
                  <Box component="span" sx={{
                    display: 'inline-block', width: 6, height: 16,
                    bgcolor: theme.palette.primary.main,
                    ml: 0.5, animation: 'blink 1s infinite',
                    verticalAlign: 'text-bottom',
                    '@keyframes blink': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0 },
                    }
                  }} />
                </Paper>
              )}
            </Box>
          </Box>
        )}

        {/* Loading 指示器（无流式内容时） */}
        {loading && !streamContent && toolCalls.length === 0 && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start' }}>
            <Avatar sx={{
              width: 32, height: 32,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
            }}>
              <SparkleIcon sx={{ fontSize: 18 }} />
            </Avatar>
            <Paper elevation={0} sx={{
              px: 2, py: 1.5,
              borderRadius: '16px 16px 16px 4px',
              bgcolor: theme.palette.mode === 'dark'
                ? alpha(theme.palette.background.paper, 0.8)
                : alpha(theme.palette.grey[100], 0.8),
              display: 'flex', alignItems: 'center', gap: 1,
            }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">思考中...</Typography>
            </Paper>
          </Box>
        )}
      </Box>

      {/* 输入区域 */}
      <Box sx={{
        px: 3, py: 2, borderTop: `1px solid ${theme.palette.divider}`,
        flexShrink: 0, maxWidth: 900, mx: 'auto', width: '100%',
      }}>
        <Box sx={{ display: 'flex', gap: 0.75, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">上下文</Typography>
          {CONTEXT_OPTIONS.map(option => (
            <Chip
              key={option.key}
              size="small"
              label={option.label}
              clickable
              color={contextEnabled[option.key] ? 'primary' : 'default'}
              variant={contextEnabled[option.key] ? 'filled' : 'outlined'}
              onClick={() => setContextEnabled(prev => ({ ...prev, [option.key]: !prev[option.key] }))}
              sx={{ height: 24, borderRadius: 3 }}
            />
          ))}
          {selectedNoteId && contextEnabled.currentNote && (
            <Typography variant="caption" color="text.secondary">
              已注入当前笔记
            </Typography>
          )}
        </Box>
        <Box sx={{
          display: 'flex', gap: 1, alignItems: 'flex-end',
          bgcolor: theme.palette.mode === 'dark'
            ? alpha(theme.palette.background.paper, 0.5)
            : alpha(theme.palette.grey[100], 0.5),
          borderRadius: '16px',
          border: `1px solid ${theme.palette.divider}`,
          px: 2, py: 1,
          transition: 'border-color 0.2s',
          '&:focus-within': {
            borderColor: theme.palette.primary.main,
          }
        }} onContextMenu={handleInputContextMenu}>
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={4}
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            variant="standard"
            slotProps={{ input: { disableUnderline: true } }}
            sx={{
              '& .MuiInput-root': { fontSize: '0.9rem' },
            }}
            disabled={loading}
            autoFocus
          />
          <IconButton
            onClick={loading ? handleCancel : () => handleSend()}
            disabled={loading ? false : !input.trim()}
            sx={{
              width: 36,
              height: 36,
              bgcolor: loading
                ? alpha(theme.palette.error.main, 0.12)
                : (input.trim() ? theme.palette.primary.main : 'transparent'),
              color: loading
                ? theme.palette.error.main
                : (input.trim() ? theme.palette.primary.contrastText : theme.palette.action.disabled),
              '&:hover': {
                bgcolor: loading
                  ? alpha(theme.palette.error.main, 0.2)
                  : (input.trim() ? theme.palette.primary.dark : 'transparent'),
              },
              transition: 'all 0.2s',
            }}
            aria-label={loading ? '停止生成' : '发送消息'}
          >
            {loading ? <StopIcon sx={{ fontSize: 18 }} /> : <SendIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
          FlotaAI 可能会出错，请核实重要信息
        </Typography>
      </Box>

      <Menu
        open={Boolean(messageContextMenu)}
        onClose={closeMessageContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={messageContextMenu ? { top: messageContextMenu.mouseY, left: messageContextMenu.mouseX } : undefined}
      >
        <MenuItem
          onClick={() => {
            if (messageContextMenu?.msg?.content) {
              handleCopy(messageContextMenu.msg.content)
            }
            closeMessageContextMenu()
          }}
          disabled={!messageContextMenu?.msg?.content}
        >
          复制消息
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleContinueGeneration()
            closeMessageContextMenu()
          }}
          disabled={!(messageContextMenu?.msg?.role === 'assistant' && messageContextMenu?.msg?.stopped && messageContextMenu?.index === messages.length - 1 && !loading)}
        >
          继续生成
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleSaveAsNote(messageContextMenu?.msg?.content)
            closeMessageContextMenu()
          }}
          disabled={!(messageContextMenu?.msg?.role === 'assistant' && messageContextMenu?.msg?.content)}
        >
          存为笔记
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleAskFollowUp(messageContextMenu?.msg?.content)
            closeMessageContextMenu()
          }}
          disabled={!(messageContextMenu?.msg?.role === 'assistant' && messageContextMenu?.msg?.content)}
        >
          基于此追问
        </MenuItem>
      </Menu>

      <Menu
        open={Boolean(inputContextMenu)}
        onClose={closeInputContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={inputContextMenu ? { top: inputContextMenu.mouseY, left: inputContextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handlePasteToInput}>粘贴</MenuItem>
        <MenuItem
          onClick={() => {
            setInput('')
            closeInputContextMenu()
          }}
          disabled={!input}
        >
          清空输入
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleSend()
            closeInputContextMenu()
          }}
          disabled={!input.trim() || loading}
        >
          发送
        </MenuItem>
      </Menu>
    </Box>
  )
}
