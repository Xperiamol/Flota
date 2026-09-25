import { useEffect, useMemo, useState } from 'react'
import { Box, Button, IconButton, InputAdornment, TextField, Typography } from '@mui/material'
import { Close, Search } from '../common/AppIcons'
import FlotaAIIcon from '../common/FlotaAIIcon'
import { HOME_BUILTIN_CARDS, useHomeStore, widgetCardId } from '../../store/useHomeStore'
import { askAIToCreateWidget } from '../../utils/widgets/askAI'
import { instanceLabel } from '../../utils/widgets/widgetActions'
import { WidgetGlyph } from '../widgets/widgetIcons'
import { thinScrollbarSx } from '../../styles/commonStyles'

function Row({ icon, name, onAdd }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 36 }}>
      {icon}
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{name}</Typography>
      <Button size="small" variant="outlined" onClick={onAdd} sx={{ borderRadius: '8px', minWidth: 0, px: 1.5 }}>添加</Button>
    </Box>
  )
}

/** 编辑首页时右侧的「添加卡片」面板：内置卡片与组件实例 */
export default function HomeAddPanel({ onClose }) {
  const cards = useHomeStore((state) => state.cards)
  const addCard = useHomeStore((state) => state.addCard)
  const [instances, setInstances] = useState([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    const load = () => window.electronAPI.widgets.allInstances().then((result) => setInstances(result?.success ? result.data : []))
    load()
    return window.electronAPI.widgets.onListChanged?.(load)
  }, [])

  const keyword = query.trim().toLowerCase()
  // 只列出还没放到首页的卡片
  const builtins = HOME_BUILTIN_CARDS.filter((card) => !cards.includes(card.id) && card.name.toLowerCase().includes(keyword))
  // 只有支持紧凑尺寸的组件能放到首页
  const widgetRows = useMemo(() => instances
    .filter((instance) => (instance.sizes || []).includes('compact') && !cards.includes(widgetCardId(instance.id)))
    .map((instance) => ({ ...instance, label: instanceLabel(instance.widgetName, instance.name) }))
    .filter((instance) => instance.label.toLowerCase().includes(keyword)), [instances, keyword, cards])

  return (
    <Box sx={(theme) => ({
      width: 320, flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: 0,
      maxHeight: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column', gap: 1.5, p: 2, boxSizing: 'border-box',
      borderRadius: '18px', bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`,
      boxShadow: theme.palette.mode === 'dark' ? '0 16px 40px rgba(0,0,0,0.4)' : '0 16px 40px rgba(22,22,24,0.12)',
    })}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>添加卡片</Typography>
        <IconButton size="small" aria-label="关闭" onClick={onClose}><Close fontSize="small" /></IconButton>
      </Box>
      <TextField size="small" placeholder="搜索卡片" value={query} onChange={(event) => setQuery(event.target.value)}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5, pr: 0.5, ...thinScrollbarSx }}>
        {builtins.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mt: 0.5 }}>内置</Typography>}
        {builtins.map((card) => (
          <Row key={card.id} name={card.name} onAdd={() => addCard(card.id)} />
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mt: 1.5 }}>组件</Typography>
        {widgetRows.map((instance) => (
          <Row key={instance.id} name={instance.label}
            icon={<WidgetGlyph icon={instance.widgetIcon} sx={{ fontSize: 17, color: 'text.secondary' }} />}
            onAdd={() => addCard(widgetCardId(instance.id))} />
        ))}
        {!widgetRows.length && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{keyword ? '没有匹配的组件' : '没有可以添加的组件'}</Typography>
        )}
      </Box>
      <Button variant="outlined" startIcon={<FlotaAIIcon sx={{ fontSize: 18 }} />} onClick={() => askAIToCreateWidget()}
        sx={{ borderRadius: '12px', borderStyle: 'dashed' }}>
        用 AI 做一个新组件
      </Button>
    </Box>
  )
}
