const { ipcMain, dialog, shell, BrowserWindow } = require('electron')
const { SUPPORTED_EXTENSIONS } = require('../services/ExternalFileService')

// 外部文件查看：只允许读取由系统或打开对话框登记过的路径
const registerExternalFileHandlers = ({ externalFileService, getMainWindow }) => {
  ipcMain.handle('external-file:consume-pending', () => ({
    success: true,
    data: externalFileService.consumePending()
  }))

  ipcMain.handle('external-file:read', (_event, filePath) => {
    try {
      return { success: true, data: externalFileService.read(filePath) }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('external-file:show-open-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    const result = await dialog.showOpenDialog(win, {
      title: '打开文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件', extensions: SUPPORTED_EXTENSIONS },
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: '纯文本', extensions: ['txt', 'text'] },
        { name: 'Excalidraw 白板', extensions: ['excalidraw'] }
      ]
    })
    if (result.canceled) return { success: true, data: [] }
    const opened = result.filePaths.map((filePath) => externalFileService.allow(filePath)).filter(Boolean)
    return { success: true, data: opened }
  })

  ipcMain.handle('external-file:reveal', (_event, filePath) => {
    if (!externalFileService.isAllowed(filePath)) return { success: false, error: '无权访问该文件' }
    shell.showItemInFolder(filePath)
    return { success: true }
  })
}

module.exports = { registerExternalFileHandlers }
