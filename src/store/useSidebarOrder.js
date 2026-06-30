import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 最外层导航侧边栏按钮的用户自定义排序
// - order 是按 id 排好的数组（如 ['todo','notes','calendar',...]）
// - 渲染时按 order 里的下标排序；不在 order 里的新项（如新装插件视图）保持原有相对顺序并排到末尾
// - 持久化到 localStorage（key: flota-sidebar-order）

export const useSidebarOrder = create(
  persist(
    (set) => ({
      // 用户自定义的导航按钮 id 顺序，空数组表示沿用默认顺序
      order: [],

      setOrder: (ids) => set({ order: Array.isArray(ids) ? [...ids] : [] }),

      // 按当前可见顺序，把 sourceId 移动到 targetId 之前/之后
      reorder: (visibleIds, sourceId, targetId, placeAfter = false) => {
        if (!sourceId || sourceId === targetId) return
        const ids = [...visibleIds]
        const from = ids.indexOf(sourceId)
        if (from === -1) return
        ids.splice(from, 1)
        let to = ids.indexOf(targetId)
        if (to === -1) {
          set({ order: [...ids, sourceId] })
          return
        }
        if (placeAfter) to += 1
        ids.splice(to, 0, sourceId)
        set({ order: ids })
      },

      resetOrder: () => set({ order: [] }),
    }),
    {
      name: 'flota-sidebar-order',
      partialize: (state) => ({ order: state.order }),
    }
  )
)
