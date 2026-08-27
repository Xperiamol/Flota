const { app, BrowserWindow, screen, shell } = require('electron');
const { EventEmitter } = require('events');
const path = require('path');
const http = require('http');
const isDev = process.env.NODE_ENV === 'development';

class WindowManager extends EventEmitter {
  constructor(settingsService) {
    super();
    this.settingsService = settingsService;
    this.contentProtectionEnabled = false;
    this.windows = new Map(); // 存储所有窗口
    this.noteWindows = new Map(); // 存储笔记ID到窗口ID的映射
    this.pendingWindowData = new Map(); // 待渲染进程拉取的初始化数据
    this.mainWindow = null;
    this.floatingWindow = null;
    this.quickInputWindow = null;
    this.focusWindow = null;
    this.focusOwnerWindow = null;
    this.focusSessionData = null;
    this.focusVisibilityTimer = null;
    this.focusAppBlurHandler = null;
    this.focusAppFocusHandler = null;
    this.focusDockSide = null;
    this.focusDockedHidden = false;
    this.focusDockTimer = null;
    this.focusDockMoveTimer = null;
    this.focusDockMoveGuard = false;
    this.focusDockHoverTimer = null;
    this.focusDockAnimationTimer = null;
    this.focusDockWorkArea = null;
    this.todoReminderWindow = null;
    this.todoReminderCurrent = null;
    this.todoReminderQueue = [];
    this.todoReminderAnimationTimer = null;
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
   * 创建专注伴随浮窗。窗口默认隐藏，仅在 Flota 整体失去前台焦点后显示。
   */
  async createFocusWindow() {
    if (this.focusWindow && !this.focusWindow.isDestroyed()) {
      return this.focusWindow;
    }

    const ownerBounds = this.focusOwnerWindow && !this.focusOwnerWindow.isDestroyed()
      ? this.focusOwnerWindow.getBounds()
      : null;
    const display = ownerBounds
      ? screen.getDisplayMatching(ownerBounds)
      : screen.getPrimaryDisplay();
    const width = 294;
    const height = 104;
    const margin = 18;

    this.focusWindow = new BrowserWindow({
      width,
      height,
      x: display.workArea.x + display.workArea.width - width - margin,
      y: display.workArea.y + margin,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      closable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    this.focusWindow.setAlwaysOnTop(true, 'floating');
    this.focusWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.windows.set('focus-session', this.focusWindow);
    this.pendingWindowData.set('focus-session', this.focusSessionData);

    this.focusWindow.on('closed', () => {
      this.stopFocusDockMonitor();
      if (this.focusDockAnimationTimer) clearTimeout(this.focusDockAnimationTimer);
      this.focusDockAnimationTimer = null;
      this.windows.delete('focus-session');
      this.pendingWindowData.delete('focus-session');
      this.focusWindow = null;
    });
    this.focusWindow.on('move', () => this.scheduleFocusWindowDockingUpdate());
    this.focusWindow.on('blur', () => this.scheduleFocusWindowConceal());
    this.startFocusDockMonitor();

    if (isDev) {
      await this.focusWindow.loadURL('http://localhost:5174/standalone.html?type=focus');
    } else {
      await this.focusWindow.loadFile(path.join(__dirname, '../../dist/standalone.html'), {
        query: { type: 'focus' }
      });
    }

    this.focusWindow.once('ready-to-show', () => {
      this.syncFocusWindowVisibility();
    });

    return this.focusWindow;
  }

  animateFocusWindowTo(x, y, { duration = 190, onComplete } = {}) {
    const focusWindow = this.focusWindow;
    if (!focusWindow || focusWindow.isDestroyed()) return;
    if (this.focusDockAnimationTimer) {
      clearTimeout(this.focusDockAnimationTimer);
      this.focusDockAnimationTimer = null;
    }

    const startBounds = focusWindow.getBounds();
    const targetX = Math.round(x);
    const targetY = Math.round(y);
    const startedAt = Date.now();
    this.focusDockMoveGuard = true;

    const finish = () => {
      this.focusDockAnimationTimer = null;
      this.focusDockMoveGuard = false;
      onComplete?.();
    };

    const step = () => {
      if (!this.focusWindow || this.focusWindow.isDestroyed()) {
        finish();
        return;
      }

      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const nextX = Math.round(startBounds.x + (targetX - startBounds.x) * eased);
      const nextY = Math.round(startBounds.y + (targetY - startBounds.y) * eased);
      this.focusWindow.setPosition(nextX, nextY, false);

      if (progress >= 1) {
        finish();
        return;
      }
      this.focusDockAnimationTimer = setTimeout(step, 16);
    };

    step();
  }

  scheduleFocusWindowDockingUpdate() {
    if (this.focusDockMoveGuard || this.focusDockedHidden) return;
    if (this.focusDockMoveTimer) clearTimeout(this.focusDockMoveTimer);
    this.focusDockMoveTimer = setTimeout(() => {
      this.focusDockMoveTimer = null;
      this.updateFocusWindowDocking();
    }, 180);
  }

  isFocusDockEdgeExposed(workArea, side, bounds) {
    const edgeX = side === 'left' ? workArea.x : workArea.x + workArea.width;
    return !screen.getAllDisplays().some((display) => {
      const other = display.workArea;
      if (
        other.x === workArea.x
        && other.y === workArea.y
        && other.width === workArea.width
        && other.height === workArea.height
      ) {
        return false;
      }

      const touchesEdge = side === 'left'
        ? Math.abs(other.x + other.width - edgeX) <= 1
        : Math.abs(other.x - edgeX) <= 1;
      const overlapsWindowVertically = Math.max(bounds.y, other.y)
        < Math.min(bounds.y + bounds.height, other.y + other.height);
      return touchesEdge && overlapsWindowVertically;
    });
  }

  updateFocusWindowDocking() {
    const focusWindow = this.focusWindow;
    if (!focusWindow || focusWindow.isDestroyed() || this.focusDockMoveGuard) return;

    const bounds = focusWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const workAreaRight = workArea.x + workArea.width;
    const windowRight = bounds.x + bounds.width;
    const contactTolerance = 12;
    const leftTouchesEdge = bounds.x <= workArea.x + contactTolerance
      && windowRight > workArea.x + contactTolerance;
    const rightTouchesEdge = windowRight >= workAreaRight - contactTolerance
      && bounds.x < workAreaRight - contactTolerance;
    const nextSide = leftTouchesEdge && this.isFocusDockEdgeExposed(workArea, 'left', bounds)
      ? 'left'
      : rightTouchesEdge && this.isFocusDockEdgeExposed(workArea, 'right', bounds)
        ? 'right'
        : null;

    if (!nextSide) {
      this.focusDockSide = null;
      this.focusDockWorkArea = null;
      this.focusDockedHidden = false;
      if (this.focusDockTimer) {
        clearTimeout(this.focusDockTimer);
        this.focusDockTimer = null;
      }
      return;
    }

    this.focusDockSide = nextSide;
    this.focusDockWorkArea = { ...workArea };
    this.focusDockedHidden = false;

    const x = nextSide === 'left'
      ? workArea.x
      : workArea.x + workArea.width - bounds.width;
    const y = Math.min(
      Math.max(bounds.y, workArea.y),
      workArea.y + workArea.height - bounds.height
    );
    this.focusDockMoveGuard = true;
    focusWindow.setPosition(Math.round(x), Math.round(y), false);
    setTimeout(() => {
      this.focusDockMoveGuard = false;
      this.startFocusDockMonitor();
    }, 80);
  }

  startFocusDockMonitor() {
    if (this.focusDockHoverTimer) return;
    this.focusDockHoverTimer = setInterval(() => this.syncFocusWindowDockHover(), 90);
  }

  stopFocusDockMonitor() {
    if (!this.focusDockHoverTimer) return;
    clearInterval(this.focusDockHoverTimer);
    this.focusDockHoverTimer = null;
  }

  syncFocusWindowDockHover() {
    const focusWindow = this.focusWindow;
    if (!focusWindow || focusWindow.isDestroyed() || !focusWindow.isVisible()) return;
    if (this.focusDockMoveGuard) return;
    if (!this.focusDockSide || !this.focusDockWorkArea) {
      this.updateFocusWindowDocking();
      return;
    }

    const workArea = this.focusDockWorkArea;

    const cursorPoint = screen.getCursorScreenPoint();
    const bounds = focusWindow.getBounds();
    const withinVerticalRange = cursorPoint.y >= bounds.y - 3
      && cursorPoint.y <= bounds.y + bounds.height + 3;

    if (this.focusDockedHidden) {
      const atDockEdge = this.focusDockSide === 'left'
        ? cursorPoint.x <= workArea.x + 14
        : cursorPoint.x >= workArea.x + workArea.width - 15;
      if (withinVerticalRange && atDockEdge) this.revealFocusWindow();
      return;
    }

    const cursorInsideWindow = cursorPoint.x >= bounds.x - 3
      && cursorPoint.x <= bounds.x + bounds.width + 3
      && withinVerticalRange;
    if (cursorInsideWindow) {
      if (this.focusDockTimer) {
        clearTimeout(this.focusDockTimer);
        this.focusDockTimer = null;
      }
      return;
    }

    this.scheduleFocusWindowConceal(460);
  }

  revealFocusWindow() {
    const focusWindow = this.focusWindow;
    if (!this.focusDockSide || !focusWindow || focusWindow.isDestroyed()) return { success: true };
    if (this.focusDockTimer) {
      clearTimeout(this.focusDockTimer);
      this.focusDockTimer = null;
    }

    const bounds = focusWindow.getBounds();
    const workArea = this.focusDockWorkArea || screen.getDisplayMatching(bounds).workArea;
    const x = this.focusDockSide === 'left'
      ? workArea.x
      : workArea.x + workArea.width - bounds.width;
    this.focusDockedHidden = false;
    this.animateFocusWindowTo(x, bounds.y, { duration: 180 });
    return { success: true };
  }

  scheduleFocusWindowConceal(delay = 380) {
    if (!this.focusDockSide) return { success: true };
    if (this.focusDockTimer) return { success: true };
    this.focusDockTimer = setTimeout(() => {
      this.focusDockTimer = null;
      const focusWindow = this.focusWindow;
      if (!focusWindow || focusWindow.isDestroyed() || !focusWindow.isVisible() || this.focusDockMoveGuard) return;
      const cursorPoint = screen.getCursorScreenPoint();
      const bounds = focusWindow.getBounds();
      const cursorInsideWindow = cursorPoint.x >= bounds.x - 3
        && cursorPoint.x <= bounds.x + bounds.width + 3
        && cursorPoint.y >= bounds.y - 3
        && cursorPoint.y <= bounds.y + bounds.height + 3;
      if (!cursorInsideWindow) this.concealFocusWindow();
    }, delay);
    return { success: true };
  }

  concealFocusWindow() {
    const focusWindow = this.focusWindow;
    if (!this.focusDockSide || !focusWindow || focusWindow.isDestroyed()) return { success: true };

    if (this.focusDockedHidden) return { success: true };
    const bounds = focusWindow.getBounds();
    const workArea = this.focusDockWorkArea || screen.getDisplayMatching(bounds).workArea;
    const visibleStrip = 12;
    const x = this.focusDockSide === 'left'
      ? workArea.x - bounds.width + visibleStrip
      : workArea.x + workArea.width - visibleStrip;
    this.animateFocusWindowTo(x, bounds.y, {
      duration: 220,
      onComplete: () => {
        this.focusDockedHidden = true;
      }
    });
    return { success: true };
  }

  scheduleFocusWindowVisibilitySync() {
    if (this.focusVisibilityTimer) clearTimeout(this.focusVisibilityTimer);
    this.focusVisibilityTimer = setTimeout(() => {
      this.focusVisibilityTimer = null;
      this.syncFocusWindowVisibility();
    }, 90);
  }

  syncFocusWindowVisibility() {
    const focusWindow = this.focusWindow;
    if (!this.focusSessionData || !focusWindow || focusWindow.isDestroyed()) return;

    const focusedWindow = BrowserWindow.getFocusedWindow();
    const flotaIsForeground = Boolean(focusedWindow && focusedWindow !== focusWindow);

    if (flotaIsForeground) {
      focusWindow.hide();
      return;
    }

    if (!focusWindow.isVisible()) {
      focusWindow.showInactive();
    }
    focusWindow.setAlwaysOnTop(true, 'floating');
  }

  bindFocusWindowVisibilityEvents() {
    if (this.focusAppBlurHandler || this.focusAppFocusHandler) return;

    this.focusAppBlurHandler = () => this.scheduleFocusWindowVisibilitySync();
    this.focusAppFocusHandler = (_event, focusedWindow) => {
      if (focusedWindow && focusedWindow !== this.focusWindow && this.focusWindow && !this.focusWindow.isDestroyed()) {
        this.focusWindow.hide();
      }
    };

    app.on('browser-window-blur', this.focusAppBlurHandler);
    app.on('browser-window-focus', this.focusAppFocusHandler);
  }

  unbindFocusWindowVisibilityEvents() {
    if (this.focusAppBlurHandler) {
      app.removeListener('browser-window-blur', this.focusAppBlurHandler);
      this.focusAppBlurHandler = null;
    }
    if (this.focusAppFocusHandler) {
      app.removeListener('browser-window-focus', this.focusAppFocusHandler);
      this.focusAppFocusHandler = null;
    }
    if (this.focusVisibilityTimer) {
      clearTimeout(this.focusVisibilityTimer);
      this.focusVisibilityTimer = null;
    }
  }

  async startFocusSession(sessionData, ownerWindow) {
    this.focusSessionData = sessionData || {};
    this.focusOwnerWindow = ownerWindow || this.focusOwnerWindow;
    this.bindFocusWindowVisibilityEvents();

    const focusWindow = await this.createFocusWindow();
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.webContents.send('focus-session:update', this.focusSessionData);
    }
    this.syncFocusWindowVisibility();
    return { success: true };
  }

  updateFocusSession(sessionData) {
    if (!this.focusSessionData) return { success: false, error: 'no active focus session' };
    this.focusSessionData = { ...this.focusSessionData, ...(sessionData || {}) };
    if (this.focusWindow && !this.focusWindow.isDestroyed()) {
      this.focusWindow.webContents.send('focus-session:update', this.focusSessionData);
    }
    return { success: true };
  }

  endFocusSession() {
    this.focusSessionData = null;
    this.focusOwnerWindow = null;
    this.unbindFocusWindowVisibilityEvents();
    this.pendingWindowData.delete('focus-session');
    this.focusDockSide = null;
    this.focusDockWorkArea = null;
    this.focusDockedHidden = false;
    this.focusDockMoveGuard = false;
    this.stopFocusDockMonitor();
    if (this.focusDockTimer) {
      clearTimeout(this.focusDockTimer);
      this.focusDockTimer = null;
    }
    if (this.focusDockMoveTimer) {
      clearTimeout(this.focusDockMoveTimer);
      this.focusDockMoveTimer = null;
    }
    if (this.focusDockAnimationTimer) {
      clearTimeout(this.focusDockAnimationTimer);
      this.focusDockAnimationTimer = null;
    }

    if (this.focusWindow && !this.focusWindow.isDestroyed()) {
      this.focusWindow.destroy();
    }
    this.focusWindow = null;
    this.windows.delete('focus-session');
    return { success: true };
  }

  handleFocusWindowAction(action) {
    if (!action) {
      return { success: false, error: 'invalid focus window action' };
    }

    if (action.type === 'reveal-overlay') return this.revealFocusWindow();
    if (action.type === 'conceal-overlay') return this.scheduleFocusWindowConceal();

    if (!this.focusOwnerWindow || this.focusOwnerWindow.isDestroyed()) {
      return { success: false, error: 'focus owner window unavailable' };
    }

    if (action.type === 'show-main') {
      if (this.focusOwnerWindow.isMinimized()) this.focusOwnerWindow.restore();
      this.focusOwnerWindow.show();
      this.focusOwnerWindow.focus();
      return { success: true };
    }

    this.focusOwnerWindow.webContents.send('focus-session:action', action);
    return { success: true };
  }

  getTodoReminderPayload() {
    if (!this.todoReminderCurrent) return null;
    return {
      todo: this.todoReminderCurrent,
      remainingCount: this.todoReminderQueue.length,
      totalCount: this.todoReminderQueue.length + 1
    };
  }

  sendTodoReminderUpdate() {
    const payload = this.getTodoReminderPayload();
    if (!payload) return;
    this.pendingWindowData.set('todo-reminder', payload);
    if (this.todoReminderWindow && !this.todoReminderWindow.isDestroyed()) {
      this.todoReminderWindow.webContents.send('todo-reminder:update', payload);
    }
  }

  animateTodoReminderWindowX(targetX, { duration = 210, onComplete } = {}) {
    const reminderWindow = this.todoReminderWindow;
    if (!reminderWindow || reminderWindow.isDestroyed()) return;
    if (this.todoReminderAnimationTimer) {
      clearTimeout(this.todoReminderAnimationTimer);
      this.todoReminderAnimationTimer = null;
    }

    const [startX, y] = reminderWindow.getPosition();
    const startedAt = Date.now();
    const step = () => {
      if (!this.todoReminderWindow || this.todoReminderWindow.isDestroyed()) return;
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = Math.round(startX + (targetX - startX) * eased);
      this.todoReminderWindow.setPosition(x, y, false);
      if (progress >= 1) {
        this.todoReminderAnimationTimer = null;
        onComplete?.();
        return;
      }
      this.todoReminderAnimationTimer = setTimeout(step, 16);
    };
    step();
  }

  async createTodoReminderWindow() {
    if (this.todoReminderWindow && !this.todoReminderWindow.isDestroyed()) {
      return this.todoReminderWindow;
    }

    const { workArea } = screen.getPrimaryDisplay();
    const width = 360;
    const height = 156;
    const margin = 16;
    const targetX = workArea.x + workArea.width - width - margin;
    const y = workArea.y + workArea.height - height - margin;

    this.todoReminderWindow = new BrowserWindow({
      width,
      height,
      x: workArea.x + workArea.width + 4,
      y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      closable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    this.todoReminderWindow.setAlwaysOnTop(true, 'floating');
    this.todoReminderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.windows.set('todo-reminder', this.todoReminderWindow);
    this.pendingWindowData.set('todo-reminder', this.getTodoReminderPayload());

    this.todoReminderWindow.on('closed', () => {
      if (this.todoReminderAnimationTimer) clearTimeout(this.todoReminderAnimationTimer);
      this.todoReminderAnimationTimer = null;
      this.windows.delete('todo-reminder');
      this.pendingWindowData.delete('todo-reminder');
      this.todoReminderWindow = null;
    });

    let hasShown = false;
    const showReminderWindow = () => {
      if (hasShown || !this.todoReminderWindow || this.todoReminderWindow.isDestroyed()) return;
      hasShown = true;
      this.todoReminderWindow.showInactive();
      this.todoReminderWindow.setAlwaysOnTop(true, 'floating');
      this.animateTodoReminderWindowX(targetX);
    };
    this.todoReminderWindow.once('ready-to-show', showReminderWindow);

    if (isDev) {
      await this.todoReminderWindow.loadURL('http://localhost:5174/standalone.html?type=reminder');
    } else {
      await this.todoReminderWindow.loadFile(path.join(__dirname, '../../dist/standalone.html'), {
        query: { type: 'reminder' }
      });
    }

    // ready-to-show 可能在 loadURL/loadFile Promise resolve 前触发；这里提供强制兜底。
    if (!hasShown) showReminderWindow();

    return this.todoReminderWindow;
  }

  async showTodoReminder(todo) {
    if (!todo || todo.id === undefined || todo.id === null) return { success: false, error: 'invalid todo' };
    const todoId = String(todo.id);
    const alreadyQueued = String(this.todoReminderCurrent?.id) === todoId
      || this.todoReminderQueue.some((item) => String(item.id) === todoId);
    if (alreadyQueued) return { success: true, queued: false };

    if (!this.todoReminderCurrent) {
      this.todoReminderCurrent = todo;
      if (this.todoReminderWindow && !this.todoReminderWindow.isDestroyed()) {
        if (this.todoReminderAnimationTimer) {
          clearTimeout(this.todoReminderAnimationTimer);
          this.todoReminderAnimationTimer = null;
        }
        const { workArea } = screen.getDisplayMatching(this.todoReminderWindow.getBounds());
        const [width] = this.todoReminderWindow.getSize();
        this.animateTodoReminderWindowX(workArea.x + workArea.width - width - 16, { duration: 160 });
      } else {
        await this.createTodoReminderWindow();
      }
    } else {
      this.todoReminderQueue.push(todo);
    }
    this.sendTodoReminderUpdate();
    return { success: true, queued: true };
  }

  closeTodoReminderWindow() {
    const reminderWindow = this.todoReminderWindow;
    if (!reminderWindow || reminderWindow.isDestroyed()) return;
    const { workArea } = screen.getDisplayMatching(reminderWindow.getBounds());
    this.animateTodoReminderWindowX(workArea.x + workArea.width + 4, {
      duration: 180,
      onComplete: () => {
        if (this.todoReminderWindow && !this.todoReminderWindow.isDestroyed()) {
          this.todoReminderWindow.destroy();
        }
        this.todoReminderWindow = null;
      }
    });
  }

  /**
   * 从持久化设置中恢复窗口内容保护状态。
   */
  async initializeContentProtection() {
    try {
      const result = await this.settingsService.getSetting('hiddenMode');
      this.contentProtectionEnabled = Boolean(result?.success && result.data);
    } catch (error) {
      this.contentProtectionEnabled = false;
      console.error('初始化隐藏模式失败:', error);
    }
  }

  /**
   * 对单个窗口应用系统级内容保护。
   */
  applyContentProtection(window) {
    if (!window || window.isDestroyed() || typeof window.setContentProtection !== 'function') return;

    try {
      window.setContentProtection(this.contentProtectionEnabled);
    } catch (error) {
      console.error('应用窗口内容保护失败:', error);
    }
  }

  /**
   * 更新所有现有窗口的内容保护；之后创建的窗口会通过 browser-window-created 继承。
   */
  setContentProtection(enabled) {
    this.contentProtectionEnabled = Boolean(enabled);
    BrowserWindow.getAllWindows().forEach(window => this.applyContentProtection(window));
  }

  advanceTodoReminder() {
    this.todoReminderCurrent = this.todoReminderQueue.shift() || null;
    if (this.todoReminderCurrent) {
      this.sendTodoReminderUpdate();
      return;
    }
    this.pendingWindowData.delete('todo-reminder');
    this.closeTodoReminderWindow();
  }

  handleTodoReminderAction(action) {
    if (!action?.type || !this.todoReminderCurrent) {
      return { success: false, error: 'no active todo reminder' };
    }
    const todo = this.todoReminderCurrent;
    this.emit('todo-reminder-action', { ...action, todo });
    this.advanceTodoReminder();
    return { success: true };
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
