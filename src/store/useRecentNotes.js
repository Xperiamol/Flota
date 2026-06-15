import { create } from 'zustand'

// "最近笔记" 一级侧边栏的状态
// - 不限制数量
// - 稳定顺序：tab 语义，已打开的不重排
// - 记忆每条笔记的滚动百分比
// 不持久化到磁盘，刷新即重置

export const useRecentNotes = create((set, get) => ({
  // [{ id, openedAt, pinned, scrollPercent }]
  recents: [],

  visit: (noteId) => {
    if (!noteId) return
    set((state) => {
      const exists = state.recents.some((r) => r.id === noteId)
      if (exists) return state
      return {
        recents: [
          ...state.recents,
          { id: noteId, openedAt: Date.now(), pinned: false, scrollPercent: 0 }
        ]
      }
    })
  },

  togglePin: (noteId) =>
    set((state) => ({
      recents: state.recents.map((r) =>
        r.id === noteId ? { ...r, pinned: !r.pinned } : r
      )
    })),

  remove: (noteId) =>
    set((state) => ({
      recents: state.recents.filter((r) => r.id !== noteId)
    })),

  setScrollPercent: (noteId, percent) => {
    if (!noteId) return
    set((state) => {
      const idx = state.recents.findIndex((r) => r.id === noteId)
      if (idx < 0) return state
      const clamped = Math.max(0, Math.min(1, percent))
      // 避免每像素 setState
      if (Math.abs((state.recents[idx].scrollPercent || 0) - clamped) < 0.005) return state
      const next = state.recents.slice()
      next[idx] = { ...next[idx], scrollPercent: clamped }
      return { recents: next }
    })
  },

  cleanup: (validIds) => {
    const valid = new Set(validIds)
    set((state) => ({
      recents: state.recents.filter((r) => valid.has(r.id))
    }))
  }
}))
