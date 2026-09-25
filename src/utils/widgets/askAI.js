import { useStore } from '../../store/useStore'

/**
 * 把请求交给用户熟悉的 AI 小窗（AI 小窗关闭时使用 AI 页面），不另开窗口。
 * @param {string} prompt 预填或直接发送的内容
 * @param {object} [options]
 * @param {boolean} [options.autoSend=false] 直接发送；否则只预填，等用户补充后发送
 */
export const askAI = (prompt, { autoSend = false } = {}) => {
  const state = useStore.getState()
  if (state.aiCommandCenterEnabled) state.setAiCommandCenterOpen(true)
  else state.setCurrentView('ai')
  state.aiDispatchCommand(prompt, { autoSend })
}

/** 打开 AI 小窗（AI 小窗关闭时进入 AI 页面），不预填内容 */
export const openAI = () => {
  const state = useStore.getState()
  if (state.aiCommandCenterEnabled) state.setAiCommandCenterOpen(true)
  else state.setCurrentView('ai')
}

export const askAIToCreateWidget = () => askAI('帮我做一个组件：')

export const askAIToModifyWidget = (widget, instanceId) => askAI(
  `修改组件「${widget.name}」（组件 ID：${widget.id}${instanceId ? `，预览用实例 ID：${instanceId}` : ''}）：`
)

export const askAIToFixWidget = (widget, instanceId, errors = []) => askAI([
  `组件「${widget.name}」（组件 ID：${widget.id}，实例 ID：${instanceId}）运行时出错了，请修复：`,
  ...errors.slice(0, 5).map((error, index) => `${index + 1}. ${error.message}${error.stack ? `\n${String(error.stack).split('\n').slice(0, 3).join('\n')}` : ''}`),
].join('\n'), { autoSend: true })
