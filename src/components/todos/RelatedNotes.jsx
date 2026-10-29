import { Box, Chip, Typography } from '@mui/material'
import { useStore } from '../../store/useStore'
import { matchesReference, referenceUrl, referencesIn } from '../../utils/todoReferences'
import { openNoteLink } from '../../utils/linkUtils'
import { notifyError } from '../../utils/notify'

export default function RelatedNotes({ todo, description, onNavigate }) {
  const notes = useStore(state => state.notes)
  const outgoing = referencesIn(description, 'note')
  const related = notes.filter(note => !note.is_deleted && !note.deleted_at && (matchesReference(note, outgoing) || (todo && matchesReference(todo, referencesIn(note.content, 'todo')))))
  if (!related.length && !outgoing.size) return null
  const missing = [...outgoing].filter(id => !related.some(note => String(note.sync_id || note.id) === id))
  return <Box sx={{ mb: 2 }}>
    <Typography variant="caption" color="text.secondary">关联笔记</Typography>
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>{related.map(note => <Chip key={note.id} size="small" variant="outlined" label={note.title || '未命名'} onClick={async () => {
      try {
        if (onNavigate && await onNavigate() === false) return
        await openNoteLink(referenceUrl('note', note.sync_id || note.id))
      }
      catch (e) { notifyError(e.message) }
    }} />)}{missing.map(id => <Chip key={id} size="small" variant="outlined" disabled label="笔记已删除或尚未同步" />)}</Box>
  </Box>
}
