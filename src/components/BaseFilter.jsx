import React from 'react';
import {
  Box,
  Chip,
  Typography,
  IconButton,
  Paper,
  Tooltip,
  Collapse
} from '@mui/material';
import {
  FilterList as FilterIcon,
  Clear as ClearIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';

/**
 * 基础筛选组件
 * 提供筛选组件的通用UI结构和交互逻辑
 * 遵循DRY原则，减少代码重复
 */
const BaseFilter = ({
  // 基础属性
  title,
  selectedItems = [],
  onClearAll,
  
  // 展开/收起功能
  expandable = false,
  isExpanded = false,
  onToggleExpand,
  
  // 内容渲染
  children,
  
  // 样式
  sx = {}
}) => {
  const selectedCount = selectedItems.length;
  const hasSelection = selectedCount > 0;

  return (
    <Paper 
      elevation={0} 
      sx={{ 
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        ...sx 
      }}
    >
      {/* 标题栏 */}
      <Box 
        onClick={expandable ? onToggleExpand : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1,
          backgroundColor: 'background.paper',
          borderBottom: hasSelection || (expandable && isExpanded) ? '1px solid' : 'none',
          borderBottomColor: 'divider',
          cursor: expandable ? 'pointer' : 'default',
          '&:hover': expandable ? {
            backgroundColor: 'action.hover'
          } : {}
        }}>
        {/* 左侧：图标和标题 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {title}
          </Typography>
          {hasSelection && (
            <Chip 
              label={selectedCount}
              size="small"
              sx={{ 
                height: 20,
                fontSize: '0.75rem',
                backgroundColor: 'primary.main',
                color: 'primary.contrastText'
              }}
            />
          )}
        </Box>
        
        {/* 右侧：操作按钮 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {/* 清空筛选按钮 */}
          {hasSelection && (
            <Tooltip title="清空筛选">
              <IconButton 
                size="small" 
                onClick={(e) => {
                  e.stopPropagation(); // 阻止事件冒泡到父元素
                  onClearAll();
                }}
                sx={{ 
                  color: 'text.secondary',
                  '&:hover': {
                    color: 'error.main',
                    backgroundColor: 'error.light'
                  }
                }}
              >
                <ClearIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
      
      {/* 内容区域 */}
      {expandable ? (
        <Collapse in={isExpanded}>
          <Box sx={{ p: 2, maxHeight: 220, overflowY: 'auto' }}>
            {children}
          </Box>
        </Collapse>
      ) : (
        <Box sx={{ p: 2, maxHeight: 220, overflowY: 'auto' }}>
          {children}
        </Box>
      )}
    </Paper>
  );
};

export default BaseFilter;