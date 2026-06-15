const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')
const { getInstance: getImageStorageInstance } = require('../services/ImageStorageService')

const SIMPLE = {
  'whiteboard:load-images':       { method: 'loadWhiteboardImages' },
  'whiteboard:load-image':        { method: 'loadWhiteboardImage' },
  'whiteboard:delete-images':     { method: 'deleteWhiteboardImages', noData: true },
  'whiteboard:get-storage-stats': { method: 'getStorageStats' },
}

const registerWhiteboardHandlers = () => {
  ipcMain.handle('whiteboard:save-images', async (event, files) => {
    try {
      const imageStorage = getImageStorageInstance()
      const fileMap = await imageStorage.saveWhiteboardImages(files)

      try {
        const { getInstance: getV3SyncService } = require('../services/sync/V3SyncService')
        const v3Service = getV3SyncService()
        if (v3Service && v3Service.isEnabled && v3Service.uploadImage) {
          const uploadPromises = Object.entries(fileMap).map(async ([fileId, fileInfo]) => {
            try {
              const localPath = path.join(
                app.getPath('userData'),
                'images',
                'whiteboard',
                fileInfo.fileName
              )
              const relativePath = `images/whiteboard/${fileInfo.fileName}`
              await v3Service.uploadImage(localPath, relativePath)
              console.log(`[图片自动上传] 成功: ${fileInfo.fileName}`)
            } catch (error) {
              console.error(`[图片自动上传] 失败: ${fileInfo.fileName}`, error)
            }
          })
          Promise.all(uploadPromises).catch(err =>
            console.error('[图片自动上传] 批量上传出错:', err)
          )
        }
      } catch (error) {
        console.error('[图片自动上传] 初始化失败:', error)
      }

      return { success: true, data: fileMap }
    } catch (error) {
      console.error('保存画布图片失败:', error)
      return { success: false, error: error.message }
    }
  })

  for (const [channel, cfg] of Object.entries(SIMPLE)) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const imageStorage = getImageStorageInstance()
        const result = await imageStorage[cfg.method](...args)
        return cfg.noData ? { success: true } : { success: true, data: result }
      } catch (error) {
        console.error(`${channel} 失败:`, error)
        return { success: false, error: error.message }
      }
    })
  }

  ipcMain.handle('whiteboard:save-preview', async (event, { syncId, pngBase64 }) => {
    try {
      if (!syncId || !pngBase64) return { success: false, error: '参数缺失' }
      const previewDir = path.join(app.getPath('userData'), 'images', 'whiteboard-preview')
      await fs.promises.mkdir(previewDir, { recursive: true })
      const filePath = path.join(previewDir, `${syncId}.png`)
      const buffer = Buffer.from(pngBase64, 'base64')
      await fs.promises.writeFile(filePath, buffer)

      try {
        const { getInstance: getV3SyncService } = require('../services/sync/V3SyncService')
        const v3Service = getV3SyncService()
        if (v3Service && v3Service.isEnabled && v3Service.uploadImage) {
          const relativePath = `images/whiteboard-preview/${syncId}.png`
          v3Service.uploadImage(filePath, relativePath).catch(err =>
            console.error('[画布预览上传] 失败:', err)
          )
        }
      } catch (_) { /* 不阻塞 */ }

      return { success: true }
    } catch (error) {
      console.error('保存画布预览图失败:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerWhiteboardHandlers }
