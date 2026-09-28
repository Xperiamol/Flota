import { Box, ButtonBase, Typography } from '@mui/material';

/**
 * 筛选分组（浮窗内的一段维度，比如「标签」「优先级」「类型」）：
 * 小标题 + 选中后出现的「清除」+ 内容。icon 参数保留兼容，但不再显示，让面板更干净。
 */
const BaseFilter = ({
  title,
  selectedItems = [],
  onClearAll,
  children,
  sx = {}
}) => {
  const hasSelection = selectedItems.length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 20 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {hasSelection && onClearAll && (
          <ButtonBase
            onClick={onClearAll}
            aria-label={`清除「${title}」的筛选`}
            sx={{
              px: 0.625, height: 20, borderRadius: '6px', fontSize: 11.5, color: 'text.secondary',
              '&:hover': { color: 'primary.main', bgcolor: 'action.hover' },
            }}
          >
            清除
          </ButtonBase>
        )}
      </Box>
      <Box>{children}</Box>
    </Box>
  );
};

export default BaseFilter;
