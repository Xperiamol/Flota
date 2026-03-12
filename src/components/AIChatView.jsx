import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box, Typography, TextField, IconButton, Paper, CircularProgress,
  Chip, Fade, Avatar
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
} from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'

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
]

// ─── 聊天消息组件 ───

const ChatMessage = React.memo(({ msg, theme, userAvatar }) => {
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
            <Chip
              key={i}
              size="small"
              icon={TOOL_ICONS[tc.name] || <SparkleIcon fontSize="small" />}
              label={`${TOOL_LABELS[tc.name] || tc.name}${tc.done ? ' ✓' : '...'}`}
              variant="outlined"
              color={tc.done ? 'success' : 'default'}
              sx={{ mb: 0.5, mr: 0.5, height: 24, fontSize: '0.75rem' }}
            />
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
        </Box>
      </Box>
    </Fade>
  )
})

export default function AIChatView() {
  const theme = useTheme()
  const { userAvatar, aiConversations, aiActiveConvId, aiNewChat, aiUpdateConv } = useStore()

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [toolCalls, setToolCalls] = useState([])

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const chunkListenerRef = useRef(null)

  // 切换对话时加载消息
  useEffect(() => {
    const conv = aiConversations.find(c => c.id === aiActiveConvId)
    setMessages(conv?.messages || [])
    setStreamContent('')
    setToolCalls([])
    setInput('')
  }, [aiActiveConvId]) // eslint-disable-line react-hooks/exhaustive-deps

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

    // 构建发送给 API 的消息（只含 role + content）
    const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))

    try {
      // 注册 chunk 监听
      if (chunkListenerRef.current) chunkListenerRef.current()
      let currentContent = ''
      let currentToolCalls = []

      chunkListenerRef.current = window.electronAPI.ai.onChatChunk((chunk) => {
        switch (chunk.type) {
          case 'content':
            currentContent += chunk.content
            setStreamContent(currentContent)
            break
          case 'tool_start':
            currentToolCalls = [...currentToolCalls, { name: chunk.name, done: false }]
            setToolCalls([...currentToolCalls])
            break
          case 'tool_end':
            currentToolCalls = currentToolCalls.map(tc =>
              tc.name === chunk.name && !tc.done ? { ...tc, done: true } : tc
            )
            setToolCalls([...currentToolCalls])
            break
          case 'error':
            setStreamContent(prev => prev + `\n\n⚠️ ${chunk.content}`)
            break
          case 'done':
            break
        }
      })

      const result = await window.electronAPI.ai.chatStream(apiMessages, {})

      // 清理监听器
      if (chunkListenerRef.current) {
        chunkListenerRef.current()
        chunkListenerRef.current = null
      }

      // 将流式结果添加为完整助手消息
      const assistantContent = result.success
        ? result.fullContent
        : (currentContent || `❌ ${result.error}`)

      const finalMessages = [...newMessages, {
        role: 'assistant',
        content: assistantContent,
        toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined
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
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages, aiActiveConvId, aiNewChat, aiUpdateConv])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content).catch(() => {})
  }

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', height: '100%',
      flex: 1, minWidth: 0,
    }}>
      {/* 消息区域 */}
      <Box ref={scrollRef} sx={{
        flex: 1, overflow: 'auto', px: 3, py: 2,
        maxWidth: 900, mx: 'auto', width: '100%',
        '&::-webkit-scrollbar': { width: 6 },
        '&::-webkit-scrollbar-thumb': {
          bgcolor: alpha(theme.palette.text.primary, 0.15),
          borderRadius: 3,
        },
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
          <Box key={i} sx={{ position: 'relative', '&:hover .copy-btn': { opacity: 1 } }}>
            <ChatMessage msg={msg} theme={theme} userAvatar={userAvatar} />
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
                  label={`${TOOL_LABELS[tc.name] || tc.name}${tc.done ? ' ✓' : '...'}`}
                  variant="outlined"
                  color={tc.done ? 'success' : 'default'}
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
        }}>
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
            InputProps={{ disableUnderline: true }}
            sx={{
              '& .MuiInput-root': { fontSize: '0.9rem' },
            }}
            disabled={loading}
            autoFocus
          />
          <IconButton
            color="primary"
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            sx={{
              bgcolor: input.trim() && !loading
                ? theme.palette.primary.main : 'transparent',
              color: input.trim() && !loading
                ? theme.palette.primary.contrastText : theme.palette.action.disabled,
              width: 36, height: 36,
              '&:hover': {
                bgcolor: input.trim() && !loading
                  ? theme.palette.primary.dark : 'transparent',
              },
              transition: 'all 0.2s',
            }}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
          FlotaAI 可能会出错，请核实重要信息
        </Typography>
      </Box>
    </Box>
  )
}
