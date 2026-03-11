const { app, BrowserWindow, ipcMain, dialog, clipboard, Notification, shell, Tray, Menu, nativeImage, protocol, nativeTheme, net } = require('electron')
const path = require('path')

// 加载环境变量
// 在打包环境中，.env 文件位于 resources 目录
// 在开发环境中，.env 文件位于项目根目录
// 注意：process.resourcesPath 在打包后指向 resources 目录，开发模式下指向 node_modules/electron/dist/resources
const isEnvPackaged = app.isPackaged

if (isEnvPackaged) {
  require('dotenv').config({ path: path.join(process.resourcesPath, '.env') })
} else {
  require('dotenv').config()
}

const fs = require('fs')
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ── 文件日志系统 ────────────────────────────────────────────────────────────────
// 生产环境将 error/warn 写入文件，让用户可以把日志文件发给开发者排查
const _pendingLogs = []
let _logFilePath = null

function _fileLog(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack}`
    if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a) } catch { return String(a) } }
    return String(a)
  }).join(' ')}\n`
  if (_logFilePath) {
    try { fs.appendFileSync(_logFilePath, line, 'utf8') } catch {}
  } else {
    _pendingLogs.push(line)
  }
}

function setupFileLogging() {
  try {
    const logDir = app.getPath('userData')
    _logFilePath = path.join(logDir, 'flota.log')
    // 超过 5MB 自动轮转
    if (fs.existsSync(_logFilePath) && fs.statSync(_logFilePath).size > 5 * 1024 * 1024) {
      const oldPath = _logFilePath + '.old'
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
      fs.renameSync(_logFilePath, oldPath)
    }
    fs.appendFileSync(_logFilePath, `\n=== Flota 启动 ${new Date().toISOString()} (isDev=${isDev}) ===\n`, 'utf8')
    _pendingLogs.forEach(line => { try { fs.appendFileSync(_logFilePath, line, 'utf8') } catch {} })
    _pendingLogs.length = 0
  } catch {}
}

// 将 console.error / console.warn 同时写入文件（仅生产环境）
if (!isDev) {
  const _origError = console.error.bind(console)
  const _origWarn = console.warn.bind(console)
  console.error = (...args) => { _origError(...args); _fileLog('ERROR', args) }
  console.warn = (...args) => { _origWarn(...args); _fileLog('WARN', args) }
}
// ────────────────────────────────────────────────────────────────────────────────

// 生产环境：禁用 console.log/info/debug，减少 I/O 开销
if (!isDev) {
  const noop = () => {}
  console.log = noop
  console.info = noop
  console.debug = noop
}

// 设置 Windows 通知的应用标识符（必须在 app.whenReady 之前）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.flota.app')
}

// 注册自定义协议（必须在 app.whenReady 之前）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
])

// 导入服务
const DatabaseManager = require('./dao/DatabaseManager')
const NoteService = require('./services/NoteService')
const SettingsService = require('./services/SettingsService')
const TodoService = require('./services/TodoService')
const TagService = require('./services/TagService')
const WindowManager = require('./services/WindowManager')
const DataImportService = require('./services/DataImportService')
const BackupService = require('./services/BackupService')
const ShortcutService = require('./services/ShortcutService')
const NotificationService = require('./services/NotificationService')
const ImageService = require('./services/ImageService')
const { getInstance: getImageStorageInstance } = require('./services/ImageStorageService')
const PluginManager = require('./services/PluginManager')
const AIService = require('./services/AIService')
const MCPDownloader = require('./services/MCPDownloader')
const { setupMCPHandlers } = require('./ipc/mcpHandlers')
const STTService = require('./services/STTService')
const Mem0Service = require('./services/Mem0Service')
const HistoricalDataMigrationService = require('./services/HistoricalDataMigrationService')
const IpcHandlerFactory = require('./utils/ipcHandlerFactory')
const CalDAVSyncService = require('./services/CalDAVSyncService')
const GoogleCalendarService = require('./services/GoogleCalendarService')
const ProxyService = require('./services/ProxyService')
const { getInstance: getSyncIPCHandler } = require('./ipc/SyncIPCHandler')
const { getInstance: getNetworkService } = require('./services/NetworkService')
const { getInstance: getOfflineSyncQueue } = require('./services/OfflineSyncQueue')
const { getInstance: getLogger } = require('./services/LoggerService')

// 保持对窗口对象的全局引用，如果不这样做，当JavaScript对象被垃圾回收时，窗口将自动关闭
let mainWindow
let services = {}
let windowManager
let shortcutService
let tray = null
let pluginManager

function createWindow() {
  // 加载保存的窗口状态
  const windowStatePath = path.join(app.getPath('userData'), 'window-state.json')
  let windowState = {
    width: 1400,  // 默认更宽的窗口
    height: 900,
    x: undefined,
    y: undefined,
    isMaximized: false
  }

  // 尝试读取保存的窗口状态
  try {
    if (fs.existsSync(windowStatePath)) {
      const savedState = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'))
      // 验证保存的状态是否有效
      if (savedState.width && savedState.height) {
        windowState = { ...windowState, ...savedState }
        console.log('[Main] 已加载保存的窗口状态:', windowState)
      }
    }
  } catch (error) {
    console.error('[Main] 加载窗口状态失败:', error)
  }

  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false, // 安全考虑，禁用node集成
      contextIsolation: true, // 启用上下文隔离
      enableRemoteModule: false, // 禁用remote模块
      devTools: true, // 允许开发者工具（通过7次点击头像启用）
      preload: path.join(__dirname, 'preload.js') // 预加载脚本
    },
    titleBarStyle: 'hidden', // 隐藏默认标题栏，使用自定义标题栏
    frame: false, // 完全隐藏窗口边框
    show: false // 先不显示窗口，等加载完成后再显示
  })

  // 如果之前是最大化状态，恢复最大化
  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  // 保存窗口状态的函数
  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    try {
      const isMaximized = mainWindow.isMaximized()
      const bounds = mainWindow.getBounds()

      // 只在非最大化时保存位置和大小
      const stateToSave = {
        isMaximized,
        ...(isMaximized ? {} : bounds)
      }

      // 如果之前有保存的非最大化状态，保留它
      if (isMaximized && fs.existsSync(windowStatePath)) {
        const existingState = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'))
        stateToSave.width = existingState.width || bounds.width
        stateToSave.height = existingState.height || bounds.height
        stateToSave.x = existingState.x
        stateToSave.y = existingState.y
      } else if (!isMaximized) {
        stateToSave.width = bounds.width
        stateToSave.height = bounds.height
        stateToSave.x = bounds.x
        stateToSave.y = bounds.y
      }

      fs.writeFileSync(windowStatePath, JSON.stringify(stateToSave, null, 2))
    } catch (error) {
      console.error('[Main] 保存窗口状态失败:', error)
    }
  }

  // 监听窗口状态变化
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('maximize', saveWindowState)
  mainWindow.on('unmaximize', saveWindowState)

  // 监听窗口失去焦点（进入后台20秒后触发迁移）
  mainWindow.on('blur', () => {
    if (services.migrationService) {
      services.migrationService.triggerMigrationOnBackground();
    }
  })

  // 监听窗口获得焦点（取消后台迁移）
  mainWindow.on('focus', () => {
    if (services.migrationService) {
      services.migrationService.cancelBackgroundMigration();
    }
  })

  // 处理新窗口打开请求（阻止外部链接在新窗口中打开）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Main] 拦截新窗口请求:', url)

    // 如果是 Excalidraw 素材库相关的 URL，在默认浏览器中打开
    if (url.includes('excalidraw.com') || url.includes('libraries.excalidraw.com')) {
      console.log('[Main] 在外部浏览器中打开 Excalidraw 链接')
      shell.openExternal(url)
      return { action: 'deny' }
    }

    // 其他外部链接也在浏览器中打开
    if (url.startsWith('http://') || url.startsWith('https://')) {
      console.log('[Main] 在外部浏览器中打开链接:', url)
      shell.openExternal(url)
      return { action: 'deny' }
    }

    // 阻止所有其他新窗口
    return { action: 'deny' }
  })

  // 加载应用
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174')
    // 开发模式下打开开发者工具
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 当窗口准备好显示时显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()

    // 生产模式下禁用开发者工具快捷键和右键菜单
    if (!isDev) {
      // 阻止开发者工具快捷键（Ctrl+Shift+I, F12等）
      mainWindow.webContents.on('before-input-event', (event, input) => {
        // 阻止 Ctrl+Shift+I
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
          event.preventDefault()
          console.log('[Main] 已阻止开发者工具快捷键 Ctrl+Shift+I')
        }
        // 阻止 F12
        if (input.key === 'F12') {
          event.preventDefault()
          console.log('[Main] 已阻止开发者工具快捷键 F12')
        }
        // 阻止 Ctrl+Shift+C (检查元素)
        if (input.control && input.shift && input.key.toLowerCase() === 'c') {
          event.preventDefault()
          console.log('[Main] 已阻止开发者工具快捷键 Ctrl+Shift+C')
        }
      })

      // 阻止右键菜单中的开发者工具选项
      mainWindow.webContents.on('context-menu', (event, params) => {
        event.preventDefault()
        const { Menu } = require('electron')
        const menu = Menu.buildFromTemplate([
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectall' }
        ])
        menu.popup()
      })
    }

    // 同步事件转发已由 SyncIPCHandler 自动处理
  })

  // 当窗口关闭时触发 - 最小化到托盘而不是退出
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault()
      mainWindow.hide()

      // 首次最小化到托盘时显示提示
      if (!global.hasShownTrayNotification) {
        const iconPath = isDev
          ? path.join(__dirname, '../logo.png')
          : path.join(process.resourcesPath, 'logo.png')

        new Notification({
          title: 'Flota',
          body: '应用已最小化到系统托盘，双击托盘图标可重新打开窗口',
          icon: fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined
        }).show()
        global.hasShownTrayNotification = true
      }
    }
  })

  mainWindow.on('closed', () => {
    // 取消引用window对象，如果你的应用支持多窗口，
    // 通常会把多个window对象存放在一个数组里，
    // 与此同时，你应该删除相应的元素。
    mainWindow = null
  })
}

// 创建系统托盘
function createTray() {
  try {
    // 根据是否打包选择路径
    const icoPath = isDev
      ? path.join(__dirname, '../build/logo.ico')
      : path.join(process.resourcesPath, 'build/logo.ico')
    const pngPath = isDev
      ? path.join(__dirname, '../logo.png')
      : path.join(process.resourcesPath, 'logo.png')

    let trayIcon = null

    // 优先使用多尺寸 ICO（含 16/32/48 等标准 Windows 尺寸）
    if (fs.existsSync(icoPath)) {
      trayIcon = nativeImage.createFromPath(icoPath)
    }
    // ICO 加载失败则用 PNG 缩放到 32x32
    if (!trayIcon || trayIcon.isEmpty()) {
      if (fs.existsSync(pngPath)) {
        const raw = nativeImage.createFromPath(pngPath)
        if (!raw.isEmpty()) trayIcon = raw.resize({ width: 32, height: 32 })
      }
    }
    // 两者都失败 → 不创建托盘，避免透明空图标
    if (!trayIcon || trayIcon.isEmpty()) {
      console.error('[Tray] 图标文件无法加载，系统托盘不可用')
      return
    }

    tray = new Tray(trayIcon)
    tray.setToolTip('Flota')

    // 创建托盘菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) {
              mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      {
        label: '隐藏窗口',
        click: () => {
          if (mainWindow) {
            mainWindow.hide()
          }
        }
      },
      { type: 'separator' },
      {
        label: '新建笔记',
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('create-new-note')
            if (mainWindow.isMinimized()) {
              mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      {
        label: '快速输入',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: async () => {
          try {
            // 创建空白笔记
            const result = await services.noteService.createNote({
              title: '快速笔记',
              content: '',
              category: '',
              tags: []
            });

            if (result.success && result.data) {
              // 在独立窗口打开
              await windowManager.createNoteWindow(result.data.id);
            }
          } catch (error) {
            console.error('快速输入失败:', error);
          }
        }
      },
      {
        label: '显示悬浮球',
        click: async () => {
          try {
            await windowManager.createFloatingBall()
          } catch (error) {
            console.error('创建悬浮球失败:', error)
          }
        }
      },
      { type: 'separator' },
      {
        label: '设置',
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('open-settings')
            if (mainWindow.isMinimized()) {
              mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出应用',
        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
        click: () => {
          app.quit()
        }
      }
    ])

    // 设置托盘菜单
    tray.setContextMenu(contextMenu)

    // 双击托盘图标显示/隐藏主窗口
    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
        }
      }
    })

    console.log('系统托盘创建成功')
  } catch (error) {
    console.error('创建系统托盘失败:', error)
  }
}

// 初始化服务
async function initializeServices() {
  try {
    // 初始化数据库
    const dbManager = DatabaseManager.getInstance()
    await dbManager.initialize()

    // 将 dbManager 加入 services，供 PluginManager 等使用
    services.dbManager = dbManager

    // 初始化服务
    services.noteService = new NoteService()
    services.settingsService = new SettingsService()
    services.todoService = new TodoService()
    services.tagService = new TagService()
    services.dataImportService = new DataImportService(services.noteService, services.settingsService, services.imageStorageService)
    services.backupService = new BackupService()
    services.imageService = new ImageService()

    // 暴露 DAO 供插件使用
    const NoteDAO = require('./dao/NoteDAO')
    const TodoDAO = require('./dao/TodoDAO')
    services.noteDAO = new NoteDAO()
    services.todoDAO = new TodoDAO()

    // 并行初始化AI/STT/Mem0服务，减少启动时间
    const SettingDAO = require('./dao/SettingDAO')
    const settingDAO = new SettingDAO()
    
    services.aiService = new AIService(settingDAO)
    services.sttService = new STTService(settingDAO)
    
    const dbPath = path.join(app.getPath('userData'), 'database', 'flota.db')
    const appDataPath = app.getPath('userData')
    services.mem0Service = new Mem0Service(dbPath, appDataPath)
    services.migrationService = new HistoricalDataMigrationService(services.mem0Service)

    // 并行初始化所有AI服务
    const logger = getLogger()
    Promise.all([
      services.aiService.initialize().catch(e => logger.error('Main', 'AI service init failed', e)),
      services.sttService.initialize().catch(e => logger.error('Main', 'STT service init failed', e)),
      services.mem0Service.initialize().then(result => {
        if (result.success) {
          logger.info('Main', 'Mem0 service initialized')
          services.migrationService.startAutoMigration('current_user')
        } else {
          logger.warn('Main', 'Mem0 service initialization failed: ' + result.error)
        }
      }).catch(e => logger.error('Main', 'Mem0 service error', e))
    ]).then(() => {
      logger.info('Main', '所有AI服务初始化完成')
    })

    // 初始化通知服务
    services.notificationService = new NotificationService()

    // 初始化 SyncIPCHandler（集成 V3 同步服务）
    const syncIPCHandler = getSyncIPCHandler()
    await syncIPCHandler.initialize()
    services.syncIPCHandler = syncIPCHandler

    // 绑定离线同步队列到 V3 同步
    const offlineQueue = getOfflineSyncQueue()
    const v3Sync = require('./services/sync/V3SyncService').getInstance()
    offlineQueue.setSyncFunction(() => v3Sync.sync())

    // 初始化 CalDAV 日历同步服务
    services.calDAVSyncService = new CalDAVSyncService()
    await services.calDAVSyncService.initialize() // 恢复自动同步
    console.log('[Main] CalDAV sync service initialized')

    // 初始化 Google Calendar OAuth 同步服务
    services.googleCalendarService = new GoogleCalendarService()
    await services.googleCalendarService.initialize() // 恢复自动同步
    console.log('[Main] Google Calendar service initialized')

    // 初始化代理服务
    services.proxyService = new ProxyService()
    console.log('[Main] Proxy service initialized')

    // 初始化网络状态检测 & 离线同步队列
    services.networkService = getNetworkService()
    services.networkService.start()
    services.offlineSyncQueue = getOfflineSyncQueue()
    services.offlineSyncQueue.startAutoFlush()
    console.log('[Main] Network & OfflineSyncQueue initialized')

    // 初始化 MCP 下载服务
    services.mcpDownloader = new MCPDownloader()
    console.log('[Main] MCP Downloader initialized')

    // 将通知服务连接到TodoService
    services.todoService.setNotificationService(services.notificationService)

    // 监听通知点击事件，打开主窗口并聚焦到待办事项
    services.notificationService.on('notification-clicked', (todo) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()

        // 发送事件到渲染进程，让前端跳转到对应的待办事项
        mainWindow.webContents.send('todo:focus', todo.id)
      }
    })

    // 启动通知服务
    services.notificationService.start()

    // 初始化窗口管理器
    windowManager = new WindowManager(services.settingsService)

    // 初始化快捷键服务
    shortcutService = new ShortcutService()
    services.shortcutService = shortcutService

    // 转发 NoteService 事件到所有渲染进程
    const broadcastToAll = (channel, data) => {
      try {
        BrowserWindow.getAllWindows().forEach(win => {
          if (win && !win.isDestroyed()) {
            win.webContents.send(channel, data)
          }
        })
      } catch (err) {
        console.error(`广播事件失败: ${channel}`, err)
      }
    }

    if (services && services.noteService) {
      services.noteService.on('note-created', (note) => {
        broadcastToAll('note:created', note)
      })
      services.noteService.on('note-updated', (note) => {
        broadcastToAll('note:updated', note)
      })
      services.noteService.on('note-deleted', (payload) => {
        broadcastToAll('note:deleted', payload)
      })
    }

    // 转发 SettingsService 的设置变更事件到所有渲染进程
    if (services && services.settingsService) {
      services.settingsService.on('setting-changed', (data) => {
        broadcastToAll('setting:changed', data)
      })
    }

    // 监听 DataImportService 的 Obsidian 事件并转发到渲染进程
    if (services && services.dataImportService) {
      const events = [
        'obsidian-import-started', 'obsidian-import-file-processing', 'obsidian-import-phase-changed',
        'obsidian-import-completed', 'obsidian-import-error',
        'obsidian-export-started', 'obsidian-export-note-processing', 
        'obsidian-export-completed', 'obsidian-export-error',
        'obsidian-import-warning', 'obsidian-export-warning'
      ];
      
      events.forEach(event => {
        services.dataImportService.on(event, (data) => broadcastToAll(event, data));
      });

      console.log('[Main] DataImportService 事件监听器已设置');
    }

    pluginManager = new PluginManager({
      app,
      services,
      shortcutService,
      windowAccessor: () => BrowserWindow.getAllWindows(),
      mainWindowAccessor: () => mainWindow,
      logger: console,
      isPackaged: app.isPackaged
    })

    services.pluginManager = pluginManager

    if (shortcutService && typeof shortcutService.setPluginManager === 'function') {
      shortcutService.setPluginManager(pluginManager)
    }

    // 延迟插件初始化，不阻塞窗口显示
    pluginManager.on('store-event', (event) => {
      broadcastToAll('plugin-store:event', event)
    })

    // 在窗口创建后异步初始化插件
    setTimeout(async () => {
      try {
        console.log('[Main] 开始异步初始化插件...')
        await pluginManager.initialize()
        console.log('[Main] 插件初始化完成')
      } catch (error) {
        console.error('[Main] 插件初始化失败:', error)
      }
    }, 500)

    pluginManager.on('store-event', (event) => {
      if (event?.type === 'ready') {
        console.log(`插件已就绪: ${event.plugin?.manifest?.name || event.pluginId}`)
      }
    })

    // 检查是否为首次启动，如果没有笔记则创建示例笔记
    try {
      const notesResult = await services.noteService.getNotes({ limit: 1 })
      if (notesResult.success && notesResult.data && notesResult.data.notes && notesResult.data.notes.length === 0) {
        console.log('检测到首次启动，创建示例笔记')
        const welcomeNote = {
          title: '欢迎使用 Flota 2.3！',
          content: `# 欢迎使用 Flota 2.3！ 🎉

恭喜你成功安装了 Flota，这是一个现代化的本地笔记应用。

## 版本新功能

### 白板笔记
- **Excalidraw 集成**：创建白板笔记，支持手绘图形和流程图
- **素材库支持**：使用内置素材库或浏览在线素材库
- **独立窗口优化**：支持拖拽白板笔记到独立窗口中编辑
- **PNG 导出**：一键导出白板为高清图片

### Markdown 增强
- **扩展语法**：支持高亮（==text==）、@orange{彩色文本}、[[Wiki 链接]]、#标签等
- **自定义MD插件**：完整可插拔的 Markdown 插件系统
- **实时预览**：所见即所得的编辑体验（测试中）

### 插件系统
- **扩展生态**：支持安装第三方插件
- **本地开发**：可以开发自己的插件
- **主题定制**：插件可以注入自定义样式
- **命令面板**：Ctrl+Shift+P 打开命令面板使用插件功能

### 同步优化
- **新增日历同步**：可选CALDAV和Google Calendar（需要代理）
- **智能冲突处理**：基于时间戳的智能冲突解决与增量同步

## 快速开始

### 基本操作
- **创建笔记**：点击左上角的 "新建" 按钮或使用快捷键 \`Ctrl+N\`
- **创建白板**：选择"白板笔记"类型，使用 Excalidraw 进行创作
- **搜索笔记**：使用顶部搜索框快速找到你需要的笔记
- **标签管理**：为笔记添加标签，方便分类和查找
- **拖拽窗口**：试试拖动笔记列表到窗口外~

### 快捷键
- \`Ctrl+N\`：新建笔记
- \`Ctrl+S\`：保存笔记
- \`Ctrl+F\`：搜索笔记
- \`Ctrl+Shift+P\`：打开命令面板
- \`Ctrl+Shift+N\`：快速输入

## 特色功能

### Markdown 支持
这个笔记应用支持 **Markdown** 语法，你可以：

- 使用 **粗体** 和 *斜体*
- 使用 ==高亮文本==
- 创建 [[Wiki链接]]
- 添加 #标签
- 创建 [链接](https://github.com)
- 添加代码块：

\`\`\`javascript
console.log('Hello, Flota!');
\`\`\`

- 制作任务列表：
  - [x] 安装 Flota
  - [x] 阅读欢迎笔记
  - [ ] 创建第一个白板笔记
  - [ ] 尝试插件系统
  - [ ] 探索更多功能

### 白板功能
- 🎨 手绘风格图形
- 📐 多种形状和箭头
- 📝 文本注释
- 🖼️ 图片插入
- 📚 素材库管理
- 💾 自动保存

### 数据安全
- 所有数据都存储在本地，保护你的隐私
- 支持数据导入导出功能
- 自动保存，不用担心数据丢失
- 支持坚果云、Google Calendar 等同步方案

## 开始使用

现在你可以：
1. 创建你的第一个白板笔记
2. 尝试使用 Markdown 扩展语法
3. 打开命令面板（Ctrl+Shift+P）探索插件功能
4. 在设置中配置云同步
5. 探索设置选项，个性化你的使用体验

祝你使用愉快！ 📝✨
By Xperiamol
`,
          tags: ['欢迎', '教程', '2.3'],
          category: 'default'
        }

        await services.noteService.createNote(welcomeNote)
        console.log('示例笔记创建成功')
      }
    } catch (error) {
      console.error('创建示例笔记失败:', error)
    }

    console.log('所有服务初始化完成')
  } catch (error) {
    console.error('服务初始化失败:', error)
    app.quit()
  }
}

// 处理多实例问题 - 确保只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，退出当前实例
  console.log('应用已在运行，退出当前实例')
  app.quit()
} else {
  // 当第二个实例尝试启动时，聚焦到第一个实例的窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('检测到第二个实例启动，聚焦到主窗口')
    // 如果主窗口存在，显示并聚焦
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Electron初始化完成，创建窗口
  app.whenReady().then(async () => {
    // 初始化文件日志（仅生产环境）
    if (!isDev) setupFileLogging()

    // 注册 app:// 协议处理器
    protocol.handle('app', async (request) => {
      try {
        const url = request.url
        // app://images/abc.png -> images/abc.png
        // app://audio/abc.m4a -> audio/abc.m4a
        // app://wallpaper/current.jpg?t=123 -> wallpaper/current.jpg
        let relativePath = url.replace('app://', '')
        // 去除查询参数
        const qIdx = relativePath.indexOf('?')
        if (qIdx !== -1) relativePath = relativePath.slice(0, qIdx)

        // 安全校验：禁止路径遍历
        const normalized = path.normalize(relativePath)
        if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
          return new Response('Forbidden', { status: 403 })
        }

        console.log('[Protocol] 处理 app:// 请求:', relativePath)

        // 获取完整路径
        // 音频文件存储在 userData/audio/，壁纸在 userData/wallpaper/，图片在 userData/images/
        let fullPath
        if (relativePath.startsWith('audio/')) {
          fullPath = path.join(app.getPath('userData'), relativePath)
        } else if (relativePath.startsWith('wallpaper/')) {
          fullPath = path.join(app.getPath('userData'), relativePath)
        } else {
          fullPath = services.imageService.getImagePath(relativePath)
        }
        console.log('[Protocol] 完整路径:', fullPath)

        // 检查文件是否存在
        if (!fs.existsSync(fullPath)) {
          console.error('[Protocol] 文件不存在:', fullPath)
          return new Response('File not found', { status: 404 })
        }

        // 确定 MIME 类型
        const ext = path.extname(fullPath).toLowerCase()
        const mimeTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          // 音频格式
          '.m4a': 'audio/mp4',
          '.mp3': 'audio/mpeg',
          '.ogg': 'audio/ogg',
          '.wav': 'audio/wav',
          '.aac': 'audio/aac',
          '.opus': 'audio/ogg; codecs=opus',
          '.flac': 'audio/flac',
          '.webm': 'audio/webm'
        }
        const mimeType = mimeTypes[ext] || 'application/octet-stream'

        // 音频文件：用 net.fetch 代理本地文件，自动处理 Range/Content-Length/streaming
        if (mimeType.startsWith('audio/')) {
          const fileUrl = 'file://' + fullPath.replace(/\\/g, '/')
          return net.fetch(fileUrl, { headers: request.headers })
        }

        // 使用流式读取，提升大文件性能
        const data = fs.readFileSync(fullPath)
        
        const isWallpaper = relativePath.startsWith('wallpaper/')
        console.log('[Protocol] 返回文件，MIME:', mimeType)
        return new Response(data, {
          headers: { 
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': isWallpaper ? 'no-cache' : 'public, max-age=31536000'
          }
        })
      } catch (error) {
        console.error('[Protocol] 处理请求失败:', error)
        return new Response('Internal Server Error', { status: 500 })
      }
    })

    await initializeServices()
    // 数据库迁移已在 DatabaseManager.initialize() 中自动执行

    // 加载并应用代理配置
    try {
      const proxyConfig = services.proxyService.getConfig();
      services.proxyService.applyConfig(proxyConfig);
    } catch (error) {
      console.error('[启动] 加载代理配置失败:', error)
    }

    createWindow()
    createTray()

    // 设置 MCP 相关 IPC 处理器（在窗口创建后）
    setupMCPHandlers(services.mcpDownloader, mainWindow)

    // 监听系统主题变化
    nativeTheme.on('updated', () => {
      console.log('[Main] 系统主题变化，当前主题:', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

      // 通知所有窗口主题变化
      BrowserWindow.getAllWindows().forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('system-theme-changed', {
            shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
            themeSource: nativeTheme.themeSource
          })
        }
      })
    })

    // 初始化开机自启状态
    try {
      const loginItemSettings = app.getLoginItemSettings()
      const savedAutoLaunch = await services.settingsService.getSetting('autoLaunch')

      // 如果系统状态与保存的设置不一致，以系统状态为准
      if (savedAutoLaunch.success && savedAutoLaunch.data !== loginItemSettings.openAtLogin) {
        await services.settingsService.setSetting('autoLaunch', loginItemSettings.openAtLogin, 'boolean', '开机自启')
        console.log('同步开机自启状态:', loginItemSettings.openAtLogin)
      }
    } catch (error) {
      console.error('初始化开机自启状态失败:', error)
    }

    // 设置快捷键服务的主窗口和窗口管理器引用
    if (shortcutService && mainWindow) {
      shortcutService.setMainWindow(mainWindow)
      shortcutService.setWindowManager(windowManager)

      // 加载并注册快捷键
      try {
        const { DEFAULT_SHORTCUTS } = require('./utils/shortcutUtils')
        const shortcutsResult = await services.settingsService.getSetting('shortcuts')
        let shortcuts = shortcutsResult.success ? shortcutsResult.data : null

        // 检查配置数据是否有效
        const isValidConfig = shortcuts &&
          typeof shortcuts === 'object' &&
          !Array.isArray(shortcuts) &&
          Object.keys(shortcuts).some(key => key.includes('.')) && // 检查是否有正确的快捷键ID格式
          Object.values(shortcuts).some(config => config && config.type && config.currentKey)

        let registrationStats

        if (isValidConfig) {
          console.log('使用已保存的快捷键配置')
          registrationStats = await shortcutService.registerAllShortcuts(shortcuts)
        } else {
          console.log('快捷键配置无效或不存在，重置为默认配置')
          // 强制重置为默认配置
          await services.settingsService.setSetting('shortcuts', DEFAULT_SHORTCUTS)
          registrationStats = await shortcutService.registerAllShortcuts(DEFAULT_SHORTCUTS)
        }

        // 输出注册统计信息
        if (registrationStats) {
          console.log('快捷键注册统计:', {
            总数: registrationStats.total,
            成功: registrationStats.registered,
            跳过: registrationStats.skipped,
            失败: registrationStats.failed
          })

          if (registrationStats.failed > 0) {
            console.warn('部分快捷键注册失败，可能被其他应用占用')
          }
        }
      } catch (error) {
        console.error('初始化快捷键失败:', error)
        // 使用默认快捷键配置
        try {
          const { DEFAULT_SHORTCUTS } = require('./utils/shortcutUtils')
          await services.settingsService.setSetting('shortcuts', DEFAULT_SHORTCUTS)
          const fallbackStats = await shortcutService.registerAllShortcuts(DEFAULT_SHORTCUTS)
          console.log('使用默认快捷键配置，注册统计:', fallbackStats)
        } catch (fallbackError) {
          console.error('使用默认快捷键配置也失败:', fallbackError)
        }
      }
    }
  })
}

// 当所有窗口关闭时的处理
app.on('window-all-closed', () => {
  // 检查主窗口是否还存在（可能只是隐藏到托盘）
  if (mainWindow && !mainWindow.isDestroyed()) {
    // 主窗口存在（可能隐藏到托盘），继续运行
    console.log('所有窗口已关闭，主窗口在托盘中，应用继续运行')
  } else {
    // 主窗口不存在，说明是独立窗口单独运行后关闭，退出应用
    console.log('所有窗口已关闭且主窗口不存在，退出应用')
    app.quit()
  }
})

// before-quit 由文件末尾统一处理（含 tray 清理、窗口保存、DB 关闭）

app.on('activate', () => {
  // 在macOS上，当单击dock图标并且没有其他窗口打开时，
  // 通常在应用中重新创建一个窗口
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 在这个文件中，你可以包含应用的其他主进程代码
// 你也可以将它们放在单独的文件中并在这里引入

// ============= IPC 处理程序 =============

const { validatePath, validateRelativePath, validateString, validateId, validateUrl, validateArray, validateObject } = require('./utils/ipcValidator')

const registerIpcHandlers = (handlers) => {
  for (const { channel, handler } of handlers) {
    ipcMain.handle(channel, handler)
  }
}

const createServicePassthroughHandler = (getService, methodName) => {
  return async (event, ...args) => {
    const service = getService()
    return await service[methodName](...args)
  }
}

const getEventWindow = (event) => BrowserWindow.fromWebContents(event.sender)

// 应用基础API
ipcMain.handle('app-version', () => {
  return app.getVersion()
})

ipcMain.handle('hello-world', () => {
  return 'Hello from Electron Main Process!'
})

// 插件商店相关
const ensurePluginManager = () => {
  if (!pluginManager) {
    throw new Error('插件管理器尚未初始化')
  }
  return pluginManager
}

// 简单委托的插件 handler（表驱动）
const pluginSimpleHandlers = {
  'plugin-store:list-available':  { method: 'listAvailablePlugins',  fallback: [] },
  'plugin-store:list-installed':  { method: 'listInstalledPlugins',  fallback: [] },
  'plugin-store:scan-local':      { method: 'scanLocalPlugins',      fallback: [] },
  'plugin-store:get-details':     { method: 'getPluginDetails',      fallback: null },
  'plugin-store:install':         { method: 'installPlugin',         wrap: true },
  'plugin-store:uninstall':       { method: 'uninstallPlugin',       wrap: true, noData: true },
  'plugin-store:enable':          { method: 'enablePlugin',          wrap: true },
  'plugin-store:disable':         { method: 'disablePlugin',         wrap: true },
  'plugin-store:execute-command': { method: 'executeCommand',        wrap: true },
}

for (const [channel, cfg] of Object.entries(pluginSimpleHandlers)) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const manager = ensurePluginManager()
      const result = await manager[cfg.method](...args)
      return cfg.wrap ? { success: true, ...(cfg.noData ? {} : { data: result }) } : result
    } catch (error) {
      console.error(`${channel} 失败:`, error)
      return cfg.wrap ? { success: false, error: error.message } : cfg.fallback
    }
  })
}

// 需要额外逻辑的插件 handler（保留手写）
ipcMain.handle('plugin-store:open-plugin-folder', async (event, pluginId) => {
  try {
    const manager = ensurePluginManager()
    const pluginPath = manager.getPluginPath(pluginId)
    if (!pluginPath) return { success: false, error: '插件未安装' }
    const { shell } = require('electron')
    await shell.openPath(pluginPath)
    return { success: true }
  } catch (error) {
    console.error('打开插件目录失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('plugin-store:open-plugins-directory', async () => {
  try {
    const { shell } = require('electron')
    const isDev = process.env.NODE_ENV === 'development'
    const localPluginsPath = isDev
      ? path.join(app.getAppPath(), 'plugins', 'examples')
      : path.join(process.resourcesPath, 'plugins', 'examples')
    await shell.openPath(localPluginsPath)
    return { success: true }
  } catch (error) {
    console.error('打开插件目录失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('plugin-store:load-plugin-file', async (event, pluginId, filePath) => {
  try {
    const manager = ensurePluginManager()
    const pluginPath = manager.getPluginPath(pluginId)
    if (!pluginPath) return { success: false, error: '插件未安装' }

    const safeSub = validateRelativePath(filePath.replace(/^\//, ''))
    const fullPath = path.join(pluginPath, safeSub)
    if (!fullPath.startsWith(path.resolve(pluginPath))) {
      return { success: false, error: '路径不合法' }
    }
    if (!fs.existsSync(fullPath)) return { success: false, error: '文件不存在' }

    const content = fs.readFileSync(fullPath, 'utf8')
    return { success: true, content, baseUrl: `file://${pluginPath}/` }
  } catch (error) {
    console.error(`读取插件文件失败: ${pluginId}/${filePath}`, error)
    return { success: false, error: error.message }
  }
})

// ==================== 云同步相关 IPC ====================
// 注意：这些旧的处理器已被删除，新的处理器在 SyncIPCHandler 中统一管理

// 数据库调试相关（用于排查持久化问题）
ipcMain.handle('db:get-info', async () => {
  try {
    const dbManager = DatabaseManager.getInstance()
    return dbManager.getInfo()
  } catch (err) {
    return { error: err?.message || 'unknown error' }
  }
})

// 数据库修复
ipcMain.handle('db:repair', async () => {
  try {
    const dbManager = DatabaseManager.getInstance()
    return await dbManager.repairDatabase()
  } catch (err) {
    getLogger().error('Main', '数据库修复失败', err)
    return { success: false, error: err?.message || 'unknown error' }
  }
})

// 打开日志目录
ipcMain.handle('log:open-dir', async () => {
  const { shell } = require('electron')
  const logPath = getLogger().getLogPath()
  await shell.openPath(logPath)
  return { success: true, path: logPath }
})

// ===== 表驱动 IPC（收益最大：大量透传/模板化） =====
registerIpcHandlers([
  // 笔记相关 IPC
  ...Object.entries({
    'note:create': 'createNote',
    'note:get-by-id': 'getNoteById',
    'note:get-all': 'getNotes',
    'note:get-pinned': 'getPinnedNotes',
    'note:get-deleted': 'getDeletedNotes',
    'note:get-recently-modified': 'getRecentlyModifiedNotes',
    'note:update': 'updateNote',
    'note:delete': 'deleteNote',
    'note:restore': 'restoreNote',
    'note:permanent-delete': 'permanentDeleteNote',
    'note:toggle-pin': 'togglePinNote',
    'note:search': 'searchNotes',
    'note:batch-update': 'batchUpdateNotes',
    'note:batch-delete': 'batchDeleteNotes',
    'note:batch-restore': 'batchRestoreNotes',
    'note:batch-permanent-delete': 'batchPermanentDeleteNotes',
    'note:batch-set-tags': 'batchSetTags',
    'note:get-stats': 'getStats',
    'note:export': 'exportNotes',
    'note:import': 'importNotes'
  }).map(([channel, methodName]) => ({
    channel,
    handler: createServicePassthroughHandler(() => services.noteService, methodName)
  })),
  {
    channel: 'note:auto-save',
    handler: async (event, id, content) => {
      return await services.noteService.autoSaveNote(id, { content })
    }
  },

  // 设置相关 IPC
  ...Object.entries({
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
  }).map(([channel, methodName]) => ({
    channel,
    handler: createServicePassthroughHandler(() => services.settingsService, methodName)
  })),
  {
    channel: 'setting:set',
    handler: async (event, key, value) => {
      // 自动推断类型
      let type = 'string'
      if (typeof value === 'boolean') {
        type = 'boolean'
      } else if (typeof value === 'number') {
        type = 'number'
      } else if (Array.isArray(value)) {
        type = 'array'
      } else if (typeof value === 'object' && value !== null) {
        type = 'object'
      }
      return await services.settingsService.setSetting(key, value, type)
    }
  }
])

// 开机自启相关IPC处理
ipcMain.handle('setting:set-auto-launch', async (event, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath
    })
    await services.settingsService.setSetting('autoLaunch', enabled, 'boolean', '开机自启')
    return { success: true }
  } catch (error) {
    console.error('设置开机自启失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('setting:get-auto-launch', async (event) => {
  try {
    const loginItemSettings = app.getLoginItemSettings()
    return loginItemSettings.openAtLogin
  } catch (error) {
    console.error('获取开机自启状态失败:', error)
    return false
  }
})

// 代理配置IPC处理
ipcMain.handle('proxy:get-config', async (event) => {
  const result = services.proxyService.getConfig();
  return { success: true, data: result };
})

ipcMain.handle('proxy:save-config', async (event, config) => {
  return services.proxyService.saveConfig(config);
})

ipcMain.handle('proxy:test', async (event, config) => {
  return services.proxyService.testConnection(config);
})

// 数据导入导出IPC处理
registerIpcHandlers(
  Object.entries({
    'data:export-notes': 'exportNotes',
    'data:export-settings': 'exportSettings',
    'data:import-notes': 'importNotes',
    'data:import-settings': 'importSettings',
    'data:import-folder': 'importFolder',
    'data:get-supported-formats': 'getSupportedFormats',
    'data:get-stats': 'getStats',
    'data:select-file': 'selectFile'
  }).map(([channel, methodName]) => ({
    channel,
    handler: createServicePassthroughHandler(() => services.dataImportService, methodName)
  }))
)

// Obsidian 导入导出 IPC 处理
registerIpcHandlers([
  {
    channel: 'data:import-obsidian-vault',
    handler: async (event, options) => {
      try {
        return await services.dataImportService.importObsidianVault(options)
      } catch (error) {
        console.error('导入 Obsidian vault 失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'data:export-to-obsidian',
    handler: async (event, options) => {
      try {
        return await services.dataImportService.exportToObsidian(options)
      } catch (error) {
        console.error('导出到 Obsidian 失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'data:get-importer-config',
    handler: async (event, importerName) => {
      try {
        const config = services.dataImportService.getImporterConfig(importerName)
        return { success: true, data: config }
      } catch (error) {
        console.error('获取导入器配置失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'data:update-importer-config',
    handler: async (event, { importerName, config }) => {
      try {
        const success = services.dataImportService.updateImporterConfig(importerName, config)
        return { success, data: success }
      } catch (error) {
        console.error('更新导入器配置失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'data:get-exporter-config',
    handler: async (event, exporterName) => {
      try {
        const config = services.dataImportService.getExporterConfig(exporterName)
        return { success: true, data: config }
      } catch (error) {
        console.error('获取导出器配置失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'data:update-exporter-config',
    handler: async (event, { exporterName, config }) => {
      try {
        const success = services.dataImportService.updateExporterConfig(exporterName, config)
        return { success, data: success }
      } catch (error) {
        console.error('更新导出器配置失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'data:get-available-importers-exporters',
    handler: async () => {
      try {
        const data = services.dataImportService.getAvailableImportersAndExporters()
        return { success: true, data }
      } catch (error) {
        console.error('获取可用导入导出器失败:', error)
        return { success: false, error: error.message }
      }
    }
  }
])

// 本地备份/恢复 IPC 处理
ipcMain.handle('backup:create', async () => {
  return await services.backupService.createBackup()
})

ipcMain.handle('backup:restore', async () => {
  return await services.backupService.restoreBackup()
})

// AI 相关 IPC 处理
const createTryCatchHandler = (serviceName, methodName, errorMsg) => {
  return async (event, ...args) => {
    try {
      const service = services[serviceName]
      return await service[methodName](...args)
    } catch (error) {
      console.error(`${errorMsg}:`, error)
      return { success: false, error: error.message }
    }
  }
}

registerIpcHandlers([
  { channel: 'ai:get-config', handler: createTryCatchHandler('aiService', 'getConfig', '获取AI配置失败') },
  { channel: 'ai:save-config', handler: createTryCatchHandler('aiService', 'saveConfig', '保存AI配置失败') },
  { channel: 'ai:test-connection', handler: createTryCatchHandler('aiService', 'testConnection', '测试AI连接失败') },
  { channel: 'ai:get-providers', handler: createTryCatchHandler('aiService', 'getProviders', '获取AI提供商列表失败') },
  { channel: 'ai:chat', handler: createTryCatchHandler('aiService', 'chat', 'AI聊天失败') }
])

// STT (Speech-to-Text) 相关 IPC 处理
registerIpcHandlers([
  { channel: 'stt:get-config', handler: createTryCatchHandler('sttService', 'getConfig', '获取STT配置失败') },
  { channel: 'stt:save-config', handler: createTryCatchHandler('sttService', 'saveConfig', '保存STT配置失败') },
  { channel: 'stt:test-connection', handler: createTryCatchHandler('sttService', 'testConnection', '测试STT连接失败') },
  {
    channel: 'stt:transcribe',
    handler: async (event, { audioFile, options }) => {
      try {
        let resolvedFile = audioFile
        // 渲染进程传来的 WAV buffer（用于 WebM 等需客户端解码的格式）
        if (Array.isArray(audioFile)) {
          resolvedFile = Buffer.from(audioFile)
        } else if (audioFile && typeof audioFile === 'string' && !path.isAbsolute(audioFile)) {
          // 相对路径（如 audio/xxx.m4a）→ 绝对路径
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

// Mem0 记忆管理相关 IPC 处理
registerIpcHandlers([
  {
    channel: 'mem0:add',
    handler: async (event, { userId, content, options }) => {
      try {
        return await services.mem0Service.addMemory(userId, content, options)
      } catch (error) {
        console.error('添加记忆失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'mem0:search',
    handler: async (event, { userId, query, options }) => {
      try {
        const results = await services.mem0Service.searchMemories(userId, query, options)
        return { success: true, results }
      } catch (error) {
        console.error('搜索记忆失败:', error)
        return { success: false, error: error.message, results: [] }
      }
    }
  },
  {
    channel: 'mem0:get',
    handler: async (event, { userId, options }) => {
      try {
        console.log('[Mem0] 获取记忆请求:', { userId, options })
        const memories = await services.mem0Service.getMemories(userId, options)
        console.log(`[Mem0] 返回 ${memories.length} 条记忆`)
        if (memories.length > 0) {
          console.log('[Mem0] 第一条记忆类别:', memories[0].category)
        }
        return { success: true, memories }
      } catch (error) {
        console.error('获取记忆列表失败:', error)
        return { success: false, error: error.message, memories: [] }
      }
    }
  },
  {
    channel: 'mem0:delete',
    handler: async (event, { memoryId }) => {
      try {
        const deleted = await services.mem0Service.deleteMemory(memoryId)
        return { success: deleted }
      } catch (error) {
        console.error('删除记忆失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'mem0:clear',
    handler: async (event, { userId }) => {
      try {
        const count = await services.mem0Service.clearUserMemories(userId)
        return { success: true, count }
      } catch (error) {
        console.error('清除记忆失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'mem0:stats',
    handler: async (event, { userId }) => {
      try {
        const stats = await services.mem0Service.getStats(userId)
        return { success: true, stats }
      } catch (error) {
        console.error('获取统计信息失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  {
    channel: 'mem0:is-available',
    handler: async () => {
      try {
        return { available: services.mem0Service.isAvailable() }
      } catch (error) {
        return { available: false }
      }
    }
  }
])

// 历史数据迁移 - 使用 migrationService 实现去重
ipcMain.handle('mem0:migrate-historical', async (event) => {
  try {
    console.log('[Mem0] 开始迁移历史数据(使用去重服务)...')
    const userId = 'current_user'
    const result = await services.migrationService.migrateAll(userId)
    console.log('[Mem0] 迁移完成:', result)
    return result
  } catch (error) {
    console.error('[Mem0] 迁移历史数据失败:', error)
    return { success: false, error: error.message, memoryCount: 0, skippedCount: 0 }
  }
})

// ===== 云同步相关 IPC：已由 SyncIPCHandler 统一管理 =====

// 窗口管理IPC处理
registerIpcHandlers([
  // 窗口管理 IPC
  {
    channel: 'window:ready',
    handler: async () => {
      // 页面已准备就绪的通知（由 dom-ready 事件自动处理显示，此处仅作确认）
      console.log('收到窗口准备就绪通知')
      return true
    }
  },
  {
    // 渲染进程启动后拉取大体积初始化数据（避免 URL 超长 431 错误）
    channel: 'window:get-init-data',
    handler: async (event) => {
      try {
        const win = require('electron').BrowserWindow.fromWebContents(event.sender)
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
    }
  },
  {
    channel: 'window:minimize',
    handler: async (event) => {
      const window = getEventWindow(event)
      if (window) window.minimize()
      return true
    }
  },
  {
    channel: 'window:maximize',
    handler: async (event) => {
      const window = getEventWindow(event)
      if (window) {
        if (window.isMaximized()) {
          window.unmaximize()
        } else {
          window.maximize()
        }
      }
      return true
    }
  },
  {
    channel: 'window:close',
    handler: async (event) => {
      const window = getEventWindow(event)
      if (window) window.close()
      return true
    }
  },
  {
    channel: 'window:hide',
    handler: async (event) => {
      const window = getEventWindow(event)
      if (window) window.hide()
      return true
    }
  },
  {
    channel: 'window:show',
    handler: async (event) => {
      const window = getEventWindow(event)
      if (window) window.show()
      return true
    }
  },
  {
    channel: 'window:focus',
    handler: async (event) => {
      const window = getEventWindow(event)
      if (window) window.focus()
      return true
    }
  },
  {
    channel: 'window:is-maximized',
    handler: async (event) => {
      const window = getEventWindow(event)
      return window ? window.isMaximized() : false
    }
  },
  {
    channel: 'window:is-minimized',
    handler: async (event) => {
      const window = getEventWindow(event)
      return window ? window.isMinimized() : false
    }
  },
  {
    channel: 'window:is-visible',
    handler: async (event) => {
      const window = getEventWindow(event)
      return window ? window.isVisible() : false
    }
  },
  {
    channel: 'window:is-focused',
    handler: async (event) => {
      const window = getEventWindow(event)
      return window ? window.isFocused() : false
    }
  },
  {
    channel: 'window:get-bounds',
    handler: async (event) => {
      const window = getEventWindow(event)
      return window ? window.getBounds() : null
    }
  },
  {
    channel: 'window:set-bounds',
    handler: async (event, bounds) => {
      const window = getEventWindow(event)
      if (window) window.setBounds(bounds)
      return true
    }
  },
  {
    channel: 'window:get-size',
    handler: async (event) => {
      const window = getEventWindow(event)
      return window ? window.getSize() : null
    }
  },
  {
    channel: 'window:set-size',
    handler: async (event, width, height) => {
      const window = getEventWindow(event)
      if (window) window.setSize(width, height)
      return true
    }
  },
  {
    channel: 'window:get-position',
    handler: async (event) => {
      const window = getEventWindow(event)
      return window ? window.getPosition() : null
    }
  },
  {
    channel: 'window:set-position',
    handler: async (event, x, y) => {
      const window = getEventWindow(event)
      if (window) window.setPosition(x, y)
      return true
    }
  },
  {
    channel: 'window:create-floating-ball',
    handler: async () => {
      return await windowManager.createFloatingBall()
    }
  },
  {
    channel: 'window:create-note-window',
    handler: async (event, noteId, options) => {
      return await windowManager.createNoteWindow(noteId, options)
    }
  },
  {
    channel: 'window:is-note-open',
    handler: async (event, noteId) => {
      try {
        const isOpen = windowManager.isNoteOpenInWindow(noteId)
        return { success: true, isOpen }
      } catch (error) {
        console.error('检查笔记窗口状态失败:', error)
        return { success: false, error: error.message, isOpen: false }
      }
    }
  },
  {
    channel: 'window:create-todo-window',
    handler: async (event, todoListId) => {
      return await windowManager.createTodoWindow(todoListId)
    }
  },
  {
    channel: 'window:get-all',
    handler: async () => {
      return windowManager.getAllWindows()
    }
  },
  {
    channel: 'window:get-by-id',
    handler: async (event, id) => {
      return windowManager.getWindowById(id)
    }
  },
  {
    channel: 'window:close-window',
    handler: async (event, id) => {
      return windowManager.closeWindow(id)
    }
  }
])

ipcMain.handle('window:toggle-dev-tools', async (event) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      // 检查开发者工具是否已打开
      if (window.webContents.isDevToolsOpened()) {
        // 如果已打开，则关闭
        window.webContents.closeDevTools()
        console.log('[Main] 开发者工具已关闭')
      } else {
        // 如果未打开，则打开
        window.webContents.openDevTools()
        console.log('[Main] 开发者工具已打开')
      }
      return { success: true }
    } else {
      return { success: false, error: '窗口不存在' }
    }
  } catch (error) {
    console.error('切换开发者工具失败:', error)
    return { success: false, error: error.message }
  }
})

// 网络状态 IPC
ipcMain.handle('network:is-online', () => {
  return services.networkService ? services.networkService.isOnline : true
})

ipcMain.handle('network:get-offline-queue-length', () => {
  return services.offlineSyncQueue ? services.offlineSyncQueue.length : 0
})

// 系统相关IPC处理
registerIpcHandlers([
  // 系统相关 IPC
  { channel: 'system:get-platform', handler: async () => process.platform },
  { channel: 'system:get-version', handler: async () => app.getVersion() },
  { channel: 'system:get-path', handler: async (event, name) => app.getPath(name) },
  {
    channel: 'system:show-open-dialog',
    handler: async (event, options) => {
      const window = getEventWindow(event)
      return await dialog.showOpenDialog(window, options)
    }
  },
  {
    channel: 'system:show-save-dialog',
    handler: async (event, options) => {
      const window = getEventWindow(event)
      return await dialog.showSaveDialog(window, options)
    }
  },
  {
    channel: 'system:show-message-box',
    handler: async (event, options) => {
      const window = getEventWindow(event)
      return await dialog.showMessageBox(window, options)
    }
  },
  {
    channel: 'system:write-text',
    handler: async (event, text) => {
      clipboard.writeText(text)
      return true
    }
  },
  { channel: 'system:read-text', handler: async () => clipboard.readText() }
])

ipcMain.handle('system:show-notification', async (event, options) => {
  // 确保通知包含应用图标
  if (!options.icon) {
    const iconPath = isDev
      ? path.join(__dirname, '../logo.png')
      : path.join(process.resourcesPath, 'logo.png')

    if (fs.existsSync(iconPath)) {
      options.icon = nativeImage.createFromPath(iconPath)
    }
  }

  const notification = new Notification(options)
  notification.show()
  return { success: true }
})



// 打开数据文件夹
ipcMain.handle('system:open-data-folder', async (event) => {
  try {
    const dbManager = DatabaseManager.getInstance()
    const dbPath = dbManager.getDatabasePath()
    const dbDir = path.dirname(dbPath)

    await shell.openPath(dbDir)
    return { success: true }
  } catch (error) {
    console.error('打开数据文件夹失败:', error)
    return { success: false, error: error.message }
  }
})

// 打开外部链接
ipcMain.handle('system:open-external', async (event, url) => {
  try {
    validateUrl(url)
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('打开外部链接失败:', error)
    return { success: false, error: error.message }
  }
})

// 悬浮球相关IPC处理
ipcMain.handle('floating-ball:create', async (event) => {
  try {
    await windowManager.createFloatingBall()
    return { success: true }
  } catch (error) {
    console.error('创建悬浮球失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('floating-ball:hide', async (event) => {
  try {
    if (windowManager.floatingBall) {
      windowManager.floatingBall.hide()
    }
    return { success: true }
  } catch (error) {
    console.error('隐藏悬浮球失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('floating-ball:show', async (event) => {
  try {
    if (windowManager.floatingBall) {
      windowManager.floatingBall.show()
    }
    return { success: true }
  } catch (error) {
    console.error('显示悬浮球失败:', error)
    return { success: false, error: error.message }
  }
})

// 读取图片文件并转换为base64
ipcMain.handle('system:read-image-as-base64', async (event, filePath) => {
  try {
    validatePath(filePath)
    const imageData = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase().substring(1)
    const mimeType = {
      'jpg': 'jpeg',
      'jpeg': 'jpeg',
      'png': 'png',
      'gif': 'gif',
      'bmp': 'bmp',
      'webp': 'webp'
    }[ext] || 'jpeg'

    const base64Image = `data:image/${mimeType};base64,${imageData.toString('base64')}`
    return base64Image
  } catch (error) {
    console.error('读取图片文件失败:', error)
    throw new Error('读取图片文件失败: ' + error.message)
  }
})

// 标签相关IPC处理
registerIpcHandlers([
  ...Object.entries({
    'tag:get-all': 'getAllTags',
    'tag:search': 'searchTags',
    'tag:get-suggestions': 'getTagSuggestions',
    'tag:get-stats': 'getTagStats',
    'tag:delete': 'deleteTag',
    'tag:cleanup': 'cleanupUnusedTags',
    'tag:recalculate-usage': 'recalculateTagUsage'
  }).map(([channel, methodName]) => ({
    channel,
    handler: createServicePassthroughHandler(() => services.tagService, methodName)
  })),
  {
    channel: 'tag:get-popular',
    handler: async (event, limit) => {
      return await services.tagService.getAllTags({ limit, orderBy: 'usage_count', order: 'DESC' })
    }
  },
  {
    channel: 'tags:getPopular',
    handler: async (event, limit) => {
      return await services.tagService.getPopularTags(limit)
    }
  }
])

registerIpcHandlers([{
  channel: 'tag:batch-delete',
  handler: async (event, tagNames) => {
    const results = []
    for (const tagName of tagNames) {
      const result = await services.tagService.deleteTag(tagName)
      results.push(result)
    }
    return { success: true, data: results }
  }
}])

// 快捷键相关的IPC处理程序
const createShortcutHandler = (methodName, errorMsg) => {
  return async (event, ...args) => {
    try {
      if (!shortcutService) {
        throw new Error('快捷键服务未初始化')
      }
      const result = await shortcutService[methodName](...args)
      return { success: true, data: result }
    } catch (error) {
      console.error(`${errorMsg}:`, error)
      return { success: false, error: error.message }
    }
  }
}

registerIpcHandlers([
  { channel: 'shortcut:update', handler: createShortcutHandler('updateShortcut', '更新快捷键失败') },
  { channel: 'shortcut:reset', handler: createShortcutHandler('resetShortcut', '重置快捷键失败') },
  { channel: 'shortcut:reset-all', handler: createShortcutHandler('resetAllShortcuts', '重置所有快捷键失败') },
  { channel: 'shortcut:get-all', handler: createShortcutHandler('getAllShortcuts', '获取快捷键配置失败') }
])

// 图片相关 IPC 处理器
const createImageServiceHandler = (methodName, errorMsg, wrapData = true) => {
  return async (event, ...args) => {
    try {
      const result = await services.imageService[methodName](...args)
      return wrapData ? { success: true, data: result } : result
    } catch (error) {
      console.error(`${errorMsg}:`, error)
      return { success: false, error: error.message }
    }
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
  { channel: 'image:save-from-path', handler: createImageServiceHandler('saveImageFromPath', '从路径保存图片失败') }
])

// ── 音频文件保存 ──
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
        } else {
          return { success: false, error: '图片文件不存在' }
        }
      } catch (error) {
        console.error('获取图片路径失败:', error)
        return { success: false, error: error.message }
      }
    }
  },
  { channel: 'image:get-base64', handler: createImageServiceHandler('getBase64', '获取图片base64失败') },
  { channel: 'image:delete', handler: createImageServiceHandler('deleteImage', '删除图片失败') }
])

// 白板图片存储 IPC 处理器
ipcMain.handle('whiteboard:save-images', async (event, files) => {
  try {
    const imageStorage = getImageStorageInstance()
    const fileMap = await imageStorage.saveWhiteboardImages(files)

    // 自动上传新保存的图片到云端（V3 同步）
    try {
      const { getInstance: getV3SyncService } = require('./services/sync/V3SyncService')
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
            // 不阻塞保存流程
          }
        })

        // 后台上传，不阻塞保存
        Promise.all(uploadPromises).catch(err =>
          console.error('[图片自动上传] 批量上传出错:', err)
        )
      }
    } catch (error) {
      console.error('[图片自动上传] 初始化失败:', error)
      // 不阻塞保存流程
    }

    return { success: true, data: fileMap }
  } catch (error) {
    console.error('保存白板图片失败:', error)
    return { success: false, error: error.message }
  }
})

// 简单委托的白板 handler（表驱动）
const whiteboardSimpleHandlers = {
  'whiteboard:load-images':      { method: 'loadWhiteboardImages' },
  'whiteboard:load-image':       { method: 'loadWhiteboardImage' },
  'whiteboard:delete-images':    { method: 'deleteWhiteboardImages', noData: true },
  'whiteboard:get-storage-stats':{ method: 'getStorageStats' },
}

for (const [channel, cfg] of Object.entries(whiteboardSimpleHandlers)) {
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

// 保存白板预览图（PNG），供移动端只读查看
ipcMain.handle('whiteboard:save-preview', async (event, { syncId, pngBase64 }) => {
  try {
    if (!syncId || !pngBase64) return { success: false, error: '参数缺失' }
    const previewDir = path.join(app.getPath('userData'), 'images', 'whiteboard-preview')
    await require('fs').promises.mkdir(previewDir, { recursive: true })
    const filePath = path.join(previewDir, `${syncId}.png`)
    const buffer = Buffer.from(pngBase64, 'base64')
    await require('fs').promises.writeFile(filePath, buffer)

    // 自动上传预览图到云端（V3 同步）
    try {
      const { getInstance: getV3SyncService } = require('./services/sync/V3SyncService')
      const v3Service = getV3SyncService()
      if (v3Service && v3Service.isEnabled && v3Service.uploadImage) {
        const relativePath = `images/whiteboard-preview/${syncId}.png`
        v3Service.uploadImage(filePath, relativePath).catch(err =>
          console.error('[白板预览上传] 失败:', err)
        )
      }
    } catch (_) { /* 不阻塞 */ }

    return { success: true }
  } catch (error) {
    console.error('保存白板预览图失败:', error)
    return { success: false, error: error.message }
  }
})

// 图片云同步相关 IPC 处理器
ipcMain.handle('sync:download-image', async (event, relativePath) => {
  try {
    const { getInstance: getV3SyncService } = require('./services/sync/V3SyncService')
    const v3Service = getV3SyncService()

    if (!v3Service || !v3Service.isEnabled) {
      return { success: false, error: '云同步服务未启用' }
    }

    // 保留完整子目录结构 (images/whiteboard/xxx, images/whiteboard-preview/xxx 等)
    const localPath = path.join(app.getPath('userData'), relativePath)
    await require('fs').promises.mkdir(path.dirname(localPath), { recursive: true })

    await v3Service.downloadImage(relativePath, localPath)
    return { success: true }
  } catch (error) {
    console.error('下载图片失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('sync:upload-image', async (event, localPath, relativePath) => {
  try {
    const { getInstance: getV3SyncService } = require('./services/sync/V3SyncService')
    const v3Service = getV3SyncService()

    if (!v3Service || !v3Service.isEnabled) {
      return { success: false, error: '云同步服务未启用' }
    }

    await v3Service.uploadImage(localPath, relativePath)
    return { success: true }
  } catch (error) {
    console.error('上传图片失败:', error)
    return { success: false, error: error.message }
  }
})

// ===== 以下图片管理功能已废弃，V3 同步系统不再需要这些功能 =====
// sync:sync-images - V3 自动同步图片，无需手动批量同步

// 图片清理功能 - V3 同步集成版本
const syncCleanupHandlers = {
  'sync:get-unused-images-stats': 'getUnusedImagesStats',
  'sync:cleanup-unused-images':   'cleanupUnusedImages',
}

for (const [channel, method] of Object.entries(syncCleanupHandlers)) {
  ipcMain.handle(channel, async (event, retentionDays = 30) => {
    try {
      const v3Service = require('./services/sync/V3SyncService').getInstance()
      return await v3Service[method](retentionDays)
    } catch (error) {
      console.error(`${channel} 失败:`, error)
      return { success: false, error: error.message }
    }
  })
}

// 应用退出时清理资源
let isQuittingApp = false;
app.on('before-quit', async (event) => {
  app.isQuiting = true;

  if (!isQuittingApp) {
    event.preventDefault();
    isQuittingApp = true;

    try {
      console.log('[App] 开始应用退出流程...');

      // 0. 清理托盘 + 触发记忆迁移
      if (tray) { tray.destroy(); tray = null; }
      if (services.migrationService) {
        services.migrationService.triggerMigrationOnQuit().catch(err => {
          console.error('[App] 退出前迁移失败:', err);
        });
      }

      // 1. 通知所有窗口保存数据
      const allWindows = BrowserWindow.getAllWindows();
      const savePromises = allWindows.map(async (window) => {
        if (!window.isDestroyed()) {
          try {
            await window.webContents.executeJavaScript(`
              (async () => {
                if (window.__saveBeforeClose) {
                  await window.__saveBeforeClose();
                  return true;
                }
                return false;
              })();
            `);
          } catch (error) {
            console.error('[App] 窗口保存失败:', error);
          }
        }
      });

      await Promise.all(savePromises);
      console.log('[App] 所有窗口数据已保存');

      // 2. 等待一些额外时间确保保存完成
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. 强制销毁所有窗口（使用 destroy 而不是 close，避免 close 事件的 preventDefault 阻止关闭）
      const remainingWindows = BrowserWindow.getAllWindows();
      for (const window of remainingWindows) {
        if (!window.isDestroyed()) {
          console.log('[App] 强制销毁窗口');
          window.destroy();
        }
      }

      // 4. 关闭数据库连接
      const dbManager = DatabaseManager.getInstance();
      await dbManager.close();
      console.log('[App] 应用资源清理完成');

      // 5. 真正退出应用
      app.quit();
    } catch (error) {
      console.error('[App] 应用退出清理失败:', error);
      // 即使失败也强制退出
      app.exit(0);
    }
  }
});