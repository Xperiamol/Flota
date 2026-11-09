import { useEffect, useState } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { Close, CloseFullscreenRounded, OpenInFullRounded, PushPin, PushPinOutlined } from '../common/AppIcons'
import { WidgetGlyph } from './widgetIcons'
import WidgetHost from './WidgetHost'
import { instanceLabel } from '../../utils/widgets/widgetActions'

/**
 * 桌面组件：无边框小窗口里运行一个实例，标题栏可拖动。
 * 固定在桌面（desktop）时可以在卡片（compact，和首页卡片一样）与展开（medium）之间切换；
 * 位置、大小、置顶由主进程记住，下次启动按设置恢复；× 是从桌面移除。
 */
export default function WidgetWindow({ instanceId, size = 'medium', desktop = false }) {
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState('')
  const [sizes, setSizes] = useState([])
  const [pinned, setPinned] = useState(false)
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
  const other = compact ? 'medium' : 'compact'
  // 组件同时支持两种尺寸时才显示切换
  const canSwitch = desktop && (!sizes.length || sizes.includes(other))
  const close = () => (desktop ? window.electronAPI.widgets.unpinFromDesktop(instanceId) : window.electronAPI.window.close())
  // 卡片模式下控制按钮只在悬停时出现，平时和首页卡片一样干净
  const controlsVisible = !compact || hover

  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.25, pr: 0.5, height: compact ? 32 : 34, flexShrink: 0, WebkitAppRegion: 'drag', borderBottom: compact ? 'none' : '1px solid', borderColor: 'divider' }}>
        <WidgetGlyph icon={icon} sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, minWidth: 0, color: compact ? 'text.secondary' : 'text.primary' }} noWrap>{title}</Typography>
        <Box sx={{ display: 'flex', WebkitAppRegion: 'no-drag', opacity: controlsVisible ? 1 : 0, transition: 'opacity 150ms ease' }}>
          {canSwitch && (
            <Tooltip title={compact ? '展开' : '收成卡片'}>
              <IconButton size="small" onClick={() => window.electronAPI.widgets.setDesktopSize(instanceId, other)}>
                {compact ? <OpenInFullRounded sx={{ fontSize: 15 }} /> : <CloseFullscreenRounded sx={{ fontSize: 15 }} />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={pinned ? '取消置顶' : '置顶'}>
            <IconButton size="small" onClick={() => window.electronAPI.window.toggleAlwaysOnTop()}>
              {pinned ? <PushPin sx={{ fontSize: 16 }} /> : <PushPinOutlined sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title={desktop ? '从桌面移除' : '关闭'}>
            <IconButton size="small" onClick={close}><Close sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', ...(compact ? { px: 0.25 } : {}) }}>
        <WidgetHost instanceId={instanceId} size={compact ? 'compact' : 'medium'} surface={compact ? 'dashboard' : 'window'} minHeight={48} maxHeight={4000} />
      </Box>
    </Box>
  )
}
