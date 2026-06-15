const { registerIpcHandlers, createServicePassthroughHandler } = require('./helpers')

const SETTING_PASSTHROUGH = {
  'setting:get': 'getSetting',
  'setting:get-multiple': 'getSettings',
  'setting:get-all': 'getAllSettings',
  'setting:get-by-type': 'getSettingsByType',
  'setting:get-theme': 'getThemeSettings',
  'setting:get-window': 'getWindowSettings',
  'setting:get-editor': 'getEditorSettings',
  'setting:set-multiple': 'setSettings',
  'setting:delete': 'deleteSetting',
  'setting:delete-multiple': 'deleteMultipleSettings',
  'setting:reset-all': 'resetToDefaults',
  'setting:search': 'searchSettings',
  'setting:get-stats': 'getSettingsStats',
  'setting:export': 'exportSettings',
  'setting:import': 'importSettings',
  'setting:select-wallpaper': 'selectWallpaper'
}

const inferType = (value) => {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object' && value !== null) return 'object'
  return 'string'
}

const registerSettingHandlers = (services) => {
  registerIpcHandlers([
    ...Object.entries(SETTING_PASSTHROUGH).map(([channel, methodName]) => ({
      channel,
      handler: createServicePassthroughHandler(() => services.settingsService, methodName)
    })),
    {
      channel: 'setting:set',
      handler: async (event, key, value) =>
        services.settingsService.setSetting(key, value, inferType(value))
    }
  ])
}

module.exports = { registerSettingHandlers }
