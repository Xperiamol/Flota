import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../utils/i18n';
import { useError } from './ErrorProvider';
import {
  Box,
  Typography,
  Button,
  Alert,
  Divider,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
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
  InputLabel
} from '@mui/material';
import {
  Memory as MemoryIcon,
  Delete as DeleteIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon
} from '@mui/icons-material';
import { scrollbar } from '../styles/commonStyles';

const Mem0Settings = () => {
  const { t } = useTranslation();
  const { showError, showSuccess } = useError();
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

  const userId = 'current_user'; // 简化示例，实际应从用户系统获取

  useEffect(() => {
    checkAvailability();
  }, []);

  useEffect(() => {
    if (available) {
      loadMemories();
    }
  }, [selectedCategory, available]);

  const checkAvailability = useCallback(async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('mem0:is-available');
        setAvailable(result?.available || false);
        
        if (result?.available) {
          await loadStats();
          await loadMemories();
        } else {
          setMessage({ 
            type: 'warning', 
            text: t('mem0.serviceNotInitialized')
          });
        }
      }
    } catch (error) {
      console.error('检查 Mem0 可用性失败:', error);
      showError(error, 'Mem0 服务检查失败');
      setMessage({ type: 'error', text: t('mem0.checkServiceFailed') });
      setAvailable(false);
    }
    setLoading(false);
  }, [t, showError]);

  const loadStats = useCallback(async () => {
    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('mem0:stats', { userId });
        if (result?.success && result?.stats) {
          setStats(result.stats);
        }
      }
    } catch (error) {
      console.error('加载统计信息失败:', error);
      showError(error, '加载统计信息失败');
      setStats(null);
    }
  }, [userId, showError]);

  const loadMemories = useCallback(async () => {
    try {
      if (window.electronAPI?.invoke) {
        const options = {
          limit: 200  // 增加到200条,确保能看到笔记内容
        };
        
        // 如果选择了特定类别,添加过滤
        if (selectedCategory !== 'all') {
          options.category = selectedCategory;
        }
        
        const result = await window.electronAPI.invoke('mem0:get', {
          userId,
          options
        });
        
        console.log('[Mem0Settings] 加载记忆结果:', result);
        
        if (result?.success && Array.isArray(result?.memories)) {
          setMemories(result.memories);
          console.log('[Mem0Settings] 成功加载记忆:', result.memories.length, '条');
        } else {
          setMemories([]);
        }
      }
    } catch (error) {
      console.error('加载记忆列表失败:', error);
      showError(error, '加载记忆列表失败');
      setMessage({ type: 'error', text: t('mem0.loadMemoriesFailed') });
      setMemories([]);
    }
  }, [selectedCategory, userId, showError, t]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setMessage({ type: 'warning', text: t('mem0.enterSearchContent') });
      return;
    }

    setSearching(true);
    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('mem0:search', {
          userId,
          query: searchQuery,
          options: {
            limit: 10,
            threshold: 0.6
          }
        });
        if (result?.success && Array.isArray(result?.results)) {
          setSearchResults(result.results);
          setMessage({ 
            type: 'success', 
            text: `找到 ${result.results.length} 条相关记忆` 
          });
        } else {
          setSearchResults([]);
          setMessage({ type: 'info', text: t('mem0.noRelatedMemories') });
        }
      }
    } catch (error) {
      console.error('搜索失败:', error);
      showError(error, '搜索失败');
      setMessage({ type: 'error', text: t('mem0.searchFailed') });
      setSearchResults([]);
    }
    setSearching(false);
  };

  const handleDeleteMemory = async (memoryId) => {
    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('mem0:delete', { memoryId });
        if (result?.success) {
          setMessage({ type: 'success', text: t('mem0.memoryDeleted') });
          await loadStats();
          await loadMemories();
          // 如果在搜索结果中，也更新搜索结果
          if (Array.isArray(searchResults) && searchResults.length > 0) {
            setSearchResults(searchResults.filter(m => m.id !== memoryId));
          }
        }
      }
    } catch (error) {
      console.error('删除记忆失败:', error);
      showError(error, '删除记忆失败');
      setMessage({ type: 'error', text: t('mem0.deleteFailed') });
    }
  };

  const handleClearAll = async () => {
    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('mem0:clear', { userId });
        if (result.success) {
          setMessage({ type: 'success', text: t('mem0.allMemoriesCleared') });
          setMemories([]);
          setSearchResults([]);
          await loadStats();
          setClearDialogOpen(false);
        }
      }
    } catch (error) {
      console.error('清除记忆失败:', error);
      showError(error, '清除记忆失败');
      setMessage({ type: 'error', text: t('mem0.clearFailed') });
    }
  };

  const handleRefresh = () => {
    checkAvailability();
  };

  const handleMigrateHistoricalData = async () => {
    setLoading(true);
    setMessage({ type: 'info', text: t('mem0.processingNotes') });

    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('mem0:migrate-historical');
        if (result?.success) {
          const skippedText = result.skippedCount > 0 
            ? `，跳过 ${result.skippedCount} 条重复` 
            : '';
          setMessage({
            type: 'success',
            text: `完成! 新增 ${result.memoryCount || 0} 条记忆${skippedText}`
          });
          await loadStats();
          await loadMemories();
        } else {
          setMessage({
            type: 'error',
            text: result?.error || t('mem0.processingFailed')
          });
        }
      }
    } catch (error) {
      console.error('迁移历史数据失败:', error);
      showError(error, '迁移历史数据失败');
      setMessage({ type: 'error', text: '处理历史数据时出错' });
    } finally {
      setLoading(false);
      setMigrateDialogOpen(false);
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* 消息提示 */}
      {message && (
        <Alert
          severity={message.type}
          onClose={() => setMessage(null)}
          sx={{ mb: 2 }}
        >
          {message.text}
        </Alert>
      )}

      {!available ? (
        <Alert severity="info" icon={<InfoIcon />}>
          <Typography variant="body2" gutterBottom>
            <strong>{t('mem0.featureTitle')}</strong>
          </Typography>
          <Typography variant="body2">
            {t('mem0.featureDesc')}
          </Typography>
        </Alert>
      ) : (
        <List>
          {/* 系统状态 */}
          <ListItem>
            <ListItemText
              primary={t('mem0.systemStatus')}
              secondary={t('mem0.systemStatusDesc')}
            />
            <ListItemSecondaryAction>
              <Chip
                label={available ? t('mem0.running') : t('mem0.notReady')}
                color={available ? 'success' : 'default'}
                size="small"
              />
            </ListItemSecondaryAction>
          </ListItem>

          <Divider />

          {/* 统计信息 */}
          {stats && (
            <>
              <ListItem>
                <ListItemText primary={t('mem0.totalMemories')} />
                <ListItemSecondaryAction>
                  <Chip label={stats.total || 0} size="small" color="primary" />
                </ListItemSecondaryAction>
              </ListItem>
              {stats.by_category && Object.keys(stats.by_category).length > 0 && (
                <ListItem>
                  <ListItemText primary={t('mem0.categoryStats')} />
                  <ListItemSecondaryAction>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 400 }}>
                      {Object.entries(stats.by_category).map(([category, count]) => (
                        <Chip
                          key={category}
                          label={`${category}: ${count}`}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                    </Box>
                  </ListItemSecondaryAction>
                </ListItem>
              )}
              <Divider />
            </>
          )}

          {/* 操作按钮 */}
          <ListItem>
            <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={handleRefresh}
                disabled={loading}
              >
                {t('mem0.refresh')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="secondary"
                onClick={() => setMigrateDialogOpen(true)}
                disabled={loading}
              >
                {t('mem0.importHistoricalNotes')}
              </Button>
            </Box>
          </ListItem>

          <Divider />

          {/* 语义搜索 */}
          <ListItem>
            <Box sx={{ width: '100%' }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }} gutterBottom>
                {t('mem0.semanticSearch')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
                <TextField
                  sx={{ flex: 1 }}
                  size="small"
                  placeholder={t('mem0.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  aria-label={t('mem0.searchPlaceholder')}
                />
                <Button
                  sx={{ whiteSpace: 'nowrap' }}
                  variant="contained"
                  size="small"
                  startIcon={<SearchIcon />}
                  onClick={handleSearch}
                  disabled={searching}
                >
                  {t('mem0.search')}
                </Button>
              </Box>
              
              {Array.isArray(searchResults) && searchResults.length > 0 && (
                <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, ...scrollbar.auto }}>
                  <List dense disablePadding>
                    {searchResults.map((memory) => (
                      <ListItem key={memory.id} divider>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                            {memory.content}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
                            <Chip
                              label={`${(memory.score * 100).toFixed(0)}%`}
                              size="small"
                              color={memory.score > 0.8 ? 'success' : 'default'}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(memory.created_at)}
                            </Typography>
                          </Box>
                        </Box>
                        <ListItemSecondaryAction>
                          <Tooltip title={t('mem0.delete')}>
                            <IconButton
                              size="small"
                              edge="end"
                              onClick={() => handleDeleteMemory(memory.id)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}
            </Box>
          </ListItem>

          <Divider />

          {/* 记忆列表 */}
          <ListItem>
            <Box sx={{ width: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  {t('mem0.memoryList')} ({Array.isArray(memories) ? memories.length : 0})
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>{t('mem0.category')}</InputLabel>
                    <Select
                      value={selectedCategory}
                      label={t('mem0.category')}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                      <MenuItem value="all">{t('mem0.all')}</MenuItem>
                      <MenuItem value="knowledge">{t('mem0.knowledge')}</MenuItem>
                      <MenuItem value="task_planning">{t('mem0.taskPlanning')}</MenuItem>
                      <MenuItem value="note_taking">{t('mem0.noteTaking')}</MenuItem>
                      <MenuItem value="organization">{t('mem0.organization')}</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </Box>
              
              {!Array.isArray(memories) || memories.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  {t('mem0.noMemories')}
                </Typography>
              ) : (
                <Box sx={{ maxHeight: 400, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, ...scrollbar.auto }}>
                  <List dense disablePadding>
                    {memories.map((memory) => (
                      <ListItem key={memory.id} divider>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                            {memory.content}
                          </Typography>
                          {memory.metadata && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                              {JSON.stringify(memory.metadata)}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            {formatDate(memory.created_at)}
                          </Typography>
                        </Box>
                        <ListItemSecondaryAction>
                          <Tooltip title={t('mem0.delete')}>
                            <IconButton
                              size="small"
                              edge="end"
                              onClick={() => handleDeleteMemory(memory.id)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}
            </Box>
          </ListItem>

          <Divider />

          {/* 维护 */}
          <ListItem>
            <Box sx={{ width: '100%' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {t('mem0.clear')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('mem0.confirmClearDesc')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ flex: 1 }} />
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<DeleteIcon />}
                  onClick={() => setClearDialogOpen(true)}
                  disabled={!Array.isArray(memories) || memories.length === 0}
                >
                  {t('mem0.clear')}
                </Button>
              </Box>
            </Box>
          </ListItem>

          <Divider />

          {/* 技术信息 */}
          <ListItem>
            <Box>
              <Typography variant="subtitle2" gutterBottom color="text.secondary">
                {t('mem0.technicalInfo')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('mem0.technicalDesc')}
              </Typography>
            </Box>
          </ListItem>
        </List>
      )}

      {/* 清空确认对话框 */}
      <Dialog
        open={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('mem0.confirmClearTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('mem0.confirmClearDesc')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setClearDialogOpen(false)}>
            {t('mem0.cancel')}
          </Button>
          <Button size="small" onClick={handleClearAll} color="error" variant="contained">
            {t('mem0.confirmClear')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 导入历史笔记确认对话框 */}
      <Dialog
        open={migrateDialogOpen}
        onClose={() => setMigrateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('mem0.importNotesTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('mem0.importNotesDesc')}
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            {t('mem0.importNotesDetail')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setMigrateDialogOpen(false)} disabled={loading}>
            {t('mem0.cancel')}
          </Button>
          <Button
            onClick={handleMigrateHistoricalData}
            size="small"
            variant="contained"
            color="primary"
            disabled={loading}
          >
            {t('mem0.confirmImport')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Mem0Settings;
