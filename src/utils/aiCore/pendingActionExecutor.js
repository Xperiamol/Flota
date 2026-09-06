// 统一的待确认动作执行器（问题2）。
//
// 固定链路：validate pending -> resolve immutable target/source -> get latest scene
//          -> execute/generate -> persist -> refresh -> mark done。
//
// 历史问题：AIChatView / AICommandCenter / whiteboardAI / WhiteboardEditor 各写一套，
// 白板动作的 claim（单次 + TTL）、目标解析、刷新规则不一致。这里把"执行"这一段收敛到
// 单一入口；UI 只负责把返回结果反映到消息状态（标记 running/done/failed），不再各自决定
// 该不该 claim、该不该刷新。
//
// 返回结构：{ success, message, error, finalAction, reloadNotes, reloadTodos }

import {
  executeCreateWhiteboardToolAction,
  executeUpdateWhiteboardToolAction,
} from '../whiteboardAI'

const WHITEBOARD_ACTIONS = new Set(['create_whiteboard', 'update_whiteboard'])
// 白板执行器已在保存后刷新笔记。
const NOTE_REFRESH_ACTIONS = new Set(['create_note', 'edit_note', 'edit_notes'])
const TODO_REFRESH_ACTIONS = new Set(['create_todo', 'create_todos'])

// 白板动作走后端 gate：先 claim（consume = 单次 + TTL 校验），拿不到就直接失败，
// 避免重复执行或动作过期后执行。以 store 里的 args/context 快照为准。
// fallback：内存条目丢失（重启 / 超 TTL）时，后端会用确认卡持久化的 {name,args,context} 重建。
const buildFallback = (action) => ({
  name: action.name,
  args: action.args || {},
  context: action.context || null,
})

const executeWhiteboardAction = async (action, overrides, deps) => {
  const claim = await window.electronAPI?.ai?.consumePendingAction?.(action.actionId, buildFallback(action))
  if (!claim?.success) {
    throw new Error(claim?.error || '待确认操作不存在或已过期')
  }
  const claimedArgs = { ...(claim.action?.args || action.args || {}), ...(overrides || {}) }
  const actionContext = claim.action?.context || action.context || null

  if (action.name === 'create_whiteboard') {
    return executeCreateWhiteboardToolAction({
      args: claimedArgs,
      currentNote: deps.currentNote,
      notes: deps.notes,
      actionContext,
      createNote: deps.createNote,
      deleteNote: deps.deleteNote,
      updateNote: deps.updateNote,
      loadNotes: deps.loadNotes,
    })
  }
  return executeUpdateWhiteboardToolAction({
    args: claimedArgs,
    currentNote: deps.currentNote,
    notes: deps.notes,
    actionContext,
    updateNote: deps.updateNote,
    loadNotes: deps.loadNotes,
    setSelectedNoteId: deps.setSelectedNoteId,
  })
}

/**
 * 执行一个待确认动作。
 * @param {object} params
 * @param {object} params.action  待确认动作（需含 actionId/name）
 * @param {object|null} params.overrides  执行时覆盖参数（如 create_todos 勾选后的 todos）
 * @param {object} params.deps  执行所需能力：currentNote/notes/createNote/deleteNote/updateNote/loadNotes/setSelectedNoteId
 * @returns {Promise<{success:boolean, message:string, error?:string, finalAction:object, reloadNotes:boolean, reloadTodos:boolean}>}
 */
export const runPendingAction = async ({ action, overrides = null, deps = {} }) => {
  // validate pending
  if (!action?.actionId) {
    return { success: false, error: '待确认操作无效', finalAction: action, message: '', reloadNotes: false, reloadTodos: false }
  }

  try {
    const result = WHITEBOARD_ACTIONS.has(action.name)
      ? await executeWhiteboardAction(action, overrides, deps)
      : await window.electronAPI?.ai?.executePendingAction?.(action.actionId, overrides, buildFallback(action))

    const finalAction = result?.action || action
    const success = Boolean(result?.success)
    const message = success
      ? (result?.message || '操作已完成')
      : `操作失败：${result?.error || '未知错误'}`

    return {
      success,
      message,
      error: success ? undefined : (result?.error || '未知错误'),
      finalAction,
      reloadNotes: success && NOTE_REFRESH_ACTIONS.has(finalAction.name),
      reloadTodos: success && TODO_REFRESH_ACTIONS.has(finalAction.name),
    }
  } catch (error) {
    return {
      success: false,
      message: `操作失败：${error?.message || '未知错误'}`,
      error: error?.message || '未知错误',
      finalAction: action,
      reloadNotes: false,
      reloadTodos: false,
    }
  }
}

export default runPendingAction
