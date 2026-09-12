import { useState } from 'react'
import { Alert, Button, Snackbar } from '@mui/material'
import { FileDownload } from '../common/AppIcons'
import { fetchNoteById } from '../../api/noteAPI'

export default function BatchExportButton({ ids, sx }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const run = async () => {
    if (busy || !ids.length) return
    setBusy(true)
    try {
      await window.__saveBeforeClose?.()
      const documents = []
      for (const id of ids) {
        const result = await fetchNoteById(id)
        const note = result?.data || result
        if (!note?.id) throw new Error('读取笔记失败，请重试')
        documents.push(note)
      }
      const result = await window.electronAPI.notes.exportDocument({
        format: 'batch', title: `笔记导出-${documents.length}篇`, documents,
      })
      if (result?.canceled) return
      if (!result?.success) throw new Error(result?.error || '导出失败')
      setNotice({ severity: 'success', message: `已导出 ${documents.length} 篇笔记到 ${result.filePath}` })
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally { setBusy(false) }
  }
  return <>
    <Button size="small" startIcon={<FileDownload />} disabled={busy || !ids.length} onClick={run} sx={sx}>
      {busy ? '导出中…' : '导出 ZIP'}
    </Button>
    <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice(null)}>
      <Alert severity={notice?.severity || 'success'} onClose={() => setNotice(null)}>{notice?.message}</Alert>
    </Snackbar>
  </>
}
