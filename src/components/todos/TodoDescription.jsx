import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState } from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import { Add, FormatBold, FormatListBulleted, Link as LinkIcon } from '../common/AppIcons'
import { referencesIn } from '../../utils/todoReferences'
import NoteReferencePicker from '../editor/NoteReferencePicker'
const WYSIWYGEditor = lazy(() => import('../editor/WYSIWYGEditor'))

const TodoDescription = forwardRef(({ value, onChange, identity }, ref) => {
  const editorRef = useRef(null)
  const files = useRef(null)
  const [editor, setEditor] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  useImperativeHandle(ref, () => ({ getMarkdown: async () => { await editorRef.current?.flushUploads(); return editorRef.current?.getMarkdown() ?? value } }))
  return <Box sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', '&:focus-within': { borderColor: 'primary.main' } }}>
    <Box sx={{ px: 1.5, pt: 1 }}><Typography variant="caption" color="text.secondary">详情</Typography></Box>
    <Box sx={{ display: 'flex', height: 210, '& .ProseMirror': { p: '12px !important', fontSize: '0.9rem !important' } }}>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>加载编辑器…</Typography>}>
        <WYSIWYGEditor ref={editorRef} noteId={`todo-description:${identity}`} enableTodoReferences={false} content={value} onChange={onChange} onEditorReady={setEditor} placeholder="补充说明，粘贴或拖入图片…" />
      </Suspense>
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'center', px: 1, pb: 0.5, gap: 0.25 }}>
      <Tooltip title="添加图片"><span><IconButton size="small" disabled={!editor} aria-label="添加图片" onClick={() => files.current?.click()}><Add fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title="加粗"><span><IconButton size="small" disabled={!editor} aria-label="加粗" onClick={() => editor.chain().focus().toggleBold().run()}><FormatBold fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title="列表"><span><IconButton size="small" disabled={!editor} aria-label="列表" onClick={() => editor.chain().focus().toggleBulletList().run()}><FormatListBulleted fontSize="small" /></IconButton></span></Tooltip>
      <Box sx={{ flex: 1 }} /><Button size="small" disabled={!editor} startIcon={<LinkIcon fontSize="small" />} onClick={() => setPickerOpen(true)}>关联笔记</Button>
    </Box>
    <input ref={files} type="file" accept="image/*" multiple hidden onChange={e => { editorRef.current?.insertImageFiles(e.target.files); e.target.value = '' }} />
    {pickerOpen && <NoteReferencePicker open onClose={() => setPickerOpen(false)} allowCreate title="关联笔记" confirmText="关联" onSelect={note => {
      if (!editor || editor.isDestroyed) throw new Error('编辑器已关闭')
      if (referencesIn(editor.storage.markdown.getMarkdown(), 'note').has(String(note.sync_id || note.id))) return
      editor.chain().focus().insertContentAt(editor.state.doc.content.size, [{ type: 'paragraph', content: [{ type: 'text', text: note.title || '未命名', marks: [{ type: 'link', attrs: { href: `app://note/${encodeURIComponent(note.sync_id || note.id)}` } }] }] }, { type: 'paragraph' }]).scrollIntoView().run()
    }} />}
  </Box>
})
export default TodoDescription
