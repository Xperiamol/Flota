import React, { useState } from 'react';
import { useTranslation } from '../utils/i18n';
import { Box, ButtonBase, Tooltip, Typography, Zoom } from '@mui/material';
import {
  StickyNote2,
  CheckBox,
  CalendarToday,
  Timeline,
  Settings,
  Person,
  Store,
  WavingHand,
  Code,
  AutoAwesome
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useStore } from '../store/useStore';
import logger from '../utils/logger';

// 业界领先的导航动画曲线：Apple "spring-out" / Linear / Raycast 通用
// 比 Material Standard (0.4, 0, 0.2, 1) 更跟手、更紧致
const NAV_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const NAV_DURATION = 180;
const NAV_DURATION_FAST = 120;

// 单个导航按钮：左侧流体指示条 + 极轻背景过渡，无 scale/rotate
const NavItem = React.memo(function NavItem({
  active,
  tooltip,
  onClick,
  children,
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.045)';
  const activeBg = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)';
  const pressBg = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.085)';

  return (
    <Tooltip title={tooltip} placement="right" enterDelay={400} enterNextDelay={200}>
      <Box sx={{ position: 'relative', width: '44px', height: '44px' }}>
        {/* 左侧流体指示条：选中时从中心向上下伸展 */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: '-10px',
            top: '50%',
            width: '3px',
            height: '20px',
            borderRadius: '2px',
            backgroundColor: theme.palette.primary.main,
            transform: active
              ? 'translateY(-50%) scaleY(1)'
              : 'translateY(-50%) scaleY(0.2)',
            opacity: active ? 1 : 0,
            transformOrigin: 'center',
            transition: `transform ${NAV_DURATION}ms ${NAV_EASING}, opacity ${NAV_DURATION_FAST}ms ${NAV_EASING}`,
            pointerEvents: 'none',
          }}
        />
        <ButtonBase
          onClick={onClick}
          focusRipple={false}
          disableRipple
          sx={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            color: active ? theme.palette.primary.main : theme.palette.text.secondary,
            backgroundColor: active ? activeBg : 'transparent',
            transition: `background-color ${NAV_DURATION}ms ${NAV_EASING}, color ${NAV_DURATION}ms ${NAV_EASING}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // 关键：完全无 transform，避免抖动/位移
            '&:hover': {
              backgroundColor: active ? activeBg : hoverBg,
              color: active ? theme.palette.primary.main : theme.palette.text.primary,
            },
            '&:active': {
              backgroundColor: pressBg,
              transition: `background-color ${NAV_DURATION_FAST}ms ${NAV_EASING}, color ${NAV_DURATION_FAST}ms ${NAV_EASING}`,
            },
            '&:focus-visible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: '2px',
            },
            // icon 只过渡颜色，不做 transform
            '& svg, & img': {
              transition: `color ${NAV_DURATION}ms ${NAV_EASING}, opacity ${NAV_DURATION}ms ${NAV_EASING}`,
            },
          }}
        >
          {children}
        </ButtonBase>
      </Box>
    </Tooltip>
  );
});

// 圣诞图标路径
const CHRISTMAS_ICONS = {
  notes: './png/gift-box.png',
  todo: './png/christmas-wreath.png',
  calendar: './png/christmas-bell.png',
  plugins: './png/christmas-tree.png',
  profile: './png/hat.png',
  settings: './png/christmas-tree.png'
};

// 圣诞问候语
const CHRISTMAS_GREETINGS = [
  '🎄 圣诞快乐',
  '🎅 Ho Ho Ho!',
  '✨ Merry Christmas!',
  '🎁 愿你的圣诞充满欢乐',
  '❄️ 祝你幸福安康',
  '🌟 愿圣诞之光照亮你的心'
];

const Sidebar = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { currentView, setCurrentView, userAvatar, userName, christmasMode } = useStore();
  const [showWelcome, setShowWelcome] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);
  const [avatarClickCount, setAvatarClickCount] = useState(0);
  const [showDevMode, setShowDevMode] = useState(false);

  // 主侧边栏始终显示，不受open prop控制

  const menuItems = [
    {
      id: 'notes',
      icon: <StickyNote2 />,
      label: t('common.notes'),
      tooltip: t('sidebar.notesTooltip')
    },
    {
      id: 'todo',
      icon: <CheckBox />,
      label: t('common.todos'),
      tooltip: t('sidebar.todosTooltip')
    },
    {
      id: 'calendar',
      icon: <CalendarToday />,
      label: t('common.calendar'),
      tooltip: t('sidebar.calendarTooltip')
    },
    {
      id: 'timeline',
      icon: <Timeline />,
      label: '时间轴',
      tooltip: '时间轴'
    },
    {
      id: 'plugins',
      icon: <Store />,
      label: t('common.plugins'),
      tooltip: t('sidebar.pluginsTooltip')
    },
    {
      id: 'ai',
      icon: <AutoAwesome />,
      label: 'AI',
      tooltip: t('sidebar.aiTooltip') || 'FlotaAI'
    },
    {
      id: 'profile',
      icon: <Person />,
      label: t('sidebar.profile'),
      tooltip: t('sidebar.profileTooltip')
    }
  ];

  const handleMenuClick = (itemId) => {
    setCurrentView(itemId);
  };

  // 处理头像点击
  const handleAvatarClick = () => {
    // 增加点击计数
    const newCount = avatarClickCount + 1;
    setAvatarClickCount(newCount);

    // 点击7次启用开发者工具
    if (newCount >= 7) {
      // 显示开发者模式提示
      setShowDevMode(true);
      setTimeout(() => {
        setShowDevMode(false);
      }, 3000);

      // 切换开发者工具
      if (window.electronAPI && window.electronAPI.window && window.electronAPI.window.toggleDevTools) {
        window.electronAPI.window.toggleDevTools().then(result => {
          if (result && result.success) {
            logger.log('开发者工具已切换');
          } else if (result && result.error) {
            console.warn('切换开发者工具失败:', result.error);
          }
        }).catch(error => {
          console.error('调用开发者工具切换失败:', error);
        });
      }

      // 重置计数
      setAvatarClickCount(0);
    } else {
      // 显示欢迎消息
      setShowWelcome(true);
      setTimeout(() => {
        setShowWelcome(false);
      }, 3000);
    }
  };

  // 获取当前时间的问候语
  const getGreeting = () => {
    // 圣诞模式下使用圣诞问候语
    if (christmasMode) {
      const randomGreeting = CHRISTMAS_GREETINGS[Math.floor(Math.random() * CHRISTMAS_GREETINGS.length)];
      return randomGreeting;
    }
    const hour = new Date().getHours();
    if (hour < 6) return t('profile.greetingNight');
    if (hour < 9) return t('profile.greetingMorning');
    if (hour < 12) return t('profile.greetingMorning');
    if (hour < 14) return t('profile.greetingNoon');
    if (hour < 18) return t('profile.greetingNoon');
    if (hour < 22) return t('profile.greetingEvening');
    return t('profile.greetingNight');
  };

  // 获取显示名称
  const displayName = userName || t('profile.defaultUser');

  return (
    <Box
      sx={{
        width: '68px', // Slightly wider for better touch target
        minWidth: '68px',
        maxWidth: '68px',
        height: '100%',
        backgroundColor: 'transparent', // Let glass handle it
        borderRight: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '12px',
        paddingBottom: '16px',
        position: 'relative',
        zIndex: 100,
        background: theme.palette.mode === 'dark'
          ? 'rgba(30, 41, 59, 0.7)' // Slate 800 with opacity
          : 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(20px)',
        boxShadow: 'none',
        overflow: 'visible',
        minHeight: 0,
        flexShrink: 0
      }}
    >
      {/* 头像区域 */}
      <Box
        sx={{
          position: 'relative',
          marginBottom: '12px',
        }}
      >
        <Box
          onClick={handleAvatarClick}
          onMouseEnter={() => setAvatarHover(true)}
          onMouseLeave={() => setAvatarHover(false)}
          sx={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: userAvatar ? 'transparent' : theme.palette.primary.main,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: userAvatar ? 'none' : `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
            // 柔和的双层 elevation：环境光 + 投影
            boxShadow: avatarHover
              ? '0 0 0 2px rgba(255,255,255,0.08), 0 6px 16px rgba(0,0,0,0.22)'
              : '0 0 0 0 rgba(255,255,255,0), 0 2px 6px rgba(0,0,0,0.18)',
            overflow: 'hidden',
            cursor: 'pointer',
            // 仅过渡 box-shadow / filter，不做 transform，避免"翻车感"
            transition: `box-shadow ${NAV_DURATION}ms ${NAV_EASING}, filter ${NAV_DURATION}ms ${NAV_EASING}`,
            filter: avatarHover ? 'brightness(1.06)' : 'brightness(1)',
            '&:active': {
              filter: 'brightness(0.94)',
              transition: `filter ${NAV_DURATION_FAST}ms ${NAV_EASING}`,
            },
          }}
        >
          {userAvatar ? (
            <Box
              component="img"
              src={userAvatar}
              alt="用户头像"
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: '8px',
              }}
            />
          ) : (
            <Person sx={{ color: 'white', fontSize: '20px' }} />
          )}
        </Box>

        {/* 欢迎消息气泡 */}
        <Zoom in={showWelcome}>
          <Box
            sx={{
              position: 'absolute',
              top: '0%',
              left: '60px',
              transform: 'translateY(-50%)',
              bgcolor: theme.palette.mode === 'dark' ? '#2d2d2d' : '#fff',
              color: theme.palette.mode === 'dark' ? '#fff' : '#000',
              px: 2,
              py: 1.5,
              borderRadius: 2,
              boxShadow: 3,
              whiteSpace: 'nowrap',
              border: `1px solid ${theme.palette.divider}`,
              zIndex: 1000,
              minWidth: '180px',
              '&::before': {
                content: '""',
                position: 'absolute',
                left: -8,
                top: '12px',
                width: 0,
                height: 0,
                borderTop: '8px solid transparent',
                borderBottom: '8px solid transparent',
                borderRight: `8px solid ${theme.palette.mode === 'dark' ? '#2d2d2d' : '#fff'}`,
              },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WavingHand sx={{ fontSize: 18, color: theme.palette.primary.main }} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {getGreeting()}，{displayName}！
              </Typography>
            </Box>
          </Box>
        </Zoom>

        {/* 开发者模式提示气泡 */}
        <Zoom in={showDevMode}>
          <Box
            sx={{
              position: 'absolute',
              top: '0%',
              left: '60px',
              transform: 'translateY(-50%)',
              bgcolor: theme.palette.mode === 'dark' ? '#2d2d2d' : '#fff',
              color: theme.palette.mode === 'dark' ? '#fff' : '#000',
              px: 2,
              py: 1.5,
              borderRadius: 2,
              boxShadow: 3,
              whiteSpace: 'nowrap',
              border: `1px solid ${theme.palette.divider}`,
              zIndex: 1000,
              minWidth: '180px',
              '&::before': {
                content: '""',
                position: 'absolute',
                left: -8,
                top: '12px',
                width: 0,
                height: 0,
                borderTop: '8px solid transparent',
                borderBottom: '8px solid transparent',
                borderRight: `8px solid ${theme.palette.mode === 'dark' ? '#2d2d2d' : '#fff'}`,
              },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Code sx={{ fontSize: 18, color: theme.palette.primary.main }} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('profile.devModeEnabled')}
              </Typography>
            </Box>
          </Box>
        </Zoom>
      </Box>

      {/* 分隔线 */}
      <Box
        sx={{
          width: '44px',
          height: '1px',
          backgroundColor: theme.palette.divider,
          marginBottom: '16px',
          opacity: 0.5,
        }}
      />

      {/* 菜单项 */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          flex: 1,
          overflow: 'visible',
          minHeight: 0
        }}
      >
        {menuItems.map((item) => (
          <NavItem
            key={item.id}
            tooltip={item.tooltip}
            active={currentView === item.id}
            onClick={() => handleMenuClick(item.id)}
          >
            {christmasMode && CHRISTMAS_ICONS[item.id] ? (
              <Box
                component="img"
                src={CHRISTMAS_ICONS[item.id]}
                alt={item.label}
                sx={{
                  width: '22px',
                  height: '22px',
                  objectFit: 'contain',
                }}
              />
            ) : (
              React.cloneElement(item.icon, {
                sx: { fontSize: '20px' }
              })
            )}
          </NavItem>
        ))}
      </Box>

      {/* 底部设置按钮 */}
      <Box
        sx={{
          marginTop: 'auto',
          paddingTop: '8px',
        }}
      >
        <Box
          sx={{
            width: '44px',
            height: '1px',
            backgroundColor: theme.palette.divider,
            marginBottom: '8px',
            opacity: 0.5,
          }}
        />
        <NavItem
          tooltip={t('sidebar.settingsTooltip')}
          active={currentView === 'settings'}
          onClick={() => handleMenuClick('settings')}
        >
          {christmasMode ? (
            <Box
              component="img"
              src={CHRISTMAS_ICONS.settings}
              alt="Settings"
              sx={{
                width: '22px',
                height: '22px',
                objectFit: 'contain',
              }}
            />
          ) : (
            <Settings sx={{ fontSize: '20px' }} />
          )}
        </NavItem>
      </Box>
    </Box>
  );
};

export default React.memo(Sidebar);
