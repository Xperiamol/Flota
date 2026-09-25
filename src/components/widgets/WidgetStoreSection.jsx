import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DeleteOutline, Download, Info, MoreHoriz, OpenInNew, PushPin, PushPinOutlined } from '../common/AppIcons'
import AppContextMenu from '../common/AppContextMenu'
import PluginCard from '../plugins/PluginCard'
import PluginDetailDrawer from '../plugins/PluginDetailDrawer'
import { filterPlugins } from '../plugins/pluginUtils'
import WidgetHost from './WidgetHost'
import { WidgetGlyph } from './widgetIcons'
import { useStore } from '../../store/useStore'
import { useWidgetStore, ensureWidgetsLoaded, openWidgetHome } from '../../store/useWidgetStore'
import { confirmAction, notifyError, notifySuccess } from '../../utils/notify'
import { emptyStateSx } from '../../styles/commonStyles'

const gridSx = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2, px: 1, py: 0.5 }

const WidgetAvatar = ({ icon }) => <WidgetGlyph icon={icon} sx={{ fontSize: 26, color: 'primary.main' }} />

const HelpBlock = ({ help }) => (
  <Box>
    <Typography variant="subtitle1" sx={{ mb: 0.5 }}>使用说明</Typography>
    <Box sx={{ fontSize: 14, lineHeight: 1.7, color: 'text.secondary', '& p': { mt: 0, mb: 1 }, '& ul, & ol': { pl: 2.5, my: 0.5 } }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{help}</ReactMarkdown>
    </Box>
  </Box>
)

// 商店试用：临时草稿，关闭详情时丢弃，数据不会保存
function StorePreview({ storeId }) {
  const [draftId, setDraftId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let created = null
    setDraftId(null)
    setError('')
    window.electronAPI.widgets.storePreview(storeId).then((result) => {
      if (!result?.success) return !cancelled && setError(result?.error || '无法加载试用')
      created = result.data
      if (cancelled) window.electronAPI.widgets.discardDraft(created)
      else setDraftId(created)
    })
    return () => {
      cancelled = true
      if (created) window.electronAPI.widgets.discardDraft(created)
    }
  }, [storeId])

  return (
    <Box>
      <Typography variant="subtitle1">试用</Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>可以直接操作，试用数据不会保存。</Typography>
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', minHeight: 120 }}>
        {error && <Typography variant="body2" color="error" sx={{ p: 2 }}>{error}</Typography>}
        {!error && !draftId && <Box sx={{ py: 5, display: 'grid', placeItems: 'center' }}><CircularProgress size={20} /></Box>}
        {draftId && <WidgetHost instanceId={draftId} size="medium" surface="note" maxHeight={520} />}
      </Box>
    </Box>
  )
}

/**
 * 插件/组件中心的「组件」部分：市场（可添加的组件）与已安装（我的全部组件）。
 * 沿用插件商店的卡片、详情抽屉、搜索框与左侧分类。
 */
export default function WidgetStoreSection() {
  const filters = useStore((state) => state.pluginStoreFilters)
  const setPluginStoreCategories = useStore((state) => state.setPluginStoreCategories)
  const widgets = useWidgetStore((state) => state.widgets)
  const loaded = useWidgetStore((state) => state.loaded)
  const [storeWidgets, setStoreWidgets] = useState(null)
  const [selected, setSelected] = useState(null) // { kind: 'store' | 'mine', id }
  const [pending, setPending] = useState({})
  const [menu, setMenu] = useState(null)

  useEffect(() => { ensureWidgetsLoaded() }, [])

  // “已添加”状态依赖我的组件列表，组件增删后重新读取
  const widgetIds = widgets.map((widget) => widget.id).join(',')
  const loadStore = useCallback(async () => {
    const result = await window.electronAPI.widgets.storeList()
    setStoreWidgets(result?.success ? result.data : [])
  }, [])
  useEffect(() => { loadStore() }, [loadStore, widgetIds])

  const storeById = useMemo(() => new Map((storeWidgets || []).map((entry) => [entry.id, entry])), [storeWidgets])

  useEffect(() => {
    if (!storeWidgets) return
    const categories = [...new Set(storeWidgets.flatMap((entry) => entry.categories || []))]
    setPluginStoreCategories(categories.map((category) => ({ id: category, name: category })))
  }, [storeWidgets, setPluginStoreCategories])

  // 我的组件套用插件卡片需要的字段；分类取自它来源的市场条目
  const myWidgets = useMemo(() => widgets.map((widget) => ({
    id: widget.id,
    name: widget.name,
    description: widget.manifest?.description || '',
    help: widget.manifest?.help || '',
    icon: widget.manifest?.icon || '',
    categories: storeById.get(widget.storeId)?.categories || [],
    permissions: widget.manifest?.permissions || [],
    pinned: widget.pinned,
    instanceCount: widget.instanceCount || 0,
  })), [widgets, storeById])

  const isMarket = filters.tab !== 'installed'
  const visibleStore = useMemo(() => filterPlugins(storeWidgets || [], filters), [storeWidgets, filters])
  const visibleMine = useMemo(() => filterPlugins(myWidgets, filters), [myWidgets, filters])

  const addFromStore = async (entry) => {
    setPending((state) => ({ ...state, [entry.id]: true }))
    try {
      const result = await window.electronAPI.widgets.storeInstall(entry.id)
      if (!result?.success) throw new Error(result?.error || '添加失败')
      await useWidgetStore.getState().loadWidgets()
      await loadStore()
      notifySuccess(`已添加「${entry.name}」，并固定到侧边栏`)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setPending((state) => ({ ...state, [entry.id]: false }))
    }
  }

  const deleteWidget = async (widget) => {
    const ok = await confirmAction({
      title: '删除组件',
      message: `删除「${widget.name}」和它的 ${widget.instanceCount} 个实例？实例会进入“最近删除”，30 天内可以恢复。`,
      confirmText: '删除', danger: true,
    })
    if (!ok) return
    const result = await window.electronAPI.widgets.delete(widget.id)
    if (!result?.success) return notifyError(result?.error || '删除失败')
    setSelected(null)
    useWidgetStore.getState().loadWidgets()
  }

  const exportWidget = async (widget) => {
    const result = await window.electronAPI.widgets.exportFile(widget.id)
    if (result?.success && result.data) notifySuccess('组件已导出')
    else if (!result?.success) notifyError(result?.error || '导出失败')
  }

  const togglePinned = (widget) => useWidgetStore.getState().setPinned(widget.id, !widget.pinned)

  const open = (widgetId) => {
    setSelected(null)
    openWidgetHome(widgetId)
  }

  const pinButton = (widget) => (
    <Tooltip title={widget.pinned ? '从侧边栏取消固定' : '固定到侧边栏'}>
      <IconButton size="small" color={widget.pinned ? 'primary' : 'default'} onClick={() => togglePinned(widget)}>
        {widget.pinned ? <PushPin fontSize="small" /> : <PushPinOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  )

  const storeActions = (entry, { large } = {}) => (entry.installed
    ? <Button size={large ? 'medium' : 'small'} variant="outlined" startIcon={<OpenInNew fontSize="small" />} onClick={() => open(entry.widgetId)}>打开</Button>
    : (
      <Button size={large ? 'medium' : 'small'} variant="contained" disabled={Boolean(pending[entry.id])} onClick={() => addFromStore(entry)}
        startIcon={pending[entry.id] ? <CircularProgress size={14} color="inherit" /> : undefined}
        sx={{ textTransform: 'none', fontWeight: 500 }}>
        添加到我的组件
      </Button>
    ))

  const renderEmpty = (title, hint) => (
    <Box sx={(theme) => ({ ...emptyStateSx(theme), mx: 1, my: 1 })}>
      <Typography variant="body1" sx={{ fontWeight: 650, color: 'text.primary' }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{hint}</Typography>
    </Box>
  )

  const selectedStore = selected?.kind === 'store' ? storeById.get(selected.id) : null
  const selectedMine = selected?.kind === 'mine' ? myWidgets.find((widget) => widget.id === selected.id) : null
  const menuWidget = menu?.widget

  if (isMarket && !storeWidgets) return <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>
  if (!isMarket && !loaded) return <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>

  return (
    <>
      {isMarket ? (
        <Box sx={gridSx}>
          {visibleStore.map((entry) => (
            <PluginCard key={entry.id} plugin={{ ...entry, icon: undefined, author: undefined }} compact={false}
              avatarContent={<WidgetAvatar icon={entry.icon} />}
              metaLabel={null} statusChip={null} detailLabel={null} hideCategories
              actions={storeActions(entry)}
              onSelect={() => setSelected({ kind: 'store', id: entry.id })} />
          ))}
        </Box>
      ) : (
        <Box sx={gridSx}>
          {visibleMine.map((widget) => (
            <PluginCard key={widget.id} plugin={{ ...widget, icon: undefined }} compact={false}
              avatarContent={<WidgetAvatar icon={widget.icon} />}
              metaLabel={`${widget.instanceCount} 个实例`} statusChip={null} detailLabel={null} hideCategories
              onSelect={() => open(widget.id)}
              actions={(
                <>
                  {pinButton(widget)}
                  <IconButton size="small" onClick={(event) => setMenu({ el: event.currentTarget, widget })}><MoreHoriz fontSize="small" /></IconButton>
                </>
              )} />
          ))}
        </Box>
      )}

      {isMarket && storeWidgets.length > 0 && !visibleStore.length && renderEmpty('没有匹配的组件', '换个关键词，或者直接让 AI 生成一个')}
      {!isMarket && myWidgets.length > 0 && !visibleMine.length && renderEmpty('没有匹配的组件', '试试调整搜索关键词或切换分类')}
      {!isMarket && !myWidgets.length && renderEmpty('还没有组件', '在市场添加，或点右上角「AI 生成」')}

      <AppContextMenu anchor={menu} onClose={() => setMenu(null)} items={menuWidget ? [
        { label: '详情与使用说明', icon: <Info fontSize="small" />, onClick: () => setSelected({ kind: 'mine', id: menuWidget.id }) },
        { label: '导出组件文件', icon: <Download fontSize="small" />, onClick: () => exportWidget(menuWidget) },
        { divider: true },
        { label: '删除组件', icon: <DeleteOutline fontSize="small" />, danger: true, onClick: () => deleteWidget(menuWidget) },
      ] : []} />

      {selectedStore && (
        <PluginDetailDrawer open plugin={{ ...selectedStore, icon: undefined }} onClose={() => setSelected(null)}
          avatarContent={<WidgetAvatar icon={selectedStore.icon} />}
          actions={storeActions(selectedStore, { large: true })}
          extra={(
            <>
              <StorePreview storeId={selectedStore.id} />
              {selectedStore.help && <HelpBlock help={selectedStore.help} />}
            </>
          )} />
      )}
      {selectedMine && (
        <PluginDetailDrawer open plugin={{ ...selectedMine, icon: undefined }} onClose={() => setSelected(null)}
          metaLabel={`${selectedMine.instanceCount} 个实例`}
          avatarContent={<WidgetAvatar icon={selectedMine.icon} />}
          actions={(
            <>
              <Button variant="contained" startIcon={<OpenInNew />} onClick={() => open(selectedMine.id)}>打开</Button>
              <Button variant="outlined" startIcon={selectedMine.pinned ? <PushPin /> : <PushPinOutlined />} onClick={() => togglePinned(selectedMine)}>
                {selectedMine.pinned ? '取消固定' : '固定到侧边栏'}
              </Button>
              <Button color="error" startIcon={<DeleteOutline />} onClick={() => deleteWidget(selectedMine)}>删除</Button>
            </>
          )}
          extra={selectedMine.help ? <HelpBlock help={selectedMine.help} /> : null} />
      )}
    </>
  )
}
