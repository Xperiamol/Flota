import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Card, CardContent, Collapse, IconButton, List, ListItem, ListItemText, Typography } from '@mui/material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Close, Dashboard, DeleteOutline, Edit, ExpandLess, ExpandMore, MoreHoriz, NoteAdd, OpenInNew, Restore
} from '../common/AppIcons'
import AppContextMenu from '../common/AppContextMenu'
import NoteReferencePicker from '../editor/NoteReferencePicker'
import { useWidgetStore } from '../../store/useWidgetStore'
import { useHomeStore, isInstanceOnHome } from '../../store/useHomeStore'
import { askAIToFixWidget } from '../../utils/widgets/askAI'
import {
  deleteInstance, insertInstanceIntoNote, openMiniWindow, renameInstance, toggleHomeInstance
} from '../../utils/widgets/widgetActions'
import { createSoftGlassCardSx } from '../../styles/commonStyles'
import { formatTime } from './widgetDialogs'
import WidgetHost from './WidgetHost'

function InstanceCard({ instance, onOpen, onMenu }) {
  const onHome = useHomeStore((state) => isInstanceOnHome(state, instance.id))
  const usage = [
    instance.notes?.length ? `${instance.notes.length} 篇笔记` : '',
    onHome ? '首页' : '',
  ].filter(Boolean).join(' · ')
  return (
    <Card sx={(theme) => ({ ...createSoftGlassCardSx(theme.palette.primary.main)(theme), cursor: 'pointer' })} onClick={onOpen}
      onContextMenu={(event) => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }) }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1, py: '14px !important' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 650 }} noWrap>{instance.name}</Typography>
          {usage && <Typography variant="caption" color="text.secondary">{usage}</Typography>}
        </Box>
        <IconButton size="small" onClick={(event) => { event.stopPropagation(); onMenu({ el: event.currentTarget }) }}><MoreHoriz fontSize="small" /></IconButton>
      </CardContent>
    </Card>
  )
}

/**
 * 组件主页（侧边栏入口）：使用说明 + 全部实例；点进实例以全屏尺寸使用。
 * 新建实例、帮助、AI 修改等操作在顶部工具栏（WidgetToolbar）。
 */
export default function WidgetHomeView({ widgetId }) {
  const widget = useWidgetStore((state) => state.widgets.find((item) => item.id === widgetId))
  const activeInstanceId = useWidgetStore((state) => state.activeInstance[widgetId] || null)
  const introDismissed = useWidgetStore((state) => state.dismissedIntros.includes(widgetId))
  const [instances, setInstances] = useState(null)
  const [deleted, setDeleted] = useState([])
  const [deletedOpen, setDeletedOpen] = useState(false)
  const [instanceMenu, setInstanceMenu] = useState(null)
  const [notePickerFor, setNotePickerFor] = useState(null)

  const load = useCallback(async () => {
    const [active, removed] = await Promise.all([
      window.electronAPI.widgets.instances(widgetId),
      window.electronAPI.widgets.instances(widgetId, { deleted: true }),
    ])
    setInstances(active?.success ? active.data : [])
    setDeleted(removed?.success ? removed.data : [])
  }, [widgetId])

  useEffect(() => {
    load()
    const off = window.electronAPI?.widgets?.onListChanged?.(load)
    return () => off?.()
  }, [load])

  if (!widget) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">这个组件已删除或尚未同步到本设备</Typography>
      </Box>
    )
  }

  const setActive = (instanceId) => useWidgetStore.getState().setActiveInstance(widgetId, instanceId)
  const activeInstance = instances?.find((item) => item.id === activeInstanceId)
  if (activeInstance) {
    return (
      <Box sx={{ height: '100%', overflow: 'auto' }}>
        <WidgetHost key={activeInstance.id} instanceId={activeInstance.id} size="full" surface="page" sx={{ height: '100%' }}
          onFixRequest={(errors) => askAIToFixWidget(widget, activeInstance.id, errors)} />
      </Box>
    )
  }

  const help = widget.manifest?.help || widget.manifest?.description || ''
  const menuInstance = instanceMenu?.instance

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
      {help && !introDismissed && (
        <Box sx={(theme) => ({
          position: 'relative', mb: 3, px: 2.5, py: 2, pr: 6, borderRadius: 3,
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(22,22,24,0.035)',
          fontSize: 14, lineHeight: 1.7, color: 'text.secondary',
          '& p': { my: 0.5 }, '& ul, & ol': { pl: 2.5, my: 0.5 }, '& strong': { color: 'text.primary' },
        })}>
          <IconButton size="small" onClick={() => useWidgetStore.getState().setIntroDismissed(widget.id, true)}
            sx={{ position: 'absolute', top: 8, right: 8 }}>
            <Close fontSize="small" />
          </IconButton>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{help}</ReactMarkdown>
        </Box>
      )}

      <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 650, mb: 1.5 }}>实例</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2 }}>
        {(instances || []).map((instance) => (
          <InstanceCard key={instance.id} instance={instance} onOpen={() => setActive(instance.id)}
            onMenu={(anchor) => setInstanceMenu({ ...anchor, instance })} />
        ))}
      </Box>
      {instances && !instances.length && (
        <Typography variant="body2" color="text.secondary">还没有实例，点左上角「新建实例」开始使用。</Typography>
      )}

      {deleted.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Button size="small" color="inherit" onClick={() => setDeletedOpen((value) => !value)}
            endIcon={deletedOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />} sx={{ color: 'text.secondary' }}>
            最近删除（{deleted.length}）
          </Button>
          <Collapse in={deletedOpen}>
            <List dense>
              {deleted.map((instance) => (
                <ListItem key={instance.id} secondaryAction={
                  <Button size="small" startIcon={<Restore fontSize="small" />} onClick={() => window.electronAPI.widgets.restoreInstance(instance.id)}>恢复</Button>
                }>
                  <ListItemText primary={instance.name} secondary={`删除于 ${formatTime(instance.deletedAt)}`} />
                </ListItem>
              ))}
            </List>
          </Collapse>
        </Box>
      )}

      <AppContextMenu anchor={instanceMenu} onClose={() => setInstanceMenu(null)} items={menuInstance ? [
        { label: '插入到笔记…', icon: <NoteAdd fontSize="small" />, onClick: () => setNotePickerFor(menuInstance) },
        {
          label: isInstanceOnHome(useHomeStore.getState(), menuInstance.id) ? '从首页移除' : '放到首页',
          icon: <Dashboard fontSize="small" />,
          onClick: () => toggleHomeInstance(menuInstance.id),
        },
        { label: '在桌面小窗打开', icon: <OpenInNew fontSize="small" />, onClick: () => openMiniWindow(menuInstance.id) },
        { label: '重命名', icon: <Edit fontSize="small" />, onClick: () => renameInstance(menuInstance) },
        { divider: true },
        { label: '删除实例', icon: <DeleteOutline fontSize="small" />, danger: true, onClick: () => deleteInstance(menuInstance) },
      ] : []} />
      <NoteReferencePicker open={Boolean(notePickerFor)} onClose={() => setNotePickerFor(null)}
        onSelect={(note) => insertInstanceIntoNote(note, widget.name, notePickerFor)} />
    </Box>
  )
}
