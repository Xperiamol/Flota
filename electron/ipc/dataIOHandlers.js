const { registerIpcHandlers, createServicePassthroughHandler } = require('./helpers')

const DATA_PASSTHROUGH = {
  'data:export-notes': 'exportNotes',
  'data:export-settings': 'exportSettings',
  'data:import-notes': 'importNotes',
  'data:import-settings': 'importSettings',
  'data:import-folder': 'importFolder',
  'data:get-supported-formats': 'getSupportedFormats',
  'data:get-stats': 'getStats',
  'data:select-file': 'selectFile'
}

const wrap = (fn, errorMsg) => async (...args) => {
  try {
    return await fn(...args)
  } catch (error) {
    console.error(`${errorMsg}:`, error)
    return { success: false, error: error.message }
  }
}

const registerDataIOHandlers = (services) => {
  registerIpcHandlers(
    Object.entries(DATA_PASSTHROUGH).map(([channel, methodName]) => ({
      channel,
      handler: createServicePassthroughHandler(() => services.dataImportService, methodName)
    }))
  )

  registerIpcHandlers([
    {
      channel: 'data:import-obsidian-vault',
      handler: wrap(
        async (event, options) => services.dataImportService.importObsidianVault(options),
        '导入 Obsidian vault 失败'
      )
    },
    {
      channel: 'data:export-to-obsidian',
      handler: wrap(
        async (event, options) => services.dataImportService.exportToObsidian(options),
        '导出到 Obsidian 失败'
      )
    },
    {
      channel: 'data:get-importer-config',
      handler: wrap(
        async (event, importerName) => ({
          success: true,
          data: services.dataImportService.getImporterConfig(importerName)
        }),
        '获取导入器配置失败'
      )
    },
    {
      channel: 'data:update-importer-config',
      handler: wrap(
        async (event, { importerName, config }) => {
          const success = services.dataImportService.updateImporterConfig(importerName, config)
          return { success, data: success }
        },
        '更新导入器配置失败'
      )
    },
    {
      channel: 'data:get-exporter-config',
      handler: wrap(
        async (event, exporterName) => ({
          success: true,
          data: services.dataImportService.getExporterConfig(exporterName)
        }),
        '获取导出器配置失败'
      )
    },
    {
      channel: 'data:update-exporter-config',
      handler: wrap(
        async (event, { exporterName, config }) => {
          const success = services.dataImportService.updateExporterConfig(exporterName, config)
          return { success, data: success }
        },
        '更新导出器配置失败'
      )
    },
    {
      channel: 'data:get-available-importers-exporters',
      handler: wrap(
        async () => ({
          success: true,
          data: services.dataImportService.getAvailableImportersAndExporters()
        }),
        '获取可用导入导出器失败'
      )
    }
  ])
}

module.exports = { registerDataIOHandlers }
