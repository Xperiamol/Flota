import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 笔记内位置书签（类阅读器）
// - 按 noteId 分组，每条书签记录正文锚点片段（anchorText）+ 展示标签（label）
// - 点击书签时用 anchorText 在正文里重新定位段落并跳转
// - 持久化到 localStorage（key: flota-bookmarks），跨重启保留；不参与跨设备同步

let seq = 0
const genId = () => `bm_${Date.now().toString(36)}_${(seq++).toString(36)}`

export const useBookmarks = create(
  persist(
    (set, get) => ({
      // { [noteId]: [{ id, label, anchorText, createdAt }] }
      bookmarks: {},

      getBookmarks: (noteId) => get().bookmarks[String(noteId)] || [],

      addBookmark: (noteId, { label, anchorText }) => {
        if (!noteId || !anchorText) return null
        const key = String(noteId)
        const bm = { id: genId(), label: label || anchorText, anchorText, createdAt: Date.now() }
        set((state) => {
          const list = state.bookmarks[key] || []
          // 同一锚点不重复添加
          if (list.some((b) => b.anchorText === anchorText)) return state
          return { bookmarks: { ...state.bookmarks, [key]: [...list, bm] } }
        })
        return bm
      },

      removeBookmark: (noteId, bmId) =>
        set((state) => {
          const key = String(noteId)
          const list = state.bookmarks[key]
          if (!list) return state
          const next = list.filter((b) => b.id !== bmId)
          const map = { ...state.bookmarks }
          if (next.length === 0) delete map[key]
          else map[key] = next
          return { bookmarks: map }
        }),

      clearNoteBookmarks: (noteId) =>
        set((state) => {
          const key = String(noteId)
          if (!state.bookmarks[key]) return state
          const map = { ...state.bookmarks }
          delete map[key]
          return { bookmarks: map }
        }),

      // 笔记被删除时清理对应书签
      cleanup: (validIds) =>
        set((state) => {
          const valid = new Set((validIds || []).map((x) => String(x)))
          const map = {}
          for (const k of Object.keys(state.bookmarks)) {
            if (valid.has(k)) map[k] = state.bookmarks[k]
          }
          return { bookmarks: map }
        }),
    }),
    {
      name: 'flota-bookmarks',
      partialize: (state) => ({ bookmarks: state.bookmarks }),
    }
  )
)
