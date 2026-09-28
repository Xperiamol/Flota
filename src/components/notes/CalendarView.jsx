import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from '../../utils/i18n';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Tooltip,
  Fade,
  IconButton,
  alpha
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  OpenInNew as OpenInNewIcon,
  Close as CloseIcon,
  Schedule as ScheduleIcon,
  EditNoteOutlined
} from '../common/AppIcons';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ANIMATIONS, createAnimationString, createTransitionString, GREEN_SWEEP_KEYFRAMES } from '../../utils/animationConfig';
import { fetchTodos, toggleTodoComplete } from '../../api/todoAPI';
import { useStore } from '../../store/useStore';
import useTodoDrag, { formatDateOnly } from '../../hooks/useTodoDrag';
import { parseISO } from 'date-fns';
import MarkdownPreview from '../editor/MarkdownPreview';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useError } from '../common/ErrorProvider';
import { isTodoCompleted, isFutureRecurringTodo, isTodoInDateInstance, isTodoCompletedOnDate, toListResult } from '../../utils/todoDisplayUtils';
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import { parseNoteDate } from '../../utils/noteDateUtils';
import { buildNoteDayIndex, dayKey, formatClock, moveNoteToDay, noteCreatedDate, useNoteActivity } from '../../utils/noteCalendar'

// 画布预览组件 - 只读模式
const WhiteboardPreview = ({ content, theme }) => {
  const previewBg = theme?.palette?.background?.paper || '#ffffff';
  const [whiteboardData, setWhiteboardData] = useState({
    elements: [],
    appState: { viewBackgroundColor: previewBg },
    files: {}
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadWhiteboardData = async () => {
      if (!content) {
        setWhiteboardData({
          elements: [],
          appState: { viewBackgroundColor: previewBg },
          files: {}
        });
        setIsLoading(false);
        return;
      }

      try {
        const parsed = JSON.parse(content);
        const elements = parsed.elements || [];
        const appState = parsed.appState || { viewBackgroundColor: previewBg };
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
        console.error('[WhiteboardPreview] 解析画布数据失败:', error);
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

const CalendarView = ({ currentDate, onDateChange, onTodoSelect, selectedDate, onSelectedDateChange, refreshToken = 0, showCompleted = false, onTodoUpdated, viewMode = 'todos' }) => {
  const { t } = useTranslation();
  const { showError, showSuccess } = useError();
  const theme = useTheme();
  const notes = useStore((state) => state.notes);
  const setSelectedNoteId = useStore((state) => state.setSelectedNoteId);
  const setCurrentView = useStore((state) => state.setCurrentView);
  const [todos, setTodos] = useState([]);
  const [pendingComplete, setPendingComplete] = useState(new Set());

  // 获取笔记显示标题：如果有标题则显示标题，否则显示内容前9个字
  const getNoteDisplayTitle = (note) => {
    if (note.title && note.title !== '无标题' && note.title !== 'Untitled') {
      return note.title
    }
    // 没有标题时，显示内容前9个字
    if (note.content) {
      // 画布笔记特殊处理
      if (note.note_type === 'whiteboard') {
        return t('notes.whiteboardNote')
      }
      const cleanContent = stripMarkdownToPreviewText(note.content)
      if (cleanContent) {
        return cleanContent.substring(0, 9) + (cleanContent.length > 9 ? '...' : '')
      }
    }
    return t('notes.untitled')
  }

  // 格式化专注时长（秒 -> 小时分钟）
  // 格子里的短格式：数字 + 单位（45 分 / 1.5 小时），数字大、单位小
  const formatFocusShort = (seconds) => {
    const minutes = Math.round((Number(seconds) || 0) / 60);
    if (minutes < 60) return { value: String(minutes), unit: '分' };
    const hours = Math.round((minutes / 60) * 10) / 10;
    return { value: Number.isInteger(hours) ? String(hours) : hours.toFixed(1), unit: '小时' };
  };

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
    const dayNotes = (noteDayIndex[dayKey(date)]?.created) || [];

    const dayTodos = todos.filter(todo => {
      if (!todo.due_date) return false;
      // parseISO 把 "YYYY-MM-DD" 当本地日期；new Date() 会按 UTC 解析，西半球会错一天
      const todoDate = parseISO(String(todo.due_date));
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
  const draggedNoteRef = useRef(null); // 正在拖动的笔记（拖到别的日子 = 修改创建日期）
  const [dayDetailsOpen, setDayDetailsOpen] = useState(false); // 控制日详情对话框
  const [selectedDayData, setSelectedDayData] = useState(null); // 选中日期的详细数据

  // 使用拖放 hook
  const {
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDropDate,
    isDragOver,
    draggedTodo
  } = useTodoDrag(({ targetDate } = {}) => {
    loadData();
    if (onTodoUpdated) {
      onTodoUpdated();
    }
    if (targetDate) {
      showSuccess?.(`已移到 ${targetDate.getMonth() + 1} 月 ${targetDate.getDate()} 日`);
    }
  }, (error) => showError(error, '移动待办失败'));

  // 获取当月的所有Todo
  const loadTodos = async () => {
    try {
      // 关键：日历视图始终拉全量待办。
      // 重复待办在后端按"今天是否已完成"过滤会让任务整体从数据集消失，
      // 导致几天后的格子（下一周期的到期日）也拿不到该 todo。
      // 这里改为前端按格子的目标日 _completedOnDate 决定是否展示，
      // showCompleted 只控制单元格内的过滤（incompleteTodos vs dayTodosWithState）。
      const data = await fetchTodos({ includeCompleted: true });
      const normalizedTodos = toListResult(data).map(todo => ({
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
    // notes 从 store 中获取，不需要加载
    // 只需要加载 todos
    await loadTodos();
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
  }, [onTodoUpdated, showError, pendingComplete]);

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

    return todos.filter(todo => isTodoInDateInstance(todo, date));
  };

  // 笔记按「哪天写的」归类，另附「那天改过的」（规则见 utils/noteCalendar）
  const noteActivity = useNoteActivity((state) => state.byDay);
  const noteDayIndex = useMemo(() => buildNoteDayIndex(notes || [], noteActivity), [notes, noteActivity]);
  const getNoteDay = (date) => noteDayIndex[dayKey(date)] || { created: [], edited: [] };
  const getNotesForDate = (date) => getNoteDay(date).created;

  // 根据 viewMode 获取指定日期的内容
  const getItemsForDate = (date) => {
    if (viewMode === 'todos') {
      return getTodosForDate(date);
    } else if (viewMode === 'notes') {
      const day = getNoteDay(date);
      return [
        ...day.created.map((note) => ({ note, kind: 'created' })),
        ...day.edited.map((note) => ({ note, kind: 'edited' })),
      ];
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
  const focusMaxSeconds = viewMode === 'focus'
    ? Math.max(1, ...calendarDays.map((day) => getItemsForDate(day.date)?.focusTimeSeconds || 0))
    : 1;
  // 可见日期范围内「改过的」笔记：翻月或回到日历时刷新
  const visibleStart = calendarDays.length ? dayKey(calendarDays[0].date) : '';
  const visibleEnd = calendarDays.length ? dayKey(calendarDays[calendarDays.length - 1].date) : '';
  const loadNoteActivity = useNoteActivity((state) => state.load);
  useEffect(() => {
    if (viewMode === 'notes' && visibleStart) loadNoteActivity(visibleStart, visibleEnd, { force: true });
  }, [viewMode, visibleStart, visibleEnd, loadNoteActivity]);
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
            // 与下方日期格同一材质：面板内的分组底色，设了壁纸时不会变成一条白块
            backgroundColor: muiTheme.custom?.surface?.inset
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
            // 有壁纸时与首页卡片同一种分组底色，壁纸里的暗块不会透到日期格上
            backgroundColor: theme.custom?.onWallpaper ? theme.custom.surface.inset : 'transparent',
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
              // 专注视图：格子底色按当天专注时长相对本月最多的一天加深（像热力图）
              const focusRatio = viewMode === 'focus'
                ? Math.min(1, (getItemsForDate(dayInfo.date)?.focusTimeSeconds || 0) / focusMaxSeconds)
                : 0;
              // 根据 viewMode 获取不同的数据
              const items = getItemsForDate(dayInfo.date);
              const dayTodos = (viewMode === 'todos' || viewMode === 'focus') ? (viewMode === 'todos' ? items : getTodosForDate(dayInfo.date)) : getTodosForDate(dayInfo.date);
              const dayTodosWithState = Array.isArray(dayTodos)
                ? dayTodos.map(todo => ({
                    ...todo,
                    _completedOnDate: isTodoCompletedOnDate(todo, dayInfo.date)
                  }))
                : [];
              const incompleteTodos = Array.isArray(dayTodosWithState) ? dayTodosWithState.filter(todo => !todo._completedOnDate) : [];
              const totalTodosCount = dayTodosWithState.length;
              const pendingTodosCount = incompleteTodos.length;
              const itemsToDisplay = viewMode === 'todos'
                ? (showCompleted ? dayTodosWithState : incompleteTodos)
                : items;
              const isSelectedDay = selectedDate && dayInfo.date.toDateString() === selectedDate.toDateString();

              return (
                <Box
                  key={index}
                  // 供跨组件拖拽命中：左侧「我的一天」等待办列表用鼠标坐标拖拽（DragManager），
                  // 不是这里的原生 HTML5 dragover/drop，需要靠这个属性让 DragManager 认出日期格
                  data-calendar-day={formatDateOnly(dayInfo.date)}
                  onClick={viewMode === 'focus' && items?.type === 'focus' && (items.focusTimeSeconds > 0 || items.todosTotal > 0)
                    ? () => handleFocusBoxClick(dayInfo.date, items)
                    : undefined}
                  onDragOver={(e) => handleDragOver(e, dayInfo.date)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => {
                    // 拖的是笔记：修改它的创建日期；否则按待办处理
                    if (draggedNoteRef.current) {
                      e.preventDefault();
                      const note = draggedNoteRef.current;
                      draggedNoteRef.current = null;
                      handleDragLeave(e);
                      moveNoteToDay(note, dayInfo.date);
                      return;
                    }
                    handleDropDate(e, dayInfo.date);
                  }}
                  sx={{
                    borderRight: index % 7 < 6 ? `1px solid ${theme.palette.divider}` : 'none',
                    borderBottom: index < calendarDays.length - 7 ? `1px solid ${theme.palette.divider}` : 'none',
                    backgroundColor: focusRatio > 0
                      ? alpha(theme.palette.primary.main, (theme.palette.mode === 'dark' ? 0.1 : 0.06) + focusRatio * (theme.palette.mode === 'dark' ? 0.3 : 0.2))
                      : dayInfo.isCurrentMonth ? 'transparent' : theme.palette.action.hover,
                    cursor: viewMode === 'focus' ? 'pointer' : undefined,
                    minHeight: '100px',
                    position: 'relative',
                    overflow: 'hidden', // 防止内容溢出
                    minWidth: 0, // 确保可以收缩
                    ...(isDragOver(dayInfo.date) && {
                      backgroundColor: theme.palette.primary.light + '30',
                      boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
                      transition: 'background-color 0.2s ease, box-shadow 0.2s ease'
                    }),
                    '&[data-global-drag-over="true"]': {
                      backgroundColor: theme.palette.primary.light + '30',
                      boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`
                    }
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
                      height: index < calendarDays.length - 7 ? 'calc(100% - 1px)' : '100%',
                      minHeight: index < calendarDays.length - 7 ? 'calc(100px - 1px)' : '100px',
                      p: 1.5,
                      backgroundColor: isSelectedDay
                        ? theme.palette.primary.light + '18'
                        : (dayInfo.isToday
                          ? theme.palette.primary.light + '10'
                          : 'transparent'),
                      border: '1px solid',
                      borderColor: dayInfo.isToday || isSelectedDay
                        ? theme.palette.primary.main
                        : 'transparent',
                      borderRadius: dayInfo.isToday || isSelectedDay ? '12px' : 0,
                      boxShadow: isSelectedDay ? `inset 0 0 0 1px ${theme.palette.primary.main}22` : 'none',
                      boxSizing: 'border-box',
                      mb: index < calendarDays.length - 7 ? '1px' : 0,
                      display: 'flex',
                      flexDirection: 'column',
                      cursor: 'pointer',
                      transition: 'background-color 180ms cubic-bezier(0.32,0.72,0,1), border-color 180ms cubic-bezier(0.32,0.72,0,1), box-shadow 180ms cubic-bezier(0.32,0.72,0,1)',
                      '&:hover': {
                        backgroundColor: isSelectedDay
                          ? theme.palette.primary.light + '22'
                          : (dayInfo.isCurrentMonth ? theme.palette.action.hover : 'transparent'),
                        borderColor: dayInfo.isToday || isSelectedDay ? theme.palette.primary.main : theme.palette.divider,
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
                                  boxShadow: `0 0 0 0 ${theme.palette.primary.main}33`
                                },
                                '50%': {
                                  opacity: 0.6,
                                  boxShadow: `0 0 0 4px ${theme.palette.primary.main}00`
                                }
                              }
                            }}
                          />
                        )}
                      </Box>

                      {/* 显示数量指示器 */}
                      {((viewMode === 'todos' && itemsToDisplay.length > 0) ||

                        false) && (
                          <Box
                            sx={{
                              minWidth: 22,
                              height: 20,
                              px: 0.75,
                              borderRadius: 999,
                              backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(22,22,24,0.06)',
                              color: theme.palette.primary.main,
                              border: `1px solid ${theme.palette.primary.main}33`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.7rem',
                              fontWeight: 600
                            }}
                          >
                            {viewMode === 'todos'
                              ? (showCompleted ? `${pendingTodosCount}/${totalTodosCount}` : pendingTodosCount)
                              : viewMode === 'notes'
                                ? itemsToDisplay.filter((item) => item.kind === 'created').length || '✎'
                                : (itemsToDisplay.notesCount + itemsToDisplay.todosTotal)}
                          </Box>
                        )}
                    </Box>

                    {/* 内容列表（Todo/笔记/专注时长） */}
                    <Box
                      sx={{
                        flex: 1,
                        // 笔记视图只放两条 + 一行汇总，不需要滚动条
                        overflowY: viewMode === 'notes' ? 'hidden' : 'auto',
                        overflowX: 'hidden',
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: viewMode === 'notes' ? 0.375 : 0.5,
                        maxHeight: '72px', // 3行 * 24px高度
                        pr: 0.5
                      }}
                    >
                      {/* 待办视图 */}
                      {viewMode === 'todos' && itemsToDisplay.map((todo) => (
                        <Fade key={todo.id} in timeout={200}>
                          <Tooltip title={draggedTodo ? '' : todo.content} placement="top">
                            <Box
                              draggable
                              onDragStart={(e) => handleDragStart(e, todo, dayInfo.date)}
                              onDragEnd={handleDragEnd}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                p: 0.5,
                                borderRadius: 1,
                                backgroundColor: `${getTodoPriorityColor(todo)}15`,
                                border: `1px solid ${getTodoPriorityColor(todo)}30`,
                                cursor: 'grab',
                                position: 'relative',
                                overflow: 'hidden',
                                transition: createTransitionString(ANIMATIONS.listItem),
                                minHeight: '22px', // 固定最小高度
                                '&:hover': {
                                  backgroundColor: `${getTodoPriorityColor(todo)}40`, // 颜色变暗
                                },
                                '&:active': {
                                  cursor: 'grabbing',
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
                              {(isFutureRecurringTodo(todo) && !todo._completedOnDate) ? (
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
                                {(todo._completedOnDate ?? todo.completed) ? (
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
                                    textDecoration: (todo._completedOnDate ?? todo.completed) ? 'line-through' : 'none',
                                    opacity: (todo._completedOnDate ?? todo.completed) ? 0.6 : 1,
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

                      {/* 笔记视图：只放标题——这天写的最多两条（可拖到别的日子改创建日期），其余与「改过的」汇成一行小字；
                          具体时间和完整清单在左侧栏 */}
                      {viewMode === 'notes' && Array.isArray(itemsToDisplay) && (() => {
                        const createdNotes = itemsToDisplay.filter((item) => item.kind === 'created').map((item) => item.note);
                        const editedCount = itemsToDisplay.length - createdNotes.length;
                        const shown = createdNotes.slice(0, 2);
                        const more = createdNotes.length - shown.length;
                        const dark = theme.palette.mode === 'dark';
                        return (
                          <>
                            {shown.map((note) => {
                              const tint = note.note_type === 'whiteboard' ? '236, 72, 153' : '120,120,128';
                              return (
                                <Tooltip key={note.id} placement="top" disableInteractive
                                  title={`${getNoteDisplayTitle(note)} · ${formatClock(noteCreatedDate(note))}`}>
                                  <Box
                                    draggable
                                    onDragStart={(e) => {
                                      draggedNoteRef.current = note;
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('text/plain', String(note.id));
                                    }}
                                    onDragEnd={() => { draggedNoteRef.current = null; }}
                                    onClick={() => setPreviewNote(note)}
                                    sx={{
                                      px: 0.625, minHeight: 18, flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: '6px', cursor: 'grab',
                                      backgroundColor: `rgba(${tint}, ${dark ? 0.16 : 0.09})`,
                                      transition: createTransitionString(ANIMATIONS.listItem),
                                      '&:hover': { backgroundColor: `rgba(${tint}, ${dark ? 0.26 : 0.16})` },
                                      '&:active': { cursor: 'grabbing' },
                                    }}
                                  >
                                    <Typography variant="caption" noWrap sx={{ fontSize: '0.68rem', lineHeight: 1.2, color: 'text.primary' }}>
                                      {getNoteDisplayTitle(note)}
                                    </Typography>
                                  </Box>
                                </Tooltip>
                              );
                            })}
                            {(more > 0 || editedCount > 0) && (
                              <Tooltip placement="top" disableInteractive
                                title={[more > 0 && `还写了 ${more} 篇`, editedCount > 0 && `这天还改过 ${editedCount} 篇`].filter(Boolean).join('，')}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.25, flexShrink: 0, fontSize: '0.66rem', color: 'text.secondary', lineHeight: 1.3 }}>
                                  {more > 0 && <span>+{more}</span>}
                                  {editedCount > 0 && (
                                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: 'text.disabled' }}>
                                      <EditNoteOutlined sx={{ fontSize: 12 }} />{editedCount}
                                    </Box>
                                  )}
                                </Box>
                              </Tooltip>
                            )}
                          </>
                        );
                      })()}

                      {/* 专注视图：只写一个简短的时长，下面一行待办完成数；没有数据的日子什么都不画 */}
                      {viewMode === 'focus' && itemsToDisplay?.type === 'focus' && (itemsToDisplay.focusTimeSeconds > 0 || itemsToDisplay.todosTotal > 0) && (
                        <Box sx={{ px: 0.25, pt: 0.25 }}>
                          {itemsToDisplay.focusTimeSeconds > 0 && (
                            <Typography sx={{
                              fontSize: '1.05rem', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.01em',
                              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                              color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.dark,
                            }}>
                              {formatFocusShort(itemsToDisplay.focusTimeSeconds).value}
                              <Box component="span" sx={{ fontSize: '0.62rem', fontWeight: 500, ml: 0.25, opacity: 0.8 }}>
                                {formatFocusShort(itemsToDisplay.focusTimeSeconds).unit}
                              </Box>
                            </Typography>
                          )}
                          {itemsToDisplay.todosTotal > 0 && (
                            <Typography sx={{
                              mt: 0.25, fontSize: '0.66rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                              color: itemsToDisplay.todosCompleted === itemsToDisplay.todosTotal ? 'success.main' : 'text.secondary',
                            }}>
                              {itemsToDisplay.todosCompleted === itemsToDisplay.todosTotal ? '✓ ' : ''}完成 {itemsToDisplay.todosCompleted}/{itemsToDisplay.todosTotal}
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
                    color: theme.palette.secondary.main,
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
                              note.type === 'whiteboard' ? '画布' : '笔记'}
                          {' · '}
                          {(parseNoteDate(note.created_at) || new Date(NaN)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          {note.updated_at && note.updated_at !== note.created_at && (
                            <> (更新于 {(parseNoteDate(note.updated_at) || new Date(NaN)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})</>
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
        slotProps={{
          paper: {
            sx: {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(31,31,34, 0.96)'
                : 'rgba(255, 255, 255, 0.98)',
              maxHeight: '80vh',
              boxShadow: theme.palette.mode === 'dark'
                ? '0 14px 36px rgba(0, 0, 0, 0.34)'
                : '0 14px 36px rgba(22,22,24, 0.13)'
            }
          },
          backdrop: {
            sx: {
              backgroundColor: 'rgba(0, 0, 0, 0.34)'
            }
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
              label={previewNote?.note_type === 'whiteboard' ? '画布笔记' : 'Markdown'}
              size="small"
              sx={{
                backgroundColor: previewNote?.note_type === 'whiteboard'
                  ? 'rgba(236, 72, 153, 0.2)'
                  : 'rgba(120,120,128, 0.2)',
                color: previewNote?.note_type === 'whiteboard'
                  ? 'rgb(236, 72, 153)'
                  : 'rgb(120,120,128)',
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
              创建时间: {previewNote?.created_at ? (parseNoteDate(previewNote.created_at) || new Date(NaN)).toLocaleString('zh-CN') : '未知'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              更新时间: {previewNote?.updated_at ? (parseNoteDate(previewNote.updated_at) || new Date(NaN)).toLocaleString('zh-CN') : '未知'}
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
