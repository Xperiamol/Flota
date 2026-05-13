import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '../utils/i18n';
import { useError } from './ErrorProvider';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  List,
  ListItem,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  IconButton,
  Tooltip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Delete as DeleteIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Psychology as PsychologyIcon,
  AutoAwesome as AutoAwesomeIcon,
  CleaningServices as CleanIcon,
  Timeline as TimelineIcon
} from '@mui/icons-material';
import { emptyStateSx, settingsFieldGroupSx, settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../styles/commonStyles';

// ─── 分层配色 ───
const LAYER_COLORS = {
  profile:  { bg: '#7c3aed', label: '偏好', icon: '' },
  semantic: { bg: '#2563eb', label: '知识', icon: '' },
  episodic: { bg: '#059669', label: '经历', icon: '' },
  artifact: { bg: '#d97706', label: '抽取', icon: '' },
};

const LAYER_ORDER = ['profile', 'semantic', 'episodic', 'artifact'];

// ─── 环形进度条组件 ───
const RingProgress = ({ value, max, size = 56, color, label, count }) => {
  const pct = max > 0 ? Math.min(value / max * 100, 100) : 0;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <CircularProgress
          variant="determinate"
          value={100}
          size={size}
          thickness={4}
          sx={{ color: alpha(color, 0.12), position: 'absolute' }}
        />
        <CircularProgress
          variant="determinate"
          value={pct}
          size={size}
          thickness={4}
          sx={{ color, position: 'absolute' }}
        />
        <Box sx={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 13, color }}>
            {count}
          </Typography>
        </Box>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
        {label}
      </Typography>
    </Box>
  );
};

// ─── 指标卡片 ───
const MetricCard = ({ icon, label, value, color = 'text.secondary' }) => (
  <Box sx={(theme) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    px: 1.5, py: 1,
    borderRadius: '12px',
    border: '1px solid',
    borderColor: theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.10)' : 'rgba(15,23,42,0.06)',
    bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.62)',
    minWidth: 72,
  })}>
    <Typography variant="body2" sx={{ color, fontWeight: 700, fontSize: 16 }}>{value}</Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, mt: 0.25, whiteSpace: 'nowrap' }}>
      {icon} {label}
    </Typography>
  </Box>
);

const Mem0Settings = () => {
  const { t } = useTranslation();
  const { showError } = useError();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [memories, setMemories] = useState([]);
  const [message, setMessage] = useState(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cleaning, setCleaning] = useState(false);

  const userId = 'current_user';

  useEffect(() => { checkAvailability(); }, []);
  useEffect(() => { if (available) loadMemories(); }, [selectedCategory, available]);

  const checkAvailability = useCallback(async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.mem0?.isAvailable) {
        const result = await window.electronAPI.mem0.isAvailable();
        setAvailable(result?.available || false);
        if (result?.available) {
          await loadStats();
          await loadMemories();
        }
      }
    } catch (error) {
      showError(error, 'Mem0 服务检查失败');
      setAvailable(false);
    }
    setLoading(false);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      if (window.electronAPI?.mem0?.stats) {
        const result = await window.electronAPI.mem0.stats({ userId });
        if (result?.success && result?.stats) setStats(result.stats);
      }
    } catch (error) {
      showError(error, '加载统计信息失败');
    }
  }, [userId]);

  const loadMemories = useCallback(async () => {
    try {
      if (window.electronAPI?.mem0?.get) {
        const options = { limit: 200 };
        if (selectedCategory !== 'all') options.category = selectedCategory;
        const result = await window.electronAPI.mem0.get({ userId, options });
        if (result?.success && Array.isArray(result?.memories)) {
          setMemories(result.memories);
        } else {
          setMemories([]);
        }
      }
    } catch (error) {
      showError(error, '加载记忆列表失败');
      setMemories([]);
    }
  }, [selectedCategory, userId]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      if (window.electronAPI?.mem0?.search) {
        const result = await window.electronAPI.mem0.search({
          userId, query: searchQuery, options: { limit: 10, threshold: 0.3 }
        });
        if (result?.success && Array.isArray(result?.results)) {
          setSearchResults(result.results);
          setMessage({ type: 'success', text: `找到 ${result.results.length} 条相关记忆` });
        } else {
          setSearchResults([]);
          setMessage({ type: 'info', text: t('mem0.noRelatedMemories') });
        }
      }
    } catch (error) {
      showError(error, '搜索失败');
      setSearchResults([]);
    }
    setSearching(false);
  };

  const handleDeleteMemory = async (memoryId) => {
    try {
      if (window.electronAPI?.mem0?.delete) {
        const result = await window.electronAPI.mem0.delete({ memoryId });
        if (result?.success) {
          setMessage({ type: 'success', text: t('mem0.memoryDeleted') });
          await loadStats();
          await loadMemories();
          if (searchResults.length > 0) {
            setSearchResults(searchResults.filter(m => m.id !== memoryId));
          }
        }
      }
    } catch (error) {
      showError(error, '删除记忆失败');
    }
  };

  const handleClearAll = async () => {
    try {
      if (window.electronAPI?.mem0?.clear) {
        const result = await window.electronAPI.mem0.clear({ userId });
        if (result.success) {
          setMessage({ type: 'success', text: t('mem0.allMemoriesCleared') });
          setMemories([]);
          setSearchResults([]);
          await loadStats();
          setClearDialogOpen(false);
        }
      }
    } catch (error) {
      showError(error, '清除记忆失败');
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      if (window.electronAPI?.mem0?.cleanup) {
        const result = await window.electronAPI.mem0.cleanup();
        if (result) {
          setMessage({ type: 'success', text: `清理完成：移除 ${result.removed || 0} 条过期记忆` });
          await loadStats();
          await loadMemories();
        }
      }
    } catch (error) {
      showError(error, '清理失败');
    }
    setCleaning(false);
  };

  const handleMigrateHistoricalData = async () => {
    setLoading(true);
    setMessage({ type: 'info', text: t('mem0.processingNotes') });
    try {
      if (window.electronAPI?.mem0?.migrateHistorical) {
        const result = await window.electronAPI.mem0.migrateHistorical();
        if (result?.success) {
          const skippedText = result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 条重复` : '';
          setMessage({ type: 'success', text: `完成! 新增 ${result.memoryCount || 0} 条记忆${skippedText}` });
          await loadStats();
          await loadMemories();
        } else {
          setMessage({ type: 'error', text: result?.error || t('mem0.processingFailed') });
        }
      }
    } catch (error) {
      showError(error, '迁移历史数据失败');
    } finally {
      setLoading(false);
      setMigrateDialogOpen(false);
    }
  };

  const formatDate = (ts) => new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  // ─── 计算分层数据 ───
  const layerData = useMemo(() => {
    if (!stats?.by_layer) return [];
    return LAYER_ORDER
      .filter(k => stats.by_layer[k])
      .map(k => ({
        key: k,
        ...LAYER_COLORS[k],
        count: stats.by_layer[k].count,
        limit: stats.by_layer[k].limit,
        usage: stats.by_layer[k].usage,
      }));
  }, [stats]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {message && (
        <Alert severity={message.type} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      {!available ? (
        <Alert severity="info" icon={<InfoIcon />} sx={(theme) => emptyStateSx(theme)}>
          <Typography variant="body2" gutterBottom><strong>{t('mem0.featureTitle')}</strong></Typography>
          <Typography variant="body2">{t('mem0.featureDesc')}</Typography>
        </Alert>
      ) : (
        <Box>
          {/* ═══ 顶部仪表盘 ═══ */}
          <Paper elevation={0} sx={settingsSectionSx}>
            {/* 状态标题 */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PsychologyIcon sx={{ color: 'primary.main', fontSize: 22 }} />
                <Typography variant="subtitle1" sx={sectionTitleSx}>
                  记忆引擎
                </Typography>
                <Chip
                  label={`${stats?.active ?? 0} 条活跃`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ fontSize: 11, height: 22 }}
                />
                {stats?.superseded > 0 && (
                  <Chip
                    label={`${stats.superseded} 已替代`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: 11, height: 22, opacity: 0.6 }}
                  />
                )}
              </Box>
              <Tooltip title="刷新">
                <IconButton size="small" onClick={checkAvailability}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {/* 分层环形图 */}
            {layerData.length > 0 && (
              <Box sx={(theme) => ({
                display: 'flex', justifyContent: 'center', gap: 3, mb: 2,
                py: 1.5, px: 2, borderRadius: '14px',
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(15,23,42,0.035)',
              })}>
                {layerData.map(ld => (
                  <Tooltip
                    key={ld.key}
                    title={`${ld.icon} ${ld.label}层：${ld.count}/${ld.limit} (${ld.usage})`}
                  >
                    <Box>
                      <RingProgress
                        value={ld.count}
                        max={ld.limit}
                        color={ld.bg}
                        label={`${ld.icon} ${ld.label}`}
                        count={ld.count}
                      />
                    </Box>
                  </Tooltip>
                ))}
              </Box>
            )}

            {/* 运行指标 */}
            {stats?.metrics && (
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
                <MetricCard icon="" label="命中率" value={stats.metrics.hit_rate} color="success.main" />
                <MetricCard icon="" label="写入" value={stats.metrics.writes} />
                <MetricCard icon="" label="拦截" value={stats.metrics.blocked} />
                <MetricCard icon="" label="去重" value={stats.metrics.deduped} />
              </Box>
            )}
          </Paper>

          {/* ═══ 操作按钮 ═══ */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined" size="small"
                startIcon={<AutoAwesomeIcon />}
                onClick={() => setMigrateDialogOpen(true)}
                disabled={loading}
              >
                {t('mem0.importHistoricalNotes')}
              </Button>
              <Button
                variant="outlined" size="small" color="secondary"
                startIcon={<CleanIcon />}
                onClick={handleCleanup}
                disabled={cleaning}
              >
                {cleaning ? '清理中...' : '智能清理'}
              </Button>
            </Box>
            <Button
              variant="outlined" size="small" color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setClearDialogOpen(true)}
              disabled={!Array.isArray(memories) || memories.length === 0}
            >
              {t('mem0.clear')}
            </Button>
          </Box>

          {/* ═══ 语义搜索 ═══ */}
          <Box sx={settingsSectionSx}>
            <Typography variant="subtitle1" sx={{ ...sectionTitleSx, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SearchIcon fontSize="small" /> 混合语义搜索
            </Typography>
            <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
              用关键词或自然语言检索长期记忆
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
              <TextField
                sx={{ flex: 1 }}
                size="small"
                placeholder="输入关键词或自然语言查询..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button
                variant="contained" size="small"
                startIcon={<SearchIcon />}
                onClick={handleSearch}
                disabled={searching}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {t('mem0.search')}
              </Button>
            </Box>

            {Array.isArray(searchResults) && searchResults.length > 0 && (
              <Box sx={(theme) => ({
                maxHeight: 280, overflowY: 'auto',
                ...settingsFieldGroupSx(theme),
                p: 0
              })}>
                <List dense disablePadding>
                  {searchResults.map((memory) => (
                    <ListItem
                      key={memory.id}
                      divider
                      secondaryAction={(
                        <Tooltip title={t('mem0.delete')}>
                          <IconButton size="small" edge="end" onClick={() => handleDeleteMemory(memory.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      sx={{ py: 1.25, pr: 6 }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word', lineHeight: 1.5 }}>
                          {memory.content}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Chip
                            label={`${(memory.score * 100).toFixed(0)}%`}
                            size="small"
                            sx={{
                              height: 20, fontSize: 11, fontWeight: 700,
                              bgcolor: memory.score > 0.6 ? alpha('#059669', 0.12) : alpha('#6b7280', 0.08),
                              color: memory.score > 0.6 ? '#059669' : 'text.secondary',
                            }}
                          />
                          {memory.memory_layer && LAYER_COLORS[memory.memory_layer] && (
                            <Chip
                              label={`${LAYER_COLORS[memory.memory_layer].icon} ${LAYER_COLORS[memory.memory_layer].label}`}
                              size="small"
                              sx={{
                                height: 20, fontSize: 10,
                                bgcolor: alpha(LAYER_COLORS[memory.memory_layer].bg, 0.1),
                                color: LAYER_COLORS[memory.memory_layer].bg,
                              }}
                            />
                          )}
                          {memory.vecScore != null && (
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                              vec:{(memory.vecScore * 100).toFixed(0)}%
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                            {formatDate(memory.created_at)}
                          </Typography>
                        </Box>
                      </Box>
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
          </Box>

          {/* ═══ 记忆列表 ═══ */}
          <Box sx={settingsSectionSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ ...sectionTitleSx, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TimelineIcon fontSize="small" />
                {t('mem0.memoryList')} ({Array.isArray(memories) ? memories.length : 0})
              </Typography>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>{t('mem0.category')}</InputLabel>
                <Select
                  value={selectedCategory}
                  label={t('mem0.category')}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  sx={{ fontSize: 13 }}
                >
                  <MenuItem value="all">{t('mem0.all')}</MenuItem>
                  <MenuItem value="knowledge">{t('mem0.knowledge')}</MenuItem>
                  <MenuItem value="task_planning">{t('mem0.taskPlanning')}</MenuItem>
                  <MenuItem value="note_taking">{t('mem0.noteTaking')}</MenuItem>
                  <MenuItem value="general">通用</MenuItem>
                  <MenuItem value="preference">偏好</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {!Array.isArray(memories) || memories.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={(theme) => ({ ...emptyStateSx(theme), py: 3 })}>
                {t('mem0.noMemories')}
              </Typography>
            ) : (
              <Box sx={(theme) => ({
                maxHeight: 400, overflowY: 'auto',
                ...settingsFieldGroupSx(theme),
                p: 0
              })}>
                <List dense disablePadding>
                  {memories.map((memory) => (
                    <ListItem
                      key={memory.id}
                      divider
                      secondaryAction={(
                        <Tooltip title={t('mem0.delete')}>
                          <IconButton size="small" edge="end" onClick={() => handleDeleteMemory(memory.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      sx={{ py: 1, pr: 6 }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word', lineHeight: 1.5 }}>
                          {memory.content}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                          {memory.memory_layer && LAYER_COLORS[memory.memory_layer] && (
                            <Chip
                              label={`${LAYER_COLORS[memory.memory_layer].icon} ${LAYER_COLORS[memory.memory_layer].label}`}
                              size="small"
                              sx={{
                                height: 18, fontSize: 10,
                                bgcolor: alpha(LAYER_COLORS[memory.memory_layer].bg, 0.1),
                                color: LAYER_COLORS[memory.memory_layer].bg,
                              }}
                            />
                          )}
                          <Chip
                            label={memory.category}
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, fontSize: 10 }}
                          />
                          {memory.access_count > 0 && (
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                              访问 {memory.access_count}×
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                            {formatDate(memory.created_at)}
                          </Typography>
                        </Box>
                      </Box>
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {t('mem0.technicalDesc')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              架构 v3 · 4层分层 · 混合召回(向量+FTS5) · 多因子重排 · 半衰期衰减
            </Typography>
          </Box>
        </Box>
      )}

      {/* 清空确认对话框 */}
      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('mem0.confirmClearTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('mem0.confirmClearDesc')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setClearDialogOpen(false)}>{t('mem0.cancel')}</Button>
          <Button size="small" onClick={handleClearAll} color="error" variant="contained">{t('mem0.confirmClear')}</Button>
        </DialogActions>
      </Dialog>

      {/* 导入历史笔记确认对话框 */}
      <Dialog open={migrateDialogOpen} onClose={() => setMigrateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('mem0.importNotesTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('mem0.importNotesDesc')}</DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>{t('mem0.importNotesDetail')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setMigrateDialogOpen(false)} disabled={loading}>{t('mem0.cancel')}</Button>
          <Button onClick={handleMigrateHistoricalData} size="small" variant="contained" color="primary" disabled={loading}>
            {t('mem0.confirmImport')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Mem0Settings;
