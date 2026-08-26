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
      ? '0 16px 44px rgba(2,6,23,0.34)'
      : '0 16px 44px rgba(15,23,42,0.13)'),
    transformOrigin: 'top left'
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
        sx={(theme) => ({
          position: 'fixed',
          left: position?.x,
          top: position?.y,
          width,
          minWidth,
          maxWidth,
          maxHeight,
          pointerEvents: 'auto',
          ...getGlassSx(theme, density),
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
