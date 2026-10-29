import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, TextField, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material'
import useTodoReferences from '../../hooks/useTodoReferences'
import { createTodo } from '../../api/todoAPI'
import { referenceLink, tasksForScope } from '../../utils/todoReferences'

export default function TodoReferencePicker({ open, onClose, onSelect, sourceNote, initialText = '' }) {
  const { todos, loading, error: loadError } = useTodoReferences()
  const [kind, setKind] = useState('single')
  const [scope, setScope] = useState(sourceNote ? 'note' : 'all')
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const created = useRef(null)
  useEffect(() => { if (open) { setQuery(initialText); setError(''); created.current = null } }, [open, initialText])
  const finish = async (todo) => {
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try {
      if (kind === 'list') { await onSelect({ kind: 'list', reference: listReference, content: listTitle }); onClose(); return }
      if (!todo) {
        if (!created.current) created.current = await createTodo({ content: query.trim(), description: sourceNote ? referenceLink('note', sourceNote) : '' })
        todo = created.current
      }
      await onSelect(todo)
      onClose()
    } catch (e) { setError(e.message || '插入失败') }
    finally { submitting.current = false; setBusy(false) }
  }
  const listReference = scope === 'note' ? `note/${sourceNote?.sync_id || sourceNote?.id}` : scope === 'tag' ? `tag/${tag.trim()}` : 'all'
  const listTitle = scope === 'note' ? `${sourceNote?.title || '当前笔记'} · 待办` : scope === 'tag' ? `${tag.trim()} · 待办` : '全部待办'
  const listTasks = tasksForScope(todos, listReference, sourceNote ? [sourceNote] : [])
  const candidates = todos.filter(todo => todo.content.toLowerCase().includes(query.trim().toLowerCase()))
  return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>插入待办</DialogTitle>
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>引用已有任务，或新建一条。勾选与编辑会同步到待办页。</Typography>
      <ToggleButtonGroup exclusive size="small" value={kind} onChange={(_, value) => value && setKind(value)} sx={{ mb: 2 }}><ToggleButton value="single">单条待办</ToggleButton><ToggleButton value="list">待办清单</ToggleButton></ToggleButtonGroup>
      {(error || loadError) && <Alert severity="error" sx={{ mb: 1 }}>{error || loadError}</Alert>}
      {kind === 'list' ? <Box sx={{ minHeight: 280 }}>
        <ToggleButtonGroup exclusive size="small" value={scope} onChange={(_, value) => value && setScope(value)} sx={{ display: 'flex', mb: 2 }}>
          {sourceNote && <ToggleButton value="note">当前笔记</ToggleButton>}<ToggleButton value="tag">标签</ToggleButton><ToggleButton value="all">全部</ToggleButton>
        </ToggleButtonGroup>
        {scope === 'tag' && <TextField autoFocus fullWidth size="small" label="标签" value={tag} onChange={e => setTag(e.target.value)} sx={{ mb: 2 }} />}
        <Typography variant="body2" color="text.secondary">{listTasks.length} 条任务；清单会随新增、勾选和编辑自动更新。</Typography>
      </Box> : <>
      <TextField autoFocus fullWidth size="small" label="搜索待办，或输入新任务" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} />
      <List sx={{ height: 280, overflow: 'auto', mt: 1 }}>
        {candidates.map(todo => <ListItemButton key={todo.sync_id || todo.id} disabled={busy} onClick={() => finish(todo)} sx={{ borderRadius: 2 }}>
          <Checkbox checked={Boolean(todo.is_completed)} tabIndex={-1} disableRipple sx={{ pointerEvents: 'none' }} />
          <ListItemText primary={todo.content} secondary={todo.due_date?.slice(0, 10)} slotProps={{ primary: { noWrap: true } }} />
        </ListItemButton>)}
        {!candidates.length && <Typography color="text.secondary" variant="body2" sx={{ p: 3, textAlign: 'center' }}>{loading ? '正在加载…' : '没有匹配的待办，可以在下方新建'}</Typography>}
      </List></> }
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}><Button disabled={busy} onClick={onClose}>取消</Button><Box sx={{ flex: 1 }} /><Button disabled={busy || (kind === 'list' ? scope === 'tag' && !tag.trim() : !query.trim())} variant="contained" onClick={() => finish(null)}>{kind === 'list' ? '插入清单' : '新建并插入'}</Button></DialogActions>
  </Dialog>
}
