const { ipcMain, app, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { validateString } = require('../utils/ipcValidator')
const { registerIpcHandlers } = require('./helpers')

const registerMediaHandlers = (services) => {
  const imageHandler = (methodName, errorMsg, wrapData = true) => async (event, ...args) => {
    try {
      const result = await services.imageService[methodName](...args)
      return wrapData ? { success: true, data: result } : result
    } catch (error) {
      console.error(`${errorMsg}:`, error)
      return { success: false, error: error.message }
    }
  }

  registerIpcHandlers([
    {
      channel: 'image:save-from-buffer',
      handler: async (event, buffer, fileName) => {
        try {
          const imagePath = await services.imageService.saveImage(Buffer.from(buffer), fileName)
          return { success: true, data: imagePath }
        } catch (error) {
          console.error('保存图片失败:', error)
          return { success: false, error: error.message }
        }
      }
    },
    { channel: 'image:save-from-path', handler: imageHandler('saveImageFromPath', '从路径保存图片失败') }
  ])

  ipcMain.handle('image:select-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择图片',
        properties: ['openFile'],
        filters: [
          { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: '用户取消选择' }
      }
      const filePath = result.filePaths[0]
      const fileName = path.basename(filePath)
      if (!services.imageService.isSupportedImageType(fileName)) {
        return { success: false, error: '不支持的图片格式' }
      }
      const imagePath = await services.imageService.saveImageFromPath(filePath, fileName)
      return { success: true, data: { imagePath, fileName } }
    } catch (error) {
      console.error('选择图片失败:', error)
      return { success: false, error: error.message }
    }
  })

  registerIpcHandlers([
    {
      channel: 'image:get-path',
      handler: async (event, relativePath) => {
        try {
          const fullPath = services.imageService.getImagePath(relativePath)
          if (fs.existsSync(fullPath)) {
            return { success: true, data: fullPath }
          }
          return { success: false, error: '图片文件不存在' }
        } catch (error) {
          console.error('获取图片路径失败:', error)
          return { success: false, error: error.message }
        }
      }
    },
    { channel: 'image:get-base64', handler: imageHandler('getBase64', '获取图片base64失败') },
    { channel: 'image:delete', handler: imageHandler('deleteImage', '删除图片失败') }
  ])

  ipcMain.handle('audio:save-from-buffer', async (event, buffer, fileName) => {
    try {
      validateString(fileName, 'fileName')
      const audioDir = path.join(app.getPath('userData'), 'audio')
      if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true })
      const safeName = path.basename(fileName)
      if (safeName !== fileName && fileName.includes('..')) throw new Error('文件名不合法')
      const filePath = path.join(audioDir, safeName)
      fs.writeFileSync(filePath, Buffer.from(buffer))
      return { success: true, data: `audio/${safeName}` }
    } catch (error) {
      console.error('保存音频失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('audio:resolve-source', async (_event, source) => {
    try {
      validateString(source, '音频路径')
      if (/^(https?:|file:|data:audio)/i.test(source)) {
        return { success: true, data: source }
      }
      let relativePath = decodeURIComponent(source.replace(/^app:\/\//, '').replace(/^\/+/, ''))
      if (!relativePath.startsWith('audio/')) {
        relativePath = `audio/${path.basename(relativePath)}`
      }
      const normalized = path.normalize(relativePath)
      if (normalized.startsWith('..') || path.isAbsolute(normalized) || !normalized.startsWith(`audio${path.sep}`)) {
        return { success: false, error: '音频路径不合法' }
      }
      const fullPath = path.join(app.getPath('userData'), normalized)
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: '录音文件不存在' }
      }
      return { success: true, data: `app://${normalized.replace(/\\/g, '/')}` }
    } catch (error) {
      console.error('解析音频路径失败:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerMediaHandlers }
