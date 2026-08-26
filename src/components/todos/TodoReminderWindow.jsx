import { useEffect, useMemo, useState } from 'react';
import { Box, Button, IconButton, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CheckRounded as CompleteIcon,
  CloseRounded as CloseIcon,
  OpenInNewRounded as OpenIcon,
  SnoozeRounded as SnoozeIcon
} from '@mui/icons-material';
import TimeZoneUtils from '../../utils/timeZoneUtils';

const TodoReminderWindow = ({ initialData = {} }) => {
  const [data, setData] = useState(initialData || {});
  const [pendingAction, setPendingAction] = useState(null);
  const todo = data?.todo || {};

  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background;
    const previousBodyBackground = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = previousHtmlBackground;
      document.body.style.background = previousBodyBackground;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.todoReminder?.onUpdate?.((payload) => {
      if (payload) setData(payload);
      setPendingAction(null);
    });
    return () => unsubscribe?.();
  }, []);

  const dueMeta = useMemo(() => {
    if (!todo?.due_date) return { label: '未设置截止时间', overdue: false };
    const overdue = TimeZoneUtils.isOverdue(todo.due_date);
    return {
      overdue,
      label: `${overdue ? '已逾期' : '截止'} · ${TimeZoneUtils.formatForDisplay(todo.due_date, { shortFormat: true })}`
    };
  }, [todo?.due_date]);

  const accent = todo?.is_urgent
    ? 'error.main'
    : todo?.is_important
      ? 'warning.main'
      : 'primary.main';

  const sendAction = async (type, extra = {}) => {
    if (!window.electronAPI?.todoReminder?.action || pendingAction) return;
    setPendingAction(type);
    try {
      await window.electronAPI.todoReminder.action({ type, ...extra });
    } catch {
      setPendingAction(null);
    }
  };

  return (
    <Box sx={{ width: '100vw', height: '100vh', boxSizing: 'border-box', p: 1, bgcolor: 'transparent' }}>
      <Paper
        elevation={0}
        onDoubleClick={() => sendAction('open')}
        sx={(theme) => ({
          position: 'relative',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          px: 1.5,
          py: 1.25,
          borderRadius: '16px',
          border: '1px solid',
          borderColor: theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.14)'
            : 'rgba(15,23,42,0.11)',
          bgcolor: theme.palette.mode === 'dark'
            ? 'rgba(17,25,40,0.93)'
            : 'rgba(250,252,255,0.94)',
          backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.075)}, transparent 58%)`,
          backdropFilter: 'blur(24px) saturate(165%)',
          WebkitBackdropFilter: 'blur(24px) saturate(165%)',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 14px 38px rgba(2,6,23,0.5), inset 0 1px 0 rgba(255,255,255,0.06)'
            : '0 14px 38px rgba(15,23,42,0.2), inset 0 1px 0 rgba(255,255,255,0.8)'
        })}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 22, gap: 0.75 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 650, color: dueMeta.overdue ? 'error.main' : 'text.secondary' }}>
            {dueMeta.label}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {data?.remainingCount > 0 && (
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              另有 {data.remainingCount} 项
            </Typography>
          )}
          <IconButton
            size="small"
            title="忽略本次提醒"
            disabled={Boolean(pendingAction)}
            onClick={() => sendAction('dismiss')}
            sx={{ width: 24, height: 24, borderRadius: '7px', color: 'text.secondary' }}
          >
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>

        <Typography
          title={todo?.content || ''}
          sx={{
            mt: 0.35,
            minHeight: 38,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
            fontSize: 15.5,
            lineHeight: 1.3,
            fontWeight: 650,
            color: 'text.primary',
            letterSpacing: '-0.01em'
          }}
        >
          {todo?.content || '待办事项'}
        </Typography>

        <Box sx={{ mt: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75 }}>
          <Button
            size="small"
            color="inherit"
            disabled={Boolean(pendingAction)}
            startIcon={<SnoozeIcon sx={{ fontSize: '16px !important' }} />}
            onClick={() => sendAction('snooze', { minutes: 10 })}
            sx={{ minHeight: 28, px: 1, borderRadius: '9px', color: 'text.secondary', fontSize: 12 }}
          >
            10 分钟后
          </Button>
          <IconButton
            size="small"
            title="在 Flota 中打开"
            disabled={Boolean(pendingAction)}
            onClick={() => sendAction('open')}
            sx={{ width: 28, height: 28, borderRadius: '9px', color: 'text.secondary', bgcolor: 'action.hover' }}
          >
            <OpenIcon sx={{ fontSize: 15 }} />
          </IconButton>
          <Button
            size="small"
            variant="contained"
            disableElevation
            disabled={Boolean(pendingAction)}
            startIcon={<CompleteIcon sx={{ fontSize: '16px !important' }} />}
            onClick={() => sendAction('complete')}
            sx={{ minHeight: 28, px: 1.25, borderRadius: '9px', fontSize: 12, fontWeight: 650 }}
          >
            完成
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

export default TodoReminderWindow;
