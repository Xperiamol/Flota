import { useEffect, useMemo, useState } from 'react'
import { Box, Button, ButtonBase, InputAdornment, Popover, TextField, Typography } from '@mui/material'
import { Add, Search } from '../common/AppIcons'
import FlotaAIIcon from '../common/FlotaAIIcon'
import { HOME_BUILTIN_CARDS, useHomeStore, widgetCardId } from '../../store/useHomeStore'
import { askAIToCreateWidget } from '../../utils/widgets/askAI'
import { instanceLabel } from '../../utils/widgets/widgetActions'
import { WidgetGlyph } from '../widgets/widgetIcons'
import { thinScrollbarSx } from '../../styles/commonStyles'

// 整行可点：点一下就加到首页末尾，面板保持打开，可以连续添加
function Row({ icon, name, description, onAdd }) {
  return (
    <ButtonBase onClick={onAdd} aria-label={`添加「${name}」`}
      sx={{
        width: '100%', justifyContent: 'flex-start', gap: 1.25, minHeight: 40, px: 1, borderRadius: '10px', textAlign: 'left',
        '&:hover': { bgcolor: 'action.hover' }, '&:hover .home-add-plus': { color: 'primary.main' },
      }}>
      {icon}
      <Box sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{name}</Typography>
        {description && <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>{description}</Typography>}
      </Box>
      <Add className="home-add-plus" sx={{ fontSize: 18, color: 'text.disabled', transition: 'color 120ms ease' }} />
    </ButtonBase>
  )
}

/** 编辑首页时的「添加卡片」弹出面板：内置卡片与组件实例 */
export default function HomeAddPanel({ anchorEl, onClose }) {
  const cards = useHomeStore((state) => state.cards)
  const aiBarHidden = useHomeStore((state) => state.aiBarHidden)
  const addCard = useHomeStore((state) => state.addCard)
  const [instances, setInstances] = useState([])
  const [query, setQuery] = useState('')
  const open = Boolean(anchorEl)

  useEffect(() => {
    if (!open) return undefined
    const load = () => window.electronAPI.widgets.allInstances().then((result) => setInstances(result?.success ? result.data : []))
    load()
    return window.electronAPI.widgets.onListChanged?.(load)
  }, [open])

  const keyword = query.trim().toLowerCase()
  // 只列出还没放到首页的卡片
  const builtins = HOME_BUILTIN_CARDS.filter((card) => !cards.includes(card.id) && card.name.toLowerCase().includes(keyword))
  // 只有支持紧凑尺寸的组件能放到首页
  const widgetRows = useMemo(() => instances
    .filter((instance) => (instance.sizes || []).includes('compact') && !cards.includes(widgetCardId(instance.id)))
    .map((instance) => ({ ...instance, label: instanceLabel(instance.widgetName, instance.name) }))
    .filter((instance) => instance.label.toLowerCase().includes(keyword)), [instances, keyword, cards])

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { mt: 1, width: 340, maxHeight: 'min(560px, calc(100vh - 120px))', display: 'flex', flexDirection: 'column', borderRadius: '16px', p: 1.5, gap: 1 } } }}
    >
      <TextField size="small" autoFocus placeholder="搜索卡片" value={query} onChange={(event) => setQuery(event.target.value)}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0.25, mx: -0.5, px: 0.5, ...thinScrollbarSx }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, px: 1, mt: 0.5 }}>内置卡片</Typography>
        {aiBarHidden && '问 flotaai 输入框'.includes(keyword) && (
          <Row name="问 FlotaAI 输入框" description="首页顶部的 AI 输入框" onAdd={() => useHomeStore.getState().setAiBarHidden(false)} />
        )}
        {builtins.map((card) => (
          <Row key={card.id} name={card.name} description={card.description} onAdd={() => addCard(card.id)} />
        ))}
        {!builtins.length && !aiBarHidden && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 0.75 }}>{keyword ? '没有匹配的卡片' : '内置卡片都已在首页上'}</Typography>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, px: 1, mt: 1.25 }}>组件</Typography>
        {widgetRows.map((instance) => (
          <Row key={instance.id} name={instance.label}
            icon={<WidgetGlyph icon={instance.widgetIcon} sx={{ fontSize: 17, color: 'text.secondary' }} />}
            onAdd={() => addCard(widgetCardId(instance.id))} />
        ))}
        {!widgetRows.length && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 0.75 }}>{keyword ? '没有匹配的组件' : '没有可以添加的组件'}</Typography>
        )}
      </Box>
      <Button variant="outlined" startIcon={<FlotaAIIcon sx={{ fontSize: 18 }} />} onClick={() => { onClose(); askAIToCreateWidget() }}
        sx={{ borderRadius: '12px', borderStyle: 'dashed', flexShrink: 0 }}>
        用 AI 做一个新组件
      </Button>
    </Popover>
  )
}
