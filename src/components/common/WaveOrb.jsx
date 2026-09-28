import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { alpha, lighten, useTheme } from '@mui/material/styles'

const clampPercent = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null)

/**
 * 水波球：三层转动的波浪按百分比填充一个玻璃圆。
 * 设置里的「本地使用量」和首页的「待办完成率」共用。
 * - 首次出现时水位从底部涨上来；百分比变化时平滑过渡
 * - 玻璃质感：内阴影 + 左上高光 + 细描边，不加外投影
 * - 系统开启「减少动态效果」时波浪不转动
 */
export default function WaveOrb({ percent = null, label, size = 120, accentColor, sx }) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const accent = accentColor || theme.palette.primary.main
  const target = clampPercent(percent)
  // 先以 0 渲染，下一帧再设到目标值，让水位有「涨上来」的过程
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(target ?? 0))
    return () => window.cancelAnimationFrame(frame)
  }, [target])

  const waterTop = `${100 - shown}%`
  const onWater = shown >= 52
  const displayText = label ?? (target == null ? '—' : `${Math.round(target)}%`)
  const border = Math.max(3, Math.round(size / 30))
  const fontSize = Math.round(size * (displayText.length > 3 ? 0.22 : 0.26))

  const wave = (radius, background, duration, reverse = false) => (
    <Box sx={{
      position: 'absolute', width: '200%', height: '200%', left: '-50%', top: waterTop,
      borderRadius: radius, background,
      transition: 'top 1400ms cubic-bezier(0.22, 1, 0.36, 1)',
      animation: `flotaWaveSpin ${duration}s linear infinite${reverse ? ' reverse' : ''}`,
      '@keyframes flotaWaveSpin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    }} />
  )

  return (
    <Box sx={[{
      width: size, height: size, borderRadius: '50%', position: 'relative', overflow: 'hidden', flexShrink: 0,
      bgcolor: dark ? alpha('#000', 0.28) : alpha('#fff', 0.55),
      border: `${border}px solid ${dark ? alpha('#fff', 0.08) : alpha('#fff', 0.9)}`,
      boxShadow: dark
        ? `inset 0 2px 10px ${alpha('#000', 0.45)}, 0 0 0 1px ${alpha(accent, 0.18)}`
        : `inset 0 2px 12px ${alpha('#161618', 0.08)}, 0 0 0 1px ${alpha('#161618', 0.06)}`,
      isolation: 'isolate',
    }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {wave('40%', alpha(accent, 0.3), 7, true)}
      {wave('42%', alpha(accent, 0.5), 9)}
      {wave('38%', `linear-gradient(180deg, ${alpha(lighten(accent, 0.08), 0.95)} 0%, ${alpha(accent, 0.78)} 100%)`, 5.5)}
      {/* 玻璃高光 */}
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', borderRadius: '50%',
        background: `radial-gradient(circle at 30% 22%, ${alpha('#fff', dark ? 0.16 : 0.55)} 0%, ${alpha('#fff', 0)} 42%)`,
      }} />
      <Box sx={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{
          fontSize, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
          color: onWater ? '#fff' : (dark ? lighten(accent, 0.3) : accent),
          textShadow: onWater ? `0 1px 8px ${alpha('#000', 0.22)}` : 'none',
          transition: 'color 400ms ease, text-shadow 400ms ease',
        }}>
          {displayText}
        </Typography>
      </Box>
    </Box>
  )
}
