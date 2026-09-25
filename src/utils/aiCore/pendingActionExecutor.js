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

import { runWidgetGeneration } from '../widgets/widgetGeneration'
import { useWidgetActionProgress } from '../widgets/widgetActionProgress'

const WHITEBOARD_ACTIONS = new Set(['create_whiteboard', 'update_whiteboard'])
// 组件生成 / 修改：在渲染层执行（生成 → 沙箱预跑 → 自动修复 → 保存），进度显示在确认卡片里
const WIDGET_ACTIONS = new Set(['create_widget', 'update_widget'])
// 白板执行器已在保存后刷新笔记。
const NOTE_REFRESH_ACTIONS = new Set(['create_note', 'edit_note', 'edit_notes'])
const TODO_REFRESH_ACTIONS = new Set(['create_todo', 'create_todos'])
// 单篇笔记类动作：完成后卡片可以直接“查看”结果
const SINGLE_NOTE_ACTIONS = new Set(['create_note', 'edit_note', 'create_whiteboard', 'update_whiteboard'])

const pickResultNoteId = (name, result) => {
  if (!SINGLE_NOTE_ACTIONS.has(name)) return null
  const id = result?.noteId ?? result?.result?.id ?? result?.result?.noteId ?? null
  return id == null ? null : id
}

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

const executeWidgetAction = async (action) => {
  const claim = await window.electronAPI?.ai?.consumePendingAction?.(action.actionId, buildFallback(action))
  if (!claim?.success) {
    throw new Error(claim?.error || '待确认操作不存在或已过期')
  }
  const args = claim.action?.args || action.args || {}
  const report = (progress) => useWidgetActionProgress.getState().report(action.actionId, progress)
  const isUpdate = action.name === 'update_widget'

  let previewInstanceId = args.instance_id || null
  let instanceCount = 0
  if (isUpdate) {
    const list = await window.electronAPI.widgets.instances(args.id)
    if (!list?.success) throw new Error(list?.error || '组件不存在')
    instanceCount = list.data.length
    if (!previewInstanceId || !list.data.some((item) => item.id === previewInstanceId)) previewInstanceId = list.data[0]?.id || null
  }

  const result = await runWidgetGeneration({
    instruction: args.instruction || '',
    widgetId: isUpdate ? args.id : undefined,
    instanceId: previewInstanceId || undefined,
    instanceName: args.instance_name,
    onProgress: report,
  })
  useWidgetActionProgress.getState().clear(action.actionId)

  const widgetName = result.widget?.name || '组件'
  const resultData = {
    mode: isUpdate ? 'update' : 'create',
    widgetId: result.widget?.id,
    widgetName,
    instanceId: isUpdate ? previewInstanceId : result.instance?.id,
    instanceCount,
    version: result.version,
    previousVersion: result.previousVersion,
    fixedRounds: result.fixedRounds,
    remainingProblems: (result.remainingProblems || []).map((problem) => problem.message).slice(0, 3),
  }
  const message = isUpdate
    ? `已修改组件「${widgetName}」${instanceCount > 1 ? `，${instanceCount} 个实例都已生效` : ''}`
    : `已生成组件「${widgetName}」，已固定到侧边栏`
  return { success: true, message, action: claim.action || action, resultData }
}

/**
 * 执行一个待确认动作。
 * @param {object} params
 * @param {object} params.action  待确认动作（需含 actionId/name）
 * @param {object|null} params.overrides  执行时覆盖参数（如 create_todos 勾选后的 todos）
 * @param {object} params.deps  执行所需能力：currentNote/notes/createNote/deleteNote/updateNote/loadNotes/setSelectedNoteId
 * @returns {Promise<{success:boolean, message:string, error?:string, finalAction:object, resultNoteId?:any, reloadNotes:boolean, reloadTodos:boolean}>}
 */
export const runPendingAction = async ({ action, overrides = null, deps = {} }) => {
  // validate pending
  if (!action?.actionId) {
    return { success: false, error: '待确认操作无效', finalAction: action, message: '', reloadNotes: false, reloadTodos: false }
  }

  try {
    const result = WHITEBOARD_ACTIONS.has(action.name)
      ? await executeWhiteboardAction(action, overrides, deps)
      : WIDGET_ACTIONS.has(action.name)
        ? await executeWidgetAction(action)
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
      resultNoteId: success ? pickResultNoteId(finalAction.name, result) : null,
      resultData: success ? (result?.resultData || null) : null,
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
