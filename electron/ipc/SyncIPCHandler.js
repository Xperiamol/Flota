/**
 * Flota 云同步 IPC 处理器（V3专用）
 *
 * 处理所有云同步相关的 IPC 通信
 */

const { ipcMain, BrowserWindow } = require('electron');
const { getInstance: getV3SyncService } = require('../services/sync/V3SyncService');
const path = require('path');

// 获取用户数据路径
const getUserDataPath = () => {
  let app = null;
  try {
    app = require('electron').app;
  } catch (e) {
    // Standalone mode
  }
  
  if (app) return app.getPath('userData');
  
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || homeDir, 'Flota');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  } else {
    return path.join(homeDir, '.config', 'Flota');
  }
}

class SyncIPCHandler {
  constructor() {
    this.v3SyncService = null;

    // 冲突管理
    this.pendingConflicts = new Map(); // conflictId -> { resolve, reject, conflict }
    this.conflictIdCounter = 0;

    // 已注册的 IPC 处理器列表
    this.registeredHandlers = [];
  }

  /**
   * 初始化 IPC 处理器
   */
  async initialize() {
    console.log('[SyncIPCHandler] 初始化...');

    // 初始化 V3 同步服务
    this.v3SyncService = getV3SyncService();

    // 设置冲突解决处理器（自己）
    this.v3SyncService.setSyncIPCHandler(this);

    await this.v3SyncService.initialize();

    // 注册 IPC 处理器
    this.registerHandlers();

    // 设置事件转发
    this.setupEventForwarding();

    console.log('[SyncIPCHandler] 初始化完成');
  }

  /**
   * 安全注册 IPC handler（先移除已存在的）
   * @private
   */
  safeHandle(channel, handler) {
    try {
      ipcMain.removeHandler(channel);
    } catch (e) {
      // 忽略移除不存在的 handler 时的错误
    }
    ipcMain.handle(channel, handler);
    this.registeredHandlers.push(channel);
  }

  /**
   * 注册所有 IPC 处理器
   */
  registerHandlers() {
    // 获取同步状态
    this.safeHandle('sync:get-status', async () => {
      const v3Status = this.v3SyncService.getStatus();
      return { v3: v3Status };
    });

    // 测试连接
    this.safeHandle('sync:test-connection', async (event, serviceName, config) => {
      await this.v3SyncService.setCredentials(
        config.username,
        config.password,
        config.baseUrl
      );
      return await this.v3SyncService.testConnection();
    });

    // 启用同步（切换服务）
    this.safeHandle('sync:switch-service', async (event, serviceName, config) => {
      // 如果没有传密码，使用已保存的密码
      let password = config.password;
      if (!password && this.v3SyncService.config?.credentials?.password) {
        password = this.v3SyncService.config.credentials.password;
        console.log('[SyncIPCHandler] 使用已保存的密码');
      }
      
      await this.v3SyncService.setCredentials(
        config.username,
        password,
        config.baseUrl
      );
      await this.v3SyncService.enable();
      return { success: true };
    });

    // 禁用同步
    this.safeHandle('sync:disable', async () => {
      if (this.v3SyncService.isEnabled) {
        await this.v3SyncService.disable();
      }
      return { success: true };
    });

    // 启用特定类别的同步
    this.safeHandle('sync:enable-category', async (event, category) => {
      this.v3SyncService.enableCategory(category);
      // 如果服务未启用，启用它
      if (!this.v3SyncService.isEnabled && this.v3SyncService.config?.credentials?.username) {
        await this.v3SyncService.enable();
      }
      return { success: true };
    });

    // 禁用特定类别的同步
    this.safeHandle('sync:disable-category', async (event, category) => {
      this.v3SyncService.disableCategory(category);
      // 如果所有类别都禁用了，禁用服务
      if (this.v3SyncService.config?.syncCategories?.length === 0 && this.v3SyncService.isEnabled) {
        await this.v3SyncService.disable();
      }
      return { success: true };
    });

    // 手动同步（离线时进入队列）
    this.safeHandle('sync:manual-sync', async () => {
      const { getInstance: getNetworkService } = require('../services/NetworkService')
      const network = getNetworkService()
      if (!network.isOnline) {
        const { getInstance: getOfflineSyncQueue } = require('../services/OfflineSyncQueue')
        getOfflineSyncQueue().enqueue({ type: 'manual-sync' })
        return { success: false, offline: true, error: '当前离线，已加入同步队列' }
      }
      const result = await this.v3SyncService.sync();
      return result;
    });

    // 强制全量同步
    this.safeHandle('sync:force-full-sync', async () => {
      if (!this.v3SyncService.isEnabled) {
        throw new Error('V3 同步服务未启用');
      }
      const result = await this.v3SyncService.forceFullSync();
      return result;
    });

    // 切换自动同步
    this.safeHandle('sync:toggle-auto-sync', async (event, enabled) => {
      if (!this.v3SyncService.isEnabled) {
        throw new Error('V3 同步服务未启用');
      }
      this.v3SyncService.toggleAutoSync(enabled);
      return { success: true };
    });

    // 设置自动同步间隔
    this.safeHandle('sync:set-auto-sync-interval', async (event, minutes) => {
      if (!this.v3SyncService.isEnabled) {
        throw new Error('V3 同步服务未启用');
      }
      this.v3SyncService.setAutoSyncInterval(minutes);
      return { success: true };
    });

    // 导出数据
    this.safeHandle('sync:export-data', async (event, filePath) => {
      const data = await this.v3SyncService.exportData();
      const fs = require('fs');
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return { success: true, message: '数据已导出' };
    });

    // 清除所有配置
    this.safeHandle('sync:clear-all', async () => {
      this.v3SyncService.clearAll();
      return { success: true };
    });

    // 冲突解决
    this.safeHandle('sync:resolve-conflict', async (event, conflictId, resolution) => {
      const conflict = this.pendingConflicts.get(conflictId);
      if (!conflict) {
        return { success: false, error: '冲突不存在或已解决' };
      }

      // 解析用户选择
      if (resolution === 'local' || resolution === 'remote') {
        conflict.resolve(resolution);
        this.pendingConflicts.delete(conflictId);
        return { success: true };
      } else if (resolution === 'cancel') {
        conflict.reject(new Error('用户取消同步'));
        this.pendingConflicts.delete(conflictId);
        return { success: true };
      } else {
        return { success: false, error: '无效的解决方案' };
      }
    });

    // 下载图片（从云端下载到本地）
    this.safeHandle('sync:download-image', async (event, relativePath) => {
      if (!this.v3SyncService || !this.v3SyncService.isEnabled) {
        return { success: false, error: '同步服务未启用' };
      }

      try {
        const localPath = path.join(getUserDataPath(), relativePath);

        await this.v3SyncService.downloadImage(relativePath, localPath);
        return { success: true, localPath };
      } catch (error) {
        console.error('[SyncIPCHandler] 下载图片失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 上传图片（从本地上传到云端）
    this.safeHandle('sync:upload-image', async (event, localPath, relativePath) => {
      if (!this.v3SyncService || !this.v3SyncService.isEnabled) {
        return { success: false, error: '同步服务未启用' };
      }

      try {
        await this.v3SyncService.uploadImage(localPath, relativePath);
        return { success: true };
      } catch (error) {
        console.error('[SyncIPCHandler] 上传图片失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取未使用图片统计
    this.safeHandle('sync:get-unused-images-stats', async (event, retentionDays) => {
      return await this.v3SyncService.getUnusedImagesStats(retentionDays || 30);
    });

    // 清理未使用图片
    this.safeHandle('sync:cleanup-unused-images', async (event, retentionDays) => {
      return await this.v3SyncService.cleanupUnusedImages(retentionDays || 30);
    });

    console.log('[SyncIPCHandler] IPC 处理器注册完成');
  }

  /**
   * 请求用户解决冲突
   * @param {Object} conflictData - 冲突数据
   * @returns {Promise<'local'|'remote'>} 用户选择
   */
  async requestConflictResolution(conflictData) {
    return new Promise((resolve, reject) => {
      const conflictId = `conflict_${++this.conflictIdCounter}`;

      // 存储冲突及其解决器
      this.pendingConflicts.set(conflictId, { resolve, reject, conflict: conflictData });

      // 发送冲突事件到前端
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('sync:conflict', {
            conflictId,
            ...conflictData
          });
        }
      });

      // 设置超时（5分钟）
      setTimeout(() => {
        if (this.pendingConflicts.has(conflictId)) {
          this.pendingConflicts.delete(conflictId);
          reject(new Error('冲突解决超时'));
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * 设置 V3 同步事件转发到渲染进程
   */
  setupEventForwarding() {
    if (!this.v3SyncService) return;

    console.log('[SyncIPCHandler] 设置 V3 事件转发...');

    // 转发同步开始事件
    this.v3SyncService.on('syncStart', () => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('sync:start');
        }
      });
    });

    // 转发同步进度事件
    this.v3SyncService.on('syncProgress', (data) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('sync:progress', data);
        }
      });
    });

    // 转发同步完成事件
    this.v3SyncService.on('syncComplete', (result) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('sync:complete', result);
        }
      });
    });

    // 转发同步错误事件
    this.v3SyncService.on('syncError', (error) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('sync:error', { message: error.message });
        }
      });
    });

    console.log('[SyncIPCHandler] V3 事件转发已设置');
  }

  /**
   * 清理资源
   */
  destroy() {
    // 移除所有已注册的 IPC handlers
    for (const channel of this.registeredHandlers) {
      try {
        ipcMain.removeHandler(channel);
      } catch (e) {
        // 忽略错误
      }
    }
    this.registeredHandlers = [];

    if (this.v3SyncService) {
      this.v3SyncService.stopAutoSync();
      this.v3SyncService.removeAllListeners();
    }
  }
}

// 单例
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new SyncIPCHandler();
  }
  return instance;
}

module.exports = { SyncIPCHandler, getInstance };
