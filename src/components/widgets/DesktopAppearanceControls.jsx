import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, Popover, Slider, Switch, Tooltip, Typography } from '@mui/material'
import { DragIndicator, Tune } from '../common/AppIcons'

const percent = (value) => `${Math.round(value * 100)}%`

/**
 * 桌面卡片外观：背景不透明度、大小、背后模糊、点击穿透（仅无模糊时）。所有桌面卡片共用。
 * 拖动时先通过 onPreview 预览，松手才保存（保存后主进程推给每张卡片）。
 */
export function DesktopAppearanceFields({ appearance, onPreview, dense = false }) {
  const [local, setLocal] = useState(appearance)
  useEffect(() => setLocal(appearance), [appearance])
  const save = (changes) => window.electronAPI?.widgets?.setDesktopAppearance?.(changes)
  const preview = (changes) => {
    const next = { ...local, ...changes }
    setLocal(next)
    onPreview?.(next)
  }
  const label = { fontSize: dense ? 12 : 13, color: 'text.secondary' }
  const row = { display: 'flex', alignItems: 'center', gap: 1.5 }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: dense ? 0.5 : 1 }}>
      <Box sx={row}>
        <Typography sx={{ ...label, width: 64, flexShrink: 0 }}>不透明度</Typography>
        <Slider size="small" min={0.15} max={1} step={0.01} value={local.opacity}
          onChange={(_e, value) => preview({ opacity: value })}
          onChangeCommitted={(_e, value) => save({ opacity: value })}
          aria-label="桌面卡片不透明度" />
        <Typography sx={{ ...label, width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{percent(local.opacity)}</Typography>
      </Box>
      <Box sx={row}>
        <Typography sx={{ ...label, width: 64, flexShrink: 0 }}>大小</Typography>
        <Slider size="small" min={0.7} max={1.25} step={0.05} value={local.scale}
          onChange={(_e, value) => preview({ scale: value })}
          onChangeCommitted={(_e, value) => save({ scale: value })}
          aria-label="桌面卡片大小" />
        <Typography sx={{ ...label, width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{percent(local.scale)}</Typography>
      </Box>
      <Box sx={{ ...row, justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={label}>背景模糊</Typography>
          {!local.blurSupported && <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>需要 macOS 或 Windows 11</Typography>}
        </Box>
        <Switch size="small" checked={Boolean(local.blur)} disabled={!local.blurSupported}
          onChange={(event) => { preview({ blur: event.target.checked }); save({ blur: event.target.checked }) }}
          inputProps={{ 'aria-label': '桌面卡片背景模糊' }} />
      </Box>
      <Box sx={{ ...row, justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={label}>点击穿透</Typography>
          <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
            {local.blur ? '关闭背景模糊后可用' : '点卡片等于点后面的桌面，只有顶部一条还能拖动和设置'}
          </Typography>
        </Box>
        <Switch size="small" checked={Boolean(local.clickThrough) && !local.blur} disabled={Boolean(local.blur)}
          onChange={(event) => { preview({ clickThrough: event.target.checked }); save({ clickThrough: event.target.checked }) }}
          inputProps={{ 'aria-label': '桌面卡片点击穿透' }} />
      </Box>
    </Box>
  )
}

/** 桌面卡片悬停按钮里的「外观」：点开一个小面板直接调 */
export default function DesktopAppearanceButton({ appearance, onPreview, iconSize = 14, sx }) {
  const [anchor, setAnchor] = useState(null)
  return (
    <>
      <Tooltip title="外观（所有桌面卡片）">
        <IconButton size="small" sx={sx} onClick={(event) => setAnchor(event.currentTarget)}>
          <Tune sx={{ fontSize: iconSize }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { p: 1.25, width: 230, WebkitAppRegion: 'no-drag' } } }}
      >
        <DesktopAppearanceFields appearance={appearance} onPreview={onPreview} dense />
      </Popover>
    </>
  )
}

/**
 * 拖动把手：按住移动桌面卡片。系统的拖动区域（app-region: drag）不能换鼠标样式，
 * 这里自己跟踪指针、让主进程挪窗口，所以能显示「小手」，点击穿透时也能拖。
 * 位置由主进程在窗口移动后记住。
 */
export function DesktopDragHandle({ iconSize = 14, sx }) {
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)

  const flush = () => {
    const state = drag.current
    if (!state || state.busy || !state.next) return
    const { x, y } = state.next
    state.next = null
    state.busy = true
    Promise.resolve(window.electronAPI?.window?.setPosition?.(x, y)).finally(() => {
      state.busy = false
      flush()
    })
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { startX: event.screenX, startY: event.screenY, winX: window.screenX, winY: window.screenY, busy: false, next: null }
    setDragging(true)
  }
  const onPointerMove = (event) => {
    const state = drag.current
    if (!state) return
    state.next = { x: Math.round(state.winX + event.screenX - state.startX), y: Math.round(state.winY + event.screenY - state.startY) }
    flush()
  }
  const end = (event) => {
    if (!drag.current) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    drag.current = null
    setDragging(false)
  }

  return (
    <Tooltip title={dragging ? '' : '按住拖动'}>
      <Box
        role="button"
        aria-label="拖动卡片"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={(event) => event.stopPropagation()}
        sx={[{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: iconSize + 8, height: iconSize + 8, borderRadius: '50%',
          color: 'text.secondary', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none',
          WebkitAppRegion: 'no-drag',
          '&:hover': { bgcolor: 'action.selected' },
        }, ...(Array.isArray(sx) ? sx : [sx])]}
      >
        <DragIndicator sx={{ fontSize: iconSize }} />
      </Box>
    </Tooltip>
  )
}
