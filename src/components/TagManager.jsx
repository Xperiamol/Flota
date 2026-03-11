import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Chip,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Checkbox,
  FormControlLabel,
  Alert,
  Snackbar,
  CircularProgress,
  InputAdornment,
  Tooltip,
  Grid,
  Card,
  CardContent
} from '@mui/material';
import {
  Search as SearchIcon,
  Delete as DeleteIcon,
  DeleteSweep as DeleteSweepIcon,
  Refresh as RefreshIcon,
  Tag as TagIcon,
  TrendingUp as TrendingUpIcon,
  Analytics as AnalyticsIcon
} from '@mui/icons-material';
import { getTagColor } from '../utils/tagUtils';

/**
 * 标签管理组件
 * 提供标签的查看、搜索、删除、批量操作等功能
 * 遵循SOLID原则，专门处理标签管理相关的UI逻辑
 */
const TagManager = ({ open, onClose }) => {
  const [tags, setTags] = useState([]);
  const [filteredTags, setFilteredTags] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  // 加载标签数据
  const loadTags = async () => {
    if (!window.electronAPI?.tags) return;
    
    try {
      setIsLoading(true);
      const [tagsResult, statsResult] = await Promise.all([
        window.electronAPI.tags.getAll(),
        window.electronAPI.tags.getStats()
      ]);
      
      if (tagsResult?.success) {
        setTags(tagsResult.data);
        setFilteredTags(tagsResult.data);
      }
      
      if (statsResult?.success) {
        setStats(statsResult.data);
      }
    } catch (error) {
      console.error('加载标签失败:', error);
      showSnackbar(t('settings.loadTagsFailed'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 搜索标签
  const handleSearch = (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setFilteredTags(tags);
    } else {
      const filtered = tags.filter(tag => 
        tag.name.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredTags(filtered);
    }
  };

  // 显示提示消息
  const showSnackbar = (message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  // 删除单个标签
  const handleDeleteTag = async (tagName) => {
    if (!window.electronAPI?.tags) return;
    
    try {
      const result = await window.electronAPI.tags.delete(tagName);
      if (result?.success) {
        showSnackbar(t('settings.tagDeleted', { name: tagName }), 'success');
        loadTags(); // 重新加载数据
      } else {
        showSnackbar(result?.error || t('settings.deleteTagFailed'), 'error');
      }
    } catch (error) {
      console.error('删除标签失败:', error);
      showSnackbar(t('settings.deleteTagFailed'), 'error');
    }
  };

  // 批量删除标签
  const handleBatchDelete = async () => {
    if (!window.electronAPI?.tags || selectedTags.size === 0) return;
    
    try {
      const tagNames = Array.from(selectedTags);
      const result = await window.electronAPI.tags.batchDelete(tagNames);
      
      if (result?.success) {
        showSnackbar(t('settings.tagsDeleted', { count: tagNames.length }), 'success');
        setSelectedTags(new Set());
        loadTags(); // 重新加载数据
      } else {
        showSnackbar(result?.error || t('settings.batchDeleteFailed'), 'error');
      }
    } catch (error) {
      console.error('批量删除失败:', error);
      showSnackbar(t('settings.batchDeleteFailed'), 'error');
    }
  };

  // 清理未使用的标签
  const handleCleanup = async () => {
    if (!window.electronAPI?.tags) return;
    
    try {
      const result = await window.electronAPI.tags.cleanup();
      if (result?.success) {
        showSnackbar(t('settings.tagsCleaned', { count: result.data.deletedCount }), 'success');
        loadTags(); // 重新加载数据
      } else {
        showSnackbar(result?.error || t('settings.cleanupFailed'), 'error');
      }
    } catch (error) {
      console.error('清理标签失败:', error);
      showSnackbar(t('settings.cleanupTagsFailed'), 'error');
    }
  };

  // 切换标签选择状态
  const toggleTagSelection = (tagName) => {
    const newSelected = new Set(selectedTags);
    if (newSelected.has(tagName)) {
      newSelected.delete(tagName);
    } else {
      newSelected.add(tagName);
    }
    setSelectedTags(newSelected);
  };

  // 全选/取消全选
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedTags(new Set(filteredTags.map(tag => tag.name)));
    } else {
      setSelectedTags(new Set());
    }
  };

  // 组件挂载时加载数据
  useEffect(() => {
    if (open) {
      loadTags();
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { height: '80vh' }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TagIcon />
          <Typography variant="h6">标签管理</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
            <Tooltip title="刷新">
              <IconButton onClick={loadTags} disabled={isLoading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="清理未使用的标签">
              <IconButton onClick={handleCleanup} disabled={isLoading}>
                <DeleteSweepIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </DialogTitle>
      
      <DialogContent sx={{ p: 2 }}>
        {/* 统计信息 */}
        {stats && (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={4}>
              <Card variant="outlined">
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TagIcon color="primary" />
                    <Box>
                      <Typography variant="h6">{stats.totalTags}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        总标签数
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={4}>
              <Card variant="outlined">
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TrendingUpIcon color="success" />
                    <Box>
                      <Typography variant="h6">{stats.usedTags}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        已使用
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={4}>
              <Card variant="outlined">
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AnalyticsIcon color="warning" />
                    <Box>
                      <Typography variant="h6">{stats.unusedTags}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        未使用
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
        
        {/* 搜索和批量操作 */}
        <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="搜索标签..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            aria-label="搜索标签"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              )
            }}
            sx={{ flex: 1 }}
          />
          
          {filteredTags.length > 0 && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={selectedTags.size === filteredTags.length && filteredTags.length > 0}
                  indeterminate={selectedTags.size > 0 && selectedTags.size < filteredTags.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              }
              label="全选"
            />
          )}
          
          {selectedTags.size > 0 && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setBatchDeleteDialogOpen(true)}
            >
              删除选中 ({selectedTags.size})
            </Button>
          )}
        </Box>
        
        {/* 标签列表 */}
        <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto' }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : filteredTags.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
              <TagIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
              <Typography>
                {searchQuery ? '未找到匹配的标签' : '暂无标签'}
              </Typography>
            </Box>
          ) : (
            <List>
              {filteredTags.map((tag) => (
                <ListItem key={tag.name} divider>
                  <Checkbox
                    checked={selectedTags.has(tag.name)}
                    onChange={() => toggleTagSelection(tag.name)}
                    sx={{ mr: 1 }}
                  />
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={tag.name}
                          size="small"
                          sx={{
                            backgroundColor: getTagColor(tag.name),
                            color: 'white'
                          }}
                        />
                        <Typography variant="body2" color="text.secondary">
                          使用次数: {tag.usage_count}
                        </Typography>
                      </Box>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => {
                        setTagToDelete(tag.name);
                        setDeleteDialogOpen(true);
                      }}
                      size="small"
                      aria-label="删除标签"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
      
      {/* 删除确认对话框 */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除标签 "{tagToDelete}" 吗？此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button
            onClick={() => {
              handleDeleteTag(tagToDelete);
              setDeleteDialogOpen(false);
              setTagToDelete(null);
            }}
            color="error"
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* 批量删除确认对话框 */}
      <Dialog
        open={batchDeleteDialogOpen}
        onClose={() => setBatchDeleteDialogOpen(false)}
      >
        <DialogTitle>确认批量删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除选中的 {selectedTags.size} 个标签吗？此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBatchDeleteDialogOpen(false)}>取消</Button>
          <Button
            onClick={() => {
              handleBatchDelete();
              setBatchDeleteDialogOpen(false);
            }}
            color="error"
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* 提示消息 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default TagManager;