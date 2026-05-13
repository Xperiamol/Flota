import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Box,
  Chip,
  IconButton,
  InputBase,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  alpha
} from '@mui/material'
import {
  Close as CloseIcon,
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
import FloatingGlassSurface from './FloatingGlassSurface'
import shortcutManager from '../utils/ShortcutManager'

const PALETTE_TOP_OFFSET = 84
const IS_MAC =
  typeof navigator !== 'undefined' &&
  String(
    navigator.userAgentData?.platform ||
    Reflect.get(navigator, 'platform') ||
    ''
  ).toLowerCase().includes('mac')

const CATEGORY_ORDER = ['笔记', '视图', '系统', '插件']

const formatShortcutDisplay = (shortcut) => {
  if (!shortcut) return ''

  return shortcut
    .replace(/CmdOrCtrl/g, IS_MAC ? '⌘' : 'Ctrl')
    .replace(/Command/g, '⌘')
    .replace(/Cmd/g, '⌘')
    .replace(/Ctrl/g, 'Ctrl')
    .replace(/Alt/g, IS_MAC ? '⌥' : 'Alt')
    .replace(/Shift/g, IS_MAC ? '⇧' : 'Shift')
    .replace(/Meta/g, IS_MAC ? '⌘' : 'Win')
    .replace(/\+/g, IS_MAC ? '' : ' + ')
}

/**
 * 命令面板组件
 * 快捷键: Ctrl+Shift+P (Windows/Linux) 或 Cmd+Shift+P (Mac)
 */
const CommandPalette = ({ open, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [shortcutMap, setShortcutMap] = useState({})
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

  const indexedSections = useMemo(() => {
    const grouped = filteredCommands.reduce((acc, cmd) => {
      const key = cmd.category || '其他'
      if (!acc[key]) acc[key] = []
      acc[key].push(cmd)
      return acc
    }, {})

    const orderedKeys = [
      ...CATEGORY_ORDER.filter((key) => grouped[key]?.length),
      ...Object.keys(grouped).filter((key) => !CATEGORY_ORDER.includes(key)).sort()
    ]

    let globalIndex = 0
    return orderedKeys.map((key) => {
      const items = grouped[key].map((cmd) => ({
        ...cmd,
        globalIndex: globalIndex++
      }))
      return { key, items }
    })
  }, [filteredCommands])

  useEffect(() => {
    let active = true

    const loadShortcuts = async () => {
      await shortcutManager.initialize()
      if (active) {
        setShortcutMap({ ...(shortcutManager.shortcuts || {}) })
      }
    }

    if (open) {
      loadShortcuts()
    }

    return () => {
      active = false
    }
  }, [open])

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

  const getCommandShortcut = (cmd) => {
    switch (cmd.id) {
      case 'new-note':
        return shortcutMap['global.newNote']?.currentKey || ''
      case 'view-todos':
        return shortcutMap['global.newTodo']?.currentKey || ''
      default:
        break
    }

    const pluginShortcut = cmd.plugin?.shortcutBinding?.currentKey ||
      cmd.plugin?.shortcutBinding?.key ||
      (typeof cmd.plugin?.shortcut === 'string'
        ? cmd.plugin.shortcut
        : cmd.plugin?.shortcut?.current || cmd.plugin?.shortcut?.default || '')

    return pluginShortcut || ''
  }

  return (
    <FloatingGlassSurface
      open={open}
      layer="selectionPanel"
      ariaLabel="命令面板"
      position={{ y: PALETTE_TOP_OFFSET }}
      width="min(720px, calc(100vw - 32px))"
      maxWidth="calc(100vw - 32px)"
      maxHeight="min(640px, calc(100vh - 120px))"
      pointerPassthrough={false}
      onClickAway={onClose}
      clickAwayDisabled={!open}
      sx={{ left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column' }}
    >
      <Box
        sx={(theme) => ({
          px: 1.5,
          py: 0.9,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          boxShadow: `inset 0 -1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.36)}`,
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.09 : 0.1)
        })}
      >
        <SearchIcon sx={{ fontSize: 17, color: 'primary.main' }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>命令面板</Typography>
        <Chip
          size="small"
          label={searchQuery.trim() ? '搜索结果' : '全部命令'}
          sx={(theme) => ({
            height: 22,
            fontSize: 11,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.18),
            boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.035 : 0.32)}`,
            borderColor: 'transparent'
          })}
        />
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          label={`${filteredCommands.length} 个命令`}
          sx={(theme) => ({
            height: 22,
            fontSize: 11,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
            color: 'primary.main',
            borderColor: 'transparent'
          })}
        />
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="关闭命令面板"
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

      <Box sx={{ px: 1.5, py: 1.15 }}>
        <Box
          sx={(theme) => ({
            px: 1.25,
            py: 0.95,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            borderRadius: 1.5,
            bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.18 : 0.34),
            boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.04 : 0.42)}`
          })}
        >
          <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <InputBase
            inputRef={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索命令、视图或插件动作..."
            aria-label="搜索命令"
            sx={{
              flex: 1,
              fontSize: 14,
              '& input::placeholder': {
                opacity: 1,
                color: 'text.secondary'
              }
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            Esc
          </Typography>
        </Box>
      </Box>

      <Box
        ref={listRef}
        sx={(theme) => ({
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 1,
          pb: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.03 : 0.045)
        })}
      >
        {filteredCommands.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <InfoIcon sx={{ fontSize: 42, color: 'text.disabled', mb: 1.5 }} />
            <Typography variant="body2" color="text.secondary">
              没有找到匹配的命令
            </Typography>
            <Typography variant="caption" color="text.disabled">
              试试搜索视图、系统动作或插件名称
            </Typography>
          </Box>
        ) : (
          indexedSections.map((section) => (
            <Box key={section.key} sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              <Box
                sx={{
                  px: 0.6,
                  pt: 0.5,
                  pb: 0.15,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: 'text.secondary'
                }}
              >
                <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {section.key}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {section.items.length}
                </Typography>
              </Box>

              {section.items.map((cmd) => {
                const shortcut = getCommandShortcut(cmd)
                const selected = selectedIndex === cmd.globalIndex

                return (
                  <ListItemButton
                    key={cmd.id}
                    data-index={cmd.globalIndex}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(cmd.globalIndex)}
                    selected={selected}
                    sx={(theme) => ({
                      px: 1.25,
                      py: 1,
                      borderRadius: 1.5,
                      alignItems: 'center',
                      gap: 0.6,
                      bgcolor: selected
                        ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.09)
                        : alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.18),
                      boxShadow: selected
                        ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.26 : 0.16)}`
                        : `inset 0 0 0 1px ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.28)}`,
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1)
                      }
                    })}
                  >
                    <ListItemIcon sx={{ minWidth: 28, color: selected ? 'primary.main' : 'text.secondary' }}>
                      {cmd.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={(
                        <Typography sx={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }} noWrap>
                          {cmd.title}
                        </Typography>
                      )}
                      secondary={cmd.description}
                      sx={{ minWidth: 0, my: 0 }}
                      slotProps={{
                        secondary: {
                          variant: 'body2',
                          color: 'text.secondary',
                          sx: { mt: 0.2, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                        }
                      }}
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, pl: 1, flexShrink: 0 }}>
                      {shortcut ? (
                        <Chip
                          label={formatShortcutDisplay(shortcut)}
                          size="small"
                          sx={(theme) => ({
                            height: 22,
                            fontSize: 10.5,
                            borderRadius: 1,
                            bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.16 : 0.28),
                            color: 'text.secondary',
                            borderColor: 'transparent',
                            '& .MuiChip-label': { px: 0.8, letterSpacing: IS_MAC ? '0.02em' : 0 }
                          })}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap' }}>
                          Enter
                        </Typography>
                      )}
                    </Box>
                  </ListItemButton>
                )
              })}
            </Box>
          ))
        )}
      </Box>

      <Box
        sx={(theme) => ({
          px: 1.5,
          py: 0.95,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.34)}`,
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.1)
        })}
      >
        <Typography variant="caption" color="text.secondary">
          ↑↓ 导航 · Enter 执行 · Esc 关闭
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          支持内置与插件命令
        </Typography>
      </Box>
    </FloatingGlassSurface>
  )
}

export default CommandPalette
