import React from 'react';
import {
  Box,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Divider,
  Chip,
  Fade
} from '@mui/material';
import {
  SelectAll as SelectAllIcon,
  Clear as ClearIcon,
  Delete as DeleteIcon,
  Label as LabelIcon,
  Close as CloseIcon,
  MoreVert as MoreVertIcon
} from '@mui/icons-material';

/**
 * 通用多选工具栏组件
 * 遵循SOLID原则，提供独立的多选操作界面
 * @param {Object} props - 组件属性
 * @param {boolean} props.visible - 是否显示工具栏
 * @param {number} props.selectedCount - 选中项目数量
 * @param {number} props.totalCount - 总项目数量
 * @param {Function} props.onSelectAll - 全选回调
 * @param {Function} props.onSelectNone - 取消全选回调
 * @param {Function} props.onDelete - 删除回调
 * @param {Function} props.onSetTags - 设置标签回调
 * @param {Function} props.onClose - 关闭多选模式回调
 * @param {string} props.itemType - 项目类型（用于显示文本）
 * @param {Array} props.customActions - 自定义操作按钮
 */
const MultiSelectToolbar = ({
  visible = false,
  selectedCount = 0,
  totalCount = 0,
  onSelectAll,
  onSelectNone,
  onDelete,
  onSetTags,
  onClose,
  itemType = '项目',
  customActions = []
}) => {
  const isAllSelected = selectedCount === totalCount && totalCount > 0;
  
  if (!visible) {
    return null;
  }
  
  return (
    <Fade in={visible} timeout={200}>
      <Box
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          backgroundColor: 'primary.light',
          color: 'primary.contrastText'
        }}
      >
        <Toolbar
          variant="dense"
          sx={{
            minHeight: 48,
            px: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
        >
          {/* 关闭按钮 */}
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="关闭多选"
            sx={{
              color: 'inherit',
              mr: 1
            }}
          >
            <CloseIcon />
          </IconButton>
          
          {/* 选中数量显示 */}
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            已选择 {selectedCount} 个{itemType}
          </Typography>
          
          <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'currentColor' }} />
          
          {/* 全选/取消全选 */}
          <Button
             size="small"
             startIcon={isAllSelected ? <ClearIcon /> : <SelectAllIcon />}
             onClick={isAllSelected ? onSelectNone : onSelectAll}
             sx={{
               color: 'inherit',
               textTransform: 'none',
               minWidth: 'auto'
             }}
           >
             {isAllSelected ? '取消全选' : '全选'}
           </Button>
          
          {/* 只有在有操作时显示分隔符 */}
          {(onDelete || onSetTags || customActions.length > 0) && (
            <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'currentColor' }} />
          )}
          
          {/* 删除按钮 - 始终显示（如果提供） */}
          {onDelete && (
            <Button
              size="small"
              startIcon={<DeleteIcon />}
              onClick={onDelete}
              disabled={selectedCount === 0}
              sx={{
                color: 'inherit',
                textTransform: 'none',
                minWidth: 'auto',
                '&:hover': {
                  backgroundColor: 'error.main',
                  color: 'error.contrastText'
                }
              }}
            >
              删除
            </Button>
          )}
          
          {/* 批量设置标签按钮 - 始终显示（如果提供） */}
          {onSetTags && (
            <Button
              size="small"
              startIcon={<LabelIcon />}
              onClick={onSetTags}
              disabled={selectedCount === 0}
              sx={{
                color: 'inherit',
                textTransform: 'none',
                minWidth: 'auto'
              }}
            >
              设置标签
            </Button>
          )}
          
          {/* 自定义操作按钮 - 始终显示（如果提供） */}
          {customActions.map((action, index) => (
            <Button
              key={action.key || index}
              size="small"
              startIcon={action.icon}
              onClick={action.onClick}
              disabled={action.disabled || selectedCount === 0}
              sx={{
                color: 'inherit',
                textTransform: 'none',
                minWidth: 'auto',
                ...action.sx
              }}
            >
              {action.label}
            </Button>
          ))}
          
          {/* 弹性空间 */}
          <Box sx={{ flexGrow: 1 }} />
          
          {/* 选中状态指示器 */}
          <Chip
            label={`${selectedCount}/${totalCount}`}
            size="small"
            variant="outlined"
            sx={{
              borderColor: 'currentColor',
              color: 'inherit',
              fontSize: '0.75rem'
            }}
          />
        </Toolbar>
      </Box>
    </Fade>
  );
};

export default MultiSelectToolbar;