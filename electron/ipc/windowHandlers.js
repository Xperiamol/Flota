const { ipcMain, BrowserWindow } = require('electron')

const getEventWindow = (event) => BrowserWindow.fromWebContents(event.sender)

const registerWindowHandlers = (windowManager) => {
  const handlers = {
    'window:ready': async () => {
      console.log('收到窗口准备就绪通知')
      return true
    },
    'window:get-init-data': async (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'window not found' }
        for (const [id, w] of windowManager.windows) {
          if (w === win) {
            const data = windowManager.pendingWindowData.get(id)
            windowManager.pendingWindowData.delete(id)
            return { success: true, data }
          }
        }
        return { success: false, error: 'no pending data' }
      } catch (e) {
        return { success: false, error: e.message }
      }
    },
    'window:minimize': async (event) => { const w = getEventWindow(event); if (w) w.minimize(); return true },
    'window:maximize': async (event) => {
      const w = getEventWindow(event)
      if (w) (w.isMaximized() ? w.unmaximize() : w.maximize())
      return true
    },
    'window:close': async (event) => { const w = getEventWindow(event); if (w) w.close(); return true },
    'window:hide': async (event) => { const w = getEventWindow(event); if (w) w.hide(); return true },
    'window:show': async (event) => { const w = getEventWindow(event); if (w) w.show(); return true },
    'window:focus': async (event) => { const w = getEventWindow(event); if (w) w.focus(); return true },
    'window:toggle-always-on-top': async (event) => {
      const w = getEventWindow(event)
      if (!w) return false
      const alwaysOnTop = !w.isAlwaysOnTop()
      w.setAlwaysOnTop(alwaysOnTop)
      w.webContents.send('window:always-on-top-changed', alwaysOnTop)
      return alwaysOnTop
    },
    'window:is-always-on-top': async (event) => {
      const w = getEventWindow(event)
      return w ? w.isAlwaysOnTop() : false
    },
    'window:is-maximized': async (event) => { const w = getEventWindow(event); return w ? w.isMaximized() : false },
    'window:is-minimized': async (event) => { const w = getEventWindow(event); return w ? w.isMinimized() : false },
    'window:is-visible': async (event) => { const w = getEventWindow(event); return w ? w.isVisible() : false },
    'window:is-focused': async (event) => { const w = getEventWindow(event); return w ? w.isFocused() : false },
    'window:get-bounds': async (event) => { const w = getEventWindow(event); return w ? w.getBounds() : null },
    'window:set-bounds': async (event, bounds) => { const w = getEventWindow(event); if (w) w.setBounds(bounds); return true },
    'window:get-size': async (event) => { const w = getEventWindow(event); return w ? w.getSize() : null },
    'window:set-size': async (event, width, height) => { const w = getEventWindow(event); if (w) w.setSize(width, height); return true },
    'window:get-position': async (event) => { const w = getEventWindow(event); return w ? w.getPosition() : null },
    'window:set-position': async (event, x, y) => { const w = getEventWindow(event); if (w) w.setPosition(x, y); return true },
    'window:create-note-window': async (event, noteId, options) => windowManager.createNoteWindow(noteId, options),
    'window:is-note-open': async (event, noteId) => {
      try {
        return { success: true, isOpen: windowManager.isNoteOpenInWindow(noteId) }
      } catch (error) {
        console.error('检查笔记窗口状态失败:', error)
        return { success: false, error: error.message, isOpen: false }
      }
    },
    'window:create-todo-window': async (event, todoListId) => windowManager.createTodoWindow(todoListId),
    'window:focus-session-start': async (event, sessionData) => windowManager.startFocusSession(sessionData, getEventWindow(event)),
    'window:focus-session-update': async (event, sessionData) => windowManager.updateFocusSession(sessionData),
    'window:focus-session-end': async () => windowManager.endFocusSession(),
    'window:focus-session-action': async (event, action) => windowManager.handleFocusWindowAction(action),
    'window:todo-reminder-action': async (event, action) => windowManager.handleTodoReminderAction(action),
    'window:get-all': async () => windowManager.getAllWindows(),
    'window:get-by-id': async (event, id) => windowManager.getWindowById(id),
    'window:close-window': async (event, id) => windowManager.closeWindow(id),
    'window:toggle-dev-tools': async (event) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) return { success: false, error: '窗口不存在' }
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools()
        } else {
          window.webContents.openDevTools()
        }
        return { success: true }
      } catch (error) {
        console.error('切换开发者工具失败:', error)
        return { success: false, error: error.message }
      }
    },
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler)
  }
}

module.exports = { registerWindowHandlers }
