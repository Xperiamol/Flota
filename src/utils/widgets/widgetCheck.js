// 主进程在对话智能体提交组件代码时调用（window.__flotaWidgetCheck）：在沙箱里按声明的每个尺寸、
// 浅色深色各预跑一次草稿，返回问题列表（空数组表示通过）。只预跑，不保存。
import { probeAllSizes } from './widgetGeneration'

export const checkWidgetDraft = async ({ draftId, sizes } = {}) => {
  if (!draftId) return [{ message: '缺少组件草稿', fatal: true }]
  return probeAllSizes(draftId, sizes)
}
