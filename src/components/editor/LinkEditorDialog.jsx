import { useEffect, useState } from 'react'
import { getMarkRange } from '@tiptap/core'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'
import { normalizeLinkUrl } from '../../utils/linkUtils'

export const requestLinkEditor = editor => window.dispatchEvent(new CustomEvent('flota-edit-link', { detail: { editor } }))

export default function LinkEditorDialog({ editor }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const open = event => {
      if (!editor || event.detail?.editor !== editor) return
      const selection = editor.state.selection
      const range = selection.empty ? getMarkRange(selection.$from, editor.schema.marks.link) : null
      const { from, to } = range || selection
      const text = editor.state.doc.textBetween(from, to, ' ')
      setDraft({ from, to, text, originalText: text, url: editor.getAttributes('link').href || '' })
      setError('')
    }
    window.addEventListener('flota-edit-link', open)
    return () => window.removeEventListener('flota-edit-link', open)
  }, [editor])
  const save = () => {
    const href = normalizeLinkUrl(draft.url)
    if (!href) { setError('请输入有效的网址、邮箱或本地文件链接'); return }
    const chain = editor.chain().focus().setTextSelection({ from: draft.from, to: draft.to })
    if (draft.from !== draft.to && draft.text === draft.originalText) chain.setLink({ href }).run()
    else chain.insertContent({ type: 'text', text: draft.text || draft.url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run()
    editor.view.dispatch(editor.state.tr.removeStoredMark(editor.schema.marks.link))
    setDraft(null)
  }
  return <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
    <DialogTitle>设置链接</DialogTitle>
    <DialogContent>
      <TextField autoFocus fullWidth label="网址或邮箱" placeholder="example.com" value={draft?.url || ''}
        onChange={event => { setDraft(value => ({ ...value, url: event.target.value })); setError('') }}
        error={Boolean(error)} helperText={error || '网址可以省略 https://'} sx={{ mt: 1 }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save() } }} />
      <TextField fullWidth label="显示文字" value={draft?.text || ''} placeholder="留空时显示网址" sx={{ mt: 2 }}
        onChange={event => setDraft(value => ({ ...value, text: event.target.value }))} />
    </DialogContent>
    <DialogActions><Button onClick={() => setDraft(null)}>取消</Button><Button onClick={save}>确定</Button></DialogActions>
  </Dialog>
}
