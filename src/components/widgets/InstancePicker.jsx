import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography
} from '@mui/material'
import { Add, ArrowBack, Check, Search, Storefront } from '../common/AppIcons'
import FlotaAIIcon from '../common/FlotaAIIcon'
import { useStore } from '../../store/useStore'
import { useWidgetStore, ensureWidgetsLoaded } from '../../store/useWidgetStore'
import { askAIToCreateWidget } from '../../utils/widgets/askAI'
import { editorScrollbarSx } from '../../styles/commonStyles'
import { WidgetGlyph } from './widgetIcons'

const SIZE_LABEL = { compact: '卡片', medium: '嵌入', full: '全屏' }


/**
 * 两步选择：先选组件，再选实例（或当场新建实例）。
 * @param {object} props
 * @param {(selection: { widget: object, instance: object }) => void | Promise<void>} props.onSelect
 * @param {'compact'|'medium'|'full'} [props.requireSize] 只允许支持该尺寸的组件（首页卡片需要 compact）
 * @param {string} [props.initialWidgetId] 直接从某个组件的实例列表开始
 */
export default function InstancePicker({ open, onClose, onSelect, title = '插入组件', confirmText = '插入', requireSize, initialWidgetId }) {
  const widgets = useWidgetStore((state) => state.widgets)
  const [query, setQuery] = useState('')
  const [widgetId, setWidgetId] = useState(null)
  const [instances, setInstances] = useState(null)
  const [selectedInstanceId, setSelectedInstanceId] = useState(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { ensureWidgetsLoaded() }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setWidgetId(initialWidgetId || null)
    setSelectedInstanceId(null)
    setCreating(false)
    setNewName('')
    setError('')
  }, [open, initialWidgetId])

  const widget = widgets.find((item) => item.id === widgetId) || null

  useEffect(() => {
    if (!open || !widgetId) return setInstances(null)
    window.electronAPI.widgets.instances(widgetId).then((result) => {
      const list = result?.success ? result.data : []
      setInstances(list)
      setSelectedInstanceId(list[0]?.id || null)
      if (!list.length) setCreating(true)
    })
  }, [open, widgetId])

  const candidates = useMemo(() => widgets
    .filter((item) => `${item.name} ${item.manifest?.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(a.name).localeCompare(String(b.name), 'zh-CN')), [widgets, query])

  const supports = (item) => !requireSize || (item.manifest?.sizes || []).includes(requireSize)

  const finish = async (instance) => {
    setBusy(true)
    setError('')
    try {
      await onSelect({ widget, instance })
      onClose()
    } catch (e) {
      setError(e.message || '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (creating) {
      setBusy(true)
      const result = await window.electronAPI.widgets.createInstance(widget.id, newName)
      setBusy(false)
      if (!result?.success) return setError(result?.error || '新建实例失败')
      return finish(result.data)
    }
    const instance = instances?.find((item) => item.id === selectedInstanceId)
    if (instance) finish(instance)
  }

  const goToStore = () => {
    onClose()
    useStore.getState().openPluginStore({ type: 'widget', tab: 'market' })
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {widget && !initialWidgetId ? (
          <IconButton size="small" onClick={() => setWidgetId(null)} disabled={busy}><ArrowBack fontSize="small" /></IconButton>
        ) : <WidgetGlyph icon={widget?.manifest?.icon} color="primary" />}
        {widget ? `${title} · ${widget.name}` : title}
      </DialogTitle>
      <DialogContent>
        {!widget ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>先选择组件，再选择它的一个实例。每个实例是一份独立的数据。</Typography>
            <TextField autoFocus fullWidth size="small" placeholder="搜索组件…" value={query} onChange={(e) => setQuery(e.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
            <List sx={{ height: 300, overflow: 'auto', mt: 1, ...editorScrollbarSx }}>
              {candidates.map((item) => (
                <ListItemButton key={item.id} disabled={!supports(item)} onClick={() => setWidgetId(item.id)} sx={{ borderRadius: 2, mb: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 36 }}><WidgetGlyph icon={item.manifest?.icon} fontSize="small" /></ListItemIcon>
                  <ListItemText
                    primary={item.name}
                    secondary={supports(item)
                      ? `${item.instanceCount} 个实例${item.manifest?.description ? ` · ${item.manifest.description}` : ''}`
                      : `不支持${SIZE_LABEL[requireSize]}尺寸`}
                    slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
                </ListItemButton>
              ))}
              {!candidates.length && (
                <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
                  <WidgetGlyph sx={{ fontSize: 36, mb: 1, opacity: 0.5 }} />
                  <Typography variant="body2">{query ? '没有找到匹配的组件' : '还没有组件，可以用 AI 生成，或从商店添加'}</Typography>
                </Box>
              )}
            </List>
          </>
        ) : (
          <>
            {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
            <List sx={{ height: 300, overflow: 'auto', ...editorScrollbarSx }}>
              {instances === null && <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}><CircularProgress size={20} /></Box>}
              {(instances || []).map((instance) => (
                <ListItemButton key={instance.id} selected={!creating && instance.id === selectedInstanceId} disabled={busy}
                  onClick={() => { setCreating(false); setSelectedInstanceId(instance.id) }}
                  onDoubleClick={() => finish(instance)} sx={{ borderRadius: 2, mb: 0.5 }}>
                  <ListItemText primary={instance.name}
                    secondary={`${instance.recordCount} 条数据${instance.notes?.length ? ` · ${instance.notes.length} 篇笔记引用` : ''}`}
                    slotProps={{ primary: { noWrap: true } }} />
                  {!creating && instance.id === selectedInstanceId && <Check color="primary" fontSize="small" />}
                </ListItemButton>
              ))}
              {instances && (creating ? (
                <Box sx={{ px: 1, pt: 1 }}>
                  <TextField autoFocus fullWidth size="small" label="新实例名称" placeholder={`比如：${widget.name} 2`} value={newName} disabled={busy}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirm() }} />
                </Box>
              ) : (
                <ListItemButton onClick={() => setCreating(true)} sx={{ borderRadius: 2, color: 'primary.main' }}>
                  <ListItemIcon sx={{ minWidth: 36, color: 'primary.main' }}><Add fontSize="small" /></ListItemIcon>
                  <ListItemText primary="新建实例" />
                </ListItemButton>
              ))}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        {!widget && (
          <>
            <Button startIcon={<FlotaAIIcon />} onClick={() => { onClose(); askAIToCreateWidget() }}>用 AI 生成</Button>
            <Button startIcon={<Storefront />} onClick={goToStore}>从商店添加</Button>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={onClose}>取消</Button>
        {widget && (
          <Button variant="contained" disabled={busy || (!creating && !selectedInstanceId)} onClick={confirm}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {creating ? `新建并${confirmText}` : confirmText}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
