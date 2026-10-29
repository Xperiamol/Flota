import { lazy, Suspense, useState } from 'react'
import { Box, ButtonBase, Checkbox, CircularProgress, Typography } from '@mui/material'
import { isTodoCompleted, isFutureRecurringTodo } from '../../utils/todoDisplayUtils'
import { fetchSubtasks, toggleTodoComplete } from '../../api/todoAPI'
import { notifyError } from '../../utils/notify'
const TodoEditDialog = lazy(() => import('./TodoEditDialog'))

export default function TodoReferenceCard({ todo, title = '待办', loading = false, error = '', readOnly = false }) {
  const [editingTodo, setEditingTodo] = useState(null)
  const [busy, setBusy] = useState(false)
  const completed = todo ? isTodoCompleted(todo) : false
  return <>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', minHeight: 48 }}>
      {loading ? <CircularProgress size={18} sx={{ m: 1 }} /> : <Checkbox size="small" checked={completed} disabled={!todo || busy || readOnly || (!completed && isFutureRecurringTodo(todo))} inputProps={{ 'aria-label': completed ? '恢复待办' : '完成待办' }} onChange={async () => {
        if (busy) return
        setBusy(true)
        try {
          if (!completed && (await fetchSubtasks(todo.sync_id)).some(child => !child.is_completed)) throw new Error('请先完成子任务，或打开详情处理')
          await toggleTodoComplete(todo.id)
        }
        catch (e) { notifyError(e.message) }
        finally { setBusy(false) }
      }} />}
      <ButtonBase disabled={!todo} onClick={() => setEditingTodo(todo)} sx={{ flex: 1, textAlign: 'left', justifyContent: 'flex-start', display: 'block', py: 0.75, minWidth: 0, borderRadius: 1 }}>
        <Typography variant="body2" sx={{ textDecoration: completed ? 'line-through' : 'none', color: completed ? 'text.secondary' : 'text.primary', overflowWrap: 'anywhere' }}>{todo?.content || title}</Typography>
        {(error || (!todo && !loading)) && <Typography variant="caption" color="text.secondary">{error || '待办已删除或尚未同步到本设备'}</Typography>}
        {todo?.due_date && <Typography variant="caption" color="text.secondary">{todo.due_date.slice(0, 10)}</Typography>}
      </ButtonBase>
    </Box>
    {editingTodo && <Suspense fallback={null}><TodoEditDialog todo={editingTodo} open onClose={() => setEditingTodo(null)} /></Suspense>}
  </>
}
