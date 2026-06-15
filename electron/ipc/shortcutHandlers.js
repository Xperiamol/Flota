const { registerIpcHandlers } = require('./helpers')

const registerShortcutHandlers = (getShortcutService) => {
  const wrap = (methodName, errorMsg) => async (event, ...args) => {
    try {
      const service = getShortcutService()
      if (!service) throw new Error('快捷键服务未初始化')
      const result = await service[methodName](...args)
      return { success: true, data: result }
    } catch (error) {
      console.error(`${errorMsg}:`, error)
      return { success: false, error: error.message }
    }
  }

  registerIpcHandlers([
    { channel: 'shortcut:update', handler: wrap('updateShortcut', '更新快捷键失败') },
    { channel: 'shortcut:reset', handler: wrap('resetShortcut', '重置快捷键失败') },
    { channel: 'shortcut:reset-all', handler: wrap('resetAllShortcuts', '重置所有快捷键失败') },
    { channel: 'shortcut:get-all', handler: wrap('getAllShortcuts', '获取快捷键配置失败') }
  ])
}

module.exports = { registerShortcutHandlers }
