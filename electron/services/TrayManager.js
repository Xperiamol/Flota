/**
 * 系统托盘管理器 - 遵循单一职责原则
 * 职责：管理系统托盘图标和菜单
 */
const { Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

class TrayManager {
  constructor(app, mainWindow) {
    this.app = app;
    this.mainWindow = mainWindow;
    this.tray = null;
    this.isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  }

  /**
   * 创建系统托盘
   * @returns {Tray|null} 托盘实例
   */
  create() {
    try {
      const icon = this._createTrayIcon();
      
      if (icon.isEmpty()) {
        console.warn('[TrayManager] Failed to create tray icon');
        return null;
      }

      this.tray = new Tray(icon);
      this._setupTrayMenu();
      this._setupTrayEvents();
      
      console.log('[TrayManager] Tray created successfully');
      return this.tray;
      
    } catch (error) {
      console.error('[TrayManager] Failed to create tray:', error);
      return null;
    }
  }

  /**
   * 创建托盘图标
   * @private
   * @returns {NativeImage} 图标对象
   */
  _createTrayIcon() {
    const iconPaths = this._getIconPaths();
    
    // 尝试加载 PNG 图标
    if (fs.existsSync(iconPaths.png)) {
      const icon = nativeImage.createFromPath(iconPaths.png);
      if (!icon.isEmpty()) {
        return this._resizeIcon(icon);
      }
    }
    
    // 尝试加载 SVG 图标
    if (fs.existsSync(iconPaths.svg)) {
      const icon = nativeImage.createFromPath(iconPaths.svg);
      if (!icon.isEmpty()) {
        return this._resizeIcon(icon);
      }
    }
    
    // 返回空图标（失败情况）
    console.warn('[TrayManager] No valid icon found');
    return nativeImage.createEmpty();
  }

  /**
   * 获取图标路径
   * @private
   * @returns {object} 图标路径集合
   */
  _getIconPaths() {
    const basePath = this.isDev 
      ? path.join(__dirname, '../../') 
      : process.resourcesPath;
    
    return {
      png: path.join(basePath, 'logo.png'),
      svg: path.join(basePath, 'assets/tray-icon.svg')
    };
  }

  /**
   * 调整图标大小
   * @private
   * @param {NativeImage} icon - 原始图标
   * @returns {NativeImage} 调整后的图标
   */
  _resizeIcon(icon) {
    return icon.resize({ width: 16, height: 16 });
  }

  /**
   * 设置托盘菜单
   * @private
   */
  _setupTrayMenu() {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => this._showMainWindow()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => this._quitApp()
      }
    ]);
    
    this.tray.setToolTip('Flota');
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * 设置托盘事件
   * @private
   */
  _setupTrayEvents() {
    // 双击托盘图标显示主窗口
    this.tray.on('double-click', () => {
      this._showMainWindow();
    });
  }

  /**
   * 显示主窗口
   * @private
   */
  _showMainWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      if (!this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
      this.mainWindow.focus();
    }
  }

  /**
   * 退出应用
   * @private
   */
  _quitApp() {
    this.app.isQuiting = true;
    this.app.quit();
  }

  /**
   * 显示托盘通知（首次最小化时）
   */
  showFirstTimeNotification() {
    if (!global.hasShownTrayNotification) {
      const isDev = process.env.NODE_ENV !== 'production';
      const fs = require('fs');
      const iconPath = isDev
        ? path.join(__dirname, '../../logo.png')
        : path.join(process.resourcesPath, 'logo.png');
      new Notification({
        title: 'Flota',
        body: '应用已最小化到系统托盘，双击托盘图标可重新打开窗口',
        icon: fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined
      }).show();
      global.hasShownTrayNotification = true;
    }
  }

  /**
   * 销毁托盘
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
      console.log('[TrayManager] Tray destroyed');
    }
  }
}

module.exports = TrayManager;
