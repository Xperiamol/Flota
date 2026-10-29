import { useEffect } from 'react'
import { create } from 'zustand'
import { fetchTodos } from '../api/todoAPI'

let subscribers = 0
let revision = 0
let unsubscribeSync
const useRecords = create(() => ({ todos: [], loading: true, error: '' }))
export async function refreshTodoReferences() {
  if (!subscribers) return
  const request = ++revision
  try {
    const todos = await fetchTodos({ includeCompleted: true })
    if (request === revision) useRecords.setState({ todos, loading: false, error: '' })
  } catch (error) {
    if (request === revision) useRecords.setState({ loading: false, error: error.message })
  }
}
export default function useTodoReferences() {
  const state = useRecords()
  useEffect(() => {
    if (++subscribers === 1) {
      refreshTodoReferences()
      unsubscribeSync = window.electronAPI?.sync?.onSyncComplete?.(refreshTodoReferences)
      window.addEventListener('focus', refreshTodoReferences)
      window.electronAPI?.on?.('todo:changed', refreshTodoReferences)
    }
    return () => {
      if (--subscribers === 0) {
        ++revision
        unsubscribeSync?.()
        window.removeEventListener('focus', refreshTodoReferences)
        window.electronAPI?.removeListener?.('todo:changed', refreshTodoReferences)
      }
    }
  }, [])
  return state
}
