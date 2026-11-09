import { useEffect, useRef, useState } from 'react'
import useFitWindowHeight from '../../hooks/useFitWindowHeight'
import useDesktopWidgetAppearance, { clickThroughActive, desktopCardSurfaceSx } from '../../hooks/useDesktopWidgetAppearance'
import DesktopAppearanceButton, { DesktopDragHandle } from '../widgets/DesktopAppearanceControls'
import { Box, IconButton, Tooltip } from '@mui/material'
import { Close, PushPin, PushPinOutlined } from '../common/AppIcons'
import { useStore } from '../../store/useStore'
import { HOME_BUILTIN_CARDS } from '../../store/useHomeStore'
import { useHomeCardData, homeCardTarget, renderBuiltinHomeCard } from './homeCardData'

const REFRESH_MS = 60 * 1000
const STRIP = 10

/**
 * 桌面上的首页内置卡片（今日待办、快速记录……）：和首页同一套组件与数据。
 * 窗口本身就是卡片（半透明 + 可选背后模糊，见设置「桌面卡片外观」），顶部一条很细的可拖动条；
 * 按钮悬停时浮在右上角，不占高度。点卡片让主窗口打开对应页面。
 * 待办变化、窗口获得焦点、每分钟都会刷新，和主窗口保持一致。
 */
export default function HomeCardWindow({ cardId, desktopKey, layer: initialLayer = 'desktop' }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [pinned, setPinned] = useState(initialLayer === 'top')
  const [hover, setHover] = useState(false)
  const data = useHomeCardData({ refreshKey })
  const card = HOME_BUILTIN_CARDS.find((item) => item.id === cardId)
  const contentRef = useRef(null)
  const [appearance, previewAppearance] = useDesktopWidgetAppearance()
  // 点击穿透时只有顶部一条能点：加高一点，留一根很淡的拖动条提示位置；按钮和平时一样，鼠标移上来才出现
  const through = clickThroughActive(appearance)
  const strip = through ? 16 : STRIP
  useFitWindowHeight(contentRef, strip, true, appearance.scale)

  useEffect(() => {
    document.title = card?.name || 'Flota'
    const refresh = () => {
      setRefreshKey((value) => value + 1)
      useStore.getState().loadNotes?.()
    }
    useStore.getState().loadNotes?.()
    const offTodo = window.electronAPI?.todos?.onChanged?.(refresh)
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, REFRESH_MS)
    const offTop = window.electronAPI?.window?.onAlwaysOnTopChanged?.((value) => setPinned(Boolean(value)))
    return () => {
      offTodo?.()
      window.removeEventListener('focus', refresh)
      clearInterval(timer)
      offTop?.()
    }
  }, [cardId])

  const target = homeCardTarget(cardId)
  const open = target ? () => window.electronAPI.widgets.openInMain(target) : undefined

  const iconSx = { p: 0.25, bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' } }
  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={[{ position: 'relative', height: '100vh', overflow: 'hidden' }, desktopCardSurfaceSx(appearance)]}
    >
      {/* 外框铺满窗口；「大小」缩放的是里面的内容（CSS zoom 下 height: 100% 仍然铺满） */}
      <Box sx={{ zoom: appearance.scale, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box data-desktop-handle sx={{ height: strip, flexShrink: 0, WebkitAppRegion: 'drag', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {through && <Box sx={{ width: 24, height: 3, borderRadius: 2, bgcolor: 'text.disabled', opacity: hover ? 0.8 : 0.3, transition: 'opacity 150ms ease' }} />}
      </Box>
      <Box data-desktop-handle sx={{ position: 'absolute', top: through ? 2 : 4, right: 6, zIndex: 2, display: 'flex', gap: 0.5, WebkitAppRegion: 'no-drag', opacity: hover ? 1 : 0, pointerEvents: hover ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
        <DesktopDragHandle sx={{ bgcolor: 'action.hover' }} />
        <DesktopAppearanceButton appearance={appearance} onPreview={previewAppearance} sx={iconSx} />
        <Tooltip title={pinned ? '取消置顶（贴在桌面）' : '置顶'}>
          <IconButton size="small" sx={iconSx} onClick={() => window.electronAPI.widgets.setDesktopLayer(desktopKey, pinned ? 'desktop' : 'top')}>
            {pinned ? <PushPin sx={{ fontSize: 14 }} /> : <PushPinOutlined sx={{ fontSize: 14 }} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="从桌面移除">
          <IconButton size="small" sx={iconSx} onClick={() => window.electronAPI.widgets.unpinFromDesktop(desktopKey)}><Close sx={{ fontSize: 14 }} /></IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { width: 0, height: 0 } }}>
        {/* 首页卡片在桌面上不再叠一层分组底色，内边距也收紧一些 */}
        <Box ref={contentRef} sx={{ '&& > *': { bgcolor: 'transparent', borderRadius: 0, p: '2px 14px 12px', height: 'auto' }, '&& > *:hover': { bgcolor: 'transparent' } }}>
          {renderBuiltinHomeCard(cardId, data, open)}
        </Box>
      </Box>
      </Box>
    </Box>
  )
}
