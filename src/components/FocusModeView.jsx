import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Stack,
  LinearProgress,
  Fade,
  Alert,
  List,
  ListItem,
  ListItemText,
  ClickAwayListener,
  CircularProgress,
  Fab
} from '@mui/material';
import {
  PlayArrow as PlayArrowIcon,
  Pause as PauseIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  AccessTime as AccessTimeIcon,
  Flag as FlagIcon,
  TaskAlt as TaskAltIcon,
  List as ListIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { scrollbar } from '../styles/commonStyles';
import TimeZoneUtils from '../utils/timeZoneUtils';
import {
  getPriorityColor,
  getPriorityText,
  getPriorityFromQuadrant
} from '../utils/priorityUtils';
import { useStore } from '../store/useStore';
import { isTodoCompleted, isFutureRecurringTodo } from '../utils/todoDisplayUtils';

const LONG_PRESS_DURATION = 1200;

const clampIndex = (index, length) => {
  if (length === 0) return 0;
  const mod = index % length;
  return mod < 0 ? mod + length : mod;
};

const formatSeconds = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const hh = hrs > 0 ? `${String(hrs).padStart(2, '0')}:` : '';
  return `${hh}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
};

const FocusModeView = ({
  todos = [],
  loading = false,
  onToggleComplete,
  onLogFocusTime,
  onTodoUpdated
}) => {
  const normalizedTodos = useMemo(() => {
    return todos.map((todo) => {
      const completed = isTodoCompleted(todo);
      const focusSeconds = Number.isFinite(todo.focus_time_seconds)
        ? Number(todo.focus_time_seconds)
        : 0;
      const priorityKey = todo.priority || getPriorityFromQuadrant(todo.is_important, todo.is_urgent) || 'low';

      return {
        ...todo,
        completed,
        focus_time_seconds: focusSeconds,
        tags: toArray(todo.tags),
        priorityKey
      };
    });
  }, [todos]);

  const focusCandidates = useMemo(() => {
    const pending = normalizedTodos.filter((todo) => !todo.completed);
    return pending.length > 0 ? pending : normalizedTodos;
  }, [normalizedTodos]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isFocusing, setIsFocusing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [pressProgress, setPressProgress] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [showTodoList, setShowTodoList] = useState(false);
  const [rippleAnimating, setRippleAnimating] = useState(false);
  const [rippleDirection, setRippleDirection] = useState('expand'); // 'expand' or 'contract'
  const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });
  const [showFocusBackground, setShowFocusBackground] = useState(false); // 控制专注背景色

  // 获取系统主题色
  const { primaryColor } = useStore();

  const focusStartRef = useRef(null);
  const timerRef = useRef(null);
  const previousTodoIdRef = useRef(null);
  const pressAnimationRef = useRef(null);
  const rippleTimeoutRef = useRef(null);
  const buttonRef = useRef(null);

  const currentTodo = focusCandidates.length > 0 ? focusCandidates[clampIndex(activeIndex, focusCandidates.length)] : null;

  useEffect(() => {
    if (focusCandidates.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((prev) => clampIndex(prev, focusCandidates.length));
  }, [focusCandidates.length]);

  useEffect(() => {
    if (!isFocusing) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    timerRef.current = setInterval(() => {
      if (focusStartRef.current) {
        const elapsed = Math.round((Date.now() - focusStartRef.current) / 1000);
        setElapsedSeconds(elapsed);
      }
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isFocusing]);

  const stopSession = useCallback(
    async ({ persist = true, silent = false } = {}) => {
      if (!focusStartRef.current || !currentTodo) {
        setIsFocusing(false);
        setElapsedSeconds(0);
        setShowFocusBackground(false); // 重置背景色状态
        focusStartRef.current = null;
        return;
      }

      const durationSeconds = Math.max(1, Math.round((Date.now() - focusStartRef.current) / 1000));
      setIsFocusing(false);
      setElapsedSeconds(0);
      setShowFocusBackground(false); // 重置背景色状态
      focusStartRef.current = null;

      if (!persist || !onLogFocusTime) {
        return;
      }

      try {
        setIsSaving(true);
        const updatedTodo = await onLogFocusTime(currentTodo.id, durationSeconds);
        if (updatedTodo && onTodoUpdated) {
          onTodoUpdated(updatedTodo);
        }
        if (!silent) {
          setFeedback({ type: 'success', message: `已记录 ${formatSeconds(durationSeconds)} 专注时长` });
        }
      } catch (error) {
        const message = error?.message || '保存专注时长失败';
        setFeedback({ type: 'error', message });
      } finally {
        setIsSaving(false);
      }
    },
    [currentTodo, onLogFocusTime, onTodoUpdated]
  );

  useEffect(() => {
    if (!currentTodo) {
      previousTodoIdRef.current = null;
      return;
    }

    if (previousTodoIdRef.current && previousTodoIdRef.current !== currentTodo.id && isFocusing) {
      (async () => {
        await stopSession({ persist: true, silent: true });
      })();
    }

    previousTodoIdRef.current = currentTodo.id;
  }, [currentTodo, isFocusing, stopSession]);

  useEffect(() => () => {
    if (focusStartRef.current) {
      stopSession({ persist: true, silent: true });
    }
    if (pressAnimationRef.current) {
      cancelAnimationFrame(pressAnimationRef.current);
    }
    if (rippleTimeoutRef.current) {
      clearTimeout(rippleTimeoutRef.current);
    }
  }, [stopSession]);

  const handleStartFocus = () => {
    if (!currentTodo || isFocusing) return;
    
    // 获取按钮位置
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const containerRect = buttonRef.current.closest('.focus-container')?.getBoundingClientRect() || { left: 0, top: 0 };
      setButtonPosition({
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top + rect.height / 2 - containerRect.top
      });
    }
    
    focusStartRef.current = Date.now();
    setElapsedSeconds(0);
    setIsFocusing(true);
    setFeedback(null);
    
    // 触发扩散波纹动画
    setRippleDirection('expand');
    setRippleAnimating(true);
    
    // 波纹动画结束后保持背景色
    if (rippleTimeoutRef.current) {
      clearTimeout(rippleTimeoutRef.current);
    }
    rippleTimeoutRef.current = setTimeout(() => {
      setRippleAnimating(false);
      setShowFocusBackground(true); // 波纹结束后显示背景色
    }, 800); // 波纹动画0.8秒后结束
  };

  const handleStopFocus = async () => {
    // 立即隐藏背景色
    setShowFocusBackground(false);
    
    // 触发汇聚波纹动画
    setRippleDirection('contract');
    setRippleAnimating(true);
    
    // 动画完成后停止会话
    setTimeout(async () => {
      await stopSession({ persist: true, silent: false });
      setRippleAnimating(false);
      if (rippleTimeoutRef.current) {
        clearTimeout(rippleTimeoutRef.current);
      }
    }, 800); // 汇聚动画持续时间
  };

  const handleNext = () => {
    setActiveIndex((prev) => clampIndex(prev + 1, focusCandidates.length));
  };

  const handlePrev = () => {
    setActiveIndex((prev) => clampIndex(prev - 1, focusCandidates.length));
  };

  const startLongPress = () => {
    if (!currentTodo || isCompleting) return;
    setPressProgress(0);
    const startTime = Date.now();

    const step = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / LONG_PRESS_DURATION);
      setPressProgress(progress);

      if (progress >= 1) {
        // 确保进度完全达到100%
        setPressProgress(1);
        pressAnimationRef.current = null;
        // 使用setTimeout确保圆环动画完全完成后再触发完成
        setTimeout(() => {
          completeCurrentTodo();
        }, 16); // 约1帧的时间，确保UI更新
      } else {
        pressAnimationRef.current = requestAnimationFrame(step);
      }
    };

    pressAnimationRef.current = requestAnimationFrame(step);
  };

  const cancelLongPress = () => {
    if (pressAnimationRef.current) {
      cancelAnimationFrame(pressAnimationRef.current);
      pressAnimationRef.current = null;
    }
    setPressProgress(0);
  };

  const completeCurrentTodo = async () => {
    if (!currentTodo || !onToggleComplete) return;
    if (isFutureRecurringTodo(currentTodo)) return;
    cancelLongPress();
    setIsCompleting(true);
    setFeedback(null);
    try {
      if (isFocusing) {
        await stopSession({ persist: true, silent: true });
        setRippleAnimating(false);
      }
      await onToggleComplete(currentTodo);
      setFeedback({ type: 'success', message: '太棒了！任务已完成。' });
    } catch (error) {
      const message = error?.message || '完成任务失败';
      setFeedback({ type: 'error', message });
    } finally {
      setIsCompleting(false);
      setPressProgress(0);
    }
  };

  const renderMeta = () => {
    if (!currentTodo) return null;

    const chips = [];

    if (currentTodo.priorityKey) {
      const priorityColor = getPriorityColor(currentTodo.priorityKey) || '#1976d2';
      chips.push(
        <Chip
          key="priority"
          icon={<FlagIcon sx={{ fontSize: 14 }} />}
          label={getPriorityText(currentTodo.priorityKey)}
          size="small"
          sx={{
            backgroundColor: `${priorityColor}22`,
            color: priorityColor,
            fontSize: '0.7rem',
            height: 20
          }}
        />
      );
    }

    if (currentTodo.due_date) {
      const formatted = TimeZoneUtils.formatForDisplay(currentTodo.due_date, { shortFormat: true });
      
      if (formatted) {
        chips.push(
          <Chip
            key="due"
            icon={<AccessTimeIcon sx={{ fontSize: 14 }} />}
            label={formatted}
            size="small"
            sx={{ 
              fontSize: '0.7rem',
              height: 20
            }}
          />
        );
      }
    }

    currentTodo.tags.forEach((tag, index) => {
      chips.push(
        <Chip
          key={`tag-${index}`}
          label={`#${tag}`}
          size="small"
          sx={{ 
            fontSize: '0.7rem',
            height: 20
          }}
        />
      );
    });

    if (!chips.length) {
      return null;
    }

    return (
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent="center">
        {chips}
      </Stack>
    );
  };

  const totalFocusedSeconds = currentTodo
    ? (currentTodo.focus_time_seconds || 0) + (isFocusing ? elapsedSeconds : 0)
    : 0;

  return (
    <ClickAwayListener onClickAway={() => setShowTodoList(false)}>
      <Box 
        className="focus-container"
        sx={{ 
          height: '100%',
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: 4,
          px: 3,
          py: 4,
          fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
          position: 'relative',
          overflow: 'hidden',
          background: showFocusBackground ? (theme) => {
            // 专注状态时显示主题色背景
            const themeColor = primaryColor || '#1976d2';
            const hex = themeColor.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const opacity = theme.palette.mode === 'dark' ? 0.08 : 0.05;
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
          } : 'transparent',
          transition: 'background 0.3s ease',
          '&::before': rippleAnimating ? {
            content: '""',
            position: 'absolute',
            left: `${buttonPosition.x}px`,
            top: `${buttonPosition.y}px`,
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            background: (theme) => {
              // 使用系统设置的主题色
              const themeColor = primaryColor || '#1976d2';
              
              if (rippleDirection === 'contract') {
                // 停止/暂停状态使用错误色
                return theme.palette.mode === 'dark' 
                  ? 'rgba(244, 67, 54, 0.15)' 
                  : 'rgba(244, 67, 54, 0.12)';
              } else {
                // 开始状态使用主题色，转换为rgba格式
                const hex = themeColor.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                const opacity = theme.palette.mode === 'dark' ? 0.15 : 0.12;
                return `rgba(${r}, ${g}, ${b}, ${opacity})`;
              }
            },
            transform: rippleDirection === 'expand' 
              ? 'translate(-50%, -50%) scale(0)'
              : 'translate(-50%, -50%) scale(20)',
            animation: rippleDirection === 'expand' 
              ? 'rippleExpand 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards'
              : 'rippleContract 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards',
            '@keyframes rippleExpand': {
              '0%': {
                transform: 'translate(-50%, -50%) scale(0)',
                opacity: 1
              },
              '100%': {
                transform: 'translate(-50%, -50%) scale(20)',
                opacity: 0.3
              }
            },
            '@keyframes rippleContract': {
              '0%': {
                transform: 'translate(-50%, -50%) scale(20)',
                opacity: 0.3
              },
              '100%': {
                transform: 'translate(-50%, -50%) scale(0)',
                opacity: 0
              }
            }
          } : {}
        }}
      >
        {loading && (
          <LinearProgress
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%'
            }}
          />
        )}

        {/* 主要内容 */}
        <Stack spacing={4} alignItems="center" sx={{ zIndex: 1, maxWidth: 800, width: '100%' }}>
          {/* 当前待办标题 - 超大字体 */}
          {currentTodo ? (
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: '2.5rem', md: '3.5rem', lg: '4rem' },
                fontWeight: 300,
                textAlign: 'center',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                color: 'text.primary',
                wordBreak: 'break-word'
              }}
            >
              {currentTodo.content || currentTodo.title}
            </Typography>
          ) : (
            <Typography
              variant="h2"
              sx={{
                fontSize: { xs: '1.8rem', md: '2.5rem' },
                fontWeight: 300,
                textAlign: 'center',
                color: 'text.secondary',
                fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif'
              }}
            >
              没有需要专注的任务
            </Typography>
          )}

          {/* 待办详细信息 - 小字 */}
          {currentTodo && (
            <Stack 
              direction="row" 
              spacing={2} 
              flexWrap="wrap" 
              useFlexGap 
              justifyContent="center"
              sx={{ opacity: 0.7 }}
            >
              {currentTodo.priorityKey && (
                <Chip
                  icon={<FlagIcon sx={{ fontSize: '0.875rem' }} />}
                  label={getPriorityText(currentTodo.priorityKey)}
                  size="small"
                  sx={{
                    backgroundColor: `${getPriorityColor(currentTodo.priorityKey)}15`,
                    color: getPriorityColor(currentTodo.priorityKey),
                    fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                    fontSize: '0.75rem',
                    height: 24
                  }}
                />
              )}
              
              {currentTodo.due_date && (
                <Chip
                  icon={<AccessTimeIcon sx={{ fontSize: '0.875rem' }} />}
                label={TimeZoneUtils.formatForDisplay(currentTodo.due_date, { shortFormat: true })}
                  size="small"
                  sx={{
                    fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                    fontSize: '0.75rem',
                    height: 24
                  }}
                />
              )}
              
              {currentTodo.tags.map((tag, index) => (
                <Chip
                  key={index}
                  label={`#${tag}`}
                  size="small"
                  sx={{
                    fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                    fontSize: '0.75rem',
                    height: 24,
                    fontStyle: 'italic'
                  }}
                />
              ))}
            </Stack>
          )}

          {/* 专注时长显示 */}
          <Box sx={{ textAlign: 'center' }}>
            <Typography 
              variant="body2" 
              sx={{ 
                opacity: 0.6, 
                mb: 1,
                fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                fontSize: '0.875rem'
              }}
            >
              已累计专注
            </Typography>
            <Typography
              variant="h2"
              sx={{
                fontSize: { xs: '2.5rem', md: '3rem' },
                fontWeight: 200,
                fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                letterSpacing: '0.05em'
              }}
            >
              {formatSeconds(totalFocusedSeconds)}
            </Typography>
            {isFocusing && (
              <Typography 
                variant="body2" 
                color="primary" 
                sx={{ 
                  mt: 1, 
                  fontWeight: 500,
                  fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif'
                }}
              >
                {formatSeconds(elapsedSeconds)} 本次进行中
              </Typography>
            )}
          </Box>

          {/* 三个圆形按钮 */}
          <Stack direction="row" spacing={4} alignItems="center">
            {/* 开始/暂停按钮 */}
            <Fab
              ref={buttonRef}
              size="large"
              color={isFocusing ? 'error' : 'primary'}
              onClick={isFocusing ? handleStopFocus : handleStartFocus}
              disabled={!currentTodo || isSaving || isCompleting}
              sx={{
                width: 72,
                height: 72,
                fontSize: '1.5rem',
                boxShadow: (theme) => 
                  isFocusing 
                    ? `0 8px 32px ${theme.palette.error.main}40`
                    : `0 8px 32px ${theme.palette.primary.main}30`,
                transition: 'background-color 0.3s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.4,0,0.2,1), color 0.3s cubic-bezier(0.4,0,0.2,1)',
                '&:hover': {
                  transform: 'scale(1.05)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                }
              }}
            >
              {isFocusing ? <PauseIcon sx={{ fontSize: '2rem' }} /> : <PlayArrowIcon sx={{ fontSize: '2rem' }} />}
            </Fab>

            {/* 完成按钮 */}
            <Box 
              sx={{ position: 'relative' }}
              onMouseDown={startLongPress}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={startLongPress}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
            >
              <Fab
                size="large"
                color="success"
                disabled={!currentTodo || isCompleting}
                sx={{
                  width: 72,
                  height: 72,
                  fontSize: '1.5rem',
                  boxShadow: (theme) => `0 8px 32px ${theme.palette.success.main}30`,
                  transition: 'background-color 0.3s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.4,0,0.2,1)',
                  '&:hover': {
                    transform: 'scale(1.05)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  }
                }}
              >
                <TaskAltIcon sx={{ fontSize: '2rem' }} />
              </Fab>
              
              {/* 圆环进度 */}
              {pressProgress > 0 && (
                <CircularProgress
                  variant="determinate"
                  value={pressProgress * 100}
                  size={80}
                  thickness={3}
                  sx={{
                    position: 'absolute',
                    top: -4,
                    left: -4,
                    color: 'success.main',
                    transition: 'none', // 禁用默认transition，使用requestAnimationFrame控制
                    '& .MuiCircularProgress-circle': {
                      strokeLinecap: 'round',
                      transition: 'none', // 确保圆环也没有transition延迟
                    }
                  }}
                />
              )}
            </Box>

            {/* 待办列表按钮 */}
            <Fab
              size="large"
              color={showTodoList ? 'secondary' : 'default'}
              onClick={() => setShowTodoList(!showTodoList)}
              sx={{
                width: 72,
                height: 72,
                fontSize: '1.5rem',
                backgroundColor: showTodoList ? 'secondary.main' : 'action.hover',
                color: showTodoList ? 'secondary.contrastText' : 'text.primary',
                boxShadow: showTodoList 
                  ? (theme) => `0 8px 32px ${theme.palette.secondary.main}30`
                  : '0 4px 16px rgba(0,0,0,0.1)',
                transition: 'background-color 0.3s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.4,0,0.2,1), color 0.3s cubic-bezier(0.4,0,0.2,1)',
                '&:hover': {
                  transform: 'scale(1.05)',
                  backgroundColor: showTodoList ? 'secondary.main' : 'action.selected',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                }
              }}
            >
              <ListIcon sx={{ fontSize: '2rem' }} />
            </Fab>
          </Stack>
        </Stack>

        {/* 小的浮动待办列表窗口 */}
        {showTodoList && (
          <Fade in timeout={200}>
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: { xs: '90%', sm: 400 },
                maxHeight: '60vh',
                backgroundColor: (theme) => 
                  theme.palette.mode === 'dark' 
                    ? 'rgba(18, 18, 18, 0.95)' 
                    : 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(20px)',
                borderRadius: '8px',
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: (theme) => theme.shadows[10],
                overflow: 'hidden',
                zIndex: 3
              }}
            >
              <Box
                sx={{
                  p: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  backgroundColor: (theme) => 
                    theme.palette.mode === 'dark' 
                      ? 'rgba(255, 255, 255, 0.02)' 
                      : 'rgba(0, 0, 0, 0.02)'
                }}
              >
                <Typography 
                  variant="subtitle1" 
                  sx={{ 
                    fontWeight: 600,
                    fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                    textAlign: 'center'
                  }}
                >
                  待办任务列表 ({focusCandidates.length})
                </Typography>
              </Box>
              
              <Box sx={{ maxHeight: 'calc(60vh - 60px)', overflowX: 'hidden', overflowY: 'auto', ...scrollbar.auto }}>
                <List sx={{ py: 1, overflowX: 'hidden', width: '100%' }}>
                  {focusCandidates.length === 0 ? (
                    <ListItem>
                      <ListItemText
                        primary="暂无需要专注的任务"
                        secondary="何妨吟啸且徐行"
                        primaryTypographyProps={{
                          fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                          textAlign: 'center',
                          fontSize: '0.9rem'
                        }}
                        secondaryTypographyProps={{
                          fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                          textAlign: 'center',
                          fontSize: '0.8rem'
                        }}
                      />
                    </ListItem>
                  ) : (
                    focusCandidates.map((todo, index) => {
                      const isActive = currentTodo && todo.id === currentTodo.id;
                      return (
                        <ListItem
                          key={todo.id}
                          button
                          onClick={() => {
                            setActiveIndex(index);
                            setShowTodoList(false); // 选择后自动收起
                          }}
                          sx={{
                            backgroundColor: isActive ? 'action.selected' : 'transparent',
                            borderRadius: '8px',
                            mb: 0.5,
                            transition: 'background-color 0.2s ease, color 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            overflow: 'hidden',
                            px: 2,
                            mx: '12px',
                            width: 'calc(100% - 24px)',
                            boxSizing: 'border-box',
                            '&:hover': {
                              backgroundColor: 'action.hover'
                            }
                          }}
                        >
                          <Box
                            sx={{
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              backgroundColor: isActive ? 'primary.main' : 'action.hover',
                              color: isActive ? 'primary.contrastText' : 'text.secondary',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 600,
                              fontSize: '0.8rem',
                              mr: 1.5,
                              fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif'
                            }}
                          >
                            {index + 1}
                          </Box>
                          <ListItemText
                            primary={todo.content || todo.title}
                            secondary={
                              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                                <Chip
                                  label={getPriorityText(todo.priorityKey)}
                                  size="small"
                                  sx={{
                                    backgroundColor: `${getPriorityColor(todo.priorityKey)}15`,
                                    color: getPriorityColor(todo.priorityKey),
                                    height: 18,
                                    fontSize: '0.65rem',
                                    fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif'
                                  }}
                                />
                                <Typography 
                                  variant="caption" 
                                  sx={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: 0.5,
                                    fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                                    fontSize: '0.7rem'
                                  }}
                                >
                                  <AccessTimeIcon sx={{ fontSize: '0.7rem' }} />
                                  {formatSeconds(todo.focus_time_seconds || 0)}
                                </Typography>
                                {todo.completed && (
                                  <CheckCircleIcon 
                                    sx={{ 
                                      fontSize: '0.9rem', 
                                      color: 'success.main' 
                                    }} 
                                  />
                                )}
                              </Stack>
                            }
                            primaryTypographyProps={{
                              fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                              fontWeight: isActive ? 600 : 400,
                              color: isActive ? 'text.primary' : 'text.secondary',
                              fontSize: '0.9rem',
                              sx: {
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'normal',
                                overflowWrap: 'break-word',
                                wordBreak: 'break-word'
                              }
                            }}
                          />
                        </ListItem>
                      );
                    })
                  )}
                </List>
              </Box>
            </Box>
          </Fade>
        )}

        {/* 反馈提示 */}
        {feedback && (
          <Fade in timeout={250}>
            <Alert
              severity={feedback.type}
              onClose={() => setFeedback(null)}
              sx={{ 
                position: 'absolute',
                bottom: 20,
                left: '50%',
                transform: 'translateX(-50%)',
                maxWidth: 400,
                zIndex: showTodoList ? 2 : 4, // 确保在列表窗口下方
                fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif'
              }}
            >
              {feedback.message}
            </Alert>
          </Fade>
        )}
      </Box>
    </ClickAwayListener>
  );
};

export default React.memo(FocusModeView);
