const { app, BrowserWindow, Notification, shell, Tray, Menu, nativeImage, protocol, nativeTheme, net, session } = require('electron')
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
      // standard=true 才会被 Chromium 视为“标准协议”，从而支持对 app:// 进行 CORS/fetch。
      // 否则会出现：Cross origin requests are only supported for protocol schemes: ... (不含 app)
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
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
const ConversationService = require('./services/ConversationService')
const WindowManager = require('./services/WindowManager')
const DataImportService = require('./services/DataImportService')
const BackupService = require('./services/BackupService')
const ShortcutService = require('./services/ShortcutService')
const NotificationService = require('./services/NotificationService')
const ImageService = require('./services/ImageService')
const PluginManager = require('./services/PluginManager')
const AIService = require('./services/AIService')
const AIChatService = require('./services/aichat')
const WebSearchService = require('./services/websearch')
const MCPDownloader = require('./services/MCPDownloader')
const { setupMCPHandlers } = require('./ipc/mcpHandlers')
const STTService = require('./services/STTService')
const Mem0Service = require('./services/Mem0Service')
const HistoricalDataMigrationService = require('./services/HistoricalDataMigrationService')
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
const activeAIStreams = new Map()
let cspConfigured = false

function setupContentSecurityPolicy() {
  if (cspConfigured) return
  cspConfigured = true

  const scriptSrc = isDev
    ? "'self' 'unsafe-eval' app: http://localhost:5174"
    : "'self' app:"
  const connectSrc = isDev
    ? "'self' app: https: http://localhost:* ws://localhost:*"
    : "'self' app: https:"
  const csp = [
    "default-src 'self' app:",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' app: data: blob: https: http:",
    "font-src 'self' data:",
    "media-src 'self' app: data: blob: https: http:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 开发模式下主窗口加载 Vite dev server（http://localhost:5174），
    // Vite/react 会注入 inline script 作为 preamble；如果我们强行覆盖 CSP，会导致
    // “@vitejs/plugin-react can't detect preamble” 以及 inline script 被拦截。
    if (isDev && typeof details.url === 'string' && details.url.startsWith('http://localhost:5174')) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

function createWindow() {
  setupContentSecurityPolicy()

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
  const winIconPath = isDev
    ? path.join(__dirname, '../build/logo.ico')
    : path.join(process.resourcesPath, 'build/logo.ico')

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 600,
    icon: fs.existsSync(winIconPath) ? winIconPath : undefined,
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

  // 拦截当前 webContents 的内部导航（例如 a[href] 直点、location.href、SSO 重定向），
  // 任何离开 app 自己的 origin 的 http(s) 跳转都改用系统浏览器打开。
  // 仅 setWindowOpenHandler 不够：内部导航不会触发新窗口。
  const isInternalUrl = (url) => {
    if (!url) return true
    if (url.startsWith('app:')) return true
    if (url.startsWith('file://')) return true
    if (isDev && url.startsWith('http://localhost:5174')) return true
    return false
  }

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (isInternalUrl(navigationUrl)) return
    if (navigationUrl.startsWith('http://') || navigationUrl.startsWith('https://')) {
      event.preventDefault()
      console.log('[Main] 拦截内部导航至外部链接:', navigationUrl)
      shell.openExternal(navigationUrl)
    }
  })

  mainWindow.webContents.on('will-redirect', (event, navigationUrl) => {
    if (isInternalUrl(navigationUrl)) return
    if (navigationUrl.startsWith('http://') || navigationUrl.startsWith('https://')) {
      event.preventDefault()
      console.log('[Main] 拦截重定向至外部链接:', navigationUrl)
      shell.openExternal(navigationUrl)
    }
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

      // 正式版应用内禁用 Electron 原生右键菜单（统一由前端自定义菜单处理）
      mainWindow.webContents.on('context-menu', (event) => {
        event.preventDefault()
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
    const macTemplatePngPath = isDev
      ? path.join(__dirname, '../logomac.png')
      : path.join(process.resourcesPath, 'logomac.png')

    let trayIcon = null

    // macOS: 使用 template image（单色，跟随系统深浅色），并使用更合适的 16px 托盘尺寸
    if (process.platform === 'darwin') {
      if (fs.existsSync(macTemplatePngPath)) {
        const raw = nativeImage.createFromPath(macTemplatePngPath)
        if (!raw.isEmpty()) {
          // 关键点：
          // - macOS 菜单栏托盘图标“外圈阴影/占位”跟最终图标尺寸强相关
          // - 用户希望“图形更大”但“占位/阴影不变”，因此不能简单把最终尺寸放大
          // - 方案：按 alpha 通道自动裁掉透明留白，再等比缩放到 16px 以内
          //   (不强行裁成正方形，避免把左右图形截断)
          let img = raw
          try {
            const { width, height } = raw.getSize()
            const buf = raw.toBitmap()
            if (buf && buf.length >= width * height * 4) {
              // Heuristic alpha threshold; ignore near-transparent pixels.
              const alphaThreshold = 16
              let minX = width,
                minY = height,
                maxX = -1,
                maxY = -1

              for (let y = 0; y < height; y++) {
                const row = y * width * 4
                for (let x = 0; x < width; x++) {
                  const a = buf[row + x * 4 + 3]
                  if (a > alphaThreshold) {
                    if (x < minX) minX = x
                    if (y < minY) minY = y
                    if (x > maxX) maxX = x
                    if (y > maxY) maxY = y
                  }
                }
              }

              if (maxX >= 0 && maxY >= 0) {
                // Add a tiny padding so strokes don't touch the edge after resize.
                const pad = Math.max(1, Math.round(Math.min(width, height) * 0.01))
                const x0 = Math.max(0, minX - pad)
                const y0 = Math.max(0, minY - pad)
                const x1 = Math.min(width - 1, maxX + pad)
                const y1 = Math.min(height - 1, maxY + pad)
                const cropW = Math.max(1, x1 - x0 + 1)
                const cropH = Math.max(1, y1 - y0 + 1)
                img = raw.crop({ x: x0, y: y0, width: cropW, height: cropH })
              }
            }
          } catch (_) {
            // If pixel scanning/crop fails, fall back to original image.
            img = raw
          }

          // Fit into 16x16 while preserving aspect ratio (avoid distortion/clipping).
          try {
            const s = img.getSize()
            const scale = Math.min(16 / s.width, 16 / s.height)
            const w = Math.max(1, Math.round(s.width * scale))
            const h = Math.max(1, Math.round(s.height * scale))
            trayIcon = img.resize({ width: w, height: h })
          } catch (_) {
            trayIcon = img.resize({ width: 16, height: 16 })
          }
          trayIcon.setTemplateImage(true)
        }
      }
    }

    // 优先使用多尺寸 ICO（含 16/32/48 等标准 Windows 尺寸）
    if (!trayIcon && fs.existsSync(icoPath)) {
      trayIcon = nativeImage.createFromPath(icoPath)
    }
    // ICO 加载失败则用 PNG 缩放到 32x32
    if (!trayIcon || trayIcon.isEmpty()) {
      if (fs.existsSync(pngPath)) {
        const raw = nativeImage.createFromPath(pngPath)
        if (!raw.isEmpty()) {
          const size = process.platform === 'darwin' ? 16 : 32
          trayIcon = raw.resize({ width: size, height: size })
          if (process.platform === 'darwin') trayIcon.setTemplateImage(true)
        }
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
              title: '',
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
    services.conversationService = new ConversationService()
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
    services.webSearchService = new WebSearchService(services.aiService)
    // AI Chat 助手服务（需在 mem0Service 初始化后设置）
    services.aiChatService = null // 延迟到后面初始化
    
    const dbPath = path.join(app.getPath('userData'), 'database', 'flota.db')
    const appDataPath = app.getPath('userData')
    services.mem0Service = new Mem0Service(dbPath, appDataPath)
    services.migrationService = new HistoricalDataMigrationService(services.mem0Service, services.aiService)

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
      // 初始化 AI Chat 助手服务
      services.aiChatService = new AIChatService(
        services.aiService, services.noteDAO, services.todoDAO, services.mem0Service,
        services.webSearchService
      )
      services.aiChatService.setCurrentNoteGetter(async () => {
        // 通过 IPC 向渲染进程请求当前笔记ID，再从DAO获取
        try {
          const win = BrowserWindow.getAllWindows()[0]
          if (!win) return null
          const noteId = await win.webContents.executeJavaScript(
            'window.__currentSelectedNoteId || null'
          )
          if (!noteId) return null
          return services.noteDAO.findById(noteId)
        } catch (_) { return null }
      })
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

    // 初始化窗口管理器
    windowManager = new WindowManager(services.settingsService)
    services.notificationService.setWindowManager(windowManager)

    // windowManager 就绪后再注册依赖它的 IPC 处理器，避免闭包捕获 undefined
    const { registerWindowHandlers } = require('./ipc/windowHandlers')
    registerWindowHandlers(windowManager)

    windowManager.on('todo-reminder-action', ({ type, todo, minutes }) => {
      try {
        if (type === 'complete') {
          const updatedTodo = services.todoService.toggleTodoComplete(todo.id)
          services.todoService.emit('todo-updated', updatedTodo)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('todo:changed', updatedTodo)
          }
        } else if (type === 'snooze') {
          services.notificationService.snoozeTodo(todo.id, minutes || 10)
        } else if (type === 'open') {
          services.notificationService.emit('notification-clicked', todo)
        }
      } catch (error) {
        console.error('处理待办提醒操作失败:', error)
      }
    })

    // 窗口管理器就绪后启动提醒，确保首次检查也使用应用内窗口
    services.notificationService.start()

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

### 画布笔记
- **Excalidraw 集成**：创建画布笔记，支持手绘图形和流程图
- **素材库支持**：使用内置素材库或浏览在线素材库
- **独立窗口优化**：支持拖拽画布笔记到独立窗口中编辑
- **PNG 导出**：一键导出画布为高清图片

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
- **创建画布**：选择"画布笔记"类型，使用 Excalidraw 进行创作
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
  - [ ] 创建第一个画布笔记
  - [ ] 尝试插件系统
  - [ ] 探索更多功能

### 画布功能
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
1. 创建你的第一个画布笔记
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
        // app://plugin/<pluginId>/<relPath> -> 插件目录下的资源
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

        // 插件资源分支：app://plugin/<pluginId>/<relPath>
        if (normalized.startsWith('plugin/') || normalized.startsWith('plugin' + path.sep)) {
          const rest = normalized.slice('plugin/'.length).split(/[\\/]/)
          const pluginId = rest.shift()
          const subPath = rest.join('/')
          if (!pluginId || !subPath) {
            return new Response('Bad Request', { status: 400 })
          }
          if (!pluginManager) {
            return new Response('Plugin manager not ready', { status: 503 })
          }
          const snapshot = pluginManager.getPluginStateSnapshot(pluginId)
          if (!snapshot || !snapshot.enabled) {
            return new Response('Plugin disabled', { status: 404 })
          }
          const pluginPath = pluginManager.getPluginPath(pluginId)
          if (!pluginPath) {
            return new Response('Plugin not found', { status: 404 })
          }
          const fullPluginPath = path.resolve(pluginPath)
          const resolved = path.resolve(path.join(fullPluginPath, subPath))
          if (!resolved.startsWith(fullPluginPath + path.sep) && resolved !== fullPluginPath) {
            return new Response('Forbidden', { status: 403 })
          }
          if (!fs.existsSync(resolved)) {
            return new Response('File not found', { status: 404 })
          }
          const ext = path.extname(resolved).toLowerCase()
          const pluginMime = {
            '.js': 'text/javascript; charset=utf-8',
            '.mjs': 'text/javascript; charset=utf-8',
            '.jsx': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.html': 'text/html; charset=utf-8',
            '.txt': 'text/plain; charset=utf-8'
          }[ext] || 'application/octet-stream'
          const data = fs.readFileSync(resolved)
          const headers = {
            'Content-Type': pluginMime,
            'Cache-Control': 'no-cache'
          }
          const origin = request?.headers?.get?.('origin') || ''
          if (isDev && (origin === 'http://localhost:5174' || origin === 'http://127.0.0.1:5174')) {
            headers['Access-Control-Allow-Origin'] = origin
            headers['Vary'] = 'Origin'
          }
          return new Response(data, { headers })
        }

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

        // 开发环境下，渲染层来自 Vite dev server（http://localhost:5174），
        // fetch(app://images/...) 会走 CORS；这里仅对 dev origin 放行。
        const origin = request?.headers?.get?.('origin') || ''
        const allowDevOrigin =
          isDev && (origin === 'http://localhost:5174' || origin === 'http://127.0.0.1:5174')

        // 音频文件：用 net.fetch 代理本地文件，自动处理 Range/Content-Length/streaming
        if (mimeType.startsWith('audio/')) {
          const fileUrl = 'file://' + fullPath.replace(/\\/g, '/')
          return net.fetch(fileUrl, { headers: request.headers })
        }

        // 使用流式读取，提升大文件性能
        const data = fs.readFileSync(fullPath)
        
        const isWallpaper = relativePath.startsWith('wallpaper/')
        console.log('[Protocol] 返回文件，MIME:', mimeType)
        const headers = {
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': isWallpaper ? 'no-cache' : 'public, max-age=31536000'
        }

        if (allowDevOrigin) {
          headers['Access-Control-Allow-Origin'] = origin
          headers['Vary'] = 'Origin'
        }

        return new Response(data, {
          headers
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

const { validateRelativePath } = require('./utils/ipcValidator')
const { registerAIHandlers } = require('./ipc/aiHandlers')
const { registerMem0Handlers } = require('./ipc/mem0Handlers')
const { registerPluginStoreHandlers } = require('./ipc/pluginStoreHandlers')
const { registerSystemMiscHandlers } = require('./ipc/systemMiscHandlers')
const { registerSystemHandlers } = require('./ipc/systemHandlers')
const { registerShortcutHandlers } = require('./ipc/shortcutHandlers')
const { registerAttachmentsHandlers } = require('./ipc/attachmentsHandlers')
const { registerMediaHandlers } = require('./ipc/mediaHandlers')
const { registerWhiteboardHandlers } = require('./ipc/whiteboardHandlers')
const { registerNoteHandlers } = require('./ipc/noteHandlers')
const { registerExportHandlers } = require('./ipc/exportHandlers')
const { registerConversationHandlers } = require('./ipc/conversationHandlers')
const { registerSettingHandlers } = require('./ipc/settingHandlers')
const { registerDataIOHandlers } = require('./ipc/dataIOHandlers')
const { registerTagHandlers } = require('./ipc/tagHandlers')
const { registerSttHandlers } = require('./ipc/sttHandlers')

// 插件商店相关
const ensurePluginManager = () => {
  if (!pluginManager) {
    throw new Error('插件管理器尚未初始化')
  }
  return pluginManager
}

registerPluginStoreHandlers(ensurePluginManager, validateRelativePath)

// ==================== 云同步相关 IPC ====================
// 注意：这些旧的处理器已被删除，新的处理器在 SyncIPCHandler 中统一管理

// 数据库 / 日志 / 设置自启 / 代理 / 备份 / 网络
registerSystemMiscHandlers(services, getLogger)

// 笔记 / 设置 IPC
registerNoteHandlers(services)
registerExportHandlers()
registerConversationHandlers(services)
registerSettingHandlers(services)

// 开机自启 / 代理 已迁至 systemMiscHandlers

// 数据导入导出 / Obsidian IPC
registerDataIOHandlers(services)

// 本地备份/恢复 已迁至 systemMiscHandlers

// AI 相关 IPC 处理
registerAIHandlers(services, activeAIStreams)

// STT 相关 IPC
registerSttHandlers(services)

// Mem0 记忆管理相关 IPC 处理
registerMem0Handlers(services)

// 窗口管理 / 开发者工具 / 网络状态 已迁至 windowHandlers + systemMiscHandlers
// 注意：registerWindowHandlers 在 app.whenReady 中 windowManager 创建后调用

// 应用更新检查 / 系统相关 IPC 已迁至 ipc/systemHandlers.js
registerSystemHandlers({ isDev })

// 标签相关 IPC
registerTagHandlers(services)

// 快捷键 / 图片 / 音频 / 附件 / 画布 已迁至独立 ipc 模块
registerShortcutHandlers(() => services.shortcutService)
registerMediaHandlers(services)
registerAttachmentsHandlers(services)
registerWhiteboardHandlers()

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
