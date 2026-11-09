import { useEffect, useRef, useState } from 'react'
import useFitWindowHeight from '../../hooks/useFitWindowHeight'
import { Box, IconButton, Tooltip } from '@mui/material'
import { Close, PushPin, PushPinOutlined } from '../common/AppIcons'
import { useStore } from '../../store/useStore'
import { HOME_BUILTIN_CARDS } from '../../store/useHomeStore'
import { useHomeCardData, homeCardTarget, renderBuiltinHomeCard } from './homeCardData'

const REFRESH_MS = 60 * 1000

/**
 * 桌面上的首页内置卡片（今日待办、快速记录……）：和首页同一套组件与数据。
 * 卡片自带标题，窗口只留一条可拖动的细条，按钮悬停时出现；点卡片标题让主窗口打开对应页面。
 * 待办变化、窗口获得焦点、每分钟都会刷新，和主窗口保持一致。
 */
export default function HomeCardWindow({ cardId, desktopKey, layer: initialLayer = 'desktop' }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [pinned, setPinned] = useState(initialLayer === 'top')
  const [hover, setHover] = useState(false)
  const data = useHomeCardData({ refreshKey })
  const card = HOME_BUILTIN_CARDS.find((item) => item.id === cardId)
  const contentRef = useRef(null)
  useFitWindowHeight(contentRef, 22)

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

  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}
    >
      <Box sx={{ height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pr: 0.5, WebkitAppRegion: 'drag' }}>
        <Box sx={{ display: 'flex', WebkitAppRegion: 'no-drag', opacity: hover ? 1 : 0, transition: 'opacity 150ms ease' }}>
          <Tooltip title={pinned ? '取消置顶（贴在桌面）' : '置顶'}>
            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => window.electronAPI.widgets.setDesktopLayer(desktopKey, pinned ? 'desktop' : 'top')}>
              {pinned ? <PushPin sx={{ fontSize: 14 }} /> : <PushPinOutlined sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="从桌面移除">
            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => window.electronAPI.widgets.unpinFromDesktop(desktopKey)}><Close sx={{ fontSize: 14 }} /></IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Box ref={contentRef} sx={{ px: 0.75, pb: 0.75 }}>
          {renderBuiltinHomeCard(cardId, data, open)}
        </Box>
      </Box>
    </Box>
  )
}
