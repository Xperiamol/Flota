import { create } from 'zustand'
import { persist } from 'zustand/middleware'
// 先初始化首页布局，让它在这里改写存储前拿到旧的个人中心组件列表
import './useHomeStore'

/**
 * 组件（小应用）在渲染层的状态。
 * - widgets：全部组件（含是否固定到侧边栏），来自主进程，变化时自动刷新
 * - dismissedIntros：已关闭说明横幅的组件（本地保存，点“帮助”可重新查看）
 */
export const useWidgetStore = create(
  persist(
    (set, get) => ({
      widgets: [],
      loaded: false,
      // 组件主页当前打开的实例：{ [widgetId]: instanceId | null }，null 表示显示实例列表
      activeInstance: {},
      setActiveInstance: (widgetId, instanceId) => set((state) => ({ activeInstance: { ...state.activeInstance, [widgetId]: instanceId || null } })),
      dismissedIntros: [],

      loadWidgets: async () => {
        const result = await window.electronAPI?.widgets?.list()
        if (result?.success) set({ widgets: result.data, loaded: true })
        return result?.success ? result.data : []
      },

      setPinned: async (widgetId, pinned) => {
        // 先乐观更新，侧边栏立即响应
        set((state) => ({ widgets: state.widgets.map((w) => (w.id === widgetId ? { ...w, pinned } : w)) }))
        await window.electronAPI.widgets.setPinned(widgetId, pinned)
      },

      isIntroDismissed: (widgetId) => get().dismissedIntros.includes(widgetId),
      setIntroDismissed: (widgetId, dismissed) => set((state) => ({
        dismissedIntros: dismissed
          ? [...new Set([...state.dismissedIntros, widgetId])]
          : state.dismissedIntros.filter((id) => id !== widgetId),
      })),
    }),
    {
      name: 'Flota-widgets',
      partialize: (state) => ({ dismissedIntros: state.dismissedIntros }),
    }
  )
)

let subscribed = false

/** 首次调用时加载组件列表，并订阅主进程的变更通知 */
export const ensureWidgetsLoaded = () => {
  if (subscribed) return
  subscribed = true
  useWidgetStore.getState().loadWidgets()
  window.electronAPI?.widgets?.onListChanged?.(() => useWidgetStore.getState().loadWidgets())
  window.electronAPI?.sync?.onSyncComplete?.(() => useWidgetStore.getState().loadWidgets())
}

/** 组件主页的视图 id：侧边栏入口与主区域路由共用 */
export const widgetViewId = (widgetId) => `widget:${widgetId}`
export const parseWidgetViewId = (view) => (typeof view === 'string' && view.startsWith('widget:') ? view.slice('widget:'.length) : null)

/** 打开组件主页；传入实例 id 时直接进入该实例 */
export const openWidgetHome = (widgetId, instanceId = null) => {
  useWidgetStore.getState().setActiveInstance(widgetId, instanceId)
  import('./useStore').then(({ useStore }) => useStore.getState().setCurrentView(widgetViewId(widgetId)))
}

/** 通过实例 id 打开它所属组件的主页并进入该实例 */
export const openWidgetInstance = async (instanceId) => {
  const result = await window.electronAPI?.widgets?.getInstance(instanceId)
  if (result?.success) openWidgetHome(result.data.widget.id, instanceId)
  return Boolean(result?.success)
}
