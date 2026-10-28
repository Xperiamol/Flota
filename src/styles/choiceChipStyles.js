import { alpha } from '@mui/material/styles'

// 设置选项和筛选按钮共用的浅底圆角样式。
export const choiceChipStyles = (theme, selected = false) => {
  const dark = theme.palette.mode === 'dark'
  const accent = theme.palette.primary.main
  return {
    height: 28,
    border: 0,
    borderRadius: '8px',
    fontSize: 12.5,
    fontWeight: selected ? 600 : 500,
    lineHeight: 1,
    color: selected ? accent : theme.palette.text.primary,
    backgroundColor: alpha(selected ? accent : theme.palette.text.primary, selected ? (dark ? 0.24 : 0.13) : (dark ? 0.09 : 0.06)),
    boxShadow: 'none',
    transition: 'background-color 140ms ease, color 140ms ease, transform 120ms ease',
    '&:hover': {
      backgroundColor: alpha(selected ? accent : theme.palette.text.primary, selected ? (dark ? 0.3 : 0.18) : (dark ? 0.14 : 0.1)),
    },
    '&:active': { transform: 'scale(0.96)' },
    '&.Mui-focusVisible': { outline: `2px solid ${alpha(accent, 0.65)}`, outlineOffset: 2 },
  }
}
