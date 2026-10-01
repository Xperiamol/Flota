import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useError } from '../common/ErrorProvider';
import {
  Box,
  Typography,
  Button,
  ButtonBase,
  Alert,
  CircularProgress,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Switch,
  TextField,
  InputAdornment,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircleOutline as CheckIcon,
} from '../common/AppIcons';
import AppContextMenu from '../common/AppContextMenu';
import {
  rowActionRevealSx,
  settingsRowSx,
  settingsSectionSx,
  sectionTitleSx,
} from '../../styles/commonStyles';
import { isImeComposing } from '../../utils/imeUtils';

const USER_ID = 'current_user';

// 分层用主题色的深浅区分，不另起一套彩色
const LAYERS = [
  { id: 'profile', label: '偏好', shade: 1 },
  { id: 'semantic', label: '知识', shade: 0.68 },
  { id: 'episodic', label: '近况', shade: 0.42 },
  { id: 'artifact', label: '笔记与待办', shade: 0.2 },
];
const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

const SOURCE_LABELS = {
  user_manual: '手动添加',
  ai_auto: '自动记忆',
  ai_extract: 'AI 保存',
  user_note: '来自笔记',
  user_todo: '来自待办',
  historical_analysis: '历史分析',
};

const HEATMAP_WEEKS = 26;
const CELL = 10;
const GAP = 3;

const formatDate = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '');

const formatRelative = (ts) => {
  if (!ts) return '尚未整理';
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return '刚刚整理';
  if (minutes < 60) return `${minutes} 分钟前整理`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前整理`;
  return `${Math.floor(hours / 24)} 天前整理`;
};

const formatMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

// 周一 = 0
const d0 = (date) => (date.getDay() + 6) % 7;

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const insetSx = (theme) => ({
  bgcolor: theme.custom?.surface?.inset,
  borderRadius: '14px',
});

// 占位块的呼吸动画
const pulseSx = {
  '@keyframes memPulseBlock': { '0%, 100%': { opacity: 0.5 }, '50%': { opacity: 1 } },
  animation: 'memPulseBlock 1.6s ease-in-out infinite',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
};

const SkeletonBlock = ({ width, height, radius = 6, sx }) => (
  <Box sx={[(theme) => ({ width, height, borderRadius: `${radius}px`, bgcolor: theme.custom?.surface?.active }), pulseSx, ...(sx ? [sx] : [])]} />
);

const ModelTileSkeleton = () => (
  <Box sx={(theme) => ({ ...insetSx(theme), p: 2, minHeight: 112, display: 'flex', flexDirection: 'column', gap: 1 })}>
    <SkeletonBlock width="46%" height={14} />
    <SkeletonBlock width="28%" height={10} />
    <SkeletonBlock width={52} height={26} radius={8} sx={{ mt: 'auto', alignSelf: 'flex-end' }} />
  </Box>
);

/* ── 状态点 ── */
const StatusDot = ({ state }) => {
  const color = state === 'ready' ? 'success.main' : state === 'failed' ? 'error.main' : 'warning.main';
  const label = { ready: '运行中', failed: '启动失败', restart: '需要重启' }[state] || '启动中';
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ position: 'relative', width: 8, height: 8 }}>
        <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', bgcolor: color }} />
        {state !== 'failed' && state !== 'restart' && (
          <Box sx={{
            position: 'absolute', inset: 0, borderRadius: '50%', bgcolor: color,
            animation: 'memPulse 2.4s ease-out infinite',
            '@keyframes memPulse': { '0%': { transform: 'scale(1)', opacity: 0.5 }, '80%, 100%': { transform: 'scale(2.6)', opacity: 0 } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }} />
        )}
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 650, color }}>{label}</Typography>
    </Box>
  );
};

/* ── 近 26 周新增热力图 ── */
const ActivityHeatmap = ({ activity, loading = false }) => {
  const { weeks, max } = useMemo(() => {
    const counts = new Map((activity || []).map((a) => [a.day, a.count]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 以周一为一列的开头，最后一列包含今天
    const start = new Date(today);
    start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (HEATMAP_WEEKS - 1) * 7);
    const cols = [];
    let peak = 0;
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const future = date > today;
        const count = future ? 0 : counts.get(dayKey(date)) || 0;
        peak = Math.max(peak, count);
        col.push({ date, count, future });
      }
      cols.push(col);
    }
    return { weeks: cols, max: peak };
  }, [activity]);

  return (
    // 右对齐：窗口窄时裁掉最早的几周，最近的几周始终可见
    <Box sx={{
      display: 'flex', justifyContent: 'flex-end', gap: `${GAP}px`, overflow: 'hidden', maxWidth: '100%',
      // 加载时一道斜向的波从左上扫到右下
      '@keyframes memWave': { '0%, 100%': { opacity: 0.08 }, '45%': { opacity: 0.6 } },
    }}>
      {weeks.map((col, w) => (
        <Box key={w} sx={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px` }}>
          {col.map(({ date, count, future }) => {
            if (loading) {
              return (
                <Box key={dayKey(date)} sx={(theme) => ({
                  width: CELL,
                  height: CELL,
                  borderRadius: '3px',
                  visibility: future ? 'hidden' : 'visible',
                  bgcolor: alpha(theme.palette.primary.main, 0.55),
                  opacity: 0.08,
                  animation: 'memWave 2.2s ease-in-out infinite',
                  animationDelay: `${(w + d0(date)) * 55}ms`,
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.12 },
                })} />
              );
            }
            const level = count === 0 || max === 0 ? 0 : Math.ceil((count / max) * 4);
            return (
              <Tooltip
                key={dayKey(date)}
                title={future ? '' : `${date.getMonth() + 1}月${date.getDate()}日 · ${count} 条`}
                disableInteractive
                placement="top"
              >
                <Box sx={(theme) => ({
                  width: CELL,
                  height: CELL,
                  borderRadius: '3px',
                  visibility: future ? 'hidden' : 'visible',
                  bgcolor: level === 0
                    ? theme.custom?.surface?.active
                    : alpha(theme.palette.primary.main, [0, 0.28, 0.5, 0.74, 1][level]),
                })} />
              </Tooltip>
            );
          })}
        </Box>
      ))}
    </Box>
  );
};

/* ── 分层构成条 + 图例（图例即筛选） ── */
const LayerBar = ({ byLayer, total, value, onChange }) => (
  <Box>
    <Box sx={(theme) => ({ display: 'flex', gap: '3px', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: theme.custom?.surface?.active })}>
      {LAYERS.map((layer) => {
        const count = byLayer?.[layer.id]?.count || 0;
        if (!count) return null;
        return (
          <Box key={layer.id} sx={(theme) => ({
            flexGrow: count,
            flexBasis: 0,
            minWidth: 8,
            bgcolor: alpha(theme.palette.primary.main, layer.shade),
            opacity: value === 'all' || value === layer.id ? 1 : 0.25,
            transition: 'opacity 160ms ease',
          })} />
        );
      })}
    </Box>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mt: 1.25 }}>
      {[{ id: 'all', label: '全部', count: total }, ...LAYERS.map((l) => ({ ...l, count: byLayer?.[l.id]?.count || 0 }))].map((item) => {
        const active = value === item.id;
        return (
          <ButtonBase
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75, borderRadius: '6px', px: 0.5, py: 0.25,
              color: active ? 'text.primary' : 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {item.shade && (
              <Box sx={(theme) => ({ width: 8, height: 8, borderRadius: '2px', bgcolor: alpha(theme.palette.primary.main, item.shade) })} />
            )}
            <Typography variant="caption" sx={{ fontWeight: active ? 700 : 500, fontSize: '0.78rem' }}>{item.label}</Typography>
            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', opacity: 0.7, fontSize: '0.78rem' }}>{item.count ?? 0}</Typography>
          </ButtonBase>
        );
      })}
    </Box>
  </Box>
);

/* ── 模型卡片 ── */
const ModelTile = ({ model, download, busy, onDownload, onCancel, onSwitch }) => {
  const progress = download ? Math.min(99, (download.loaded / download.total) * 100) : 0;
  return (
    <Box sx={(theme) => ({
      ...insetSx(theme),
      position: 'relative',
      overflow: 'hidden',
      p: 2,
      minHeight: 112,
      display: 'flex',
      flexDirection: 'column',
      outline: '1.5px solid',
      outlineColor: model.active ? alpha(theme.palette.primary.main, 0.55) : 'transparent',
      outlineOffset: '-1.5px',
      transition: 'outline-color 160ms ease',
    })}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{model.label}</Typography>
        {model.active && <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
        {model.bundled ? model.description : `${model.description} · ${model.sizeMB} MB`}
      </Typography>
      <Box sx={{ mt: 'auto', pt: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {download ? `${formatMB(download.loaded)} / ${formatMB(download.total)}` : model.active ? '使用中' : model.installed ? '已下载' : ''}
        </Typography>
        {download ? (
          <Button size="small" onClick={onCancel}>取消</Button>
        ) : !model.active && (
          <Button size="small" variant="outlined" onClick={model.installed ? onSwitch : onDownload} disabled={busy}>
            {model.installed ? '切换' : '下载'}
          </Button>
        )}
      </Box>
      {download && (
        <LinearProgress variant="determinate" value={progress} sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 }} />
      )}
    </Box>
  );
};

const Mem0Settings = () => {
  const { showError } = useError();
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [memories, setMemories] = useState([]);
  const [layer, setLayer] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState(null);
  const [indexing, setIndexing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [menu, setMenu] = useState(null); // { anchor, memory }
  const [editing, setEditing] = useState(null); // { id, content }
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const ready = status?.state === 'ready';
  const api = window.electronAPI?.mem0;
  const wasReadyRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api?.status?.());
    } catch (error) {
      // 渲染层热更新了、主进程还是旧的：没有这个接口，等多久都不会好
      if (/No handler registered/i.test(error?.message || '')) {
        setStatus({ state: 'restart', models: [] });
      } else {
        showError(error, '读取记忆引擎状态失败');
      }
    }
  }, [api, showError]);

  const loadData = useCallback(async () => {
    if (!api) return;
    try {
      const [statsResult, listResult] = await Promise.all([
        api.stats({ userId: USER_ID }),
        api.get({ userId: USER_ID, options: { limit: 300, ...(layer !== 'all' ? { layer } : {}) } }),
      ]);
      if (statsResult?.success) setStats(statsResult.stats);
      setMemories(listResult?.success && Array.isArray(listResult.memories) ? listResult.memories : []);
    } catch (error) {
      showError(error, '加载记忆失败');
    }
  }, [api, layer, showError]);

  useEffect(() => {
    loadStatus();
    return api?.onStatusChanged?.((next) => setStatus(next));
  }, [api, loadStatus]);

  useEffect(() => {
    if (ready) loadData();
  }, [ready, layer, loadData]);

  // 重算向量结束后刷新一次
  useEffect(() => {
    if (wasReadyRef.current && ready && !status?.reindex) loadData();
    wasReadyRef.current = ready;
  }, [ready, status?.reindex, loadData]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const result = await api.retryInit();
      if (!result?.success) setMessage({ type: 'error', text: `启动失败：${result?.error || '未知错误'}` });
    } finally {
      setRetrying(false);
      loadStatus();
    }
  };

  const handleToggleAuto = async (checked) => {
    const result = await api.setSetting({ key: 'auto_memory', value: checked });
    if (!result?.success) setMessage({ type: 'error', text: result?.error || '设置失败' });
    loadStatus();
  };

  const handleDownload = async (modelId) => {
    setMessage(null);
    const result = await api.downloadModel({ modelId });
    if (result?.success) setMessage({ type: 'success', text: '已切换到新模型' });
    else if (!result?.cancelled) setMessage({ type: 'error', text: result?.error || '下载失败' });
    loadStatus();
  };

  const handleSetModel = async (modelId) => {
    const result = await api.setModel({ modelId });
    if (!result?.success) setMessage({ type: 'error', text: result?.error || '切换失败' });
    loadStatus();
  };

  const handleIndexNow = async () => {
    setIndexing(true);
    try {
      const result = await api.migrateHistorical();
      if (result?.success) {
        const changed = (result.memoryCount || 0) + (result.updatedCount || 0);
        setMessage({ type: 'success', text: changed > 0 ? `新增 ${result.memoryCount || 0} 条，更新 ${result.updatedCount || 0} 条` : '已是最新' });
      } else {
        setMessage({ type: 'error', text: result?.error || '整理失败' });
      }
      await Promise.all([loadData(), loadStatus()]);
    } finally {
      setIndexing(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const result = await api.cleanup();
      setMessage(result?.success
        ? { type: 'success', text: result.removed > 0 ? `已清理 ${result.removed} 条过期记忆` : '没有需要清理的记忆' }
        : { type: 'error', text: result?.error || '清理失败' });
      await loadData();
    } finally {
      setCleaning(false);
    }
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const result = await api.search({
        userId: USER_ID,
        query,
        options: { limit: 20, touch: false, ...(layer !== 'all' ? { layers: [layer] } : {}) },
      });
      setSearchResults(result?.success && Array.isArray(result.results) ? result.results : []);
    } catch (error) {
      showError(error, '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  const handleDelete = async (memory) => {
    const result = await api.delete({ memoryId: memory.id });
    if (!result?.success) {
      setMessage({ type: 'error', text: result?.error || '删除失败' });
      return;
    }
    setSearchResults((prev) => (prev ? prev.filter((m) => m.id !== memory.id) : prev));
    loadData();
  };

  const handleSaveEdit = async () => {
    const result = await api.update({ memoryId: editing.id, content: editing.content });
    if (!result?.success) {
      setMessage({ type: 'error', text: result?.error || '保存失败' });
      return;
    }
    setSearchResults((prev) => (prev ? prev.map((m) => (m.id === editing.id ? { ...m, content: editing.content.trim() } : m)) : prev));
    setEditing(null);
    loadData();
  };

  const handleClearAll = async () => {
    const result = await api.clear({ userId: USER_ID });
    setClearDialogOpen(false);
    if (result?.success) {
      clearSearch();
      setMessage({ type: 'success', text: '已清空全部记忆' });
      loadData();
    } else {
      setMessage({ type: 'error', text: result?.error || '清空失败' });
    }
  };

  const visible = searchResults ?? memories;
  const state = status?.state || 'loading';

  return (
    <Box>
      {message && (
        <Alert severity={message.type} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      {/* ═══ 总览 ═══ */}
      <Box sx={(theme) => ({ ...insetSx(theme), p: { xs: 2, sm: 2.5 }, mb: 3 })}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <StatusDot state={state} />
          {ready && (
            <Button size="small" onClick={handleIndexNow} disabled={indexing} sx={{ mr: -1 }}>
              {indexing ? '整理中…' : '立即整理'}
            </Button>
          )}
          {state === 'failed' && (
            <Button size="small" variant="outlined" onClick={handleRetry} disabled={retrying}>
              {retrying ? '重试中…' : '重试'}
            </Button>
          )}
        </Box>

        {state === 'restart' ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            重启 Flota 后生效
          </Typography>
        ) : state === 'failed' ? (
          <Typography variant="body2" color="error" sx={{ mt: 1.5, wordBreak: 'break-word' }}>
            {status?.error || '未知错误'}
          </Typography>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, mt: 1, flexWrap: 'wrap' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  {ready ? (
                    <Typography sx={{ fontSize: 52, fontWeight: 750, lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>
                      {stats?.active ?? '—'}
                    </Typography>
                  ) : (
                    <SkeletonBlock width={104} height={44} radius={10} sx={{ alignSelf: 'center' }} />
                  )}
                  <Typography color="text.secondary" sx={{ fontWeight: 600 }}>条记忆</Typography>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  {ready ? formatRelative(status?.lastIndexedAt) : '正在加载模型'}
                </Typography>
              </Box>
              <ActivityHeatmap activity={stats?.activity} loading={!ready} />
            </Box>
            {!ready && <SkeletonBlock width="100%" height={8} radius={4} sx={{ mt: 2.5 }} />}
            {ready && (
              <Box sx={{ mt: 2.5 }}>
                <LayerBar
                  byLayer={stats?.by_layer}
                  total={stats?.active}
                  value={layer}
                  onChange={(id) => { setLayer(id); setSearchResults(null); }}
                />
              </Box>
            )}
          </>
        )}
      </Box>

      {/* ═══ 自动记忆 ═══ */}
      {state !== 'restart' && (<>
      <Box sx={settingsSectionSx}>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2 })}>
          <ListItemText
            primary="对话后自动记忆"
            secondary="回复下方会提示，可撤销"
            slotProps={{ primary: { sx: { fontWeight: 650 } } }}
          />
          <Switch
            checked={status?.autoMemory !== false}
            onChange={(e) => handleToggleAuto(e.target.checked)}
            disabled={!status?.models?.length}
          />
        </Box>
      </Box>

      {/* ═══ 向量模型 ═══ */}
      <Box sx={settingsSectionSx}>
        <Typography variant="h6" sx={{ ...sectionTitleSx, mb: 1.5 }}>向量模型</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          {!status?.models?.length && <><ModelTileSkeleton /><ModelTileSkeleton /></>}
          {(status?.models || []).map((model) => (
            <ModelTile
              key={model.id}
              model={model}
              download={status?.download?.modelId === model.id ? status.download : null}
              busy={!!status?.download || !!status?.reindex}
              onDownload={() => handleDownload(model.id)}
              onCancel={() => api.cancelDownload()}
              onSwitch={() => handleSetModel(model.id)}
            />
          ))}
        </Box>
        {status?.reindex && (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress
              variant="determinate"
              value={(status.reindex.done / Math.max(1, status.reindex.total)) * 100}
              sx={{ borderRadius: 1, height: 3 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              重新整理中 {status.reindex.done} / {status.reindex.total}
            </Typography>
          </Box>
        )}
      </Box>
      </>)}

      {/* ═══ 记忆列表 ═══ */}
      {ready && (
        <Box sx={settingsSectionSx}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
            <Typography variant="h6" sx={sectionTitleSx}>
              {layer === 'all' ? '记忆' : LAYER_BY_ID[layer]?.label}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mr: -1 }}>
              <Button size="small" onClick={handleCleanup} disabled={cleaning}>
                {cleaning ? '清理中…' : '清理过期'}
              </Button>
              <Button size="small" color="error" onClick={() => setClearDialogOpen(true)} disabled={!stats?.active}>
                清空
              </Button>
            </Box>
          </Box>

          <TextField
            fullWidth
            size="small"
            placeholder="搜索记忆"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!e.target.value) setSearchResults(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && !isImeComposing(e) && handleSearch()}
            sx={{ mb: 0.5 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    {searching ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
                  </InputAdornment>
                ),
                endAdornment: searchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={clearSearch} aria-label="清除搜索">
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
          />

          {visible.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
              {searchResults ? '没有找到相关记忆' : '还没有记忆'}
            </Typography>
          ) : (
            <List disablePadding>
              {visible.map((memory) => (
                <ListItem
                  key={memory.id}
                  disablePadding
                  data-menu-open={menu?.memory?.id === memory.id}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ anchor: { x: e.clientX, y: e.clientY }, memory }); }}
                  sx={(theme) => ({
                    ...settingsRowSx(theme),
                    ...rowActionRevealSx,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    pr: 5,
                  })}
                >
                  <Box sx={(theme) => ({
                    flexShrink: 0, width: 8, height: 8, mt: '7px', borderRadius: '2px',
                    bgcolor: alpha(theme.palette.primary.main, LAYER_BY_ID[memory.memory_layer]?.shade ?? 0.3),
                  })} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word', whiteSpace: 'pre-line', lineHeight: 1.55 }}>
                      {memory.content}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                      {[
                        LAYER_BY_ID[memory.memory_layer]?.label,
                        SOURCE_LABELS[memory.source],
                        formatDate(memory.updated_at || memory.created_at),
                        searchResults && memory.vecScore != null ? `相关度 ${Math.round(memory.vecScore * 100)}%` : null,
                      ].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  <IconButton
                    onClick={(e) => setMenu({ anchor: { el: e.currentTarget }, memory })}
                    aria-label="更多操作"
                    size="small"
                    className="row-inline-action"
                    sx={{ position: 'absolute', right: 4, top: 12, width: 28, height: 28, zIndex: 3, padding: 0 }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      )}

      <AppContextMenu
        anchor={menu?.anchor || null}
        onClose={() => setMenu(null)}
        items={[
          { key: 'edit', label: '编辑', icon: <EditIcon fontSize="small" />, onClick: () => setEditing({ id: menu.memory.id, content: menu.memory.content }) },
          { key: 'delete', label: '删除', icon: <DeleteIcon fontSize="small" />, danger: true, onClick: () => handleDelete(menu.memory) },
        ]}
      />

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>编辑记忆</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            value={editing?.content || ''}
            onChange={(e) => setEditing((prev) => ({ ...prev, content: e.target.value }))}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setEditing(null)}>取消</Button>
          <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={!editing?.content?.trim()}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>清空全部记忆？</DialogTitle>
        <DialogContent>
          <DialogContentText>此操作不可撤销。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setClearDialogOpen(false)}>取消</Button>
          <Button size="small" color="error" variant="contained" onClick={handleClearAll}>清空</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Mem0Settings;
