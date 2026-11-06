import { useCallback, useMemo } from 'react'
import { runPendingAction } from '../utils/aiCore/pendingActionExecutor'
import { notifyAINotesUpdated } from '../utils/aiCore/noteRefresh'
import { notifyError } from '../utils/notify'

// 确认卡的执行。卡片状态由主进程的会话服务维护（所有窗口同步）：
//   beginAction：只有待确认 / 失败 / 已停止的卡能开始，同一张卡在多个窗口里只会被执行一次
//   runPendingAction：在渲染层执行（画布、组件等需要渲染层能力）
//   finishAction：写回结果，成功时追加结果消息并记进完整记录
// 返回 { execute, dismiss, restore }。
export default function usePendingActionExecution({ conversationIdRef, deps, onTodoUpdated }) {
  const execute = useCallback(async (action, overrides = null) => {
    const session = window.electronAPI?.ai?.session
    const conversationId = conversationIdRef.current
    if (!session || !conversationId || !action?.actionId) return
    const begin = await session.beginAction(conversationId, action.actionId)
    if (!begin?.success) return

    let result
    try {
      result = await runPendingAction({ action: begin.action, overrides, deps })
    } catch (error) {
      result = { success: false, error: error.message, message: `操作失败：${error.message}` }
    }
    const { success, cancelled, message, error, resultNoteId, resultData } = result || {}
    const saved = await session.finishAction(conversationId, action.actionId, { success, cancelled, message, error, resultNoteId, resultData })
    if (saved?.success === false) notifyError(`保存执行结果失败：${saved.error || '未知原因'}`)
    if (result?.reloadTodos) onTodoUpdated?.()
    if (result?.reloadNotes) {
      await deps.loadNotes?.()
      notifyAINotesUpdated(result.finalAction)
    }
  }, [conversationIdRef, deps, onTodoUpdated])

  const dismiss = useCallback((action) => {
    const conversationId = conversationIdRef.current
    if (conversationId && action?.actionId) window.electronAPI?.ai?.session?.dismissAction(conversationId, action.actionId)
  }, [conversationIdRef])

  const restore = useCallback((action) => {
    const conversationId = conversationIdRef.current
    if (conversationId && action?.actionId) window.electronAPI?.ai?.session?.restoreAction(conversationId, action.actionId)
  }, [conversationIdRef])

  return useMemo(() => ({ execute, dismiss, restore }), [execute, dismiss, restore])
}
