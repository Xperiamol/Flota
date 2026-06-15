const { ipcMain, app, shell } = require('electron')
const DatabaseManager = require('../dao/DatabaseManager')

const registerSystemMiscHandlers = (services, getLogger) => {
  // db
  ipcMain.handle('db:get-info', async () => {
    try {
      return DatabaseManager.getInstance().getInfo()
    } catch (err) {
      return { error: err?.message || 'unknown error' }
    }
  })

  ipcMain.handle('db:repair', async () => {
    try {
      return await DatabaseManager.getInstance().repairDatabase()
    } catch (err) {
      getLogger().error('Main', '数据库修复失败', err)
      return { success: false, error: err?.message || 'unknown error' }
    }
  })

  // log
  ipcMain.handle('log:open-dir', async () => {
    const logPath = getLogger().getLogPath()
    await shell.openPath(logPath)
    return { success: true, path: logPath }
  })

  // setting auto-launch
  ipcMain.handle('setting:set-auto-launch', async (event, enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
      await services.settingsService.setSetting('autoLaunch', enabled, 'boolean', '开机自启')
      return { success: true }
    } catch (error) {
      console.error('设置开机自启失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('setting:get-auto-launch', async () => {
    try {
      return app.getLoginItemSettings().openAtLogin
    } catch (error) {
      console.error('获取开机自启状态失败:', error)
      return false
    }
  })

  // proxy
  ipcMain.handle('proxy:get-config', async () => ({ success: true, data: services.proxyService.getConfig() }))
  ipcMain.handle('proxy:save-config', async (event, config) => services.proxyService.saveConfig(config))
  ipcMain.handle('proxy:test', async (event, config) => services.proxyService.testConnection(config))

  // backup
  ipcMain.handle('backup:create', async () => services.backupService.createBackup())
  ipcMain.handle('backup:restore', async () => services.backupService.restoreBackup())

  // network
  ipcMain.handle('network:is-online', () => services.networkService ? services.networkService.isOnline : true)
  ipcMain.handle('network:get-offline-queue-length', () => services.offlineSyncQueue ? services.offlineSyncQueue.length : 0)
}

module.exports = { registerSystemMiscHandlers }
