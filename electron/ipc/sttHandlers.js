const { app } = require('electron')
const path = require('path')
const ipcHelpers = require('./helpers')
const { registerIpcHandlers } = ipcHelpers

const registerSttHandlers = (services) => {
  const tryCatch = (methodName, errorMsg) =>
    ipcHelpers.createTryCatchHandler(services, 'sttService', methodName, errorMsg)

  registerIpcHandlers([
    { channel: 'stt:get-config', handler: tryCatch('getConfig', '获取STT配置失败') },
    { channel: 'stt:save-config', handler: tryCatch('saveConfig', '保存STT配置失败') },
    { channel: 'stt:test-connection', handler: tryCatch('testConnection', '测试STT连接失败') },
    {
      channel: 'stt:transcribe',
      handler: async (event, { audioFile, options }) => {
        try {
          let resolvedFile = audioFile
          if (Array.isArray(audioFile)) {
            resolvedFile = Buffer.from(audioFile)
          } else if (audioFile && typeof audioFile === 'string' && !path.isAbsolute(audioFile)) {
            resolvedFile = path.join(app.getPath('userData'), audioFile)
          }
          return await services.sttService.transcribe(resolvedFile, options)
        } catch (error) {
          console.error('语音转文字失败:', error)
          return { success: false, error: error.message }
        }
      }
    }
  ])
}

module.exports = { registerSttHandlers }
