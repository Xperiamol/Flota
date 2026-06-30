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
      // 仅本地落盘。上传交给 SyncEngine 增量同步（uploadNoteImages 带远端 exists 去重），
      // 避免每次保存都直传坚果云造成重复流量。
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
      // 仅本地落盘。上传交给 SyncEngine.syncWhiteboardPreview（带 previewHashes 内容去重），
      // 避免每次保存都直传坚果云、即使内容未变也重传造成重复流量。
      return { success: true }
    } catch (error) {
      console.error('保存画布预览图失败:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerWhiteboardHandlers }
