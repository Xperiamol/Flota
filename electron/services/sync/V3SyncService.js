/**
 * Flota v3.0 原子化同步系统 - 服务管理类
 *
 * 集成到现有 CloudSyncManager 系统中
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// 获取用户数据路径（兼容 standalone 模式）
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
};

const SyncEngine = require('./SyncEngine');

/**
 * V3 同步服务类
 */
class V3SyncService extends EventEmitter {
  constructor() {
    super();

    this.serviceName = 'Flota-v3';
    this.displayName = 'Flota V3 原子化同步';
    this.engine = null;
    this.config = null;
    this.isEnabled = false;
    this.isSyncing = false;
    this.status = 'disabled';
    this.lastError = null;
    this.lastSyncTime = 0;

    // 自动同步定时器
    this.autoSyncTimer = null;
    this.autoSyncInterval = 5 * 60 * 1000; // 默认 5 分钟

    // 图片同步标记
    this._imageDirectoriesEnsured = false;

    // 冲突解决处理器
    this.syncIPCHandler = null;

    // 配置文件路径
    this.configPath = path.join(getUserDataPath(), 'v3-sync-config.json');

    // 加载配置
    this.loadConfig();
  }

  /**
   * 初始化服务
   */
  async initialize() {
    console.log('[V3SyncService] 初始化...');

    if (this.config && this.config.enabled) {
      try {
        await this.enable();
      } catch (error) {
        console.error('[V3SyncService] 初始化失败:', error);
        this.status = 'error';
        this.lastError = error.message;
      }
    }

    return this;
  }

  /**
   * 设置冲突解决处理器
   * @param {Object} syncIPCHandler - SyncIPCHandler 实例
   */
  setSyncIPCHandler(syncIPCHandler) {
    this.syncIPCHandler = syncIPCHandler;
    console.log('[V3SyncService] 已设置冲突解决处理器');
  }

  /**
   * 启用同步服务
   */
  async enable() {
    if (!this.config || !this.config.credentials) {
      throw new Error('请先配置同步凭据');
    }

    console.log('[V3SyncService] 启用同步服务...');

    // 创建同步引擎
    this.engine = new SyncEngine({
      baseUrl: this.config.baseUrl || 'https://dav.jianguoyun.com/dav',
      username: this.config.credentials.username,
      password: this.config.credentials.password,
      rootPath: this.config.rootPath || '/Flota/',
      enableDebugLog: this.config.enableDebugLog || false,
      syncIPCHandler: this.syncIPCHandler, // 传递冲突解决处理器
      syncCategories: this.config.syncCategories || ['notes', 'images', 'settings', 'todos'], // 传递启用的类别
    });

    // 转发事件
    this.engine.on('syncStart', () => {
      this.isSyncing = true;
      this.status = 'syncing';
      this.emit('syncStart');
    });

    // 恢复 lastSyncTime 到引擎（避免重启后白板预览全量重传）
    if (this.lastSyncTime > 0) {
      this.engine.lastSyncTime = this.lastSyncTime;
    }

    this.engine.on('syncProgress', (data) => {
      this.emit('syncProgress', data);
    });

    this.engine.on('syncComplete', (result) => {
      this.isSyncing = false;
      this.lastSyncTime = Date.now();

      if (result.success) {
        this.status = 'success';
        this.lastError = null;
      } else {
        this.status = 'error';
        this.lastError = `同步完成但有 ${result.errors} 个错误`;
      }

      // 持久化同步时间
      this.saveConfig();

      this.emit('syncComplete', result);
    });

    this.engine.on('syncError', (error) => {
      this.isSyncing = false;
      this.status = 'error';
      this.lastError = error.message;
      this.emit('syncError', error);
    });

    // 测试连接
    await this.engine.testConnection();

    this.isEnabled = true;
    this.status = 'idle';
    this.config.enabled = true;
    this.saveConfig();

    // 启动自动同步
    if (this.config.autoSync) {
      this.startAutoSync();
    }

    // 如果是首次启用（从未同步过），立即执行一次同步
    if (this.lastSyncTime === 0) {
      console.log('[V3SyncService] 首次启用，立即执行初始同步');
      // 使用 setTimeout 避免阻塞 enable() 方法
      setTimeout(async () => {
        try {
          await this.sync();
        } catch (error) {
          console.error('[V3SyncService] 初始同步失败:', error);
        }
      }, 1000); // 延迟 1 秒，确保 UI 已经更新
    }

    console.log('[V3SyncService] 同步服务已启用');
  }

  /**
   * 禁用同步服务
   */
  async disable() {
    console.log('[V3SyncService] 禁用同步服务...');

    this.isEnabled = false;
    this.status = 'disabled';
    this.engine = null;

    // 停止自动同步
    this.stopAutoSync();

    this.config.enabled = false;
    this.saveConfig();

    this.emit('disabled');
  }

  /**
   * 设置凭据
   */
  async setCredentials(username, password, baseUrl = 'https://dav.jianguoyun.com/dav') {
    this.config = this.config || {};
    this.config.credentials = { username, password };
    this.config.baseUrl = baseUrl;
    this.saveConfig();

    console.log('[V3SyncService] 凭据已设置');
  }

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.config || !this.config.credentials) {
      throw new Error('请先配置同步凭据');
    }

    // 创建临时引擎
    const tempEngine = new SyncEngine({
      baseUrl: this.config.baseUrl || 'https://dav.jianguoyun.com/dav',
      username: this.config.credentials.username,
      password: this.config.credentials.password,
    });

    return await tempEngine.testConnection();
  }

  /**
   * 手动同步
   */
  async sync() {
    if (!this.isEnabled || !this.engine) {
      throw new Error('同步服务未启用');
    }

    if (this.isSyncing) {
      throw new Error('同步已在进行中');
    }

    console.log('[V3SyncService] 开始手动同步...');
    return await this.engine.performSync();
  }

  /**
   * 强制全量同步
   */
  async forceFullSync() {
    if (!this.isEnabled || !this.engine) {
      throw new Error('同步服务未启用');
    }

    console.log('[V3SyncService] 开始强制全量同步...');
    return await this.engine.forceFullSync();
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    this.stopAutoSync();

    const interval = this.config.autoSyncInterval || this.autoSyncInterval;
    console.log(`[V3SyncService] 启动自动同步 (间隔: ${interval / 1000}秒)`);

    this.autoSyncTimer = setInterval(async () => {
      if (this.isEnabled && !this.isSyncing) {
        try {
          console.log('[V3SyncService] 执行自动同步...');
          await this.sync();
        } catch (error) {
          console.error('[V3SyncService] 自动同步失败:', error);
        }
      }
    }, interval);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
      console.log('[V3SyncService] 自动同步已停止');
    }
  }

  /**
   * 设置自动同步间隔
   */
  setAutoSyncInterval(minutes) {
    this.config.autoSyncInterval = minutes * 60 * 1000;
    this.saveConfig();

    if (this.config.autoSync && this.isEnabled) {
      this.startAutoSync();
    }
  }

  /**
   * 切换自动同步
   */
  toggleAutoSync(enabled) {
    this.config.autoSync = enabled;
    this.saveConfig();

    if (enabled && this.isEnabled) {
      this.startAutoSync();
    } else {
      this.stopAutoSync();
    }
  }

  /**
   * 启用特定类别的同步
   * @param {string} category - 类别名称：'notes', 'images', 'settings', 'todos'
   */
  enableCategory(category) {
    if (!this.config.syncCategories) {
      this.config.syncCategories = [];
    }
    if (!this.config.syncCategories.includes(category)) {
      this.config.syncCategories.push(category);
      this.saveConfig();
      console.log(`[V3SyncService] 已启用类别: ${category}`);
      
      // 如果引擎已创建，更新引擎的配置
      if (this.engine) {
        this.engine.config.syncCategories = [...this.config.syncCategories];
      }
    }
  }

  /**
   * 禁用特定类别的同步
   * @param {string} category - 类别名称：'notes', 'images', 'settings', 'todos'
   */
  disableCategory(category) {
    if (!this.config.syncCategories) {
      this.config.syncCategories = [];
    }
    const index = this.config.syncCategories.indexOf(category);
    if (index > -1) {
      this.config.syncCategories.splice(index, 1);
      this.saveConfig();
      console.log(`[V3SyncService] 已禁用类别: ${category}`);
      
      // 如果引擎已创建，更新引擎的配置
      if (this.engine) {
        this.engine.config.syncCategories = [...this.config.syncCategories];
      }
    }
  }

  /**
   * 检查特定类别是否启用
   * @param {string} category - 类别名称
   * @returns {boolean}
   */
  isCategoryEnabled(category) {
    if (!this.config.syncCategories) {
      return false;
    }
    return this.config.syncCategories.includes(category);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      serviceName: this.serviceName,
      displayName: this.displayName,
      enabled: this.isEnabled,
      syncing: this.isSyncing,
      status: this.status,
      lastError: this.lastError,
      lastSyncTime: this.lastSyncTime,
      config: {
        autoSync: this.config?.autoSync || false,
        autoSyncInterval: (this.config?.autoSyncInterval || this.autoSyncInterval) / 1000 / 60, // 转为分钟
        baseUrl: this.config?.baseUrl || '',
        username: this.config?.credentials?.username || '',
        syncCategories: this.config?.syncCategories || [],
      },
    };
  }

  /**
   * 加载配置
   */
  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const content = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(content);

        // 恢复上次同步时间
        if (typeof this.config.lastSyncTime === 'number') {
          this.lastSyncTime = this.config.lastSyncTime;
          console.log('[V3SyncService] 恢复上次同步时间:', new Date(this.lastSyncTime).toLocaleString());
        }

        console.log('[V3SyncService] 配置已加载');
      } catch (error) {
        console.error('[V3SyncService] 加载配置失败:', error);
        this.config = this.getDefaultConfig();
      }
    } else {
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * 保存配置
   */
  saveConfig() {
    try {
      // 保存上次同步时间到配置中
      const configToSave = {
        ...this.config,
        lastSyncTime: this.lastSyncTime
      };

      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2), 'utf8');
      console.log('[V3SyncService] 配置已保存');
    } catch (error) {
      console.error('[V3SyncService] 保存配置失败:', error);
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return {
      enabled: false,
      autoSync: false,
      autoSyncInterval: 5 * 60 * 1000, // 5 分钟
      baseUrl: 'https://dav.jianguoyun.com/dav',
      rootPath: '/Flota/',
      enableDebugLog: false,
      credentials: null,
      syncCategories: ['notes', 'images', 'settings', 'todos'], // 默认同步所有类别
    };
  }

  /**
   * 导出数据（仅用于备份）
   */
  async exportData() {
    if (!this.isEnabled || !this.engine) {
      throw new Error('同步服务未启用');
    }

    // 导出本地数据
    const storage = this.engine.storage;
    const notes = await storage.getAllNotes(false);
    const todos = await storage.getAllTodos(false);
    const settings = await storage.getAllSettings();

    return {
      notes: Object.values(notes),
      todos: Object.values(todos),
      settings,
      exportTime: Date.now(),
    };
  }

  /**
   * 上传图片到云端
   * @param {string} localPath - 本地图片文件路径
   * @param {string} relativePath - 云端相对路径 (例如: "images/whiteboard/hash.png")
   * @returns {Promise<void>}
   */
  async uploadImage(localPath, relativePath) {
    if (!this.isEnabled || !this.engine) {
      throw new Error('同步服务未启用');
    }

    const fs = require('fs').promises;
    const axios = require('axios');

    const remotePath = this.config.rootPath + relativePath;

    try {
      // 确保目录结构存在（逐级创建）
      await this.ensureImageDirectories();

      // 读取本地文件
      const fileContent = await fs.readFile(localPath);

      // 上传图片
      await axios({
        method: 'PUT',
        url: `${this.config.baseUrl}${remotePath}`,
        auth: {
          username: this.config.credentials.username,
          password: this.config.credentials.password,
        },
        data: fileContent,
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        timeout: 30000,
      });

      console.log(`[V3图片同步] 上传成功: ${relativePath}`);
    } catch (error) {
      console.error(`[V3图片同步] 上传失败: ${relativePath}`, error.message);
      throw error;
    }
  }

  /**
   * 确保图片目录结构存在
   * @private
   */
  async ensureImageDirectories() {
    // 使用缓存标记，避免重复检查
    if (this._imageDirectoriesEnsured) {
      return;
    }

    const axios = require('axios');

    // 需要创建的目录（按层级顺序）
    const directories = [
      this.config.rootPath,                           // /Flota/
      this.config.rootPath + 'images/',               // /Flota/images/
      this.config.rootPath + 'images/whiteboard/',    // /Flota/images/whiteboard/
      this.config.rootPath + 'images/whiteboard-preview/',  // /Flota/images/whiteboard-preview/
    ];

    for (const dir of directories) {
      try {
        // 检查目录是否存在
        try {
          await axios({
            method: 'PROPFIND',
            url: `${this.config.baseUrl}${dir}`,
            auth: {
              username: this.config.credentials.username,
              password: this.config.credentials.password,
            },
            headers: {
              'Depth': '0',
            },
            timeout: 5000,
          });
          // 目录存在，继续下一个
          continue;
        } catch (checkError) {
          // 404 表示不存在，需要创建
          if (checkError.response?.status !== 404) {
            // 其他错误，假定目录存在
            continue;
          }
        }

        // 创建目录
        await axios({
          method: 'MKCOL',
          url: `${this.config.baseUrl}${dir}`,
          auth: {
            username: this.config.credentials.username,
            password: this.config.credentials.password,
          },
          timeout: 10000,
        });

        console.log(`[V3图片同步] 创建目录: ${dir}`);
      } catch (error) {
        // 409 通常表示目录已存在，可以忽略
        if (error.response?.status === 409) {
          console.log(`[V3图片同步] 目录已存在: ${dir}`);
        } else {
          console.error(`[V3图片同步] 创建目录失败: ${dir}`, error.message);
          throw error;
        }
      }
    }

    this._imageDirectoriesEnsured = true;
    console.log('[V3图片同步] 图片目录结构已确保');
  }

  /**
   * 从云端下载图片
   * @param {string} relativePath - 云端相对路径 (例如: "images/whiteboard/hash.png")
   * @param {string} localPath - 本地保存路径
   * @returns {Promise<void>}
   */
  async downloadImage(relativePath, localPath) {
    if (!this.isEnabled || !this.engine) {
      throw new Error('同步服务未启用');
    }

    const fs = require('fs').promises;
    const axios = require('axios');

    const remotePath = this.config.rootPath + relativePath;

    try {
      // 从云端下载
      const response = await axios({
        method: 'GET',
        url: `${this.config.baseUrl}${remotePath}`,
        auth: {
          username: this.config.credentials.username,
          password: this.config.credentials.password,
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      // 确保本地目录存在
      const localDir = localPath.substring(0, localPath.lastIndexOf(path.sep));
      await fs.mkdir(localDir, { recursive: true });

      // 保存到本地
      await fs.writeFile(localPath, response.data);

      console.log(`[V3图片同步] 下载成功: ${relativePath}`);
    } catch (error) {
      console.error(`[V3图片同步] 下载失败: ${relativePath}`, error);
      throw error;
    }
  }

  /**
   * 清除所有配置和缓存
   */
  clearAll() {
    this.stopAutoSync();
    this.isEnabled = false;
    this.engine = null;

    // 删除配置文件
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath);
    }

    // 删除本地 manifest 缓存
    const manifestPath = path.join(getUserDataPath(), 'sync-manifest.json');
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
    }

    this.config = this.getDefaultConfig();
    console.log('[V3SyncService] 所有配置和缓存已清除');
  }

  /**
   * 获取未使用图片统计信息
   * @param {number} retentionDays - 保留天数
   * @returns {Promise<{success: boolean, data: {orphanedCount: number, totalSizeMB: number}}>}
   */
  async getUnusedImagesStats(retentionDays = 30) {
    try {
      const ImageCleanupService = require('../ImageCleanupService');
      const cleanupService = new ImageCleanupService();
      cleanupService.initialize();

      const stats = await cleanupService.scanUnusedImages(retentionDays);

      return {
        success: true,
        data: {
          orphanedCount: stats.unusedCount,
          totalSizeMB: stats.totalSizeMB
        }
      };
    } catch (error) {
      console.error('[V3SyncService] 获取图片统计失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 清理未使用的图片（本地 + 云端）
   * @param {number} retentionDays - 保留天数
   * @returns {Promise<{success: boolean, data: {deletedCount: number, totalSize: number}}>}
   */
  async cleanupUnusedImages(retentionDays = 30) {
    try {
      const ImageCleanupService = require('../ImageCleanupService');
      const cleanupService = new ImageCleanupService();
      cleanupService.initialize();

      // 1. 扫描未使用的图片
      const { files } = await cleanupService.scanUnusedImages(retentionDays);

      console.log(`[V3图片清理] 准备清理 ${files.length} 个未使用的图片`);

      // 2. 删除本地图片
      const localResult = await cleanupService.cleanupImages(files);

      // 3. 删除云端图片（如果同步已启用）
      if (this.engine && this.isEnabled) {
        console.log('[V3图片清理] 同步已启用，开始删除云端图片');
        for (const file of files) {
          const remotePath = `${this.config.rootPath}${file.relativePath}`;
          try {
            await this.engine.client.delete(remotePath);
            console.log(`[V3图片清理] 已删除云端图片: ${remotePath}`);
          } catch (err) {
            console.warn(`[V3图片清理] 删除云端图片失败: ${remotePath}`, err.message);
            // 继续清理其他文件，不中断流程
          }
        }
      } else {
        console.log('[V3图片清理] 同步未启用，跳过云端图片删除');
      }

      return {
        success: true,
        data: {
          deletedCount: localResult.deletedCount,
          totalSize: localResult.totalSize
        }
      };
    } catch (error) {
      console.error('[V3SyncService] 清理图片失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// 单例
let instance = null;

/**
 * 获取 V3 同步服务实例
 */
function getInstance() {
  if (!instance) {
    instance = new V3SyncService();
  }
  return instance;
}

module.exports = { V3SyncService, getInstance };
