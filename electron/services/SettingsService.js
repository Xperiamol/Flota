const SettingDAO = require('../dao/SettingDAO');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// 尝试加载 Electron，如果失败则使用 null（独立运行模式）
let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {
  // 独立运行模式（如 MCP Server），不依赖 Electron
}

// 获取用户数据目录
const getUserDataPath = () => {
  if (app) {
    return app.getPath('userData');
  }
  // 独立运行模式：使用标准路径
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

class SettingsService extends EventEmitter {
  constructor() {
    super();
    this.settingDAO = new SettingDAO();
    this.cache = new Map(); // 设置缓存
    this.loadCache();
  }

  /**
   * 关键设置的语义校验规则
   */
  static VALIDATION_RULES = {
    ai_api_url: (v) => !v || /^https?:\/\/.+/.test(v) ? null : 'API地址必须以 http:// 或 https:// 开头',
    ai_temperature: (v) => { const n = Number(v); return n >= 0 && n <= 2 ? null : '温度参数必须在 0-2 之间'; },
    ai_max_tokens: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 128000 ? null : 'Token数必须为 1-128000 的整数'; },
    auto_save_interval: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1000 && n <= 300000 ? null : '自动保存间隔必须在 1000-300000ms 之间'; },

    sync_interval: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 30000 ? null : '同步间隔不能少于 30 秒'; },
    window_width: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 400 ? null : '窗口宽度最小 400'; },
    window_height: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 300 ? null : '窗口高度最小 300'; },
  };

  /**
   * 加载设置到缓存
   */
  async loadCache() {
    try {
      const settings = this.settingDAO.getAll();
      this.cache.clear();
      
      for (const [key, setting] of Object.entries(settings)) {
        this.cache.set(key, setting.value);
      }
      
      console.log('设置缓存加载完成');
    } catch (error) {
      console.error('加载设置缓存失败:', error);
    }
  }

  /** 统一 try/catch 包装 */
  async _wrap(fn, ctx) {
    try { return await fn() } catch (e) {
      console.error(`${ctx}失败:`, e)
      return { success: false, error: e.message }
    }
  }

  /**
   * 获取单个设置
   */
  async getSetting(key) {
    try {
      // 优先从缓存获取
      if (this.cache.has(key)) {
        return {
          success: true,
          data: this.cache.get(key)
        };
      }
      
      // 从数据库获取
      const setting = this.settingDAO.get(key);
      if (!setting) {
        return {
          success: false,
          error: '设置不存在'
        };
      }
      
      // 更新缓存
      this.cache.set(key, setting.value);
      
      return {
        success: true,
        data: setting.value
      };
    } catch (error) {
      console.error('获取设置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取多个设置
   */
  async getSettings(keys) {
    try {
      const result = {};
      const missingKeys = [];
      
      // 先从缓存获取
      for (const key of keys) {
        if (this.cache.has(key)) {
          result[key] = this.cache.get(key);
        } else {
          missingKeys.push(key);
        }
      }
      
      // 从数据库获取缺失的设置
      if (missingKeys.length > 0) {
        const dbSettings = this.settingDAO.getMultiple(missingKeys);
        for (const [key, setting] of Object.entries(dbSettings)) {
          result[key] = setting.value;
          this.cache.set(key, setting.value);
        }
      }
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('获取多个设置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取所有设置
   */
  async getAllSettings() {
    try {
      const settings = this.settingDAO.getAll();
      const result = {};
      
      for (const [key, setting] of Object.entries(settings)) {
        result[key] = setting.value;
        this.cache.set(key, setting.value);
      }
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('获取所有设置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 设置单个配置
   */
  async setSetting(key, value, type = 'string', description = '') {
    try {
      // 类型验证
      if (!this.settingDAO.validateValue(value, type)) {
        return {
          success: false,
          error: `无效的${type}类型值`
        };
      }

      // 语义校验
      const rule = SettingsService.VALIDATION_RULES[key];
      if (rule) {
        const errorMsg = rule(value);
        if (errorMsg) return { success: false, error: errorMsg };
      }
      
      const setting = this.settingDAO.set(key, value, type, description);
      
      // 更新缓存
      this.cache.set(key, setting.value);
      
      // 发送设置变更事件
      this.emit('setting-changed', { key, value: setting.value, oldValue: this.cache.get(key) });
      
      return {
        success: true,
        data: setting.value
      };
    } catch (error) {
      console.error('设置配置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量设置配置
   */
  async setSettings(settings) {
    try {
      const oldValues = {};
      
      // 记录旧值
      for (const key of Object.keys(settings)) {
        oldValues[key] = this.cache.get(key);
      }

      // 规范化输入：支持 { key: value } 和 { key: { value, type } } 两种格式
      const normalized = {};
      for (const [key, val] of Object.entries(settings)) {
        if (val !== null && typeof val === 'object' && 'value' in val) {
          // 已经是 { value, type?, description? } 格式
          normalized[key] = val;
        } else {
          // 简化格式 { key: rawValue }，自动推断类型
          let type = 'string';
          if (typeof val === 'boolean') type = 'boolean';
          else if (typeof val === 'number') type = 'number';
          else if (Array.isArray(val)) type = 'array';
          else if (typeof val === 'object' && val !== null) type = 'object';
          normalized[key] = { value: val, type };
        }
      }
      
      const result = this.settingDAO.setMultiple(normalized);
      
      // 更新缓存
      for (const [key, setting] of Object.entries(result)) {
        this.cache.set(key, setting.value);
      }
      
      // 发送批量设置变更事件
      this.emit('settings-changed', { settings: result, oldValues });
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('批量设置配置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 删除设置
   */
  async deleteSetting(key) {
    try {
      const oldValue = this.cache.get(key);
      const success = this.settingDAO.delete(key);
      
      if (!success) {
        return {
          success: false,
          error: '设置不存在'
        };
      }
      
      // 从缓存中移除
      this.cache.delete(key);
      
      this.emit('setting-deleted', { key, oldValue });
      
      return {
        success: true,
        message: '设置已删除'
      };
    } catch (error) {
      console.error('删除设置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 重置所有设置为默认值
   */
  async resetToDefaults() {
    return this._wrap(async () => {
      const oldSettings = { ...Object.fromEntries(this.cache) };
      const defaultSettings = this.settingDAO.resetToDefaults();
      await this.loadCache();
      this.emit('settings-reset', { oldSettings, newSettings: defaultSettings });
      return { success: true, data: defaultSettings };
    }, '重置设置')
  }

  /**
   * 获取主题相关设置
   */
  async getThemeSettings() {
    return this._wrap(() => this.getSettings(['theme', 'customThemeColor']), '获取主题设置')
  }

  /**
   * 设置主题
   */
  async setTheme(themeMode, primaryColor) {
    return this._wrap(() => {
      const settings = {};
      if (themeMode !== undefined) settings.theme = { value: themeMode, type: 'string', description: '主题模式' };
      if (primaryColor !== undefined) settings.customThemeColor = { value: primaryColor, type: 'string', description: '主色调' };
      return this.setSettings(settings);
    }, '设置主题')
  }

  /**
   * 获取窗口相关设置
   */
  async getWindowSettings() {
    return this._wrap(() => this.getSettings(['window_width', 'window_height', 'window_x', 'window_y']), '获取窗口设置')
  }

  /**
   * 保存窗口状态
   */
  async saveWindowState(bounds) {
    return this._wrap(() => this.setSettings({
      window_width: { value: bounds.width, type: 'number', description: '窗口宽度' },
      window_height: { value: bounds.height, type: 'number', description: '窗口高度' },
      window_x: { value: bounds.x, type: 'number', description: '窗口X位置' },
      window_y: { value: bounds.y, type: 'number', description: '窗口Y位置' },
    }), '保存窗口状态')
  }

  /**
   * 获取编辑器相关设置
   */
  async getEditorSettings() {
    return this._wrap(() => this.getSettings([
      'auto_save', 'auto_save_interval'
    ]), '获取编辑器设置')
  }

  /**
   * 导出设置
   */
  async exportSettings() {
    return this._wrap(() => ({
      success: true, data: this.settingDAO.export(),
      filename: `Flota-settings-${new Date().toISOString().split('T')[0]}.json`
    }), '导出设置')
  }

  /**
   * 导入设置
   */
  async importSettings(data) {
    return this._wrap(async () => {
      const oldSettings = { ...Object.fromEntries(this.cache) };
      const result = this.settingDAO.import(data);
      await this.loadCache();
      this.emit('settings-imported', { oldSettings, newSettings: result });
      return { success: true, data: result };
    }, '导入设置')
  }

  /**
   * 搜索设置
   */
  async searchSettings(query) {
    return this._wrap(() => ({ success: true, data: this.settingDAO.search(query) }), '搜索设置')
  }

  async getSettingsByType(type) {
    return this._wrap(() => ({ success: true, data: this.settingDAO.getByType(type) }), '按类型获取设置')
  }

  async deleteMultipleSettings(keys) {
    return this._wrap(() => {
      const result = this.settingDAO.deleteMultiple(keys)
      keys.forEach(k => this.cache.delete(k))
      return { success: true, data: result }
    }, '批量删除设置')
  }

  /**
   * 获取设置统计信息
   */
  async getSettingsStats() {
    return this._wrap(() => ({ success: true, data: { ...this.settingDAO.getStats(), cacheSize: this.cache.size } }), '获取设置统计')
  }

  /**
   * 监听设置变更
   */
  onSettingChanged(callback) {
    this.on('setting-changed', callback);
  }

  /**
   * 监听批量设置变更
   */
  onSettingsChanged(callback) {
    this.on('settings-changed', callback);
  }

  /**
   * 监听设置重置
   */
  onSettingsReset(callback) {
    this.on('settings-reset', callback);
  }

  /**
   * 获取缓存的设置值（同步）
   */
  getCachedSetting(key, defaultValue = null) {
    return this.cache.get(key) || defaultValue;
  }

  /**
   * 检查设置是否存在
   */
  hasSetting(key) {
    return this.cache.has(key) || this.settingDAO.exists(key);
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 重新加载缓存
   */
  async reloadCache() {
    await this.loadCache();
    this.emit('cache-reloaded');
  }

  /**
   * 获取应用数据目录路径
   */
  getAppDataPath() {
    return getUserDataPath();
  }

  /**
   * 获取设置文件路径
   */
  getSettingsPath() {
    return path.join(this.getAppDataPath(), 'settings.json');
  }

  /**
   * 备份设置到文件
   */
  async backupSettings() {
    try {
      const exportData = await this.exportSettings();
      if (!exportData.success) {
        return exportData;
      }
      
      const backupPath = path.join(
        this.getAppDataPath(), 
        'backups', 
        `settings-backup-${Date.now()}.json`
      );
      
      // 确保备份目录存在
      const backupDir = path.dirname(backupPath);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      fs.writeFileSync(backupPath, JSON.stringify(exportData.data, null, 2));
      
      return {
        success: true,
        data: {
          backupPath,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('备份设置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 选择壁纸文件，复制到 userData/wallpaper/ 并返回 app:// URL
   */
  async selectWallpaper() {
    const { dialog, app } = require('electron');
    const path = require('path');
    const fs = require('fs');
    
    try {
      const result = await dialog.showOpenDialog({
        title: '选择壁纸',
        filters: [
          {
            name: '图片文件',
            extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
          }
        ],
        properties: ['openFile']
      });
      
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: '用户取消选择' };
      }

      const srcPath = result.filePaths[0];
      const ext = path.extname(srcPath).toLowerCase();
      const wallpaperDir = path.join(app.getPath('userData'), 'wallpaper');
      
      // 确保目录存在
      if (!fs.existsSync(wallpaperDir)) {
        fs.mkdirSync(wallpaperDir, { recursive: true });
      }

      // 固定文件名，覆盖旧壁纸
      const destName = `current${ext}`;
      const destPath = path.join(wallpaperDir, destName);
      fs.copyFileSync(srcPath, destPath);

      // 返回 app:// 协议 URL（带时间戳防缓存）
      const appUrl = `app://wallpaper/${destName}?t=${Date.now()}`;
      return { success: true, data: appUrl };
    } catch (error) {
      console.error('选择壁纸失败:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = SettingsService;