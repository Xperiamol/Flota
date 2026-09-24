const { app, Menu, shell } = require('electron')

// macOS 顶部菜单栏。Windows / Linux 使用无边框窗口 + 自绘标题栏，不展示系统菜单。
//
// 菜单项通过 'app-menu:command' 交给渲染层执行，渲染层复用应用内已有逻辑（新建笔记、切换视图等）。
// 与全局快捷键 / 渲染层快捷键重复的加速键只做展示（registerAccelerator: false），避免触发两次。

const REPO_URL = 'https://github.com/Xperiamol/Flota'

const installAppMenu = ({ getMainWindow, isDev = false }) => {
  if (process.platform !== 'darwin') return

  const send = (command, payload) => {
    const win = getMainWindow?.()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('app-menu:command', { command, payload })
  }

  // 仅展示快捷键提示，实际由全局快捷键或渲染层处理
  const hint = (accelerator) => ({ accelerator, registerAccelerator: false })

  const template = [
    {
      label: 'Flota',
      submenu: [
        { role: 'about', label: '关于 Flota' },
        { label: '检查更新…', click: () => send('check-updates') },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: () => send('open-settings') },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Flota' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Flota' }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '新建笔记', ...hint('Cmd+N'), click: () => send('new-note') },
        { label: '新建白板', click: () => send('new-whiteboard') },
        { label: '新建待办', ...hint('Cmd+T'), click: () => send('new-todo') },
        { label: '快速输入', ...hint('Cmd+Shift+N'), click: () => send('quick-input') },
        { type: 'separator' },
        { label: '打开文件…', accelerator: 'Cmd+O', click: () => send('open-file') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        {
          label: '语音',
          submenu: [
            { role: 'startSpeaking', label: '开始朗读' },
            { role: 'stopSpeaking', label: '停止朗读' }
          ]
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '笔记', click: () => send('view', 'notes') },
        { label: '待办', click: () => send('view', 'todo') },
        { label: '日历', click: () => send('view', 'calendar') },
        { label: '时间轴', click: () => send('view', 'timeline') },
        { label: 'AI', click: () => send('view', 'ai') },
        { type: 'separator' },
        { label: '命令面板', ...hint('Cmd+Shift+P'), click: () => send('command-palette') },
        { label: '问 AI', ...hint('Cmd+K'), click: () => send('ai-panel') },
        { label: '笔记导航 / 书签', ...hint('Cmd+J'), click: () => send('note-navigator') },
        { label: '显示 / 隐藏侧边栏', click: () => send('toggle-sidebar') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入 / 退出全屏' },
        ...(isDev
          ? [
              { type: 'separator' },
              { role: 'reload', label: '重新载入' },
              { role: 'toggleDevTools', label: '开发者工具' }
            ]
          : [])
      ]
    },
    {
      role: 'window',
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        { label: '项目主页', click: () => shell.openExternal(REPO_URL) },
        { label: '版本更新说明', click: () => shell.openExternal(`${REPO_URL}/releases`) },
        { label: '反馈问题', click: () => shell.openExternal(`${REPO_URL}/issues`) },
        { type: 'separator' },
        { label: '打开日志文件夹', click: () => shell.openPath(app.getPath('userData')) }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

module.exports = { installAppMenu }
