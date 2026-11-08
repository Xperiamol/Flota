import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import {
  Settings as SettingsIcon,
  Search as SearchIcon,
  CheckCircle as CheckIcon,
  EditNote as NoteIcon,
  Psychology as MemoryIcon,
  CalendarToday as CalendarIcon,
  Edit as EditIcon,
  Image as ImageIcon,
  MenuBook as ReadIcon,
} from '../common/AppIcons'
import { ThinkingDots } from './thinking'

// AI 正在调用的工具 → 图标。AI 页面和「问 AI」小窗共用（加载头像、工具 chip）。
export const TOOL_ICON = {
  read_note: ReadIcon,
  read_skill: ReadIcon,
  get_settings: SettingsIcon,
  update_settings: SettingsIcon,
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
  list_widgets: SearchIcon,
  get_widget: ReadIcon,
  create_widget: EditIcon,
  update_widget: EditIcon,
  create_widget_instance: EditIcon,
  add_widget_records: EditIcon,
  write_document: NoteIcon,
  save_document: NoteIcon,
  search_todos: CheckIcon,
  get_today_todos: CalendarIcon,
  create_todo: CheckIcon,
  create_todos: CheckIcon,
  search_memory: MemoryIcon,
  add_memory: MemoryIcon,
  update_memory: MemoryIcon,
  list_memories: MemoryIcon,
}

/** 工具 chip 上的小图标；未知工具返回 null，由调用方给默认图标 */
export const toolChipIcon = (name) => {
  const Icon = TOOL_ICON[name]
  return Icon ? <Icon fontSize="small" /> : null
}

// 加载头像：在「三点动画」和当前工具图标之间淡入切换
export const LoadingAvatarContent = ({ activeTool, iconSize = 14 }) => {
  const hasToolIcon = Boolean(activeTool && TOOL_ICON[activeTool])
  const [showDotsPhase, setShowDotsPhase] = useState(false)

  useEffect(() => {
    setShowDotsPhase(false)
    if (!hasToolIcon) return undefined
    let timer = null
    let dots = false
    const schedule = () => {
      timer = window.setTimeout(() => {
        dots = !dots
        setShowDotsPhase(dots)
        schedule()
      }, dots ? 1400 : 1800)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [activeTool, hasToolIcon])

  const targetKey = hasToolIcon && !showDotsPhase ? activeTool : '__dots__'
  const Icon = targetKey !== '__dots__' ? TOOL_ICON[targetKey] : null
  return (
    <Box
      key={targetKey}
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'inherit',
        animation: 'flota-avatar-fade 280ms ease',
        '@keyframes flota-avatar-fade': {
          '0%': { opacity: 0, transform: 'scale(0.85)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
      }}
    >
      {Icon ? <Icon sx={{ fontSize: iconSize }} /> : <ThinkingDots dotSize={Math.max(3, Math.round(iconSize * 0.28))} />}
    </Box>
  )
}
