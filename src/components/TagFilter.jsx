import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Skeleton,
  TextField,
  InputAdornment,
  IconButton,
  Typography,
  alpha
} from '@mui/material';
import {
  LocalOffer as TagIcon,
  Search as SearchIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { getTagColor } from '../utils/tagUtils';
import BaseFilter from './BaseFilter';
import FilterChip from './FilterChip';

/**
 * 标签筛选组件
 * 浮窗筛选器中的「标签」分组：
 * - 顶部支持关键词搜索过滤
 * - 标签整体走横向「瀑布流」（flex-wrap），不再每个根标签独占一行
 * - 子标签以「父/子」完整名称的小芯片紧跟在所属父标签之后展示
 */
const TagFilter = ({
  selectedTags = [],
  onTagsChange,
  showDeleted = false,
  isTodoFilter = false,
  sx = {}
}) => {
  const [allTags, setAllTags] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const loadTags = async () => {
    setIsLoading(true);
    try {
      if (isTodoFilter) {
        const todoTagsResult = await window.electronAPI.todos.getTodoTagStats();
        if (todoTagsResult.success) {
          const validTags = todoTagsResult.data.filter(tag => tag.usage_count > 0);
          setAllTags(validTags);
        }
      } else {
        if (!window.electronAPI?.tags) return;
        await window.electronAPI.tags.recalculateUsage();
        const allTagsResult = await window.electronAPI.tags.getAll();
        if (allTagsResult?.success) {
          const validTags = allTagsResult.data.filter(tag => tag.usage_count > 0);
          setAllTags(validTags);
        }
      }
    } catch (error) {
      console.error('加载标签失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTags();
  }, []);

  const toggleTag = (tagName) => {
    const newSelectedTags = selectedTags.includes(tagName)
      ? selectedTags.filter(tag => tag !== tagName)
      : [...selectedTags, tagName];
    onTagsChange?.(newSelectedTags);
  };

  const clearAllFilters = () => {
    onTagsChange?.([]);
  };

  // 把标签压成扁平瀑布流顺序：根标签 → 该根的子标签 → 下一个根...
  // 这样视觉上既保留层级近邻关系，又能 flex-wrap 流动。
  const orderedTags = useMemo(() => {
    const groups = new Map(); // root -> { rootTag, children: [] }
    for (const tag of allTags) {
      const slashIdx = tag.name.indexOf('/');
      if (slashIdx > 0) {
        const root = tag.name.substring(0, slashIdx);
        if (!groups.has(root)) groups.set(root, { rootTag: null, children: [] });
        groups.get(root).children.push(tag);
      } else {
        if (!groups.has(tag.name)) groups.set(tag.name, { rootTag: null, children: [] });
        groups.get(tag.name).rootTag = tag;
      }
    }
    // 隐式根（只有子没有独立的父）→ 虚拟根
    for (const [root, g] of groups) {
      if (!g.rootTag && g.children.length > 0) {
        const totalCount = g.children.reduce((sum, c) => sum + (c.usage_count || 0), 0);
        g.rootTag = { name: root, usage_count: totalCount, isVirtual: true };
      }
    }
    const ordered = [];
    for (const [, g] of groups) {
      if (g.rootTag && !g.rootTag.isVirtual) {
        ordered.push({ ...g.rootTag, depth: 0, displayLabel: g.rootTag.name });
      } else if (g.rootTag && g.rootTag.isVirtual) {
        // 虚拟根不可点击（数据库里没有该 tag），只作占位
        ordered.push({ ...g.rootTag, depth: 0, displayLabel: g.rootTag.name, isVirtual: true });
      }
      for (const child of g.children) {
        ordered.push({
          ...child,
          depth: 1,
          displayLabel: child.name // 完整 父/子，便于搜索匹配
        });
      }
    }
    return ordered;
  }, [allTags]);

  const filteredTags = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return orderedTags;
    return orderedTags.filter(tag => tag.displayLabel.toLowerCase().includes(kw));
  }, [orderedTags, keyword]);

  const renderLoadingState = () => (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton
          key={index}
          variant="rounded"
          width={Math.random() * 60 + 60}
          height={24}
        />
      ))}
    </Box>
  );

  if (!isLoading && allTags.length === 0) {
    return null;
  }

  const renderContent = () => {
    if (isLoading) return renderLoadingState();

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {/* 标签搜索框 */}
        <TextField
          size="small"
          variant="outlined"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索标签…"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: keyword ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setKeyword('')}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ p: 0.25 }}
                >
                  <ClearIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
            sx: (theme) => ({
              fontSize: 12,
              borderRadius: 1.25,
              bgcolor: alpha(theme.palette.text.primary, 0.04),
              '& fieldset': { borderColor: 'transparent' },
              '&:hover fieldset': { borderColor: alpha(theme.palette.text.primary, 0.12) },
              '&.Mui-focused fieldset': { borderColor: theme.palette.primary.main }
            })
          }}
        />

        {/* 瀑布流标签 */}
        {filteredTags.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', py: 0.5 }}>
            没有匹配的标签
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
            {filteredTags.map((tag) => {
              if (tag.isVirtual) {
                // 虚拟根：仅作为视觉锚点的纯文字标记，不可点击
                return (
                  <Typography
                    key={`virtual-${tag.name}`}
                    variant="caption"
                    sx={(theme) => ({
                      fontSize: 11,
                      fontWeight: 600,
                      color: alpha(theme.palette.text.primary, 0.5),
                      px: 0.5
                    })}
                  >
                    {tag.name}/
                  </Typography>
                );
              }
              const showLabel = tag.depth === 1
                ? tag.name.substring(tag.name.indexOf('/') + 1)
                : tag.name;
              return (
                <FilterChip
                  key={tag.name}
                  label={tag.depth === 1 ? `↳ ${showLabel}` : showLabel}
                  value={tag.name}
                  isSelected={selectedTags.includes(tag.name)}
                  onClick={toggleTag}
                  color={getTagColor(tag.name)}
                  count={tag.usage_count}
                />
              );
            })}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <BaseFilter
      title="标签"
      icon={<TagIcon />}
      selectedItems={selectedTags}
      onClearAll={clearAllFilters}
      sx={sx}
    >
      {renderContent()}
    </BaseFilter>
  );
};

export default TagFilter;
