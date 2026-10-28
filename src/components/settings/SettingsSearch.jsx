import { useMemo, useState } from 'react'
import { Box, ButtonBase, IconButton, InputBase, Typography } from '@mui/material'
import { SearchRounded, CloseRounded, ArrowForwardRounded } from '@mui/icons-material'
import { searchSettings } from './settingsSearchIndex'

export default function SettingsSearch({ onNavigate }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const results = useMemo(() => searchSettings(query), [query])
  const expanded = focused && Boolean(query.trim())
  const select = item => { onNavigate(item); setQuery(''); setActive(0); setFocused(false) }
  return <Box sx={{ position: 'relative', maxWidth: 932, mx: 'auto', width: '100%' }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, minHeight: 40, borderRadius: '12px', bgcolor: 'action.hover', border: '1px solid', borderColor: focused ? 'primary.main' : 'divider', transition: 'border-color 150ms ease' }}>
      <SearchRounded sx={{ fontSize: 19, color: focused ? 'primary.main' : 'text.secondary' }} />
      <InputBase fullWidth value={query} placeholder="搜索设置…" onFocus={() => setFocused(true)} onChange={event => { setQuery(event.target.value); setActive(0); setFocused(true) }}
        inputProps={{ 'aria-label': '搜索设置', role: 'combobox', 'aria-expanded': expanded, 'aria-controls': expanded ? 'settings-search-results' : undefined, 'aria-activedescendant': expanded && results[active] ? `setting-result-${results[active].id}` : undefined, autoComplete: 'off' }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') { event.stopPropagation(); setQuery(''); setFocused(false) }
          if (['ArrowDown', 'ArrowUp'].includes(event.key) && results.length) { event.preventDefault(); const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; setActive(next); document.getElementById(`setting-result-${results[next].id}`)?.scrollIntoView({ block: 'nearest' }) }
          if (event.key === 'Enter' && results[active]) { event.preventDefault(); select(results[active]) }
        }} sx={{ fontSize: 13 }} />
      {query && <IconButton size="small" aria-label="清空设置搜索" onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(''); setActive(0) }}><CloseRounded sx={{ fontSize: 16 }} /></IconButton>}
    </Box>
    {expanded && <Box id="settings-search-results" role="listbox" aria-label="设置搜索结果" sx={theme => ({ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 5, p: .75, borderRadius: '14px', maxHeight: 'min(420px, 55vh)', overflowY: 'auto', bgcolor: 'background.paper', backgroundImage: theme.custom?.glass?.backgroundImage, backdropFilter: 'blur(24px)', border: 1, borderColor: 'divider', boxShadow: theme.shadows[8] })}>
      <Typography sx={{ px: 1, py: .75, fontSize: 11, color: 'text.secondary' }}>{results.length ? `${results.length} 个相关设置` : '没有找到相关设置，试试其他关键词'}</Typography>
      {results.map((item, index) => <ButtonBase key={item.id} id={`setting-result-${item.id}`} role="option" aria-selected={active === index} onMouseEnter={() => setActive(index)} onClick={() => select(item)} sx={{ display: 'flex', width: '100%', gap: 1.5, p: 1.25, borderRadius: '9px', textAlign: 'left', bgcolor: active === index ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontSize: 13, fontWeight: 550 }}>{item.label}</Typography><Typography sx={{ fontSize: 11, color: 'text.secondary', mt: .25 }}>{[item.group, item.category].filter((part, i, parts) => part && parts.indexOf(part) === i).join(' / ')}</Typography></Box>
        <ArrowForwardRounded sx={{ fontSize: 16, color: 'text.secondary' }} />
      </ButtonBase>)}
    </Box>}
  </Box>
}
