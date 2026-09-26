const { ipcMain, dialog, shell, BrowserWindow, clipboard } = require('electron')
const { SUPPORTED_EXTENSIONS } = require('../services/ExternalFileService')

const wrap = (fn) => (...args) => {
  try {
    return { success: true, data: fn(...args) }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// 外部文件窗口：只允许读写由系统或打开对话框登记过的路径
const registerExternalFileHandlers = ({ externalFileService, getMainWindow }) => {
  ipcMain.handle('external-file:read', wrap((_event, filePath) => externalFileService.read(filePath)))

  ipcMain.handle('external-file:render', wrap((_event, filePath, text) => externalFileService.render(filePath, text)))

  ipcMain.handle('external-file:write', wrap((_event, filePath, text, options) => (
    externalFileService.write(filePath, text, options)
  )))

  ipcMain.handle('external-file:write-whiteboard', wrap((_event, filePath, scene, options) => (
    externalFileService.writeWhiteboard(filePath, scene, options)
  )))

  // 选中的文件各自在独立窗口中打开
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
    const opened = result.filePaths.filter((filePath) => externalFileService.open(filePath))
    return { success: true, data: opened }
  })

  ipcMain.handle('external-file:reveal', (_event, filePath) => {
    if (!externalFileService.isAllowed(filePath)) return { success: false, error: '无权访问该文件' }
    shell.showItemInFolder(filePath)
    return { success: true }
  })

  // 剪贴板走主进程：多窗口时 navigator.clipboard 要求文档聚焦，容易失败
  ipcMain.handle('external-file:copy-text', wrap((_event, text) => {
    clipboard.writeText(String(text ?? ''))
    return true
  }))

  ipcMain.handle('external-file:read-clipboard', wrap(() => clipboard.readText()))

  // 导入为笔记后，在主窗口中打开这条笔记
  ipcMain.handle('external-file:show-note', (_event, noteId) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return { success: false, error: '主窗口不可用' }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('app-menu:command', { command: 'open-note', payload: noteId })
    return { success: true }
  })
}

module.exports = { registerExternalFileHandlers }
