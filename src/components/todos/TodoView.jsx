import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '../../utils/i18n';
import {
  Box,
  Typography,
  Divider,
  useTheme,
  Card,
  CardContent,
  Menu,
  ListItemIcon,
  ListItemText,
  MenuItem
} from '@mui/material';
import MultiSelectToolbar from '../layout/MultiSelectToolbar';
import {
  CheckCircle as CheckCircleIcon,
  SelectAll as SelectAllIcon,
  Edit as EditIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { isToday, parseISO } from 'date-fns';
import TodoItem from './TodoItem';
import FocusModeView from './FocusModeView';
import {
  fetchTodosByQuadrant,
  fetchSubtasksForParents,
  toggleTodoComplete,
  deleteTodo as deleteTodoAPI,
  addTodoFocusTime
} from '../../api/todoAPI';
import { ANIMATIONS, createTransitionString } from '../../utils/animationConfig';
import useTodoDrag from '../../hooks/useTodoDrag';
import { useError } from '../common/ErrorProvider';
import { isTodoCompleted, isTodoOverdue, isFutureRecurringTodo } from '../../utils/todoDisplayUtils';
import { useStore } from '../../store/useStore';

const TodoView = ({ viewMode, showCompleted, onViewModeChange, onShowCompletedChange, onRefresh, onTodoSelect, refreshTrigger = 0 }) => {
  const { t } = useTranslation();
  const { showError } = useError();
  const theme = useTheme();
  const todoNavigationRequest = useStore((state) => state.todoNavigationRequest);
  const consumeTodoNavigationRequest = useStore((state) => state.consumeTodoNavigationRequest);
  const effectiveViewMode = viewMode === 'list' ? 'focus' : viewMode;
  const [todos, setTodos] = useState([]);
  const [subtasksByParent, setSubtasksByParent] = useState({});
  const [subtaskBusyIds, setSubtaskBusyIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [filterBy, setFilterBy] = useState('all'); // 'all', 'pending', 'completed', 'overdue', 'today'

  // 双击完成相关状态
  const [pendingComplete, setPendingComplete] = useState(new Set());
  const [celebratingTodos, setCelebratingTodos] = useState(new Set());

  // 多选相关状态
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedTodos, setSelectedTodos] = useState([]);
  const [contextMenuState, setContextMenuState] = useState(null);

  // 使用拖放 hook
  const {
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDropQuadrant,
    isDragOver
  } = useTodoDrag(() => {
    loadTodos();
    if (onRefresh) {
      onRefresh();
    }
  });

  const loadTodos = useCallback(async (options = {}) => {
    const { silent = true } = options;
    try {
      if (!silent) {
        setLoading(true);
      }
      const data = await fetchTodosByQuadrant(showCompleted);
      const nextTodos = data || {
        urgent_important: [],
        not_urgent_important: [],
        urgent_not_important: [],
        not_urgent_not_important: []
      };
      setTodos(nextTodos);

      const parentSyncIds = [...new Set(
        Object.values(nextTodos).flat().map((todo) => todo.sync_id).filter(Boolean)
      )];
      try {
        const rows = parentSyncIds.length > 0
          ? await fetchSubtasksForParents(parentSyncIds)
          : [];
        const grouped = {};
        (rows || []).forEach((subtask) => {
          if (!grouped[subtask.parent_todo_id]) grouped[subtask.parent_todo_id] = [];
          grouped[subtask.parent_todo_id].push(subtask);
        });
        setSubtasksByParent(grouped);
      } catch (subtaskError) {
        console.error('批量获取子任务失败:', subtaskError);
        setSubtasksByParent({});
      }
    } catch (error) {
      console.error('加载待办事项失败:', error);
      showError(error, '加载待办事项失败');
      setTodos([]);
      setSubtasksByParent({});
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [showCompleted, showError]);

  useEffect(() => {
    loadTodos({ silent: false });
  }, [loadTodos]);

  // 外部刷新触发器：确保侧栏/日历等位置更新后，主视图（四象限/专注）同步刷新。
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadTodos({ silent: true });
    }
  }, [refreshTrigger, loadTodos]);

  useEffect(() => {
    if (!todoNavigationRequest) return;

    const nextFilterBy = todoNavigationRequest.filterBy || 'all';
    setFilterBy(nextFilterBy);

    if (typeof todoNavigationRequest.showCompleted === 'boolean' && onShowCompletedChange) {
      onShowCompletedChange(todoNavigationRequest.showCompleted);
    }

    if (todoNavigationRequest.viewMode && onViewModeChange) {
      onViewModeChange(todoNavigationRequest.viewMode);
    }

    consumeTodoNavigationRequest();
  }, [todoNavigationRequest, onShowCompletedChange, onViewModeChange, consumeTodoNavigationRequest]);

  // 切换待办事项完成状态 - 支持双击完成
  const handleToggleTodo = async (todo) => {
    // 未来重复待办不可完成
    if (isFutureRecurringTodo(todo)) return;

    // 如果已经完成，直接切换状态
    if (isTodoCompleted(todo)) {
      try {
        await toggleTodoComplete(todo.id);
        loadTodos();
        if (onRefresh) {
          onRefresh();
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
          try {
            await toggleTodoComplete(todo.id);
            loadTodos();
            if (onRefresh) {
              onRefresh();
            }
          } catch (err) {
            console.error('更新待办事项失败:', err);
            showError(err, '更新待办事项失败');
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
  };

  const completeTodoInstantly = async (todo) => {
    if (!todo) return;
    if (isFutureRecurringTodo(todo)) return;
    try {
      await toggleTodoComplete(todo.id);
      await loadTodos();
      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('更新待办事项失败:', error);
      showError(error, '更新待办事项失败');
      throw error;
    }
  };

  const handleToggleSubtask = async (parentSyncId, subtask) => {
    if (!parentSyncId || subtaskBusyIds.has(subtask.id)) return;
    const previousCompleted = subtask.is_completed;
    const nextCompleted = !Boolean(previousCompleted);
    const currentSubtasks = subtasksByParent[parentSyncId] || [];
    const nextSubtasks = currentSubtasks.map((item) => (
      item.id === subtask.id ? { ...item, is_completed: nextCompleted ? 1 : 0 } : item
    ));
    const visibleTodos = Array.isArray(todos) ? todos : Object.values(todos || {}).flat();
    const parentTodo = visibleTodos.find((todo) => todo.sync_id === parentSyncId);
    const allSubtasksCompleted = nextSubtasks.length > 0
      && nextSubtasks.every((item) => Boolean(item.is_completed));

    setSubtaskBusyIds((current) => new Set(current).add(subtask.id));
    setSubtasksByParent((current) => ({
      ...current,
      [parentSyncId]: nextSubtasks
    }));

    try {
      const updated = await toggleTodoComplete(subtask.id);
      if (updated) {
        setSubtasksByParent((current) => ({
          ...current,
          [parentSyncId]: (current[parentSyncId] || []).map((item) => (
            item.id === subtask.id ? { ...item, ...updated } : item
          ))
        }));
      }

      const parentCompleted = parentTodo ? isTodoCompleted(parentTodo) : false;
      const shouldSyncParent = parentTodo
        && !isFutureRecurringTodo(parentTodo)
        && parentCompleted !== allSubtasksCompleted;

      if (shouldSyncParent) {
        if (allSubtasksCompleted) {
          setCelebratingTodos((current) => new Set([...current, parentTodo.id]));
          await new Promise((resolve) => setTimeout(resolve, 360));
        }

        try {
          await toggleTodoComplete(parentTodo.id);
          await loadTodos();
        } catch (parentError) {
          console.error('同步主任务完成状态失败:', parentError);
          showError(parentError, '同步主任务完成状态失败');
        } finally {
          if (allSubtasksCompleted) {
            setTimeout(() => {
              setCelebratingTodos((current) => {
                const next = new Set(current);
                next.delete(parentTodo.id);
                return next;
              });
            }, 1000);
          }
        }
      }

      onRefresh?.();
    } catch (error) {
      setSubtasksByParent((current) => ({
        ...current,
        [parentSyncId]: (current[parentSyncId] || []).map((item) => (
          item.id === subtask.id ? { ...item, is_completed: previousCompleted } : item
        ))
      }));
      showError(error, '更新子任务失败');
    } finally {
      setSubtaskBusyIds((current) => {
        const next = new Set(current);
        next.delete(subtask.id);
        return next;
      });
    }
  };

  const handleFocusTimeLogged = useCallback((updatedTodo) => {
    if (!updatedTodo || !updatedTodo.id) return;

    setTodos((prev) => {
      if (!prev) return prev;

      if (Array.isArray(prev)) {
        return prev.map((todo) => (todo.id === updatedTodo.id ? { ...todo, ...updatedTodo } : todo));
      }

      if (prev && typeof prev === 'object') {
        const next = {};
        Object.keys(prev).forEach((key) => {
          next[key] = prev[key].map((todo) => (todo.id === updatedTodo.id ? { ...todo, ...updatedTodo } : todo));
        });
        return next;
      }

      return prev;
    });

    if (onRefresh) {
      onRefresh();
    }
  }, [onRefresh]);

  // 删除待办事项
  const handleDeleteTodo = async (id) => {
    try {
      const success = await deleteTodoAPI(id);
      if (success) {
        loadTodos();
        if (onRefresh) {
          onRefresh();
        }
      }
    } catch (error) {
      console.error('删除待办事项失败:', error);
      showError(error, '删除待办事项失败');
    }
  };
  // 渲染单个待办事项
  const renderTodoItem = (todo) => {
    return (
      <TodoItem
        key={todo.id}
        todo={{
          ...todo,
          completed: isTodoCompleted(todo),
          quadrant: todo.is_important && todo.is_urgent ? 1 :
            todo.is_important ? 2 :
              todo.is_urgent ? 3 : 4
        }}
        onToggleComplete={() => handleToggleTodo(todo)}
        variant="quadrant"
        showSecondaryInfo={true}
        compact={false}
        pendingComplete={pendingComplete}
        celebratingTodos={celebratingTodos}
        subtasks={subtasksByParent[todo.sync_id] || []}
        subtaskBusyIds={subtaskBusyIds}
        onToggleSubtask={(subtask) => handleToggleSubtask(todo.sync_id, subtask)}
        isMultiSelectMode={multiSelectMode}
        isSelected={selectedTodos.includes(todo.id)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={(_, todo) => {
          if (multiSelectMode) {
            // 多选模式下的点击处理
            if (selectedTodos.includes(todo.id)) {
              setSelectedTodos(selectedTodos.filter(id => id !== todo.id));
            } else {
              setSelectedTodos([...selectedTodos, todo.id]);
            }
          } else {
            // 正常模式下的点击处理：打开详情对话框
            if (onTodoSelect) {
              onTodoSelect(todo);
            }
          }
        }}
        onContextMenu={(e, targetTodo) => {
          e.preventDefault();
          setContextMenuState({
            mouseX: e.clientX + 2,
            mouseY: e.clientY - 6,
            todo: targetTodo
          });
        }}
      />
    );
  };

  const handleCloseContextMenu = () => {
    setContextMenuState(null);
  };

  // 四象限配置 - 缓存避免每次渲染重新创建
  const quadrants = useMemo(() => {
    if (!todos || typeof todos !== 'object') return [];
    return [
      {
        key: 'urgent_important',
        title: t('quadrant.urgentImportant'),
        subtitle: t('quadrant.urgentImportantDesc'),
        color: '#f44336',
        todos: todos.urgent_important || [],
        isImportant: true,
        isUrgent: true
      },
      {
        key: 'not_urgent_important',
        title: t('quadrant.importantNotUrgent'),
        subtitle: t('quadrant.importantNotUrgentDesc'),
        color: '#ff9800',
        todos: todos.not_urgent_important || [],
        isImportant: true,
        isUrgent: false
      },
      {
        key: 'urgent_not_important',
        title: t('quadrant.urgentNotImportant'),
        subtitle: t('quadrant.urgentNotImportantDesc'),
        color: '#2196f3',
        todos: todos.urgent_not_important || [],
        isImportant: false,
        isUrgent: true
      },
      {
        key: 'not_urgent_not_important',
        title: t('quadrant.neitherUrgentNorImportant'),
        subtitle: t('quadrant.neitherUrgentNorImportantDesc'),
        color: '#9e9e9e',
        todos: todos.not_urgent_not_important || [],
        isImportant: false,
        isUrgent: false
      }
    ];
  }, [todos, t]);

  // 专注视图过滤后的待办 - 缓存避免每次渲染重新过滤
  const focusFilteredTodos = useMemo(() => {
    const flattenTodos = Array.isArray(todos)
      ? todos
      : todos && typeof todos === 'object'
        ? Object.values(todos).flat()
        : [];

    return flattenTodos.filter((todo) => {
      const completed = isTodoCompleted(todo);
      if (filterBy === 'pending') return !completed;
      if (filterBy === 'completed') return completed;
      if (filterBy === 'overdue') return isTodoOverdue(todo);
      if (filterBy === 'today') return todo.due_date && isToday(parseISO(todo.due_date));
      return true;
    });
  }, [todos, filterBy]);

  // 渲染四象限视图 - 精致 2×2 布局
  const renderQuadrantView = () => {
    if (quadrants.length === 0) return null;
    const dark = theme.palette.mode === 'dark';

    return (
      <Box sx={{ width: '100%', maxWidth: '1200px', mx: 'auto' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 2,
            height: { xs: '560px', md: '680px' },
            maxHeight: { xs: '560px', md: '680px' },
          }}
        >
            {quadrants.map((quadrant) => (
              <Box
                key={quadrant.key}
                onDragOver={(e) => handleDragOver(e, quadrant.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropQuadrant(e, {
                  isImportant: quadrant.isImportant,
                  isUrgent: quadrant.isUrgent
                })}
                sx={{ minHeight: 0 }}
              >
                <Card
                  elevation={0}
                  sx={{
                    height: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '16px',
                    backgroundColor: theme.custom?.surface?.glassLight,
                    backgroundImage: `linear-gradient(180deg, ${quadrant.color}${dark ? '0d' : '08'} 0%, transparent 34%)`,
                    backdropFilter: theme.custom?.glass?.backdropFilter,
                    WebkitBackdropFilter: theme.custom?.glass?.backdropFilter,
                    border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
                    transition: createTransitionString(ANIMATIONS.hover),
                    overflow: 'hidden',
                    '&:hover': {
                      boxShadow: dark
                        ? '0 6px 18px rgba(0,0,0,0.18)'
                        : '0 6px 18px rgba(15,23,42,0.07)',
                      borderColor: `${quadrant.color}35`,
                    },
                    ...(isDragOver(quadrant.key) && {
                      border: `2px dashed ${quadrant.color}`,
                      boxShadow: `0 0 0 3px ${quadrant.color}12`,
                      backgroundColor: dark ? `${quadrant.color}14` : `${quadrant.color}0d`,
                    })
                  }}
                >
                  {/* 简洁头部 */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, pt: 1.75, pb: 1.5 }}>
                    <Box sx={{
                      width: 3,
                      height: 28,
                      borderRadius: 999,
                      flexShrink: 0,
                      bgcolor: quadrant.color,
                      opacity: dark ? 0.78 : 0.9,
                      boxShadow: `0 0 12px ${quadrant.color}24`
                    }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 750, color: 'text.primary', lineHeight: 1.25, letterSpacing: '-0.01em' }}>
                        {quadrant.title}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'text.secondary', lineHeight: 1.2, fontSize: '0.68rem' }}>
                        {quadrant.subtitle}
                      </Typography>
                    </Box>
                    <Box
                      aria-label={`${quadrant.todos.length} 项待办`}
                      sx={{
                        minWidth: 28,
                        height: 28,
                        px: 0.75,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '9px',
                        border: `1px solid ${quadrant.color}20`,
                        fontWeight: 750,
                        fontSize: '0.72rem',
                        bgcolor: `${quadrant.color}${dark ? '12' : '0b'}`,
                        color: quadrant.color,
                      }}
                    >
                      {quadrant.todos.length}
                    </Box>
                  </Box>

                  <CardContent sx={{ flex: 1, minHeight: 0, pt: 0, pb: '14px !important', px: 1.5, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {quadrant.todos.length === 0 ? (
                      <Box
                        sx={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          opacity: 0.44,
                        }}
                      >
                        <Box sx={{ width: 28, height: 2, mb: 1, borderRadius: 999, bgcolor: `${quadrant.color}70` }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: '0.02em' }}>
                            {t('quadrant.empty')}
                          </Typography>
                      </Box>
                    ) : (
                      <Box
                        sx={{
                          flex: 1,
                          minHeight: 0,
                          overflowY: 'auto',
                          overflowX: 'hidden',
                          pr: 0.35,
                          scrollbarWidth: 'thin',
                          scrollbarColor: `${quadrant.color}28 transparent`,
                          '&::-webkit-scrollbar': { width: 5 },
                          '&::-webkit-scrollbar-track': { background: 'transparent' },
                          '&::-webkit-scrollbar-thumb': {
                            borderRadius: 999,
                            backgroundColor: `${quadrant.color}24`
                          },
                          '&:hover::-webkit-scrollbar-thumb': {
                            backgroundColor: `${quadrant.color}40`
                          }
                        }}
                      >
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.625 }}>
                          {quadrant.todos.map(renderTodoItem)}
                        </Box>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Box>
            ))}
          </Box>
      </Box>
    );
  };

  // 渲染专注视图
  const renderFocusView = () => {
    return (
      <FocusModeView
        todos={focusFilteredTodos}
        loading={loading}
        onToggleComplete={completeTodoInstantly}
        onLogFocusTime={addTodoFocusTime}
        onTodoUpdated={handleFocusTimeLogged}
      />
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
        <Typography color="text.secondary">加载中...</Typography>
      </Box>
    );
  }

  // 处理多选操作
  const handleMultiSelectComplete = async () => {
    try {
      const allTodos = Array.isArray(todos) ? todos : Object.values(todos).flat();
      for (const todoId of selectedTodos) {
        const todo = allTodos.find(t => t.id === todoId);
        if (todo && isFutureRecurringTodo(todo)) continue;
        await toggleTodoComplete(todoId);
      }
      loadTodos();
      if (onRefresh) {
        onRefresh();
      }
      setMultiSelectMode(false);
      setSelectedTodos([]);
    } catch (error) {
      console.error('批量完成待办事项失败:', error);
      showError(error, '批量完成失败');
    }
  };

  const handleMultiSelectDelete = async () => {
    try {
      for (const todoId of selectedTodos) {
        await deleteTodoAPI(todoId);
      }
      loadTodos();
      if (onRefresh) {
        onRefresh();
      }
      setMultiSelectMode(false);
      setSelectedTodos([]);
    } catch (error) {
      console.error('批量删除待办事项失败:', error);
      showError(error, '批量删除失败');
    }
  };

  // 计算todos总数
  const getTotalTodosCount = () => {
    if (Array.isArray(todos)) {
      return todos.length;
    }
    if (todos && typeof todos === 'object') {
      return Object.values(todos).flat().length;
    }
    return 0;
  };

  // 获取所有todoIds用于全选
  const getAllTodoIds = () => {
    if (Array.isArray(todos)) {
      return todos.map(todo => todo.id);
    }
    if (todos && typeof todos === 'object') {
      return Object.values(todos).flat().map(todo => todo.id);
    }
    return [];
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 多选工具栏 */}
      <MultiSelectToolbar
        visible={multiSelectMode}
        selectedCount={selectedTodos.length}
        totalCount={getTotalTodosCount()}
        itemType="待办事项"
        onSelectAll={() => setSelectedTodos(getAllTodoIds())}
        onSelectNone={() => setSelectedTodos([])}
        onDelete={handleMultiSelectDelete}
        customActions={[
          {
            key: 'complete',
            label: '设为完成',
            onClick: handleMultiSelectComplete,
            icon: <CheckCircleIcon />,
          },
        ]}
        onClose={() => {
          setMultiSelectMode(false);
          setSelectedTodos([]);
        }}
      />

      {/* 主内容区域 */}
      <Box sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        {effectiveViewMode === 'quadrant' ? renderQuadrantView() : renderFocusView()}
      </Box>

      <Menu
        open={Boolean(contextMenuState)}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenuState ? { top: contextMenuState.mouseY, left: contextMenuState.mouseX } : undefined}
      >
        <MenuItem
          onClick={() => {
            if (contextMenuState?.todo?.id) {
              setMultiSelectMode(true);
              setSelectedTodos([contextMenuState.todo.id]);
            }
            handleCloseContextMenu();
          }}
          disabled={multiSelectMode || !contextMenuState?.todo?.id}
        >
          <ListItemIcon>
            <SelectAllIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('common.enterMultiSelect')}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (contextMenuState?.todo && onTodoSelect) {
              onTodoSelect(contextMenuState.todo);
            }
            handleCloseContextMenu();
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('common.edit')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={async () => {
            if (contextMenuState?.todo?.id) {
              await handleDeleteTodo(contextMenuState.todo.id);
            }
            handleCloseContextMenu();
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('common.delete')}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

// 创建待办事项弹窗组件
export default TodoView;
