import { lazy, Suspense, useState } from 'react'
import { Box, ButtonBase, Checkbox, CircularProgress, Typography } from '@mui/material'
import { isTodoCompleted, isFutureRecurringTodo, isTodoOverdue, shortDueLabel } from '../../utils/todoDisplayUtils'
import { fetchSubtasks, toggleTodoComplete } from '../../api/todoAPI'
import { refreshTodoReferences } from '../../hooks/useTodoReferences'
import { notifyError } from '../../utils/notify'
const TodoEditDialog = lazy(() => import('./TodoEditDialog'))

/** 待办清单里的一行：和笔记里的任务列表长得一样（勾 + 文字 + 行尾截止时间），点文字打开详情 */
export default function TodoReferenceCard({ todo, title = '待办', loading = false, error = '', readOnly = false }) {
  const [editingTodo, setEditingTodo] = useState(null)
  const [busy, setBusy] = useState(false)
  const completed = todo ? isTodoCompleted(todo) : false
  const due = todo && !completed ? shortDueLabel(todo) : ''
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (!completed && (await fetchSubtasks(todo.sync_id)).some(child => !child.is_completed)) throw new Error('请先完成子任务，或打开详情处理')
      await toggleTodoComplete(todo.id)
      await refreshTodoReferences()
    } catch (e) { notifyError(e.message) } finally { setBusy(false) }
  }
  return <>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minHeight: 34, pr: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
      {loading
        ? <CircularProgress size={16} sx={{ m: 1 }} />
        : <Checkbox size="small" checked={completed} disabled={!todo || busy || readOnly || (!completed && isFutureRecurringTodo(todo))}
          inputProps={{ 'aria-label': completed ? '恢复待办' : '完成待办' }} onChange={toggle} />}
      <ButtonBase disabled={!todo} onClick={() => setEditingTodo(todo)} sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', py: 0.5, borderRadius: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ textDecoration: completed ? 'line-through' : 'none', color: completed ? 'text.secondary' : 'text.primary', overflowWrap: 'anywhere' }}>{todo?.content || title}</Typography>
          {(error || (!todo && !loading)) && <Typography variant="caption" color="text.disabled">{error || '待办已删除或尚未同步到本设备'}</Typography>}
        </Box>
      </ButtonBase>
      {due && <Typography variant="caption" sx={{ flexShrink: 0, color: isTodoOverdue(todo) ? 'error.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{due}</Typography>}
    </Box>
    {editingTodo && <Suspense fallback={null}><TodoEditDialog todo={editingTodo} open onClose={() => setEditingTodo(null)} /></Suspense>}
  </>
}
