const { BrowserWindow, screen, shell } = require('electron');
const { EventEmitter } = require('events');
const path = require('path');
const http = require('http');
const isDev = process.env.NODE_ENV === 'development';

class WindowManager extends EventEmitter {
  constructor(settingsService) {
    super();
    this.settingsService = settingsService;
    this.windows = new Map(); // 存储所有窗口
    this.noteWindows = new Map(); // 存储笔记ID到窗口ID的映射
    this.pendingWindowData = new Map(); // 待渲染进程拉取的初始化数据
    this.mainWindow = null;
    this.floatingWindow = null;
    this.quickInputWindow = null;
  }

  /**
   * 检查Vite开发服务器是否可用
   */
  async checkViteServer() {
    if (!isDev) return true;

    return new Promise((resolve) => {
      console.log('检查 Vite 服务器状态...');
      const req = http.get('http://localhost:5174/', (res) => {
        console.log(`Vite 服务器响应状态: ${res.statusCode}`);
        resolve(res.statusCode === 200);
      });

      req.on('error', (error) => {
        console.error('Vite服务器连接失败:', error.message);
        resolve(false);
      });

      req.setTimeout(8000, () => {
        console.error('Vite服务器连接超时 (8秒)');
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 创建主窗口
   */
  async createMainWindow() {
    try {
      // 获取窗口设置
      const windowSettings = await this.settingsService.getWindowSettings();
      const bounds = this.calculateWindowBounds(windowSettings.data);

      // 创建主窗口
      this.mainWindow = new BrowserWindow({
        ...bounds,
        minWidth: 800,
        minHeight: 600,
        show: false, // 先不显示，等加载完成后再显示
        icon: this.getAppIcon(),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, '../preload.js'),
          webSecurity: true,
          allowRunningInsecureContent: false
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        frame: false,
        transparent: false,
        hasShadow: true,
        resizable: true,
        maximizable: true,
        minimizable: true,
        closable: true
      });

      // 存储窗口引用
      this.windows.set('main', this.mainWindow);

      // 加载应用
      await this.loadApp(this.mainWindow);

      // 设置窗口事件监听
      this.setupMainWindowEvents();

      // 窗口准备好后显示
      this.mainWindow.once('ready-to-show', () => {
        this.mainWindow.show();

        // 开发模式下打开开发者工具
        if (isDev) {
          this.mainWindow.webContents.openDevTools();
        }

        this.emit('main-window-ready', this.mainWindow);
      });

      console.log('主窗口创建成功');
      return this.mainWindow;
    } catch (error) {
      console.error('创建主窗口失败:', error);
      throw error;
    }
  }

  /**
   * 创建悬浮窗口
   */
  async createFloatingWindow() {
    try {
      if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
        this.floatingWindow.focus();
        return this.floatingWindow;
      }

      this.floatingWindow = new BrowserWindow({
        width: 300,
        height: 400,
        minWidth: 250,
        minHeight: 300,
        maxWidth: 500,
        maxHeight: 800,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        movable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload.js')
        }
      });

      // 存储窗口引用
      this.windows.set('floating', this.floatingWindow);

      // 加载悬浮窗口页面
      if (isDev) {
        await this.floatingWindow.loadURL('http://localhost:5174/#/floating');
      } else {
        await this.floatingWindow.loadFile(path.join(__dirname, '../../dist/index.html'), {
          hash: 'floating'
        });
      }

      // 设置悬浮窗口事件
      this.setupFloatingWindowEvents();

      this.floatingWindow.once('ready-to-show', () => {
        this.floatingWindow.show();
        this.emit('floating-window-ready', this.floatingWindow);
      });

      console.log('悬浮窗口创建成功');
      return this.floatingWindow;
    } catch (error) {
      console.error('创建悬浮窗口失败:', error);
      throw error;
    }
  }

  /**
   * 创建快速输入窗口
   */
  async createQuickInputWindow() {
    try {
      // 如果窗口已存在，直接显示
      if (this.quickInputWindow && !this.quickInputWindow.isDestroyed()) {
        this.quickInputWindow.focus();
        return this.quickInputWindow;
      }

      // 获取鼠标位置附近的显示器
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);

      // 计算窗口位置（屏幕中央）
      const { width: screenWidth, height: screenHeight } = activeDisplay.workAreaSize;
      const { x: screenX, y: screenY } = activeDisplay.workArea;
      const windowWidth = 600;
      const windowHeight = 400;
      const x = screenX + Math.round((screenWidth - windowWidth) / 2);
      const y = screenY + Math.round((screenHeight - windowHeight) / 2);

      this.quickInputWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x,
        y,
        minWidth: 400,
        minHeight: 300,
        maxWidth: 800,
        maxHeight: 600,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        movable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload.js')
        }
      });

      // 存储窗口引用
      this.windows.set('quickInput', this.quickInputWindow);

      // 加载快速输入页面
      if (isDev) {
        await this.quickInputWindow.loadURL('http://localhost:5174/#/quick-input');
      } else {
        await this.quickInputWindow.loadFile(path.join(__dirname, '../../dist/index.html'), {
          hash: 'quick-input'
        });
      }

      // 设置窗口事件
      this.quickInputWindow.on('closed', () => {
        this.quickInputWindow = null;
        this.windows.delete('quickInput');
        this.emit('quick-input-window-closed');
      });

      // 失去焦点时隐藏窗口
      this.quickInputWindow.on('blur', () => {
        if (this.quickInputWindow && !this.quickInputWindow.isDestroyed()) {
          setTimeout(() => {
            if (this.quickInputWindow && !this.quickInputWindow.isDestroyed() && !this.quickInputWindow.isFocused()) {
              this.quickInputWindow.hide();
            }
          }, 200);
        }
      });

      this.quickInputWindow.once('ready-to-show', () => {
        this.quickInputWindow.show();
        this.quickInputWindow.focus();
        this.emit('quick-input-window-ready', this.quickInputWindow);
      });

      console.log('快速输入窗口创建成功');
      return this.quickInputWindow;
    } catch (error) {
      console.error('创建快速输入窗口失败:', error);
      throw error;
    }
  }

  /**
   * 创建独立笔记窗口
   * @param {string} noteId - 笔记ID
   * @param {object} options - 可选配置
   * @param {number} options.x - 窗口X坐标（鼠标位置）
   * @param {number} options.y - 窗口Y坐标（鼠标位置）
   */
  async createNoteWindow(noteId, options = {}) {
    try {
      // 在开发模式下检查Vite服务器是否可用
      if (isDev) {
        const isViteServerAvailable = await this.checkViteServer();
        if (!isViteServerAvailable) {
          throw new Error('Vite开发服务器不可用，请确保npm run dev正在运行');
        }
      }

      // 获取默认minibar模式设置
      const settings = await this.settingsService.getAllSettings();
      const defaultMinibarMode = settings.success && settings.data ? Boolean(settings.data.defaultMinibarMode) : false;

      // 根据minibar模式设置窗口大小
      const windowWidth = defaultMinibarMode ? 300 : 1000;
      const windowHeight = defaultMinibarMode ? 280 : 700;

      // 计算窗口位置（如果提供了鼠标位置，使用它；否则居中）
      let windowX, windowY;
      if (typeof options.x === 'number' && typeof options.y === 'number') {
        // 窗口左上角对齐到鼠标位置，稍微偏移一点以免遮挡鼠标
        windowX = Math.round(options.x - windowWidth / 2);
        windowY = Math.round(options.y - 20);

        // 确保窗口不会超出屏幕边界
        const { workArea } = screen.getDisplayNearestPoint({ x: options.x, y: options.y });
        windowX = Math.max(workArea.x, Math.min(windowX, workArea.x + workArea.width - windowWidth));
        windowY = Math.max(workArea.y, Math.min(windowY, workArea.y + workArea.height - windowHeight));
      }

      const windowOptions = {
        width: windowWidth,
        height: windowHeight,
        show: false,
        icon: this.getAppIcon(),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, '../preload.js'),
          webSecurity: true,
          allowRunningInsecureContent: false
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        frame: false,
        transparent: false,
        hasShadow: true,
        resizable: true,
        maximizable: true,
        minimizable: true,
        closable: true
      };

      // 只有在有有效位置时才设置x/y
      if (typeof windowX === 'number' && typeof windowY === 'number') {
        windowOptions.x = windowX;
        windowOptions.y = windowY;
      }

      const noteWindow = new BrowserWindow(windowOptions);

      // 处理新窗口打开请求（阻止外部链接在新窗口中打开）
      noteWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[NoteWindow] 拦截新窗口请求:', url)

        // 如果是 Excalidraw 素材库相关的 URL，在默认浏览器中打开
        if (url.includes('excalidraw.com') || url.includes('libraries.excalidraw.com')) {
          console.log('[NoteWindow] 在外部浏览器中打开 Excalidraw 链接')
          shell.openExternal(url)
          return { action: 'deny' }
        }

        // 其他外部链接也在浏览器中打开
        if (url.startsWith('http://') || url.startsWith('https://')) {
          console.log('[NoteWindow] 在外部浏览器中打开链接:', url)
          shell.openExternal(url)
          return { action: 'deny' }
        }

        // 阻止所有其他新窗口
        return { action: 'deny' }
      })

      // 生成窗口ID
      const windowId = `note-${noteId}-${Date.now()}`;
      this.windows.set(windowId, noteWindow);
      this.noteWindows.set(noteId, windowId);

      // 设置超时显示窗口，防止事件不触发
      let windowShown = false;
      const showTimeout = setTimeout(() => {
        if (!windowShown) {
          console.log('窗口显示超时，强制显示');
          noteWindow.show();
          windowShown = true;
          if (isDev) {
            noteWindow.webContents.openDevTools();
          }
        }
      }, 1000); // 1秒超时

      // 优先使用 dom-ready 事件（最快）- 必须在 loadURL 之前注册
      noteWindow.webContents.once('dom-ready', () => {
        if (!windowShown) {
          clearTimeout(showTimeout);
          console.log('DOM准备就绪，显示窗口');
          noteWindow.show();
          windowShown = true;
          if (isDev) {
            noteWindow.webContents.openDevTools();
          }
        }
      });

      // 加载独立窗口页面并传递笔记ID
      if (isDev) {
        await noteWindow.loadURL(`http://localhost:5174/standalone.html?type=note&noteId=${noteId}&minibarMode=${defaultMinibarMode}`);
      } else {
        await noteWindow.loadFile(path.join(__dirname, '../../dist/standalone.html'), {
          query: { type: 'note', noteId, minibarMode: defaultMinibarMode.toString() }
        });
      }

      // 设置窗口事件
      noteWindow.on('close', async (event) => {
        // 阻止窗口立即关闭
        event.preventDefault();

        try {
          console.log('笔记窗口关闭，执行保存前操作');

          // 使用 Promise 等待保存完成通知
          const savePromise = noteWindow.webContents.executeJavaScript(`
            new Promise((resolve) => {
              console.log('[窗口关闭] 开始执行保存');
              
              // 监听保存完成事件
              const handleComplete = () => {
                console.log('[窗口关闭] 收到保存完成通知');
                window.removeEventListener('standalone-save-complete', handleComplete);
                resolve(true);
              };
              window.addEventListener('standalone-save-complete', handleComplete);
              
              // 触发保存事件
              const saveEvent = new CustomEvent('standalone-window-save');
              window.dispatchEvent(saveEvent);
              
              // 500ms超时保护
              setTimeout(() => {
                console.log('[窗口关闭] 保存超时，强制完成');
                window.removeEventListener('standalone-save-complete', handleComplete);
                resolve(false);
              }, 500);
            })
          `);

          await savePromise;
          console.log('保存执行完成，准备关闭窗口');

        } catch (error) {
          console.error('窗口关闭时保存失败:', error);
        } finally {
          // 移除事件监听器，允许窗口真正关闭
          noteWindow.removeAllListeners('close');
          noteWindow.close();
        }
      });

      noteWindow.on('closed', () => {
        this.windows.delete(windowId);
        this.noteWindows.delete(noteId);
        // 通知主窗口笔记独立窗口已关闭
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('window:closed', { noteId, windowId });
        }
      });

      // 添加页面加载失败的错误处理
      noteWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error(`独立窗口加载失败: ${errorDescription} (${errorCode}) - URL: ${validatedURL}`);
      });

      // 添加控制台消息监听（包括所有级别）
      noteWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const levelNames = ['verbose', 'info', 'warning', 'error'];
        const levelName = levelNames[level] || 'unknown';
        console.log(`[独立窗口-${levelName}] ${message} (${sourceId}:${line})`);
      });

      console.log(`笔记窗口创建成功: ${windowId}`);
      // 通知主窗口笔记独立窗口已创建
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('window:created', { noteId, windowId });
      }
      return { windowId };
    } catch (error) {
      console.error('创建笔记窗口失败:', error);
      throw error;
    }
  }

  /**
   * 创建独立Todo窗口
   */
  async createTodoWindow(todoData) {
    try {
      // 在开发模式下检查Vite服务器是否可用
      if (isDev) {
        const isViteServerAvailable = await this.checkViteServer();
        if (!isViteServerAvailable) {
          throw new Error('Vite开发服务器不可用，请确保npm run dev正在运行');
        }
      }

      // 获取默认minibar模式设置
      const settings = await this.settingsService.getAllSettings();
      const defaultMinibarMode = settings.success && settings.data ? Boolean(settings.data.defaultMinibarMode) : false;

      // 根据minibar模式设置窗口大小
      const windowWidth = defaultMinibarMode ? 300 : 800;
      const windowHeight = defaultMinibarMode ? 280 : 600;

      const todoWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        show: false,
        icon: this.getAppIcon(),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, '../preload.js'),
          webSecurity: true,
          allowRunningInsecureContent: false
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        frame: false,
        transparent: false,
        hasShadow: true,
        resizable: true,
        maximizable: true,
        minimizable: true,
        closable: true
      });

      // 生成窗口ID
      const windowId = `todo-${Date.now()}`;
      this.windows.set(windowId, todoWindow);

      // 设置窗口事件（必须在loadURL之前注册，否则事件可能已触发）
      todoWindow.on('closed', () => {
        this.windows.delete(windowId);
      });

      // 添加页面加载失败的错误处理
      todoWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error(`Todo独立窗口加载失败: ${errorDescription} (${errorCode}) - URL: ${validatedURL}`);
        // 即使加载失败也显示窗口，让用户知道出了问题
        if (!todoWindow.isDestroyed() && !todoWindow.isVisible()) {
          todoWindow.show();
        }
      });

      // 添加控制台错误监听
      todoWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        if (level === 3) { // 错误级别
          console.error(`Todo独立窗口控制台错误: ${message} (${sourceId}:${line})`);
        }
      });

      // 页面加载完成后显示窗口
      todoWindow.webContents.on('did-finish-load', () => {
        console.log(`Todo窗口页面加载完成: ${windowId}`);
        if (!todoWindow.isDestroyed() && !todoWindow.isVisible()) {
          todoWindow.show();
          if (isDev) {
            todoWindow.webContents.openDevTools();
          }
        }
      });

      // ready-to-show 作为备用显示机制
      todoWindow.once('ready-to-show', () => {
        console.log(`Todo窗口 ready-to-show: ${windowId}`);
        if (!todoWindow.isDestroyed() && !todoWindow.isVisible()) {
          todoWindow.show();
          if (isDev) {
            todoWindow.webContents.openDevTools();
          }
        }
      });

      // 将 todoData 暂存在内存中，渲染进程通过 IPC 拉取，避免 URL 过长 (431)
      this.pendingWindowData.set(windowId, todoData);

      // 加载独立窗口页面，URL 只传 windowId（短 token），不传大 body
      if (isDev) {
        await todoWindow.loadURL(`http://localhost:5174/standalone.html?type=todo&windowId=${windowId}&minibarMode=${defaultMinibarMode}`);
      } else {
        await todoWindow.loadFile(path.join(__dirname, '../../dist/standalone.html'), {
          query: { type: 'todo', windowId, minibarMode: defaultMinibarMode.toString() }
        });
      }

      console.log(`Todo窗口创建成功: ${windowId}`);
      return { windowId };
    } catch (error) {
      console.error('创建Todo窗口失败:', error);
      throw error;
    }
  }

  /**
   * 设置主窗口事件监听
   */
  setupMainWindowEvents() {
    if (!this.mainWindow) return;

    // 窗口关闭事件
    this.mainWindow.on('close', async (event) => {
      // 保存窗口状态
      await this.saveWindowState(this.mainWindow);
      this.emit('main-window-closing', this.mainWindow);
    });

    // 窗口关闭后
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      this.windows.delete('main');
      this.emit('main-window-closed');
    });

    // 窗口最小化
    this.mainWindow.on('minimize', () => {
      this.emit('main-window-minimized');
    });

    // 窗口最大化
    this.mainWindow.on('maximize', () => {
      this.emit('main-window-maximized');
    });

    // 窗口恢复
    this.mainWindow.on('unmaximize', () => {
      this.emit('main-window-unmaximized');
    });

    // 窗口获得焦点
    this.mainWindow.on('focus', () => {
      this.emit('main-window-focused');
    });

    // 窗口失去焦点
    this.mainWindow.on('blur', () => {
      this.emit('main-window-blurred');
    });

    // 窗口大小改变
    this.mainWindow.on('resize', () => {
      this.emit('main-window-resized');
    });

    // 窗口移动
    this.mainWindow.on('move', () => {
      this.emit('main-window-moved');
    });

    // 处理外部链接
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 阻止导航到外部URL
    this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);

      if (parsedUrl.origin !== 'http://localhost:5174' && !navigationUrl.startsWith('file://')) {
        event.preventDefault();
        shell.openExternal(navigationUrl);
      }
    });
  }

  /**
   * 设置悬浮窗口事件监听
   */
  setupFloatingWindowEvents() {
    if (!this.floatingWindow) return;

    this.floatingWindow.on('closed', () => {
      this.floatingWindow = null;
      this.windows.delete('floating');
      this.emit('floating-window-closed');
    });

    // 悬浮窗口失去焦点时保持置顶
    this.floatingWindow.on('blur', () => {
      if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
        this.floatingWindow.setAlwaysOnTop(true);
      }
    });
  }

  /**
   * 加载应用
   */
  async loadApp(window) {
    if (isDev) {
      await window.loadURL('http://localhost:5174');
    } else {
      await window.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
  }

  /**
   * 计算窗口边界
   */
  calculateWindowBounds(windowSettings) {
    const { window_width, window_height, window_x, window_y } = windowSettings;

    // 获取主显示器信息
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // 默认尺寸
    const width = Math.min(window_width || 1200, screenWidth);
    const height = Math.min(window_height || 800, screenHeight);

    // 计算位置
    let x, y;

    if (window_x === 'center' || !window_x) {
      x = Math.round((screenWidth - width) / 2);
    } else {
      x = Math.max(0, Math.min(window_x, screenWidth - width));
    }

    if (window_y === 'center' || !window_y) {
      y = Math.round((screenHeight - height) / 2);
    } else {
      y = Math.max(0, Math.min(window_y, screenHeight - height));
    }

    return { width, height, x, y };
  }

  /**
   * 保存窗口状态
   */
  async saveWindowState(window) {
    try {
      if (!window || window.isDestroyed()) return;

      const bounds = window.getBounds();
      await this.settingsService.saveWindowState(bounds);
    } catch (error) {
      console.error('保存窗口状态失败:', error);
    }
  }

  /**
   * 获取应用图标
   */
  getAppIcon() {
    if (isDev) return path.join(__dirname, '../../build/logo.ico')
    return path.join(process.resourcesPath, 'build/logo.ico')
  }

  /**
   * 获取主窗口
   */
  getMainWindow() {
    return this.mainWindow;
  }

  /**
   * 获取悬浮窗口
   */
  getFloatingWindow() {
    return this.floatingWindow;
  }

  /**
   * 获取指定窗口
   */
  getWindow(id) {
    return this.windows.get(id);
  }

  /**
   * 获取所有窗口
   */
  getAllWindows() {
    return Array.from(this.windows.values());
  }

  isNoteOpenInWindow(noteId) {
    return this.noteWindows.has(noteId);
  }

  getNoteWindowId(noteId) {
    return this.noteWindows.get(noteId);
  }

  /**
   * 关闭指定窗口
   */
  async closeWindow(id) {
    const window = this.windows.get(id);
    if (window && !window.isDestroyed()) {
      try {
        // 在关闭前触发保存
        console.log('[WindowManager] 关闭窗口前触发保存:', id);
        await window.webContents.executeJavaScript(`
          (async () => {
            if (window.__saveBeforeClose) {
              await window.__saveBeforeClose();
              return true;
            }
            return false;
          })();
        `).catch(err => {
          console.error('[WindowManager] 保存失败:', err);
        });

        // 等待保存完成（给一些缓冲时间）
        await new Promise(resolve => setTimeout(resolve, 300));

        // 关闭窗口
        window.close();
        return true;
      } catch (error) {
        console.error('[WindowManager] 关闭窗口失败:', error);
        // 即使保存失败也关闭窗口
        window.close();
        return true;
      }
    }
    return false;
  }

  /**
   * 关闭所有窗口
   */
  async closeAllWindows() {
    const closePromises = [];
    for (const [id, window] of this.windows) {
      if (!window.isDestroyed()) {
        closePromises.push(this.closeWindow(id));
      }
    }
    // 等待所有窗口关闭完成
    await Promise.all(closePromises);
    this.windows.clear();
  }

  /**
   * 显示主窗口
   */
  showMainWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * 隐藏主窗口
   */
  hideMainWindow() {
    if (this.mainWindow) {
      this.mainWindow.hide();
    }
  }

  /**
   * 切换主窗口显示状态
   */
  toggleMainWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isVisible()) {
        this.hideMainWindow();
      } else {
        this.showMainWindow();
      }
    }
  }

  /**
   * 切换悬浮窗口
   */
  async toggleFloatingWindow() {
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      this.floatingWindow.close();
    } else {
      await this.createFloatingWindow();
    }
  }

  /**
   * 最小化到系统托盘
   */
  minimizeToTray() {
    if (this.mainWindow) {
      this.mainWindow.hide();
      this.emit('minimized-to-tray');
    }
  }

  /**
   * 从系统托盘恢复
   */
  restoreFromTray() {
    this.showMainWindow();
    this.emit('restored-from-tray');
  }

  /**
   * 重新加载主窗口
   */
  reloadMainWindow() {
    if (this.mainWindow) {
      this.mainWindow.reload();
    }
  }

  /**
   * 切换开发者工具
   */
  toggleDevTools(windowId = 'main') {
    const window = this.windows.get(windowId);
    if (window) {
      window.webContents.toggleDevTools();
    }
  }

  /**
   * 获取窗口统计信息
   */
  getWindowStats() {
    return {
      total: this.windows.size,
      main: this.mainWindow ? 1 : 0,
      floating: this.floatingWindow ? 1 : 0,
      notes: this.windows.size - (this.mainWindow ? 1 : 0) - (this.floatingWindow ? 1 : 0)
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.closeAllWindows();
    this.removeAllListeners();
  }
}

module.exports = WindowManager;