import { useCallback, useEffect, useState } from 'react';
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
import FlotaAIIcon from '../common/FlotaAIIcon';
import { useStore } from '../../store/useStore';
import NoteList from '../notes/NoteList';
import TodoList from '../todos/TodoList';
import MyDayPanel from '../todos/MyDayPanel';
import { t } from '../../utils/i18n';
import { compactGlassPanelSx, thinScrollbarSx } from '../../styles/commonStyles';

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
  ...thinScrollbarSx,
  flex: 1,
  pr: '4px',
  mr: '-10px',
};

const compactPanelSx = compactGlassPanelSx;

const compactTitleSx = {
  mb: 1,
  fontSize: 15,
  fontWeight: 750,
  lineHeight: 1.3
};

const compactSectionLabelSx = {
  mb: 0.75,
  color: 'text.secondary',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.2
};

const SecondarySidebar = ({ open, width = 304, onTodoSelect, onViewModeChange, onShowCompletedChange, viewMode, showCompleted, onMultiSelectChange, onMultiSelectRefChange, todoRefreshTrigger, todoSortBy, onTodoSortByChange, showDeleted, selectedDate, calendarRefreshTrigger, onTodoUpdated }) => {
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
  const selectedNoteId = useStore((state) => state.selectedNoteId);
  const aiNoteConversationMap = useStore((state) => state.aiNoteConversationMap);
  // 列表高亮必须与对话正文（AIChatView）用同一个"当前对话"公式，否则会出现
  // "高亮的是 A、正文显示的是 B"的错位——这正是 AI 功能页列表切换的 bug 根源。
  // 浮窗没有列表所以从不暴露此错位。
  const aiCurrentConvId = selectedNoteId != null
    ? (aiNoteConversationMap?.[String(selectedNoteId)] || null)
    : (aiActiveConvId || null);
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
    borderRadius: '10px',
    mb: 0.25,
    px: 1,
    py: 0.25,
    minHeight: 36,
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
    '& .MuiListItemText-root': {
      my: 0
    },
    '& .MuiSvgIcon-root': {
      fontSize: 18
    }
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

  const clearSharedMultiSelectBridge = useCallback(() => {
    onMultiSelectChange?.({
      isActive: false,
      selectedIds: [],
      selectedCount: 0,
      totalCount: 0,
      itemType: ''
    });
    onMultiSelectRefChange?.(null);
  }, [onMultiSelectChange, onMultiSelectRefChange]);

  // 将 AI 多选状态桥接给 App 顶层 MultiSelectToolbar
  useEffect(() => {
    if (currentView !== 'ai') {
      if (aiMultiSelectMode || aiSelectedConvIds.length > 0) {
        setAiMultiSelectMode(false);
        setAiSelectedConvIds([]);
      }
      clearSharedMultiSelectBridge();
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
    onMultiSelectRefChange,
    clearSharedMultiSelectBridge
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
          { id: 'whiteboard', label: '画布', icon: <WhiteboardIcon fontSize="small" /> },
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
          p: 1,
          borderRadius: '12px',
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
          mb: 0.75
        }

        return (
          <Box
            sx={(themeObj) => ({
              ...compactPanelSx(themeObj),
              gap: 1
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
              placeholder="搜索笔记 / 画布 / 待办 / 标签"
              sx={{
                '& .MuiOutlinedInput-root': {
                  height: 34,
                  borderRadius: '12px',
                  fontSize: '0.8125rem'
                }
              }}
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
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.75 }}>
                <Checkbox
                  size="small"
                  checked={timelineFilter.showCompleted}
                  onChange={(event) => setTimelineFilter({ showCompleted: event.target.checked })}
                  sx={{ p: 0.25 }}
                />
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>显示已完成待办</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.5 }}>
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
            ...compactPanelSx(theme)
          })}>
            <Typography sx={compactTitleSx}>
              {t('sidebar.plugins')}
            </Typography>

            <Stack direction="row" spacing={0.75} sx={{ mb: 1.25 }}>
              {tabs.map((tab) => (
                <Chip
                  key={tab.id}
                  label={tab.label}
                  color={pluginStoreFilters.tab === tab.id ? 'primary' : 'default'}
                  variant={pluginStoreFilters.tab === tab.id ? 'filled' : 'outlined'}
                  onClick={() => setPluginStoreTab(tab.id)}
                  size="small"
                  sx={{ cursor: 'pointer', borderRadius: '9px', fontWeight: 650 }}
                />
              ))}
            </Stack>

            <Typography sx={compactSectionLabelSx}>
              {t('plugins.categories')}
            </Typography>

            <List dense disablePadding sx={sidebarScrollableListSx}>
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
                        fontSize: 13,
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
          { id: 3, name: t('settings.ai'), icon: <FlotaAIIcon sx={{ fontSize: 22 }} /> },
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
            ...compactPanelSx(theme)
          })}>
            <Typography sx={compactTitleSx}>
              {t('settings.settings')}
            </Typography>

            <List dense disablePadding sx={sidebarScrollableListSx}>
              {settingsCategories.map((category) => (
                <ListItemButton
                  key={category.id}
                  selected={settingsTabValue === category.id}
                  onClick={() => setSettingsTabValue(category.id)}
                  sx={sidebarItemSx(settingsTabValue === category.id)}
                >
                  <ListItemIcon sx={{ minWidth: 32, color: settingsTabValue === category.id ? 'primary.main' : 'text.secondary' }}>
                    {category.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={(
                      <Typography sx={{
                        fontSize: 13,
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
            ...compactPanelSx(theme)
          })}>
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <Typography sx={compactTitleSx}>
                对话历史
              </Typography>

              <List dense disablePadding sx={sidebarScrollableListSx}>
                {aiConversations.map((conv) => (
                  <ListItemButton
                    key={conv.id}
                    selected={aiMultiSelectMode ? aiSelectedConvIds.includes(conv.id) : conv.id === aiCurrentConvId}
                    onClick={() => {
                      if (aiMultiSelectMode) {
                        toggleAiSelected(conv.id);
                      } else {
                        aiSwitchConv(conv.id);
                      }
                    }}
                    onContextMenu={(e) => handleAiContextMenu(e, conv)}
                    sx={{
                      ...sidebarItemSx(aiMultiSelectMode ? aiSelectedConvIds.includes(conv.id) : conv.id === aiCurrentConvId),
                      '&:hover .del-btn': { opacity: 1 },
                    }}
                  >
                    {aiMultiSelectMode && (
                      <ListItemIcon sx={{ minWidth: 30 }}>
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
                          fontSize: 13,
                          fontWeight: conv.id === aiCurrentConvId ? 600 : 400
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
                        sx={{ opacity: 0, transition: 'opacity 0.15s', ml: 0.25, width: 26, height: 26 }}
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
                disabled={aiMultiSelectMode || !aiContextMenu?.conv?.id || aiContextMenu?.conv?.id === aiCurrentConvId}
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
