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

  return {
    borderRadius: compact ? 1.25 : 1.5,
    overflow: 'hidden',
    bgcolor: dark
      ? alpha(theme.palette.background.paper, compact ? 0.4 : 0.44)
      : alpha(theme.palette.background.paper, compact ? 0.3 : 0.34),
    backgroundImage: dark
      ? `linear-gradient(135deg, ${alpha('#ffffff', 0.07)}, ${alpha('#ffffff', 0.02)} 48%, ${alpha(theme.palette.primary.main, 0.06)})`
      : `linear-gradient(135deg, ${alpha('#ffffff', 0.58)}, ${alpha('#ffffff', 0.2)} 48%, ${alpha(theme.palette.primary.main, 0.04)})`,
    backdropFilter: 'blur(34px) saturate(190%)',
    WebkitBackdropFilter: 'blur(34px) saturate(190%)',
    border: `1px solid ${dark ? alpha('#ffffff', 0.06) : alpha('#ffffff', 0.32)}`,
    boxShadow: dark
      ? '0 12px 36px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)'
      : '0 12px 30px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.46)',
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
