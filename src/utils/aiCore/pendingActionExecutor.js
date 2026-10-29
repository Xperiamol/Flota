import { applyAISettings } from './appSettings'
import { createGenerationTask } from './generationTask'
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
import { ensureActionProgressSubscription, useActionSteps } from './actionProgress'

const WHITEBOARD_ACTIONS = new Set(['create_whiteboard', 'update_whiteboard'])
// 组件生成 / 修改：在渲染层执行（生成 → 沙箱预跑 → 自动修复 → 保存），进度显示在确认卡片里
const WIDGET_ACTIONS = new Set(['create_widget', 'update_widget'])
// 白板执行器已在保存后刷新笔记。
const NOTE_REFRESH_ACTIONS = new Set(['create_note', 'edit_note', 'edit_notes'])
const TODO_REFRESH_ACTIONS = new Set(['create_todo', 'create_todos'])
// 单篇笔记类动作：完成后卡片可以直接“查看”结果
const SINGLE_NOTE_ACTIONS = new Set(['create_note', 'edit_note', 'create_whiteboard', 'update_whiteboard'])
const NOTE_CONTENT_ACTIONS = new Set(['edit_note', 'edit_notes'])

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

const executeWhiteboardAction = async (action, overrides, deps, task) => {
  const claim = await window.electronAPI?.ai?.consumePendingAction?.(action.actionId, buildFallback(action))
  if (!claim?.success) {
    throw new Error(claim?.error || '待确认操作不存在或已过期')
  }
  task?.throwIfCancelled()
  const claimedArgs = { ...(claim.action?.args || action.args || {}), ...(overrides || {}) }
  const actionContext = claim.action?.context || action.context || null
  if (task) task.referenceImages = actionContext?.referenceImages || []

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
      task,
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
    task,
  })
}

// 用户在卡片上选的设计方向（AI 给出 design_options 时）；没有选择时用上次的或第一个
const pickDesignOption = (args, action, overrides) => {
  const options = Array.isArray(args.design_options) ? args.design_options.filter((option) => option && typeof option.title === 'string').slice(0, 3) : []
  if (options.length < 2) return { index: null, option: null }
  const requested = Number.isInteger(overrides?.design_option) ? overrides.design_option : action.resultData?.designOption
  const index = Math.min(Math.max(Number.isInteger(requested) ? requested : 0, 0), options.length - 1)
  return { index, option: options[index] }
}

const executeWidgetAction = async (action, task, overrides) => {
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

  const design = pickDesignOption(args, action, overrides)
  const instruction = design.option
    ? `${args.instruction || ''}\n\n用户选定的设计方向：${design.option.title}——${design.option.summary || ''}`
    : (args.instruction || '')
  // 换了设计方向就从头生成，不再修补上一个方向留下的草稿
  const sameDirection = (action.resultData?.designOption ?? null) === design.index
  let result
  try {
    result = await runWidgetGeneration({
      instruction,
      referenceImages: (claim.action?.context || action.context)?.referenceImages || [],
      widgetId: isUpdate ? args.id : undefined,
      instanceId: previewInstanceId || undefined,
      instanceName: args.instance_name,
      onProgress: report,
      task,
      initialDraftId: sameDirection ? action.resultData?.draftId || null : null,
      initialErrors: sameDirection ? action.resultData?.problems || null : null,
    })
  } catch (error) {
    if (design.index !== null) error.designOption = design.index
    throw error
  }
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
    ...(design.index !== null ? { designOption: design.index } : {}),
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

  // 长文写作等耗时动作：执行期间接收主进程推来的步骤进度，卡片上实时显示
  ensureActionProgressSubscription()
  let task
  try {
    // AI 改笔记前先把编辑器里还没落盘的输入保存下来：修改基于数据库里的最新正文，
    // 载入编辑器时也不会丢掉刚刚输入、尚未自动保存的文字。
    if (NOTE_CONTENT_ACTIONS.has(action.name) || (TODO_REFRESH_ACTIONS.has(action.name) && action.args?.embed_in_note)) {
      try {
        await window.__flushEditorSaves?.()
      } catch (error) {
        return { success: false, error: `当前笔记有未保存的修改且保存失败，已暂停 AI 修改：${error.message}`, finalAction: action, message: '', reloadNotes: false, reloadTodos: false }
      }
    }
    if (WHITEBOARD_ACTIONS.has(action.name) || WIDGET_ACTIONS.has(action.name)) task = createGenerationTask(action.actionId)
    const result = WHITEBOARD_ACTIONS.has(action.name)
      ? await executeWhiteboardAction(action, overrides, deps, task)
      : WIDGET_ACTIONS.has(action.name)
        ? await executeWidgetAction(action, task, overrides)
        : await window.electronAPI?.ai?.executePendingAction?.(action.actionId, overrides, buildFallback(action))
    if (result?.success && action.name === 'update_settings') {
      await applyAISettings(result.result.settingsChanges)
      result.message = result.result.message
    }
    // 步骤进度只在执行期间显示，完成后由结果卡片接管
    useActionSteps.getState().clear(action.actionId)

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
      reloadNotes: success && (NOTE_REFRESH_ACTIONS.has(finalAction.name) || (TODO_REFRESH_ACTIONS.has(finalAction.name) && Boolean(finalAction.args?.embed_in_note))),
      reloadTodos: success && TODO_REFRESH_ACTIONS.has(finalAction.name),
    }
  } catch (error) {
    return {
      success: false,
      cancelled: task?.signal.aborted || error?.name === 'AbortError',
      message: task?.signal.aborted ? '已停止生成' : `操作失败：${error?.message || '未知错误'}`,
      error: error?.message || '未知错误',
      finalAction: action,
      resultData: error?.draftId || Number.isInteger(error?.designOption)
        ? {
          ...(error?.draftId ? { draftId: error.draftId, problems: error.problems || [{ message: error.message }] } : {}),
          ...(Number.isInteger(error?.designOption) ? { designOption: error.designOption } : {}),
        }
        : null,
      reloadNotes: false,
      reloadTodos: false,
    }
  } finally {
    task?.dispose()
    useWidgetActionProgress.getState().clear(action.actionId)
    useActionSteps.getState().clear(action.actionId)
  }
}

export default runPendingAction
