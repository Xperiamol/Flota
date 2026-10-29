import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { Alert, Box, Checkbox, IconButton, LinearProgress, TextField, Tooltip, Typography } from '@mui/material'
import { Add, Close } from '../../common/AppIcons'
import { createTodoEmbed } from './TodoEmbed'
import useTodoReferences from '../../../hooks/useTodoReferences'
import { useStore } from '../../../store/useStore'
import { createTodo } from '../../../api/todoAPI'
import { isTodoCompleted } from '../../../utils/todoDisplayUtils'
import { referenceLink, tasksForScope } from '../../../utils/todoReferences'
import TodoReferenceCard from '../../todos/TodoReferenceCard'

export function TodoListContent({ reference, title = '待办清单', editable = true, onRemove, selected = false }) {
  const { todos, error: loadError } = useTodoReferences()
  const notes = useStore(state => state.notes)
  const [showCompleted, setShowCompleted] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tasks = tasksForScope(todos, reference, notes)
  const completed = tasks.filter(isTodoCompleted).length
  const visible = tasks.filter(todo => showCompleted || !isTodoCompleted(todo))
  const sourceNote = reference.startsWith('note/') ? notes.find(note => String(note.sync_id || note.id) === reference.slice(5)) : null
  const add = async () => {
    if (busy || !draft.trim()) return
    setBusy(true); setError('')
    try {
      if (reference.startsWith('note/') && !sourceNote) throw new Error('关联笔记不存在或尚未同步，暂时无法新增')
      await createTodo({ content: draft.trim(), tags: reference.startsWith('tag/') ? reference.slice(4) : '', description: sourceNote ? referenceLink('note', sourceNote) : '' })
      setDraft('')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <Box sx={{ my: 1.5, border: '1px solid', borderColor: selected ? 'primary.main' : 'divider', borderRadius: 2.5, p: 1.5, bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">{completed} / {tasks.length}</Typography>
        {onRemove && <Tooltip title="移除引用，保留待办"><IconButton size="small" aria-label="移除待办清单引用" onClick={onRemove}><Close sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
      </Box>
      <LinearProgress variant="determinate" value={tasks.length ? completed / tasks.length * 100 : 0} sx={{ height: 3, borderRadius: 2, mb: 1.5 }} />
      {(error || loadError) && <Alert severity="error" sx={{ mb: 1 }}>{error || loadError}</Alert>}
      <Box sx={{ display: 'grid', gap: 0.75, maxHeight: 360, overflow: 'auto' }}>{visible.map(todo => <TodoReferenceCard key={todo.sync_id || todo.id} todo={todo} readOnly={!editable} />)}</Box>
      {!visible.length && <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{tasks.length ? '全部完成了' : '还没有待办，从下一步行动开始'}</Typography>}
      {editable && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
        <TextField size="small" fullWidth variant="standard" placeholder="添加一条待办…" value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add() } }} />
        <IconButton size="small" aria-label="新增清单待办" disabled={busy || !draft.trim()} onClick={add}><Add fontSize="small" /></IconButton>
      </Box>}
      <Box component="label" sx={{ display: 'flex', alignItems: 'center', width: 'fit-content', mt: 0.5, color: 'text.secondary', fontSize: 12 }}><Checkbox size="small" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />显示已完成</Box>
    </Box>
}
function TodoListView({ node, editor, getPos, selected }) {
  return <NodeViewWrapper contentEditable={false} data-drag-handle=""><TodoListContent reference={node.attrs.reference} title={node.attrs.title} editable={editor.isEditable} selected={selected} onRemove={editor.isEditable ? () => {
    const pos = getPos()
    if (typeof pos === 'number') editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
  } : undefined} /></NodeViewWrapper>
}
export const TodoListEmbed = createTodoEmbed('todoListEmbed', 'todo-list', TodoListView)
