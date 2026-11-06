import { forwardRef } from 'react'
import { Box, ClickAwayListener, Fade, Paper, Portal } from '@mui/material'
import { glassSx } from '../../styles/materials'

export const FLOATING_LAYER_Z_INDEX = {
  contextMenu: 1500,
  selectionPanel: 1560,
  aiPanel: 1340
}

// solid：与菜单 / 弹出框同一种材质；frosted：更透的浮窗材质（AI 小窗、筛选器等可拖动浮窗）
const getSurfaceSx = (theme, { density, material }) => ({
  ...glassSx(theme, material === 'frosted' ? 'floating' : 'popover', { radius: density === 'compact' ? 'sm' : 'md' }),
  overflow: 'hidden',
  transformOrigin: 'top left',
})

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
  onDrop,
  onDragOver,
  portalContainer,
  sx
}, ref) {
  const paper = (
    <Fade in={open} timeout={{ enter: 160, exit: 120 }} mountOnEnter unmountOnExit>
      <Paper
        ref={ref}
        onDrop={onDrop}
        onDragOver={onDragOver}
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
          // 浮窗可能覆盖系统标题栏，交互不能被 Electron 的窗口拖动区域截走。
          WebkitAppRegion: 'no-drag',
          ...getSurfaceSx(theme, { density, material }),
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
