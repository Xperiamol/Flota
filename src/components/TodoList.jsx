import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Divider,
  TextField,
  InputAdornment,
  Paper,
  Skeleton,
  Fade,
  Collapse,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  ToggleButtonGroup,
  ToggleButton,
  Checkbox
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
  Flag as FlagIcon,
  Sort as SortIcon,
  AccessTime as AccessTimeIcon,
  FlashOn as FlashOnIcon,
  FilterList as FilterListIcon,
  ViewList as ViewListIcon,
  ViewModule as ViewModuleIcon,
  Note as NoteIcon
} from '@mui/icons-material';
import { format, isToday, isPast, parseISO } from 'date-fns';
import { zhCN as dateFnsZhCN } from 'date-fns/locale';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useSearch } from '../hooks/useSearch';
import { useSearchManager } from '../hooks/useSearchManager';
import { useMultiSelectManager } from '../hooks/useMultiSelectManager';
import { useFiltersVisibility } from '../hooks/useFiltersVisibility';
import { searchTodosAPI } from '../api/searchAPI';
import { createNote } from '../api/noteAPI';
import FilterContainer from './FilterContainer';
import FilterToggleButton from './FilterToggleButton';
import DropdownMenu from './DropdownMenu';
import zhCN from '../locales/zh-CN';
import { t } from '../utils/i18n';

const {
  filters: { placeholder }
} = zhCN;
import {
  getPriorityFromQuadrant,
  getPriorityIcon,
  getPriorityColor,
  getPriorityText,
  comparePriority
} from '../utils/priorityUtils';
import { createDragHandler } from '../utils/DragManager'
import { useDragAnimation } from './DragAnimationProvider';
import {
  fetchTodosByPriority,
  fetchTodosByDueDate,
  fetchTodosByCreatedAt,
  toggleTodoComplete,
  deleteTodo as deleteTodoAPI
} from '../api/todoAPI';
import { ANIMATIONS, createAnimationString, createTransitionString, GREEN_SWEEP_KEYFRAMES } from '../utils/animationConfig';
import { useStore } from '../store/useStore';
import { isTodoCompleted, isFutureRecurringTodo } from '../utils/todoDisplayUtils';
import logger from '../utils/logger';

// 简单的 Web Audio API 铃铛声
const playChristmasBell = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const now = ctx.currentTime;

  const createOsc = (freq, delay) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + delay);

    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(0.3, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 1.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + delay);
    osc.stop(now + delay + 1.5);
  };

  // G5, B5, D6, G6 (G大调和弦)
  createOsc(783.99, 0);
  createOsc(987.77, 0.05);
  createOsc(1174.66, 0.1);
  createOsc(1567.98, 0.15);
};

const TodoList = ({ onTodoSelect, onViewModeChange, onShowCompletedChange, viewMode, showCompleted, onMultiSelectChange, onMultiSelectRefChange, refreshTrigger, sortBy, onSortByChange, externalTodos, isExternalData = false, onTodoUpdated }) => {
  const christmasMode = useStore((state) => state.christmasMode);
  const [todos, setTodos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedTodo, setSelectedTodo] = useState(null);
  const [filterBy, setFilterBy] = useState('all'); // all, urgent, important, normal, low
  
  // 添加ref防止重复加载
  const isLoadingRef = useRef(false);
  const todosRef = useRef([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 新增筛选状态
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedPriorities, setSelectedPriorities] = useState([]);

  // 保持 todos 的最新引用，供 loadTodos 判断是否已有数据
  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  // 双击完成相关状态
  const [pendingComplete, setPendingComplete] = useState(new Set());
  const [celebratingTodos, setCelebratingTodos] = useState(new Set());

  // 筛选器可见性状态
  const { filtersVisible, toggleFiltersVisibility } = useFiltersVisibility('todo_filters_visible');

  // 使用通用搜索hook
  const { search: searchTodos, isSearching } = useSearch({
    searchAPI: searchTodosAPI,
    onSearchResult: (results) => {
      // 直接设置搜索结果，不再应用过滤
      let filteredTodos = results;

      if (!showCompleted) {
        filteredTodos = filteredTodos.filter(todo => !todo.completed);
      }

      setTodos(filteredTodos);
    },
    onError: (error) => {
      console.error('Todo search error:', error);
    }
  });

  // 使用多选管理hook
  const multiSelect = useMultiSelectManager({
    items: todos,
    itemType: '待办事项',
    onMultiSelectChange,
    onMultiSelectRefChange
  })

  // 使用动画拖拽处理器 - 拖拽整个Todo列表
  const { createAnimatedDragHandler } = useDragAnimation()
  const dragHandler = createAnimatedDragHandler('todo', async (todoList) => {
    try {
      // 传递当前的todos列表作为参数
      await window.electronAPI.createTodoWindow({ todos: todoList })
    } catch (error) {
      console.error('创建Todo独立窗口失败:', error)
    }
  }, {
    onDragStart: (dragData) => {
      // 添加Todo拖拽开始时的自定义逻辑
      logger.log('Todo列表拖拽开始，添加视觉反馈');
    },
    onCreateWindow: (dragData) => {
      // Todo独立窗口创建成功后的回调
      logger.log('Todo独立窗口创建成功');
    }
  })

  // 定义loadTodos函数 - 将过滤排序逻辑内联，避免依赖循环
  const loadTodos = useCallback(async () => {
    // 防止重复加载
    if (isLoadingRef.current) {
      return;
    }
    
    isLoadingRef.current = true;
    // 如果已经有数据，避免切换到完整 loading UI，使用 isRefreshing 做背景刷新提示
    const shouldShowLoading = !(todosRef.current && todosRef.current.length > 0);
    if (shouldShowLoading) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    
    try {
      let rawTodos = [];
      
      // 如果使用外部数据，直接处理外部数据
      if (isExternalData && externalTodos) {
        rawTodos = [...externalTodos].map(todo => ({
          ...todo,
          completed: isTodoCompleted(todo),
          title: todo.content || todo.title,
          priority: todo.priority || getPriorityFromQuadrant(todo.is_important, todo.is_urgent),
          focus_time_seconds: (() => {
            const focusSeconds = Number(todo.focus_time_seconds ?? todo.focusSeconds ?? 0);
            return Number.isFinite(focusSeconds) ? focusSeconds : 0;
          })()
        }));
      } else {
        // 原有的数据加载逻辑
        let result;
        if (sortBy === 'priority') {
          result = await fetchTodosByPriority();
        } else if (sortBy === 'dueDate') {
          result = await fetchTodosByDueDate();
        } else {
          result = await fetchTodosByCreatedAt();
        }

        rawTodos = (result || []).map(todo => ({
          ...todo,
          completed: isTodoCompleted(todo),
          title: todo.content,
          priority: getPriorityFromQuadrant(todo.is_important, todo.is_urgent),
          focus_time_seconds: (() => {
            const focusSeconds = Number(todo.focus_time_seconds ?? todo.focusSeconds ?? 0);
            return Number.isFinite(focusSeconds) ? focusSeconds : 0;
          })()
        }));
      }

      // 应用过滤和排序 - 内联逻辑
      let filtered = rawTodos;

      // 根据完成状态筛选
      if (!showCompleted) {
        filtered = filtered.filter(todo => !todo.completed);
      }

      // 按优先级过滤
      if (filterBy !== 'all') {
        filtered = filtered.filter(todo => todo.priority === filterBy);
      }

      // 按新的优先级筛选过滤
      if (selectedPriorities.length > 0) {
        filtered = filtered.filter(todo => selectedPriorities.includes(todo.priority));
      }

      // 按标签过滤
      if (selectedTags.length > 0) {
        filtered = filtered.filter(todo => {
          if (!todo.tags) return false;
          const todoTags = Array.isArray(todo.tags) ? todo.tags : todo.tags.split(',').map(tag => tag.trim());
          return selectedTags.some(selectedTag => todoTags.includes(selectedTag));
        });
      }

      // 排序
      filtered.sort((a, b) => {
        switch (sortBy) {
          case 'priority':
            return comparePriority(a, b);
          case 'dueDate':
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return new Date(a.due_date) - new Date(b.due_date);
          case 'createdAt':
            return new Date(b.created_at) - new Date(a.created_at);
          default:
            return 0;
        }
      });

      setTodos(filtered);
    } catch (error) {
      console.error('加载待办事项失败:', error);
      setTodos([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isLoadingRef.current = false;
    }
  }, [isExternalData, externalTodos, showCompleted, sortBy, filterBy, selectedPriorities, selectedTags, refreshTrigger]);

  // 统一的数据加载effect
  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  // 创建稳定的回调函数，避免无限循环
  const stableSearchFunction = useCallback((query) => {
    searchTodos(query);
  }, [searchTodos]);

  const stableLoadFunction = useCallback(() => {
    loadTodos();
  }, [loadTodos]);

  // 使用搜索管理hook解决无限循环问题
  const { localSearchQuery, setLocalSearchQuery } = useSearchManager({
    searchFunction: stableSearchFunction,
    loadFunction: stableLoadFunction,
    searchCondition: {},
    debounceDelay: 300
  });

  // 监听刷新触发器
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadTodos();
    }
  }, [refreshTrigger, loadTodos]);

  const handleTodoClick = (todo) => {
    if (!multiSelect.isMultiSelectMode) {
      if (onTodoSelect) {
        onTodoSelect(todo);
      }
    }
  };

  const handleMenuClick = (event, todo) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedTodo(todo);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedTodo(null);
  };

  const handleToggleComplete = async (todo) => {
    // 未来重复待办不可完成
    if (isFutureRecurringTodo(todo)) return;

    // 如果已经完成，直接切换状态
    if (todo.completed) {
      try {
        await toggleTodoComplete(todo.id);
        loadTodos();
        // 如果有更新回调，触发它
        if (onTodoUpdated) {
          onTodoUpdated();
        }
      } catch (error) {
        console.error('更新待办事项失败:', error);
      }
      return;
    }

    // 未完成的任务需要双击
    if (pendingComplete.has(todo.id)) {
      // 第二次点击，执行完成操作
      try {
        // 先显示庆祝动画
        setCelebratingTodos(prev => new Set([...prev, todo.id]));

        if (christmasMode) {
          playChristmasBell();
        }

        // 延迟执行完成操作，让动画播放
        setTimeout(async () => {
          try {
            await toggleTodoComplete(todo.id);
            loadTodos();
            // 如果有更新回调，触发它
            if (onTodoUpdated) {
              onTodoUpdated();
            }
          } catch (err) {
            console.error('更新待办事项失败:', err);
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
  };

  const handleDelete = async () => {
    if (selectedTodo) {
      try {
        await deleteTodoAPI(selectedTodo.id);
        loadTodos();
        handleMenuClose();
        // 如果有更新回调，触发它
        if (onTodoUpdated) {
          onTodoUpdated();
        }
      } catch (error) {
        console.error('删除待办事项失败:', error);
      }
    }
  };

  const handleEdit = () => {
    if (selectedTodo && onTodoSelect) {
      onTodoSelect(selectedTodo);
      handleMenuClose();
    }
  };

  // 转换待办为笔记
  const handleConvertToNote = async () => {
    if (!selectedTodo) return;

    try {
      // 构建笔记内容 - 使用 content 字段而不是 title
      let noteContent = `# ${selectedTodo.content}\n\n`;

      if (selectedTodo.description) {
        noteContent += `${selectedTodo.description}\n\n`;
      }

      // 添加元数据
      noteContent += `---\n`;
      noteContent += `原待办事项信息：\n`;

      // 根据重要紧急程度显示优先级
      if (selectedTodo.is_important && selectedTodo.is_urgent) {
        noteContent += `- ${t('todos.urgentAndImportant')}\n`;
      } else if (selectedTodo.is_important) {
        noteContent += `- ${t('todos.importantNotUrgent')}\n`;
      } else if (selectedTodo.is_urgent) {
        noteContent += `- ${t('todos.urgentNotImportant')}\n`;
      } else {
        noteContent += `- ${t('todos.neitherUrgentNorImportant')}\n`;
      }

      if (selectedTodo.due_date) {
        noteContent += `- 截止日期：${formatDate(selectedTodo.due_date)}\n`;
      }
      if (selectedTodo.tags) {
        noteContent += `- 标签：${selectedTodo.tags}\n`;
      }

      // 创建笔记
      const noteData = {
        title: selectedTodo.content, // 使用待办内容作为笔记标题
        content: noteContent,
        note_type: 'markdown'
      };

      const result = await createNote(noteData);

      if (result) {
        // 删除原待办
        await deleteTodoAPI(selectedTodo.id);

        // 刷新待办列表
        loadTodos();

        logger.log('已转换为笔记:', result);
      }

      handleMenuClose();
    } catch (error) {
      console.error('转换为笔记失败:', error);
      showError(error, '转换失败');
    }
  };

  const handleClearSearch = () => {
    setLocalSearchQuery('');
  };

  // 优先级相关函数已移至 priorityUtils.js，这里直接使用导入的函数

  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      const date = parseISO(dateString);
      if (isToday(date)) {
        return t('common.today');
      }
      return format(date, 'MM月dd日', { locale: dateFnsZhCN });
    } catch (error) {
      return '';
    }
  };

  const isOverdue = (dateString) => {
    if (!dateString) return false;
    try {
      const date = parseISO(dateString);
      return isPast(date) && !isToday(date);
    } catch (error) {
      return false;
    }
  };



  const renderLoadingState = () => (
    <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: 200
    }}>
      <CircularProgress size={24} />
    </Box>
  );

  const renderEmptyState = () => (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: 200,
      color: 'text.secondary'
    }}>
      <ScheduleIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
      <Typography variant="body2">
        {localSearchQuery ? t('common.noResults') : t('todos.noTodos')}
      </Typography>
      {!localSearchQuery && (
        <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
          {t('todos.noTodosDesc')}
        </Typography>
      )}
    </Box>
  );

  return (
    <Box sx={(theme) => ({
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      // 当作为外部数据源（如 MyDayPanel）的子组件时，不添加背景，避免效果叠加
      ...(isExternalData ? {} : {
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(30, 41, 59, 0.85)'
          : 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)'
      })
    })}>
      {/* 搜索框和筛选区域 */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <TextField
          fullWidth
          size="small"
          placeholder={placeholder.searchTodos}
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: (
              <>
                {localSearchQuery && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={handleClearSearch}
                      sx={{ color: 'text.secondary' }}
                    >
                      <ClearIcon />
                    </IconButton>
                  </InputAdornment>
                )}
                {/* 排序按钮 */}
                <DropdownMenu
                  icon={<SortIcon />}
                  tooltip={t('common.sort')}
                  options={[
                    { value: 'priority', label: t('todos.sortByPriority'), icon: FlagIcon },
                    { value: 'dueDate', label: t('todos.sortByDueDate'), icon: ScheduleIcon },
                    { value: 'createdAt', label: t('todos.sortByCreated'), icon: AccessTimeIcon }
                  ]}
                  selectedValue={sortBy}
                  onSelect={onSortByChange}
                  size="small"
                  sx={{
                    ml: 1,
                    mr: 0.5,
                    fontSize: '0.8rem',
                    minWidth: 'auto',
                    width: 'auto'
                  }}
                />
                <FilterToggleButton
                  filtersVisible={filtersVisible}
                  onToggle={toggleFiltersVisibility}
                />
                {/* 后台刷新时在搜索框内显示小型指示器，避免遮挡列表 */}
                {isRefreshing && (
                  <CircularProgress size={18} sx={{ ml: 1, color: 'text.secondary' }} />
                )}
              </>
            )
          }}
        />

        {/* 筛选容器 */}
        <Collapse
          in={filtersVisible}
          timeout={200}
          easing={{
            enter: ANIMATIONS.dragTransition.easing,
            exit: 'cubic-bezier(0.55, 0.06, 0.68, 0.19)'
          }}
          sx={{
            '& .MuiCollapse-wrapper': {
              transition: createTransitionString(ANIMATIONS.dragTransition)
            }
          }}
        >
          <FilterContainer
            selectedTags={selectedTags}
            onTagsChange={setSelectedTags}
            selectedPriorities={selectedPriorities}
            onPrioritiesChange={setSelectedPriorities}
            showTagFilter={true}
            showPriorityFilter={true}
            isTodoFilter={true}
            sx={{ mt: 1 }}
          />
        </Collapse>
      </Box>

      {/* 待办事项列表 */}
      <Box
        sx={{ flex: 1, overflow: 'auto' }}
        onMouseDown={(e) => {
          // 只在非多选模式下且有待办事项时启用拖拽
          if (!multiSelect.isMultiSelectMode && todos.length > 0 && e.button === 0) {
            // 检查是否点击在列表项上，而不是在具体的按钮或输入框上
            const target = e.target;
            const isClickOnListArea = target.closest('.MuiList-root') &&
              !target.closest('.MuiIconButton-root') &&
              !target.closest('.MuiCheckbox-root') &&
              !target.closest('.MuiTextField-root');

            if (isClickOnListArea) {
              dragHandler.handleDragStart(e, todos)
            }
          }
        }}
      >
        {isLoading ? (
          renderLoadingState()
        ) : todos.length === 0 ? (
          renderEmptyState()
        ) : (
          <List sx={{ p: 0, overflow: 'visible' }}>
            {todos.map((todo) => (
              <Fade key={todo.id} in timeout={200}>
                <ListItem
                  disablePadding
                  sx={{
                    mb: 1,
                    position: 'relative',
                    overflow: 'visible'
                  }}
                >
                  <ListItemButton
                    onClick={(e) => multiSelect.handleClick(e, todo.id, () => handleTodoClick(todo))}
                    onContextMenu={(e) => multiSelect.handleContextMenu(e, todo.id, multiSelect.isMultiSelectMode)}
                    selected={multiSelect.isMultiSelectMode && multiSelect.isSelected(todo.id)}
                    sx={{
                      py: 0.6,
                      borderRadius: '12px',
                      border: '1px solid transparent',
                      backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.6)',
                      transition: 'background-color 0.2s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s cubic-bezier(0.4,0,0.2,1), border-color 0.2s cubic-bezier(0.4,0,0.2,1)',
                      position: 'relative',
                      overflow: 'hidden',
                      // 完成动画作用于按钮本身
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
                          zIndex: 0,
                          pointerEvents: 'none',
                          borderRadius: '12px'
                        },
                        ...GREEN_SWEEP_KEYFRAMES
                      }),
                      '&:hover': {
                        backgroundColor: (theme) => theme.palette.action.hover,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                        borderColor: (theme) => theme.palette.divider,
                        zIndex: 1,
                      },
                      '&.Mui-selected': {
                        backgroundColor: (theme) => theme.palette.primary.main + '1A',
                        borderColor: (theme) => theme.palette.primary.main + '33',
                        '&:hover': {
                          backgroundColor: (theme) => theme.palette.primary.main + '26'
                        }
                      }
                    }}
                  >
                    {multiSelect.isMultiSelectMode && (
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <Checkbox
                          checked={multiSelect.isSelected(todo.id)}
                          size="small"
                          sx={{ p: 0.5 }}
                        />
                      </ListItemIcon>
                    )}
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      {isFutureRecurringTodo(todo) ? (
                        <ScheduleIcon sx={{ color: 'text.disabled', opacity: 0.35 }} />
                      ) : (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleComplete(todo);
                        }}
                        sx={{
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
                          <CheckCircleIcon sx={{ color: 'success.main' }} />
                        ) : pendingComplete.has(todo.id) ? (
                          <RadioButtonUncheckedIcon
                            sx={{
                              color: 'warning.main',
                              animation: createAnimationString(ANIMATIONS.pulse)
                            }}
                          />
                        ) : celebratingTodos.has(todo.id) ? (
                          <CheckCircleIcon
                            sx={{
                              color: 'success.main',
                              filter: 'drop-shadow(0 0 8px rgba(76, 175, 80, 0.6))'
                            }}
                          />
                        ) : (
                          <RadioButtonUncheckedIcon sx={{ color: 'text.secondary' }} />
                        )}
                      </IconButton>
                      )}
                    </ListItemIcon>

                    <ListItemText
                      primary={
                        <Typography
                          variant="body2"
                          sx={{
                            textDecoration: todo.completed ? 'line-through' : 'none',
                            opacity: todo.completed ? 0.6 : 1
                          }}
                        >
                          {todo.title}
                        </Typography>
                      }
                      secondary={
                        <Box sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          mt: 0.5,
                          flexWrap: 'wrap',
                          maxWidth: 'calc(100% - 60px)' // 为右侧图标预留空间
                        }}>
                          <Chip
                            label={getPriorityText(todo.priority)}
                            size="small"
                            sx={{
                              backgroundColor: `${getPriorityColor(todo.priority)}20`,
                              color: getPriorityColor(todo.priority),
                              fontSize: '0.7rem',
                              height: 20
                            }}
                          />
                          {todo.due_date && (
                            <Chip
                              label={formatDate(todo.due_date)}
                              size="small"
                              sx={{
                                backgroundColor: isOverdue(todo.due_date) ? '#f4433620' : '#2196f320',
                                color: isOverdue(todo.due_date) ? '#f44336' : '#2196f3',
                                fontSize: '0.7rem',
                                height: 20
                              }}
                            />
                          )}
                          {todo.tags && todo.tags.split(',').filter(tag => tag.trim()).map((tag, index) => (
                            <Chip
                              key={index}
                              label={tag.trim()}
                              size="small"
                              sx={{
                                backgroundColor: '#9c27b020',
                                color: '#9c27b0',
                                fontSize: '0.7rem',
                                height: 20
                              }}
                            />
                          ))}
                        </Box>
                      }
                      secondaryTypographyProps={{ component: 'div' }}
                    />

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {getPriorityIcon(todo.priority)}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleMenuClick(e, todo);
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </Box>
                  </ListItemButton>
                </ListItem>
              </Fade>
            ))}
          </List>
        )}
      </Box>

      {/* 右键菜单 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: (theme) => ({
            backdropFilter: theme?.custom?.glass?.backdropFilter || 'blur(6px)',
            backgroundColor: theme?.custom?.glass?.background || (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.4)'),
            border: theme?.custom?.glass?.border || `1px solid ${theme.palette.divider}`,
            borderRadius: 1
          })
        }}
      >
        <MenuItem onClick={handleEdit}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('common.edit')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleConvertToNote}>
          <ListItemIcon>
            <NoteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('todos.convertToNote')}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleDelete}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('common.delete')}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default React.memo(TodoList);
