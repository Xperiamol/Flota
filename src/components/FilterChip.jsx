import React from 'react';
import { Chip } from '@mui/material';

/**
 * 通用筛选芯片组件
 * 提供统一的筛选芯片样式和交互
 * 支持自定义颜色、图标和选中状态
 */
const FilterChip = ({
  // 基础属性
  label,
  value,
  isSelected = false,
  onClick,
  
  // 样式属性
  color,
  icon,
  count,
  
  // 其他属性
  disabled = false,
  size = 'small',
  variant = 'outlined',
  ...props
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick(value);
    }
  };

  // 构建标签文本
  const chipLabel = count !== undefined ? `${label} (${count})` : label;

  return (
    <Chip
      label={chipLabel}
      icon={icon}
      size={size}
      variant={isSelected ? 'filled' : variant}
      onClick={handleClick}
      disabled={disabled}
      sx={{
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background-color 0.2s ease-in-out, color 0.2s ease-in-out, box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out',
        
        // 选中状态样式
        ...(isSelected && {
          backgroundColor: color || 'primary.main',
          color: 'white',
          '& .MuiChip-icon': {
            color: 'white'
          },
          '&:hover': {
            backgroundColor: color || 'primary.dark'
          }
        }),
        
        // 未选中状态样式
        ...(!isSelected && {
          borderColor: color || 'divider',
          color: color || 'text.primary',
          '& .MuiChip-icon': {
            color: color || 'text.secondary'
          },
          '&:hover': {
            backgroundColor: color ? `${color}20` : 'action.hover',
            borderColor: color || 'primary.main'
          }
        }),
        
        // 禁用状态样式
        ...(disabled && {
          opacity: 0.5,
          cursor: 'not-allowed'
        })
      }}
      {...props}
    />
  );
};

export default FilterChip;