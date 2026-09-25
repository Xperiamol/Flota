import { useEffect, useState } from 'react'
import { Box, IconButton } from '@mui/material'
import { DeleteOutline, MoreHoriz, OpenInNew } from '../common/AppIcons'
import AppContextMenu from '../common/AppContextMenu'
import { openWidgetInstance } from '../../store/useWidgetStore'
import { useHomeStore, widgetCardId } from '../../store/useHomeStore'
import { instanceLabel, openMiniWindow } from '../../utils/widgets/widgetActions'
import WidgetHost from './WidgetHost'
import { WidgetGlyph } from './widgetIcons'
import { HomeCardHeader, homeCardSx } from '../settings/homeCards'

/** 首页上的组件卡片：引用一个组件实例，以紧凑尺寸显示 */
export default function HomeWidgetCard({ instanceId, editing }) {
  const [info, setInfo] = useState(null)
  const [menu, setMenu] = useState(null)
  useEffect(() => {
    const load = () => window.electronAPI.widgets.getInstance(instanceId).then((result) => setInfo(result?.success ? result.data : { missing: true }))
    load()
    return window.electronAPI.widgets.onListChanged?.(load)
  }, [instanceId])
  // 实例已被彻底删除：自动从首页移除
  useEffect(() => {
    if (info?.missing) useHomeStore.getState().removeCard(widgetCardId(instanceId))
  }, [info, instanceId])
  if (!info || info.missing) return null

  return (
    <Box sx={homeCardSx(false)}>
      {/* 与首页其他卡片的标题一致；点标题打开组件主页 */}
      <Box onClick={() => openWidgetInstance(instanceId)} sx={{ cursor: 'pointer', borderRadius: '8px', '&:hover .home-widget-title': { color: 'text.primary' } }}>
        <HomeCardHeader
          icon={(props) => <WidgetGlyph icon={info.widget.manifest?.icon} {...props} />}
          title={<Box component="span" className="home-widget-title" sx={{ transition: 'color 150ms ease' }}>{instanceLabel(info.widget.name, info.instance.name)}</Box>}
          action={!editing && (
            <IconButton size="small" aria-label="更多" onClick={(event) => { event.stopPropagation(); setMenu({ el: event.currentTarget }) }} sx={{ my: -0.5, mr: -0.75 }}>
              <MoreHoriz sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        />
      </Box>
      {/* 组件自带内边距，抵消一部分，让内容与卡片标题对齐 */}
      <Box sx={{ mx: -1.5, mb: -1 }}>
        <WidgetHost instanceId={instanceId} size="compact" surface="dashboard" minHeight={48} maxHeight={320} />
      </Box>
      <AppContextMenu anchor={menu} onClose={() => setMenu(null)} items={[
        { label: '在桌面小窗打开', icon: <OpenInNew fontSize="small" />, onClick: () => openMiniWindow(instanceId) },
        { divider: true },
        { label: '从首页移除', icon: <DeleteOutline fontSize="small" />, danger: true, onClick: () => useHomeStore.getState().removeCard(widgetCardId(instanceId)) },
      ]} />
    </Box>
  )
}
