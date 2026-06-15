import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  alpha
} from '@mui/material'
import {
  CheckCircle as TodoIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  ManageSearch as InsightIcon,
  Memory as MemoryIcon,
  NoteAlt as NoteIcon
} from '@mui/icons-material'
import { useStore } from '../../store/useStore'
import { getRelatedNotes, getTodoTemporalStatus, isTodoCompleted, normalizeMemories, truncateText } from '../../utils/aiContextUtils'
import { toListResult } from '../../utils/todoDisplayUtils'

const getTodoScore = (todo, query) => {
  const text = `${todo?.content || ''}\n${todo?.description || ''}\n${todo?.tags || ''}`.toLowerCase()
  const words = String(query || '').toLowerCase().split(/[\s，。！？、,.!?;；:：()[\]{}"'`]+/).filter(word => word.length > 1).slice(0, 20)
  const wordScore = words.reduce((score, word) => score + (text.includes(word) ? 2 : 0), 0)
  const priorityScore = Number(todo?.is_important) ? 1.5 : 0
  const dueScore = todo?.due_date ? 1 : 0
  return wordScore + priorityScore + dueScore
}

const Section = ({ icon, title, children }) => (
  <Box sx={{ mb: 0.75 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, px: 0.7, pt: 0.35, pb: 0.2 }}>
      {icon}
      <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'text.disabled' }}>
        {title}
      </Typography>
    </Box>
    {children}
  </Box>
)

const RelatedContextPanel = ({
  embedded = false,
  forceExpanded = false,
  notes: notesProp,
  selectedNoteId: selectedNoteIdProp,
  onSelectNote,
  onOpenTodo,
}) => {
  const store = useStore()
  const notes = notesProp || store.notes || []
  const selectedNoteId = selectedNoteIdProp ?? store.selectedNoteId
  const setSelectedNoteId = onSelectNote || store.setSelectedNoteId
  const setCurrentView = onOpenTodo || store.setCurrentView
  const [todos, setTodos] = useState([])
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(() => {
    if (forceExpanded) return true
    try {
      return window.localStorage?.getItem('flota.relatedContext.expanded') === 'true'
    } catch {
      return false
    }
  })

  const currentNote = notes.find(note => String(note.id) === String(selectedNoteId))
  const query = `${currentNote?.title || ''}\n${currentNote?.tags || ''}\n${truncateText(currentNote?.content, 1000)}`

  const relatedNotes = useMemo(() => (
    getRelatedNotes({ notes, selectedNoteId, query, limit: 3 })
  ), [notes, query, selectedNoteId])

  const relatedTodos = useMemo(() => (
    todos
      .filter(todo => !isTodoCompleted(todo))
      .map(todo => ({ todo, score: getTodoScore(todo, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ todo }) => todo)
  ), [query, todos])

  useEffect(() => {
    const isExpanded = forceExpanded || expanded
    if (!currentNote || !isExpanded) {
      setTodos([])
      setMemories([])
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    const limitedQuery = truncateText(query, 260)
    Promise.allSettled([
      window.electronAPI?.todos?.getAll?.({ includeCompleted: false, limit: 80 }),
      window.electronAPI?.mem0?.search?.({
        userId: 'current_user',
        query: limitedQuery,
        options: { limit: 3 }
      })
    ]).then(([todoResult, memoryResult]) => {
      if (cancelled) return
      const todoValue = todoResult.status === 'fulfilled' ? todoResult.value : null
      const todoItems = toListResult(todoValue)
      setTodos(todoItems.filter(todo => !isTodoCompleted(todo)))

      const memoryValue = memoryResult.status === 'fulfilled' ? memoryResult.value : null
      setMemories(normalizeMemories(Array.isArray(memoryValue?.results) ? memoryValue.results : [], 3))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [currentNote, expanded, forceExpanded, query])

  if (!currentNote) return null

  const hasContent = relatedNotes.length > 0 || relatedTodos.length > 0 || memories.length > 0
  const insightCount = relatedNotes.length + relatedTodos.length + memories.length
  const bestNote = relatedNotes[0]
  const summaryText = loading
    ? '正在分析当前笔记'
    : hasContent
      ? `${insightCount} 条可用线索${bestNote?.reasons?.[0] ? ` · ${bestNote.reasons[0]}` : ''}`
      : '暂无可靠关联'

  const isExpanded = forceExpanded || expanded

  const handleToggle = () => {
    if (forceExpanded) return
    setExpanded((prev) => {
      const next = !prev
      try {
        window.localStorage?.setItem('flota.relatedContext.expanded', String(next))
      } catch {
        // 存储失败不影响本次展开状态。
      }
      return next
    })
  }

  return (
    <Box
      sx={(theme) => ({
        mx: embedded ? 0 : 1,
        mb: embedded ? 0 : 1,
        borderRadius: embedded ? 0 : '14px',
        border: embedded ? 0 : '1px solid',
        borderColor: alpha(theme.palette.divider, 0.7),
        bgcolor: embedded
          ? 'transparent'
          : alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.28 : 0.56),
        flexShrink: 0,
        overflow: 'hidden',
        boxShadow: 'none',
      })}
    >
      <Box
        onClick={forceExpanded ? undefined : handleToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: embedded ? 1 : 0.9,
          borderBottom: embedded && isExpanded ? '1px solid' : 0,
          borderColor: 'divider',
          cursor: forceExpanded ? 'default' : 'pointer',
          userSelect: 'none',
        }}
      >
        <InsightIcon sx={{ fontSize: 16, color: hasContent ? 'primary.main' : 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'text.disabled', lineHeight: 1.2 }}>
            AI 发现
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: 12.5, fontWeight: 600, mt: 0.25 }}>
            {summaryText}
          </Typography>
        </Box>
        {loading && <CircularProgress size={14} />}
        {!forceExpanded && (
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation()
              handleToggle()
            }}
            sx={{ p: 0.25 }}
            aria-label={isExpanded ? '收起相关上下文' : '展开相关上下文'}
          >
            {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        )}
      </Box>

      <Collapse in={isExpanded} timeout={160} unmountOnExit>
        <Box sx={{ px: 0.55, py: 0.55, maxHeight: embedded ? 280 : '38vh', overflowY: 'auto' }}>
          {!hasContent && !loading && (
            <Typography variant="caption" color="text.secondary">
              没有足够明确的标签、标题或关键词关联，暂不推荐。
            </Typography>
          )}

          {relatedNotes.length > 0 && (
            <Section icon={<NoteIcon sx={{ fontSize: 15 }} />} title="相关笔记">
              <List dense disablePadding>
                {relatedNotes.map(note => (
                  <ListItemButton
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                    sx={{ borderRadius: '8px', px: 1.1, py: 0.7 }}
                  >
                    <ListItemText
                      primary={(
                        <Typography variant="body2" noWrap sx={{ fontSize: 13, fontWeight: 650 }}>
                          {note.title || '未命名'}
                        </Typography>
                      )}
                      secondary={(
                        <Box component="span" sx={{ display: 'block' }}>
                          <Typography variant="caption" color="primary" noWrap sx={{ display: 'block', fontSize: 11.5, fontWeight: 650 }}>
                            依据：{(note.reasons || []).join(' · ')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: 11.5 }}>
                            {note.timeLabel}{note.stalenessLabel ? ` · ${note.stalenessLabel}` : ''} · {truncateText(note.excerpt, 56)}
                          </Typography>
                        </Box>
                      )}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Section>
          )}

          {relatedTodos.length > 0 && (
            <>
              {relatedNotes.length > 0 && <Divider sx={{ my: 0.6 }} />}
              <Section icon={<TodoIcon sx={{ fontSize: 15 }} />} title="相关待办">
                {relatedTodos.map(todo => {
                  const temporal = getTodoTemporalStatus(todo)
                  return (
                    <Chip
                      key={todo.id}
                      size="small"
                      label={`${todo.content}${todo.due_date ? ` · ${temporal.label}` : ''}`}
                      color={temporal.isOverdue ? 'error' : temporal.isDueToday ? 'warning' : 'default'}
                      onClick={() => setCurrentView('todo')}
                      sx={{ mr: 0.5, mb: 0.5, maxWidth: '100%' }}
                      variant="outlined"
                    />
                  )
                })}
              </Section>
            </>
          )}

          {memories.length > 0 && (
            <>
              {(relatedNotes.length > 0 || relatedTodos.length > 0) && <Divider sx={{ my: 0.6 }} />}
              <Section icon={<MemoryIcon sx={{ fontSize: 15 }} />} title="相关记忆">
                {memories.slice(0, 3).map((memory, index) => (
                  <Typography key={memory.id || index} variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.5, mb: 0.5 }}>
                    {truncateText(memory.content, 88)}{memory.stalenessLabel ? ` · ${memory.stalenessLabel}` : ''}
                  </Typography>
                ))}
              </Section>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

export default RelatedContextPanel
