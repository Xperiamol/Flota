import { Box, Chip, Typography, IconButton, Tooltip, alpha } from '@mui/material';
import { Clear as ClearIcon } from '../common/AppIcons';

/**
 * 筛选分组（浮窗内的一段维度，比如「标签」「优先级」「类别」）。
 * 自身不带 Paper / Collapse，只负责"标题 + 操作 + 内容"。
 */
const BaseFilter = ({
  title,
  icon,
  selectedItems = [],
  onClearAll,
  children,
  sx = {}
}) => {
  const selectedCount = selectedItems.length;
  const hasSelection = selectedCount > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 22 }}>
        {icon && (
          <Box sx={{ display: 'inline-flex', color: 'text.secondary', '& > *': { fontSize: 14 } }}>
            {icon}
          </Box>
        )}
        <Typography
          variant="caption"
          sx={(theme) => ({
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: alpha(theme.palette.text.primary, 0.66)
          })}
        >
          {title}
        </Typography>
        {hasSelection && (
          <Chip
            size="small"
            label={selectedCount}
            sx={(theme) => ({
              height: 16,
              fontSize: 10,
              fontWeight: 600,
              bgcolor: alpha(theme.palette.primary.main, 0.18),
              color: theme.palette.primary.main,
              '& .MuiChip-label': { px: 0.5 }
            })}
          />
        )}
        <Box sx={{ flex: 1 }} />
        {hasSelection && onClearAll && (
          <Tooltip title="清空">
            <IconButton
              size="small"
              onClick={onClearAll}
              aria-label="清空当前分组"
              sx={(theme) => ({
                width: 20,
                height: 20,
                borderRadius: 0.75,
                color: 'text.secondary',
                '&:hover': { color: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.08) }
              })}
            >
              <ClearIcon sx={{ fontSize: 12 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box>{children}</Box>
    </Box>
  );
};

export default BaseFilter;
