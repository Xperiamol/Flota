import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
  alpha
} from '@mui/material'
import {
  AutoAwesome as AIIcon,
  CalendarToday as CalendarIcon,
  CheckCircle as TodoIcon,
  EditNote as NoteIcon,
  Hub as HubIcon,
  Search as SearchIcon,
  TravelExplore as KnowledgeIcon
} from '@mui/icons-material'
import { useStore } from '../store/useStore'
import { truncateText } from '../utils/aiContextUtils'

const AI_COMMANDS = [
  {
    id: 'direct-ask',
    title: '直接问 AI',
    description: '用当前上下文直接提问',
    hint: '输入任意问题后回车',
    icon: <AIIcon />,
    buildPrompt: (query) => query || '请基于当前上下文给我一个简洁建议'
  },
  {
    id: 'ask-current-note',
    title: '问当前笔记',
    description: '带上当前笔记上下文，让 AI 直接回答你的问题',
    hint: '例如：这篇笔记的下一步是什么？',
    icon: <NoteIcon />,
    buildPrompt: (query) => `基于当前笔记回答：${query || '这篇笔记的重点和下一步是什么？'}`
  },
  {
    id: 'summarize-note',
    title: '总结当前笔记',
    description: '提炼要点、结论和后续行动',
    hint: '可直接回车',
    icon: <AIIcon />,
    buildPrompt: (query) => `请总结当前笔记，输出：核心要点、关键结论、待办事项、潜在风险。${query ? `额外要求：${query}` : ''}`
  },
  {
    id: 'search-knowledge',
    title: '搜索我的知识库',
    description: '搜索笔记、记忆和相关上下文',
    hint: '输入要查找的问题',
    icon: <KnowledgeIcon />,
    buildPrompt: (query) => `搜索我的知识库并给出带来源的回答：${query || '最近重要的知识和任务是什么？'}`
  },
  {
    id: 'create-todo',
    title: '创建待办',
    description: '生成待确认的待办创建操作',
    hint: '例如：明天下午整理会议纪要',
    icon: <TodoIcon />,
    buildPrompt: (query) => `帮我创建一个待办：${query || '根据当前上下文提取一个最重要的下一步待办'}`
  },
  {
    id: 'extract-todos',
    title: '从当前笔记提取待办',
    description: '把会议纪要/计划拆成待确认待办',
    hint: '可直接回车',
    icon: <TodoIcon />,
    buildPrompt: (query) => `请从当前笔记提取待办事项，并逐条生成待确认的创建计划。${query ? `重点关注：${query}` : ''}`
  },
  {
    id: 'summarize-week',
    title: '总结本周',
    description: '结合知识库、待办和记忆做周总结',
    hint: '可补充项目名',
    icon: <CalendarIcon />,
    buildPrompt: (query) => `请总结本周的进展、完成事项、遗留风险和下周建议。${query ? `聚焦：${query}` : ''}`
  },
  {
    id: 'related-map',
    title: '查找关联内容',
    description: '找出当前笔记相关的笔记、待办和记忆',
    hint: '可直接回车',
    icon: <HubIcon />,
    buildPrompt: (query) => `找出和当前笔记最相关的笔记、待办和记忆，并解释关联原因。${query ? `额外线索：${query}` : ''}`
  },
]

const AICommandCenter = ({ open, onClose }) => {
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { notes, selectedNoteId, setCurrentView, aiDispatchCommand } = useStore()

  const currentNote = notes.find(note => String(note.id) === String(selectedNoteId))

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase().replace(/^\/ai\s*/, '')
    if (!normalized) return AI_COMMANDS
    const matched = AI_COMMANDS.filter(command => (
      command.title.toLowerCase().includes(normalized) ||
      command.description.toLowerCase().includes(normalized)
    ))
    return matched.length > 0 ? matched : [AI_COMMANDS[0]]
  }, [query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredCommands.length])

  const runCommand = (command) => {
    if (!command) return
    const promptQuery = query.replace(/^\/ai\s*/i, '').trim()
    setCurrentView('ai')
    aiDispatchCommand?.(command.buildPrompt(promptQuery), { autoSend: true })
    onClose()
  }

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex(prev => (prev + 1) % Math.max(filteredCommands.length, 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex(prev => (prev - 1 + Math.max(filteredCommands.length, 1)) % Math.max(filteredCommands.length, 1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        runCommand(filteredCommands[selectedIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredCommands, onClose, open, selectedIndex])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: (theme) => ({
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: alpha(theme.palette.background.paper, 0.92),
            backdropFilter: 'blur(18px) saturate(160%)',
            WebkitBackdropFilter: 'blur(18px) saturate(160%)',
            border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
          })
        }
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ px: 2, pt: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            placeholder="Cmd+K（非编辑区）/ Cmd+Shift+K 问 AI，或输入 /ai 指令..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            variant="standard"
            slotProps={{
              input: {
                disableUnderline: true,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                )
              }
            }}
            sx={{ '& .MuiInputBase-input': { fontSize: 16, py: 1 } }}
          />
          {currentNote && (
            <Chip
              size="small"
              label={`当前笔记：${truncateText(currentNote.title || '未命名', 24)}`}
              icon={<NoteIcon />}
              sx={{ mt: 1, borderRadius: 3 }}
              variant="outlined"
            />
          )}
        </Box>

        <List dense disablePadding sx={{ maxHeight: 420, overflow: 'auto', py: 1 }}>
          {filteredCommands.map((command, index) => (
            <ListItemButton
              key={command.id}
              selected={index === selectedIndex}
              onClick={() => runCommand(command)}
              sx={{
                mx: 1,
                borderRadius: 2,
                alignItems: 'flex-start',
                '&.Mui-selected': {
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: index === selectedIndex ? 'primary.main' : 'text.secondary', mt: 0.25 }}>
                {command.icon}
              </ListItemIcon>
              <ListItemText
                primary={(
                  <Typography variant="body2" sx={{ fontWeight: index === selectedIndex ? 700 : 600 }}>
                    {command.title}
                  </Typography>
                )}
                secondary={
                  <Box>
                    <Typography component="span" variant="caption" color="text.secondary">
                      {command.description}
                    </Typography>
                    <Typography component="span" variant="caption" color="text.disabled" sx={{ display: 'block' }}>
                      {command.hint}
                    </Typography>
                  </Box>
                }
              />
            </ListItemButton>
          ))}
          {filteredCommands.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 4, textAlign: 'center' }}>
              没有匹配的 AI 命令
            </Typography>
          )}
        </List>
      </DialogContent>
    </Dialog>
  )
}

export default AICommandCenter
