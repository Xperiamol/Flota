import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Avatar,
  Button,
  Alert,
  Tooltip,
  ButtonBase,
  IconButton,
  InputBase,
  LinearProgress,
  alpha,
} from '@mui/material';
import { useShallow } from 'zustand/react/shallow';
import {
  Person as PersonIcon,
  Close as CloseIcon,
  WidthFull as WideIcon,
  WidthNormal as NarrowIcon,
  DashboardCustomizeRounded as CustomizeIcon,
} from '../common/AppIcons';
import { useStore } from '../../store/useStore';
import { fetchTodoStats } from '../../api/todoAPI';
import { fetchActivityHeatmap } from '../../api/noteAPI';
import { fetchInstalledPlugins } from '../../api/pluginAPI';
import { useTranslation } from '../../utils/i18n';
import { useError } from '../common/ErrorProvider';
import FlotaAIIcon from '../common/FlotaAIIcon';
import HomeWidgetCard from '../widgets/HomeWidgetCard';
import HomeAddPanel from './HomeAddPanel';
import {
  FocusCard, HeatmapCard, NotesOverviewCard, OverdueCard, PluginsCard, RecentNotesCard, TodayTodosCard, TodoRateCard, TopWordsCard
} from './homeCards';
import { useHomeStore, parseWidgetCardId } from '../../store/useHomeStore';
import { askAI, openAI } from '../../utils/widgets/askAI';

const DEFAULT_TODO_STATS = {
  total: 0,
  completed: 0,
  pending: 0,
  overdue: 0,
  dueToday: 0,
  completedOnTime: 0,
  completedWithDueDate: 0,
  onTimeRate: 0,
  todayCompleted: 0,
  todayWorkload: 0,
  todayCompletionRate: null,
  totalFocusTime: 0,
  todayFocusTime: 0,
  weekFocusTime: 0,
  monthFocusTime: 0,
};
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很',
  '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '这个', '那个',
  '可以', '因为', '所以', '如果', '然后', '已经', '已有', '复制', '链接', '广告', '联系'
]);

// 网格：列宽自适应，卡片按内容高度占行（瀑布流），宽卡片占两列
const GRID_ROW = 4;
const GRID_GAP = 16;
// 热力图最多显示半年，实际显示多少周由卡片宽度决定
const HEATMAP_DAYS = 182;

const formatLocalDateKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

/**
 * 首页网格里的一格：量出内容高度换算成占用的行数；编辑时可拖动、改宽度、移除。
 * 编辑时用一层遮罩盖住卡片内容，避免误触跳转或操作组件。
 */
const HomeGridItem = ({ wide, fullWidth, editing, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, onToggleWide, children }) => {
  const contentRef = useRef(null);
  const [rows, setRows] = useState(20);
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;
    const measure = () => setRows(Math.max(1, Math.ceil((element.getBoundingClientRect().height + GRID_GAP) / GRID_ROW)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Box sx={{ gridRowEnd: `span ${rows}`, gridColumn: fullWidth ? '1 / -1' : wide ? { xs: 'auto', md: 'span 2' } : 'auto', minWidth: 0 }}>
      <Box
        ref={contentRef}
        draggable={editing}
        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
        onDragOver={(event) => { if (!editing) return; event.preventDefault(); onDragOver(); }}
        onDrop={(event) => { event.preventDefault(); onDrop(); }}
        onDragEnd={onDragEnd}
        sx={(theme) => ({
          position: 'relative',
          borderRadius: '14px',
          outline: editing ? `1.5px ${dragOver ? 'solid' : 'dashed'} ${alpha(theme.palette.primary.main, dragOver ? 0.9 : 0.4)}` : 'none',
          outlineOffset: 2,
          cursor: editing ? 'grab' : undefined,
        })}
      >
        {children}
        {editing && <Box sx={{ position: 'absolute', inset: 0, zIndex: 1 }} />}
        {editing && (
          <Box sx={(theme) => ({
            position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'flex', gap: 0.25, p: 0.25,
            borderRadius: '9px', bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`,
          })}>
            <Tooltip title={wide ? '改为窄卡片' : '改为宽卡片'}>
              <IconButton size="small" aria-label={wide ? '改为窄卡片' : '改为宽卡片'} onClick={onToggleWide} sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
                {wide ? <NarrowIcon sx={{ fontSize: 17 }} /> : <WideIcon sx={{ fontSize: 17 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title="移除卡片">
              <IconButton size="small" aria-label="移除卡片" onClick={onRemove}><CloseIcon sx={{ fontSize: 17 }} /></IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
};

const Profile = () => {
  const { t } = useTranslation();
  const { showError } = useError();
  const { notes, userAvatar, primaryColor, setCurrentView, setSettingsTabValue, setTodoNavigationRequest, userName, christmasMode } = useStore(useShallow((state) => ({
    notes: state.notes,
    userAvatar: state.userAvatar,
    primaryColor: state.primaryColor,
    setCurrentView: state.setCurrentView,
    setSettingsTabValue: state.setSettingsTabValue,
    setTodoNavigationRequest: state.setTodoNavigationRequest,
    userName: state.userName,
    christmasMode: state.christmasMode,
  })));
  const [todoStats, setTodoStats] = useState(null);
  const [activityCounts, setActivityCounts] = useState(null);
  const [installedPlugins, setInstalledPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cards = useHomeStore((state) => state.cards);
  const wide = useHomeStore((state) => state.wide);
  const editing = useHomeStore((state) => state.editing);
  const { setEditing, moveCard, removeCard, toggleWide } = useHomeStore.getState();
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [aiDraft, setAiDraft] = useState('');

  // 离开首页时退出编辑
  useEffect(() => () => useHomeStore.getState().setEditing(false), []);

  // 笔记页搜索会把全局笔记列表换成搜索结果；首页需要完整列表
  useEffect(() => {
    const state = useStore.getState();
    if (state.searchQuery) {
      state.setSearchQuery('');
      state.loadNotes();
    }
  }, []);

  const refreshTodoStats = async () => {
    try {
      const result = await fetchTodoStats();
      if (result && typeof result === 'object') setTodoStats(result);
    } catch (err) {
      console.error('[首页] 刷新待办统计失败:', err);
    }
  };

  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true);
        setError(null);
        const todoStatsResult = await fetchTodoStats();
        setTodoStats(todoStatsResult && typeof todoStatsResult === 'object' ? todoStatsResult : DEFAULT_TODO_STATS);
        const pluginsResult = await fetchInstalledPlugins();
        if (Array.isArray(pluginsResult)) setInstalledPlugins(pluginsResult);
        // 基于变更日志的真实活动数据（精确到每天的编辑次数）
        const heatmapResult = await fetchActivityHeatmap(HEATMAP_DAYS);
        if (heatmapResult?.success && heatmapResult.data) setActivityCounts(heatmapResult.data);
      } catch (err) {
        console.error('[首页] 加载统计数据失败:', err);
        showError(err, '加载统计数据失败');
        setError('加载统计数据失败: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  const noteStats = useMemo(() => ({
    total: notes.length,
    deleted: notes.filter((note) => note.is_deleted).length,
    pinned: notes.filter((note) => note.is_pinned && !note.is_deleted).length,
    active: notes.filter((note) => !note.is_deleted).length,
  }), [notes]);

  const todoStatsDisplay = useMemo(() => ({ ...DEFAULT_TODO_STATS, ...(todoStats || {}) }), [todoStats]);

  // 过去半年每天的活动次数：优先用变更日志，没有时按笔记时间戳估算
  const heatmapDays = useMemo(() => {
    const counts = {};
    if (activityCounts) {
      Object.assign(counts, activityCounts);
    } else {
      notes.forEach((note) => {
        if (note.is_deleted) return;
        if (note.created_at) {
          const key = formatLocalDateKey(new Date(note.created_at));
          counts[key] = (counts[key] || 0) + 1;
        }
        if (note.updated_at && note.updated_at !== note.created_at) {
          const key = formatLocalDateKey(new Date(note.updated_at));
          counts[key] = (counts[key] || 0) + 1;
        }
      });
    }
    const today = new Date();
    return Array.from({ length: HEATMAP_DAYS }, (_, index) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (HEATMAP_DAYS - 1 - index));
      const key = formatLocalDateKey(date);
      return { date: key, count: counts[key] || 0 };
    });
  }, [notes, activityCounts]);

  const topWords = useMemo(() => {
    const wordMap = {};
    notes.forEach((note) => {
      if (note.is_deleted || !note.content) return;
      // 简单的中文分词（匹配 2-4 个连续的中文字符）
      (note.content.match(/[一-龥]{2,4}/g) || []).forEach((word) => {
        if (!STOP_WORDS.has(word)) wordMap[word] = (wordMap[word] || 0) + 1;
      });
    });
    return Object.entries(wordMap).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count }));
  }, [notes]);

  const handleEditProfile = () => {
    setSettingsTabValue(1);
    setCurrentView('settings');
  };

  const handleTodoFilterNavigation = (filterBy) => {
    setTodoNavigationRequest({ filterBy, viewMode: 'focus', showCompleted: false });
    setCurrentView('todo');
  };

  // 内置卡片点击后去往的页面
  const openCardTarget = (cardId) => {
    switch (cardId) {
      case 'todo-rate':
      case 'todo-today':
        return handleTodoFilterNavigation('today');
      case 'todo-overdue':
        return handleTodoFilterNavigation('overdue');
      case 'focus':
        return handleTodoFilterNavigation('all');
      case 'notes-overview':
      case 'recent-notes':
      case 'top-words':
        return setCurrentView('notes');
      case 'heatmap':
        return setCurrentView('timeline');
      case 'plugins':
        return useStore.getState().openPluginStore({ type: 'plugin', tab: 'installed' });
      default:
        return undefined;
    }
  };

  const getGreeting = () => {
    if (christmasMode) return '圣诞快乐';
    const hour = new Date().getHours();
    if (hour < 6) return t('profile.greetingNight');
    if (hour < 12) return t('profile.greetingMorning');
    if (hour < 14) return t('profile.greetingNoon');
    if (hour < 18) return t('profile.greetingAfternoon');
    if (hour < 22) return t('profile.greetingEvening');
    return t('profile.greetingNight');
  };

  const displayName = userName || t('profile.defaultUser');

  const renderBuiltinCard = (cardId) => {
    const open = () => openCardTarget(cardId);
    switch (cardId) {
      case 'todo-rate': return <TodoRateCard stats={todoStatsDisplay} onOpen={open} />;
      case 'todo-today': return <TodayTodosCard onOpen={open} onChanged={refreshTodoStats} />;
      case 'todo-overdue': return <OverdueCard stats={todoStatsDisplay} onOpen={open} />;
      case 'recent-notes': return <RecentNotesCard onOpen={open} />;
      case 'notes-overview': return <NotesOverviewCard noteStats={noteStats} onOpen={open} />;
      case 'focus': return <FocusCard stats={todoStatsDisplay} onOpen={open} />;
      case 'heatmap': return <HeatmapCard days={heatmapDays} notes={notes} onOpen={open} />;
      case 'top-words': return <TopWordsCard words={topWords} onOpen={open} />;
      case 'plugins': return <PluginsCard plugins={installedPlugins} onOpen={open} />;
      default: return null;
    }
  };

  const renderCard = (cardId) => {
    const instanceId = parseWidgetCardId(cardId);
    return instanceId ? <HomeWidgetCard instanceId={instanceId} editing={editing} /> : renderBuiltinCard(cardId);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <LinearProgress sx={{ width: '100%', maxWidth: 400 }} />
      </Box>
    );
  }

  const dateLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  // 一句话概括今天：还有几项待办、几项逾期
  const todaySummary = [
    todoStatsDisplay.dueToday > 0 ? `今天还有 ${todoStatsDisplay.dueToday} 项待办` : '今天没有待办',
    todoStatsDisplay.overdue > 0 ? `${todoStatsDisplay.overdue} 项已逾期` : '',
  ].filter(Boolean).join('，');

  const sendToAI = () => {
    const text = aiDraft.trim();
    if (!text) return openAI();
    setAiDraft('');
    askAI(text, { autoSend: true });
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', boxSizing: 'border-box', px: { xs: 2, md: 4 }, py: 3.5 }}>
      <Box sx={{ maxWidth: 1320, mx: 'auto' }}>
        {/* 问候与资料入口 */}
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, mb: 2.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{dateLabel}</Typography>
            <Typography component="h1" sx={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.015em', mt: 0.5 }} noWrap>
              {getGreeting()}，{displayName}
            </Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>{todaySummary}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {editing ? (
              <>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mr: 0.5 }}>拖动卡片调整顺序</Typography>
                <Button variant="contained" size="small" onClick={() => setEditing(false)}
                  sx={{ height: 34, px: 2.25, borderRadius: '999px' }}>
                  完成
                </Button>
              </>
            ) : (
              <ButtonBase onClick={() => setEditing(true)}
                sx={(theme) => {
                  const dark = theme.palette.mode === 'dark'
                  return {
                    height: 34, px: 1.5, gap: 0.75, borderRadius: '999px',
                    fontSize: 13.5, fontWeight: 500, color: 'text.primary',
                    // 放在实心面板上的玻璃按钮：浅底 + 细边 + 顶部高光
                    border: `1px solid ${theme.palette.divider}`,
                    backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(22,22,24,0.02)',
                    backgroundImage: dark
                      ? 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0))'
                      : 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.4))',
                    boxShadow: dark
                      ? 'inset 0 1px 0 rgba(255,255,255,0.08)'
                      : 'inset 0 1px 0 rgba(255,255,255,1), 0 1px 2px rgba(22,22,24,0.05)',
                    transition: 'background-color 150ms ease, border-color 150ms ease',
                    '&:hover': { backgroundColor: dark ? 'rgba(255,255,255,0.09)' : 'rgba(22,22,24,0.045)' },
                  }
                }}>
                <CustomizeIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
                编辑首页
              </ButtonBase>
            )}
            <Tooltip title={t('profile.editProfile')}>
              <ButtonBase onClick={handleEditProfile} aria-label={t('profile.editProfile')}
                sx={{ borderRadius: '999px', p: 0.25, '&:hover': { bgcolor: 'action.hover' } }}>
                <Avatar src={userAvatar} sx={{ width: 34, height: 34, bgcolor: primaryColor }}><PersonIcon fontSize="small" /></Avatar>
              </ButtonBase>
            </Tooltip>
          </Box>
        </Box>

        {/* 与 AI 小窗同一个入口：回车直接发送 */}
        <Box sx={(theme) => ({
          height: 46, mb: 3, pl: 1.75, pr: 0.75, display: 'flex', alignItems: 'center', gap: 1.25, borderRadius: '12px',
          bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`,
          transition: 'border-color 150ms ease', '&:focus-within': { borderColor: alpha(theme.palette.primary.main, 0.6) },
        })}>
          <FlotaAIIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <InputBase
            fullWidth
            value={aiDraft}
            placeholder="问 FlotaAI，或让它帮你做一个组件"
            onChange={(event) => setAiDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) sendToAI(); }}
            inputProps={{ 'aria-label': '问 FlotaAI' }}
            sx={{ fontSize: 14.5 }}
          />
          <Button size="small" onClick={sendToAI} sx={{ flexShrink: 0, borderRadius: '8px', minWidth: 0, px: 1.5, color: aiDraft.trim() ? 'primary.main' : 'text.secondary' }}>
            {aiDraft.trim() ? '发送' : '打开 AI'}
          </Button>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Box sx={{
            flex: 1,
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gridAutoRows: `${GRID_ROW}px`,
            gridAutoFlow: 'dense',
            columnGap: `${GRID_GAP}px`,
          }}>
            {cards.map((cardId) => (
              <HomeGridItem
                key={cardId}
                wide={Boolean(wide[cardId])}
                editing={editing}
                dragOver={dragOverId === cardId && dragId !== cardId}
                onDragStart={() => setDragId(cardId)}
                onDragOver={() => setDragOverId(cardId)}
                onDrop={() => { if (dragId) moveCard(dragId, cardId); setDragId(null); setDragOverId(null); }}
                onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                onRemove={() => removeCard(cardId)}
                onToggleWide={() => toggleWide(cardId)}
              >
                {renderCard(cardId)}
              </HomeGridItem>
            ))}
            {editing && (
              <HomeGridItem editing={false} fullWidth>
                <Box
                  onDragOver={(event) => { event.preventDefault(); setDragOverId(null); }}
                  onDrop={() => { if (dragId) moveCard(dragId, null); setDragId(null); }}
                  sx={{ height: 64, borderRadius: '14px', border: '1.5px dashed', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', fontSize: 13 }}
                >
                  拖到这里放到最后
                </Box>
              </HomeGridItem>
            )}
          </Box>
          {editing && <HomeAddPanel onClose={() => setEditing(false)} />}
        </Box>

        {!editing && cards.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 14, mb: 1.5 }}>首页还没有卡片</Typography>
            <Button variant="outlined" onClick={() => setEditing(true)}>编辑首页</Button>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default Profile;
