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
  Image as ImageIcon,
  MenuBook as ReadIcon,
  Stop as StopIcon,
  Close as CloseIcon,
} from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../../store/useStore'
import LongDocSteps from './LongDocSteps'
import { getContextSources, truncateText } from '../../utils/aiContextUtils'
import { handleWhiteboardAIRequest, handleCreateWhiteboardRequest } from '../../utils/whiteboardAI'
import { routeIntent } from '../../utils/aiCore/intentRouter'
import { buildContext } from '../../utils/aiCore/contextBuilder'

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

// 切换 thinking 短语时直接换内容并伴随淡入动画，避免中间整段透明导致的"空白"
const ThinkingPhrase = ({ text }) => {
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
      variant="body2"
      color="text.secondary"
      sx={{
        animation: 'flota-thinking-fade 280ms ease',
        '@keyframes flota-thinking-fade': {
          '0%': { opacity: 0, transform: 'translateY(2px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' }
        }
      }}
    >
      {display}…
    </Typography>
  )
}

// ─── 工具调用相关常量 ───

// 模型空闲思考阶段随机展示的英文短语
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

const TOOL_ICONS = {
  search_notes: <SearchIcon fontSize="small" />,
  web_search: <SearchIcon fontSize="small" />,
  get_current_note: <NoteIcon fontSize="small" />,
  read_current_note: <ReadIcon fontSize="small" />,
  read_note_image: <ImageIcon fontSize="small" />,
  search_in_current_note: <SearchIcon fontSize="small" />,
  summarize_current_note_section: <ReadIcon fontSize="small" />,
  create_note: <NoteIcon fontSize="small" />,
  edit_note: <EditIcon fontSize="small" />,
  write_long_document: <NoteIcon fontSize="small" />,
  search_todos: <CheckIcon fontSize="small" />,
  get_today_todos: <CalendarIcon fontSize="small" />,
  create_todo: <CheckIcon fontSize="small" />,
  create_todos: <CheckIcon fontSize="small" />,
  search_memory: <MemoryIcon fontSize="small" />,
  add_memory: <MemoryIcon fontSize="small" />,
  update_memory: <MemoryIcon fontSize="small" />,
  list_memories: <MemoryIcon fontSize="small" />,
}

// 工具调用「进行中」与「已完成」时分别使用的中文动作描述
const TOOL_LABELS = {
  search_notes: { running: '搜索笔记中', done: '搜索笔记' },
  web_search: { running: '联网搜索中', done: '联网搜索' },
  get_current_note: { running: '读取当前笔记中', done: '读取当前笔记' },
  read_current_note: { running: '阅读笔记段落中', done: '阅读笔记段落' },
  read_note_image: { running: '正在阅读图片', done: '已阅读图片' },
  search_in_current_note: { running: '在笔记中搜索中', done: '笔记内搜索' },
  summarize_current_note_section: { running: '生成段落摘要中', done: '段落摘要' },
  create_note: { running: '创建笔记中', done: '创建笔记' },
  edit_note: { running: '编辑笔记中', done: '编辑笔记' },
  write_long_document: { running: '生成长文档中', done: '生成长文档' },
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
  if (tc.action) return `${def?.done || fallback} · 待确认`
  if (tc.done) return `${def?.done || fallback} ✓`
  return `${def?.running || fallback}…`
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

// 持久化前给步骤树正文「瘦身」：长文档正文已落盘为笔记，不必随会话整段保存，
// 否则超长内容会撑大 store。仅保留标题/状态/meta 与笔记链接。
const SECTION_PERSIST_LIMIT = 400
const slimStepsForPersist = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) return steps
  return steps.map((s) => {
    const content = typeof s.content === 'string' ? s.content : ''
    if (content.length <= SECTION_PERSIST_LIMIT) return s
    return { ...s, content: `${content.slice(0, SECTION_PERSIST_LIMIT)}…`, contentTruncated: true }
  })
}

// ─── 批量待办预览卡（create_todos 待确认时使用） ───

const BatchTodoActionCard = ({ action, theme, executing, onExecute }) => {
  const initialTodos = Array.isArray(action.args?.todos) ? action.args.todos : []
  // 维护本地副本：每条带 _key/_selected，便于勾选/删除
  const [localTodos, setLocalTodos] = useState(() =>
    initialTodos.map((t, i) => ({ ...t, _key: `${i}-${t.content || ''}`, _selected: true }))
  )
  const intro = action.args?.intro || ''
  const selectedCount = localTodos.filter((t) => t._selected).length

  const toggle = (key) => {
    setLocalTodos((prev) => prev.map((t) => t._key === key ? { ...t, _selected: !t._selected } : t))
  }
  const remove = (key) => {
    setLocalTodos((prev) => prev.filter((t) => t._key !== key))
  }
  const submit = () => {
    const final = localTodos
      .filter((t) => t._selected)
      .map(({ _key, _selected, ...rest }) => rest)
    if (final.length === 0) return
    onExecute?.(action, { todos: final })
  }

  const formatDue = (s) => {
    if (!s) return ''
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    const m = d.getMonth() + 1
    const day = d.getDate()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${m}/${day} ${hh}:${mm}`
  }

  return (
    <Paper
      elevation={0}
      sx={{
        mt: 0.75,
        px: 1.25,
        py: 1,
        maxWidth: 480,
        borderRadius: '14px',
        border: '1px solid',
        borderColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.28 : 0.26),
        bgcolor: theme.palette.mode === 'dark'
          ? alpha(theme.palette.warning.dark, 0.12)
          : alpha(theme.palette.warning.light, 0.14),
        boxShadow: `0 10px 28px ${alpha(theme.palette.warning.main, 0.08)}`,
        backdropFilter: 'blur(10px)',
      }}
    >
      <Typography variant="caption" sx={{ display: 'block', color: 'warning.main', fontWeight: 800, letterSpacing: 0.1, mb: 0.5 }}>
        AI 为你规划了 {localTodos.length} 条待办
      </Typography>
      {intro && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.75, lineHeight: 1.5 }}>
          {intro}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 280, overflowY: 'auto', pr: 0.5 }}>
        {localTodos.map((t) => (
          <Box
            key={t._key}
            sx={{
              display: 'flex', alignItems: 'flex-start', gap: 0.75,
              px: 0.75, py: 0.6,
              borderRadius: '10px',
              bgcolor: t._selected
                ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.1 : 0.08)
                : alpha(theme.palette.action.disabledBackground, 0.4),
              opacity: t._selected ? 1 : 0.55,
              transition: 'background-color 120ms, opacity 120ms',
            }}
          >
            <Box
              component="input"
              type="checkbox"
              checked={t._selected}
              onChange={() => toggle(t._key)}
              sx={{ mt: 0.4, cursor: 'pointer', accentColor: theme.palette.warning.main }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.4, wordBreak: 'break-word' }}>
                {t.content}
              </Typography>
              {t.description && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.4 }}>
                  {t.description}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 0.4, mt: 0.4, flexWrap: 'wrap' }}>
                {t.due_date && <Chip size="small" label={formatDue(t.due_date)} sx={{ height: 18, fontSize: '0.68rem' }} />}
                {t.is_important && <Chip size="small" label="重要" color="error" sx={{ height: 18, fontSize: '0.68rem' }} />}
                {t.is_urgent && <Chip size="small" label="紧急" color="warning" sx={{ height: 18, fontSize: '0.68rem' }} />}
              </Box>
            </Box>
            <IconButton size="small" onClick={() => remove(t._key)} sx={{ p: 0.25 }} aria-label="删除该条">
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mt: 1, justifyContent: 'flex-end' }}>
        <Button
          size="small"
          variant="contained"
          color="warning"
          disabled={executing || selectedCount === 0}
          onClick={submit}
          sx={{
            minWidth: 96, height: 30, px: 1.4,
            borderRadius: '999px', textTransform: 'none', fontWeight: 800,
            boxShadow: `0 8px 18px ${alpha(theme.palette.warning.main, 0.18)}`,
          }}
        >
          {executing ? '添加中…' : `添加 ${selectedCount} 条`}
        </Button>
      </Box>
    </Paper>
  )
}

// ─── 聊天消息组件 ───

const ChatMessage = React.memo(({ msg, theme, userAvatar, onExecuteAction, executingActionId, onSaveAsNote, onAskFollowUp, onOpenSource }) => {
  const isUser = msg.role === 'user'
  // 兼容多模态 content：array 时拆出 text + image_url
  const isArrayContent = Array.isArray(msg.content)
  const textContent = isArrayContent
    ? msg.content.filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n')
    : (msg.content || '')
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
          {isUser ? null : <SparkleIcon sx={{ fontSize: 18 }} />}
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
                  icon={TOOL_ICONS[tc.name] || <SparkleIcon fontSize="small" />}
                  label={formatToolLabel(tc)}
                  variant="outlined"
                  color={tc.action ? 'warning' : tc.done ? 'success' : 'default'}
                  sx={{ mr: 0.5, height: 24, fontSize: '0.75rem' }}
                />
              </Tooltip>
              {tc.action && tc.action.name === 'create_todos' && (
                <BatchTodoActionCard
                  action={tc.action}
                  theme={theme}
                  executing={executingActionId === tc.action.actionId}
                  onExecute={onExecuteAction}
                />
              )}
              {tc.action && tc.action.name !== 'create_todos' && (
                <Paper
                  elevation={0}
                  sx={{
                    mt: 0.75,
                    px: 1.25,
                    py: 1,
                    maxWidth: 420,
                    borderRadius: '14px',
                    border: '1px solid',
                    borderColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.28 : 0.26),
                    bgcolor: theme.palette.mode === 'dark'
                      ? alpha(theme.palette.warning.dark, 0.12)
                      : alpha(theme.palette.warning.light, 0.14),
                    boxShadow: `0 10px 28px ${alpha(theme.palette.warning.main, 0.08)}`,
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          color: 'warning.main',
                          fontWeight: 800,
                          letterSpacing: 0.1,
                          mb: 0.25,
                        }}
                      >
                        待你确认
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'text.primary',
                          fontWeight: 650,
                          lineHeight: 1.45,
                          wordBreak: 'break-word',
                        }}
                      >
                        {tc.action.summary || tc.action.label}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="contained"
                      color="warning"
                      disabled={executingActionId === tc.action.actionId}
                      onClick={() => onExecuteAction?.(tc.action)}
                      sx={{
                        flexShrink: 0,
                        minWidth: 84,
                        height: 30,
                        px: 1.4,
                        borderRadius: '999px',
                        textTransform: 'none',
                        fontWeight: 800,
                        boxShadow: `0 8px 18px ${alpha(theme.palette.warning.main, 0.18)}`,
                      }}
                    >
                      {executingActionId === tc.action.actionId ? '执行中…' : '确认'}
                    </Button>
                  </Box>
                  {tc.action.memoryReview?.summary && (
                    <Box sx={{ mt: 0.75, pt: 0.75, borderTop: `1px solid ${alpha(theme.palette.warning.main, 0.16)}` }}>
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
                </Paper>
              )}
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
                backdropFilter: 'blur(8px)',
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
        </Box>
      </Box>
    </Fade>
  )
})

export default function AIChatView({ onTodoUpdated }) {
  const theme = useTheme()
  const { userAvatar, notes, selectedNoteId, setSelectedNoteId, aiConversations, aiActiveConvId, aiNewChat, aiUpdateConv, aiCommandRequest, aiClearCommandRequest, loadNotes, updateNote, createNote } = useStore()

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState([]) // [{ id, dataUrl }]
  const [visionEnabled, setVisionEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [thinkingPhrase, setThinkingPhrase] = useState('Thinking… 思考中')
  const [toolCalls, setToolCalls] = useState([])
  const [steps, setSteps] = useState([])
  const [contextEnabled, setContextEnabled] = useState({ currentNote: true, relatedNotes: true, todos: true, memories: true })
  const [executingActionId, setExecutingActionId] = useState(null)
  const [messageContextMenu, setMessageContextMenu] = useState(null)
  const [inputContextMenu, setInputContextMenu] = useState(null)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const chunkListenerRef = useRef(null)
  const activeRequestIdRef = useRef(null)
  const cancelRequestedRef = useRef(false)

  // 切换对话时加载消息
  useEffect(() => {
    const conv = aiConversations.find(c => c.id === aiActiveConvId)
    setMessages(conv?.messages || [])
    setStreamContent('')
    setToolCalls([])
    setSteps([])
    setInput('')
    setPendingImages([])
  }, [aiActiveConvId, aiConversations])

  // 读取 vision 开关
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.ai?.getConfig?.().then((r) => {
      if (!cancelled && r?.success) setVisionEnabled(Boolean(r.data?.visionEnabled))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // loading 期间偶尔轮换 thinking 短语，间隔较长避免视觉抖动
  useEffect(() => {
    if (!loading) return undefined
    const id = window.setInterval(() => setThinkingPhrase(pickThinkingPhrase()), 6000)
    return () => window.clearInterval(id)
  }, [loading])

  // 自动滚动到底部：仅当用户已经停留在接近底部（≤80px）时才自动跟随，
  // 否则尊重用户向上滚动的位置，不强行拽回。
  const SCROLL_FOLLOW_THRESHOLD = 80
  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    if (distance <= SCROLL_FOLLOW_THRESHOLD) {
      node.scrollTop = node.scrollHeight
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
    const raw = Array.isArray(first.content)
      ? (first.content.find((p) => p?.type === 'text')?.text || '[图片]')
      : first.content
    const text = String(raw).replace(/\n/g, ' ').trim()
    return text.length > 24 ? text.slice(0, 24) + '…' : text
  }

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
    const images = pendingImages
    if ((!text && images.length === 0) || loading) return

    // 无活跃对话则自动新建
    let currentId = aiActiveConvId
    if (!currentId) {
      currentId = aiNewChat()
    }

    // 多模态 content：文本 + 图片 parts；纯文本则保持字符串以便兼容历史
    const userContent = images.length > 0
      ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ]
      : text

    const userMsg = { role: 'user', content: userContent }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setPendingImages([])
    setLoading(true)
    setThinkingPhrase(pickThinkingPhrase())
    setStreamContent('')
    setToolCalls([])

    // 持久化用户消息
    aiUpdateConv(currentId, { messages: newMessages, title: getConversationTitle(newMessages) })

    const requestId = `${currentId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    activeRequestIdRef.current = requestId
    cancelRequestedRef.current = false

    // 构建发送给 API 的消息（只含 role + content；多模态 content array 原样透传）
    const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))
    const currentNote = notes.find(note => String(note.id) === String(selectedNoteId))
    // 仅图片无文字时直接发送，跳过写作意图分类（否则会被判为需要追问）
    const intentResult = text
      ? await routeIntent({ prompt: text, messages: newMessages, currentNote })
      : { allowPersistence: false, disabledTools: [], needClarification: false, clarifyQuestion: '' }
    const { allowPersistence, disabledTools, needClarification, clarifyQuestion } = intentResult
    if (needClarification) {
      const finalMessages = [...newMessages, { role: 'assistant', content: clarifyQuestion }]
      setMessages(finalMessages)
      setStreamContent('')
      setToolCalls([])
      aiUpdateConv(currentId, { messages: finalMessages, title: getConversationTitle(finalMessages) })
      setLoading(false)
      inputRef.current?.focus()
      return
    }
    const contextPackage = await buildContext({ notes, selectedNoteId, query: text, contextEnabled })

    try {
      const whiteboardResult = allowPersistence
        ? await handleWhiteboardAIRequest({
          note: currentNote,
          prompt: text,
          messages: newMessages,
          updateNote,
          loadNotes,
        })
        : null

      if (whiteboardResult) {
        const finalMessages = [...newMessages, {
          role: 'assistant',
          content: whiteboardResult.content,
          contextSources: getContextSources(contextPackage)
        }]
        setMessages(finalMessages)
        setStreamContent('')
        setToolCalls([])
        aiUpdateConv(currentId, { messages: finalMessages, title: getConversationTitle(finalMessages) })
        return
      }

      // 当前不在画布笔记时，识别"新建一张画布并生成内容"的意图
      const createWhiteboardResult = allowPersistence
        ? await handleCreateWhiteboardRequest({
          note: currentNote,
          prompt: text,
          messages: newMessages,
          createNote,
          updateNote,
          loadNotes,
        })
        : null

      if (createWhiteboardResult) {
        if (createWhiteboardResult.noteId) setSelectedNoteId?.(createWhiteboardResult.noteId)
        const finalMessages = [...newMessages, {
          role: 'assistant',
          content: createWhiteboardResult.content,
          contextSources: getContextSources(contextPackage)
        }]
        setMessages(finalMessages)
        setStreamContent('')
        setToolCalls([])
        aiUpdateConv(currentId, { messages: finalMessages, title: getConversationTitle(finalMessages) })
        return
      }

      // 注册 chunk 监听
      if (chunkListenerRef.current) chunkListenerRef.current()
      let currentContent = ''
      let currentToolCalls = []
      let currentSteps = []

      const upsertStep = (id, patch) => {
        const idx = currentSteps.findIndex(s => s.id === id)
        if (idx === -1) {
          currentSteps = [...currentSteps, { id, ...patch }]
        } else {
          currentSteps = currentSteps.map(s => s.id === id ? { ...s, ...patch, meta: { ...s.meta, ...patch.meta } } : s)
        }
        setSteps([...currentSteps])
      }

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
          case 'step_start':
            upsertStep(chunk.stepId, {
              parentId: chunk.parentId,
              stepType: chunk.stepType,
              title: chunk.title || '',
              status: 'running',
              content: '',
              meta: chunk.meta || {},
            })
            break
          case 'step_token': {
            const node = currentSteps.find(s => s.id === chunk.stepId)
            upsertStep(chunk.stepId, { content: (node?.content || '') + (chunk.token || '') })
            break
          }
          case 'step_update':
            upsertStep(chunk.stepId, {
              ...(chunk.title ? { title: chunk.title } : {}),
              ...(chunk.status ? { status: chunk.status } : {}),
              ...(chunk.meta ? { meta: chunk.meta } : {}),
            })
            break
          case 'step_end':
            upsertStep(chunk.stepId, {
              status: chunk.status || 'done',
              ...(chunk.title ? { title: chunk.title } : {}),
              ...(chunk.content ? { content: chunk.content } : {}),
              ...(chunk.meta ? { meta: chunk.meta } : {}),
            })
            break
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
        scene: 'chat_panel',
        memoryQuery: text,
        requireConfirmation: true,
        disabledTools: visionEnabled ? disabledTools : [...(disabledTools || []), 'read_note_image'],
      })

      // 将流式结果添加为完整助手消息
      const stoppedByUser = Boolean(result.cancelled && cancelRequestedRef.current)
      const assistantContentBase = result.cancelled
        ? (currentContent || (stoppedByUser ? '已停止生成。' : '❌ 生成已中断，请重试'))
        : result.success
        ? (result.fullContent || currentContent || '')
        : (currentContent || `❌ ${result.error}`)
      const truncatedHint = result.outputLimitApplied
        ? '⚠️ 回复达到当前最大 token 限制，可能未完整输出。可以在高级设置里调高最大输出长度，或发送“继续”。'
        : '⚠️ 回复达到模型或服务商的输出上限，可能未完整输出。可以发送“继续”让 AI 接着写。'
      const assistantContent = result.truncated
        ? `${assistantContentBase}\n\n${truncatedHint}`
        : assistantContentBase

      const finalMessages = [...newMessages, {
        role: 'assistant',
        content: assistantContent,
        toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
        steps: currentSteps.length > 0 ? slimStepsForPersist(currentSteps) : undefined,
        contextSources: getContextSources(contextPackage),
        stopped: stoppedByUser
      }]
      setMessages(finalMessages)
      setStreamContent('')
      setToolCalls([])
      setSteps([])

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
      setSteps([])
      aiUpdateConv(currentId, { messages: errMessages })
    } finally {
      if (chunkListenerRef.current) {
        chunkListenerRef.current()
        chunkListenerRef.current = null
      }
      activeRequestIdRef.current = null
      cancelRequestedRef.current = false
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, pendingImages, loading, messages, aiActiveConvId, aiNewChat, aiUpdateConv, contextEnabled, loadNotes, notes, selectedNoteId, updateNote, createNote, setSelectedNoteId, visionEnabled])

  const handleCancel = useCallback(async () => {
    const requestId = activeRequestIdRef.current
    if (!loading || !requestId) return

    cancelRequestedRef.current = true
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

  const handleExecuteAction = useCallback(async (action, overrides = null) => {
    if (!action?.actionId || executingActionId) return
    setExecutingActionId(action.actionId)
    try {
      const result = await window.electronAPI?.ai?.executePendingAction?.(action.actionId, overrides)
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
        if (action.name === 'create_todo' || action.name === 'create_todos') {
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

  // 多模态：粘贴 / 拖拽 图片
  const MAX_IMAGES = 4
  const MAX_IMAGE_BYTES = 6 * 1024 * 1024 // 6MB

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
        {loading && (streamContent || toolCalls.length > 0 || steps.length > 0) && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start' }}>
            <Avatar sx={{
              width: 32, height: 32,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
            }}>
              <SparkleIcon sx={{ fontSize: 18 }} />
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
                    icon={TOOL_ICONS[tc.name] || <SparkleIcon fontSize="small" />}
                    label={formatToolLabel(tc)}
                    variant="outlined"
                    color={tc.action ? 'warning' : tc.done ? 'success' : 'default'}
                    sx={{ mr: 0.5, height: 24, fontSize: '0.75rem' }}
                  />
                  {tc.action && tc.action.name === 'create_todos' && (
                    <BatchTodoActionCard
                      action={tc.action}
                      theme={theme}
                      executing={executingActionId === tc.action.actionId}
                      onExecute={handleExecuteAction}
                    />
                  )}
                  {tc.action && tc.action.name !== 'create_todos' && (
                    <Paper
                      elevation={0}
                      sx={{
                        mt: 0.75,
                        px: 1.25,
                        py: 1,
                        maxWidth: 420,
                        borderRadius: '14px',
                        border: '1px solid',
                        borderColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.28 : 0.26),
                        bgcolor: theme.palette.mode === 'dark'
                          ? alpha(theme.palette.warning.dark, 0.12)
                          : alpha(theme.palette.warning.light, 0.14),
                        boxShadow: `0 10px 28px ${alpha(theme.palette.warning.main, 0.08)}`,
                        backdropFilter: 'blur(10px)',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="caption" sx={{ display: 'block', color: 'warning.main', fontWeight: 800, letterSpacing: 0.1, mb: 0.25 }}>
                            待你确认
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 650, lineHeight: 1.45, wordBreak: 'break-word' }}>
                            {tc.action.summary || tc.action.label}
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="contained"
                          color="warning"
                          disabled={executingActionId === tc.action.actionId}
                          onClick={() => handleExecuteAction(tc.action)}
                          sx={{
                            flexShrink: 0, minWidth: 84, height: 30, px: 1.4,
                            borderRadius: '999px', textTransform: 'none', fontWeight: 800,
                            boxShadow: `0 8px 18px ${alpha(theme.palette.warning.main, 0.18)}`,
                          }}
                        >
                          {executingActionId === tc.action.actionId ? '执行中…' : '确认'}
                        </Button>
                      </Box>
                    </Paper>
                  )}
                </Box>
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
        {loading && !streamContent && toolCalls.length === 0 && steps.length === 0 && (
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
              <ThinkingPhrase text={thinkingPhrase} />
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
          display: 'flex', flexDirection: 'column', gap: 1,
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
        }} onContextMenu={handleInputContextMenu}
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
            placeholder={visionEnabled ? "输入消息（可粘贴/拖拽图片）..." : "输入消息... (Enter 发送，Shift+Enter 换行)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
            disabled={loading ? false : (!input.trim() && pendingImages.length === 0)}
            sx={{
              width: 36,
              height: 36,
              bgcolor: loading
                ? alpha(theme.palette.error.main, 0.12)
                : ((input.trim() || pendingImages.length > 0) ? theme.palette.primary.main : 'transparent'),
              color: loading
                ? theme.palette.error.main
                : ((input.trim() || pendingImages.length > 0) ? theme.palette.primary.contrastText : theme.palette.action.disabled),
              '&:hover': {
                bgcolor: loading
                  ? alpha(theme.palette.error.main, 0.2)
                  : ((input.trim() || pendingImages.length > 0) ? theme.palette.primary.dark : 'transparent'),
              },
              transition: 'all 0.2s',
            }}
            aria-label={loading ? '停止生成' : '发送消息'}
          >
            {loading ? <StopIcon sx={{ fontSize: 18 }} /> : <SendIcon sx={{ fontSize: 18 }} />}
          </IconButton>
          </Box>
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
