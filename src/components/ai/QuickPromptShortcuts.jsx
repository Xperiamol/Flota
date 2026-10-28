import { useMemo, useState } from 'react'
import { Box, Button, Chip, IconButton, TextField, Tooltip, Typography } from '@mui/material'
import { AddRounded, DeleteOutlineRounded, EditOutlined, TuneRounded, ArrowBackRounded, CloseRounded } from '@mui/icons-material'
import { usePrefsStore } from '../../store/usePrefsStore'

export default function QuickPromptShortcuts({ defaults, scope = 'general', onSelect }) {
  const sets = usePrefsStore(state => state.aiQuickPromptSets)
  const presets = useMemo(() => defaults.map((item, index) => ({ id: item.id || `preset-${index}`, label: item.label, prompt: item.prompt })), [defaults])
  const prompts = sets[scope] ?? presets
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const save = next => {
    const latest = usePrefsStore.getState()
    latest.setPref('aiQuickPromptSets', { ...latest.aiQuickPromptSets, [scope]: next })
  }
  const edit = item => { setDraft(item ? { ...item } : { id: crypto.randomUUID(), label: '', prompt: '' }); setOpen(true) }
  const submit = () => {
    const item = { ...draft, label: draft.label.trim(), prompt: draft.prompt.trim() }
    save(prompts.some(current => current.id === item.id) ? prompts.map(current => current.id === item.id ? item : current) : [...prompts, item])
    setDraft(null)
  }
  const restore = () => {
    const latest = usePrefsStore.getState()
    const next = { ...latest.aiQuickPromptSets }
    delete next[scope]
    latest.setPref('aiQuickPromptSets', next)
  }
  return <Box data-quick-prompts sx={{ width: '100%', maxWidth: 520 }}>
    {!open ? <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: .75 }}>
      {prompts.map(item => <Tooltip key={item.id} title={item.prompt}><Chip size="small" label={item.label} onClick={() => onSelect(item.prompt)} sx={{ maxWidth: '100%', height: 28, borderRadius: '9px', fontSize: 12, bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' } }} /></Tooltip>)}
      {!prompts.length && <Button size="small" onClick={() => edit()}>添加快捷方式</Button>}
      <Tooltip title="新增 Prompt 快捷方式"><IconButton size="small" aria-label="新增 Prompt 快捷方式" onClick={() => edit()} sx={{ width: 28, height: 28, color: 'text.secondary' }}><AddRounded sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      <Tooltip title="管理快捷方式"><IconButton size="small" aria-label="管理 Prompt 快捷方式" onClick={() => { setDraft(null); setOpen(true) }} sx={{ width: 28, height: 28, color: 'text.secondary' }}><TuneRounded sx={{ fontSize: 16 }} /></IconButton></Tooltip>
    </Box> : <Box role="region" aria-label="快捷方式编辑面板" sx={{ border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'action.hover', overflow: 'hidden', textAlign: 'left', WebkitAppRegion: 'no-drag' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: .75, px: 1.25, py: .75, borderBottom: 1, borderColor: 'divider' }}>
        {draft && <IconButton size="small" aria-label="返回快捷方式列表" onClick={() => setDraft(null)} sx={{ width: 28, height: 28 }}><ArrowBackRounded sx={{ fontSize: 17 }} /></IconButton>}
        <Typography sx={{ flex: 1, fontSize: 12.5, fontWeight: 650 }}>{draft ? (prompts.some(item => item.id === draft.id) ? '编辑快捷方式' : '新增快捷方式') : '管理快速开始'}</Typography>
        <IconButton size="small" aria-label="关闭快捷方式编辑面板" onClick={() => setOpen(false)} sx={{ width: 28, height: 28 }}><CloseRounded sx={{ fontSize: 17 }} /></IconButton>
      </Box>
      {draft ? <Box component="form" onSubmit={event => { event.preventDefault(); if (draft.label.trim() && draft.prompt.trim()) submit() }} sx={{ p: 1.5 }}>
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <TextField autoFocus fullWidth size="small" label="快捷方式名称" value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} placeholder="例如：生成周报" />
          <TextField fullWidth size="small" multiline minRows={3} maxRows={6} label="Prompt 内容" value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder="填写完整提示词…" />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: .75, mt: 1.5 }}>
          <Button size="small" onClick={() => setDraft(null)}>取消</Button>
          <Button size="small" type="submit" variant="contained" disableElevation disabled={!draft.label.trim() || !draft.prompt.trim()}>保存</Button>
        </Box>
      </Box> : <>
        <Box sx={{ maxHeight: 240, overflowY: 'auto', px: 1.25 }}>
          {prompts.map(item => <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: .5, py: 1, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
            <Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</Typography><Typography noWrap sx={{ fontSize: 11, mt: .25, color: 'text.secondary' }}>{item.prompt}</Typography></Box>
            <Tooltip title="编辑"><IconButton size="small" aria-label={`编辑快捷方式：${item.label}`} onClick={() => edit(item)}><EditOutlined sx={{ fontSize: 16 }} /></IconButton></Tooltip>
            <Tooltip title="删除"><IconButton size="small" aria-label={`删除快捷方式：${item.label}`} onClick={() => save(prompts.filter(current => current.id !== item.id))}><DeleteOutlineRounded sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          </Box>)}
          {!prompts.length && <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center', fontSize: 12 }}>还没有快捷方式</Typography>}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: .5, px: 1.25, py: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" onClick={restore} disabled={!Object.hasOwn(sets, scope)} sx={{ mr: 'auto', fontSize: 11 }}>恢复默认</Button>
          <Button size="small" onClick={() => setOpen(false)}>完成</Button>
          <Button size="small" variant="contained" disableElevation startIcon={<AddRounded />} onClick={() => edit()}>新增</Button>
        </Box>
      </>}
    </Box>}
  </Box>
}
