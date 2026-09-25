import { create } from 'zustand'

/**
 * AI 生成 / 修改组件的实时进度，按确认卡片的 actionId 区分。
 * stage：writing（编写）→ testing（预览检查）→ fixing（自动修复）→ saving（保存）
 */
export const useWidgetActionProgress = create((set) => ({
  byAction: {},
  report: (actionId, progress) => set((state) => ({
    byAction: { ...state.byAction, [actionId]: { ...(state.byAction[actionId] || {}), ...progress } },
  })),
  clear: (actionId) => set((state) => {
    const next = { ...state.byAction }
    delete next[actionId]
    return { byAction: next }
  }),
}))
