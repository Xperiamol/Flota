import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Chip,
  TextField,
  Typography,
  Divider,
  FormControlLabel,
  Checkbox,
  InputAdornment,
  IconButton
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  Label as LabelIcon
} from '@mui/icons-material';
import { parseTags, formatTags } from '../utils/tagUtils';

/**
 * 标签选择对话框组件
 * 用于批量设置笔记标签
 */
const TagSelectionDialog = ({
  open = false,
  onClose,
  onConfirm,
  noteIds = [],
  getAllTags,
  title = '批量设置标签'
}) => {
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [replaceMode, setReplaceMode] = useState(false); // 是否替换现有标签
  const [existingTags, setExistingTags] = useState([]); // 系统中已有的所有标签
  const [isLoading, setIsLoading] = useState(false);

  // 重置状态和加载标签
  useEffect(() => {
    if (open) {
      setSelectedTags(new Set());
      setSearchQuery('');
      setNewTagInput('');
      setReplaceMode(false);
      loadTags();
    }
  }, [open]);

  // 加载所有标签
  const loadTags = async () => {
    if (!getAllTags) return;
    
    setIsLoading(true);
    try {
      const tags = await getAllTags();
      setExistingTags(tags || []);
    } catch (error) {
      console.error('加载标签失败:', error);
      setExistingTags([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 过滤标签
  const filteredTags = existingTags.filter(tag => 
    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 切换标签选择状态
  const toggleTag = (tagName) => {
    const newSelected = new Set(selectedTags);
    if (newSelected.has(tagName)) {
      newSelected.delete(tagName);
    } else {
      newSelected.add(tagName);
    }
    setSelectedTags(newSelected);
  };

  // 添加新标签
  const handleAddNewTag = () => {
    const trimmedTag = newTagInput.trim();
    if (trimmedTag && !selectedTags.has(trimmedTag)) {
      const newSelected = new Set(selectedTags);
      newSelected.add(trimmedTag);
      setSelectedTags(newSelected);
      setNewTagInput('');
    }
  };

  // 处理新标签输入的回车键
  const handleNewTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNewTag();
    }
  };

  // 清空搜索
  const handleClearSearch = () => {
    setSearchQuery('');
  };

  // 确认选择
  const handleConfirm = () => {
    const tagsArray = Array.from(selectedTags);
    onConfirm?.({
      tags: tagsArray,
      replaceMode,
      noteIds
    });
    onClose?.();
  };

  // 取消
  const handleCancel = () => {
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { minHeight: 400 }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LabelIcon color="primary" />
          <Typography variant="h6">{title}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          为 {noteIds.length} 个笔记设置标签
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {/* 操作模式选择 */}
        <Box sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={replaceMode}
                onChange={(e) => setReplaceMode(e.target.checked)}
                size="small"
              />
            }
            label="替换现有标签（取消勾选则为添加标签）"
          />
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* 搜索框 */}
        <TextField
          fullWidth
          size="small"
          placeholder="搜索标签..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="搜索标签"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton size="small" onClick={handleClearSearch} aria-label="清除搜索">
                  <ClearIcon />
                </IconButton>
              </InputAdornment>
            )
          }}
          sx={{ mb: 2 }}
        />

        {/* 新标签输入 */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField
            size="small"
            placeholder="添加新标签..."
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={handleNewTagKeyDown}
            sx={{ flex: 1 }}
            aria-label="添加新标签"
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleAddNewTag}
            disabled={!newTagInput.trim()}
          >
            添加
          </Button>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* 已选择的标签 */}
        {selectedTags.size > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              已选择的标签 ({selectedTags.size})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Array.from(selectedTags).map(tag => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  color="primary"
                  onDelete={() => toggleTag(tag)}
                />
              ))}
            </Box>
            <Divider sx={{ mt: 2, mb: 2 }} />
          </Box>
        )}

        {/* 可选标签列表 */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          可选标签 ({filteredTags.length})
        </Typography>
        <Box
          sx={{
            maxHeight: 200,
            overflow: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1
          }}
        >
          {filteredTags.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {filteredTags.map(tag => (
                <Chip
                  key={tag.name}
                  label={`${tag.name} (${tag.count || 0})`}
                  size="small"
                  variant={selectedTags.has(tag.name) ? 'filled' : 'outlined'}
                  color={selectedTags.has(tag.name) ? 'primary' : 'default'}
                  onClick={() => toggleTag(tag.name)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              {searchQuery ? '没有找到匹配的标签' : '暂无可用标签'}
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleCancel}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={selectedTags.size === 0}
          startIcon={<LabelIcon />}
        >
          确认设置 ({selectedTags.size} 个标签)
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TagSelectionDialog;