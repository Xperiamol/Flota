import React, { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import { Flag as FlagIcon } from '@mui/icons-material';
import BaseFilter from './BaseFilter';
import FilterChip from './FilterChip';
import { getAllPriorities, getPriorityIcon } from '../utils/priorityUtils';

/**
 * 优先级筛选组件
 * 浮窗筛选器中的「优先级」分组。
 */
const PriorityFilter = ({
  selectedPriorities = [],
  onPrioritiesChange,
  sx = {}
}) => {
  const [priorities, setPriorities] = useState([]);
  const [, setIsLoading] = useState(false);

  // 加载优先级统计数据
  const loadPriorityStats = async () => {
    setIsLoading(true);
    try {
      const response = await window.electronAPI.todos.getPriorityStats();
      if (response.success) {
        const stats = response.data;
        const prioritiesWithStats = getAllPriorities().map(priority => ({
          ...priority,
          count: stats[priority.key] || 0
        }));
        setPriorities(prioritiesWithStats);
      } else {
        console.error('获取优先级统计失败:', response.error);
        // 使用默认数据
        setPriorities(getAllPriorities().map(priority => ({
          ...priority,
          count: 0
        })));
      }
    } catch (error) {
      console.error('获取优先级统计失败:', error);
      // 使用默认数据
      setPriorities(getAllPriorities().map(priority => ({
        ...priority,
        count: 0
      })));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPriorityStats();
  }, []);

  // 切换优先级选择状态
  const togglePriority = (priorityKey) => {
    const newSelectedPriorities = selectedPriorities.includes(priorityKey)
      ? selectedPriorities.filter(p => p !== priorityKey)
      : [...selectedPriorities, priorityKey];
    
    onPrioritiesChange?.(newSelectedPriorities);
  };

  // 清空所有筛选
  const clearAllFilters = () => {
    onPrioritiesChange?.([]);
  };

  // 渲染优先级芯片
  const renderPriorityChips = () => {
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {priorities.map(priority => (
          <FilterChip
            key={priority.key}
            label={priority.label}
            value={priority.key}
            isSelected={selectedPriorities.includes(priority.key)}
            onClick={togglePriority}
            color={priority.color}
            icon={getPriorityIcon(priority.key, { fontSize: 14 })}
            count={priority.count}
          />
        ))}
      </Box>
    );
  };

  return (
    <BaseFilter
      title="优先级"
      icon={<FlagIcon />}
      selectedItems={selectedPriorities}
      onClearAll={clearAllFilters}
      sx={sx}
    >
      {renderPriorityChips()}
    </BaseFilter>
  );
};

export default PriorityFilter;