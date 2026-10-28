import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, Typography } from '@mui/material'
import { HistoryOutlined } from '@mui/icons-material'
import MarkdownPreview from './MarkdownPreview'
import { editorScrollbarSx } from '../../styles/commonStyles'

export default function NoteHistoryDialog({ noteId, onClose, onRestored }) {
  const [versions, setVersions] = useState([])
  const [policy, setPolicy] = useState({ enabled: false, intervalSeconds: 60, limit: 50 })
  const [selected, setSelected] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [revision, setRevision] = useState('')
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => {
    let active = true
    window.electronAPI.notes.versions(noteId).then(result => {
      if (!active) return
      if (!result.success) throw new Error(result.error)
      setVersions(result.data.versions)
      if (result.data.policy) setPolicy(result.data.policy)
      setRevision(result.data.revision)
      setSelected(result.data.versions[0]?.id ?? null)
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.current++ }
  }, [noteId])
  useEffect(() => {
    if (selected == null) return
    const token = ++request.current
    setSnapshot(null)
    window.electronAPI.notes.version(noteId, selected).then(result => {
      if (request.current !== token) return
      if (!result.success) throw new Error(result.error)
      setSnapshot(result.data)
    }).catch(e => { if (request.current === token) setError(e.message) })
  }, [noteId, selected])
  const restore = async () => {
    setRestoring(true); setError('')
    try {
      const result = await window.electronAPI.notes.restoreVersion(noteId, selected, revision)
      if (!result.success) throw new Error(result.error)
      await onRestored(result.data)
      onClose()
    } catch (e) { setError(e.message) } finally { setRestoring(false) }
  }
  return <Dialog open onClose={restoring ? undefined : onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 4, outline: 'none', height: 'min(680px, calc(100dvh - 64px))', minHeight: 0, overflow: 'hidden' } }}>
    <DialogTitle sx={{ pb: 1, flexShrink: 0 }}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><HistoryOutlined color="primary" />历史版本</Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>查看过去的内容。恢复前会保留当前版本，随时可以找回来。</Typography>
    </DialogTitle>
    <DialogContent sx={{ px: 0, pb: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {error && <Alert severity="error" sx={{ mx: 3, my: 1 }}>{error}</Alert>}
      {loading ? <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress size={24} /></Box> : !versions.length ?
        <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}><HistoryOutlined sx={{ fontSize: 40, opacity: .4 }} /><Typography sx={{ mt: 1 }}>还没有历史版本</Typography><Typography variant="body2" sx={{ mt: .5 }}>{policy.enabled ? `修改前自动保存旧内容，${policy.intervalSeconds} 秒内的连续编辑共用一份快照。` : '自动快照已关闭，可在设置 → 编辑器中开启。'}</Typography></Box> :
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', flexDirection: { xs: 'column', sm: 'row' }, borderTop: 1, borderColor: 'divider', mt: 1 }}>
          <List sx={{ ...editorScrollbarSx, width: { xs: '100%', sm: 210 }, minHeight: 0, flexShrink: 0, overflow: 'auto', maxHeight: { xs: 140, sm: 'none' }, borderRight: { sm: 1 }, borderColor: 'divider', p: 1 }}>
            {versions.map(item => <ListItemButton key={item.id} selected={item.id === selected} onClick={() => setSelected(item.id)} disabled={restoring} sx={{ borderRadius: 2, mb: .5 }}>
              <ListItemText primary={new Date(item.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} secondary={`${item.length || 0} 字符 · ${item.title || '未命名笔记'}`} primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }} secondaryTypographyProps={{ noWrap: true, fontSize: 12 }} />
            </ListItemButton>)}
          </List>
          <Box sx={{ ...editorScrollbarSx, flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: { xs: 2, sm: 3 } }}>
            {!snapshot ? <CircularProgress size={20} /> : <><Typography variant="h6" sx={{ mb: 2 }}>{snapshot.title || '未命名笔记'}</Typography>
              {snapshot.note_type === 'whiteboard' ? <Alert severity="info">此版本包含画布内容，恢复后可在白板中查看。</Alert> : <MarkdownPreview content={snapshot.content} showAudioTranscription={false} sx={{ height: 'auto', overflow: 'visible', overflowX: 'visible', p: 0, scrollbarGutter: 'auto' }} />}</>}
          </Box>
        </Box>}
    </DialogContent>
    <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 2, gap: 1, flexShrink: 0, flexWrap: 'wrap' }}><Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>本机历史 · 最多 {policy.limit} 份{!policy.enabled && ' · 自动快照已关闭'}</Typography><Button onClick={onClose} disabled={restoring}>取消</Button><Button variant="contained" disableElevation onClick={restore} disabled={!snapshot || restoring}>{restoring ? '恢复中…' : '恢复此版本'}</Button></DialogActions>
  </Dialog>
}
