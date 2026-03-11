import React from 'react';
import {
  Box,
  Drawer,
  useMediaQuery,
  useTheme,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Chip,
  ListItemIcon
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Palette as PaletteIcon,
  GetApp as ImportIcon,
  Keyboard as KeyboardIcon,
  Cloud as CloudIcon,
  AutoAwesome as AIIcon,
  Memory as MemoryIcon,
  Wifi as WifiIcon,
  Info as InfoIcon,
  Mic as STTIcon,
  Code as CodeIcon,
  EditNote as EditNoteIcon
} from '@mui/icons-material';
import { scrollbar } from '../styles/commonStyles';
import { useStore } from '../store/useStore';
import NoteList from './NoteList';
import TodoList from './TodoList';
import MyDayPanel from './MyDayPanel';
import { t } from '../utils/i18n';

const SecondarySidebar = ({ open, onClose, width = 320, onTodoSelect, onViewModeChange, onShowCompletedChange, viewMode, showCompleted, onMultiSelectChange, onMultiSelectRefChange, todoRefreshTrigger, todoSortBy, onTodoSortByChange, showDeleted, selectedDate, calendarRefreshTrigger, onTodoUpdated }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const currentView = useStore((state) => state.currentView);
  const maskOpacity = useStore((state) => state.maskOpacity);
  const pluginStoreFilters = useStore((state) => state.pluginStoreFilters);
  const pluginStoreCategories = useStore((state) => state.pluginStoreCategories);
  const setPluginStoreCategory = useStore((state) => state.setPluginStoreCategory);
  const setPluginStoreTab = useStore((state) => state.setPluginStoreTab);
  const settingsTabValue = useStore((state) => state.settingsTabValue);
  const setSettingsTabValue = useStore((state) => state.setSettingsTabValue);

  // 根据遮罩透明度设置获取对应的透明度值
  const getMaskOpacityValue = (isDark) => {
    const opacityMap = {
      none: { dark: 0, light: 0 },
      light: { dark: 0.45, light: 0.4 },
      medium: { dark: 0.65, light: 0.65 },
      heavy: { dark: 0.88, light: 0.88 }
    }
    const values = opacityMap[maskOpacity] || opacityMap.medium
    return isDark ? values.dark : values.light
  }

  // 根据当前视图渲染不同的侧边栏内容
  const renderSidebarContent = () => {
    switch (currentView) {
      case 'notes':
        return <NoteList showDeleted={showDeleted} onMultiSelectChange={onMultiSelectChange} onMultiSelectRefChange={onMultiSelectRefChange} />;
      case 'todo':
        return (
          <TodoList 
            key="todo-list-stable"
            onTodoSelect={onTodoSelect}
            onViewModeChange={onViewModeChange}
            onShowCompletedChange={onShowCompletedChange}
            viewMode={viewMode}
            showCompleted={showCompleted}
            onMultiSelectChange={onMultiSelectChange}
            onMultiSelectRefChange={onMultiSelectRefChange}
            refreshTrigger={todoRefreshTrigger}
            sortBy={todoSortBy}
            onSortByChange={onTodoSortByChange}
          />
        );
      case 'calendar':
        return <MyDayPanel selectedDate={selectedDate} onTodoSelect={onTodoSelect} refreshToken={calendarRefreshTrigger} onTodoUpdated={onTodoUpdated} />;
      case 'plugins': {
        const categories = pluginStoreCategories && pluginStoreCategories.length > 0
          ? [{ id: 'all', name: t('plugins.allPlugins') }, ...pluginStoreCategories]
          : [
              { id: 'all', name: t('plugins.allPlugins') },
              { id: 'featured', name: t('plugins.featured') },
              { id: 'productivity', name: t('plugins.productivity') },
              { id: 'integration', name: t('plugins.integration') },
              { id: 'insights', name: t('plugins.insights') }
            ]

        const tabs = [
          { id: 'market', label: t('plugins.market') },
          { id: 'installed', label: t('plugins.installed') },
          { id: 'local', label: t('plugins.local') }
        ]

        return (
          <Box sx={(theme) => ({ 
            p: 2, 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%',
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(30, 41, 59, 0.85)'
              : 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px) saturate(150%)',
            WebkitBackdropFilter: 'blur(12px) saturate(150%)'
          })}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('sidebar.plugins')}
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
              {tabs.map((tab) => (
                <Chip
                  key={tab.id}
                  label={tab.label}
                  color={pluginStoreFilters.tab === tab.id ? 'primary' : 'default'}
                  variant={pluginStoreFilters.tab === tab.id ? 'filled' : 'outlined'}
                  onClick={() => setPluginStoreTab(tab.id)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Stack>

            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
              {t('plugins.categories')}
            </Typography>

            <List dense disablePadding sx={{ overflowY: 'auto', ...scrollbar.auto }}>
              {categories.map((category) => (
                <ListItemButton
                  key={category.id || category}
                  selected={pluginStoreFilters.category === (category.id || category)}
                  onClick={() => setPluginStoreCategory(category.id || category)}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5
                  }}
                >
                  <ListItemText
                    primary={category.name || category}
                    primaryTypographyProps={{
                      fontSize: 14,
                      fontWeight: pluginStoreFilters.category === (category.id || category) ? 600 : 400
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )
      }
      case 'settings': {
        const settingsCategories = [
          { id: 0, name: t('settings.general'), icon: <SettingsIcon /> },
          { id: 1, name: t('settings.appearance'), icon: <PaletteIcon /> },
          { id: 2, name: t('settings.shortcuts'), icon: <KeyboardIcon /> },
          { id: 3, name: t('settings.ai'), icon: <AIIcon /> },
          { id: 4, name: t('settings.stt'), icon: <STTIcon /> },
          { id: 5, name: t('settings.memory'), icon: <MemoryIcon /> },
          { id: 6, name: t('settings.cloud'), icon: <CloudIcon /> },
          { id: 7, name: t('settings.proxy'), icon: <WifiIcon /> },
          { id: 8, name: t('settings.data'), icon: <ImportIcon /> },
          { id: 9, name: 'MCP 服务', icon: <CodeIcon /> },
          { id: 10, name: '编辑器', icon: <EditNoteIcon /> },
          { id: 11, name: t('settings.about'), icon: <InfoIcon /> }
        ]

        return (
          <Box sx={(theme) => ({ 
            p: 2, 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%',
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(30, 41, 59, 0.85)'
              : 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px) saturate(150%)',
            WebkitBackdropFilter: 'blur(12px) saturate(150%)'
          })}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('settings.settings')}
            </Typography>

            <List dense disablePadding sx={{ overflowY: 'auto', ...scrollbar.auto }}>
              {settingsCategories.map((category) => (
                <ListItemButton
                  key={category.id}
                  selected={settingsTabValue === category.id}
                  onClick={() => setSettingsTabValue(category.id)}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {category.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={category.name}
                    primaryTypographyProps={{
                      fontSize: 14,
                      fontWeight: settingsTabValue === category.id ? 600 : 400
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )
      }
      default:
        return null;
    }
  };

  const sidebarContent = renderSidebarContent();
  
  // 如果当前视图不需要侧边栏内容，但仍需要渲染容器以支持动画
  const shouldShow = open && sidebarContent;

  return (
    <Box
      sx={{
        width: shouldShow ? width : 0,
        minWidth: shouldShow ? width : 0,
        maxWidth: shouldShow ? width : 0,
        height: '100%',
        overflow: 'hidden',
        flexShrink: 0,
        zIndex: 50,
        opacity: shouldShow ? 1 : 0,
        transition: theme.transitions.create(['width', 'minWidth', 'maxWidth', 'opacity'], {
          easing: theme.transitions.easing.easeInOut,
          duration: theme.transitions.duration.standard,
        }),
      }}
    >
      <Box
        sx={(themeObj) => {
          const opacity = getMaskOpacityValue(themeObj.palette.mode === 'dark')
          return {
            width: width,
            height: '100%',
            backgroundColor: themeObj.palette.mode === 'dark'
              ? `rgba(15, 23, 42, ${opacity})`
              : `rgba(240, 244, 248, ${opacity})`,
            backdropFilter: opacity > 0 ? 'blur(12px)' : 'none',
            WebkitBackdropFilter: opacity > 0 ? 'blur(12px)' : 'none',
            borderRight: 1,
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }
        }}
      >
        {sidebarContent}
      </Box>
    </Box>
  );
};

export default SecondarySidebar;
