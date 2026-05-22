import React from 'react';
import { Box } from '@mui/material';
import BaseFilter from './BaseFilter';
import FilterChip from './FilterChip';

/**
 * 通用枚举多选筛选组件
 * 用于"是否置顶 / 是否含图片 / 完成状态 / 截止日周期"等可枚举的固定维度。
 *
 * options: Array<{ key: string, label: string, color?: string, icon?: ReactNode, count?: number }>
 */
const ChoiceFilter = ({
  title,
  icon,
  options = [],
  selectedKeys = [],
  onChange,
  sx = {}
}) => {
  const toggleKey = (key) => {
    const next = selectedKeys.includes(key)
      ? selectedKeys.filter((k) => k !== key)
      : [...selectedKeys, key];
    onChange?.(next);
  };

  const handleClearAll = () => onChange?.([]);

  return (
    <BaseFilter
      title={title}
      icon={icon}
      selectedItems={selectedKeys}
      onClearAll={handleClearAll}
      sx={sx}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {options.map((opt) => (
          <FilterChip
            key={opt.key}
            label={opt.label}
            value={opt.key}
            isSelected={selectedKeys.includes(opt.key)}
            onClick={toggleKey}
            color={opt.color}
            icon={opt.icon}
            count={opt.count}
          />
        ))}
      </Box>
    </BaseFilter>
  );
};

export default ChoiceFilter;
