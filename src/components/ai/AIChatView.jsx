import QuickPromptShortcuts from './QuickPromptShortcuts'
import { GENERAL_AI_QUICK_PROMPTS, TASK_PLANNING_QUICK_PROMPTS } from '../../utils/aiQuickPrompts'
import { LoadingAvatarContent, toolChipIcon } from './aiToolIndicators'
import AICapabilityTicker from './AICapabilityTicker'
import { releasePopoverFocus } from '../../utils/popoverFocus'
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Typography, TextField, IconButton, Paper,
  Chip, Fade, Avatar, Menu, MenuItem, Button, Tooltip
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import {
  Send as SendIcon,
  ContentCopy as CopyIcon,
  Stop as StopIcon,
  Close as CloseIcon,
} from '../common/AppIcons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import LongDocSteps from './LongDocSteps'
import FlotaAIIcon from '../common/FlotaAIIcon'
import FlotaAIOrb from '../common/FlotaAIOrb'
import { truncateText } from '../../utils/aiContextUtils'
import { getUiLocation } from '../../utils/aiCore/uiLocation'
import { getMessagePendingActions, stripInternalActionAnnotations } from '../../utils/aiCore/pendingActions'
import PendingActionCard from './PendingActionCard'
import { floatingComposerDockSx, floatingComposerSx, floatingComposerSendSx } from '../../styles/floatingComposerSx'
import MemoryUpdateNotice from './MemoryUpdateNotice'
import { messageText } from '../../utils/aiCore/messageModel'
import useAIChatSession from '../../hooks/useAIChatSession'
import { notifyError, notifySuccess } from '../../utils/notify'
import { isImeComposing } from '../../utils/imeUtils'
import { TypewriterText } from './thinking'

// ─── Markdown 渲染（react-markdown + remark-gfm） ───

const mdComponents = {
  h1: ({ children }) => <Typography variant="h6" sx={{ mt: 1.5, mb: 0.5, fontWeight: 700, lineHeight: 1.4 }}>{children}</Typography>,
  h2: ({ children }) => <Typography variant="subtitle1" sx={{ mt: 1.5, mb: 0.5, fontWeight: 700, lineHeight: 1.4 }}>{children}</Typography>,
  h3: ({ children }) => <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5, fontWeight: 700, lineHeight: 1.4 }}>{children}</Typography>,
  p: ({ children }) => <Typography component="div" variant="body2" sx={{ my: 0.5, lineHeight: 1.7 }}>{children}</Typography>,
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
  a: ({ href, children }) => <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'currentColor', textDecorationThickness: '1px', textUnderlineOffset: 2, opacity: 0.9, wordBreak: 'break-all', '&:hover': { opacity: 1 } }}>{children}</Box>,
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

// 工具调用「进行中」与「已完成」时分别使用的中文动作描述
const TOOL_LABELS = {
  read_note: { running: '读取笔记中', done: '读取笔记' },
  read_skill: { running: '加载相关能力中', done: '已加载相关能力' },
  get_settings: { running: '读取设置中', done: '读取设置' },
  update_settings: { running: '准备修改设置', done: '修改设置' },
  search_notes: { running: '搜索笔记中', done: '搜索笔记' },
  web_search: { running: '联网搜索中', done: '联网搜索' },
  get_current_note: { running: '读取当前笔记中', done: '读取当前笔记' },
  read_current_note: { running: '阅读笔记段落中', done: '阅读笔记段落' },
  read_note_image: { running: '正在阅读图片', done: '已阅读图片' },
  search_in_current_note: { running: '在笔记中搜索中', done: '笔记内搜索' },
  summarize_current_note_section: { running: '生成段落摘要中', done: '段落摘要' },
  create_note: { running: '创建笔记中', done: '创建笔记' },
  edit_note: { running: '编辑笔记中', done: '编辑笔记' },
  edit_notes: { running: '批量编辑笔记中', done: '批量编辑笔记' },
  create_whiteboard: { running: '创建画布中', done: '创建画布' },
  update_whiteboard: { running: '修改画布中', done: '修改画布' },
  list_widgets: { running: '查看组件中', done: '查看组件' },
  get_widget: { running: '读取组件中', done: '读取组件' },
  create_widget: { running: '准备生成组件', done: '生成组件' },
  update_widget: { running: '准备修改组件', done: '修改组件' },
  write_document: { running: '写长文中', done: '写长文' },
  read_whiteboard: { running: '读取画布中', done: '读取画布' },
  create_whiteboard: { running: '检查画布中', done: '画布' },
  update_whiteboard: { running: '检查画布中', done: '修改画布' },
  search_todos: { running: '搜索待办中', done: '搜索待办' },
  get_today_todos: { running: '获取今日待办中', done: '获取今日待办' },
  create_todo: { running: '创建待办中', done: '创建待办' },
  create_todos: { running: '规划待办中', done: '规划待办' },
  search_memory: { running: '搜索记忆中', done: '搜索记忆' },
  add_memory: { running: '保存记忆中', done: '保存记忆' },
  update_memory: { running: '更新记忆中', done: '更新记忆' },
  list_memories: { running: '查看记忆库中', done: '查看记忆库' },
}

const formatToolLabel = (tc) => {
  const def = TOOL_LABELS[tc.name]
  const fallback = tc.name
  if (tc.action?.status === 'done') return `${def?.done || fallback} ✓`
  if (tc.action?.status === 'failed') return `${def?.done || fallback} · 失败`
  if (tc.action?.status === 'running') return `${def?.running || fallback}…`
  if (tc.action?.status === 'dismissed') return `${def?.done || fallback} · 已忽略`
  if (tc.action?.status === 'superseded') return `${def?.done || fallback} · 已替代`
  if (tc.action) return `${def?.done || fallback} · 待确认`
  if (tc.done) return `${def?.done || fallback} ✓`
  return `${def?.running || fallback}…`
}




// 多模态：粘贴 / 拖拽 图片
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 6 * 1024 * 1024 // 6MB

// ─── 聊天消息组件 ───

const ChatMessage = React.memo(({ msg, theme, userAvatar, onExecuteAction, onDismissAction, onRestoreAction, onReviseAction, executingActionIds, onSaveAsNote, onAskFollowUp, onOpenSource, onUndoMemory }) => {
  const isUser = msg.role === 'user'
  // 兼容多模态 content：array 时拆出 text + image_url
  const isArrayContent = Array.isArray(msg.content)
  const rawTextContent = messageText(msg.content)
  const textContent = isUser ? rawTextContent : stripInternalActionAnnotations(rawTextContent)
  const imageParts = isArrayContent ? msg.content.filter((p) => p?.type === 'image_url') : []
  const hasContent = Boolean(textContent) || imageParts.length > 0
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
          {isUser ? null : (() => {
            const runningAction = getMessagePendingActions(msg).find((action) => executingActionIds.has(action.actionId))
            return runningAction
              // 确认后的动作还在执行：头像在对应工具图标与思考跳动点之间切换动画
              ? <LoadingAvatarContent activeTool={runningAction.name} iconSize={18} />
              : <FlotaAIIcon sx={{ fontSize: 20 }} />
          })()}
        </Avatar>

        <Box sx={{ maxWidth: '80%', minWidth: 0 }}>
          {/* 长文档步骤树 */}
          {msg.steps?.length > 0 && (
            <LongDocSteps
              steps={msg.steps}
              renderContent={(c) => <MarkdownContent content={c} />}
              onOpenNote={onOpenSource}
            />
          )}
          {/* 工具调用指示器 */}
          {msg.toolCalls?.map((tc, i) => (
            <Box key={`${tc.name}-${i}`} sx={{ mb: 0.75 }}>
              <Tooltip title={tc.summary || tc.error || 'AI 正在调用应用能力'} arrow>
                <Chip
                  size="small"
                  icon={toolChipIcon(tc.name) || <FlotaAIIcon sx={{ fontSize: 16 }} />}
                  label={formatToolLabel(tc)}
                  variant="outlined"
                  color={tc.error ? 'error' : tc.done ? 'success' : 'default'}
                  sx={{ mr: 0.5, height: 24, fontSize: '0.75rem' }}
                />
              </Tooltip>
            </Box>
          ))}

          {/* 消息内容 */}
          {hasContent && (
            <Paper
              elevation={0}
              sx={{
                px: 2, py: 1.5,
                borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                bgcolor: isUser
                  ? theme.palette.primary.main
                  : theme.palette.mode === 'dark' ? alpha(theme.palette.background.paper, 0.8) : alpha(theme.palette.grey[100], 0.8),
                color: isUser ? theme.palette.primary.contrastText : theme.palette.text.primary,
                lineHeight: 1.6,
                fontSize: '0.9rem',
                wordBreak: 'break-word',
                userSelect: 'text',
              }}
            >
              {imageParts.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: textContent ? 1 : 0 }}>
                  {imageParts.map((p, i) => (
                    <Box key={i} component="img" src={p.image_url?.url} sx={{ maxWidth: 180, maxHeight: 180, borderRadius: 1, objectFit: 'cover' }} />
                  ))}
                </Box>
              )}
              {textContent && (
                <Box sx={{ userSelect: 'text', cursor: 'text', '& > p:first-of-type': { mt: 0 }, '& > p:last-of-type': { mb: 0 } }}>
                  <MarkdownContent content={textContent} />
                </Box>
              )}
            </Paper>
          )}
          {/* 待确认动作卡（统一读取 msg.actions 与历史 toolCalls[].action） */}
          {getMessagePendingActions(msg).map((action) => (
            <Box key={action.actionId} sx={{ mb: 0.75 }}>
              <PendingActionCard
                action={action}
                executing={executingActionIds.has(action.actionId)}
                onExecute={onExecuteAction}
                onDismiss={onDismissAction}
                onRestore={onRestoreAction}
                onRevise={onReviseAction}
              />
            </Box>
          ))}

          {!isUser && textContent && (
            <Box sx={{ display: 'flex', gap: 0.75, mt: 0.75, flexWrap: 'wrap', opacity: 0.9 }}>
              <Chip size="small" label="存为笔记" onClick={() => onSaveAsNote?.(textContent)} variant="outlined" sx={{ height: 24 }} />
              <Chip size="small" label="继续追问" onClick={() => onAskFollowUp?.(textContent)} variant="outlined" sx={{ height: 24 }} />
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
          {!isUser && msg.memoryUpdates && (
            <MemoryUpdateNotice updates={msg.memoryUpdates} onUndo={() => onUndoMemory?.(msg)} />
          )}
        </Box>
      </Box>
    </Fade>
  )
})

export default function AIChatView({ onTodoUpdated }) {
  const theme = useTheme()
  const {
    userAvatar,
    notes,
    setSelectedNoteId,
    aiConversations,
    aiActiveConvId,
    aiSwitchConv,
    aiCommandRequest,
    aiClearCommandRequest,
    currentView,
    loadNotes,
    updateNote,
    createNote,
    deleteNote
  } = useStore(useShallow((state) => ({
    userAvatar: state.userAvatar,
    notes: state.notes,
    setSelectedNoteId: state.setSelectedNoteId,
    aiConversations: state.aiConversations,
    aiActiveConvId: state.aiActiveConvId,
    aiSwitchConv: state.aiSwitchConv,
    aiCommandRequest: state.aiCommandRequest,
    aiClearCommandRequest: state.aiClearCommandRequest,
    currentView: state.currentView,
    loadNotes: state.loadNotes,
    updateNote: state.updateNote,
    createNote: state.createNote,
    deleteNote: state.deleteNote,
  })))

  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState([]) // [{ id, dataUrl }]
  const [visionEnabled, setVisionEnabled] = useState(false)
  const [messageContextMenu, setMessageContextMenu] = useState(null)
  const [inputContextMenu, setInputContextMenu] = useState(null)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const pendingScrollToLatestConvRef = useRef(null)
  const currentConversationId = aiActiveConvId || null
  const currentConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === currentConversationId) || null,
    [aiConversations, currentConversationId]
  )
  const isTaskPlanning = currentConversation?.mode === 'task-planning'
    || currentConversation?.source === 'task-planning'
  const emptyStateActions = isTaskPlanning ? TASK_PLANNING_QUICK_PROMPTS : GENERAL_AI_QUICK_PROMPTS

  // 会话、发送、流式、确认卡执行：与「问 AI」小窗共用 useAIChatSession
  const {
    messages,
    displayMessages,
    executingActionIds,
    awaitingConfirm,
    loading,
    backgroundStreamingId: streamingConvId,
    streamContent,
    toolCalls,
    steps,
    activeTool,
    thinkingPhrase,
    send,
    cancel: handleCancel,
    cancelConversation,
    executeAction: handleExecuteAction,
    dismissAction: handleDismissAction,
    restoreAction: handleRestoreAction,
    undoMemory: handleUndoMemory,
  } = useAIChatSession({
    conversationId: currentConversationId,
    // 独立 AI 页面不预设当前笔记：历史对话保留自身归属，不跟随后台选中的笔记
    noteId: currentConversation?.noteId ?? null,
    scene: 'chat_panel',
    requestPrefix: 'aichat',
    getLocation: () => getUiLocation(useStore.getState()),
    actionDeps: { currentNote: null, notes, createNote, deleteNote, updateNote, loadNotes, setSelectedNoteId },
    onTodoUpdated,
    onConversationSwitched: (conversationId) => {
      pendingScrollToLatestConvRef.current = conversationId
      setInput('')
      setPendingImages([])
    },
    onSendAccepted: () => {
      setInput('')
      setPendingImages([])
    },
    onSendSettled: () => {
      if (useStore.getState().currentView === 'ai') inputRef.current?.focus()
    },
  })

  // 当前视图是否正在流式生成：必须当前可见会话恰好就是那个正在生成的会话。
  // 这样在别的会话后台生成时，本视图不会被误锁。
  const isStreaming = loading
  const hasBackgroundStreaming = streamingConvId != null
  const backgroundStreamingConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === streamingConvId) || null,
    [aiConversations, streamingConvId]
  )
  const backgroundStreamingNoteTitle = useMemo(() => {
    const noteId = backgroundStreamingConversation?.noteId
    if (noteId == null) return ''
    return notes.find((note) => String(note.id) === String(noteId))?.title || ''
  }, [backgroundStreamingConversation, notes])

  // 读取 vision 开关
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.ai?.getConfig?.().then((r) => {
      if (!cancelled && r?.success) setVisionEnabled(Boolean(r.data?.visionEnabled))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 自动滚动到底部：仅当用户已经停留在接近底部（≤80px）时才自动跟随，
  // 否则尊重用户向上滚动的位置，不强行拽回。
  const SCROLL_FOLLOW_THRESHOLD = 80
  const forceScrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [])

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    if (distance <= SCROLL_FOLLOW_THRESHOLD) {
      node.scrollTop = node.scrollHeight
    }
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamContent, scrollToBottom])

  useEffect(() => {
    if (pendingScrollToLatestConvRef.current !== currentConversationId) return
    let innerRafId = null
    const rafId = window.requestAnimationFrame(() => {
      innerRafId = window.requestAnimationFrame(() => {
        forceScrollToBottom()
        pendingScrollToLatestConvRef.current = null
      })
    })
    return () => {
      window.cancelAnimationFrame(rafId)
      if (innerRafId != null) window.cancelAnimationFrame(innerRafId)
    }
  }, [currentConversationId, messages, forceScrollToBottom])

  const handleJumpToStreamingConversation = useCallback(() => {
    if (!streamingConvId) return
    aiSwitchConv(streamingConvId)
  }, [streamingConvId, aiSwitchConv])

  // 「修改」：把焦点交给输入框，用户直接说要改哪里；AI 给出新方案后旧卡自动失效
  const handleReviseAction = useCallback(() => {
    setInput((prev) => (prev.trim() ? prev : '改一下：'))
    window.requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) return
      node.focus()
      const end = node.value.length
      node.setSelectionRange?.(end, end)
    })
  }, [])

  // 发送：组装多模态内容（文字 + 图片），其余交给共用会话逻辑
  const handleSend = useCallback((customPrompt) => {
    const text = (customPrompt || input).trim()
    const images = customPrompt ? [] : pendingImages
    const content = images.length > 0
      ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ]
      : text
    return send({ text, content })
  }, [input, pendingImages, send])

  useEffect(() => {
    if (currentView !== 'ai' || !aiCommandRequest?.prompt) return
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
  }, [aiCommandRequest, aiClearCommandRequest, currentView, handleSend, loading])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content).catch(() => {})
  }

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
      if (result?.success === false) throw new Error(result.error || '未知原因')
      loadNotes?.()
      notifySuccess(`已保存为笔记：${title}`)
    } catch (error) {
      notifyError(`保存笔记失败：${error.message}`)
    }
  }, [loadNotes])

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
    releasePopoverFocus()
    setMessageContextMenu(null)
  }, [])


  const ingestImageFiles = useCallback(async (files) => {
    if (!visionEnabled) return
    const items = Array.from(files || []).filter((f) => f && f.type?.startsWith('image/') && f.size <= MAX_IMAGE_BYTES)
    if (items.length === 0) return
    const dataUrls = await Promise.all(items.map((f) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(f)
    })))
    setPendingImages((prev) => [
      ...prev,
      ...dataUrls.map((url) => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, dataUrl: url })),
    ].slice(0, MAX_IMAGES))
  }, [visionEnabled])

  const handlePaste = useCallback((event) => {
    if (!visionEnabled) return
    const items = event.clipboardData?.items
    if (!items) return
    const imageFiles = []
    for (const it of items) {
      if (it.kind === 'file' && it.type?.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault()
      ingestImageFiles(imageFiles)
    }
  }, [visionEnabled, ingestImageFiles])

  const handleDrop = useCallback((event) => {
    if (!visionEnabled) return
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      event.preventDefault()
      ingestImageFiles(files)
    }
  }, [visionEnabled, ingestImageFiles])

  const removePendingImage = useCallback((id) => {
    setPendingImages((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const handleInputContextMenu = useCallback((event) => {
    event.preventDefault()
    setInputContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
    })
  }, [])

  const closeInputContextMenu = useCallback(() => {
    releasePopoverFocus()
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
      position: 'relative',
    }}>
      {/* 消息区域 */}
      <Box ref={scrollRef} sx={{
        flex: 1, overflow: 'auto', px: 3, pt: 2, pb: 16,
        maxWidth: 900, mx: 'auto', width: '100%',
        scrollbarGutter: 'stable',
      }}>
        {/* 空状态 */}
        {messages.length === 0 && !isStreaming && (
          <Box sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '100%', gap: 1.5, py: 3,
          }}>
            <Box sx={{ position: 'relative', width: 150, height: 130, mb: 1, flexShrink: 0 }}>
              <FlotaAIOrb sx={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%) scale(.6)' }} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 550, mb: 0.25 }}>
                {isTaskPlanning ? 'AI 任务规划' : '你好！我是 FlotaAI'}
              </Typography>
              {isTaskPlanning && <Typography variant="body2" color="text.secondary">从一个规划模板开始，或直接告诉我你想完成什么</Typography>}
            </Box>
            {!isTaskPlanning && <AICapabilityTicker onSelect={prompt => { setInput(prompt); inputRef.current?.focus() }} sx={{ width: '100%', maxWidth: 340 }} />}
            <QuickPromptShortcuts defaults={emptyStateActions} scope={isTaskPlanning ? 'planning' : 'general'} onSelect={prompt => { setInput(prompt); inputRef.current?.focus() }} />
          </Box>
        )}

        {/* 历史消息 */}
        {messages.map((msg, i) => displayMessages.has(msg) && (
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
              onDismissAction={handleDismissAction}
              onRestoreAction={handleRestoreAction}
              onReviseAction={handleReviseAction}
              executingActionIds={executingActionIds}
              onSaveAsNote={handleSaveAsNote}
              onAskFollowUp={handleAskFollowUp}
              onOpenSource={handleOpenSource}
              onUndoMemory={handleUndoMemory}
            />
            {msg.role === 'assistant' && msg.content && (
              <IconButton
                className="copy-btn"
                size="small"
                onClick={() => {
                  const c = msg.content
                  const text = Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n') : c
                  if (text) handleCopy(text)
                }}
                sx={{
                  position: 'absolute', top: 4, right: 4,
                  opacity: 0, transition: 'opacity 0.2s',
                }}
              >
                <CopyIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
            {msg.role === 'assistant' && msg.stopped && i === messages.length - 1 && !isStreaming && (
              <Box sx={{ mt: -0.5, mb: 1.5, ml: 6 }}>
                <Chip
                  size="small"
                  label="已手动停止，点击继续生成"
                  clickable
                  onClick={handleContinueGeneration}
                  disabled={loading}
                  color="warning"
                  variant="outlined"
                />
              </Box>
            )}
          </Box>
        ))}

        {/* 流式输出中 */}
        {isStreaming && (streamContent || toolCalls.length > 0 || steps.length > 0) && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start' }}>
            <Avatar sx={{
              width: 32, height: 32,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
            }}>
              <LoadingAvatarContent activeTool={activeTool} iconSize={18} />
            </Avatar>
            <Box sx={{ maxWidth: '80%' }}>
              {steps.length > 0 && (
                <LongDocSteps
                  steps={steps}
                  renderContent={(c) => <MarkdownContent content={c} />}
                  onOpenNote={handleOpenSource}
                />
              )}
              {toolCalls.map((tc, i) => (
                <Box key={`${tc.name}-${i}`} sx={{ mb: 0.75 }}>
                  <Chip
                    size="small"
                    icon={toolChipIcon(tc.name) || <FlotaAIIcon sx={{ fontSize: 16 }} />}
                    label={formatToolLabel(tc)}
                    variant="outlined"
                    color={tc.action?.status === 'done' ? 'success' : tc.action?.status === 'failed' ? 'error' : tc.action ? 'warning' : tc.done ? 'success' : 'default'}
                    sx={{ mr: 0.5, height: 24, fontSize: '0.75rem' }}
                  />
                  {tc.action && (
                    <PendingActionCard
                      action={tc.action}
                      executing={executingActionIds.has(tc.action.actionId)}
                      onExecute={handleExecuteAction}
                    />
                  )}
                </Box>
              ))}
              {streamContent && (
                <Paper elevation={0} sx={{
                  px: 2, py: 1.5,
                  borderRadius: '8px 8px 8px 2px',
                  bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.16),
                  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.26)}`,
                  lineHeight: 1.65, fontSize: 13,
                  userSelect: 'text',
                }}>
                  <Box sx={{ userSelect: 'text', cursor: 'text', '& > p:first-of-type': { mt: 0 }, '& > p:last-of-type': { mb: 0 } }}>
                    <MarkdownContent content={stripInternalActionAnnotations(streamContent)} />
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
        {isStreaming && !streamContent && toolCalls.length === 0 && steps.length === 0 && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start' }}>
            <Avatar sx={{
              width: 32, height: 32,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
            }}>
              <LoadingAvatarContent activeTool={activeTool} iconSize={18} />
            </Avatar>
            <Paper elevation={0} sx={{
              px: 2, py: 1.5,
              borderRadius: '8px 8px 8px 2px',
              bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.16),
              boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.26)}`,
              display: 'flex', alignItems: 'center',
            }}>
              <TypewriterText text={thinkingPhrase} />
            </Paper>
          </Box>
        )}

        {hasBackgroundStreaming && backgroundStreamingConversation && (
          <Paper
            elevation={0}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              mb: 2,
              px: 1.5,
              py: 1.1,
              borderRadius: '14px',
              border: `1px solid ${alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.28 : 0.22)}`,
              bgcolor: theme.palette.mode === 'dark'
                ? alpha(theme.palette.warning.main, 0.1)
                : alpha(theme.palette.warning.light, 0.16),
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.primary' }}>
                另一个对话仍在生成
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }} noWrap>
                {backgroundStreamingNoteTitle
                  ? `${backgroundStreamingNoteTitle} · ${backgroundStreamingConversation.title || '新对话'}`
                  : (backgroundStreamingConversation.title || '新对话')}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
              <Button size="small" variant="outlined" color="inherit" onClick={handleJumpToStreamingConversation}>
                切回查看
              </Button>
              <Button size="small" color="error" variant="outlined" onClick={() => cancelConversation(streamingConvId)}>
                停止
              </Button>
            </Box>
          </Paper>
        )}
      </Box>

      {/* 输入区域：液态玻璃悬浮输入框 */}
      <Box sx={floatingComposerDockSx}>
        <Box sx={(t) => ({
          ...floatingComposerSx(t),
          display: 'flex', flexDirection: 'column', gap: 1,
          px: 2, py: 1.25,
        })} onContextMenu={handleInputContextMenu}
          onDragOver={(e) => { if (visionEnabled) e.preventDefault() }}
          onDrop={handleDrop}
        >
          {pendingImages.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {pendingImages.map((img) => (
                <Box key={img.id} sx={{ position: 'relative', width: 48, height: 48, borderRadius: 1, overflow: 'hidden', border: `1px solid ${theme.palette.divider}` }}>
                  <Box component="img" src={img.dataUrl} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <IconButton size="small" onClick={() => removePendingImage(img.id)} sx={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}>
                    <CloseIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={4}
            placeholder={awaitingConfirm
              ? '回复「好的」即可确认，或说说要改哪里…'
              : visionEnabled ? "输入消息（可粘贴/拖拽图片）..." : "输入消息... (Enter 发送，Shift+Enter 换行)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            variant="standard"
            slotProps={{ input: { disableUnderline: true } }}
            sx={{
              '& .MuiInput-root': { fontSize: '0.9rem' },
            }}
            disabled={isStreaming}
            autoFocus
          />
          <IconButton
            onClick={isStreaming ? handleCancel : () => handleSend()}
            disabled={isStreaming ? false : (loading || (!input.trim() && pendingImages.length === 0))}
            sx={floatingComposerSendSx(theme, {
              danger: isStreaming,
              active: Boolean(input.trim() || pendingImages.length > 0),
            })}
            aria-label={isStreaming ? '停止生成' : '发送消息'}
          >
            {isStreaming ? <StopIcon sx={{ fontSize: 18 }} /> : <SendIcon sx={{ fontSize: 18 }} />}
          </IconButton>
          </Box>
        </Box>

      </Box>

      <Menu
        open={Boolean(messageContextMenu)}
        onClose={closeMessageContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={messageContextMenu ? { top: messageContextMenu.mouseY, left: messageContextMenu.mouseX } : undefined}
      >
        <MenuItem
          onClick={() => {
            const c = messageContextMenu?.msg?.content
            const text = Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n') : c
            if (text) handleCopy(text)
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
