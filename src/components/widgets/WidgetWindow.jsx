import { useEffect, useState } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { Close, PushPin, PushPinOutlined } from '../common/AppIcons'
import { WidgetGlyph } from './widgetIcons'
import WidgetHost from './WidgetHost'
import { instanceLabel } from '../../utils/widgets/widgetActions'

/**
 * 桌面小窗：置顶的无边框窗口里运行一个实例（medium 尺寸），标题栏可拖动。
 */
export default function WidgetWindow({ instanceId }) {
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState('')
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    const load = () => window.electronAPI.widgets.getInstance(instanceId).then((result) => {
      if (!result?.success) return
      const text = instanceLabel(result.data.widget.name, result.data.instance.name)
      setTitle(text)
      setIcon(result.data.widget.manifest?.icon || '')
      document.title = text
    })
    load()
    const offList = window.electronAPI.widgets.onListChanged?.(load)
    window.electronAPI.window.isAlwaysOnTop().then((value) => setPinned(Boolean(value)))
    const offTop = window.electronAPI.window.onAlwaysOnTopChanged?.((value) => setPinned(Boolean(value)))
    return () => { offList?.(); offTop?.() }
  }, [instanceId])

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.25, pr: 0.5, height: 34, flexShrink: 0, WebkitAppRegion: 'drag', borderBottom: '1px solid', borderColor: 'divider' }}>
        <WidgetGlyph icon={icon} sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, minWidth: 0 }} noWrap>{title}</Typography>
        <Box sx={{ display: 'flex', WebkitAppRegion: 'no-drag' }}>
          <Tooltip title={pinned ? '取消置顶' : '置顶'}>
            <IconButton size="small" onClick={() => window.electronAPI.window.toggleAlwaysOnTop()}>
              {pinned ? <PushPin sx={{ fontSize: 16 }} /> : <PushPinOutlined sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={() => window.electronAPI.window.close()}><Close sx={{ fontSize: 16 }} /></IconButton>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <WidgetHost instanceId={instanceId} size="medium" surface="window" maxHeight={4000} />
      </Box>
    </Box>
  )
}
