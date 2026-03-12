import React, { useMemo, useState, useCallback } from 'react'
import {
  Box,
  Toolbar as MuiToolbar,
  IconButton,
  Typography,
  Button,
  Tooltip,
  Badge,
  FormControlLabel,
  Checkbox
} from '@mui/material'
import {
  Add as AddIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Delete as DeleteIcon,
  Restore as RestoreIcon,
  Menu as MenuIcon,
  Close as CloseIcon,
  Sort as SortIcon,
  Schedule as ScheduleIcon,
  Flag as FlagIcon,
  AccessTime as AccessTimeIcon,
  ChevronLeft,
  ChevronRight,
  Today,
  EditNote as EditNoteIcon
} from '@mui/icons-material'
import { useStore } from '../store/useStore'
import DropdownMenu from './DropdownMenu'
import { executePluginCommand } from '../api/pluginAPI'
import { getPluginCommandIcon } from '../utils/pluginCommandUtils.jsx'
import { createTransitionString, ANIMATIONS } from '../utils/animationConfig'
import { t } from '../utils/i18n'
import logger from '../utils/logger'

const Toolbar = ({
  onToggleSidebar,
  sidebarOpen,
  showDeleted,
  onToggleDeleted,
  currentView,
  todoViewMode,
  onTodoViewModeChange,
  todoShowCompleted,
  onTodoShowCompletedChange,
  onCreateTodo,
  todoSortBy,
  onTodoSortByChange,
  // 日历相关的props
  calendarCurrentDate,
  onCalendarDateChange,
  calendarShowCompleted,
  onCalendarShowCompletedChange,
  onSelectedDateChange,
  selectedDate,
  calendarViewMode,
  onCalendarViewModeChange
}) => {
  const {
    createNote,
    notes,
    setSelectedNoteId
  } = useStore()
  const pluginCommands = useStore((state) => state.pluginCommands)
  const [pluginCommandPending, setPluginCommandPending] = useState(null)

  const noteToolbarCommands = useMemo(() => {
    if (!Array.isArray(pluginCommands) || pluginCommands.length === 0) return []
    return pluginCommands.filter((command) =>
      Array.isArray(command.surfaces) && command.surfaces.includes('toolbar:notes')
    )
  }, [pluginCommands])

  const todoToolbarCommands = useMemo(() => {
    if (!Array.isArray(pluginCommands) || pluginCommands.length === 0) return []
    return pluginCommands.filter((command) =>
      Array.isArray(command.surfaces) && command.surfaces.includes('toolbar:todos')
    )
  }, [pluginCommands])

  // 移除settingsAnchor状态，改用DropdownMenu组件

  const deletedNotesCount = useMemo(() => notes.filter(note => note.is_deleted).length, [notes])

  const handleCreateNote = useCallback(async () => {
    try {
      const result = await createNote({
        title: t('notes.untitled'),
        content: '',
        tags: []
      })
      if (result?.success && result.data) {
        setSelectedNoteId(result.data.id)
      }
    } catch (error) {
      console.error('创建笔记失败:', error)
    }
  }, [createNote, setSelectedNoteId, t])

  // 快速输入：创建空白笔记并在独立窗口打开
  const handleQuickInput = useCallback(async () => {
    try {
      const result = await createNote({
        title: t('notes.untitled'),
        content: '',
        tags: []
      })
      if (result?.success && result.data) {
        // 立即在独立窗口打开
        await window.electronAPI.createNoteWindow(result.data.id)
      }
    } catch (error) {
      console.error('快速输入失败:', error)
    }
  }, [createNote, t])


  // 其他视图的创建处理函数
  const handleCreateTodo = useCallback(async () => {
    if (onCreateTodo) {
      onCreateTodo();
    }
  }, [onCreateTodo]);

  const handleCreateEvent = useCallback(async () => {
    // 创建日历事件，预设选中的日期
    const initialData = {}

    // 如果有选中的日期，预设截止日期
    if (selectedDate) {
      // 格式化日期为 YYYY-MM-DD 格式
      const year = selectedDate.getFullYear()
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0')
      const day = String(selectedDate.getDate()).padStart(2, '0')
      initialData.due_date = `${year}-${month}-${day}`
    }

    if (onCreateTodo) {
      onCreateTodo(initialData)
    }
  }, [selectedDate, onCreateTodo]);

  // 日历导航函数 - 遵循DRY原则的通用日期处理
  const createDateNavigationHandler = (dateTransform) => {
    return () => {
      if (calendarCurrentDate && onCalendarDateChange) {
        const newDate = dateTransform(calendarCurrentDate);
        onCalendarDateChange(newDate);
      }
    };
  };

  const goToPreviousMonth = createDateNavigationHandler(
    (date) => new Date(date.getFullYear(), date.getMonth() - 1, 1)
  );

  const goToNextMonth = createDateNavigationHandler(
    (date) => new Date(date.getFullYear(), date.getMonth() + 1, 1)
  );

  const goToToday = () => {
    const today = new Date();
    if (onCalendarDateChange) {
      onCalendarDateChange(today);
    }
    // 同时设置选中日期为今天
    if (onSelectedDateChange) {
      onSelectedDateChange(today);
    }
  };

  /** 日历导航按钮组 */
  const CalendarNavButtons = ({ button }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip title={t('common.previous')}>
        <IconButton onClick={goToPreviousMonth} size="small"
          sx={{ backgroundColor: 'background.paper', border: 1, borderColor: 'divider',
            '&:hover': { backgroundColor: 'primary.main', color: 'primary.contrastText', transform: 'scale(1.05)' },
            transition: createTransitionString(ANIMATIONS.button) }}>
          <ChevronLeft />
        </IconButton>
      </Tooltip>
      <Box sx={{ minWidth: '140px', textAlign: 'center', px: 2, py: 0.5, borderRadius: 1,
        backgroundColor: 'primary.main', color: 'primary.contrastText' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
          {button.currentDate
            ? `${button.currentDate.getFullYear()}年${button.currentDate.getMonth() + 1}月`
            : t('sidebar.calendar')}
        </Typography>
      </Box>
      <Tooltip title={t('common.next')}>
        <IconButton onClick={goToNextMonth} size="small"
          sx={{ backgroundColor: 'background.paper', border: 1, borderColor: 'divider',
            '&:hover': { backgroundColor: 'primary.main', color: 'primary.contrastText', transform: 'scale(1.05)' },
            transition: createTransitionString(ANIMATIONS.button) }}>
          <ChevronRight />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('common.today')}>
        <IconButton onClick={goToToday} size="small" color="primary"
          sx={{ backgroundColor: 'primary.main', color: 'primary.contrastText',
            '&:hover': { backgroundColor: 'primary.dark', transform: 'scale(1.1)' },
            transition: createTransitionString(ANIMATIONS.button), ml: 1 }}>
          <Today />
        </IconButton>
      </Tooltip>
    </Box>
  );

  const handlePluginCommandExecute = async (command) => {
    if (!command) return
    const commandKey = `${command.pluginId}:${command.commandId}`
    try {
      setPluginCommandPending(commandKey)
      await executePluginCommand(command.pluginId, command.commandId)
    } catch (error) {
      console.error('执行插件命令失败:', error)
    } finally {
      setPluginCommandPending(null)
    }
  }

  const renderPluginCommandIcon = (command) =>
    getPluginCommandIcon(command, { fontSize: 'small', size: 20 })

  // 根据当前视图获取标题和新建按钮文本
  const viewConfig = useMemo(() => {
    switch (currentView) {
      case 'notes':
        return {
          title: 'Flota',
          createButtonText: showDeleted ? null : t('common.new'),
          createAction: handleCreateNote,
          showDeletedButton: true,
          showSidebarToggle: true,
          quickInputButton: !showDeleted // 启用快速输入按钮（回收站中隐藏）
        };
      case 'todo':
        return {
          title: t('sidebar.todos'),
          createButtonText: t('common.new'),
          createAction: handleCreateTodo,
          showDeletedButton: false,
          showSidebarToggle: true,
          customButtons: [
            {
              type: 'viewToggle',
              label: t('toolbar.view'),
              position: 'center',
              options: [
                { value: 'quadrant', label: t('todos.quadrantView') },
                { value: 'focus', label: t('todos.focusView') }
              ]
            },
            {
              type: 'checkbox',
              label: t('todos.showCompleted'),
              position: 'left',
              key: 'showCompleted'
            }
          ],

        };
      case 'calendar':
        return {
          title: t('sidebar.calendar'),
          createButtonText: t('common.new'),
          createAction: handleCreateEvent,
          showDeletedButton: false,
          showSidebarToggle: true,
          customButtons: [
            {
              type: 'calendarNavigation',
              currentDate: calendarCurrentDate
            },
            {
              type: 'checkbox',
              label: t('todos.showCompleted'),
              key: 'showCompleted'
            },
            {
              type: 'calendarViewMode',
              position: 'right',
              options: [
                { value: 'todos', label: t('sidebar.calendarViewMode.todos') },
                { value: 'notes', label: t('sidebar.calendarViewMode.notes') },
                { value: 'focus', label: t('sidebar.calendarViewMode.focus') }
              ]
            }
          ]
        };
      case 'settings':
        return {
          title: t('sidebar.settings'),
          createButtonText: null,
          createAction: null,
          showDeletedButton: false,
          showSidebarToggle: true
        };
      case 'plugins':
        return {
          title: t('sidebar.plugins'),
          createButtonText: null,
          createAction: null,
          showDeletedButton: false,
          showSidebarToggle: true
        };
      case 'profile':
        return {
          title: t('common.profile'),
          createButtonText: null,
          createAction: null,
          showDeletedButton: false,
          showSidebarToggle: false
        };
      case 'ai':
        return {
          title: 'FlotaAI',
          createButtonText: '新对话',
          createAction: () => useStore.getState().aiNewChat(),
          showDeletedButton: false,
          showSidebarToggle: true
        };
      default:
        return {
          title: 'Flota',
          createButtonText: t('common.new'),
          createAction: handleCreateNote,
          showDeletedButton: false,
          showSidebarToggle: true
        };
    }
  }, [currentView, showDeleted, todoViewMode, calendarShowCompleted, calendarCurrentDate, calendarViewMode,
      handleCreateNote, handleCreateTodo, handleCreateEvent, handleQuickInput,
      onTodoViewModeChange, onTodoShowCompletedChange, onCalendarShowCompletedChange, onCalendarViewModeChange, t]);

  return (
    <MuiToolbar
      disableGutters
      sx={(theme) => ({
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(30, 41, 59, 0.85)'
          : 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
        minHeight: '64px !important',
        px: 2
      })}
    >
      {/* 左侧按钮组 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {viewConfig.showSidebarToggle && (
          <Tooltip title={sidebarOpen ? t('common.close') : t('common.open')}>
            <IconButton onClick={onToggleSidebar}>
              {sidebarOpen ? <CloseIcon /> : <MenuIcon />}
            </IconButton>
          </Tooltip>
        )}

        {/* 通用新建按钮 */}
        {viewConfig.createButtonText && (
          <Tooltip title={viewConfig.createButtonText}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={viewConfig.createAction}
              sx={{
                ml: 1,
                height: '40px',
                minHeight: '40px'
              }}
            >
              {viewConfig.createButtonText}
            </Button>
          </Tooltip>
        )}

        {/* 快速输入按钮（仅笔记视图） */}
        {viewConfig.quickInputButton && (
          <Tooltip title={t('toolbar.newNote')}>
            <Button
              variant="outlined"
              startIcon={<EditNoteIcon />}
              onClick={handleQuickInput}
              sx={{
                ml: 1,
                height: '40px',
                minHeight: '40px'
              }}
            >
              {t('toolbar.newNote')}
            </Button>
          </Tooltip>
        )}

        {/* 左侧区域的复选框（待办/日历视图） */}
        {viewConfig.customButtons && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 2 }}>
            {viewConfig.customButtons
              .filter(button => button.position === 'left' || (button.type === 'checkbox' && currentView === 'calendar'))
              .map((button, index) => {
                if (button.type === 'checkbox') {
                  const isCalendarView = currentView === 'calendar';
                  const checked = isCalendarView ? calendarShowCompleted : todoShowCompleted;
                  const onChange = isCalendarView ? onCalendarShowCompletedChange : onTodoShowCompletedChange;

                  return (
                    <FormControlLabel
                      key={index}
                      control={
                        <Checkbox
                          checked={checked || false}
                          onChange={(e) => onChange && onChange(e.target.checked)}
                          size="small"
                        />
                      }
                      label={button.label}
                      sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }}
                    />
                  );
                }
                return null;
              })}
          </Box>
        )}
      </Box>



      {/* 居中区域 - 日历视图模式选择器和待办视图切换 */}
      {viewConfig.customButtons && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          {viewConfig.customButtons
            .filter(button =>
              (button.type === 'calendarViewMode' && button.position === 'right') ||
              (button.type === 'viewToggle' && button.position === 'center')
            )
            .map((button, index) => {
              if (button.type === 'calendarViewMode') {
                return (
                  <Box key={index} sx={{
                    display: 'flex', alignItems: 'center', gap: '3px',
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                    borderRadius: '12px', p: '3px',
                  }}>
                    {button.options.map((option) => {
                      const isActive = (calendarViewMode || 'todos') === option.value;
                      return (
                        <Button
                          key={option.value}
                          disableElevation
                          disableRipple
                          variant={isActive ? 'contained' : 'text'}
                          onClick={() => {
                            logger.log('Calendar view mode clicked:', option.value);
                            if (onCalendarViewModeChange) {
                              onCalendarViewModeChange(option.value);
                            }
                          }}
                          sx={{
                            px: 1.5, py: 0.4, minWidth: 0, fontSize: '0.78rem', fontWeight: 600,
                            borderRadius: '9px', textTransform: 'none', lineHeight: 1.5,
                            letterSpacing: '0.01em',
                            transition: 'all 0.25s cubic-bezier(.4,0,.2,1)',
                            ...(isActive ? {
                              bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(255,255,255,0.13)'
                                : 'primary.main',
                              color: (theme) => theme.palette.mode === 'dark'
                                ? '#fff'
                                : 'primary.contrastText',
                              boxShadow: (theme) => theme.palette.mode === 'dark'
                                ? '0 1px 4px rgba(0,0,0,0.3)'
                                : `0 2px 8px ${theme.palette.primary.main}33`,
                              '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                  ? 'rgba(255,255,255,0.18)'
                                  : 'primary.dark',
                              },
                            } : {
                              color: 'text.secondary',
                              bgcolor: 'transparent',
                              '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                color: 'text.primary',
                              },
                            }),
                          }}
                        >
                          {option.label}
                        </Button>
                      );
                    })}
                  </Box>
                );
              }
              if (button.type === 'viewToggle') {
                return (
                  <Box key={index} sx={{
                    display: 'flex', alignItems: 'center', gap: '3px',
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                    borderRadius: '12px', p: '3px',
                  }}>
                    {button.options.map((option) => {
                      const isActive = todoViewMode === option.value;
                      return (
                        <Button
                          key={option.value}
                          disableElevation
                          disableRipple
                          variant={isActive ? 'contained' : 'text'}
                          onClick={() => onTodoViewModeChange && onTodoViewModeChange(option.value)}
                          sx={{
                            px: 1.5, py: 0.4, minWidth: 0, fontSize: '0.78rem', fontWeight: 600,
                            borderRadius: '9px', textTransform: 'none', lineHeight: 1.5,
                            letterSpacing: '0.01em',
                            transition: 'all 0.25s cubic-bezier(.4,0,.2,1)',
                            ...(isActive ? {
                              bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(255,255,255,0.13)'
                                : 'primary.main',
                              color: (theme) => theme.palette.mode === 'dark'
                                ? '#fff'
                                : 'primary.contrastText',
                              boxShadow: (theme) => theme.palette.mode === 'dark'
                                ? '0 1px 4px rgba(0,0,0,0.3)'
                                : `0 2px 8px ${theme.palette.primary.main}33`,
                              '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                  ? 'rgba(255,255,255,0.18)'
                                  : 'primary.dark',
                              },
                            } : {
                              color: 'text.secondary',
                              bgcolor: 'transparent',
                              '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                color: 'text.primary',
                              },
                            }),
                          }}
                        >
                          {option.label}
                        </Button>
                      );
                    })}
                  </Box>
                );
              } else if (button.type === 'calendarNavigation') {
                return <CalendarNavButtons key={index} button={button} />;
              }
              return null;
            })}
        </Box>
      )}

      {/* 右侧区域 - 日历导航按钮 */}
      {currentView === 'calendar' && viewConfig.customButtons && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 'auto' }}>
          {viewConfig.customButtons
            .filter(button => button.type === 'calendarNavigation')
            .map((button, index) => <CalendarNavButtons key={index} button={button} />)}
        </Box>
      )}

      {/* 动态标题已移除 */}

      {/* 右侧按钮组 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: currentView === 'calendar' ? 0 : 'auto' }}>
        {/* 插件命令按钮 */}
        {[
          { view: 'notes', commands: noteToolbarCommands },
          { view: 'todo', commands: todoToolbarCommands },
        ].map(({ view, commands }) =>
          currentView === view && commands.length > 0 && (
            <Box key={view} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
              {commands.map((command) => {
                const commandKey = `${command.pluginId}:${command.commandId}`
                const baseLabel = command.description || command.title || command.commandId
                const shortcutHint =
                  command?.shortcutBinding?.currentKey ||
                  command?.shortcutBinding?.defaultKey ||
                  (typeof command?.shortcut === 'string'
                    ? command.shortcut
                    : command?.shortcut?.default || '')
                const tooltipText = shortcutHint ? `${baseLabel} (${shortcutHint})` : baseLabel
                return (
                  <Tooltip key={commandKey} title={tooltipText} placement="bottom">
                    <span>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => handlePluginCommandExecute(command)}
                        disabled={pluginCommandPending === commandKey}
                        aria-label={command.title}
                        sx={{ '&.Mui-disabled': { opacity: 0.35 } }}
                      >
                        {renderPluginCommandIcon(command)}
                      </IconButton>
                    </span>
                  </Tooltip>
                )
              })}
            </Box>
          )
        )}

        {/* 视图特定的右侧按钮 */}
        {viewConfig.rightButtons && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
            {viewConfig.rightButtons.map((button, index) => {
              if (button.type === 'sortMenu') {
                return (
                  <DropdownMenu
                    key={index}
                    icon={<button.icon />}
                    tooltip={button.label}
                    options={button.options}
                    selectedValue={todoSortBy}
                    onSelect={onTodoSortByChange}
                  />
                );
              }
              return null;
            })}
          </Box>
        )}

        {/* 回收站按钮 - 仅在笔记视图显示 */}
        {viewConfig.showDeletedButton && (
          <Tooltip title={showDeleted ? t('common.restore') : t('sidebar.trash')}>
            <IconButton onClick={onToggleDeleted}>
              <Badge badgeContent={deletedNotesCount} color="error">
                {showDeleted ? <RestoreIcon /> : <DeleteIcon />}
              </Badge>
            </IconButton>
          </Tooltip>
        )}

        {/* 暂时隐藏设置按钮 */}
        {/* <DropdownMenu
          icon={<SettingsIcon />}
          tooltip="设置"
          options={settingsOptions}
          onSelect={handleSettingsSelect}
        /> */}
      </Box>
    </MuiToolbar>
  )
}

export default Toolbar
