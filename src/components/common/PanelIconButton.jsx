import { forwardRef } from 'react'
import { IconButton, Tooltip, alpha } from '@mui/material'

// 浮动面板 / 弹层头部的统一图标按钮（参考「问 AI」小窗的新建对话、关闭按钮）
// - 圆角方形，涟漪裁切在按钮内，不会溢出成圆形
// - size: 'md' 用于面板标题栏（26px），'sm' 用于分组标题行 / 列表行内（22px）
// - tone: 'danger' 悬停时显示错误色，用于删除类操作
const SIZES = {
  md: { box: 26, icon: 16 },
  sm: { box: 22, icon: 15 }
}

const PanelIconButton = forwardRef(function PanelIconButton(
  { title, size = 'md', tone = 'default', children, sx, stopDrag = true, onMouseDown, ...props },
  ref
) {
  const dim = SIZES[size] || SIZES.md
  const button = (
    <IconButton
      ref={ref}
      size="small"
      centerRipple={false}
      aria-label={typeof title === 'string' ? title : undefined}
      onMouseDown={(event) => {
        // 面板标题栏通常可拖拽，按钮上按下不应触发拖拽
        if (stopDrag) event.stopPropagation()
        onMouseDown?.(event)
      }}
      {...props}
      sx={[
        (theme) => ({
          width: dim.box,
          height: dim.box,
          p: 0,
          flexShrink: 0,
          borderRadius: 1,
          color: 'text.secondary',
          overflow: 'hidden',
          '& .MuiTouchRipple-root': { inset: 0, borderRadius: 'inherit', overflow: 'hidden' },
          '& .MuiTouchRipple-child': { borderRadius: '8px !important' },
          '& .MuiSvgIcon-root': { fontSize: dim.icon },
          transition: 'color 160ms ease, background-color 160ms ease, opacity 160ms ease',
          '&:hover': tone === 'danger'
            ? { color: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.08) }
            : { color: 'text.primary', bgcolor: alpha(theme.palette.text.primary, 0.06) }
        }),
        ...(Array.isArray(sx) ? sx : [sx])
      ]}
    >
      {children}
    </IconButton>
  )

  if (!title) return button
  // disabled 的按钮不会触发事件，需要包一层 span 让 Tooltip 正常工作
  return (
    <Tooltip title={title}>
      <span style={{ display: 'inline-flex' }}>{button}</span>
    </Tooltip>
  )
})

export default PanelIconButton
