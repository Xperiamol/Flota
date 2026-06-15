import { create } from 'zustand'
import { useEffect, useMemo } from 'react'
import React from 'react'
import { fetchInstalledPlugins, subscribePluginEvents } from '../api/pluginAPI'

const RELEVANT_EVENTS = new Set([
  'installed', 'uninstalled', 'enabled', 'disabled', 'ready', 'stopped', 'error', 'restarted'
])

const buildLazyComponent = (pluginId, viewModule) => {
  const url = `app://plugin/${pluginId}/${viewModule}`
  return React.lazy(async () => {
    const mod = await import(/* @vite-ignore */ url)
    const Component = mod?.default || mod
    if (typeof Component !== 'function' && typeof Component !== 'object') {
      throw new Error(`Plugin view module did not export a default component: ${url}`)
    }
    return { default: Component }
  })
}

const collectViews = (plugins) => {
  const views = {}
  for (const plugin of plugins || []) {
    if (!plugin || !plugin.enabled) continue
    const declared = plugin.manifest?.capabilities?.views
    if (!Array.isArray(declared)) continue
    for (const view of declared) {
      if (!view || !view.id || !view.viewModule) continue
      views[view.id] = {
        viewId: view.id,
        pluginId: plugin.id,
        title: view.title || view.id,
        tooltip: view.tooltip || view.title || view.id,
        icon: view.icon || null,
        surface: view.surface || 'main:view',
        navId: view.navId || view.id,
        modulePath: view.viewModule,
        lazyComponent: buildLazyComponent(plugin.id, view.viewModule)
      }
    }
  }
  return views
}

const usePluginViewsStore = create((set, get) => ({
  views: {},
  initialized: false,
  refresh: async () => {
    try {
      const list = await fetchInstalledPlugins()
      const next = collectViews(list)
      const prev = get().views
      const reused = {}
      let changed = false
      for (const [viewId, def] of Object.entries(next)) {
        const old = prev[viewId]
        if (old && old.pluginId === def.pluginId && old.modulePath === def.modulePath) {
          reused[viewId] = old
        } else {
          reused[viewId] = def
          changed = true
        }
      }
      if (Object.keys(prev).some((k) => !reused[k])) changed = true
      if (changed || !get().initialized) {
        set({ views: reused, initialized: true })
      }
    } catch (error) {
      console.warn('[PluginViews] refresh failed:', error)
      set({ initialized: true })
    }
  }
}))

let subscribed = false
const ensureSubscription = () => {
  if (subscribed) return
  subscribed = true
  usePluginViewsStore.getState().refresh()
  subscribePluginEvents((event) => {
    if (!event || !RELEVANT_EVENTS.has(event.type)) return
    usePluginViewsStore.getState().refresh()
  })
}

const selectViews = (state) => state.views

export const usePluginViewsBySurface = (surface) => {
  useEffect(() => { ensureSubscription() }, [])
  const views = usePluginViewsStore(selectViews)
  return useMemo(
    () => Object.values(views).filter((v) => v.surface === surface),
    [views, surface]
  )
}

export const usePluginViewByNavId = (navId) => {
  useEffect(() => { ensureSubscription() }, [])
  const views = usePluginViewsStore(selectViews)
  return useMemo(
    () => Object.values(views).find((v) => v.navId === navId) || null,
    [views, navId]
  )
}

export const refreshPluginViews = () => usePluginViewsStore.getState().refresh()

export default usePluginViewsStore
