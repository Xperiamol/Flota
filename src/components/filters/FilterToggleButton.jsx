import { forwardRef } from 'react';
import { IconButton, Tooltip, Badge, alpha } from '@mui/material';
import { FilterList as FilterIcon } from '../common/AppIcons';
import zhCN from '../../locales/zh-CN';

const {
  filters: { toggleButton }
} = zhCN;

/**
 * 搜索框筛选器切换按钮组件
 * 配合 FilterPopover 浮窗使用，自身作为 anchor。
 */
const FilterToggleButton = forwardRef(function FilterToggleButton(
  {
    filtersVisible,
    onToggle,
    tooltipTitle = toggleButton.tooltip,
    size = 'small',
    disabled = false,
    selectedCount = 0
  },
  ref
) {
  return (
    <Tooltip title={tooltipTitle}>
      <Badge
        ref={ref}
        color="primary"
        badgeContent={selectedCount}
        invisible={!selectedCount}
        overlap="circular"
        sx={{
          '& .MuiBadge-badge': {
            height: 14,
            minWidth: 14,
            fontSize: 9,
            fontWeight: 600,
            padding: '0 3px'
          }
        }}
      >
        <IconButton
          size={size}
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={filtersVisible}
          sx={(theme) => ({
            color: filtersVisible || selectedCount ? 'primary.main' : 'text.secondary',
            backgroundColor: filtersVisible ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.12) : 'transparent',
            transition: 'color 0.2s ease, background-color 0.2s ease',
            '&:hover': {
              color: filtersVisible || selectedCount ? 'primary.main' : 'text.primary',
              backgroundColor: filtersVisible ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.3 : 0.18) : 'action.hover'
            }
          })}
        >
          <FilterIcon />
        </IconButton>
      </Badge>
    </Tooltip>
  );
});

export default FilterToggleButton;
