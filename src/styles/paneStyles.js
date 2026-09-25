import { alpha } from '@mui/material/styles'
import { useStore } from '../store/useStore'

/**
 * 应用外框的「浮岛」布局：左侧栏、二级侧栏、主内容区是三块独立的圆角面板，
 * 放在应用背景（纯色 / 花纹 / 壁纸）上，面板之间留出间隙。
 * 所有面板共用同一种材质，面板内部的列表不再各自设置底色。
 */
export const PANE_GAP = 8
export const PANE_RADIUS = 14

// 有背景花纹或壁纸时，面板按「遮罩透明度」设置透出背景；没有背景时面板是实心的
const MASK_OPACITY = { none: 0.35, light: 0.6, medium: 0.8, heavy: 0.93 }

export const paneOpacity = (maskOpacity, backgroundPattern) => (
  backgroundPattern && backgroundPattern !== 'none' ? (MASK_OPACITY[maskOpacity] ?? MASK_OPACITY.medium) : 1
)

/** 当前设置下面板的不透明度 */
export const usePaneOpacity = () => {
  const maskOpacity = useStore((state) => state.maskOpacity)
  const backgroundPattern = useStore((state) => state.backgroundPattern)
  return paneOpacity(maskOpacity, backgroundPattern)
}

/** 面板材质：统一底色、细边框、圆角；半透明时加模糊保证文字可读 */
export const paneSurfaceSx = (theme, opacity = 1, { radius = PANE_RADIUS } = {}) => ({
  backgroundColor: opacity >= 1 ? theme.palette.background.paper : alpha(theme.palette.background.paper, opacity),
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: `${radius}px`,
  ...(opacity < 1 ? { backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' } : {}),
})

/**
 * 液态玻璃材质：用于浮在背景上的外框（左侧栏、二级侧栏、工具栏控件）。
 * 半透明底 + 背景模糊提饱和 + 顶部高光边 + 左上角淡淡的光泽 + 浮起阴影；
 * 正文所在的主内容面板保持实心，保证可读性。
 * 有壁纸或花纹时按遮罩透明度再调整底色浓度。
 */
export const liquidGlassSx = (theme, { opacity = 1, radius = PANE_RADIUS, elevated = true } = {}) => {
  const dark = theme.palette.mode === 'dark'
  // 底色浓度：无背景时 0.62 / 0.55，有壁纸时随遮罩透明度变化
  const base = dark ? 0.55 : 0.62
  const tint = opacity >= 1 ? base : Math.max(0.3, Math.min(0.9, opacity * base / 0.8))
  return {
    borderRadius: `${radius}px`,
    backgroundColor: dark ? `rgba(44,44,48,${tint})` : `rgba(255,255,255,${tint})`,
    // 光泽：左上角一层很淡的斜向高光，作为背景图层画在内容下面
    backgroundImage: dark
      ? 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 42%)'
      : 'linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 45%)',
    backdropFilter: 'blur(22px) saturate(180%)',
    WebkitBackdropFilter: 'blur(22px) saturate(180%)',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)'}`,
    boxShadow: [
      elevated ? (dark ? '0 10px 30px rgba(0,0,0,0.38)' : '0 10px 30px rgba(22,22,24,0.07)') : null,
      elevated ? (dark ? '0 1px 2px rgba(0,0,0,0.3)' : '0 1px 3px rgba(22,22,24,0.06)') : null,
      `inset 0 1px 0 ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.95)'}`,
      `inset 0 -1px 0 ${dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.4)'}`,
    ].filter(Boolean).join(', '),
  }
}
