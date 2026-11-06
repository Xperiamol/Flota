import { useEffect } from 'react'
import { create } from 'zustand'
import { fetchTodos } from '../api/todoAPI'

// 笔记里引用的待办（关联任务、待办清单）共用的一份待办快照。
// 有人在用时才加载并监听变化；最后一个使用者离开后停止监听。
let subscribers = 0
let revision = 0
let unsubscribeSync
export const todoReferenceStore = create(() => ({ todos: [], loading: true, error: '' }))

export async function refreshTodoReferences() {
  if (!subscribers) return
  const request = ++revision
  try {
    const todos = await fetchTodos({ includeCompleted: true })
    if (request === revision) todoReferenceStore.setState({ todos, loading: false, error: '' })
  } catch (error) {
    if (request === revision) todoReferenceStore.setState({ loading: false, error: error.message })
  }
}

/** 开始使用待办快照，返回释放函数（非 React 代码用，如编辑器里的节点视图） */
export function retainTodoReferences() {
  if (++subscribers === 1) {
    refreshTodoReferences()
    unsubscribeSync = window.electronAPI?.sync?.onSyncComplete?.(refreshTodoReferences)
    window.addEventListener('focus', refreshTodoReferences)
    window.electronAPI?.on?.('todo:changed', refreshTodoReferences)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--subscribers === 0) {
      ++revision
      unsubscribeSync?.()
      window.removeEventListener('focus', refreshTodoReferences)
      window.electronAPI?.removeListener?.('todo:changed', refreshTodoReferences)
    }
  }
}

/** 按引用（sync_id 或 id）找待办 */
export const findTodoByReference = (todos, reference) => todos.find((todo) => String(todo.sync_id || todo.id) === String(reference))

/** @param {{ enabled?: boolean }} [options] enabled=false 时不加载（比如内容里根本没有待办引用） */
export default function useTodoReferences({ enabled = true } = {}) {
  const state = todoReferenceStore()
  useEffect(() => (enabled ? retainTodoReferences() : undefined), [enabled])
  return state
}
