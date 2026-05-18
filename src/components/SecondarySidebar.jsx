import { useEffect, useState } from 'react';
import {
  Box,
  useTheme,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Chip,
  ListItemIcon,
  IconButton,
  Checkbox,
  Menu,
  MenuItem,
  TextField,
  InputAdornment
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
  EditNote as EditNoteIcon,
  DeleteOutline as DeleteIcon,
  SelectAll as SelectAllIcon,
  Search as SearchIcon,
  Notes as NotesIcon,
  AddTask as AddTaskIcon,
  Brush as WhiteboardIcon,
  RestartAlt as ResetIcon,
  Tag as TagIcon
} from '@mui/icons-material';
import { useStore } from '../store/useStore';
import NoteList from './NoteList';
import TodoList from './TodoList';
import MyDayPanel from './MyDayPanel';
import { t } from '../utils/i18n';

const DEFAULT_TIMELINE_TYPES = ['note', 'whiteboard', 'todo'];

const normalizeTimelineTypes = (types) => {
  if (!Array.isArray(types) || types.length === 0) return DEFAULT_TIMELINE_TYPES;
  const raw = new Set(types);
  if (raw.has('note') && raw.has('todo') && raw.has('voice')) return DEFAULT_TIMELINE_TYPES;

  const next = [];
  if (raw.has('note') || raw.has('voice')) next.push('note');
  if (raw.has('whiteboard')) next.push('whiteboard');
  if (raw.has('todo')) next.push('todo');
  return next.length ? next : DEFAULT_TIMELINE_TYPES;
};

const isDefaultTimelineTypes = (types) => {
  const normalized = normalizeTimelineTypes(types);
  return DEFAULT_TIMELINE_TYPES.every((type) => normalized.includes(type)) && normalized.length === DEFAULT_TIMELINE_TYPES.length;
};

const sidebarScrollableListSx = {
  overflowY: 'auto',
  flex: 1,
  pr: '4px',
  mr: '-4px',
  scrollbarGutter: 'stable',
  '&::-webkit-scrollbar': {
    width: '6px'
  },
  '&::-webkit-scrollbar-track': {
    background: 'transparent'
  },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(150, 150, 150, 0.2)',
    borderRadius: '3px',
    transition: 'background 0.3s ease'
  },
  '&::-webkit-scrollbar-thumb:hover': {
    background: 'rgba(150, 150, 150, 0.4)'
  },
  '&::-webkit-scrollbar-thumb:active': {
    background: 'rgba(150, 150, 150, 0.5)'
  },
  '&::-webkit-scrollbar-button': {
    display: 'none'
  }
};

const SecondarySidebar = ({ open, width = 380, onTodoSelect, onViewModeChange, onShowCompletedChange, viewMode, showCompleted, onMultiSelectChange, onMultiSelectRefChange, todoRefreshTrigger, todoSortBy, onTodoSortByChange, showDeleted, selectedDate, calendarRefreshTrigger, onTodoUpdated }) => {
  const theme = useTheme();
  const currentView = useStore((state) => state.currentView);
  const maskOpacity = useStore((state) => state.maskOpacity);
  const pluginStoreFilters = useStore((state) => state.pluginStoreFilters);
  const pluginStoreCategories = useStore((state) => state.pluginStoreCategories);
  const setPluginStoreCategory = useStore((state) => state.setPluginStoreCategory);
  const setPluginStoreTab = useStore((state) => state.setPluginStoreTab);
  const settingsTabValue = useStore((state) => state.settingsTabValue);
  const setSettingsTabValue = useStore((state) => state.setSettingsTabValue);
  const aiConversations = useStore((state) => state.aiConversations);
  const aiActiveConvId = useStore((state) => state.aiActiveConvId);
  const aiSwitchConv = useStore((state) => state.aiSwitchConv);
  const aiDeleteConv = useStore((state) => state.aiDeleteConv);
  const aiNewChat = useStore((state) => state.aiNewChat);
  const notesAll = useStore((state) => state.notes);
  const timelineFilter = useStore((state) => state.timelineFilter);
  const setTimelineFilter = useStore((state) => state.setTimelineFilter);
  const toggleTimelineType = useStore((state) => state.toggleTimelineType);
  const toggleTimelineTag = useStore((state) => state.toggleTimelineTag);
  const resetTimelineFilter = useStore((state) => state.resetTimelineFilter);
  const [aiContextMenu, setAiContextMenu] = useState(null);
  const [aiMultiSelectMode, setAiMultiSelectMode] = useState(false);
  const [aiSelectedConvIds, setAiSelectedConvIds] = useState([]);

  const sidebarItemSx = (active = false) => ({
    borderRadius: '12px',
    mb: 0.5,
    px: 1.25,
    minHeight: 40,
    border: '1px solid',
    borderColor: active
      ? 'primary.main'
      : 'transparent',
    bgcolor: active
      ? (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(25,118,210,0.08)'
      : 'transparent',
    transition: 'background-color 180ms cubic-bezier(0.32,0.72,0,1), border-color 180ms cubic-bezier(0.32,0.72,0,1), color 180ms cubic-bezier(0.32,0.72,0,1)',
    '&:hover': {
      bgcolor: active
        ? (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.11)' : 'rgba(25,118,210,0.11)'
        : (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.055)' : 'rgba(15,23,42,0.045)',
      borderColor: active
        ? 'primary.main'
        : (theme) => theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)',
    },
    '&.Mui-selected': {
      bgcolor: active
        ? (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(25,118,210,0.08)'
        : undefined,
    },
  });

  const handleAiContextMenu = (event, conv) => {
    event.preventDefault();
    setAiContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      conv
    });
  };

  const closeAiContextMenu = () => {
    setAiContextMenu(null);
  };

  const toggleAiSelected = (id) => {
    setAiSelectedConvIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const enterAiMultiSelectMode = (id) => {
    setAiMultiSelectMode(true);
    setAiSelectedConvIds(id ? [id] : []);
  };

  const exitAiMultiSelectMode = () => {
    setAiMultiSelectMode(false);
    setAiSelectedConvIds([]);
  };

  // 将 AI 多选状态桥接给 App 顶层 MultiSelectToolbar
  useEffect(() => {
    if (currentView !== 'ai') {
      return;
    }

    onMultiSelectChange?.({
      isActive: aiMultiSelectMode,
      selectedIds: aiSelectedConvIds,
      selectedCount: aiSelectedConvIds.length,
      totalCount: aiConversations.length,
      itemType: 'AI对话'
    });

    if (!aiMultiSelectMode) {
      onMultiSelectRefChange?.(null);
      return;
    }

    onMultiSelectRefChange?.({
      selectAll: () => setAiSelectedConvIds(aiConversations.map((conv) => conv.id)),
      selectNone: () => setAiSelectedConvIds([]),
      exitMultiSelectMode: exitAiMultiSelectMode
    });
  }, [
    currentView,
    aiMultiSelectMode,
    aiSelectedConvIds,
    aiConversations,
    onMultiSelectChange,
    onMultiSelectRefChange
  ]);

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
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
            <Box sx={{ flex: 1, minHeight: 0, height: '100%', display: 'flex', overflow: 'hidden' }}>
              <NoteList showDeleted={showDeleted} onMultiSelectChange={onMultiSelectChange} onMultiSelectRefChange={onMultiSelectRefChange} />
            </Box>
          </Box>
        );
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
            onTodoUpdated={onTodoUpdated}
          />
        );
      case 'calendar':
        return (
          <MyDayPanel
            selectedDate={selectedDate}
            onTodoSelect={onTodoSelect}
            refreshToken={calendarRefreshTrigger}
            onTodoUpdated={onTodoUpdated}
            showCompleted={showCompleted}
            onMultiSelectChange={onMultiSelectChange}
            onMultiSelectRefChange={onMultiSelectRefChange}
          />
        );
      case 'timeline': {
        const allTags = Array.from(new Set(
          (notesAll || [])
            .filter((n) => !n.is_deleted)
            .flatMap((n) => Array.isArray(n.tags) ? n.tags : [])
            .filter(Boolean)
        )).sort()

        const typeOptions = [
          { id: 'note', label: '笔记', icon: <NotesIcon fontSize="small" /> },
          { id: 'whiteboard', label: '白板', icon: <WhiteboardIcon fontSize="small" /> },
          { id: 'todo', label: '待办', icon: <AddTaskIcon fontSize="small" /> }
        ]
        const normalizedTypes = normalizeTimelineTypes(timelineFilter.types)
        const dateOptions = [
          { id: 'all', label: '全部' },
          { id: 'today', label: '今天' },
          { id: 'week', label: '本周' },
          { id: 'month', label: '本月' }
        ]
        const quickOptions = [
          { id: 'all', label: '全部' },
          { id: 'open', label: '未处理' },
          { id: 'media', label: '有媒体' },
          { id: 'inbox', label: '待整理' }
        ]

        const filterActive =
          timelineFilter.search.trim() ||
          timelineFilter.tags.length > 0 ||
          timelineFilter.dateRange !== 'all' ||
          !isDefaultTimelineTypes(timelineFilter.types) ||
          !timelineFilter.showCompleted ||
          timelineFilter.showFuture ||
          (timelineFilter.quickMode || 'all') !== 'all'

        const filterSectionSx = (themeObj) => ({
          p: 1.25,
          borderRadius: '16px',
          border: '1px solid',
          borderColor: themeObj.palette.mode === 'dark' ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.07)',
          bgcolor: themeObj.palette.mode === 'dark' ? 'rgba(15,23,42,0.34)' : 'rgba(255,255,255,0.58)',
          boxShadow: themeObj.palette.mode === 'dark'
            ? '0 10px 26px rgba(0,0,0,0.12)'
            : '0 10px 26px rgba(15,23,42,0.045)'
        })

        const sectionTitleSx = {
          fontSize: 12,
          fontWeight: 700,
          color: 'text.secondary',
          mb: 1
        }

        return (
          <Box
            sx={(themeObj) => ({
              p: 1.5,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              backgroundColor: themeObj.palette.mode === 'dark'
                ? 'rgba(15,23,42,0.42)'
                : 'rgba(248,251,255,0.72)',
              backdropFilter: 'blur(16px) saturate(160%)',
              WebkitBackdropFilter: 'blur(16px) saturate(160%)',
              gap: 1.25
            })}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography sx={{ fontSize: 15, fontWeight: 750, lineHeight: 1.3 }}>筛选</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  {filterActive ? '已应用筛选条件' : '查看完整时间轴'}
                </Typography>
              </Box>
              {filterActive && (
                <IconButton size="small" onClick={resetTimelineFilter} title="重置筛选">
                  <ResetIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>

            <TextField
              fullWidth
              size="small"
              value={timelineFilter.search}
              onChange={(event) => setTimelineFilter({ search: event.target.value })}
              placeholder="搜索笔记 / 白板 / 待办 / 标签"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" fontSize="small" />
                    </InputAdornment>
                  )
                }
              }}
            />

            <Box sx={filterSectionSx}>
              <Typography sx={sectionTitleSx}>快捷视图</Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                {quickOptions.map((opt) => {
                  const active = (timelineFilter.quickMode || 'all') === opt.id
                  return (
                    <Chip
                      key={opt.id}
                      label={opt.label}
                      size="small"
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      onClick={() => setTimelineFilter({ quickMode: opt.id })}
                      sx={{ borderRadius: '10px', fontWeight: active ? 650 : 500 }}
                    />
                  )
                })}
              </Stack>
            </Box>

            <Box sx={filterSectionSx}>
              <Typography sx={sectionTitleSx}>只看</Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                {typeOptions.map((opt) => {
                  const active = normalizedTypes.includes(opt.id)
                  return (
                    <Chip
                      key={opt.id}
                      icon={opt.icon}
                      label={opt.label}
                      size="small"
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      onClick={() => toggleTimelineType(opt.id)}
                      sx={{ borderRadius: '10px', fontWeight: 650 }}
                    />
                  )
                })}
              </Stack>
            </Box>

            <Box sx={filterSectionSx}>
              <Typography sx={sectionTitleSx}>时间范围</Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                {dateOptions.map((opt) => {
                  const active = timelineFilter.dateRange === opt.id
                  return (
                    <Chip
                      key={opt.id}
                      label={opt.label}
                      size="small"
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      onClick={() => setTimelineFilter({ dateRange: opt.id })}
                      sx={{ borderRadius: '10px' }}
                    />
                  )
                })}
              </Stack>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                <Checkbox
                  size="small"
                  checked={timelineFilter.showCompleted}
                  onChange={(event) => setTimelineFilter({ showCompleted: event.target.checked })}
                  sx={{ p: 0.25 }}
                />
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>显示已完成待办</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
                <Checkbox
                  size="small"
                  checked={timelineFilter.showFuture === true}
                  onChange={(event) => setTimelineFilter({ showFuture: event.target.checked })}
                  sx={{ p: 0.25 }}
                />
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>显示未来内容</Typography>
              </Stack>
            </Box>

            <Box sx={{ ...filterSectionSx(theme), flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <TagIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <Typography sx={{ ...sectionTitleSx, mb: 0, flex: 1 }}>标签</Typography>
                {timelineFilter.tags.length > 0 && (
                  <Chip
                    label={`已选 ${timelineFilter.tags.length}`}
                    size="small"
                    sx={{ height: 20, fontSize: 11, borderRadius: '7px' }}
                  />
                )}
              </Stack>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
                {allTags.length === 0 ? (
                  <Box
                    sx={(themeObj) => ({
                      py: 3,
                      borderRadius: '12px',
                      textAlign: 'center',
                      color: 'text.secondary',
                      bgcolor: themeObj.palette.mode === 'dark' ? 'rgba(148,163,184,0.06)' : 'rgba(15,23,42,0.035)'
                    })}
                  >
                    <Typography sx={{ fontSize: 12 }}>暂无可用标签</Typography>
                  </Box>
                ) : (
                  <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                    {allTags.map((tag) => {
                      const active = timelineFilter.tags.includes(tag)
                      return (
                        <Chip
                          key={tag}
                          label={`#${tag}`}
                          size="small"
                          color={active ? 'primary' : 'default'}
                          variant={active ? 'filled' : 'outlined'}
                          onClick={() => toggleTimelineTag(tag)}
                          sx={{ borderRadius: '8px', fontSize: 12 }}
                        />
                      )
                    })}
                  </Stack>
                )}
              </Box>
            </Box>
          </Box>
        )
      }
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

            <List dense disablePadding sx={{ overflowY: 'auto' }}>
              {categories.map((category) => (
                <ListItemButton
                  key={category.id || category}
                  selected={pluginStoreFilters.category === (category.id || category)}
                  onClick={() => setPluginStoreCategory(category.id || category)}
                  sx={sidebarItemSx(pluginStoreFilters.category === (category.id || category))}
                >
                  <ListItemText
                    primary={(
                      <Typography sx={{
                        fontSize: 14,
                        fontWeight: pluginStoreFilters.category === (category.id || category) ? 600 : 400
                      }}>
                        {category.name || category}
                      </Typography>
                    )}
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
              ? 'rgba(15,23,42,0.38)'
              : 'rgba(255,255,255,0.58)',
            backdropFilter: 'blur(12px) saturate(150%)',
            WebkitBackdropFilter: 'blur(12px) saturate(150%)'
          })}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('settings.settings')}
            </Typography>

            <List dense disablePadding sx={{ overflowY: 'auto' }}>
              {settingsCategories.map((category) => (
                <ListItemButton
                  key={category.id}
                  selected={settingsTabValue === category.id}
                  onClick={() => setSettingsTabValue(category.id)}
                  sx={sidebarItemSx(settingsTabValue === category.id)}
                >
                  <ListItemIcon sx={{ minWidth: 38, color: settingsTabValue === category.id ? 'primary.main' : 'text.secondary' }}>
                    {category.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={(
                      <Typography sx={{
                        fontSize: 14,
                        fontWeight: settingsTabValue === category.id ? 600 : 400
                      }}>
                        {category.name}
                      </Typography>
                    )}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )
      }
      case 'ai': {
        const formatTime = (ts) => {
          const d = new Date(ts)
          const now = new Date()
          const diffDays = Math.floor((now - d) / 86400000)
          if (diffDays === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          if (diffDays === 1) return '昨天'
          if (diffDays < 7) return `${diffDays}天前`
          return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
        }

        return (
          <Box sx={(theme) => ({
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(30, 41, 59, 0.85)'
              : 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px) saturate(150%)',
            WebkitBackdropFilter: 'blur(12px) saturate(150%)'
          })}>
            <Box sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                对话历史
              </Typography>

              <List dense disablePadding sx={sidebarScrollableListSx}>
                {aiConversations.map((conv) => (
                  <ListItemButton
                    key={conv.id}
                    selected={aiMultiSelectMode ? aiSelectedConvIds.includes(conv.id) : conv.id === aiActiveConvId}
                    onClick={() => {
                      if (aiMultiSelectMode) {
                        toggleAiSelected(conv.id);
                      } else {
                        aiSwitchConv(conv.id);
                      }
                    }}
                    onContextMenu={(e) => handleAiContextMenu(e, conv)}
                    sx={{
                      ...sidebarItemSx(aiMultiSelectMode ? aiSelectedConvIds.includes(conv.id) : conv.id === aiActiveConvId),
                      '&:hover .del-btn': { opacity: 1 },
                    }}
                  >
                    {aiMultiSelectMode && (
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          checked={aiSelectedConvIds.includes(conv.id)}
                          size="small"
                          sx={{ p: 0.5 }}
                        />
                      </ListItemIcon>
                    )}
                    <ListItemText
                      primary={(
                        <Typography noWrap sx={{
                          fontSize: 14,
                          fontWeight: conv.id === aiActiveConvId ? 600 : 400
                        }}>
                          {conv.title || '新对话'}
                        </Typography>
                      )}
                      secondary={(
                        <Typography component="span" color="text.secondary" sx={{ display: 'block', fontSize: '0.72rem' }}>
                          {formatTime(conv.updatedAt)}
                        </Typography>
                      )}
                    />
                    {!aiMultiSelectMode && (
                      <IconButton
                        className="del-btn"
                        size="small"
                        onClick={(e) => { e.stopPropagation(); aiDeleteConv(conv.id) }}
                        sx={{ opacity: 0, transition: 'opacity 0.15s', ml: 0.5 }}
                      >
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                  </ListItemButton>
                ))}
                {aiConversations.length === 0 && (
                  <Typography variant="caption" color="text.secondary"
                    sx={{ px: 2, py: 3, display: 'block', textAlign: 'center' }}>
                    暂无历史对话
                  </Typography>
                )}
              </List>
            </Box>

            <Menu
              open={Boolean(aiContextMenu)}
              onClose={closeAiContextMenu}
              anchorReference="anchorPosition"
              anchorPosition={aiContextMenu ? { top: aiContextMenu.mouseY, left: aiContextMenu.mouseX } : undefined}
            >
              <MenuItem
                onClick={() => {
                  if (aiContextMenu?.conv?.id) {
                    enterAiMultiSelectMode(aiContextMenu.conv.id);
                  }
                  closeAiContextMenu();
                }}
                disabled={aiMultiSelectMode || !aiContextMenu?.conv?.id}
              >
                <ListItemIcon>
                  <SelectAllIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('common.enterMultiSelect')}</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  if (aiContextMenu?.conv?.id) {
                    aiSwitchConv(aiContextMenu.conv.id);
                  }
                  closeAiContextMenu();
                }}
                disabled={aiMultiSelectMode || !aiContextMenu?.conv?.id || aiContextMenu?.conv?.id === aiActiveConvId}
              >
                切换到此对话
              </MenuItem>
              <MenuItem
                onClick={() => {
                  if (aiContextMenu?.conv?.id) {
                    aiDeleteConv(aiContextMenu.conv.id);
                  }
                  closeAiContextMenu();
                }}
                disabled={aiMultiSelectMode || !aiContextMenu?.conv?.id}
              >
                删除对话
              </MenuItem>
              <MenuItem
                onClick={() => {
                  aiNewChat();
                  closeAiContextMenu();
                }}
                disabled={aiMultiSelectMode}
              >
                新建对话
              </MenuItem>
            </Menu>
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
