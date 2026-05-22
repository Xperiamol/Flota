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
  Close as CloseIcon
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

  const actionButtonSx = {
    color: 'inherit',
    textTransform: 'none',
    minWidth: 'auto',
    height: 28,
    px: 1,
    borderRadius: '9px',
    border: '1px solid',
    borderColor: 'rgba(148,163,184,0.28)',
    fontWeight: 600,
    fontSize: '0.75rem',
    lineHeight: 1,
    '&:hover': {
      borderColor: 'rgba(148,163,184,0.45)',
      backgroundColor: 'rgba(255,255,255,0.12)'
    },
    '& .MuiButton-startIcon': {
      mr: 0.5,
      '& .MuiSvgIcon-root': {
        fontSize: 16
      }
    },
    '&.Mui-disabled': {
      color: 'rgba(255,255,255,0.55)',
      borderColor: 'rgba(255,255,255,0.2)'
    }
  };

  const dangerButtonSx = {
    ...actionButtonSx,
    borderColor: 'rgba(255,255,255,0.45)',
    '&:hover': {
      borderColor: 'error.main',
      backgroundColor: 'error.main',
      color: 'error.contrastText'
    }
  };
  
  if (!visible) {
    return null;
  }
  
  return (
    <Fade in={visible} timeout={200}>
      <Box
        sx={(theme) => ({
          borderBottom: 1,
          borderColor: theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)',
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(30,41,59,0.78)'
            : 'rgba(248,251,255,0.82)',
          color: 'text.primary',
          backdropFilter: 'blur(18px) saturate(160%)',
          WebkitBackdropFilter: 'blur(18px) saturate(160%)'
        })}
      >
        <Toolbar
          variant="dense"
          sx={{
            minHeight: 40,
            pl: 1,
            pr: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 0.75
          }}
        >
          {/* 关闭按钮 */}
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="关闭多选"
            sx={{
              color: 'inherit',
              ml: -1.6,
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: '9px'
            }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
          
          {/* 选中数量显示 */}
          <Typography variant="body2" sx={{ fontSize: '0.8125rem', fontWeight: 650, whiteSpace: 'nowrap' }}>
            已选择 {selectedCount} 个{itemType}
          </Typography>
          
          <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'divider' }} />
          
          {/* 全选/取消全选 */}
          <Button
             size="small"
             startIcon={isAllSelected ? <ClearIcon /> : <SelectAllIcon />}
             onClick={isAllSelected ? onSelectNone : onSelectAll}
             sx={actionButtonSx}
           >
             {isAllSelected ? '取消全选' : '全选'}
           </Button>
          
          {/* 只有在有操作时显示分隔符 */}
          {(onDelete || onSetTags || customActions.length > 0) && (
            <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'divider' }} />
          )}
          
          {/* 删除按钮 - 始终显示（如果提供） */}
          {onDelete && (
            <Button
              size="small"
              startIcon={<DeleteIcon />}
              onClick={onDelete}
              disabled={selectedCount === 0}
              sx={dangerButtonSx}
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
              sx={actionButtonSx}
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
                ...actionButtonSx,
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
              height: 24,
              borderColor: 'divider',
              color: 'inherit',
              fontSize: '0.7rem',
              fontWeight: 650,
              borderRadius: '8px'
            }}
          />
        </Toolbar>
      </Box>
    </Fade>
  );
};

export default MultiSelectToolbar;
