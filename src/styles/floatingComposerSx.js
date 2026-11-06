import { alpha } from '@mui/material/styles'
import { BLUR, RADIUS } from './materials'

// 悬浮玻璃输入框：AI 页面与时间轴共用，保证两处输入框长得一样。
//
// 用法：外层 floatingComposerDockSx 绝对定位到容器底部（容器需 position: relative，
// 滚动区底部留出 ~120px），内层 floatingComposerSx 是玻璃本体。

export const floatingComposerDockSx = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  px: 3,
  pt: 4,
  pb: 1.5,
  maxWidth: 900,
  mx: 'auto',
  width: '100%',
  // 外层不挡住下面消息的点击 / 滚动，只有玻璃本体可交互
  pointerEvents: 'none',
}

/**
 * @param {object} theme MUI theme
 * @param {object} [options]
 * @param {boolean} [options.highlight] 强制高亮描边（如拖入文件时）
 */
export const floatingComposerSx = (theme, { highlight = false } = {}) => {
  const dark = theme.palette.mode === 'dark'
  const primary = theme.palette.primary.main
  const focusShadow = dark
    ? `0 14px 40px rgba(0,0,0,0.5), 0 0 0 3px ${alpha(primary, 0.18)}, inset 0 1px 0 rgba(255,255,255,0.12)`
    : `0 14px 40px rgba(22,22,24,0.16), 0 0 0 3px ${alpha(primary, 0.12)}, inset 0 1px 0 rgba(255,255,255,0.95)`
  const focusBorder = alpha(primary, dark ? 0.55 : 0.45)
  return {
    pointerEvents: 'auto',
    borderRadius: `${RADIUS.lg}px`,
    backgroundColor: dark ? 'rgba(32,32,38,0.4)' : 'rgba(255,255,255,0.35)',
    backgroundImage: dark
      ? 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01))'
      : 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1))',
    backdropFilter: BLUR.strong,
    WebkitBackdropFilter: BLUR.strong,
    border: `1px solid ${highlight ? focusBorder : dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.85)'}`,
    boxShadow: highlight
      ? focusShadow
      : dark
        ? '0 12px 36px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.12)'
        : '0 12px 36px rgba(22,22,24,0.14), 0 2px 8px rgba(22,22,24,0.06), inset 0 1px 0 rgba(255,255,255,0.95)',
    transition: 'border-color 0.2s ease, box-shadow 0.25s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
    '&:focus-within': {
      borderColor: focusBorder,
      boxShadow: focusShadow,
      transform: 'translateY(-1px)',
    },
  }
}

// 输入框右侧的发送 / 停止按钮
export const floatingComposerSendSx = (theme, { active = false, danger = false } = {}) => ({
  width: 36,
  height: 36,
  borderRadius: `${RADIUS.md}px`,
  flexShrink: 0,
  bgcolor: danger
    ? alpha(theme.palette.error.main, 0.12)
    : active ? theme.palette.primary.main : 'transparent',
  color: danger
    ? theme.palette.error.main
    : active ? theme.palette.primary.contrastText : theme.palette.action.disabled,
  boxShadow: active && !danger ? `0 4px 12px ${alpha(theme.palette.primary.main, 0.35)}` : 'none',
  '&:hover': {
    bgcolor: danger
      ? alpha(theme.palette.error.main, 0.2)
      : active ? theme.palette.primary.dark : 'transparent',
  },
  '&.Mui-disabled': { color: theme.palette.action.disabled },
  transition: 'all 0.2s',
})

// 输入框左侧的辅助按钮（附件、语音等）：安静的图标按钮
export const floatingComposerToolSx = (theme) => ({
  width: 32,
  height: 32,
  borderRadius: `${RADIUS.sm}px`,
  flexShrink: 0,
  color: 'text.secondary',
  transition: 'background-color 160ms ease, color 160ms ease',
  '&:hover': {
    color: 'text.primary',
    bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06),
  },
})
