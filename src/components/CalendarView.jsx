import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from '../utils/i18n';
import { scrollbar } from '../styles/commonStyles';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Tooltip,
  Grid,
  Fade,
  IconButton,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import {
  Circle,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  OpenInNew as OpenInNewIcon,
  Close as CloseIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ANIMATIONS, createAnimationString, createTransitionString, GREEN_SWEEP_KEYFRAMES } from '../utils/animationConfig';
import { fetchTodos, toggleTodoComplete } from '../api/todoAPI';
import { useStore } from '../store/useStore';
import useTodoDrag from '../hooks/useTodoDrag';
import MarkdownPreview from './MarkdownPreview';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useError } from './ErrorProvider';
import { isTodoCompleted, isFutureRecurringTodo } from '../utils/todoDisplayUtils';

// 白板预览组件 - 只读模式
const WhiteboardPreview = ({ content, theme }) => {
  const [whiteboardData, setWhiteboardData] = useState({
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {}
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadWhiteboardData = async () => {
      if (!content) {
        setWhiteboardData({
          elements: [],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {}
        });
        setIsLoading(false);
        return;
      }

      try {
        const parsed = JSON.parse(content);
        const elements = parsed.elements || [];
        const appState = parsed.appState || { viewBackgroundColor: '#ffffff' };
        let files = {};

        // 处理图片文件
        if (parsed.fileMap && Object.keys(parsed.fileMap).length > 0) {
          // 检查是否有内联 dataURL（从 Markdown 转换来的）
          const hasInlineDataURL = Object.values(parsed.fileMap).some(
            f => f.dataURL && f.dataURL.startsWith('data:')
          );

          if (hasInlineDataURL) {
            // 使用内联 dataURL
            for (const [fileId, fileData] of Object.entries(parsed.fileMap)) {
              if (fileData.dataURL && fileData.dataURL.startsWith('data:')) {
                files[fileId] = {
                  mimeType: fileData.mimeType || 'image/png',
                  id: fileId,
                  dataURL: fileData.dataURL,
                  created: fileData.created || Date.now()
                };
              }
            }
          } else {
            // 从文件系统加载图片
            const result = await window.electronAPI.whiteboard.loadImages(parsed.fileMap);
            if (result.success) {
              files = result.data;
            } else {
              console.error('[WhiteboardPreview] 加载图片失败:', result.error);
            }
          }
        }

        setWhiteboardData({ elements, appState, files });
      } catch (error) {
        console.error('[WhiteboardPreview] 解析白板数据失败:', error);
        // 不显示错误提示，这是后台操作
        setWhiteboardData({
          elements: [],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {}
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadWhiteboardData();
  }, [content]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Typography variant="body2" color="text.secondary">加载中...</Typography>
      </Box>
    );
  }

  return (
    <Excalidraw
      initialData={{
        elements: whiteboardData.elements,
        appState: whiteboardData.appState,
        files: whiteboardData.files
      }}
      viewModeEnabled={true}
      zenModeEnabled={false}
      gridModeEnabled={false}
      theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
    />
  );
};

const CalendarView = ({ currentDate, onDateChange, onTodoSelect, selectedDate, onSelectedDateChange, refreshToken = 0, showCompleted = false, onShowCompletedChange, onTodoUpdated, viewMode = 'todos' }) => {
  const { t } = useTranslation();
  const { showError } = useError();
  const theme = useTheme();
  const notes = useStore((state) => state.notes);
  const setSelectedNoteId = useStore((state) => state.setSelectedNoteId);
  const setCurrentView = useStore((state) => state.setCurrentView);
  const [todos, setTodos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingComplete, setPendingComplete] = useState(new Set());

  // 获取笔记显示标题：如果有标题则显示标题，否则显示内容前9个字
  const getNoteDisplayTitle = (note) => {
    if (note.title && note.title !== '无标题' && note.title !== 'Untitled') {
      return note.title
    }
    // 没有标题时，显示内容前9个字
    if (note.content) {
      // 白板笔记特殊处理
      if (note.note_type === 'whiteboard') {
        return t('notes.whiteboardNote')
      }
      const cleanContent = note.content.replace(/[#*`\n]/g, '').trim()
      if (cleanContent) {
        return cleanContent.substring(0, 9) + (cleanContent.length > 9 ? '...' : '')
      }
    }
    return t('notes.untitled')
  }

  // 格式化专注时长（秒 -> 小时分钟）
  const formatFocusTime = (seconds) => {
    if (!seconds || seconds <= 0) return '0分钟';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0 && minutes > 0) {
      return `${hours}小时${minutes}分钟`;
    } else if (hours > 0) {
      return `${hours}小时`;
    } else {
      return `${minutes}分钟`;
    }
  };

  // 处理点击专注框，展示当天详情
  const handleFocusBoxClick = useCallback((date, itemsData) => {
    // 获取当天的笔记和待办详情
    const dateStr = date.toDateString();
    const dayNotes = notes.filter(note => {
      const noteDate = new Date(note.created_at || note.updated_at);
      return noteDate.toDateString() === dateStr;
    });

    const dayTodos = todos.filter(todo => {
      if (!todo.due_date) return false;
      const todoDate = new Date(todo.due_date);
      return todoDate.toDateString() === dateStr;
    });

    setSelectedDayData({
      date,
      notes: dayNotes,
      todos: dayTodos,
      focusTimeSeconds: itemsData.focusTimeSeconds || 0,
      todosTotal: itemsData.todosTotal || 0,
      todosCompleted: itemsData.todosCompleted || 0
    });
    setDayDetailsOpen(true);
  }, [notes, todos]);
  const [celebratingTodos, setCelebratingTodos] = useState(new Set());
  const [previewNote, setPreviewNote] = useState(null); // 预览的笔记
  const [dayDetailsOpen, setDayDetailsOpen] = useState(false); // 控制日详情对话框
  const [selectedDayData, setSelectedDayData] = useState(null); // 选中日期的详细数据

  // 使用拖放 hook
  const {
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDropDate,
    isDragOver
  } = useTodoDrag(() => {
    loadData();
    if (onTodoUpdated) {
      onTodoUpdated();
    }
  });

  // 监听 viewMode 变化
  useEffect(() => {
    console.log('CalendarView viewMode changed to:', viewMode);
    console.log('Notes from store:', notes?.length || 0);
  }, [viewMode, notes]);

  // 获取当月的所有Todo
  const loadTodos = async () => {
    try {
      // 在专注视图中，总是加载已完成的待办（因为需要计算专注时长）
      const includeCompleted = viewMode === 'focus' ? true : showCompleted;
      const data = await fetchTodos({ includeCompleted });
      const normalizedTodos = (data || []).map(todo => ({
        ...todo,
        completed: isTodoCompleted(todo)
      }));
      setTodos(normalizedTodos);
    } catch (error) {
      console.error('获取Todo失败:', error);
      showError(error, '加载待办事项失败');
    }
  };



  // 根据 viewMode 加载不同的数据
  const loadData = async () => {
    setIsLoading(true);
    try {
      // notes 从 store 中获取，不需要加载
      // 只需要加载 todos
      await loadTodos();
    } finally {
      setIsLoading(false);
    }
  };

  // 处理todo完成状态切换
  const handleToggleComplete = useCallback(async (todo) => {
    // 未来重复待办不可完成
    if (isFutureRecurringTodo(todo)) return;

    // 已完成的任务直接切换状态
    if (todo.completed) {
      try {
        await toggleTodoComplete(todo.id);
        loadData();
        // 触发全局刷新
        if (onTodoUpdated) {
          onTodoUpdated();
        }
      } catch (error) {
        console.error('更新待办事项失败:', error);
        showError(error, '更新待办事项失败');
      }
      return;
    }

    // 未完成的任务需要双击
    if (pendingComplete.has(todo.id)) {
      // 第二次点击，执行完成操作
      try {
        // 先显示庆祝动画
        setCelebratingTodos(prev => new Set([...prev, todo.id]));

        // 延迟执行完成操作，让动画播放
        setTimeout(async () => {
          await toggleTodoComplete(todo.id);
          loadData();
          // 触发全局刷新
          if (onTodoUpdated) {
            onTodoUpdated();
          }

          // 清除庆祝状态
          setTimeout(() => {
            setCelebratingTodos(prev => {
              const newSet = new Set(prev);
              newSet.delete(todo.id);
              return newSet;
            });
          }, 1000);
        }, 150);

        // 清除待完成状态
        setPendingComplete(prev => {
          const newSet = new Set(prev);
          newSet.delete(todo.id);
          return newSet;
        });
      } catch (error) {
        console.error('更新待办事项失败:', error);
        showError(error, '更新待办事项失败');
      }
    } else {
      // 第一次点击，标记为待完成
      setPendingComplete(prev => new Set([...prev, todo.id]));

      // 3秒后自动清除待完成状态
      setTimeout(() => {
        setPendingComplete(prev => {
          const newSet = new Set(prev);
          newSet.delete(todo.id);
          return newSet;
        });
      }, 3000);
    }
  }, [onTodoUpdated, showError]);

  useEffect(() => {
    loadData();
  }, [currentDate, refreshToken, showCompleted, viewMode]);

  // 获取当月的日期数组
  const getCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // 获取当月第一天和最后一天
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 获取第一天是星期几（0=周日，1=周一...）
    const firstDayOfWeek = firstDay.getDay();

    // 计算需要显示的天数（包括上月末尾和下月开头）
    const daysInMonth = lastDay.getDate();
    const totalDays = Math.ceil((daysInMonth + firstDayOfWeek) / 7) * 7;

    const days = [];

    // 添加上月末尾的日期
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false
      });
    }

    // 添加当月的日期
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const today = new Date();
      const isToday = date.toDateString() === today.toDateString();

      days.push({
        date,
        isCurrentMonth: true,
        isToday
      });
    }

    // 添加下月开头的日期
    const remainingDays = totalDays - days.length;
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(year, month + 1, day);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false
      });
    }

    return days;
  };

  // 获取指定日期的Todo
  const getTodosForDate = (date) => {
    if (!todos.length) return [];

    return todos.filter(todo => {
      if (!todo.due_date) return false;

      const todoDate = new Date(todo.due_date);
      return todoDate.toDateString() === date.toDateString();
    });
  };

  // 获取指定日期的笔记（根据 updated_at 或 created_at）
  const getNotesForDate = (date) => {
    if (!notes || !notes.length) return [];

    const filtered = notes.filter(note => {
      if (!note.updated_at && !note.created_at) return false;

      const noteDate = new Date(note.updated_at || note.created_at);
      return noteDate.getFullYear() === date.getFullYear() &&
        noteDate.getMonth() === date.getMonth() &&
        noteDate.getDate() === date.getDate();
    });

    return filtered;
  };

  // 根据 viewMode 获取指定日期的内容
  const getItemsForDate = (date) => {
    if (viewMode === 'todos') {
      return getTodosForDate(date);
    } else if (viewMode === 'notes') {
      return getNotesForDate(date);
    } else if (viewMode === 'focus') {
      // 返回专注视图数据：当日的专注时长和待办统计
      const dayNotes = getNotesForDate(date);
      const dayTodos = getTodosForDate(date);
      const completedTodos = dayTodos.filter(t => t.completed).length;
      const totalTodos = dayTodos.length;

      // 计算当日所有待办的专注时长总和（包括已完成的）
      const totalFocusSeconds = dayTodos.reduce((sum, todo) => {
        const focusTime = Number(todo.focus_time_seconds) || 0;
        return sum + focusTime;
      }, 0);

      return {
        type: 'focus',
        notesCount: dayNotes.length,
        todosCompleted: completedTodos,
        todosTotal: totalTodos,
        focusTimeSeconds: totalFocusSeconds
      };
    }
    return [];
  };

  // 获取Todo的优先级颜色
  const getTodoPriorityColor = (todo) => {
    if (todo.is_important && todo.is_urgent) {
      return theme.palette.error.main; // 重要且紧急 - 红色
    } else if (todo.is_important) {
      return theme.palette.warning.main; // 重要不紧急 - 橙色
    } else if (todo.is_urgent) {
      return theme.palette.info.main; // 不重要紧急 - 蓝色
    } else {
      return theme.palette.text.secondary; // 不重要不紧急 - 灰色
    }
  };

  const calendarDays = getCalendarDays();
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        p: { xs: 1, sm: 2 }, // 小屏幕减少内边距
        overflow: 'hidden'
      }}
    >

      {/* 日历容器 - 支持水平滚动 */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0 // 允许收缩
        }}
      >
        {/* 星期标题 */}
        <Box
          sx={(muiTheme) => ({
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(80px, 1fr))',
            gap: 0,
            mb: 2,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '8px',
            overflow: 'hidden',
            minWidth: '560px',
            backgroundColor: muiTheme.palette.mode === 'dark'
              ? 'rgba(30, 41, 59, 0.85)'
              : 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px) saturate(150%)',
            WebkitBackdropFilter: 'blur(12px) saturate(150%)'
          })}
        >
          {weekDays.map((day, index) => (
            <Box
              key={day}
              sx={{
                textAlign: 'center',
                py: 1.5,
                borderRight: index < 6 ? `1px solid ${theme.palette.divider}` : 'none'
              }}
            >
              <Typography
                variant="subtitle2"
                sx={{
                  color: theme.palette.text.primary,
                  fontWeight: 600,
                  fontSize: { xs: '0.75rem', sm: '0.875rem' } // 小屏幕字体更小
                }}
              >
                {day}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* 日历网格 */}
        <Box
          sx={{
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '8px',
            overflow: 'hidden',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(80px, 1fr))',
              gridTemplateRows: `repeat(${Math.ceil(calendarDays.length / 7)}, minmax(100px, 1fr))`, // 自适应高度
              minWidth: '560px',
              width: '100%',
              height: '100%'
            }}
          >
            {calendarDays.map((dayInfo, index) => {
              // 根据 viewMode 获取不同的数据
              const items = getItemsForDate(dayInfo.date);
              const dayTodos = (viewMode === 'todos' || viewMode === 'focus') ? (viewMode === 'todos' ? items : getTodosForDate(dayInfo.date)) : getTodosForDate(dayInfo.date);
              const incompleteTodos = Array.isArray(dayTodos) ? dayTodos.filter(todo => !todo.completed) : [];
              const itemsToDisplay = viewMode === 'todos'
                ? (showCompleted ? dayTodos : incompleteTodos)
                : items;

              return (
                <Box
                  key={index}
                  onDragOver={(e) => handleDragOver(e, dayInfo.date)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDropDate(e, dayInfo.date)}
                  sx={{
                    borderRight: index % 7 < 6 ? `1px solid ${theme.palette.divider}` : 'none',
                    borderBottom: index < calendarDays.length - 7 ? `1px solid ${theme.palette.divider}` : 'none',
                    minHeight: '100px',
                    position: 'relative',
                    overflow: 'hidden', // 防止内容溢出
                    minWidth: 0, // 确保可以收缩
                    ...(isDragOver(dayInfo.date) && {
                      backgroundColor: theme.palette.primary.light + '30',
                      transition: 'background-color 0.2s ease'
                    })
                  }}
                >
                  <Box
                    onClick={() => {
                      onSelectedDateChange(dayInfo.date);
                      if (onDateChange) {
                        onDateChange(dayInfo.date);
                      }
                    }}
                    sx={{
                      height: '100%',
                      minHeight: '100px',
                      p: 1.5,
                      backgroundColor: dayInfo.isCurrentMonth
                        ? (dayInfo.isToday
                          ? theme.palette.primary.light + '15' // 今天的浅色底色
                          : (selectedDate && dayInfo.date.toDateString() === selectedDate.toDateString()
                            ? theme.palette.primary.light + '20'
                            : 'transparent'))
                        : theme.palette.action.hover,
                      border: dayInfo.isToday
                        ? `2px solid ${theme.palette.primary.main}`
                        : (selectedDate && dayInfo.date.toDateString() === selectedDate.toDateString()
                          ? `2px solid ${theme.palette.primary.main}`
                          : 'none'),
                      borderRadius: (dayInfo.isToday || (selectedDate && dayInfo.date.toDateString() === selectedDate.toDateString())) ? 1 : 0,
                      display: 'flex',
                      flexDirection: 'column',
                      cursor: 'pointer',
                      transition: createTransitionString(ANIMATIONS.button),
                      '&:hover': {
                        backgroundColor: theme.palette.action.hover
                      },
                      overflow: 'hidden', // 防止内容溢出
                      minWidth: 0 // 确保可以收缩
                    }}
                  >
                    {/* 日期数字 */}
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 1
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, position: 'relative' }}>
                        <Typography
                          variant="body2"
                          sx={{
                            color: dayInfo.isCurrentMonth
                              ? (dayInfo.isToday ? theme.palette.primary.main : theme.palette.text.primary)
                              : theme.palette.text.disabled,
                            fontWeight: dayInfo.isToday ? 700 : dayInfo.isCurrentMonth ? 500 : 400,
                            fontSize: '0.9rem'
                          }}
                        >
                          {dayInfo.date.getDate()}
                        </Typography>
                        {/* 今天的强调角标 */}
                        {dayInfo.isToday && (
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              backgroundColor: theme.palette.primary.main,
                              animation: 'pulse 2s ease-in-out infinite',
                              '@keyframes pulse': {
                                '0%, 100%': {
                                  opacity: 1,
                                  transform: 'scale(1)'
                                },
                                '50%': {
                                  opacity: 0.6,
                                  transform: 'scale(1.2)'
                                }
                              }
                            }}
                          />
                        )}
                      </Box>

                      {/* 显示数量指示器 */}
                      {((viewMode === 'todos' && incompleteTodos.length > 0) ||
                        (viewMode === 'notes' && itemsToDisplay.length > 0) ||
                        (viewMode === 'focus' && itemsToDisplay?.type === 'focus' &&
                          (itemsToDisplay.notesCount > 0 || itemsToDisplay.todosTotal > 0))) && (
                          <Box
                            sx={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              backgroundColor: theme.palette.primary.main,
                              color: theme.palette.primary.contrastText,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.7rem',
                              fontWeight: 600
                            }}
                          >
                            {viewMode === 'todos'
                              ? incompleteTodos.length
                              : viewMode === 'notes'
                                ? itemsToDisplay.length
                                : (itemsToDisplay.notesCount + itemsToDisplay.todosTotal)}
                          </Box>
                        )}
                    </Box>

                    {/* 内容列表（Todo/笔记/专注时长） */}
                    <Box
                      sx={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        maxHeight: '72px', // 3行 * 24px高度
                        pr: 0.5,
                        ...scrollbar.auto,
                      }}
                    >
                      {/* 待办视图 */}
                      {viewMode === 'todos' && itemsToDisplay.map((todo) => (
                        <Fade key={todo.id} in timeout={200}>
                          <Tooltip title={todo.content} placement="top">
                            <Box
                              draggable
                              onDragStart={(e) => handleDragStart(e, todo)}
                              onDragEnd={handleDragEnd}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                p: 0.5,
                                borderRadius: 1,
                                backgroundColor: `${getTodoPriorityColor(todo)}15`,
                                border: `1px solid ${getTodoPriorityColor(todo)}30`,
                                cursor: 'pointer',
                                position: 'relative',
                                overflow: 'hidden',
                                transition: createTransitionString(ANIMATIONS.listItem),
                                minHeight: '22px', // 固定最小高度
                                '&:hover': {
                                  backgroundColor: `${getTodoPriorityColor(todo)}40`, // 颜色变暗
                                },
                                '&:active': {
                                  backgroundColor: `${getTodoPriorityColor(todo)}50`, // 点击时更暗
                                },
                                ...(celebratingTodos.has(todo.id) && {
                                  '&::before': {
                                    content: '""',
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    background: 'rgba(76, 175, 80, 0.4)',
                                    transform: 'translateX(-100%)',
                                    animation: createAnimationString(ANIMATIONS.completion),
                                    zIndex: 1,
                                    pointerEvents: 'none'
                                  },
                                  ...GREEN_SWEEP_KEYFRAMES
                                })
                              }}
                            >
                              {/* 完成状态按钮 */}
                              {isFutureRecurringTodo(todo) ? (
                                <ScheduleIcon sx={{ color: 'text.disabled', fontSize: 16, mr: 0.5, opacity: 0.35 }} />
                              ) : (
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleComplete(todo);
                                }}
                                aria-label="切换完成状态"
                                sx={{
                                  minWidth: 20,
                                  width: 20,
                                  height: 20,
                                  mr: 0.5,
                                  p: 0,
                                  position: 'relative',
                                  transition: createTransitionString(ANIMATIONS.stateChange),
                                  zIndex: 2,
                                  ...(pendingComplete.has(todo.id) && {
                                    backgroundColor: 'warning.light',
                                    '&:hover': {
                                      backgroundColor: 'warning.main'
                                    }
                                  })
                                }}
                              >
                                {todo.completed ? (
                                  <CheckCircleIcon sx={{ color: 'success.main', fontSize: 16 }} />
                                ) : pendingComplete.has(todo.id) ? (
                                  <RadioButtonUncheckedIcon
                                    sx={{
                                      color: 'warning.main',
                                      fontSize: 16,
                                      animation: createAnimationString(ANIMATIONS.pulse)
                                    }}
                                  />
                                ) : celebratingTodos.has(todo.id) ? (
                                  <CheckCircleIcon
                                    sx={{
                                      color: 'success.main',
                                      fontSize: 16,
                                      filter: 'drop-shadow(0 0 8px rgba(76, 175, 80, 0.6))'
                                    }}
                                  />
                                ) : (
                                  <RadioButtonUncheckedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />
                                )}
                              </IconButton>
                              )}

                              {/* Todo内容 */}
                              <Box
                                onClick={() => {
                                  if (onTodoSelect) {
                                    onTodoSelect(todo);
                                  }
                                }}
                                sx={{
                                  flex: 1,
                                  minWidth: 0,
                                  zIndex: 2
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: 'block',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    fontSize: '0.65rem', // 更小的字体
                                    lineHeight: 1.1,
                                    textDecoration: todo.completed ? 'line-through' : 'none',
                                    opacity: todo.completed ? 0.6 : 1,
                                    color: theme.palette.text.primary
                                  }}
                                >
                                  {todo.content}
                                </Typography>
                              </Box>
                            </Box>
                          </Tooltip>
                        </Fade>
                      ))}

                      {/* 笔记视图 */}
                      {viewMode === 'notes' && Array.isArray(itemsToDisplay) && itemsToDisplay.map((note) => {
                        const isWhiteboard = note.note_type === 'whiteboard';
                        const bgColor = isWhiteboard
                          ? (theme.palette.mode === 'dark' ? 'rgba(236, 72, 153, 0.15)' : 'rgba(236, 72, 153, 0.08)')
                          : (theme.palette.mode === 'dark' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)');
                        const borderColor = isWhiteboard
                          ? (theme.palette.mode === 'dark' ? 'rgba(236, 72, 153, 0.3)' : 'rgba(236, 72, 153, 0.2)')
                          : (theme.palette.mode === 'dark' ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.2)');
                        const hoverBgColor = isWhiteboard
                          ? (theme.palette.mode === 'dark' ? 'rgba(236, 72, 153, 0.25)' : 'rgba(236, 72, 153, 0.15)')
                          : (theme.palette.mode === 'dark' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.15)');

                        return (
                          <Fade key={note.id} in timeout={200}>
                            <Tooltip title={`${isWhiteboard ? '白板' : 'Markdown'}: ${getNoteDisplayTitle(note)}`} placement="top">
                              <Box
                                onClick={() => {
                                  setPreviewNote(note);
                                }}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  p: 0.5,
                                  borderRadius: 1,
                                  backgroundColor: bgColor,
                                  border: `1px solid ${borderColor}`,
                                  cursor: 'pointer',
                                  transition: createTransitionString(ANIMATIONS.listItem),
                                  minHeight: '22px',
                                  '&:hover': {
                                    backgroundColor: hoverBgColor,
                                  },
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: 'block',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    fontSize: '0.65rem',
                                    lineHeight: 1.1,
                                    color: theme.palette.text.primary,
                                    flex: 1
                                  }}
                                >
                                  {getNoteDisplayTitle(note)}
                                </Typography>
                              </Box>
                            </Tooltip>
                          </Fade>
                        );
                      })}

                      {/* 专注视图 - 显示当日统计 */}
                      {viewMode === 'focus' && itemsToDisplay?.type === 'focus' && (
                        <Box
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFocusBoxClick(dayInfo.date, itemsToDisplay);
                          }}
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.5,
                            p: 0.75,
                            borderRadius: 1,
                            cursor: 'pointer',
                            background: itemsToDisplay.focusTimeSeconds > 0
                              ? `linear-gradient(135deg, ${theme.palette.mode === 'dark'
                                ? 'rgba(168, 85, 247, 0.15), rgba(139, 92, 246, 0.08)'
                                : 'rgba(168, 85, 247, 0.15), rgba(139, 92, 246, 0.08)'
                              })`
                              : theme.palette.mode === 'dark'
                                ? 'rgba(100, 116, 139, 0.15)'
                                : 'rgba(100, 116, 139, 0.08)',
                            border: `1px solid ${itemsToDisplay.focusTimeSeconds > 0
                              ? theme.palette.mode === 'dark'
                                ? 'rgba(168, 85, 247, 0.3)'
                                : 'rgba(168, 85, 247, 0.2)'
                              : theme.palette.mode === 'dark'
                                ? 'rgba(100, 116, 139, 0.3)'
                                : 'rgba(100, 116, 139, 0.2)'
                              }`,
                            backdropFilter: 'blur(8px)',
                            WebkitBackdropFilter: 'blur(8px)',
                            transition: createTransitionString(ANIMATIONS.listItem),
                            '&:hover': {
                              background: itemsToDisplay.focusTimeSeconds > 0
                                ? `linear-gradient(135deg, ${theme.palette.mode === 'dark'
                                  ? 'rgba(168, 85, 247, 0.25), rgba(139, 92, 246, 0.15)'
                                  : 'rgba(168, 85, 247, 0.25), rgba(139, 92, 246, 0.15)'
                                })`
                                : theme.palette.mode === 'dark'
                                  ? 'rgba(100, 116, 139, 0.25)'
                                  : 'rgba(100, 116, 139, 0.15)'
                            },
                            '&:active': {
                              background: itemsToDisplay.focusTimeSeconds > 0
                                ? `linear-gradient(135deg, ${theme.palette.mode === 'dark'
                                  ? 'rgba(168, 85, 247, 0.35), rgba(139, 92, 246, 0.25)'
                                  : 'rgba(168, 85, 247, 0.35), rgba(139, 92, 246, 0.25)'
                                })`
                                : theme.palette.mode === 'dark'
                                  ? 'rgba(100, 116, 139, 0.35)'
                                  : 'rgba(100, 116, 139, 0.25)'
                            }
                          }}
                        >
                          {/* 专注时长 - 主要信息，大号显示 */}
                          {itemsToDisplay.focusTimeSeconds > 0 ? (
                            <Box sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 0.25
                            }}>
                              <Typography
                                sx={{
                                  fontSize: '0.95rem',
                                  fontWeight: 700,
                                  background: 'linear-gradient(135deg, rgb(168, 85, 247), rgb(139, 92, 246))',
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text',
                                  lineHeight: 1.2,
                                  textAlign: 'center'
                                }}
                              >
                                {formatFocusTime(itemsToDisplay.focusTimeSeconds)}
                              </Typography>
                              <Typography
                                sx={{
                                  fontSize: '0.5rem',
                                  color: theme.palette.text.secondary,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  opacity: 0.8
                                }}
                              >
                                专注时长
                              </Typography>
                            </Box>
                          ) : (
                            <Typography
                              sx={{
                                fontSize: '0.55rem',
                                color: theme.palette.text.disabled,
                                textAlign: 'center',
                                py: 0.5
                              }}
                            >
                              暂无专注
                            </Typography>
                          )}

                          {/* 次要信息：待办和笔记 */}
                          {(itemsToDisplay.todosTotal > 0 || itemsToDisplay.notesCount > 0) && (
                            <Box
                              sx={{
                                display: 'flex',
                                justifyContent: 'center',
                                gap: 0.75,
                                pt: 0.25,
                                borderTop: itemsToDisplay.focusTimeSeconds > 0
                                  ? `1px solid ${theme.palette.mode === 'dark' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(168, 85, 247, 0.15)'}`
                                  : 'none'
                              }}
                            >
                              {itemsToDisplay.todosTotal > 0 && (
                                <Box
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.25,
                                    px: 0.5,
                                    py: 0.15,
                                    borderRadius: 0.5,
                                    backgroundColor: itemsToDisplay.todosCompleted === itemsToDisplay.todosTotal
                                      ? theme.palette.mode === 'dark'
                                        ? 'rgba(34, 197, 94, 0.2)'
                                        : 'rgba(34, 197, 94, 0.15)'
                                      : 'transparent'
                                  }}
                                >
                                  <Box
                                    sx={{
                                      width: 4,
                                      height: 4,
                                      borderRadius: '50%',
                                      backgroundColor: itemsToDisplay.todosCompleted === itemsToDisplay.todosTotal
                                        ? 'rgb(34, 197, 94)'
                                        : theme.palette.text.secondary
                                    }}
                                  />
                                  <Typography
                                    sx={{
                                      fontSize: '0.55rem',
                                      fontWeight: 500,
                                      color: itemsToDisplay.todosCompleted === itemsToDisplay.todosTotal
                                        ? 'rgb(34, 197, 94)'
                                        : theme.palette.text.secondary
                                    }}
                                  >
                                    {itemsToDisplay.todosCompleted}/{itemsToDisplay.todosTotal}
                                  </Typography>
                                </Box>
                              )}
                              {itemsToDisplay.notesCount > 0 && (
                                <Box
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.25,
                                    px: 0.5,
                                    py: 0.15,
                                    borderRadius: 0.5
                                  }}
                                >
                                  <Box
                                    sx={{
                                      width: 4,
                                      height: 4,
                                      borderRadius: '50%',
                                      backgroundColor: 'rgb(99, 102, 241)'
                                    }}
                                  />
                                  <Typography
                                    sx={{
                                      fontSize: '0.55rem',
                                      fontWeight: 500,
                                      color: theme.palette.text.secondary
                                    }}
                                  >
                                    {itemsToDisplay.notesCount}
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          )}

                          {/* 完全无活动 */}
                          {itemsToDisplay.focusTimeSeconds === 0 && itemsToDisplay.notesCount === 0 && itemsToDisplay.todosTotal === 0 && (
                            <Typography
                              sx={{
                                fontSize: '0.55rem',
                                color: theme.palette.text.disabled,
                                fontStyle: 'italic',
                                textAlign: 'center'
                              }}
                            >
                              无活动
                            </Typography>
                          )}
                        </Box>
                      )}

                      {/* 显示剩余Todo数量 */}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>

      {/* 日详情对话框 */}
      <Dialog
        open={dayDetailsOpen}
        onClose={() => setDayDetailsOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">
            {selectedDayData?.date?.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long'
            })}
          </Typography>
          <IconButton onClick={() => setDayDetailsOpen(false)} size="small" aria-label="关闭">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedDayData && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* 专注时长统计 */}
              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  专注时长
                </Typography>
                <Paper sx={{ p: 2, backgroundColor: theme.palette.mode === 'dark' ? 'rgba(168, 85, 247, 0.1)' : 'rgba(168, 85, 247, 0.05)' }}>
                  <Typography variant="h4" sx={{
                    background: 'linear-gradient(135deg, rgb(168, 85, 247), rgb(139, 92, 246))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    fontWeight: 700
                  }}>
                    {formatFocusTime(selectedDayData.focusTimeSeconds)}
                  </Typography>
                </Paper>
              </Box>

              {/* 待办事项 */}
              {selectedDayData.todos && selectedDayData.todos.length > 0 && (
                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                    待办事项 ({selectedDayData.todosCompleted}/{selectedDayData.todosTotal})
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {selectedDayData.todos.map(todo => (
                      <Paper
                        key={todo.id}
                        sx={{
                          p: 1.5,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          opacity: todo.completed ? 0.6 : 1,
                          backgroundColor: todo.completed
                            ? (theme.palette.mode === 'dark' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.05)')
                            : 'inherit'
                        }}
                      >
                        {isFutureRecurringTodo(todo) ? (
                          <ScheduleIcon sx={{ color: 'text.disabled', fontSize: 20, opacity: 0.35 }} />
                        ) : todo.completed ? (
                          <CheckCircleIcon sx={{ color: 'rgb(34, 197, 94)', fontSize: 20 }} />
                        ) : (
                          <RadioButtonUncheckedIcon sx={{ color: theme.palette.text.secondary, fontSize: 20 }} />
                        )}
                        <Box sx={{ flex: 1 }}>
                          <Typography
                            sx={{
                              textDecoration: todo.completed ? 'line-through' : 'none',
                              color: todo.completed ? theme.palette.text.secondary : theme.palette.text.primary
                            }}
                          >
                            {todo.content}
                          </Typography>
                          {todo.focus_duration > 0 && (
                            <Typography variant="caption" sx={{ color: 'rgb(168, 85, 247)' }}>
                              {formatFocusTime(todo.focus_duration)}
                            </Typography>
                          )}
                        </Box>
                      </Paper>
                    ))}
                  </Box>
                </Box>
              )}

              {/* 笔记 */}
              {selectedDayData.notes && selectedDayData.notes.length > 0 && (
                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                    笔记 ({selectedDayData.notes.length})
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {selectedDayData.notes.map(note => (
                      <Paper
                        key={note.id}
                        sx={{
                          p: 1.5,
                          cursor: 'pointer',
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover
                          }
                        }}
                        onClick={() => {
                          setDayDetailsOpen(false);
                          setPreviewNote(note);
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                          {getNoteDisplayTitle(note)}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          {note.tags && note.tags.map(tag => (
                            <Chip key={tag} label={tag} size="small" />
                          ))}
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {note.type === 'markdown' ? 'Markdown' :
                            note.type === 'wysiwyg' ? '富文本' :
                              note.type === 'whiteboard' ? '白板' : '笔记'}
                          {' · '}
                          {new Date(note.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          {note.updated_at && note.updated_at !== note.created_at && (
                            <> (更新于 {new Date(note.updated_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})</>
                          )}
                        </Typography>
                      </Paper>
                    ))}
                  </Box>
                </Box>
              )}

              {/* 无活动 */}
              {(!selectedDayData.notes || selectedDayData.notes.length === 0) &&
                (!selectedDayData.todos || selectedDayData.todos.length === 0) &&
                selectedDayData.focusTimeSeconds === 0 && (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography color="text.secondary">
                      这一天暂无记录
                    </Typography>
                  </Box>
                )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDayDetailsOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 笔记预览对话框 */}
      <Dialog
        open={Boolean(previewNote)}
        onClose={() => setPreviewNote(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(30, 41, 59, 0.85)'
              : 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px) saturate(150%)',
            WebkitBackdropFilter: 'blur(12px) saturate(150%)',
            maxHeight: '80vh',
            boxShadow: theme.palette.mode === 'dark'
              ? '0 8px 32px rgba(0, 0, 0, 0.5)'
              : '0 8px 32px rgba(0, 0, 0, 0.15)'
          }
        }}
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(4px)',
            backgroundColor: 'rgba(0, 0, 0, 0.3)'
          }
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${theme.palette.divider}`,
            pb: 2
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {previewNote ? getNoteDisplayTitle(previewNote) : ''}
            </Typography>
            <Chip
              label={previewNote?.note_type === 'whiteboard' ? '白板笔记' : 'Markdown'}
              size="small"
              sx={{
                backgroundColor: previewNote?.note_type === 'whiteboard'
                  ? 'rgba(236, 72, 153, 0.2)'
                  : 'rgba(99, 102, 241, 0.2)',
                color: previewNote?.note_type === 'whiteboard'
                  ? 'rgb(236, 72, 153)'
                  : 'rgb(99, 102, 241)',
                fontWeight: 600
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="在编辑器中打开">
              <Button
                variant="contained"
                size="small"
                startIcon={<OpenInNewIcon />}
                onClick={() => {
                  setCurrentView('notes');
                  setSelectedNoteId(previewNote.id);
                  setPreviewNote(null);
                }}
                sx={{
                  textTransform: 'none'
                }}
              >
                在编辑器中打开
              </Button>
            </Tooltip>
            <IconButton
              onClick={() => setPreviewNote(null)}
              size="small"
              aria-label="关闭"
              sx={{
                '&:hover': {
                  backgroundColor: theme.palette.action.hover
                }
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              创建时间: {previewNote?.created_at ? new Date(previewNote.created_at).toLocaleString('zh-CN') : '未知'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              更新时间: {previewNote?.updated_at ? new Date(previewNote.updated_at).toLocaleString('zh-CN') : '未知'}
            </Typography>
          </Box>
          {previewNote?.tags && typeof previewNote.tags === 'string' && previewNote.tags.trim() && (
            <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {previewNote.tags.split(',').filter(t => t.trim()).map((tag, idx) => (
                <Chip
                  key={idx}
                  label={tag.trim()}
                  size="small"
                  sx={{
                    backgroundColor: theme.palette.primary.main + '20',
                    color: theme.palette.primary.main
                  }}
                />
              ))}
            </Box>
          )}
          {previewNote?.note_type === 'whiteboard' ? (
            <Box
              sx={{
                height: '500px',
                borderRadius: 1,
                border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(236, 72, 153, 0.3)' : 'rgba(236, 72, 153, 0.2)'}`,
                backgroundColor: theme.palette.background.paper,
                '& .excalidraw': {
                  height: '100%'
                }
              }}
            >
              <WhiteboardPreview content={previewNote?.content} theme={theme} />
            </Box>
          ) : (
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(0, 0, 0, 0.2)'
                  : 'rgba(0, 0, 0, 0.02)',
                '& .markdown-preview': {
                  backgroundColor: 'transparent',
                  maxHeight: '60vh',
                  overflow: 'auto'
                }
              }}
            >
              <MarkdownPreview
                content={previewNote?.content || '(空笔记)'}
                sx={{
                  backgroundColor: 'transparent',
                  p: 0
                }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${theme.palette.divider}`, pt: 2 }}>
          <Button onClick={() => setPreviewNote(null)} sx={{ textTransform: 'none' }}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>
    </Box >
  );
};

export default CalendarView;