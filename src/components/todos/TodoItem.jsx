import React, { useState } from 'react';
import {
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  IconButton,
  Typography,
  Chip,
  Box,
  Tooltip,
  Checkbox,
  Paper,
  Collapse
} from '@mui/material';
import {
  CheckCircle,
  Circle,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Repeat as RepeatIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  getPriorityFromQuadrant,
  getPriorityIcon,
  getPriorityColor,
  getPriorityText
} from '../../utils/priorityUtils';
import { ANIMATIONS, createAnimationString, createTransitionString, GREEN_SWEEP_KEYFRAMES } from '../../utils/animationConfig';
import { t } from '../../utils/i18n';
import { isRecurringTodo, isTodoCompleted, isTodoOverdue, isTodoDueToday, isFutureRecurringTodo } from '../../utils/todoDisplayUtils';
import InlineSubtaskList, { SubtaskExpandButton, todoRowActionRevealSx } from './InlineSubtaskList';

const COMPLETION_BUTTON_SIZE = 32;
const COMPLETION_ICON_SIZE = 22;
const completionSlotSx = {
  minWidth: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};
const completionButtonBaseSx = {
  width: COMPLETION_BUTTON_SIZE,
  height: COMPLETION_BUTTON_SIZE,
  p: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0
};
const completionIconSx = {
  fontSize: COMPLETION_ICON_SIZE,
  display: 'block'
};

/**
 * 获取Todo优先级颜色
 */
const getTodoPriorityColor = (todo) => {
  if (todo.quadrant === 1) return '#f44336'; // 紧急重要 - 红色
  if (todo.quadrant === 2) return '#ff9800'; // 重要不紧急 - 橙色
  if (todo.quadrant === 3) return '#2196f3'; // 紧急不重要 - 蓝色
  if (todo.quadrant === 4) return '#4caf50'; // 不紧急不重要 - 绿色
  return '#9e9e9e'; // 默认灰色
};

/**
 * 获取优先级标签
 */
const getPriorityLabel = (todo) => {
  const priority = getPriorityFromQuadrant(todo.is_important, todo.is_urgent);
  return {
    label: getPriorityText(priority),
    color: getPriorityColor(priority),
    icon: getPriorityIcon(priority)
  };
};

/**
 * 格式化时间显示
 */
const formatTime = (dateString) => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return format(date, 'HH:mm', { locale: zhCN });
  } catch (error) {
    return '';
  }
};

/**
 * 可复用的TodoItem组件
 * 支持不同的显示模式和交互方式
 */
const TodoItem = ({
  todo,
  onToggleComplete,
  onClick,
  onContextMenu,
  pendingComplete = new Set(),
  celebratingTodos = new Set(),
  isMultiSelectMode = false,
  isSelected = false,
  showSecondaryInfo = true,
  compact = false,
  variant = 'default', // 'default', 'calendar', 'mydaypanel', 'quadrant'
  onDragStart,
  onDragEnd,
  subtasks = [],
  subtaskBusyIds = new Set(),
  onToggleSubtask
}) => {
  const theme = useTheme();
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);

  // Schedule model: for recurring todos, derive completion state from due_date
  const isRecurring = isRecurringTodo(todo);
  const isCompleted = isTodoCompleted(todo);
  // due_date > today → 下一周期未到，不可提前完成
  const isFutureRecurring = isFutureRecurringTodo(todo);
  const hasInlineSubtasks = variant !== 'calendar' && subtasks.length > 0;

  // 优先级信息
  const priority = getPriorityLabel(todo);
  const dueTime = formatTime(todo.due_date);

  // 根据变体调整样式
  const getItemStyles = () => {
    const baseStyles = {
      py: compact ? 1 : 1.5,
      px: 2,
      position: 'relative',
      overflow: 'hidden',
      borderRadius: '12px', // Consistent border radius
      transition: 'background-color 0.18s cubic-bezier(0.32,0.72,0,1), box-shadow 0.18s cubic-bezier(0.32,0.72,0,1), opacity 0.18s cubic-bezier(0.32,0.72,0,1)',
      '&:hover': {
        backgroundColor: theme.palette.action.hover,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        zIndex: 1,
      },
      opacity: isCompleted ? 0.6 : 1
    };
    Object.assign(baseStyles, todoRowActionRevealSx);

    // 庆祝动画样式
    if (celebratingTodos.has(todo.id)) {
      baseStyles['&::before'] = {
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
      };
      Object.assign(baseStyles, GREEN_SWEEP_KEYFRAMES);
    }

    return baseStyles;
  };

  // 渲染完成状态图标
  const renderCompletionIcon = () => {
    if (hasInlineSubtasks) {
      return (
        <SubtaskExpandButton
          subtasks={subtasks}
          expanded={subtasksExpanded}
          onToggle={() => setSubtasksExpanded((current) => !current)}
          size={COMPLETION_BUTTON_SIZE}
        />
      );
    }

    // 未来重复周期：显示时钟图标，不可点击
    if (isFutureRecurring) {
      return (
        <Tooltip title="下一周期未到，暂不可完成">
          <IconButton className="todo-row-action" size="small" disabled sx={completionButtonBaseSx}>
            <ScheduleIcon sx={completionIconSx} />
          </IconButton>
        </Tooltip>
      );
    }

    const iconProps = {
      className: 'todo-row-action',
      size: "small",
      onClick: (e) => {
        e.stopPropagation();
        onToggleComplete(todo);
      },
      sx: {
        ...completionButtonBaseSx,
        color: isCompleted
          ? theme.palette.success.main
          : getTodoPriorityColor(todo),
        ...(pendingComplete.has(todo.id) && {
          filter: 'brightness(1.18)',
          boxShadow: `0 0 0 3px ${theme.palette.success.main}22`,
          transition: 'filter 120ms cubic-bezier(0.32,0.72,0,1), box-shadow 120ms cubic-bezier(0.32,0.72,0,1)'
        })
      }
    };

    // MyDayPanel 变体使用双击
    if (variant === 'mydaypanel') {
      iconProps.onDoubleClick = iconProps.onClick;
    }

    const icon = isCompleted ? <CheckCircle sx={completionIconSx} /> : <Circle sx={completionIconSx} />;

    return (
      <Tooltip title={isCompleted ? t('todos.uncompleteTodo') : t('todos.completeTodo')}>
        <IconButton {...iconProps}>
          {icon}
        </IconButton>
      </Tooltip>
    );
  };

  // TodoList 变体的复杂图标渲染
  const renderTodoListIcon = () => {
    if (hasInlineSubtasks) {
      return (
        <SubtaskExpandButton
          subtasks={subtasks}
          expanded={subtasksExpanded}
          onToggle={() => setSubtasksExpanded((current) => !current)}
          size={COMPLETION_BUTTON_SIZE}
        />
      );
    }

    // 未来重复周期：显示时钟图标，不可点击
    if (isFutureRecurring) {
      return (
        <Tooltip title="下一周期未到，暂不可完成">
          <IconButton className="todo-row-action" size="small" disabled sx={completionButtonBaseSx}>
            <ScheduleIcon sx={completionIconSx} />
          </IconButton>
        </Tooltip>
      );
    }

    return (
      <IconButton
        className="todo-row-action"
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onToggleComplete(todo);
        }}
        sx={{
          ...completionButtonBaseSx,
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
        {isCompleted ? (
          <CheckCircleIcon sx={{ ...completionIconSx, color: 'success.main' }} />
        ) : pendingComplete.has(todo.id) ? (
          <RadioButtonUncheckedIcon
            sx={{
              ...completionIconSx,
              color: 'warning.main',
              animation: createAnimationString(ANIMATIONS.pulse)
            }}
          />
        ) : celebratingTodos.has(todo.id) ? (
          <CheckCircleIcon
            sx={{
              ...completionIconSx,
              color: 'success.main',
              filter: 'drop-shadow(0 0 8px rgba(76, 175, 80, 0.6))'
            }}
          />
        ) : (
          <RadioButtonUncheckedIcon sx={{ ...completionIconSx, color: 'text.secondary' }} />
        )}
      </IconButton>
    );
  };

  // 渲染主要内容
  const renderContent = () => {
    return (
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: showSecondaryInfo ? 0.5 : 0 }}>
            <Typography
              variant="body2"
              sx={{
                textDecoration: isCompleted ? 'line-through' : 'none',
                color: isCompleted
                  ? theme.palette.text.disabled
                  : theme.palette.text.primary,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
            >
              {todo.content}
            </Typography>

            {showSecondaryInfo && (
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {isRecurring && (
                  <Chip
                    icon={<RepeatIcon sx={{ fontSize: '0.8rem !important' }} />}
                    size="small"
                    label={todo.repeat_type === 'daily' ? '每天' : todo.repeat_type === 'weekly' ? '每周' : todo.repeat_type === 'monthly' ? '每月' : '重复'}
                    sx={{
                      backgroundColor: `${theme.palette.primary.main}15`,
                      color: theme.palette.primary.main,
                      fontSize: '0.7rem',
                      height: 20,
                      '& .MuiChip-label': { px: 0.5 },
                      '& .MuiChip-icon': { ml: 0.5 }
                    }}
                  />
                )}
                <Chip
                  size="small"
                  label={priority.label}
                  sx={{
                    backgroundColor: `${priority.color}20`,
                    color: priority.color,
                    fontSize: '0.7rem',
                    height: 20,
                    '& .MuiChip-label': {
                      px: 1
                    }
                  }}
                />
              </Box>
            )}
          </Box>
        }
        secondary={
          showSecondaryInfo && dueTime && (
            <Typography
              variant="caption"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.7rem'
              }}
            >
              {dueTime}
            </Typography>
          )
        }
      />
    );
  };

  const renderInlineSubtasks = (inlineSx) => {
    if (!hasInlineSubtasks) return null;

    return (
      <Collapse in={subtasksExpanded} timeout={180} unmountOnExit>
        <InlineSubtaskList
          subtasks={subtasks}
          busyIds={subtaskBusyIds}
          onToggle={onToggleSubtask}
          compact={compact}
          sx={inlineSx}
        />
      </Collapse>
    );
  };

  // 根据变体选择不同的渲染方式
  if (variant === 'calendar') {
    // 日历视图的简化版本
    return (
      <Box
        onClick={() => onClick && onClick(todo)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          p: 0.5,
          borderRadius: 1,
          cursor: 'pointer',
          ...getItemStyles()
        }}
      >
        <Box sx={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
          {renderCompletionIcon()}
        </Box>
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            textDecoration: isCompleted ? 'line-through' : 'none',
            color: isCompleted ? theme.palette.text.disabled : theme.palette.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {todo.content}
        </Typography>
      </Box>
    );
  }

  if (variant === 'quadrant') {
    // 四象限视图的精致卡片
    const isOverdue = isTodoOverdue(todo);
    const isDueToday = isTodoDueToday(todo);
    const dark = theme.palette.mode === 'dark';

    return (
      <Paper
        draggable
        onDragStart={(e) => onDragStart && onDragStart(e, todo)}
        onDragEnd={(e) => onDragEnd && onDragEnd(e)}
        elevation={0}
        sx={{
          ...getItemStyles(),
          px: 1.5,
          py: 1.05,
          minHeight: 46,
          boxSizing: 'border-box',
          borderRadius: '10px',
          bgcolor: theme.custom?.surface?.control,
          border: `1px solid ${dark ? 'rgba(255,255,255,0.065)' : 'rgba(15,23,42,0.055)'}`,
          transition: createTransitionString(ANIMATIONS.hover),
          cursor: 'grab',
          '&:active': { cursor: 'grabbing', filter: 'brightness(0.97)' },
          '&:hover': {
            bgcolor: theme.custom?.surface?.controlHover || theme.palette.action.hover,
            borderColor: dark ? 'rgba(255,255,255,0.11)' : 'rgba(15,23,42,0.09)',
            boxShadow: dark ? '0 3px 10px rgba(0,0,0,0.22)' : '0 3px 10px rgba(15,23,42,0.055)'
          },
        }}
        onClick={(e) => onClick && onClick(e, todo)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, position: 'relative' }}>
          <Box sx={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
            {renderTodoListIcon()}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                textDecoration: isCompleted ? 'line-through' : 'none',
                color: isCompleted ? 'text.disabled' : 'text.primary',
                wordBreak: 'break-word',
                lineHeight: 1.38,
                fontSize: '0.84rem',
                letterSpacing: '-0.005em'
              }}
            >
              {todo.content}
            </Typography>
          </Box>
          {showSecondaryInfo && dueTime && (
            <Typography variant="caption" sx={{
              color: isOverdue ? 'error.main' : (isDueToday ? 'warning.main' : 'text.secondary'),
              fontSize: '0.68rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              opacity: isOverdue || isDueToday ? 0.9 : 0.72,
            }}>
              {dueTime}
            </Typography>
          )}
        </Box>
        {renderInlineSubtasks({ mx: 0, ml: 0, mt: 0.75, mb: 0 })}
      </Paper>
    );
  }

  // 默认的 ListItem 渲染
  const content = (
    <>
      {isMultiSelectMode && (
        <ListItemIcon sx={{ minWidth: 40 }}>
          <Checkbox
            checked={isSelected}
            size="small"
            sx={{ p: 0.5 }}
          />
        </ListItemIcon>
      )}
      <ListItemIcon sx={{
        ...completionSlotSx,
        position: 'absolute',
        left: isMultiSelectMode ? 44 : 8,
        top: '50%',
        transform: 'translateY(-50%)',
        minWidth: 0,
        width: COMPLETION_BUTTON_SIZE,
        zIndex: 2
      }}>
        {variant === 'default' ? renderTodoListIcon() : renderCompletionIcon()}
      </ListItemIcon>
      {renderContent()}
    </>
  );

  // 如果有点击或右键菜单处理，使用 ListItemButton
  if (onClick || onContextMenu) {
    return (
      <ListItem sx={{ ...getItemStyles(), display: 'block' }}>
        <ListItemButton
          onClick={(e) => onClick && onClick(e, todo)}
          onContextMenu={(e) => onContextMenu && onContextMenu(e, todo)}
          sx={{ py: compact ? 1 : 1.5, position: 'relative' }}
        >
          {content}
        </ListItemButton>
        {renderInlineSubtasks()}
      </ListItem>
    );
  }

  // 简单的 ListItem
  return (
    <ListItem sx={{ ...getItemStyles(), display: 'block' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
        {content}
      </Box>
      {renderInlineSubtasks()}
    </ListItem>
  );
};

export default React.memo(TodoItem);
