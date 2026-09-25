import { useCallback, useEffect, useState } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Tab, Tabs,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography
} from '@mui/material'
import { confirmAction, notifyError, notifySuccess } from '../../utils/notify'

export const formatTime = (value) => {
  if (!value) return ''
  const date = new Date(typeof value === 'number' ? value : String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

const formatCell = (value) => {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function DataDialog({ instance, open, onClose }) {
  const [collections, setCollections] = useState([])
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (!open || !instance) return
    window.electronAPI.widgets.dataOverview(instance.id).then((result) => {
      setCollections(result?.success ? result.data : [])
      setActive(0)
    })
  }, [open, instance])
  if (!instance) return null
  const current = collections[active]
  const columns = current ? [...new Set(current.records.flatMap((record) => Object.keys(record).filter((key) => !key.startsWith('_'))))] : []
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>「{instance.name}」的数据</DialogTitle>
      <DialogContent>
        {!collections.length ? (
          <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>还没有数据</Typography>
        ) : (
          <>
            <Tabs value={active} onChange={(_, value) => setActive(value)} sx={{ mb: 1 }}>
              {collections.map((item) => <Tab key={item.collection} label={`${item.collection}（${item.count}）`} />)}
            </Tabs>
            <TableContainer sx={{ maxHeight: 460 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>{columns.map((column) => <TableCell key={column}>{column}</TableCell>)}<TableCell>更新时间</TableCell></TableRow></TableHead>
                <TableBody>
                  {current.records.map((record) => (
                    <TableRow key={record._id}>
                      {columns.map((column) => (
                        <TableCell key={column} sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatCell(record[column])}</TableCell>
                      ))}
                      <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{formatTime(record._updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>关闭</Button></DialogActions>
    </Dialog>
  )
}

export function VersionsDialog({ widget, open, onClose }) {
  const [versions, setVersions] = useState([])
  const load = useCallback(() => {
    window.electronAPI.widgets.versions(widget.id).then((result) => setVersions(result?.success ? result.data : []))
  }, [widget.id])
  useEffect(() => { if (open) load() }, [open, load])
  const rollback = async (version) => {
    const ok = await confirmAction({ title: '回滚组件', message: `把「${widget.name}」恢复到版本 ${version}？所有实例都会用这个版本，数据不变。`, confirmText: '回滚' })
    if (!ok) return
    const result = await window.electronAPI.widgets.rollback(widget.id, version)
    if (!result?.success) return notifyError(result?.error || '回滚失败')
    notifySuccess(`已回滚到版本 ${version}`)
    load()
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>历史版本</DialogTitle>
      <DialogContent>
        <List dense>
          {versions.map((item, index) => (
            <ListItem key={item.version} secondaryAction={index === 0
              ? <Typography variant="caption" color="primary">当前</Typography>
              : <Button size="small" onClick={() => rollback(item.version)}>回滚</Button>}>
              <ListItemText primary={`版本 ${item.version}${item.note ? ` · ${item.note}` : ''}`} secondary={formatTime(item.created_at)} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>关闭</Button></DialogActions>
    </Dialog>
  )
}
