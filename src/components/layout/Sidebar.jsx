import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../utils/i18n';
import { Box, ButtonBase, Tooltip, Typography, Zoom } from '@mui/material';
import * as MuiIcons from '../common/AppIcons';
import {
  Hub,
  Person as AvatarIcon,
  WavingHand,
  Code
} from '../common/AppIcons';
import {
  FlotaNoteIcon as StickyNote2,
  FlotaTodoIcon as CheckBox,
  FlotaCalendarIcon as CalendarToday,
  FlotaTimelineIcon as Timeline,
  FlotaSettingsIcon as Settings,
  FlotaPersonIcon as Person,
  FlotaPluginIcon as Store,
} from '../common/FlotaIcons';
import { alpha, useTheme } from '@mui/material/styles';
import { useStore } from '../../store/useStore';
import { usePluginViewsBySurface } from '../../store/usePluginViews';
import { useSidebarOrder } from '../../store/useSidebarOrder';
import logger from '../../utils/logger';
import { EASING, DURATION_MS } from '../../utils/animationConfig';
import RecentNotesRail from './RecentNotesRail';
import FlotaAIIcon from '../common/FlotaAIIcon';

const DynamicIcon = ({ name, ...props }) => {
  const Icon = (name && MuiIcons[name]) || Hub;
  return <Icon {...props} />;
};

// 全局统一动效曲线（Apple "spring-out" 风）
const NAV_EASING = EASING.standard;
const NAV_DURATION = DURATION_MS.normal;
const NAV_DURATION_FAST = DURATION_MS.fast;

// 单个导航按钮：左侧流体指示条 + 极轻背景过渡，无 scale/rotate
const NavItem = React.memo(function NavItem({
  active,
  tooltip,
  onClick,
  children,
  draggable = false,
  isDragging = false,
  isDragOver = false,
  dragOverAfter = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const hoverBg = theme.palette.action.hover;
  const activeBg = alpha(theme.palette.primary.main, isDark ? 0.18 : 0.1);
  const pressBg = theme.custom?.surface?.pressed || (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)');

  return (
    <Tooltip title={tooltip} placement="right" enterDelay={400} enterNextDelay={200}>
      <Box
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        sx={{
          position: 'relative',
          width: '36px',
          height: '36px',
          opacity: isDragging ? 0.4 : 1,
          transition: `opacity ${NAV_DURATION_FAST}ms ${NAV_EASING}`,
          // 拖到此项上/下方时，出现一条插入指示线
          '&::after': isDragOver
            ? {
                content: '""',
                position: 'absolute',
                left: '2px',
                right: '2px',
                top: dragOverAfter ? 'auto' : '-2px',
                bottom: dragOverAfter ? '-2px' : 'auto',
                height: '2px',
                borderRadius: '2px',
                backgroundColor: theme.palette.primary.main,
                pointerEvents: 'none',
              }
            : undefined,
        }}
      >
        {/* 左侧流体指示条：选中时从中心向上下伸展 */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: '-7px',
            top: '50%',
            width: '3px',
            height: '16px',
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
          aria-label={tooltip}
          aria-current={active ? 'page' : undefined}
          focusRipple={false}
          disableRipple
          sx={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
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
  const pluginViews = usePluginViewsBySurface('main:view');
  const savedOrder = useSidebarOrder((s) => s.order);
  const reorderSidebar = useSidebarOrder((s) => s.reorder);
  const [showWelcome, setShowWelcome] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);
  const [avatarClickCount, setAvatarClickCount] = useState(0);
  const [showDevMode, setShowDevMode] = useState(false);
  // 拖动排序状态：当前被拖动的 id，以及拖到哪个 id 的前/后方
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverAfter, setDragOverAfter] = useState(false);

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
    ...pluginViews.map((view) => ({
      id: view.navId,
      icon: <DynamicIcon name={view.icon} />,
      label: view.title,
      tooltip: view.tooltip
    })),
    {
      id: 'plugins',
      icon: <Store />,
      label: t('common.plugins'),
      tooltip: t('sidebar.pluginsTooltip')
    },
    {
      id: 'ai',
      icon: <FlotaAIIcon sx={{ fontSize: 22 }} />,
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

  // 按用户保存的顺序对导航按钮重排：
  // - 已保存顺序里的 id 按其下标排序
  // - 未保存的新项（首次出现/新装插件视图）保持原有相对顺序，排到末尾
  const orderedMenuItems = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return menuItems;
    const rank = new Map(savedOrder.map((id, i) => [id, i]));
    return [...menuItems].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
      const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
      if (ra !== rb) return ra - rb;
      return 0;
    });
  }, [menuItems, savedOrder]);

  const handleMenuClick = (itemId) => {
    setCurrentView(itemId);
  };

  // 拖动排序处理
  const handleNavDragStart = (itemId) => (e) => {
    setDraggingId(itemId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', itemId);
      } catch (_) {
        // 某些环境 setData 受限，忽略
      }
    }
  };

  const handleNavDragOver = (itemId) => (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (itemId === draggingId) {
      setDragOverId(null);
      return;
    }
    // 鼠标在目标上半部分 → 放到前面；下半部分 → 放到后面
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    setDragOverAfter(after);
    setDragOverId(itemId);
  };

  const handleNavDragLeave = (itemId) => () => {
    setDragOverId((prev) => (prev === itemId ? null : prev));
  };

  const handleNavDrop = (itemId) => (e) => {
    e.preventDefault();
    const sourceId = draggingId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    if (sourceId && sourceId !== itemId) {
      const visibleIds = orderedMenuItems.map((it) => it.id);
      reorderSidebar(visibleIds, sourceId, itemId, dragOverAfter);
    }
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleNavDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
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
        width: '52px',
        minWidth: '52px',
        maxWidth: '52px',
        height: '100%',
        backgroundColor: 'transparent',
        borderRight: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '7px',
        paddingBottom: '8px',
        position: 'relative',
        zIndex: 100,
        background: theme.custom?.surface?.glassLight,
        backdropFilter: theme.custom?.glass?.backdropFilter,
        WebkitBackdropFilter: theme.custom?.glass?.backdropFilter,
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
          marginBottom: '7px',
        }}
      >
        <ButtonBase
          onClick={handleAvatarClick}
          aria-label={displayName}
          onMouseEnter={() => setAvatarHover(true)}
          onMouseLeave={() => setAvatarHover(false)}
          sx={{
            width: '34px',
            height: '34px',
            borderRadius: '9px',
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
            <AvatarIcon sx={{ color: 'white', fontSize: '20px' }} />
          )}
        </ButtonBase>

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
          width: '32px',
          height: '1px',
          backgroundColor: theme.palette.divider,
          marginBottom: '8px',
          opacity: 0.5,
        }}
      />

      {/* 菜单项 + 最近笔记 */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          flex: 1,
          minHeight: 0,
          overflow: 'visible',
        }}
      >
        {orderedMenuItems.map((item) => (
          <NavItem
            key={item.id}
            tooltip={item.tooltip}
            active={currentView === item.id}
            onClick={() => handleMenuClick(item.id)}
            draggable
            isDragging={draggingId === item.id}
            isDragOver={dragOverId === item.id}
            dragOverAfter={dragOverAfter}
            onDragStart={handleNavDragStart(item.id)}
            onDragOver={handleNavDragOver(item.id)}
            onDragLeave={handleNavDragLeave(item.id)}
            onDrop={handleNavDrop(item.id)}
            onDragEnd={handleNavDragEnd}
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

        {/* 最近笔记胶囊 — 仅本区域内部纵向滚动，不影响功能图标和设置按钮的位置 */}
        <RecentNotesRail />
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
            width: '32px',
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
