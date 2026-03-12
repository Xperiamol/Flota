import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { createTransitionString, ANIMATIONS } from '../utils/animationConfig';
import { useStore } from '../store/useStore';
import { useTranslation } from '../utils/i18n';
import SyncStatusIndicator from './SyncStatusIndicator';

const TitleBar = ({ isStandalone = false, onMinibarClick, isMinibarMode = false }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { currentView, titleBarStyle } = useStore();

  // 根据当前视图获取对应的标题
  const getViewTitle = () => {
    switch (currentView) {
      case 'notes':
        return 'Flota';
      case 'todo':
        return '待办事项';
      case 'calendar':
        return '日历';
      case 'settings':
        return '设置';
      case 'plugins':
        return '插件';
      case 'profile':
        return '个人中心';
      case 'ai':
        return 'FlotaAI';
      default:
        return 'Flota';
    }
  };

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
        background: theme.palette.mode === 'dark'
          ? 'rgba(30, 41, 59, 0.6)'
          : 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(30px) saturate(180%)',
        WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'}`,
      }}
    >
      {/* Minibar按钮 - 独立窗口时显示 */}
      {isStandalone && (
        <Box
          sx={{
            position: 'absolute',
            left: titleBarStyle === 'mac' ? '72px' : '12px',
            WebkitAppRegion: 'no-drag',
          }}
        >
          <Tooltip title={t('toolbar.minibarMode')} placement="bottom">
            <Box
              onClick={handleMinibar}
              sx={{
                width: '32px',
                height: '20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                borderRadius: '4px',
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
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
                  backgroundColor: theme.palette.mode === 'dark' ? '#ffffff' : '#1a1a1a',
                  borderRadius: '1px',
                  marginBottom: '2px',
                }}
              />
              <Box
                sx={{
                  width: '10px',
                  height: '2px',
                  backgroundColor: theme.palette.mode === 'dark' ? '#ffffff' : '#1a1a1a',
                  borderRadius: '1px',
                }}
              />
            </Box>
          </Tooltip>
        </Box>
      )}

      {titleBarStyle === 'mac' ? (
        /* Mac风格的窗口控制按钮 - 左侧 */
        <Box
          sx={{
            position: 'absolute',
            left: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            WebkitAppRegion: 'no-drag',
          }}
        >
          {/* 关闭按钮 - 红色 */}
          <Tooltip title={t('toolbar.macButtons.close')} placement="bottom">
            <Box
              onClick={handleClose}
              sx={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#ff5f57',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
                  backgroundColor: '#ff3b30',
                  transform: 'scale(1.1)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
            />
          </Tooltip>

          {/* 最小化按钮 - 黄色 */}
          <Tooltip title={t('toolbar.macButtons.minimize')} placement="bottom">
            <Box
              onClick={handleMinimize}
              sx={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#ffbd2e',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
                  backgroundColor: '#ff9500',
                  transform: 'scale(1.1)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
            />
          </Tooltip>

          {/* 最大化按钮 - 绿色 */}
          <Tooltip title={t('toolbar.macButtons.maximize')} placement="bottom">
            <Box
              onClick={handleMaximize}
              sx={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#28ca42',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: createTransitionString(ANIMATIONS.button),
                '&:hover': {
                  backgroundColor: '#20a934',
                  transform: 'scale(1.1)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
            />
          </Tooltip>
        </Box>
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
              <svg width="10" height="1" viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect
                  width="10"
                  height="1"
                  fill={theme.palette.mode === 'dark' ? '#ffffff' : '#333333'}
                />
              </svg>
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
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M1 1h8v8H1V1z"
                  stroke={theme.palette.mode === 'dark' ? '#ffffff' : '#333333'}
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
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
                  backgroundColor: '#e81123',
                  '& svg path': {
                    stroke: '#ffffff',
                  }
                },
                '&:active': {
                  backgroundColor: '#c50d1d',
                },
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M1 1l8 8M9 1L1 9"
                  stroke={theme.palette.mode === 'dark' ? '#ffffff' : '#333333'}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
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

      {/* 同步状态指示器 - 右侧（Windows样式时） */}
      {titleBarStyle === 'windows' && (
        <Box
          sx={{
            position: 'absolute',
            right: '140px', // 留出空间给窗口控制按钮
            WebkitAppRegion: 'no-drag',
          }}
        >
          <SyncStatusIndicator />
        </Box>
      )}

      {/* 同步状态指示器 - 右侧（Mac样式时） */}
      {titleBarStyle === 'mac' && (
        <Box
          sx={{
            position: 'absolute',
            right: '12px',
            WebkitAppRegion: 'no-drag',
          }}
        >
          <SyncStatusIndicator />
        </Box>
      )}
    </Box>
  );
};

export default TitleBar;
