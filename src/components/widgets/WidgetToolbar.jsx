import { useEffect, useState } from 'react'
import { Button, IconButton, Tooltip, Typography } from '@mui/material'
import {
  Add, ChevronLeft, Dashboard, DeleteOutline, Download, Edit, HelpOutline, History, MoreHoriz, NoteAdd, OpenInNew,
  PushPin, PushPinOutlined, Storage
} from '../common/AppIcons'
import FlotaAIIcon from '../common/FlotaAIIcon'
import AppContextMenu from '../common/AppContextMenu'
import NoteReferencePicker from '../editor/NoteReferencePicker'
import { useStore } from '../../store/useStore'
import { useWidgetStore } from '../../store/useWidgetStore'
import { useHomeStore, widgetCardId } from '../../store/useHomeStore'
import { askAIToModifyWidget } from '../../utils/widgets/askAI'
import {
  createInstanceInteractive, deleteInstance, deleteWidget, exportWidget, insertInstanceIntoNote, openMiniWindow,
  renameInstance, toggleHomeInstance
} from '../../utils/widgets/widgetActions'
import { DataDialog, VersionsDialog } from './widgetDialogs'

// 与笔记页「新建」按钮一致
const primaryButtonSx = { ml: 0.5, height: '30px', minHeight: '30px', px: 1.25, borderRadius: '10px', fontSize: '0.8125rem' }

/** 组件主页当前打开的实例（已删除的视为未打开） */
function useActiveInstance(widgetId) {
  const activeId = useWidgetStore((state) => state.activeInstance[widgetId] || null)
  const [instance, setInstance] = useState(null)
  useEffect(() => {
    if (!activeId) return setInstance(null)
    const load = () => window.electronAPI.widgets.getInstance(activeId).then((result) => {
      const found = result?.success && !result.data.instance.isDeleted ? result.data.instance : null
      setInstance(found)
    })
    load()
    return window.electronAPI.widgets.onListChanged?.(load)
  }, [activeId])
  return instance
}

const closeInstance = (widgetId) => useWidgetStore.getState().setActiveInstance(widgetId, null)

/** 工具栏左侧：主页是「新建实例」，实例页是返回 + 实例名 */
export function WidgetToolbarLeft({ widgetId }) {
  const widget = useWidgetStore((state) => state.widgets.find((item) => item.id === widgetId))
  const instance = useActiveInstance(widgetId)
  if (!widget) return null
  if (instance) {
    return (
      <>
        <Button size="small" color="inherit" startIcon={<ChevronLeft fontSize="small" />} onClick={() => closeInstance(widgetId)}
          sx={{ color: 'text.secondary', borderRadius: '10px', height: 30 }}>
          全部实例
        </Button>
        {/* 标题栏已显示组件名，实例同名时不重复 */}
        {instance.name !== widget.name && (
          <Typography variant="subtitle2" sx={{ fontWeight: 600, maxWidth: 360 }} noWrap>{instance.name}</Typography>
        )}
      </>
    )
  }
  return (
    <Button variant="contained" size="small" startIcon={<Add />} sx={primaryButtonSx} onClick={() => createInstanceInteractive(widget)}>
      新建实例
    </Button>
  )
}

/** 工具栏右侧：帮助、AI 修改、更多 */
export function WidgetToolbarRight({ widgetId }) {
  const widget = useWidgetStore((state) => state.widgets.find((item) => item.id === widgetId))
  const introDismissed = useWidgetStore((state) => state.dismissedIntros.includes(widgetId))
  const homeCards = useHomeStore((state) => state.cards)
  const instance = useActiveInstance(widgetId)
  const [menu, setMenu] = useState(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [notePickerOpen, setNotePickerOpen] = useState(false)
  if (!widget) return null

  const modifyWithAI = async () => {
    if (instance) return askAIToModifyWidget(widget, instance.id)
    const result = await window.electronAPI.widgets.instances(widget.id)
    askAIToModifyWidget(widget, result?.data?.[0]?.id)
  }

  const widgetItems = [
    {
      label: widget.pinned ? '从侧边栏取消固定' : '固定到侧边栏',
      icon: widget.pinned ? <PushPinOutlined fontSize="small" /> : <PushPin fontSize="small" />,
      onClick: () => useWidgetStore.getState().setPinned(widget.id, !widget.pinned),
    },
    { label: '历史版本', icon: <History fontSize="small" />, onClick: () => setVersionsOpen(true) },
    { label: '导出组件文件', icon: <Download fontSize="small" />, onClick: () => exportWidget(widget) },
    { divider: true },
    { label: '删除组件', icon: <DeleteOutline fontSize="small" />, danger: true, onClick: async () => { if (await deleteWidget(widget)) useStore.getState().setCurrentView('notes') } },
  ]
  const instanceItems = instance ? [
    { label: '插入到笔记…', icon: <NoteAdd fontSize="small" />, onClick: () => setNotePickerOpen(true) },
    { label: homeCards.includes(widgetCardId(instance.id)) ? '从首页移除' : '放到首页', icon: <Dashboard fontSize="small" />, onClick: () => toggleHomeInstance(instance.id) },
    { label: '在桌面小窗打开', icon: <OpenInNew fontSize="small" />, onClick: () => openMiniWindow(instance.id) },
    { label: '查看数据', icon: <Storage fontSize="small" />, onClick: () => setDataOpen(true) },
    { label: '重命名', icon: <Edit fontSize="small" />, onClick: () => renameInstance(instance) },
    { divider: true },
    { label: '删除实例', icon: <DeleteOutline fontSize="small" />, danger: true, onClick: async () => { if (await deleteInstance(instance)) closeInstance(widgetId) } },
  ] : []

  return (
    <>
      {!instance && (
        <Tooltip title={introDismissed ? '显示使用说明' : '隐藏使用说明'}>
          <IconButton size="small" color={introDismissed ? 'default' : 'primary'}
            onClick={() => useWidgetStore.getState().setIntroDismissed(widgetId, !introDismissed)}>
            <HelpOutline fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="让 AI 修改这个组件">
        <IconButton size="small" color="primary" onClick={modifyWithAI}><FlotaAIIcon sx={{ fontSize: 22 }} /></IconButton>
      </Tooltip>
      <IconButton size="small" onClick={(event) => setMenu({ el: event.currentTarget })}><MoreHoriz fontSize="small" /></IconButton>
      <AppContextMenu anchor={menu} onClose={() => setMenu(null)} items={instance ? instanceItems : widgetItems} />
      <VersionsDialog widget={widget} open={versionsOpen} onClose={() => setVersionsOpen(false)} />
      <DataDialog instance={instance} open={dataOpen} onClose={() => setDataOpen(false)} />
      <NoteReferencePicker open={notePickerOpen} onClose={() => setNotePickerOpen(false)}
        onSelect={(note) => insertInstanceIntoNote(note, widget.name, instance)} />
    </>
  )
}
