import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Box,
  Typography,
  Chip,
  Paper,
  InputAdornment,
  alpha
} from '@mui/material'
import {
  Search as SearchIcon,
  Extension as ExtensionIcon,
  NoteAdd as NoteAddIcon,
  ListAlt as TodoIcon,
  Settings as SettingsIcon,
  Info as InfoIcon,
  CalendarToday as CalendarIcon,
  Dashboard as DashboardIcon
} from '@mui/icons-material'
import { useStore } from '../store/useStore'
import { executePluginCommand } from '../api/pluginAPI'
import { getPluginCommandIcon } from '../utils/pluginCommandUtils.jsx'

/**
 * 命令面板组件
 * 快捷键: Ctrl+Shift+P (Windows/Linux) 或 Cmd+Shift+P (Mac)
 */
const CommandPalette = ({ open, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  
  const { pluginCommands, setCurrentView, createNote } = useStore()

  // 内置命令
  const builtInCommands = useMemo(() => [
    {
      id: 'new-note',
      title: '新建笔记',
      description: '创建一个新的 Markdown 笔记',
      category: '笔记',
      icon: <NoteAddIcon />,
      action: async () => {
        await createNote({ type: 'markdown' })
        onClose()
      }
    },
    {
      id: 'new-whiteboard',
      title: '新建白板笔记',
      description: '创建一个新的白板笔记',
      category: '笔记',
      icon: <DashboardIcon />,
      action: async () => {
        await createNote({ type: 'whiteboard' })
        onClose()
      }
    },
    {
      id: 'view-notes',
      title: '查看笔记列表',
      description: '切换到笔记视图',
      category: '视图',
      icon: <NoteAddIcon />,
      action: () => {
        setCurrentView('notes')
        onClose()
      }
    },
    {
      id: 'view-todos',
      title: '查看待办事项',
      description: '切换到待办事项视图',
      category: '视图',
      icon: <TodoIcon />,
      action: () => {
        setCurrentView('todos')
        onClose()
      }
    },
    {
      id: 'view-calendar',
      title: '查看日历',
      description: '切换到日历视图',
      category: '视图',
      icon: <CalendarIcon />,
      action: () => {
        setCurrentView('calendar')
        onClose()
      }
    },
    {
      id: 'open-settings',
      title: '打开设置',
      description: '打开应用设置',
      category: '系统',
      icon: <SettingsIcon />,
      action: () => {
        setCurrentView('settings')
        onClose()
      }
    },
    {
      id: 'open-plugins',
      title: '插件商店',
      description: '浏览和安装插件',
      category: '系统',
      icon: <ExtensionIcon />,
      action: () => {
        setCurrentView('plugins')
        onClose()
      }
    }
  ], [createNote, setCurrentView, onClose])

  // 转换插件命令为统一格式
  const pluginCommandsList = useMemo(() => {
    if (!Array.isArray(pluginCommands)) return []
    
    return pluginCommands.map(cmd => ({
      id: `plugin-${cmd.pluginId}-${cmd.commandId}`,
      title: cmd.title || cmd.commandId,
      description: cmd.description || `来自插件: ${cmd.pluginName || cmd.pluginId}`,
      category: '插件',
      icon: getPluginCommandIcon(cmd) || <ExtensionIcon />,
      plugin: cmd,
      action: async () => {
        try {
          await executePluginCommand(cmd.pluginId, cmd.commandId)
          onClose()
        } catch (error) {
          console.error('[CommandPalette] 执行插件命令失败:', error)
        }
      }
    }))
  }, [pluginCommands, onClose])

  // 合并所有命令
  const allCommands = useMemo(() => {
    return [...builtInCommands, ...pluginCommandsList]
  }, [builtInCommands, pluginCommandsList])

  // 过滤命令
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return allCommands

    const query = searchQuery.toLowerCase()
    return allCommands.filter(cmd => {
      const titleMatch = cmd.title.toLowerCase().includes(query)
      const descMatch = cmd.description?.toLowerCase().includes(query)
      const categoryMatch = cmd.category?.toLowerCase().includes(query)
      return titleMatch || descMatch || categoryMatch
    })
  }, [allCommands, searchQuery])

  // 重置状态
  useEffect(() => {
    if (open) {
      setSearchQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // 当过滤结果变化时，重置选中索引
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredCommands])

  // 键盘导航
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, filteredCommands, selectedIndex, onClose])

  // 滚动到选中项
  useEffect(() => {
    if (listRef.current && open) {
      const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedIndex, open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          maxHeight: '70vh',
          bgcolor: 'background.paper'
        }
      }}
      TransitionProps={{
        timeout: 200
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            placeholder="搜索命令..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="搜索命令"
            variant="outlined"
            size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              )
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: alpha('#000', 0.02),
                '&:hover': {
                  bgcolor: alpha('#000', 0.04)
                },
                '&.Mui-focused': {
                  bgcolor: 'background.paper'
                }
              }
            }}
          />
        </Box>

        <List
          ref={listRef}
          sx={{
            maxHeight: 'calc(70vh - 100px)',
            overflow: 'auto',
            py: 1
          }}
        >
          {filteredCommands.length === 0 ? (
            <Box sx={{ py: 8, textAlign: 'center' }}>
              <InfoIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
              <Typography variant="body2" color="text.secondary">
                没有找到匹配的命令
              </Typography>
            </Box>
          ) : (
            filteredCommands.map((cmd, index) => (
              <ListItem
                key={cmd.id}
                data-index={index}
                disablePadding
                sx={{
                  bgcolor: selectedIndex === index ? alpha('#1976d2', 0.08) : 'transparent',
                  '&:hover': {
                    bgcolor: alpha('#1976d2', 0.04)
                  }
                }}
              >
                <ListItemButton
                  onClick={() => cmd.action()}
                  selected={selectedIndex === index}
                  sx={{
                    py: 1.5,
                    px: 2
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {cmd.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body1">
                          {cmd.title}
                        </Typography>
                        {cmd.category && (
                          <Chip
                            label={cmd.category}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.7rem',
                              bgcolor: alpha('#1976d2', 0.1),
                              color: 'primary.main'
                            }}
                          />
                        )}
                      </Box>
                    }
                    secondary={cmd.description}
                    secondaryTypographyProps={{
                      variant: 'body2',
                      color: 'text.secondary',
                      sx: { mt: 0.5 }
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>

        <Box
          sx={{
            px: 2,
            py: 1,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: alpha('#000', 0.02),
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <Typography variant="caption" color="text.secondary">
            ↑↓ 导航 · Enter 执行 · Esc 关闭
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {filteredCommands.length} 个命令
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  )
}

export default CommandPalette
