/**
 * Flota v3.0 原子化同步系统 - 服务管理类
 *
 * 集成到现有 CloudSyncManager 系统中
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

let safeStorage = null;
try {
  safeStorage = require('electron').safeStorage;
} catch (e) {
  safeStorage = null;
}

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
    this.lastErrorCategory = null;
    this.lastSyncTime = 0;
    this.lastSyncDuration = 0;
    this.lastSyncStartedAt = 0;

    // 自动同步定时器
    this.autoSyncTimer = null;
    this.autoSyncInterval = 5 * 60 * 1000; // 默认 5 分钟
    this.autoSyncNextAt = 0;

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

  normalizeRootPath(rootPath, fallbackRootPath = '/Flota/') {
    const base = typeof fallbackRootPath === 'string' && fallbackRootPath.trim()
      ? fallbackRootPath.trim()
      : '/Flota/';

    if (typeof rootPath !== 'string' || !rootPath.trim()) {
      return base.startsWith('/')
        ? (base.endsWith('/') ? base : `${base}/`)
        : `/${base.endsWith('/') ? base : `${base}/`}`;
    }

    const normalized = rootPath.trim();
    return normalized.startsWith('/')
      ? (normalized.endsWith('/') ? normalized : `${normalized}/`)
      : `/${normalized.endsWith('/') ? normalized : `${normalized}/`}`;
  }

  hasSavedPassword() {
    return !!(
      this.config?.credentials?.password ||
      this.config?.credentials?.passwordEncrypted
    );
  }

  classifyError(error) {
    if (!error) return null;
    const message = (error.message || error.toString() || '').toLowerCase();
    const status = error.status || error.statusCode;

    if (status === 401 || status === 403 || /unauthor|forbidden|认证|密码|凭据/.test(message)) {
      return 'auth';
    }
    if (status === 507 || /quota|insufficient storage|空间|容量/.test(message)) {
      return 'quota';
    }
    if (/etimedout|enotfound|econnrefused|network|超时|网络|无法连接/.test(message)) {
      return 'network';
    }
    if (status >= 500 || /server|服务器/.test(message)) {
      return 'server';
    }
    return 'unknown';
  }

  /**
   * 构建一份新的配置候选。
   *
   * 设计原则（重要）：
   *   - 密码字段是"显式"的：只要 input 里出现 password 字段，就**完全**以 input.password 为准；
   *     绝不悄悄回退到磁盘上已保存的旧密码。否则会出现"用户改了密码但实际还在用旧的"这种
   *     极其难调试的错配。
   *   - 仅当 input 中**完全没有** password 字段时，才沿用 this.config 里的密码（用于内部
   *     调用：例如 enable() 不带任何参数地重新创建 engine）。
   *   - `preservePassword` 选项已废弃，传入也无效，留参数仅为向后兼容。
   */
  buildConfigCandidate(input = {}) {
    const defaults = this.getDefaultConfig();
    const current = this.config || defaults;
    const currentCredentials = current.credentials || {};
    const hasPasswordField = Object.prototype.hasOwnProperty.call(input || {}, 'password');
    const hasUsernameField = Object.prototype.hasOwnProperty.call(input || {}, 'username');
    const hasBaseUrlField = Object.prototype.hasOwnProperty.call(input || {}, 'baseUrl');
    const hasRootPathField = Object.prototype.hasOwnProperty.call(input || {}, 'rootPath');

    // 唯一的密码取值规则：
    //   - input 显式带 password 字段 → 完全用 input.password（即使是空字符串）
    //   - input 没有 password 字段   → 沿用 this.config 里的密码
    const password = hasPasswordField
      ? (typeof input.password === 'string' ? input.password : '')
      : (currentCredentials.password || '');

    return {
      ...defaults,
      ...current,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : (current.enabled ?? defaults.enabled),
      autoSync: typeof input.autoSync === 'boolean' ? input.autoSync : (current.autoSync ?? defaults.autoSync),
      autoSyncInterval: typeof input.autoSyncInterval === 'number'
        ? input.autoSyncInterval
        : (current.autoSyncInterval || defaults.autoSyncInterval),
      baseUrl: hasBaseUrlField && typeof input.baseUrl === 'string' && input.baseUrl.trim()
        ? input.baseUrl.trim()
        : (current.baseUrl || defaults.baseUrl),
      rootPath: this.normalizeRootPath(
        hasRootPathField ? input.rootPath : current.rootPath,
        current.rootPath || defaults.rootPath
      ),
      syncCategories: Array.isArray(input.syncCategories)
        ? [...input.syncCategories]
        : (current.syncCategories || defaults.syncCategories),
      credentials: {
        username: hasUsernameField && typeof input.username === 'string'
          ? input.username.trim()
          : (currentCredentials.username || ''),
        password,
      },
    };
  }

  validateConnectionConfig(config) {
    if (!config?.credentials?.username) {
      throw new Error('请填写用户名');
    }

    if (!config?.credentials?.password) {
      throw new Error('请填写应用密码');
    }

    if (!config?.baseUrl || !/^https?:\/\/.+/i.test(config.baseUrl)) {
      throw new Error('WebDAV 地址格式不正确');
    }
  }

  createSyncEngine(config) {
    return new SyncEngine({
      baseUrl: config.baseUrl || 'https://dav.jianguoyun.com/dav',
      username: config.credentials.username,
      password: config.credentials.password,
      rootPath: config.rootPath || '/Flota/',
      enableDebugLog: config.enableDebugLog || false,
      syncIPCHandler: this.syncIPCHandler,
      syncCategories: config.syncCategories || ['notes', 'images', 'attachments', 'settings', 'todos'],
    });
  }

  bindEngineEvents(engine) {
    engine.on('syncStart', () => {
      this.isSyncing = true;
      this.status = 'syncing';
      this.lastSyncStartedAt = Date.now();
      this.emit('syncStart');
    });

    if (this.lastSyncTime > 0) {
      engine.lastSyncTime = this.lastSyncTime;
    }

    engine.on('syncProgress', (data) => {
      this.emit('syncProgress', data);
    });

    engine.on('syncComplete', (result) => {
      this.isSyncing = false;
      this.lastSyncTime = Date.now();
      this.lastSyncDuration = this.lastSyncStartedAt
        ? this.lastSyncTime - this.lastSyncStartedAt
        : 0;

      if (result.success) {
        this.status = 'success';
        this.lastError = null;
        this.lastErrorCategory = null;
        if (result.errors > 0) {
          console.warn(`[V3SyncService] 同步完成，包含 ${result.errors} 个非致命告警`);
        }
      } else {
        this.status = 'error';
        this.lastError = `同步完成但有 ${result.errors} 个错误`;
        this.lastErrorCategory = 'unknown';
      }

      this.refreshNextAutoSyncAt();
      this.saveConfig();
      this.emit('syncComplete', result);
    });

    engine.on('syncError', (error) => {
      this.isSyncing = false;
      this.status = 'error';
      this.lastError = error.message;
      this.lastErrorCategory = this.classifyError(error);
      this.emit('syncError', error);
    });
  }

  refreshNextAutoSyncAt() {
    if (this.isEnabled && this.config?.autoSync && this.autoSyncTimer) {
      const interval = this.config.autoSyncInterval || this.autoSyncInterval;
      this.autoSyncNextAt = Date.now() + interval;
    } else {
      this.autoSyncNextAt = 0;
    }
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
   * 关键不变量：
   *  - 在连接验证通过之前，不修改任何已生效状态（this.engine/this.config/this.isEnabled）
   *  - 不写盘（saveConfig 仅在验证通过后调用），避免把错误账户残留到下次启动
   */
  async enable() {
    const nextConfig = this.buildConfigCandidate();
    this.validateConnectionConfig(nextConfig);

    console.log('[V3SyncService] 启用同步服务...');

    const nextEngine = this.createSyncEngine(nextConfig);

    // 先验证连接，失败时直接抛出且不污染当前状态。
    // 注意：此处尚未 bindEngineEvents，避免临时引擎的 syncError 事件覆盖业务状态。
    try {
      await nextEngine.testConnection();
    } catch (error) {
      this.lastError = error.message;
      this.lastErrorCategory = this.classifyError(error);
      this.status = this.isEnabled ? 'error' : 'disabled';
      throw error;
    }

    // 验证通过，正式接管
    this.bindEngineEvents(nextEngine);
    this.stopAutoSync();
    if (this.engine) {
      this.engine.removeAllListeners();
    }

    this.engine = nextEngine;
    this.config = {
      ...nextConfig,
      enabled: true,
    };
    this.isEnabled = true;
    this.isSyncing = false;
    this.status = 'idle';
    this.lastError = null;
    this.lastErrorCategory = null;
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
    this.isSyncing = false;
    this.status = 'disabled';
    if (this.engine) {
      this.engine.removeAllListeners();
      this.engine = null;
    }

    // 停止自动同步
    this.stopAutoSync();

    this.config = this.buildConfigCandidate({ enabled: false });
    this.saveConfig();

    this.emit('disabled');
  }

  /**
   * 设置凭据
   */
  async setCredentials(username, password, baseUrl = 'https://dav.jianguoyun.com/dav', rootPath = undefined) {
    this.config = this.buildConfigCandidate({ username, password, baseUrl, rootPath });
    this.saveConfig();

    console.log('[V3SyncService] 凭据已设置');
  }

  canEncryptCredentials() {
    return !!safeStorage?.isEncryptionAvailable?.();
  }

  encryptPassword(password) {
    if (!password || !this.canEncryptCredentials()) return null;
    return safeStorage.encryptString(password).toString('base64');
  }

  decryptPassword(encryptedPassword) {
    if (!encryptedPassword || !this.canEncryptCredentials()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'));
    } catch (error) {
      console.warn('[V3SyncService] 同步密码无法由本机钥匙串解密，已要求重新输入:', error.message);
      return '';
    }
  }

  /**
   * 测试连接
   *
   * 重要：测试连接时绝不"复用旧密码"。
   *   - 如果调用方传入 configInput 且其中显式包含 password 字段，就严格用该密码（即使为空字符串）。
   *   - 如果 configInput 中没有 password 字段，才会沿用磁盘上已保存的密码（用于内部 enable() 重连场景）。
   * `options` 参数已废弃，仅为向后兼容保留签名。
   */
  async testConnection(configInput = null, _options = undefined) {
    const config = configInput
      ? this.buildConfigCandidate(configInput)
      : this.buildConfigCandidate();

    this.validateConnectionConfig(config);

    if (configInput && Object.prototype.hasOwnProperty.call(configInput, 'password')) {
      const incoming = typeof configInput.password === 'string' ? configInput.password : '';
      console.log(
        `[V3SyncService] 测试连接：使用 ${incoming ? '前端传入的新密码' : '空密码（前端显式清空）'}`
      );
    } else {
      console.log('[V3SyncService] 测试连接：未传入 password 字段，沿用磁盘已保存的密码');
    }

    const tempEngine = this.createSyncEngine(config);
    return await tempEngine.testConnection();
  }

  /**
   * 保存连接配置
   * `options` 参数已废弃，仅为向后兼容保留签名。
   */
  async saveConnectionConfig(configInput = {}, _options = undefined) {
    const nextConfig = this.buildConfigCandidate(configInput);
    this.validateConnectionConfig(nextConfig);

    // 灾难防御：当用户名/服务器/根路径任一发生变化时，必须清理本地 cached manifest，
    // 否则旧账号的 manifest 会与新账号云端做 diff，可能产生大规模误删/上传/覆盖。
    const oldCreds = (this.config && this.config.credentials) || {};
    const identityChanged = (
      oldCreds.username && oldCreds.username !== nextConfig.credentials.username
    ) || (
      this.config && this.config.baseUrl && this.config.baseUrl !== nextConfig.baseUrl
    ) || (
      this.config && this.config.rootPath && this.config.rootPath !== nextConfig.rootPath
    );
    if (identityChanged) {
      try {
        const manifestPath = path.join(getUserDataPath(), 'sync-manifest.json');
        if (fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
          console.log('[V3SyncService] 检测到账号/服务器变更，已清理本地 cached manifest');
        }
      } catch (e) {
        console.warn('[V3SyncService] 清理 cached manifest 失败:', e.message);
      }
    }

    this.config = {
      ...nextConfig,
      enabled: this.isEnabled,
    };
    this.saveConfig();

    return this.getStatus();
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
      this.autoSyncNextAt = Date.now() + interval;
    }, interval);

    this.autoSyncNextAt = Date.now() + interval;
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
    this.autoSyncNextAt = 0;
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
    const intervalMs = this.config?.autoSyncInterval || this.autoSyncInterval;
    return {
      serviceName: this.serviceName,
      displayName: this.displayName,
      accountConfigured: !!this.config?.credentials?.username && this.hasSavedPassword(),
      enabled: this.isEnabled,
      syncing: this.isSyncing,
      status: this.status,
      lastError: this.lastError,
      lastErrorCategory: this.lastErrorCategory,
      lastSyncTime: this.lastSyncTime,
      lastSyncDuration: this.lastSyncDuration,
      nextAutoSyncTime: this.autoSyncNextAt || 0,
      config: {
        autoSync: this.config?.autoSync || false,
        autoSyncInterval: intervalMs / 1000 / 60, // 分钟
        autoSyncIntervalMs: intervalMs,
        baseUrl: this.config?.baseUrl || '',
        rootPath: this.config?.rootPath || '/Flota/',
        username: this.config?.credentials?.username || '',
        hasSavedPassword: this.hasSavedPassword(),
        syncCategories: this.config?.syncCategories || [],
        canEncryptCredentials: this.canEncryptCredentials(),
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

        if (this.config?.credentials?.passwordEncrypted) {
          const decrypted = this.decryptPassword(this.config.credentials.passwordEncrypted);
          if (decrypted) {
            this.config.credentials.password = decrypted;
          }
        }

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

      if (configToSave.credentials?.password && this.canEncryptCredentials()) {
        configToSave.credentials = {
          ...configToSave.credentials,
          passwordEncrypted: this.encryptPassword(configToSave.credentials.password)
        };
        delete configToSave.credentials.password;
      }

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
      syncCategories: ['notes', 'images', 'attachments', 'settings', 'todos'], // 默认同步所有类别
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
      this.config.rootPath + 'wallpaper/',            // /Flota/wallpaper/
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
