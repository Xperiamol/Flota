import { cloneElement, forwardRef, isValidElement } from 'react'
import { Box, ButtonBase, Tooltip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { BLUR, RADIUS } from '../../styles/materials'

/**
 * 分段控件：几个互斥选项排成一条，选中项是一块实心小片（视图切换、设置里的单选）。
 *
 * 两种尺寸：
 * - medium：顶部栏、编辑器标题栏，总高 32，与旁边的 32px 图标按钮对齐
 * - small：设置行、对话框里的单选，总高 28
 *
 * 内外圆角保持同心：外圆角 = 选中块圆角 + 内边距 + 1px 边框。
 */
const SIZES = {
  medium: { height: 32, pad: 2, fontSize: '0.78rem', px: 1.5, icon: 15 },
  small: { height: 28, pad: 2, fontSize: '0.75rem', px: 1.1, icon: 14 },
}
const INNER_RADIUS = RADIUS.sm - 1

const trackSx = (theme, size, fullWidth) => {
  const dark = theme.palette.mode === 'dark'
  const { height, pad } = SIZES[size]
  return {
    display: fullWidth ? 'flex' : 'inline-flex',
    width: fullWidth ? '100%' : 'auto',
    alignItems: 'center',
    flexShrink: 0,
    gap: `${pad}px`,
    p: `${pad}px`,
    height,
    boxSizing: 'border-box',
    borderRadius: `${INNER_RADIUS + pad + 1}px`,
    border: `1px solid ${dark ? 'rgba(255,255,255,0.09)' : 'rgba(22,22,24,0.07)'}`,
    backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(22,22,24,0.035)',
    backdropFilter: BLUR.medium,
    WebkitBackdropFilter: BLUR.medium,
  }
}

const segmentSx = (theme, size, active, { fullWidth, iconOnly }) => {
  const dark = theme.palette.mode === 'dark'
  const { height, pad, fontSize, px } = SIZES[size]
  const segmentHeight = height - pad * 2 - 2
  return {
    flex: fullWidth ? 1 : '0 0 auto',
    height: segmentHeight,
    minWidth: iconOnly ? segmentHeight + 4 : 0,
    px: iconOnly ? 0 : px,
    gap: 0.5,
    borderRadius: `${INNER_RADIUS}px`,
    fontSize,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
    color: active ? 'text.primary' : 'text.secondary',
    backgroundColor: active ? (dark ? 'rgba(255,255,255,0.12)' : '#ffffff') : 'transparent',
    boxShadow: active
      ? (dark ? '0 1px 2px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)' : '0 1px 3px rgba(22,22,24,0.10)')
      : 'none',
    transition: 'background-color 160ms ease, color 160ms ease, box-shadow 160ms ease',
    '&:hover': active ? null : {
      color: 'text.primary',
      backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(22,22,24,0.05)',
    },
    '&.Mui-focusVisible': { outline: `2px solid ${alpha(theme.palette.primary.main, 0.6)}`, outlineOffset: 1 },
    '&.Mui-disabled': { color: 'text.disabled' },
  }
}

/**
 * @param {object} props
 * @param {Array<{ value: any, label: string, icon?: React.ElementType|React.ReactElement, disabled?: boolean, tooltip?: string }>} props.options
 * @param {any} props.value
 * @param {(value: any) => void} props.onChange 点已选中的项不会触发
 * @param {'medium'|'small'} [props.size]
 * @param {boolean} [props.fullWidth] 撑满父容器，各项等分
 * @param {boolean} [props.iconOnly] 只显示图标（标签进 tooltip）
 * @param {string} [props.ariaLabel]
 */
const SegmentedControl = forwardRef(function SegmentedControl({ options, value, onChange, size = 'medium', fullWidth = false, iconOnly = false, ariaLabel, sx, ...rest }, ref) {
  return (
    <Box
      ref={ref}
      className="flota-segmented"
      role="group"
      aria-label={ariaLabel}
      sx={[(theme) => trackSx(theme, size, fullWidth), ...(Array.isArray(sx) ? sx : [sx])]}
      {...rest}
    >
      {options.map((option) => {
        const active = option.value === value
        const iconSize = SIZES[size].icon
        // icon 可以是组件（ArticleIcon）也可以是元素（<ArticleIcon />）
        const Icon = option.icon
        const iconNode = isValidElement(Icon)
          ? cloneElement(Icon, { sx: { fontSize: iconSize, ...Icon.props.sx } })
          : Icon ? <Icon sx={{ fontSize: iconSize }} /> : null
        const button = (
          <ButtonBase
            key={String(option.value)}
            aria-pressed={active}
            aria-label={iconOnly ? option.label : undefined}
            disabled={option.disabled}
            onClick={() => { if (!active) onChange?.(option.value) }}
            sx={(theme) => segmentSx(theme, size, active, { fullWidth, iconOnly })}
          >
            {iconNode}
            {!iconOnly && option.label}
          </ButtonBase>
        )
        const title = option.tooltip ?? (iconOnly ? option.label : '')
        return title
          ? <Tooltip key={String(option.value)} title={title}><span style={{ display: 'inline-flex', flex: fullWidth ? 1 : undefined }}>{button}</span></Tooltip>
          : button
      })}
    </Box>
  )
})

export default SegmentedControl
