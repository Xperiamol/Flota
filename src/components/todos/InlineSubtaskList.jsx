import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, LinearProgress, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CheckCircleRounded as CompletedIcon,
  ExpandMoreRounded as ExpandIcon,
  RadioButtonUncheckedRounded as PendingIcon
} from '@mui/icons-material';

export const todoRowActionRevealSx = {
  '& .todo-row-action': {
    position: 'relative',
    isolation: 'isolate',
    minWidth: 28,
    minHeight: 28,
    pointerEvents: 'none',
    color: 'text.primary',
    border: 0,
    backgroundColor: 'transparent',
    boxShadow: 'none',
    transition: 'color 160ms ease',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: -12,
      zIndex: 0,
      borderRadius: '50%',
      backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.025),
      backdropFilter: 'blur(9px)',
      WebkitBackdropFilter: 'blur(9px)',
      maskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,0.96) 34%, rgba(0,0,0,0.62) 56%, rgba(0,0,0,0.2) 74%, transparent 90%)',
      WebkitMaskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,0.96) 34%, rgba(0,0,0,0.62) 56%, rgba(0,0,0,0.2) 74%, transparent 90%)',
      opacity: 0,
      transform: 'none',
      pointerEvents: 'none',
      transition: 'none'
    },
    '& > svg, & > .MuiCircularProgress-root': {
      zIndex: 1,
      opacity: 0,
      scale: 0.84,
      translate: '0 2px',
      transition: 'opacity 150ms ease, scale 220ms cubic-bezier(0.22,1,0.36,1), translate 220ms cubic-bezier(0.22,1,0.36,1), color 180ms ease',
      filter: (theme) => theme.palette.mode === 'dark'
        ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))'
        : 'drop-shadow(0 1px 1px rgba(28,43,65,0.2))'
    },
    '& > svg': {
      position: 'relative'
    },
    '& > .MuiCircularProgress-root': {
      position: 'absolute'
    }
  },
  '&:hover .todo-row-action, &:focus-within .todo-row-action': {
    pointerEvents: 'auto'
  },
  '&:hover .todo-row-action > svg, &:hover .todo-row-action > .MuiCircularProgress-root, &:focus-within .todo-row-action > svg, &:focus-within .todo-row-action > .MuiCircularProgress-root': {
    opacity: 1,
    scale: 1,
    translate: '0 0'
  },
  '&:hover .todo-row-action::before, &:focus-within .todo-row-action::before': {
    opacity: 0.96,
    transform: 'none'
  },
  '&:hover .todo-row-action:hover, &:focus-within .todo-row-action:hover': {
    color: 'primary.main',
    backgroundColor: 'transparent'
  },
  '@media (hover: none)': {
    '& .todo-row-action': {
      pointerEvents: 'auto'
    },
    '& .todo-row-action > svg, & .todo-row-action > .MuiCircularProgress-root': {
      opacity: 1,
      scale: 1,
      translate: '0 0'
    },
    '& .todo-row-action::before': {
      display: 'none'
    }
  },
  '@media (prefers-reduced-motion: reduce)': {
    '& .todo-row-action, & .todo-row-action::before, & .todo-row-action > svg, & .todo-row-action > .MuiCircularProgress-root': {
      transition: 'none'
    }
  }
};

export const SubtaskExpandButton = React.memo(({
  subtasks = [],
  expanded = false,
  onToggle,
  size = 28
}) => {
  if (!subtasks.length) return null;

  const completedCount = subtasks.filter((subtask) => Boolean(subtask.is_completed)).length;
  const progress = Math.round((completedCount / subtasks.length) * 100);
  const title = expanded
    ? `收起子任务（${completedCount}/${subtasks.length}）`
    : `展开子任务（${completedCount}/${subtasks.length}）`;

  return (
    <Tooltip title={title} enterDelay={450}>
      <IconButton
        className="todo-row-action"
        size="small"
        aria-label={title}
        aria-expanded={expanded}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
        sx={{
          width: size,
          height: size,
          p: 0,
          position: 'relative',
          color: progress === 100 ? 'success.main' : 'text.secondary',
          '&:hover': { bgcolor: 'action.hover' }
        }}
      >
        <CircularProgress
          variant="determinate"
          value={100}
          size={size - 2}
          thickness={2.25}
          sx={{ position: 'absolute', color: 'action.selected' }}
        />
        <CircularProgress
          variant="determinate"
          value={progress}
          size={size - 2}
          thickness={2.25}
          sx={{
            position: 'absolute',
            color: progress === 100 ? 'success.main' : 'primary.main',
            transition: 'color 180ms ease',
            '& .MuiCircularProgress-circle': {
              transition: 'stroke-dashoffset 320ms cubic-bezier(0.32,0.72,0,1)'
            }
          }}
        />
        <ExpandIcon
          sx={{
            fontSize: size * 0.58,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 180ms cubic-bezier(0.32,0.72,0,1)'
          }}
        />
      </IconButton>
    </Tooltip>
  );
});

const InlineSubtaskList = ({
  subtasks = [],
  onToggle,
  busyIds = new Set(),
  compact = false,
  sx
}) => {
  const completedCount = subtasks.filter((subtask) => Boolean(subtask.is_completed)).length;
  const progress = subtasks.length > 0
    ? Math.round((completedCount / subtasks.length) * 100)
    : 0;
  const previousProgressRef = useRef(progress);
  const [displayProgress, setDisplayProgress] = useState(progress);

  useEffect(() => {
    const from = previousProgressRef.current;
    previousProgressRef.current = progress;
    if (from === progress || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplayProgress(progress);
      return undefined;
    }

    let frameId;
    const startedAt = performance.now();
    const tick = (now) => {
      const elapsed = Math.min(1, (now - startedAt) / 320);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setDisplayProgress(Math.round(from + (progress - from) * eased));
      if (elapsed < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [progress]);

  if (!subtasks.length) return null;

  return (
    <Box
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      sx={(theme) => ({
        mt: 0.375,
        mb: 0.75,
        ml: compact ? 1.25 : 1.5,
        mr: compact ? 0.75 : 1,
        minWidth: 0,
        ...(typeof sx === 'function' ? sx(theme) : sx)
      })}
    >
      <Box
        role="list"
        aria-label="子任务"
        sx={(theme) => ({
          minWidth: 0,
          overflow: 'hidden',
          borderRadius: '10px',
          border: `1px solid ${alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.1 : 0.075)}`,
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.3 : 0.52),
          backdropFilter: 'blur(12px) saturate(135%)',
          WebkitBackdropFilter: 'blur(12px) saturate(135%)',
          boxShadow: `inset 0 1px 0 ${alpha('#ffffff', theme.palette.mode === 'dark' ? 0.035 : 0.48)}`
        })}
      >
        {subtasks.map((subtask, index) => {
          const completed = Boolean(subtask.is_completed);
          const busy = busyIds.has(subtask.id);

          return (
            <Box
              key={subtask.id}
              role="listitem"
              tabIndex={0}
              onDoubleClick={(event) => {
                if (!event.target.closest('button')) onToggle?.(subtask);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggle?.(subtask);
                }
              }}
              sx={{
                display: 'grid',
                gridTemplateColumns: '26px minmax(0, 1fr)',
                alignItems: 'center',
                columnGap: 0.5,
                minHeight: compact ? 31 : 35,
                px: 0.75,
                borderTop: index === 0 ? 'none' : '1px solid',
                borderColor: 'divider',
                userSelect: 'none',
                outline: 'none',
                transition: 'background-color 160ms ease',
                '&:hover, &:focus-visible': { bgcolor: 'action.hover' }
              }}
            >
              <IconButton
                size="small"
                disabled={busy}
                aria-label={completed ? `取消完成子任务：${subtask.content}` : `完成子任务：${subtask.content}`}
                onClick={() => onToggle?.(subtask)}
                sx={{ width: 26, height: 26, p: 0 }}
              >
                {busy ? (
                  <CircularProgress size={14} thickness={5} />
                ) : completed ? (
                  <CompletedIcon sx={{ fontSize: 17, color: 'success.main' }} />
                ) : (
                  <PendingIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                )}
              </IconButton>

              <Typography
                variant="body2"
                title={subtask.content}
                noWrap
                sx={{
                  minWidth: 0,
                  fontSize: compact ? '0.76rem' : '0.8rem',
                  lineHeight: 1.25,
                  fontWeight: completed ? 500 : 550,
                  color: completed ? 'text.secondary' : 'text.primary',
                  textDecoration: completed ? 'line-through' : 'none',
                  opacity: completed ? 0.68 : 1
                }}
              >
                {subtask.content}
              </Typography>
            </Box>
          );
        })}

        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            minHeight: 20,
            px: 1,
            py: 0.5,
            borderTop: `1px solid ${alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.075 : 0.055)}`,
            bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.018 : 0.012)
          })}
        >
          <LinearProgress
            variant="determinate"
            value={progress}
            aria-label={`子任务进度 ${progress}%`}
            sx={{
              flex: 1,
              minWidth: 24,
              height: 3,
              borderRadius: 999,
              bgcolor: 'action.selected',
              '& .MuiLinearProgress-bar': {
                borderRadius: 999,
                bgcolor: progress === 100 ? 'success.main' : 'primary.main',
                transition: 'transform 320ms cubic-bezier(0.32,0.72,0,1), background-color 180ms ease'
              }
            }}
          />
          <Typography
            variant="caption"
            sx={{
              flexShrink: 0,
              color: progress === 100 ? 'success.main' : 'text.secondary',
              fontSize: '0.66rem',
              lineHeight: 1,
              fontWeight: 650,
              letterSpacing: '0.01em',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {completedCount}/{subtasks.length} · {displayProgress}%
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default React.memo(InlineSubtaskList);
