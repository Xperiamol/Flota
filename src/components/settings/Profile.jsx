import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Avatar,
  Button,
  Alert,
  Tooltip,
  ButtonBase,
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
  AddRounded as AddCardIcon,
  VisibilityOffRounded as VisibilityOffIcon,
  OpenInNewRounded as DesktopPinIcon,
} from '../common/AppIcons';
import AppContextMenu from '../common/AppContextMenu';
import { notifyInfo } from '../../utils/notify';
import { useStore } from '../../store/useStore';
import { useTranslation } from '../../utils/i18n';
import { useError } from '../common/ErrorProvider';
import FlotaAIIcon from '../common/FlotaAIIcon';
import HomeWidgetCard from '../widgets/HomeWidgetCard';
import PanelIconButton from '../common/PanelIconButton';
import HomeAddPanel from './HomeAddPanel';
import { useHomeCardData, homeCardTarget, renderBuiltinHomeCard } from './homeCardData';
import { useHomeStore, parseWidgetCardId } from '../../store/useHomeStore';
import { askAI, openAI } from '../../utils/widgets/askAI';
import { pinToDesktop, pinHomeCardToDesktop } from '../../utils/widgets/widgetActions';

// 网格：列宽自适应，卡片按内容高度占行（瀑布流），宽卡片占两列
const GRID_ROW = 4;
const GRID_GAP = 16;

/**
 * 首页网格里的一格：量出内容高度换算成占用的行数；编辑时可拖动、改宽度、移除。
 * 编辑时用一层遮罩盖住卡片内容，避免误触跳转或操作组件。
 */
const HomeGridItem = ({ wide, fullWidth, editing, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, onToggleWide, onPinToDesktop, children }) => {
  const [menu, setMenu] = useState(null);
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
        // 右键卡片：固定到桌面
        onContextMenu={(event) => {
          if (editing || !onPinToDesktop) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        sx={(theme) => ({
          position: 'relative',
          borderRadius: 1.5,
          outline: editing ? `1.5px ${dragOver ? 'solid' : 'dashed'} ${alpha(theme.palette.primary.main, dragOver ? 0.9 : 0.4)}` : 'none',
          outlineOffset: 2,
          cursor: editing ? 'grab' : undefined,
        })}
      >
        {children}
        {editing && <Box sx={{ position: 'absolute', inset: 0, zIndex: 1 }} />}
        {editing && (
          // 操作条骑在卡片上边框上（卡片内边距之外），不遮挡卡片标题和按钮
          <Box sx={(theme) => ({
            position: 'absolute', top: -13, right: 14, zIndex: 2, display: 'flex', gap: '2px', p: '2px',
            borderRadius: 1, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`,
            boxShadow: theme.palette.mode === 'dark' ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(22,22,24,0.1)',
            animation: 'homeEditPop 160ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            '@keyframes homeEditPop': { from: { opacity: 0, transform: 'scale(0.85)' }, to: { opacity: 1, transform: 'scale(1)' } },
          })}>
            <Box sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
              <PanelIconButton title={wide ? '改为窄卡片' : '改为宽卡片'} size="sm" onClick={onToggleWide}>
                {wide ? <NarrowIcon /> : <WideIcon />}
              </PanelIconButton>
            </Box>
            {onPinToDesktop && (
              <PanelIconButton title="固定到桌面" size="sm" onClick={onPinToDesktop}>
                <DesktopPinIcon />
              </PanelIconButton>
            )}
            <PanelIconButton title="移除卡片" size="sm" tone="danger" onClick={onRemove}>
              <CloseIcon />
            </PanelIconButton>
          </Box>
        )}
      </Box>
      {onPinToDesktop && (
        <AppContextMenu anchor={menu} onClose={() => setMenu(null)} items={[
          { label: '固定到桌面', icon: <DesktopPinIcon fontSize="small" />, onClick: onPinToDesktop },
        ]} />
      )}
    </Box>
  );
};

const Profile = () => {
  const { t } = useTranslation();
  const { showError } = useError();
  const { userAvatar, primaryColor, setCurrentView, setSettingsTabValue, setTodoNavigationRequest, userName, christmasMode } = useStore(useShallow((state) => ({
    userAvatar: state.userAvatar,
    primaryColor: state.primaryColor,
    setCurrentView: state.setCurrentView,
    setSettingsTabValue: state.setSettingsTabValue,
    setTodoNavigationRequest: state.setTodoNavigationRequest,
    userName: state.userName,
    christmasMode: state.christmasMode,
  })));
  // 待办在别处改了（桌面卡片、待办页、AI）时刷新首页卡片
  const [cardRefreshKey, setCardRefreshKey] = useState(0);
  useEffect(() => {
    return window.electronAPI?.todos?.onChanged?.(() => setCardRefreshKey((value) => value + 1));
  }, []);
  const homeData = useHomeCardData({ refreshKey: cardRefreshKey });
  const { loading, todoStatsDisplay } = homeData;
  const error = homeData.error ? '加载统计数据失败: ' + homeData.error.message : null;
  useEffect(() => { if (homeData.error) showError(homeData.error, '加载统计数据失败'); }, [homeData.error]);
  const cards = useHomeStore((state) => state.cards);
  const wide = useHomeStore((state) => state.wide);
  const editing = useHomeStore((state) => state.editing);
  const { setEditing, moveCard, removeCard, toggleWide } = useHomeStore.getState();
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [aiDraft, setAiDraft] = useState('');
  const [addAnchor, setAddAnchor] = useState(null);
  const [aiBarMenu, setAiBarMenu] = useState(null);
  const showAiBar = useHomeStore((state) => !state.aiBarHidden && !state.aiBarHiddenThisSession);

  // 离开首页时退出编辑
  useEffect(() => () => useHomeStore.getState().setEditing(false), []);
  useEffect(() => { if (!editing) setAddAnchor(null); }, [editing]);

  // 笔记页搜索会把全局笔记列表换成搜索结果；首页需要完整列表
  useEffect(() => {
    const state = useStore.getState();
    if (state.searchQuery) {
      state.setSearchQuery('');
      state.loadNotes();
    }
  }, []);

  const handleEditProfile = () => {
    setSettingsTabValue(1);
    setCurrentView('settings');
  };

  const handleTodoFilterNavigation = (filterBy) => {
    setTodoNavigationRequest({ filterBy, viewMode: 'focus', showCompleted: false });
    setCurrentView('todo');
  };

  // 内置卡片点击后去往的页面（与桌面卡片共用 homeCardTarget）
  const openCardTarget = (cardId) => {
    const target = homeCardTarget(cardId);
    if (!target) return undefined;
    if (target.pluginStore) return useStore.getState().openPluginStore({ type: 'plugin', tab: 'installed' });
    if (target.filterBy) return handleTodoFilterNavigation(target.filterBy);
    return setCurrentView(target.view);
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

  // 没设名字时只问候，不显示「用户」这样的占位词
  const displayName = userName?.trim() || '';

  const renderBuiltinCard = (cardId) => renderBuiltinHomeCard(cardId, homeData, () => openCardTarget(cardId));

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
              {displayName ? `${getGreeting()}，${displayName}` : getGreeting()}
            </Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>{todaySummary}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {editing ? (
              <>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mr: 0.5, display: { xs: 'none', md: 'block' } }}>拖动卡片调整顺序</Typography>
                <Button variant="outlined" size="small" startIcon={<AddCardIcon />} onClick={(event) => setAddAnchor(event.currentTarget)}
                  sx={{ height: 34, px: 1.75, borderRadius: '999px' }}>
                  添加卡片
                </Button>
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

        {/* 与 AI 小窗同一个入口：回车直接发送；可以本次隐藏或永久隐藏 */}
        {showAiBar && (
        <Box sx={(theme) => ({
          height: 46, mb: 2.5, pl: 1.75, pr: 0.75, display: 'flex', alignItems: 'center', gap: 1.25, borderRadius: 1.5,
          // 半透明：设了壁纸时不是一整条白块
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.5 : 0.72), border: `1px solid ${theme.palette.divider}`,
          transition: 'border-color 150ms ease', '&:focus-within': { borderColor: alpha(theme.palette.primary.main, 0.6) },
        })}>
          <FlotaAIIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <InputBase
            fullWidth
            value={aiDraft}
            placeholder="问 FlotaAI…"
            onChange={(event) => setAiDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) sendToAI(); }}
            inputProps={{ 'aria-label': '问 FlotaAI' }}
            sx={{ fontSize: 14.5 }}
          />
          <Button size="small" onClick={sendToAI} sx={{ flexShrink: 0, borderRadius: 1, minWidth: 0, px: 1.5, color: aiDraft.trim() ? 'primary.main' : 'text.secondary' }}>
            {aiDraft.trim() ? '发送' : '打开 AI'}
          </Button>
          <PanelIconButton title="隐藏输入框" size="sm" onClick={(event) => setAiBarMenu({ el: event.currentTarget })} sx={{ mr: 0.25 }}>
            <CloseIcon />
          </PanelIconButton>
        </Box>
        )}
        <AppContextMenu anchor={aiBarMenu} onClose={() => setAiBarMenu(null)} items={[
          { label: '本次不显示', icon: <VisibilityOffIcon fontSize="small" />, onClick: () => useHomeStore.getState().hideAiBarThisSession() },
          {
            label: '不再显示', icon: <CloseIcon fontSize="small" />,
            onClick: () => {
              useHomeStore.getState().setAiBarHidden(true);
              notifyInfo('已隐藏。可以在「编辑首页 → 添加卡片」或「设置 → AI」里重新打开');
            },
          },
        ]} />

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        <Box>
          <Box sx={{
            minWidth: 0,
            // 编辑时卡片顶上有操作条，留出位置
            pt: editing ? 1 : 0,
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
                onPinToDesktop={() => {
                  const instanceId = parseWidgetCardId(cardId);
                  return instanceId ? pinToDesktop(instanceId, { size: 'compact' }) : pinHomeCardToDesktop(cardId);
                }}
              >
                {renderCard(cardId)}
              </HomeGridItem>
            ))}
            {editing && (
              <HomeGridItem editing={false} fullWidth>
                <Box
                  onDragOver={(event) => { event.preventDefault(); setDragOverId(null); }}
                  onDrop={() => { if (dragId) moveCard(dragId, null); setDragId(null); }}
                  sx={{ height: 64, borderRadius: 1.5, border: '1.5px dashed', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', fontSize: 13 }}
                >
                  拖到这里放到最后
                </Box>
              </HomeGridItem>
            )}
          </Box>
        </Box>
        {/* 添加卡片：弹出面板，不再占网格的一列（以前一进编辑模式整个布局就重排） */}
        <HomeAddPanel anchorEl={addAnchor} onClose={() => setAddAnchor(null)} />

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
