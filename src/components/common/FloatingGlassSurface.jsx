import { forwardRef } from 'react'
import { Box, ClickAwayListener, Fade, Paper, Portal, alpha } from '@mui/material'

export const FLOATING_LAYER_Z_INDEX = {
  contextMenu: 1500,
  selectionPanel: 1560,
  aiPanel: 1340
}

const getGlassSx = (theme, density = 'regular') => {
  const dark = theme.palette.mode === 'dark'
  const compact = density === 'compact'
  const glass = theme.custom?.glass

  return {
    borderRadius: compact ? 1.25 : 1.5,
    overflow: 'hidden',
    bgcolor: glass?.background || (dark
      ? alpha(theme.palette.background.paper, 0.72)
      : alpha(theme.palette.background.paper, 0.78)),
    backgroundImage: glass?.backgroundImage || 'none',
    backdropFilter: glass?.backdropFilter || 'blur(20px) saturate(165%)',
    WebkitBackdropFilter: glass?.backdropFilter || 'blur(20px) saturate(165%)',
    border: glass?.border || `1px solid ${dark ? alpha('#ffffff', 0.11) : alpha('#ffffff', 0.68)}`,
    boxShadow: glass?.boxShadow || (dark
      ? '0 16px 44px rgba(11,11,12,0.34)'
      : '0 16px 44px rgba(22,22,24,0.13)'),
    transformOrigin: 'top left'
  }
}

/** 毛玻璃：半透明底 + 背景模糊，透出后面的列表和壁纸（筛选器、AI 小窗等可拖动浮窗共用） */
export const getFrostedSx = (theme) => {
  const dark = theme.palette.mode === 'dark'
  return {
    bgcolor: dark ? alpha('#26262a', 0.62) : alpha('#ffffff', 0.58),
    backgroundImage: 'none',
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: `1px solid ${dark ? alpha('#ffffff', 0.12) : alpha('#ffffff', 0.7)}`,
    boxShadow: dark ? '0 10px 30px rgba(0,0,0,0.32)' : '0 10px 30px rgba(20,20,24,0.10)',
  }
}

const FloatingGlassSurface = forwardRef(function FloatingGlassSurface({
  open = true,
  children,
  position,
  width,
  minWidth,
  maxWidth,
  maxHeight,
  layer = 'selectionPanel',
  density = 'regular',
  // solid：跟随主题的菜单/对话框材质；frosted：毛玻璃
  material = 'solid',
  pointerPassthrough = true,
  onClickAway,
  clickAwayDisabled = false,
  ariaLabel,
  portalContainer,
  sx
}, ref) {
  const paper = (
    <Fade in={open} timeout={{ enter: 160, exit: 120 }} mountOnEnter unmountOnExit>
      <Paper
        ref={ref}
        role={ariaLabel ? 'dialog' : undefined}
        aria-label={ariaLabel}
        elevation={0}
        // 位置走内联样式：放进 sx 会让拖动时每个像素都生成一个新的样式类
        style={{ left: position?.x, top: position?.y }}
        sx={(theme) => ({
          position: 'fixed',
          width,
          minWidth,
          maxWidth,
          maxHeight,
          pointerEvents: 'auto',
          ...getGlassSx(theme, density),
          ...(material === 'frosted' ? getFrostedSx(theme) : null),
          ...(typeof sx === 'function' ? sx(theme) : sx)
        })}
      >
        {children}
      </Paper>
    </Fade>
  )

  return (
    <Portal container={portalContainer || undefined}>
      <Box
        aria-hidden={!open}
        sx={{
          position: 'fixed',
          inset: 0,
          pointerEvents: !open || pointerPassthrough ? 'none' : 'auto',
          zIndex: FLOATING_LAYER_Z_INDEX[layer] || FLOATING_LAYER_Z_INDEX.selectionPanel
        }}
      >
        {open && onClickAway ? (
          <ClickAwayListener
            onClickAway={(event) => {
              if (!clickAwayDisabled) onClickAway(event)
            }}
            mouseEvent="onMouseDown"
            touchEvent="onTouchStart"
          >
            <Box sx={{ display: 'contents' }}>
              {paper}
            </Box>
          </ClickAwayListener>
        ) : paper}
      </Box>
    </Portal>
  )
})

export default FloatingGlassSurface
