import { buildContextPackageFromNotes } from '../aiContextUtils'
import { toListResult } from '../todoDisplayUtils'
import { applyLocation } from './uiLocation'
import { resolveContextPolicy } from './contextPolicy'

const fetchTodos = async () => {
  try {
    const result = await window.electronAPI?.todos?.getAll?.({ includeCompleted: false, limit: 100 })
    return toListResult(result)
  } catch (_) {
    return []
  }
}

// 根据入口、可见笔记和当前问题选择上下文；长期记忆由后端相关性检索。
export const buildContext = async ({ notes = [], selectedNoteId, query = '', scene = 'chat_panel', location = null }) => {
  const policy = resolveContextPolicy({ scene, selectedNoteId, location, query })
  const todos = policy.contextEnabled.todos ? await fetchTodos() : []
  return applyLocation(buildContextPackageFromNotes({ notes, todos, memories: [], query, ...policy }), location)
}
