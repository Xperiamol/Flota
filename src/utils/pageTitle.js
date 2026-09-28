import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { useWidgetStore, parseWidgetViewId } from '../store/useWidgetStore'
import { usePluginViewByNavId } from '../store/usePluginViews'
import { SETTINGS_CATEGORY_NAMES } from '../components/settings/settingsCategories'

const VIEW_TITLES = {
  notes: '笔记',
  todo: '待办',
  calendar: '日历',
  timeline: '时间轴',
  profile: '首页',
  ai: 'FlotaAI',
}

/**
 * 当前页面的名字：标题栏和窗口标题都用它。
 * 规则：有名字的页面就显示它自己的名字（回收站、设置里的具体分类、插件页面、组件页面……），
 * 以后新增页面在这里补上名字，不要显示成笼统的「Flota」。
 */
export function usePageTitle() {
  const { currentView, trashOpen, settingsTab, storeType } = useStore(useShallow((state) => ({
    currentView: state.currentView,
    trashOpen: state.noteTrashOpen,
    settingsTab: state.settingsTabValue,
    storeType: state.pluginStoreFilters?.type,
  })))
  const widgetName = useWidgetStore((state) => {
    const widgetId = parseWidgetViewId(currentView)
    return widgetId ? state.widgets.find((widget) => widget.id === widgetId)?.name || '组件' : null
  })
  const pluginView = usePluginViewByNavId(currentView)

  if (widgetName) return widgetName
  if (pluginView) return pluginView.title
  if (currentView === 'notes' && trashOpen) return '回收站'
  if (currentView === 'settings') {
    const name = SETTINGS_CATEGORY_NAMES[settingsTab]
    return name ? `设置 · ${name}` : '设置'
  }
  if (currentView === 'plugins') return storeType === 'widget' ? '组件' : '插件'
  return VIEW_TITLES[currentView] || 'Flota'
}

/** 同步窗口标题（Dock、任务栏、窗口菜单里显示） */
export function useSyncDocumentTitle(title) {
  useEffect(() => {
    document.title = title && title !== 'Flota' ? `${title} - Flota` : 'Flota'
  }, [title])
}
