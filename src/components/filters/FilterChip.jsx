import { Box, ButtonBase, alpha } from '@mui/material';

/**
 * 筛选芯片：未选中是浅底，选中是主题色浅底 + 主题色文字。
 * color（标签色、优先级色）只画成前面的小圆点，不再把整颗芯片染色，避免一面板花花绿绿。
 */
const FilterChip = ({
  label,
  value,
  isSelected = false,
  onClick,
  color,
  icon,
  count,
  disabled = false,
}) => (
  <ButtonBase
    onClick={() => { if (!disabled) onClick?.(value); }}
    disabled={disabled}
    aria-pressed={isSelected}
    sx={(theme) => {
      const accent = theme.palette.primary.main;
      return {
        height: 28,
        px: 1.125,
        gap: 0.625,
        borderRadius: '8px',
        fontSize: 12.5,
        fontWeight: isSelected ? 600 : 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: isSelected ? accent : 'text.primary',
        bgcolor: isSelected
          ? alpha(accent, theme.palette.mode === 'dark' ? 0.24 : 0.13)
          : alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.09 : 0.06),
        boxShadow: isSelected ? `inset 0 0 0 1px ${alpha(accent, 0.35)}` : 'none',
        transition: 'background-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 120ms ease',
        '&:hover': {
          bgcolor: isSelected
            ? alpha(accent, theme.palette.mode === 'dark' ? 0.3 : 0.18)
            : alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.14 : 0.1),
        },
        '&:active': { transform: 'scale(0.96)' },
        '&.Mui-disabled': { opacity: 0.5 },
        '& .MuiSvgIcon-root': { fontSize: 15, color: isSelected ? accent : 'text.secondary' },
      };
    }}
  >
    {color && (
      <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
    )}
    {icon}
    <span>{label}</span>
    {count !== undefined && (
      <Box component="span" sx={{ fontSize: 11.5, fontWeight: 500, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>
        {count}
      </Box>
    )}
  </ButtonBase>
);

export default FilterChip;
