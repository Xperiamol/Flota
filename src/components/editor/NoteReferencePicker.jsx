import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography } from '@mui/material'
import { Add, Brush, Check, Description, Search } from '../common/AppIcons'
import { useStore } from '../../store/useStore'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import { editorScrollbarSx } from '../../styles/commonStyles'

export default function NoteReferencePicker({ open, onClose, onSelect, whiteboards = false, excludeId }) {
  const notes = useStore(state => state.notes)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const createdNote = useRef(null)
  const listRef = useRef(null)
  useEffect(() => { if (open) { setQuery(''); setSelectedId(null); setError(''); createdNote.current = null } }, [open])
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [selectedId])
  const candidates = notes.filter(note => !note.is_deleted && !note.deleted_at && String(note.id) !== String(excludeId)
    && (whiteboards ? note.note_type === 'whiteboard' : note.note_type !== 'whiteboard')
    && (note.title || '').toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
  const selected = candidates.find(note => note.id === selectedId)
  const insert = async (note, create = false) => {
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try {
      if (create) {
        if (!createdNote.current) {
          const result = await useStore.getState().createNote({ title: query.trim() || '局部画布', note_type: 'whiteboard', selectAfterCreate: false,
            content: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, fileMap: {} }) })
          if (!result.success || !result.data?.id) throw new Error(result.error || '创建失败')
          createdNote.current = result.data
        }
        note = createdNote.current
      }
      await onSelect(note); onClose()
    } catch (e) { setError(e.message || '插入失败，请重试') }
    finally { submitting.current = false; setBusy(false) }
  }
  const Icon = whiteboards ? Brush : Description
  return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Icon color="primary" />{whiteboards ? '嵌入画布' : '引用笔记'}</DialogTitle>
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{whiteboards ? '选择已有画布或新建一张，编辑会保存到原画布。' : '插入笔记卡片，标题与摘要随原笔记更新。'}</Typography>
      <TextField autoFocus fullWidth size="small" placeholder="搜索标题…" value={query} disabled={busy}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
        onChange={e => { setQuery(e.target.value); setSelectedId(null) }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || busy) return
          if (e.key === 'Enter' && (selected || candidates[0])) { e.preventDefault(); insert(selected || candidates[0]) }
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && candidates.length) {
            e.preventDefault()
            const index = candidates.findIndex(note => note.id === selectedId)
            setSelectedId(candidates[Math.max(0, Math.min(candidates.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))].id)
          }
        }} />
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      <List ref={listRef} aria-label={whiteboards ? '画布列表' : '笔记列表'} sx={{ height: 300, overflow: 'auto', mt: 1, ...editorScrollbarSx }}>
        {candidates.map(note => <ListItemButton key={note.id} selected={note.id === selectedId} aria-selected={note.id === selectedId} disabled={busy}
          onClick={() => setSelectedId(note.id)} onDoubleClick={() => insert(note)} sx={{ borderRadius: 2, mb: 0.5 }}>
          <ListItemIcon sx={{ minWidth: 36 }}><Icon fontSize="small" /></ListItemIcon>
          <ListItemText primary={note.title || '未命名'} secondary={whiteboards ? '关联画布' : stripMarkdownToPreviewText(note.content || '').slice(0, 100) || '空笔记'}
            slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
          {note.id === selectedId && <Check color="primary" fontSize="small" />}
        </ListItemButton>)}
        {!candidates.length && <Box sx={{ py: 7, textAlign: 'center', color: 'text.secondary' }}><Icon sx={{ fontSize: 36, mb: 1, opacity: 0.5 }} /><Typography variant="body2">{query ? '没有找到匹配的内容' : whiteboards ? '还没有画布，从新建开始吧' : '暂无可引用的笔记'}</Typography></Box>}
      </List>
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
      {whiteboards && <Button startIcon={<Add />} disabled={busy} onClick={() => insert(null, true)}>新建并嵌入</Button>}
      <Box sx={{ flex: 1 }} /><Button disabled={busy} onClick={onClose}>取消</Button>
      <Button variant="contained" disabled={busy || !selected} onClick={() => insert(selected)} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>插入</Button>
    </DialogActions>
  </Dialog>
}