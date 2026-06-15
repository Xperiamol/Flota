const { ipcMain, shell, app } = require('electron')
const fs = require('fs')
const path = require('path')

const SIMPLE = {
  'plugin-store:list-available':  { method: 'listAvailablePlugins',  fallback: [] },
  'plugin-store:list-installed':  { method: 'listInstalledPlugins',  fallback: [] },
  'plugin-store:scan-local':      { method: 'scanLocalPlugins',      fallback: [] },
  'plugin-store:get-details':     { method: 'getPluginDetails',      fallback: null },
  'plugin-store:install':         { method: 'installPlugin',         wrap: true },
  'plugin-store:uninstall':       { method: 'uninstallPlugin',       wrap: true, noData: true },
  'plugin-store:enable':          { method: 'enablePlugin',          wrap: true },
  'plugin-store:disable':         { method: 'disablePlugin',         wrap: true },
  'plugin-store:execute-command': { method: 'executeCommand',        wrap: true },
}

const registerPluginStoreHandlers = (ensurePluginManager, validateRelativePath) => {
  for (const [channel, cfg] of Object.entries(SIMPLE)) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const manager = ensurePluginManager()
        const result = await manager[cfg.method](...args)
        return cfg.wrap ? { success: true, ...(cfg.noData ? {} : { data: result }) } : result
      } catch (error) {
        console.error(`${channel} 失败:`, error)
        return cfg.wrap ? { success: false, error: error.message } : cfg.fallback
      }
    })
  }

  ipcMain.handle('plugin-store:open-plugin-folder', async (event, pluginId) => {
    try {
      const manager = ensurePluginManager()
      const pluginPath = manager.getPluginPath(pluginId)
      if (!pluginPath) return { success: false, error: '插件未安装' }
      await shell.openPath(pluginPath)
      return { success: true }
    } catch (error) {
      console.error('打开插件目录失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('plugin-store:open-plugins-directory', async () => {
    try {
      const isDev = process.env.NODE_ENV === 'development'
      const localPluginsPath = isDev
        ? path.join(app.getAppPath(), 'plugins', 'examples')
        : path.join(process.resourcesPath, 'plugins', 'examples')
      await shell.openPath(localPluginsPath)
      return { success: true }
    } catch (error) {
      console.error('打开插件目录失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('plugin-store:load-plugin-file', async (event, pluginId, filePath) => {
    try {
      const manager = ensurePluginManager()
      const pluginPath = manager.getPluginPath(pluginId)
      if (!pluginPath) return { success: false, error: '插件未安装' }

      const safeSub = validateRelativePath(filePath.replace(/^\//, ''))
      const fullPath = path.join(pluginPath, safeSub)
      if (!fullPath.startsWith(path.resolve(pluginPath))) {
        return { success: false, error: '路径不合法' }
      }
      if (!fs.existsSync(fullPath)) return { success: false, error: '文件不存在' }

      const content = fs.readFileSync(fullPath, 'utf8')
      return { success: true, content, baseUrl: `file://${pluginPath}/` }
    } catch (error) {
      console.error(`读取插件文件失败: ${pluginId}/${filePath}`, error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerPluginStoreHandlers }
