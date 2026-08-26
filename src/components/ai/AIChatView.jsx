import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Typography, TextField, IconButton, Paper,
  Chip, Fade, Avatar, Menu, MenuItem, Button, Tooltip
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import {
  Send as SendIcon,
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
import { useShallow } from 'zustand/react/shallow'
import LongDocSteps from './LongDocSteps'
import FlotaAIIcon from '../common/FlotaAIIcon'
import FlotaAIOrb from '../common/FlotaAIOrb'
import { getContextSources, truncateText } from '../../utils/aiContextUtils'
import { routeIntent } from '../../utils/aiCore/intentRouter'
import { buildContext } from '../../utils/aiCore/contextBuilder'
import { getMessagePendingActions, patchMessagePendingAction } from '../../utils/aiCore/pendingActions'
import { buildMessageMetadata, createUserMessage, createAssistantMessage, extractPendingActions } from '../../utils/aiCore/messageModel'
import { runPendingAction } from '../../utils/aiCore/pendingActionExecutor'
import useAIStream from '../../hooks/useAIStream'

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
        animation: 'flota-thinking-fade 280ms ease',
        '@keyframes flota-thinking-fade': {
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
      '@keyframes flota-thinking-dot': {
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
          animation: 'flota-thinking-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.16}s`
        }}
      />
    ))}
  </Box>
)

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
  edit_notes: <EditIcon fontSize="small" />,
  create_whiteboard: <EditIcon fontSize="small" />,
  update_whiteboard: <EditIcon fontSize="small" />,
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
  edit_notes: EditIcon,
  create_whiteboard: EditIcon,
  update_whiteboard: EditIcon,
  write_long_document: NoteIcon,
  search_todos: CheckIcon,
  get_today_todos: CalendarIcon,
  create_todo: CheckIcon,
  create_todos: CheckIcon,
  search_memory: MemoryIcon,
  add_memory: MemoryIcon,
  update_memory: MemoryIcon,
  list_memories: MemoryIcon,
}

const LoadingAvatarContent = ({ activeTool, iconSize = 14 }) => {
  const targetKey = activeTool && TOOL_AVATAR_ICON[activeTool] ? activeTool : '__dots__'
  const Icon = targetKey !== '__dots__' ? TOOL_AVATAR_ICON[targetKey] : null
  return (
    <Box
      key={targetKey}
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'inherit',
        animation: 'flota-avatar-fade 280ms ease',
        '@keyframes flota-avatar-fade': {
          '0%': { opacity: 0, transform: 'scale(0.85)' },
          '100%': { opacity: 1, transform: 'scale(1)' }
        }
      }}
    >
      {Icon ? <Icon sx={{ fontSize: iconSize }} /> : <ThinkingDots dotSize={Math.max(3, Math.round(iconSize * 0.28))} />}
    </Box>
  )
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
  edit_notes: { running: '批量编辑笔记中', done: '批量编辑笔记' },
  create_whiteboard: { running: '创建画布中', done: '创建画布' },
  update_whiteboard: { running: '修改画布中', done: '修改画布' },
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
  if (tc.action?.status === 'done') return `${def?.done || fallback} ✓`
  if (tc.action?.status === 'failed') return `${def?.done || fallback} · 失败`
  if (tc.action?.status === 'running') return `${def?.running || fallback}…`
  if (tc.action) return `${def?.done || fallback} · 待确认`
  if (tc.done) return `${def?.done || fallback} ✓`
  return `${def?.running || fallback}…`
}


const QUICK_ACTIONS = [
  { label: '🏷️ 整理标题', prompt: '帮我把最近的笔记标题润色一下，让它们更清晰统一。先搜索我的笔记，再用批量编辑一次性给出修改建议让我确认。' },
  { label: '🔖 整理标签', prompt: '帮我给最近的笔记补充并统一标签。先搜索我的笔记，再用批量编辑一次性给出标签建议让我确认。' },
  { label: '📰 生成日报', prompt: '根据我今天的笔记和待办，帮我生成一份今日工作日报，包含已完成事项、进展和明日计划。' },
  { label: '📖 写部小说', prompt: '我想写一部小说，帮我构思并撰写。请先和我确认题材、主角和大致情节走向。' },
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

  const formatRepeat = (todo) => {
    const interval = Number(todo.repeat_interval) > 1 ? Number(todo.repeat_interval) : 1
    const prefix = interval > 1 ? `每${interval}` : '每'
    if (todo.repeat_type === 'daily') return `${prefix}天`
    if (todo.repeat_type === 'weekly') return `${prefix}周`
    if (todo.repeat_type === 'monthly') return `${prefix}月`
    if (todo.repeat_type === 'yearly') return `${prefix}年`
    return ''
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
                {formatRepeat(t) && <Chip size="small" label={formatRepeat(t)} color="primary" variant="outlined" sx={{ height: 18, fontSize: '0.68rem' }} />}
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

const SimpleActionCard = ({ action, theme, executing, onExecute }) => {
  const status = action.status || (executing ? 'running' : 'pending')
  const isDone = status === 'done'
  const isFailed = status === 'failed'
  const paletteKey = isDone ? 'success' : isFailed ? 'error' : 'warning'
  const title = isDone ? '已完成' : isFailed ? '执行失败' : executing ? '执行中' : '待你确认'
  const detail = action.resultMessage || action.summary || action.label

  return (
    <Paper
      elevation={0}
      sx={{
        mt: 0.75,
        px: 1.25,
        py: 1,
        maxWidth: 420,
        borderRadius: '14px',
        border: '1px solid',
        borderColor: alpha(theme.palette[paletteKey].main, theme.palette.mode === 'dark' ? 0.28 : 0.26),
        bgcolor: theme.palette.mode === 'dark'
          ? alpha(theme.palette[paletteKey].dark, 0.12)
          : alpha(theme.palette[paletteKey].light, 0.14),
        boxShadow: `0 10px 28px ${alpha(theme.palette[paletteKey].main, 0.08)}`,
        backdropFilter: 'blur(10px)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: `${paletteKey}.main`,
              fontWeight: 800,
              letterSpacing: 0.1,
              mb: 0.25,
            }}
          >
            {title}
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
            {detail}
          </Typography>
        </Box>
        {!isDone && !isFailed && (
          <Button
            size="small"
            variant="contained"
            color="warning"
            disabled={executing}
            onClick={() => onExecute?.(action)}
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
            {executing ? '执行中…' : '确认'}
          </Button>
        )}
      </Box>
      {action.memoryReview?.summary && !isDone && !isFailed && (
        <Box sx={{ mt: 0.75, pt: 0.75, borderTop: `1px solid ${alpha(theme.palette.warning.main, 0.16)}` }}>
          <Typography variant="caption" color={action.memoryReview.level === 'warning' ? 'warning.main' : 'text.secondary'} sx={{ display: 'block' }}>
            {action.memoryReview.summary}
          </Typography>
          {action.memoryReview.candidates?.slice(0, 2).map(candidate => (
            <Typography key={candidate.id || candidate.content} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1, mt: 0.25 }}>
              相似记忆：{candidate.content}
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  )
}

// ─── 批量编辑笔记预览卡（edit_notes 待确认时使用） ───

const BatchEditNotesActionCard = ({ action, theme, executing, onExecute }) => {
  const initialEdits = Array.isArray(action.args?.edits) ? action.args.edits : []
  const [localEdits, setLocalEdits] = useState(() =>
    initialEdits.map((e, i) => ({ ...e, _key: `${i}-${e.id}`, _selected: true }))
  )
  const status = action.status || (executing ? 'running' : 'pending')
  const isDone = status === 'done'
  const isFailed = status === 'failed'
  const selectedCount = localEdits.filter((e) => e._selected).length

  const toggle = (key) => {
    setLocalEdits((prev) => prev.map((e) => e._key === key ? { ...e, _selected: !e._selected } : e))
  }
  const submit = () => {
    const final = localEdits
      .filter((e) => e._selected)
      .map(({ _key, _selected, ...rest }) => rest)
    if (final.length === 0) return
    onExecute?.(action, { edits: final })
  }

  if (isDone || isFailed) {
    return <SimpleActionCard action={action} theme={theme} executing={executing} onExecute={onExecute} />
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
        AI 想批量整理 {localEdits.length} 条笔记
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 280, overflowY: 'auto', pr: 0.5 }}>
        {localEdits.map((e) => (
          <Box
            key={e._key}
            sx={{
              display: 'flex', alignItems: 'flex-start', gap: 0.75,
              px: 0.75, py: 0.6,
              borderRadius: '10px',
              bgcolor: e._selected
                ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.1 : 0.08)
                : alpha(theme.palette.action.disabledBackground, 0.4),
              opacity: e._selected ? 1 : 0.55,
              transition: 'background-color 120ms, opacity 120ms',
            }}
          >
            <Box
              component="input"
              type="checkbox"
              checked={e._selected}
              onChange={() => toggle(e._key)}
              sx={{ mt: 0.4, cursor: 'pointer', accentColor: theme.palette.warning.main }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                #{e.id}
              </Typography>
              {e.title !== undefined && (
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.4, wordBreak: 'break-word' }}>
                  标题 → {e.title || '（清空）'}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 0.4, mt: 0.4, flexWrap: 'wrap', alignItems: 'center' }}>
                {e.tags !== undefined && String(e.tags).split(/[,，]/).map((t) => t.trim()).filter(Boolean).map((t, i) => (
                  <Chip key={`${t}-${i}`} size="small" label={t} sx={{ height: 18, fontSize: '0.68rem' }} />
                ))}
              </Box>
            </Box>
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
          {executing ? '应用中…' : `应用 ${selectedCount} 条`}
        </Button>
      </Box>
    </Paper>
  )
}

// ─── 聊天消息组件 ───

const ChatMessage = React.memo(({ msg, theme, userAvatar, onExecuteAction, executingActionIds, onSaveAsNote, onAskFollowUp, onOpenSource }) => {
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
          {isUser ? null : <FlotaAIIcon sx={{ fontSize: 20 }} />}
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
                  icon={TOOL_ICONS[tc.name] || <FlotaAIIcon sx={{ fontSize: 16 }} />}
                  label={formatToolLabel(tc)}
                  variant="outlined"
                  color={tc.error ? 'error' : tc.done ? 'success' : 'default'}
                  sx={{ mr: 0.5, height: 24, fontSize: '0.75rem' }}
                />
              </Tooltip>
            </Box>
          ))}

          {/* 待确认动作卡（统一读取 msg.actions 与历史 toolCalls[].action） */}
          {getMessagePendingActions(msg).map((action) => (
            <Box key={action.actionId} sx={{ mb: 0.75 }}>
              {action.name === 'create_todos' ? (
                <BatchTodoActionCard
                  action={action}
                  theme={theme}
                  executing={executingActionIds.has(action.actionId)}
                  onExecute={onExecuteAction}
                />
              ) : action.name === 'edit_notes' ? (
                <BatchEditNotesActionCard
                  action={action}
                  theme={theme}
                  executing={executingActionIds.has(action.actionId)}
                  onExecute={onExecuteAction}
                />
              ) : (
                <SimpleActionCard
                  action={action}
                  theme={theme}
                  executing={executingActionIds.has(action.actionId)}
                  onExecute={onExecuteAction}
                />
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
  const {
    userAvatar,
    notes,
    selectedNoteId,
    setSelectedNoteId,
    aiConversations,
    aiActiveConvId,
    aiNoteConversationMap,
    aiNewChat,
    aiEnsureNoteChat,
    aiSwitchConv,
    aiSetActiveConv,
    aiUpdateConv,
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
    selectedNoteId: state.selectedNoteId,
    setSelectedNoteId: state.setSelectedNoteId,
    aiConversations: state.aiConversations,
    aiActiveConvId: state.aiActiveConvId,
    aiNoteConversationMap: state.aiNoteConversationMap,
    aiNewChat: state.aiNewChat,
    aiEnsureNoteChat: state.aiEnsureNoteChat,
    aiSwitchConv: state.aiSwitchConv,
    aiSetActiveConv: state.aiSetActiveConv,
    aiUpdateConv: state.aiUpdateConv,
    aiCommandRequest: state.aiCommandRequest,
    aiClearCommandRequest: state.aiClearCommandRequest,
    currentView: state.currentView,
    loadNotes: state.loadNotes,
    updateNote: state.updateNote,
    createNote: state.createNote,
    deleteNote: state.deleteNote,
  })))

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState([]) // [{ id, dataUrl }]
  const [visionEnabled, setVisionEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  // 正在流式生成的会话 id。loading 是组件级单例，必须配合它判断「思考中」属于哪个会话，
  // 否则在 A 生成时切到 B，B 会错误地显示思考中并被锁住输入。
  const [streamingConvId, setStreamingConvId] = useState(null)
  const [streamContent, setStreamContent] = useState('')
  const [thinkingPhrase, setThinkingPhrase] = useState('Thinking… 思考中')
  const [toolCalls, setToolCalls] = useState([])
  const [steps, setSteps] = useState([])
  const [activeTool, setActiveTool] = useState(null)
  const [contextEnabled, setContextEnabled] = useState({ currentNote: true, relatedNotes: true, todos: true, memories: true })
  const [executingActionIds, setExecutingActionIds] = useState(() => new Set())
  const [messageContextMenu, setMessageContextMenu] = useState(null)
  const [inputContextMenu, setInputContextMenu] = useState(null)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const messagesRef = useRef([])
  const conversationIdRef = useRef(aiActiveConvId)
  const streamDraftsRef = useRef(new Map())
  const pendingScrollToLatestConvRef = useRef(null)
  const activeToolClearTimerRef = useRef(null)
  const activeToolStartedAtRef = useRef(0)
  const { runStream, cancel } = useAIStream()
  const currentNote = useMemo(
    () => notes.find(note => String(note.id) === String(selectedNoteId)),
    [notes, selectedNoteId]
  )
  const noteConversationId = selectedNoteId == null ? null : aiNoteConversationMap?.[String(selectedNoteId)] || null
  // 选中了笔记 → 只显示该笔记自己的对话（没有则为空，开新对话）。
  // 未选中任何笔记（通用聊天）→ 跟随全局活动对话。
  // 关键：选中笔记时绝不回退到 aiActiveConvId，否则切到「尚无对话的笔记」会串显示上一条/通用对话。
  const currentConversationId = selectedNoteId != null ? noteConversationId : (aiActiveConvId || null)
  const currentConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === currentConversationId) || null,
    [aiConversations, currentConversationId]
  )
  const previousConversationIdRef = useRef(currentConversationId)
  const pendingConversationIdRef = useRef(null)

  const readStreamDraft = useCallback((conversationId) => {
    if (!conversationId) return null
    return streamDraftsRef.current.get(conversationId) || null
  }, [])

  const writeStreamDraft = useCallback((conversationId, patch) => {
    if (!conversationId) return null
    const prev = streamDraftsRef.current.get(conversationId) || {
      streamContent: '',
      toolCalls: [],
      steps: [],
    }
    const next = { ...prev, ...patch }
    streamDraftsRef.current.set(conversationId, next)
    return next
  }, [])

  const clearStreamDraft = useCallback((conversationId) => {
    if (!conversationId) return
    streamDraftsRef.current.delete(conversationId)
  }, [])

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

  // 当前视图是否正在流式生成：必须当前可见会话恰好就是那个正在生成的会话。
  // 这样在别的会话后台生成时，本视图不会被误锁。
  const isStreaming = loading && streamingConvId != null && streamingConvId === currentConversationId
  const hasBackgroundStreaming = loading && streamingConvId != null && streamingConvId !== currentConversationId
  const backgroundStreamingConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === streamingConvId) || null,
    [aiConversations, streamingConvId]
  )
  const backgroundStreamingNoteTitle = useMemo(() => {
    const noteId = backgroundStreamingConversation?.noteId
    if (noteId == null) return ''
    return notes.find((note) => String(note.id) === String(noteId))?.title || ''
  }, [backgroundStreamingConversation, notes])

  // 切换对话时加载消息
  useEffect(() => {
    if (previousConversationIdRef.current !== currentConversationId) {
      const isSendInitiatedSwitch = (
        pendingConversationIdRef.current &&
        pendingConversationIdRef.current === currentConversationId
      )
      previousConversationIdRef.current = currentConversationId
      conversationIdRef.current = currentConversationId
      if (isSendInitiatedSwitch) {
        pendingConversationIdRef.current = null
        return
      }
      setMessages(currentConversation?.messages || [])
      messagesRef.current = currentConversation?.messages || []
      pendingScrollToLatestConvRef.current = currentConversationId
      const draft = loading && streamingConvId === currentConversationId
        ? readStreamDraft(currentConversationId)
        : null
      setStreamContent(draft?.streamContent || '')
      setToolCalls(draft?.toolCalls || [])
      setSteps(draft?.steps || [])
      setInput('')
      setPendingImages([])
    }
  }, [currentConversation, currentConversationId, loading, streamingConvId, readStreamDraft])

  useEffect(() => {
    if (!currentConversationId || previousConversationIdRef.current !== currentConversationId || isStreaming) return
    setMessages(currentConversation?.messages || [])
    messagesRef.current = currentConversation?.messages || []
  }, [currentConversation, currentConversationId, isStreaming])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    conversationIdRef.current = currentConversationId
  }, [currentConversationId])

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
    const id = window.setInterval(() => setThinkingPhrase(pickThinkingPhrase()), 3500)
    return () => window.clearInterval(id)
  }, [loading])

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

  const getConversationTitle = (msgs) => {
    const first = msgs.find(m => m.role === 'user')
    if (!first) return '新对话'
    const raw = Array.isArray(first.content)
      ? (first.content.find((p) => p?.type === 'text')?.text || '[图片]')
      : first.content
    const text = String(raw).replace(/\n/g, ' ').trim()
    return text.length > 24 ? text.slice(0, 24) + '…' : text
  }

  const handleJumpToStreamingConversation = useCallback(() => {
    if (!streamingConvId) return
    aiSwitchConv(streamingConvId)
  }, [streamingConvId, aiSwitchConv])

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

    let currentId = currentConversationId
    if (selectedNoteId == null) {
      if (!currentId) {
        currentId = aiNewChat()
      } else {
        aiSetActiveConv(currentId)
      }
    } else {
      currentId = aiEnsureNoteChat(selectedNoteId, {
        title: currentNote ? `关于「${truncateText(currentNote.title || '未命名', 18)}」` : '新对话'
      })
    }
    pendingConversationIdRef.current = currentId
    conversationIdRef.current = currentId

    // 多模态 content：文本 + 图片 parts；纯文本则保持字符串以便兼容历史
    const userContent = images.length > 0
      ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ]
      : text

    const userMsg = createUserMessage({
      content: userContent,
      metadata: buildMessageMetadata({
        conversationId: currentId,
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note',
      }),
    })
    const newMessages = [...(messagesRef.current || []), userMsg]
    messagesRef.current = newMessages
    setMessages(newMessages)
    setInput('')
    setPendingImages([])
    setLoading(true)
    setStreamingConvId(currentId)
    setThinkingPhrase(pickThinkingPhrase())
    setStreamContent('')
    setToolCalls([])
    setSteps([])
    writeStreamDraft(currentId, {
      streamContent: '',
      toolCalls: [],
      steps: [],
    })

    // 持久化用户消息
    aiUpdateConv(currentId, {
      messages: newMessages,
      title: getConversationTitle(newMessages),
      noteId: selectedNoteId == null ? null : String(selectedNoteId),
      source: selectedNoteId == null ? 'general' : 'note'
    })

    // 该请求归属的对话。流式回包/最终落地前都据此判断用户是否已切到别的对话，
    // 切走后只更新对应会话的持久化数据，绝不把旧请求的内容写进当前视图（否则会“串台”）。
    const isActiveView = () => conversationIdRef.current === currentId

    try {
      // 构建发送给 API 的消息（只含 role + content；多模态 content array 原样透传）
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))
      // 仅图片无文字时直接发送，跳过写作意图分类（否则会被判为需要追问）
      const intentResult = text
        ? await routeIntent({ prompt: text, messages: newMessages, currentNote })
        : { allowPersistence: false, disabledTools: [], needClarification: false, clarifyQuestion: '' }
      const { disabledTools, needClarification, clarifyQuestion } = intentResult
      if (needClarification) {
        clearStreamDraft(currentId)
        const finalMessages = [...newMessages, { role: 'assistant', content: clarifyQuestion }]
        if (isActiveView()) {
          messagesRef.current = finalMessages
          setMessages(finalMessages)
          setStreamContent('')
          setToolCalls([])
        }
        aiUpdateConv(currentId, {
          messages: finalMessages,
          title: getConversationTitle(finalMessages),
          noteId: selectedNoteId == null ? null : String(selectedNoteId),
          source: selectedNoteId == null ? 'general' : 'note'
        })
        return
      }
      const contextPackage = await buildContext({ notes, selectedNoteId, query: text, contextEnabled })

      let currentToolCalls = []
      let currentSteps = []

      const upsertStep = (id, patch) => {
        const idx = currentSteps.findIndex(s => s.id === id)
        if (idx === -1) {
          currentSteps = [...currentSteps, { id, ...patch }]
        } else {
          currentSteps = currentSteps.map(s => s.id === id ? { ...s, ...patch, meta: { ...s.meta, ...patch.meta } } : s)
        }
        writeStreamDraft(currentId, { steps: [...currentSteps] })
        if (isActiveView()) setSteps([...currentSteps])
      }

      const { result, content: currentContent, cancelledByUser, requestId } = await runStream({
        conversationId: currentId,
        messages: apiMessages,
        contextPackage,
        requestPrefix: 'aichat',
        options: {
          scene: 'chat_panel',
          memoryQuery: text,
          requireConfirmation: true,
          actionContext: {
            selectedNoteId: selectedNoteId == null ? null : String(selectedNoteId),
            source: selectedNoteId == null ? 'general' : 'note',
          },
          disabledTools,
        },
        onContent: (c) => {
          writeStreamDraft(currentId, { streamContent: c })
          if (isActiveView()) setStreamContent(c)
        },
        onChunkError: (chunk) => {
          const draft = writeStreamDraft(currentId, {
            streamContent: `${readStreamDraft(currentId)?.streamContent || ''}\n\n⚠️ ${chunk.content}`
          })
          if (isActiveView()) setStreamContent(draft.streamContent)
        },
        onChunk: (chunk) => {
          switch (chunk.type) {
            case 'tool_start':
              showActiveTool(chunk.name || null)
              currentToolCalls = [...currentToolCalls, { name: chunk.name, args: chunk.args, done: false }]
              writeStreamDraft(currentId, { toolCalls: [...currentToolCalls] })
              if (isActiveView()) setToolCalls([...currentToolCalls])
              break
            case 'tool_end': {
              clearActiveTool()
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
              writeStreamDraft(currentId, { toolCalls: [...currentToolCalls] })
              if (isActiveView()) setToolCalls([...currentToolCalls])
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
            default:
              break
          }
        },
      })

      // 将流式结果添加为完整助手消息
      const stoppedByUser = Boolean(result?.cancelled && cancelledByUser)
      const assistantContentBase = result?.cancelled
        ? (currentContent || (stoppedByUser ? '已停止生成。' : '❌ 生成已中断，请重试'))
        : result?.success
        ? (result.fullContent || currentContent || '')
        : (currentContent || `❌ ${result?.error || '请求失败'}`)
      const truncatedHint = result?.outputLimitApplied
        ? '⚠️ 回复达到当前最大 token 限制，可能未完整输出。可以在高级设置里调高最大输出长度，或发送“继续”。'
        : '⚠️ 回复达到模型或服务商的输出上限，可能未完整输出。可以发送“继续”让 AI 接着写。'
      const assistantContent = result?.truncated
        ? `${assistantContentBase}\n\n${truncatedHint}`
        : assistantContentBase

      const pendingActions = extractPendingActions(currentToolCalls)
      clearStreamDraft(currentId)
      const finalMessages = [...newMessages, createAssistantMessage({
        content: assistantContent,
        toolCalls: currentToolCalls,
        actions: pendingActions,
        steps: currentSteps.length > 0 ? slimStepsForPersist(currentSteps) : undefined,
        contextSources: getContextSources(contextPackage),
        stopped: stoppedByUser,
        metadata: buildMessageMetadata({
          conversationId: currentId,
          noteId: selectedNoteId == null ? null : String(selectedNoteId),
          source: selectedNoteId == null ? 'general' : 'note',
          requestId,
        }),
      })]
      messagesRef.current = finalMessages
      if (isActiveView()) {
        setMessages(finalMessages)
        setStreamContent('')
        setToolCalls([])
        setSteps([])
      }

      // 持久化完整对话
      aiUpdateConv(currentId, {
        messages: finalMessages,
        title: getConversationTitle(finalMessages),
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note'
      })
    } catch (error) {
      clearStreamDraft(currentId)
      const errMessages = [...newMessages, {
        role: 'assistant',
        content: `❌ 发生错误: ${error.message}`
      }]
      messagesRef.current = errMessages
      if (isActiveView()) {
        setMessages(errMessages)
        setStreamContent('')
        setToolCalls([])
        setSteps([])
      }
      aiUpdateConv(currentId, {
        messages: errMessages,
        title: getConversationTitle(errMessages),
        noteId: selectedNoteId == null ? null : String(selectedNoteId),
        source: selectedNoteId == null ? 'general' : 'note'
      })
    } finally {
      pendingConversationIdRef.current = null
      setStreamingConvId(null)
      if (activeToolClearTimerRef.current) {
        window.clearTimeout(activeToolClearTimerRef.current)
        activeToolClearTimerRef.current = null
      }
      setActiveTool(null)
      setLoading(false)
      if (currentView === 'ai' && isActiveView()) {
        inputRef.current?.focus()
      }
    }
  }, [input, pendingImages, loading, currentConversationId, aiEnsureNoteChat, aiNewChat, aiSetActiveConv, aiUpdateConv, contextEnabled, notes, selectedNoteId, currentNote, runStream, showActiveTool, clearActiveTool, currentView])

  const handleCancel = useCallback(async () => {
    if (!loading) return
    await cancel()
  }, [loading, cancel])

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
    const nextMessages = updater(messagesRef.current || [])
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    if (conversationIdRef.current) {
      aiUpdateConv(conversationIdRef.current, { messages: nextMessages, title: getConversationTitle(nextMessages) })
    }
    return nextMessages
  }, [aiUpdateConv])

  const handleExecuteAction = useCallback(async (action, overrides = null) => {
    if (!action?.actionId || executingActionIds.has(action.actionId)) return
    setExecutingActionIds(prev => new Set(prev).add(action.actionId))
    updateCurrentConversationMessages(prev => prev.map(msg =>
      patchMessagePendingAction(msg, action.actionId, { status: 'running' })
    ))
    try {
      const { success, message, error, reloadNotes, reloadTodos } = await runPendingAction({
        action,
        overrides,
        deps: { currentNote, notes, createNote, deleteNote, updateNote, loadNotes, setSelectedNoteId },
      })
      updateCurrentConversationMessages(prev => [
        ...prev.map(msg => patchMessagePendingAction(msg, action.actionId, {
          status: success ? 'done' : 'failed',
          resultMessage: message,
          done: success,
          summary: message,
          error: success ? undefined : error,
        })),
        {
          role: 'assistant',
          content: message,
          toolCalls: [{
            name: action.name,
            done: success,
            summary: message,
            error: success ? undefined : error,
          }],
        }
      ])
      if (reloadTodos) onTodoUpdated?.()
      if (reloadNotes) loadNotes?.()
    } finally {
      setExecutingActionIds(prev => {
        const next = new Set(prev)
        next.delete(action.actionId)
        return next
      })
    }
  }, [createNote, currentNote, deleteNote, executingActionIds, loadNotes, notes, onTodoUpdated, setSelectedNoteId, updateCurrentConversationMessages, updateNote])

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
        {messages.length === 0 && !isStreaming && (
          <Box sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 3, py: 4,
          }}>
            <FlotaAIOrb />
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
                  disabled={loading}
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
              executingActionIds={executingActionIds}
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
                    icon={TOOL_ICONS[tc.name] || <FlotaAIIcon sx={{ fontSize: 16 }} />}
                    label={formatToolLabel(tc)}
                    variant="outlined"
                    color={tc.action?.status === 'done' ? 'success' : tc.action?.status === 'failed' ? 'error' : tc.action ? 'warning' : tc.done ? 'success' : 'default'}
                    sx={{ mr: 0.5, height: 24, fontSize: '0.75rem' }}
                  />
                  {tc.action && tc.action.name === 'create_todos' && (
                    <BatchTodoActionCard
                      action={tc.action}
                      theme={theme}
                      executing={executingActionIds.has(tc.action.actionId)}
                      onExecute={handleExecuteAction}
                    />
                  )}
                  {tc.action && tc.action.name === 'edit_notes' && (
                    <BatchEditNotesActionCard
                      action={tc.action}
                      theme={theme}
                      executing={executingActionIds.has(tc.action.actionId)}
                      onExecute={handleExecuteAction}
                    />
                  )}
                  {tc.action && tc.action.name !== 'create_todos' && tc.action.name !== 'edit_notes' && (
                    <SimpleActionCard
                      action={tc.action}
                      theme={theme}
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
              <Button size="small" color="error" variant="outlined" onClick={handleCancel}>
                停止
              </Button>
            </Box>
          </Paper>
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
            disabled={isStreaming}
            autoFocus
          />
          <IconButton
            onClick={isStreaming ? handleCancel : () => handleSend()}
            disabled={isStreaming ? false : (loading || (!input.trim() && pendingImages.length === 0))}
            sx={{
              width: 36,
              height: 36,
              bgcolor: isStreaming
                ? alpha(theme.palette.error.main, 0.12)
                : ((input.trim() || pendingImages.length > 0) ? theme.palette.primary.main : 'transparent'),
              color: isStreaming
                ? theme.palette.error.main
                : ((input.trim() || pendingImages.length > 0) ? theme.palette.primary.contrastText : theme.palette.action.disabled),
              '&:hover': {
                bgcolor: isStreaming
                  ? alpha(theme.palette.error.main, 0.2)
                  : ((input.trim() || pendingImages.length > 0) ? theme.palette.primary.dark : 'transparent'),
              },
              transition: 'all 0.2s',
            }}
            aria-label={isStreaming ? '停止生成' : '发送消息'}
          >
            {isStreaming ? <StopIcon sx={{ fontSize: 18 }} /> : <SendIcon sx={{ fontSize: 18 }} />}
          </IconButton>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
          {hasBackgroundStreaming
            ? '另一个对话正在生成中，当前不能并行发送新请求。'
            : 'FlotaAI 可能会出错，请核实重要信息'}
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
