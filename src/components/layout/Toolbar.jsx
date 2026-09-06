import { useMemo, useState, useCallback } from 'react'
import {
  Box,
  Toolbar as MuiToolbar,
  IconButton,
  Typography,
  Button,
  Tooltip,
  Badge
} from '@mui/material'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Restore as RestoreIcon,
  ChevronLeft,
  ChevronRight,
  EditNote as EditNoteIcon,
  VisibilityRounded as VisibilityIcon,
  VisibilityOffRounded as VisibilityOffIcon
} from '../common/AppIcons'
import { FlotaCalendarIcon as Today } from '../common/FlotaIcons'
import { useStore } from '../../store/useStore'
import DropdownMenu from '../common/DropdownMenu'
import { executePluginCommand } from '../../api/pluginAPI'
import { getPluginCommandIcon } from '../../utils/pluginCommandUtils.jsx'
import { segmentedButtonSx, segmentedControlSx } from '../../styles/commonStyles'
import { t } from '../../utils/i18n'
import logger from '../../utils/logger'

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
  const timelineFilter = useStore((state) => state.timelineFilter)
  const setTimelineFilter = useStore((state) => state.setTimelineFilter)
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
        title: '',
        content: '',
        tags: []
      })
      if (result?.success && result.data) {
        setSelectedNoteId(result.data.id)
      }
    } catch (error) {
      console.error('创建笔记失败:', error)
    }
  }, [createNote, setSelectedNoteId])

  // 快速输入：创建空白笔记并在独立窗口打开
  const handleQuickInput = useCallback(async () => {
    try {
      const result = await createNote({
        title: '',
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
  }, [createNote])


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

  const calendarNavButtonSx = {
    borderRadius: '8px',
    color: 'text.secondary',
    '&:hover': {
      backgroundColor: 'action.hover',
      color: 'text.primary',
    }
  };

  const calendarTodayButtonSx = {
    ...calendarNavButtonSx,
    color: 'primary.main',
    ml: 0.5,
  };

  /** 日历导航按钮组 */
  const CalendarNavButtons = ({ button }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip title={t('common.previous')}>
        <IconButton aria-label={t('common.previous')} onClick={goToPreviousMonth} size="small" sx={calendarNavButtonSx}>
          <ChevronLeft />
        </IconButton>
      </Tooltip>
      <Box sx={{ minWidth: 112, textAlign: 'center', px: 1, py: 0.5, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
          {button.currentDate
            ? `${button.currentDate.getFullYear()}年${button.currentDate.getMonth() + 1}月`
            : t('sidebar.calendar')}
        </Typography>
      </Box>
      <Tooltip title={t('common.next')}>
        <IconButton aria-label={t('common.next')} onClick={goToNextMonth} size="small" sx={calendarNavButtonSx}>
          <ChevronRight />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('common.today')}>
        <IconButton aria-label={t('common.today')} onClick={goToToday} size="small" color="primary" sx={calendarTodayButtonSx}>
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

  const handleTimelineScrollLatest = () => {
    window.dispatchEvent(new CustomEvent('timeline:scroll-latest'))
  }

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
      case 'timeline':
        return {
          title: '时间轴',
          createButtonText: null,
          createAction: null,
          showDeletedButton: false,
          showSidebarToggle: true
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
          title: t('sidebar.profile'),
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
        backgroundColor: theme.custom?.surface?.glassHeavy,
        backdropFilter: theme.custom?.glass?.backdropFilter,
        WebkitBackdropFilter: theme.custom?.glass?.backdropFilter,
        minHeight: '48px !important',
        px: 1.25,
        py: 0.75,
        gap: 1,
        flexWrap: 'wrap',
        flexShrink: 0,
        '& .MuiButton-root': { whiteSpace: 'nowrap' },
        '& .MuiIconButton-root': { minWidth: 32, minHeight: 32 },
      })}
    >
      {/* 左侧按钮组 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        {viewConfig.showSidebarToggle && (
          <Tooltip title={sidebarOpen ? '收起侧栏' : '展开侧栏'}>
            <IconButton
              size="small"
              onClick={onToggleSidebar}
              aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
            >
              {sidebarOpen ? <ChevronLeft fontSize="small" /> : <ChevronRight fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}

        {/* 通用新建按钮 */}
        {viewConfig.createButtonText && (
          <Tooltip title={viewConfig.createButtonText}>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={viewConfig.createAction}
              sx={{
                ml: 0.5,
                height: '30px',
                minHeight: '30px',
                px: 1.25,
                borderRadius: '10px',
                fontSize: '0.8125rem',
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
              size="small"
              startIcon={<EditNoteIcon />}
              onClick={handleQuickInput}
              sx={{
                ml: 0.5,
                height: '30px',
                minHeight: '30px',
                px: 1.25,
                borderRadius: '10px',
                fontSize: '0.8125rem',
              }}
            >
              {t('toolbar.newNote')}
            </Button>
          </Tooltip>
        )}

        {/* 左侧区域的复选框（待办/日历视图） */}
        {viewConfig.customButtons && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, ml: 1.25 }}>
            {viewConfig.customButtons
              .filter(button => button.position === 'left' || (button.type === 'checkbox' && currentView === 'calendar'))
              .map((button, index) => {
                if (button.type === 'checkbox') {
                  const isCalendarView = currentView === 'calendar';
                  const checked = isCalendarView ? calendarShowCompleted : todoShowCompleted;
                  const onChange = isCalendarView ? onCalendarShowCompletedChange : onTodoShowCompletedChange;

                  return (
                    <Tooltip
                      key={index}
                      title={checked ? '隐藏已完成事项' : '显示已完成事项'}
                    >
                      <Button
                        variant="text"
                        disableRipple
                        aria-pressed={Boolean(checked)}
                        startIcon={checked
                          ? <VisibilityIcon sx={{ fontSize: '17px !important' }} />
                          : <VisibilityOffIcon sx={{ fontSize: '17px !important' }} />}
                        onClick={() => onChange?.(!checked)}
                        sx={(theme) => ({
                          height: 30,
                          minHeight: 30,
                          minWidth: 0,
                          px: 1,
                          borderRadius: '10px',
                          border: '1px solid',
                          borderColor: checked
                            ? theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.09)'
                            : 'transparent',
                          bgcolor: checked
                            ? theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.045)'
                            : 'transparent',
                          color: checked ? 'text.primary' : 'text.secondary',
                          boxShadow: checked
                            ? theme.palette.mode === 'dark'
                              ? 'inset 0 1px 0 rgba(255,255,255,0.04)'
                              : '0 1px 3px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.65)'
                            : 'none',
                          textTransform: 'none',
                          fontSize: '0.8125rem',
                          fontWeight: 550,
                          whiteSpace: 'nowrap',
                          transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease',
                          '& .MuiButton-startIcon': {
                            mr: 0.65,
                            ml: 0,
                            color: checked ? 'text.primary' : 'text.disabled',
                          },
                          '&:hover': {
                            bgcolor: theme.palette.mode === 'dark'
                              ? 'rgba(255,255,255,0.07)'
                              : 'rgba(15,23,42,0.05)',
                            color: 'text.primary',
                          },
                        })}
                      >
                        {button.label}
                      </Button>
                    </Tooltip>
                  );
                }
                return null;
              })}
          </Box>
        )}
      </Box>



      {/* 居中区域 - 日历视图模式选择器和待办视图切换 */}
      {viewConfig.customButtons && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mx: 'auto' }}>
          {viewConfig.customButtons
            .filter(button =>
              (button.type === 'calendarViewMode' && button.position === 'right') ||
              (button.type === 'viewToggle' && button.position === 'center')
            )
            .map((button, index) => {
              if (button.type === 'calendarViewMode') {
                return (
                  <Box key={index} sx={segmentedControlSx}>
                    {button.options.map((option) => {
                      const isActive = (calendarViewMode || 'todos') === option.value;
                      return (
                        <Button
                          key={option.value}
                          disableElevation
                          disableRipple
                          variant="text"
                          aria-pressed={isActive}
                          onClick={() => {
                            logger.log('Calendar view mode clicked:', option.value);
                            if (onCalendarViewModeChange) {
                              onCalendarViewModeChange(option.value);
                            }
                          }}
                          sx={segmentedButtonSx(isActive)}
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
                  <Box key={index} sx={segmentedControlSx}>
                    {button.options.map((option) => {
                      const isActive = todoViewMode === option.value;
                      return (
                        <Button
                          key={option.value}
                          disableElevation
                          disableRipple
                          variant="text"
                          aria-pressed={isActive}
                          onClick={() => onTodoViewModeChange && onTodoViewModeChange(option.value)}
                          sx={segmentedButtonSx(isActive)}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
          {viewConfig.customButtons
            .filter(button => button.type === 'calendarNavigation')
            .map((button, index) => <CalendarNavButtons key={index} button={button} />)}
        </Box>
      )}

      {/* 动态标题已移除 */}

      {/* 右侧按钮组 */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        ml: currentView === 'calendar' ? 0 : 'auto',
        pl: 0.875,
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: '1px',
          height: '20px',
          backgroundColor: (theme) => theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(0,0,0,0.08)',
        }
      }}>
        {currentView === 'timeline' && (
          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.75, mr: 0.75 }}>
            <Box sx={segmentedControlSx}>
              {[
                { value: 'all', label: '全部' },
                { value: 'today', label: '今天' },
                { value: 'week', label: '本周' },
                { value: 'month', label: '本月' },
              ].map((option) => {
                const active = (timelineFilter?.dateRange || 'all') === option.value
                return (
                  <Button
                    key={option.value}
                    disableElevation
                    disableRipple
                    variant="text"
                    aria-pressed={active}
                    onClick={() => setTimelineFilter({ dateRange: option.value })}
                    sx={segmentedButtonSx(active)}
                  >
                    {option.label}
                  </Button>
                )
              })}
            </Box>
            <Button
              size="small"
              variant="outlined"
              onClick={handleTimelineScrollLatest}
              sx={{
                borderRadius: '10px',
                height: 33,
                minHeight: 33,
                boxSizing: 'border-box',
                px: 1.25,
                fontSize: '0.8125rem'
              }}
            >
              最新
            </Button>
          </Box>
        )}

        {/* 插件命令按钮 */}
        {[
          { view: 'notes', commands: noteToolbarCommands },
          { view: 'todo', commands: todoToolbarCommands },
        ].map(({ view, commands }) =>
          currentView === view && commands.length > 0 && (
            <Box key={view} sx={{ display: 'flex', alignItems: 'center', gap: 0.375, mr: 0.375 }}>
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
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
            <IconButton size="small" onClick={onToggleDeleted} aria-label={showDeleted ? t('common.restore') : t('sidebar.trash')} aria-pressed={Boolean(showDeleted)} color={showDeleted ? 'primary' : 'default'}>
              <Badge badgeContent={deletedNotesCount} color="error">
                {showDeleted ? <RestoreIcon fontSize="small" /> : <DeleteIcon fontSize="small" />}
              </Badge>
            </IconButton>
          </Tooltip>
        )}

      </Box>
    </MuiToolbar>
  )
}

export default Toolbar
