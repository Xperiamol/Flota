import React, { useEffect, useState } from 'react';
import { Close, HorizontalRule, WebAsset } from '../common/AppIcons';
import { Box, Typography, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { PushPinOutlined as PushPinOutlinedIcon } from '../common/AppIcons';
import { createTransitionString, ANIMATIONS } from '../../utils/animationConfig';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../utils/i18n';
import SyncStatusIndicator from '../sync/SyncStatusIndicator';
import TitleBarAIButton from './TitleBarAIButton';
import OpenNoteButton from '../notes/OpenNoteButton';
import { usePageTitle } from '../../utils/pageTitle';

const STANDALONE_TITLES = { todo: '待办', widget: '组件' };

const TitleBar = ({ isStandalone = false, windowType = null, onMinibarClick, isMinibarMode = false }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { titleBarStyle } = useStore(useShallow((state) => ({
    titleBarStyle: state.titleBarStyle,
  })));
  const isMac = titleBarStyle === 'mac';
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);

  useEffect(() => {
    const windowApi = window.electronAPI?.window;
    if (!windowApi) return undefined;

    let disposed = false;
    windowApi.isAlwaysOnTop?.().then((value) => {
      if (!disposed) setIsAlwaysOnTop(Boolean(value));
    }).catch(() => {});

    const unsubscribe = windowApi.onAlwaysOnTopChanged?.((value) => {
      setIsAlwaysOnTop(Boolean(value));
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  // 当前页面的名字（笔记、回收站、设置 · 外观、插件页面……），规则见 utils/pageTitle
  const pageTitle = usePageTitle();
  // 独立窗口：笔记窗口显示笔记标题，其他显示窗口类型
  const standaloneNoteTitle = useStore((state) => {
    if (!isStandalone || windowType !== 'note') return null;
    const note = state.notes.find((item) => String(item.id) === String(state.selectedNoteId));
    return note ? (note.title?.trim() || '未命名笔记') : '笔记';
  });
  const getViewTitle = () => (isStandalone ? (standaloneNoteTitle || STANDALONE_TITLES[windowType] || 'Flota') : pageTitle);

  const handleMinimize = async () => {
    if (window.electronAPI) {
      await window.electronAPI.window.minimize();
    }
  };

  const handleMaximize = async () => {
    if (window.electronAPI) {
      await window.electronAPI.window.maximize();
    }
  };

  const handleClose = async () => {
    if (window.electronAPI) {
      await window.electronAPI.window.close();
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    if (window.electronAPI?.window?.toggleAlwaysOnTop) {
      const value = await window.electronAPI.window.toggleAlwaysOnTop();
      setIsAlwaysOnTop(Boolean(value));
    }
  };

  const handleMinibar = async () => {
    if (onMinibarClick) {
      onMinibarClick();
    } else if (window.electronAPI) {
      await window.electronAPI.window.setSize(200, 40);
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '32px',
        backgroundColor: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        WebkitAppRegion: 'drag',
        userSelect: 'none',
        position: 'relative',
        zIndex: 1000,
        // 标题栏直接放在应用背景上
        background: 'transparent',
      }}
    >
      {/* 左上角窗口工具组 */}
      <Box
        sx={{
          position: 'absolute',
          left: isMac ? '76px' : '6px',
          top: '2px',
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          WebkitAppRegion: 'no-drag',
        }}
      >
        <AlwaysOnTopButton
          active={isAlwaysOnTop}
          onClick={handleToggleAlwaysOnTop}
          theme={theme}
          label={t(`toolbar.windowButtons.${isAlwaysOnTop ? 'unpin' : 'pin'}`)}
        />
        {!isStandalone && <OpenNoteButton />}
        {isStandalone && (
          <Tooltip title={t('toolbar.minibarMode')} placement="bottom">
            <Box
              onClick={handleMinibar}
              sx={{
                width: '28px',
                height: '28px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                borderRadius: '7px',
                color: theme.palette.text.secondary,
                opacity: 0.58,
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
                  opacity: 1,
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
                },
                '&:active': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
                },
              }}
            >
              <Box
                sx={{
                  width: '10px',
                  height: '2px',
                  backgroundColor: 'currentColor',
                  borderRadius: '1px',
                  marginBottom: '3px',
                }}
              />
              <Box
                sx={{
                  width: '10px',
                  height: '2px',
                  backgroundColor: 'currentColor',
                  borderRadius: '1px',
                }}
              />
            </Box>
          </Tooltip>
        )}
      </Box>

      {titleBarStyle === 'mac' ? (
        /* macOS 下不渲染自定义窗口控制按钮（系统自带），避免重复与误导 */
        null
      ) : (
        /* Windows风格的窗口控制按钮 - 右侧 */
        <Box
          sx={{
            position: 'absolute',
            right: '0',
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            WebkitAppRegion: 'no-drag',
          }}
        >
          {/* 最小化按钮 */}
          <Tooltip title={t('toolbar.windowButtons.minimize')} placement="bottom">
            <Box
              onClick={handleMinimize}
              sx={{
                width: '46px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
                },
                '&:active': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
                },
              }}
            >
              <HorizontalRule sx={{ fontSize: 16, color: 'text.primary' }} />
            </Box>
          </Tooltip>

          {/* 最大化按钮 */}
          <Tooltip title={t('toolbar.windowButtons.maximize')} placement="bottom">
            <Box
              onClick={handleMaximize}
              sx={{
                width: '46px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
                },
                '&:active': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
                },
              }}
            >
              <WebAsset sx={{ fontSize: 16, color: 'text.primary' }} />
            </Box>
          </Tooltip>

          {/* 关闭按钮 */}
          <Tooltip title={t('toolbar.windowButtons.close')} placement="bottom">
            <Box
              onClick={handleClose}
              sx={{
                width: '46px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                position: 'relative',
                zIndex: 10000,
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
                  backgroundColor: theme.palette.error.main,
                  '& svg': {
                    color: theme.palette.error.contrastText || '#ffffff',
                  }
                },
                '&:active': {
                  backgroundColor: theme.palette.error.dark || '#c50d1d',
                },
              }}
            >
              <Close sx={{ fontSize: 16, color: 'text.primary' }} />
            </Box>
          </Tooltip>
        </Box>
      )}

      {/* 应用标题 - 居中 */}
      {!isMinibarMode && (
        <Typography
          variant="body2"
          sx={{
            fontSize: '13px',
            fontWeight: 500,
            color: theme.palette.text.primary,
            opacity: 0.8,
            letterSpacing: '0.3px',
            textAlign: 'center',
          }}
        >
          {getViewTitle()}
        </Typography>
      )}

      {/* 右侧：AI 入口 + 同步状态（Windows 样式时让出窗口控制按钮的位置） */}
      {(
        <Box
          sx={{
            position: 'absolute',
            right: titleBarStyle === 'windows' ? '140px' : '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            WebkitAppRegion: 'no-drag',
          }}
        >
          {!isStandalone && !isMinibarMode && <TitleBarAIButton />}
          <SyncStatusIndicator />
        </Box>
      )}
    </Box>
  );
};

const AlwaysOnTopButton = ({ active, onClick, theme, label }) => (
  <Tooltip title={label} placement="bottom">
    <Box
      onClick={onClick}
      role="button"
      aria-pressed={active}
      aria-label={label}
      sx={{
        width: '28px',
        height: '28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        borderRadius: '7px',
        color: active ? theme.palette.primary.main : theme.palette.text.secondary,
        opacity: active ? 1 : 0.58,
        backgroundColor: active
          ? (theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.12)' : 'rgba(25, 118, 210, 0.08)')
          : 'transparent',
        transition: createTransitionString(ANIMATIONS.button),
        '&:hover': {
          opacity: 1,
          backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
        },
        '&:active': {
          backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
        },
      }}
    >
      <PushPinOutlinedIcon
        sx={{
          fontSize: 14,
          transform: active ? 'rotate(-35deg)' : 'none',
          transition: 'transform 160ms ease',
        }}
      />
    </Box>
  </Tooltip>
);

export default TitleBar;
