import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Skeleton,
  Collapse,
  IconButton,
  Typography
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { getTagColor } from '../utils/tagUtils';
import BaseFilter from './BaseFilter';
import FilterChip from './FilterChip';

/**
 * 标签筛选组件
 * 在搜索框下方提供标签筛选功能
 * 支持展开/收起、多选筛选、清空筛选等功能
 */
const TagFilter = ({ 
  selectedTags = [], 
  onTagsChange, 
  showDeleted = false,
  isTodoFilter = false,
  sx = {} 
}) => {
  const [allTags, setAllTags] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 加载标签数据
  const loadTags = async () => {
    setIsLoading(true);
    try {
      if (isTodoFilter) {
        // 获取待办事项标签统计
        const todoTagsResult = await window.electronAPI.todos.getTodoTagStats();
        if (todoTagsResult.success) {
          const validTags = todoTagsResult.data.filter(tag => tag.usage_count > 0);
          setAllTags(validTags);
        }
      } else {
        if (!window.electronAPI?.tags) return;
        
        // 首先重新计算标签使用次数，确保统计准确
        await window.electronAPI.tags.recalculateUsage();
        
        const allTagsResult = await window.electronAPI.tags.getAll();
        
        if (allTagsResult?.success) {
          // 过滤掉使用次数为0的标签
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

  // 组件挂载时加载标签
  useEffect(() => {
    loadTags();
  }, []);

  // 切换标签选择状态
  const toggleTag = (tagName) => {
    const newSelectedTags = selectedTags.includes(tagName)
      ? selectedTags.filter(tag => tag !== tagName)
      : [...selectedTags, tagName];
    
    onTagsChange?.(newSelectedTags);
  };

  // 清空所有筛选
  const clearAllFilters = () => {
    onTagsChange?.([]);
  };

  // 构建层级标签树
  const tagGroups = useMemo(() => {
    const groupMap = new Map(); // root -> { rootTag, children: [] }
    for (const tag of allTags) {
      const slashIdx = tag.name.indexOf('/');
      if (slashIdx > 0) {
        const root = tag.name.substring(0, slashIdx);
        if (!groupMap.has(root)) groupMap.set(root, { rootTag: null, children: [] });
        groupMap.get(root).children.push(tag);
      } else {
        if (!groupMap.has(tag.name)) groupMap.set(tag.name, { rootTag: null, children: [] });
        groupMap.get(tag.name).rootTag = tag;
      }
    }
    // For implicit parents (children exist but no standalone parent tag), create a virtual root
    for (const [root, group] of groupMap) {
      if (!group.rootTag && group.children.length > 0) {
        const totalCount = group.children.reduce((sum, c) => sum + (c.usage_count || 0), 0);
        group.rootTag = { name: root, usage_count: totalCount, isVirtual: true };
      }
    }
    return groupMap;
  }, [allTags]);

  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const toggleGroupExpand = (root) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root); else next.add(root);
      return next;
    });
  };

  // 渲染层级标签树
  const renderHierarchicalTags = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {Array.from(tagGroups.entries()).map(([root, group]) => {
        if (group.children.length === 0 && group.rootTag) {
          // Standalone tag — flat chip
          return (
            <Box key={root} sx={{ display: 'inline-flex' }}>
              <FilterChip
                label={group.rootTag.name}
                value={group.rootTag.name}
                isSelected={selectedTags.includes(group.rootTag.name)}
                onClick={toggleTag}
                color={getTagColor(group.rootTag.name)}
                count={group.rootTag.usage_count}
              />
            </Box>
          );
        }
        // Group with children
        const isExpanded = expandedGroups.has(root);
        return (
          <Box key={root}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton
                size="small"
                onClick={() => toggleGroupExpand(root)}
                aria-label="展开收起标签组"
                sx={{
                  p: 0, width: 20, height: 20,
                  transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: 'transform 0.2s'
                }}
              >
                <ExpandMoreIcon sx={{ fontSize: 16 }} />
              </IconButton>
              {group.rootTag && (
                <FilterChip
                  label={group.rootTag.name}
                  value={group.rootTag.name}
                  isSelected={selectedTags.includes(group.rootTag.name)}
                  onClick={toggleTag}
                  color={getTagColor(group.rootTag.name)}
                  count={group.rootTag.usage_count}
                />
              )}
              <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                {group.children.length}
              </Typography>
            </Box>
            <Collapse in={isExpanded}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pl: 3, pt: 0.5, pb: 0.5 }}>
                {group.children.map(child => (
                  <FilterChip
                    key={child.name}
                    label={child.name.substring(root.length + 1)}
                    value={child.name}
                    isSelected={selectedTags.includes(child.name)}
                    onClick={toggleTag}
                    color={getTagColor(child.name)}
                    count={child.usage_count}
                  />
                ))}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );

  // 渲染加载状态
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

  // 如果没有标签数据，不显示组件
  if (!isLoading && allTags.length === 0) {
    return null;
  }

  // 渲染内容
  const renderContent = () => {
    if (isLoading) {
      return renderLoadingState();
    }

    return (
      <Box>
        {/* 层级标签树 */}
        {renderHierarchicalTags()}
      </Box>
    );
  };

  return (
    <BaseFilter
      title="标签筛选"
      selectedItems={selectedTags}
      onClearAll={clearAllFilters}
      expandable={allTags.length > 0}
      isExpanded={isExpanded}
      onToggleExpand={() => setIsExpanded(!isExpanded)}
      sx={sx}
    >
      {renderContent()}
    </BaseFilter>
  );
};

export default TagFilter;