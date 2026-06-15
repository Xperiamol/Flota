import { useEffect, useState } from 'react'
import { fetchInstalledPlugins, subscribePluginEvents } from '../api/pluginAPI'

/**
 * 订阅插件启用状态。
 * 已安装且 enabled === true 才返回 true；卸载/禁用/未装 都返回 false。
 * 通过 pluginStore.onEvent 实时刷新。
 */
export const usePluginEnabled = (pluginId) => {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const list = await fetchInstalledPlugins()
        if (!mounted) return
        const found = (list || []).find((p) => p.id === pluginId)
        setEnabled(Boolean(found && found.enabled))
      } catch (_) {
        if (mounted) setEnabled(false)
      }
    }
    refresh()
    const off = subscribePluginEvents((event) => {
      if (!event || event.pluginId !== pluginId) return
      if (['enabled', 'disabled', 'installed', 'uninstalled', 'ready', 'stopped', 'error'].includes(event.type)) {
        refresh()
      }
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [pluginId])

  return enabled
}

export default usePluginEnabled
