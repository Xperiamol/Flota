import { lazy, Suspense, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, IconButton, Box } from '@mui/material'
import { Close } from '../common/AppIcons'
const TodoEditDialog = lazy(() => import('./TodoEditDialog'))
const TodoListContent = lazy(() => import('../editor/extensions/TodoListEmbed').then(module => ({ default: module.TodoListContent })))

export default function TodoReferenceDialogs() {
  const [todo, setTodo] = useState(null)
  const [list, setList] = useState(null)
  useEffect(() => {
    const openTodo = event => setTodo(event.detail)
    const openList = event => setList(event.detail)
    window.addEventListener('flota:open-todo', openTodo)
    window.addEventListener('flota:open-todo-list', openList)
    return () => { window.removeEventListener('flota:open-todo', openTodo); window.removeEventListener('flota:open-todo-list', openList) }
  }, [])
  return <Suspense fallback={null}>
    {todo && <TodoEditDialog todo={todo} open onClose={() => setTodo(null)} />}
    {list && <Dialog open fullWidth maxWidth="sm" onClose={() => setList(null)}><DialogTitle component="div"><Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>待办清单<IconButton aria-label="关闭待办清单" onClick={() => setList(null)}><Close /></IconButton></Box></DialogTitle><DialogContent><TodoListContent reference={list} /></DialogContent></Dialog>}
  </Suspense>
}
