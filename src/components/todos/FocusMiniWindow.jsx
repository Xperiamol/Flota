import { useEffect, useMemo, useState } from 'react';
import { Box, IconButton, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  OpenInFullRounded as OpenMainIcon,
  PauseRounded as PauseIcon,
  PlayArrowRounded as ResumeIcon
} from '@mui/icons-material';

const formatSeconds = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const FocusMiniWindow = ({ initialData = {} }) => {
  const [session, setSession] = useState(initialData || {});
  const [tick, setTick] = useState(Date.now());
  const [actionPending, setActionPending] = useState(false);

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
    const unsubscribe = window.electronAPI?.focusWindow?.onUpdate?.((data) => {
      if (data) {
        setSession((current) => ({ ...current, ...data }));
        setTick(Date.now());
      }
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!session?.isFocusing || session?.isPaused) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.isFocusing, session?.isPaused]);

  const elapsedSeconds = useMemo(() => {
    const baseline = Number(session?.elapsedSeconds) || 0;
    if (!session?.isFocusing || session?.isPaused) return baseline;
    const syncedAt = Number(session?.syncedAt) || tick;
    return baseline + Math.max(0, Math.floor((tick - syncedAt) / 1000));
  }, [session?.elapsedSeconds, session?.isFocusing, session?.isPaused, session?.syncedAt, tick]);

  const title = session?.title || '正在专注';
  const dueLabel = session?.dueLabel ? `DDL · ${session.dueLabel}` : 'DDL · 未设置';

  const sendAction = async (type) => {
    if (!window.electronAPI?.focusWindow?.action) return;
    setActionPending(true);
    try {
      await window.electronAPI.focusWindow.action({ type });
    } finally {
      setActionPending(false);
    }
  };

  return (
    <Box
      sx={{
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        p: '6px',
        backgroundColor: 'transparent',
        userSelect: 'none'
      }}
    >
      <Paper
        elevation={0}
        onDoubleClick={() => sendAction('show-main')}
        sx={(theme) => ({
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          px: 1.25,
          py: 1,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.13)'
            : 'rgba(15,23,42,0.10)',
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(18,27,44,0.92)'
            : 'rgba(250,252,255,0.92)',
          backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.07)}, transparent 56%)`,
          backdropFilter: 'blur(22px) saturate(160%)',
          WebkitBackdropFilter: 'blur(22px) saturate(160%)',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 26px rgba(2,6,23,0.42), inset 0 1px 0 rgba(255,255,255,0.06)'
            : '0 8px 26px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.76)',
          WebkitAppRegion: 'drag'
        })}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            title={title}
            noWrap
            sx={{
              minWidth: 0,
              flex: 1,
              fontSize: 14.5,
              fontWeight: 650,
              lineHeight: 1.35,
              letterSpacing: '-0.01em',
              color: 'text.primary'
            }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              flexShrink: 0,
              fontSize: 13,
              fontWeight: 700,
              color: session?.isPaused ? 'text.secondary' : 'text.primary',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.02em'
            }}
          >
            {formatSeconds(elapsedSeconds)}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 0.75 }}>
          <Typography
            title={dueLabel}
            noWrap
            sx={{
              minWidth: 0,
              flex: 1,
              fontSize: 11.5,
              color: 'text.secondary',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {dueLabel}
          </Typography>
          <IconButton
            size="small"
            title="回到 Flota"
            onClick={() => sendAction('show-main')}
            sx={{
              width: 27,
              height: 27,
              borderRadius: '8px',
              color: 'text.secondary',
              bgcolor: 'action.hover',
              WebkitAppRegion: 'no-drag',
              '&:hover': { color: 'text.primary', bgcolor: 'action.selected' }
            }}
          >
            <OpenMainIcon sx={{ fontSize: 15 }} />
          </IconButton>
          <IconButton
            size="small"
            title={session?.isPaused ? '继续专注' : '暂停'}
            disabled={actionPending}
            onClick={() => sendAction(session?.isPaused ? 'resume' : 'pause')}
            sx={(theme) => ({
              width: 27,
              height: 27,
              borderRadius: '8px',
              color: 'primary.main',
              bgcolor: alpha(theme.palette.primary.main, session?.isPaused ? 0.16 : 0.1),
              WebkitAppRegion: 'no-drag',
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.18) }
            })}
          >
            {session?.isPaused
              ? <ResumeIcon sx={{ fontSize: 17 }} />
              : <PauseIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Box>
      </Paper>
    </Box>
  );
};

export default FocusMiniWindow;
