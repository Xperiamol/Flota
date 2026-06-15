import React from 'react';
import { Box, Divider } from '@mui/material';
import TagFilter from './TagFilter';
import PriorityFilter from './PriorityFilter';

/**
 * 筛选容器组件
 * 浮窗内的多分组筛选承载（标签 / 优先级 / 通过 extraGroups 注入的自定义分组）。
 */
const FilterContainer = ({
  showTagFilter = false,
  showPriorityFilter = false,

  selectedTags = [],
  onTagsChange,
  showDeleted = false,
  isTodoFilter = false,

  selectedPriorities = [],
  onPrioritiesChange,

  // 额外的筛选分组（已是 React 节点；按数组顺序在标签/优先级之后渲染）
  extraGroups = [],

  sx = {}
}) => {
  const groups = [];
  if (showTagFilter) {
    groups.push(
      <TagFilter
        key="tag"
        selectedTags={selectedTags}
        onTagsChange={onTagsChange}
        showDeleted={showDeleted}
        isTodoFilter={isTodoFilter}
      />
    );
  }
  if (showPriorityFilter) {
    groups.push(
      <PriorityFilter
        key="priority"
        selectedPriorities={selectedPriorities}
        onPrioritiesChange={onPrioritiesChange}
      />
    );
  }

  for (const node of extraGroups) {
    if (node) groups.push(node);
  }

  if (groups.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, ...sx }}>
      {groups.map((group, index) => (
        <React.Fragment key={group.key ?? `group-${index}`}>
          {index > 0 && <Divider flexItem sx={{ opacity: 0.4 }} />}
          {group}
        </React.Fragment>
      ))}
    </Box>
  );
};

export default FilterContainer;

