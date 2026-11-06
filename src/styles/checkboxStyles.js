import { alpha } from '@mui/material/styles'

/**
 * 全应用唯一的勾选框外观（18px 圆角方块，选中后主色填充 + 白勾）。
 * 主题里的 MuiCheckbox 和编辑器 / 预览里的原生 <input type="checkbox"> 都从这里取，
 * 笔记里的任务列表和设置、待办里的勾长得一样。
 */
export const checkboxParts = ({ isDark, primaryColor }) => ({
  box: {
    position: 'relative',
    display: 'inline-block',
    width: 18,
    height: 18,
    flexShrink: 0,
    boxSizing: 'border-box',
    borderRadius: '6px',
    border: `1.5px solid ${alpha(isDark ? '#d1d1d5' : '#4d4d55', isDark ? 0.58 : 0.68)}`,
    backgroundColor: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.42)',
    transition: 'background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
  },
  checked: {
    borderColor: primaryColor,
    backgroundColor: primaryColor,
    boxShadow: 'none',
  },
  checkmark: {
    content: '""',
    position: 'absolute',
    left: 6,
    top: 2.5,
    width: 4.5,
    height: 8.5,
    border: 'solid #ffffff',
    borderWidth: '0 2px 2px 0',
    transform: 'rotate(45deg)',
    transformOrigin: 'center',
  },
  focusRing: `0 0 0 3px ${alpha(primaryColor, 0.22)}`,
})

/** 原生勾选框（编辑器里的任务列表、Markdown 预览）用的样式 */
export const nativeCheckboxSx = (theme) => {
  const parts = checkboxParts({ isDark: theme.palette.mode === 'dark', primaryColor: theme.palette.primary.main })
  return {
    ...parts.box,
    appearance: 'none',
    WebkitAppearance: 'none',
    margin: 0,
    cursor: 'pointer',
    '&:checked': parts.checked,
    '&:checked::after': parts.checkmark,
    '&:focus-visible': { outline: 'none', boxShadow: parts.focusRing },
    '&:active': { transform: 'scale(0.92)' },
    '&:disabled': { cursor: 'default', opacity: 0.6 },
  }
}
