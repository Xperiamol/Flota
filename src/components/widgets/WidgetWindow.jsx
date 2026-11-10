import { useEffect, useRef, useState } from 'react'
import useFitWindowHeight from '../../hooks/useFitWindowHeight'
import useDesktopWidgetAppearance, { desktopCardSurfaceSx } from '../../hooks/useDesktopWidgetAppearance'
import DesktopAppearanceButton, { DesktopDragHandle } from './DesktopAppearanceControls'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { Close, CloseFullscreenRounded, OpenInFullRounded, PushPin, PushPinOutlined } from '../common/AppIcons'
import { WidgetGlyph } from './widgetIcons'
import WidgetHost from './WidgetHost'
import { instanceLabel } from '../../utils/widgets/widgetActions'

/**
 * 桌面组件：无边框小窗口里运行一个实例，标题栏可拖动。
 * 固定在桌面（desktop）时可以在卡片（compact，和首页卡片一样）与展开（medium）之间切换；
 * 位置、大小、置顶由主进程记住，下次启动按设置恢复；× 是从桌面移除。
 * 桌面上的窗口是半透明卡片（不透明度、背后模糊、大小在「外观」里调，所有桌面卡片共用）。
 */
export default function WidgetWindow({ instanceId, size = 'medium', desktop = false, desktopKey = instanceId, layer: initialLayer = 'desktop' }) {
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState('')
  const [sizes, setSizes] = useState([])
  const [pinned, setPinned] = useState(initialLayer === 'top')
  const [hover, setHover] = useState(false)

  useEffect(() => {
    const load = () => window.electronAPI.widgets.getInstance(instanceId).then((result) => {
      if (!result?.success) return
      const text = instanceLabel(result.data.widget.name, result.data.instance.name)
      setTitle(text)
      setIcon(result.data.widget.manifest?.icon || '')
      setSizes(result.data.widget.manifest?.sizes || [])
      document.title = text
    })
    load()
    const offList = window.electronAPI.widgets.onListChanged?.(load)
    window.electronAPI.window.isAlwaysOnTop().then((value) => setPinned(Boolean(value)))
    const offTop = window.electronAPI.window.onAlwaysOnTopChanged?.((value) => setPinned(Boolean(value)))
    return () => { offList?.(); offTop?.() }
  }, [instanceId])

  const compact = size === 'compact'
  const contentRef = useRef(null)
  const [appearance, previewAppearance, reportFramePointer, pointerInside] = useDesktopWidgetAppearance(desktop)
  const headerHeight = compact ? 26 : 32
  // 卡片模式下窗口高度跟着组件内容走；展开模式由用户自己调整
  const zoom = desktop ? appearance.scale : 1
  useFitWindowHeight(contentRef, headerHeight, desktop && compact, zoom)
  const other = compact ? 'medium' : 'compact'
  // 组件同时支持两种尺寸时才显示切换
  const canSwitch = desktop && (!sizes.length || sizes.includes(other))
  const close = () => (desktop ? window.electronAPI.widgets.unpinFromDesktop(desktopKey) : window.electronAPI.window.close())
  // 桌面卡片在「贴在桌面」和「置顶」两种层级之间切换，由主进程记住
  const toggleLayer = () => (desktop
    ? window.electronAPI.widgets.setDesktopLayer(desktopKey, pinned ? 'desktop' : 'top')
    : window.electronAPI.window.toggleAlwaysOnTop())
  // 卡片模式下控制按钮只在悬停时出现，平时和首页卡片一样干净
  // 桌面卡片上的按钮（拖动、外观、展开、置顶、移除）只在鼠标移上来时出现，平时只留标题；
  // 点击穿透时鼠标移动仍会转给页面，移上来一样能看到按钮
  const controlsVisible = !desktop || hover || pointerInside

  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={[{ height: '100vh', overflow: 'hidden' }, desktop ? desktopCardSurfaceSx(appearance) : { bgcolor: 'background.default' }]}
    >
      <Box sx={{ zoom, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box data-desktop-handle sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.25, pr: 0.5, height: headerHeight, flexShrink: 0, WebkitAppRegion: 'drag', borderBottom: compact ? 'none' : '1px solid', borderColor: 'divider' }}>
        <WidgetGlyph icon={icon} sx={{ fontSize: compact ? 14 : 16, color: 'text.secondary' }} />
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, minWidth: 0, color: compact ? 'text.secondary' : 'text.primary' }} noWrap>{title}</Typography>
        <Box sx={{ display: 'flex', WebkitAppRegion: 'no-drag', opacity: controlsVisible ? 1 : 0, pointerEvents: controlsVisible ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
          {desktop && <DesktopDragHandle iconSize={15} sx={{ m: '5px' }} />}
          {desktop && <DesktopAppearanceButton appearance={appearance} onPreview={previewAppearance} iconSize={15} />}
          {canSwitch && (
            <Tooltip title={compact ? '展开' : '收成卡片'}>
              <IconButton size="small" onClick={() => window.electronAPI.widgets.setDesktopSize(desktopKey, other)}>
                {compact ? <OpenInFullRounded sx={{ fontSize: 15 }} /> : <CloseFullscreenRounded sx={{ fontSize: 15 }} />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={pinned ? '取消置顶（贴在桌面）' : '置顶'}>
            <IconButton size="small" onClick={toggleLayer}>
              {pinned ? <PushPin sx={{ fontSize: 16 }} /> : <PushPinOutlined sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title={desktop ? '从桌面移除' : '关闭'}>
            <IconButton size="small" onClick={close}><Close sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
        </Box>
      </Box>
      {/* 卡片模式窗口高度跟着内容走，正常不需要滚动；缩放取整差一两像素时也不要冒出滚动条 */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', ...(compact ? { px: 0.25, scrollbarWidth: 'none', '&::-webkit-scrollbar': { width: 0, height: 0 } } : {}) }}>
        <Box ref={contentRef} sx={compact ? { pb: 0.5 } : undefined}>
          <WidgetHost instanceId={instanceId} size={compact ? 'compact' : 'medium'} surface={compact ? 'dashboard' : 'window'} minHeight={48} maxHeight={compact ? 860 : 4000} translucent={desktop && appearance.opacity < 1}
            onEvent={(event) => { if (event.type === 'pointer') reportFramePointer(event.interactive) }} />
        </Box>
      </Box>
      </Box>
    </Box>
  )
}
