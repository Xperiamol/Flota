const { getInstance } = require('./DatabaseManager');

class SettingDAO {
  constructor() {
    this.dbManager = getInstance();
  }

  /**
   * 获取数据库实例
   */
  getDB() {
    return this.dbManager.getDatabase();
  }

  /**
   * 获取单个设置
   */
  get(key) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM settings WHERE key = ?');
    const setting = stmt.get(key);
    
    if (!setting) {
      return null;
    }
    
    // 根据类型转换值
    return {
      ...setting,
      value: this.parseValue(setting.value, setting.type)
    };
  }

  /**
   * 获取多个设置
   */
  getMultiple(keys) {
    const db = this.getDB();
    const placeholders = keys.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM settings WHERE key IN (${placeholders})`);
    const settings = stmt.all(...keys);
    
    const result = {};
    settings.forEach(setting => {
      result[setting.key] = {
        ...setting,
        value: this.parseValue(setting.value, setting.type)
      };
    });
    
    return result;
  }

  /**
   * 获取所有设置
   */
  getAll() {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM settings ORDER BY key');
    const settings = stmt.all();
    
    const result = {};
    settings.forEach(setting => {
      result[setting.key] = {
        ...setting,
        value: this.parseValue(setting.value, setting.type)
      };
    });
    
    return result;
  }

  /**
   * 设置单个配置
   */
  set(key, value, type = 'string', description = '') {
    const db = this.getDB();
    const stringValue = this.stringifyValue(value, type);
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, type, description, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(key, stringValue, type, description);
    return this.get(key);
  }

  /**
   * 批量设置配置
   */
  setMultiple(settings) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, type, description, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      for (const [key, config] of Object.entries(settings)) {
        const { value, type = 'string', description = '' } = config;
        const stringValue = this.stringifyValue(value, type);
        stmt.run(key, stringValue, type, description);
      }
    });
    
    transaction();
    return this.getMultiple(Object.keys(settings));
  }

  /**
   * 删除设置
   */
  delete(key) {
    const db = this.getDB();
    const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
    return stmt.run(key).changes > 0;
  }

  /**
   * 批量删除设置
   */
  deleteMultiple(keys) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
      for (const key of keys) {
        stmt.run(key);
      }
    });
    
    return transaction();
  }

  /**
   * 检查设置是否存在
   */
  exists(key) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT 1 FROM settings WHERE key = ?');
    return stmt.get(key) !== undefined;
  }

  /**
   * 获取设置的类型
   */
  getType(key) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT type FROM settings WHERE key = ?');
    const result = stmt.get(key);
    return result ? result.type : null;
  }

  /**
   * 搜索设置
   */
  search(query) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM settings 
      WHERE key LIKE ? OR description LIKE ?
      ORDER BY key
    `);
    
    const settings = stmt.all(`%${query}%`, `%${query}%`);
    
    const result = {};
    settings.forEach(setting => {
      result[setting.key] = {
        ...setting,
        value: this.parseValue(setting.value, setting.type)
      };
    });
    
    return result;
  }

  /**
   * 获取按类型分组的设置
   */
  getByType(type) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM settings WHERE type = ? ORDER BY key');
    const settings = stmt.all(type);
    
    const result = {};
    settings.forEach(setting => {
      result[setting.key] = {
        ...setting,
        value: this.parseValue(setting.value, setting.type)
      };
    });
    
    return result;
  }

  /**
   * 重置设置为默认值
   */
  resetToDefaults() {
    const db = this.getDB();
    
    // 删除所有现有设置
    db.exec('DELETE FROM settings');
    
    // 重新插入默认设置（key 与前端 initializeSettings 一致）
    const defaultSettings = [
      { key: 'theme', value: 'system', type: 'string', description: '主题模式' },
      { key: 'customThemeColor', value: '#1976d2', type: 'string', description: '主色调' },
      { key: 'titleBarStyle', value: 'windows', type: 'string', description: '标题栏样式' },
      { key: 'language', value: 'zh-CN', type: 'string', description: '界面语言' },
      { key: 'maskOpacity', value: 'medium', type: 'string', description: '遮罩强度' },
      { key: 'backgroundPattern', value: 'none', type: 'string', description: '背景花纹' },
      { key: 'patternOpacity', value: '1', type: 'number', description: '花纹强度' },
      { key: 'auto_save', value: 'true', type: 'boolean', description: '自动保存' },
      { key: 'auto_save_interval', value: '3000', type: 'number', description: '自动保存间隔(ms)' },
    ];

    const stmt = db.prepare(`
      INSERT INTO settings (key, value, type, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    for (const setting of defaultSettings) {
      stmt.run(setting.key, setting.value, setting.type, setting.description);
    }

    return this.getAll();
  }

  /**
   * 导出设置
   */
  export() {
    const settings = this.getAll();
    const exportData = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      settings: {}
    };
    
    for (const [key, setting] of Object.entries(settings)) {
      exportData.settings[key] = {
        value: setting.value,
        type: setting.type,
        description: setting.description
      };
    }
    
    return exportData;
  }

  /**
   * 导入设置
   */
  import(data) {
    if (!data.settings) {
      throw new Error('无效的设置数据格式');
    }
    
    const settingsToImport = {};
    for (const [key, config] of Object.entries(data.settings)) {
      settingsToImport[key] = {
        value: config.value,
        type: config.type || 'string',
        description: config.description || ''
      };
    }
    
    return this.setMultiple(settingsToImport);
  }

  /**
   * 获取设置统计信息
   */
  getStats() {
    const db = this.getDB();
    
    const totalStmt = db.prepare('SELECT COUNT(*) as total FROM settings');
    const typeStatsStmt = db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM settings 
      GROUP BY type 
      ORDER BY count DESC
    `);
    
    return {
      total: totalStmt.get().total,
      byType: typeStatsStmt.all()
    };
  }

  /**
   * 解析值根据类型
   */
  parseValue(value, type) {
    switch (type) {
      case 'boolean':
        return value === 'true' || value === true;
      case 'number':
        return Number(value);
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      case 'array':
        try {
          return JSON.parse(value);
        } catch {
          return [];
        }
      case 'object':
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      default:
        return value;
    }
  }

  /**
   * 将值转换为字符串存储
   */
  stringifyValue(value, type) {
    switch (type) {
      case 'boolean':
        return String(Boolean(value));
      case 'number':
        return String(Number(value));
      case 'json':
      case 'array':
      case 'object':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  }

  /**
   * 验证设置值
   */
  validateValue(value, type) {
    switch (type) {
      case 'boolean':
        return typeof value === 'boolean' || value === 'true' || value === 'false';
      case 'number':
        return !isNaN(Number(value));
      case 'json':
      case 'array':
      case 'object':
        try {
          JSON.parse(typeof value === 'string' ? value : JSON.stringify(value));
          return true;
        } catch {
          return false;
        }
      default:
        return true;
    }
  }

  /**
   * 获取窗口相关设置
   */
  getWindowSettings() {
    return this.getMultiple([
      'window_width',
      'window_height', 
      'window_x',
      'window_y'
    ]);
  }

  /**
   * 获取主题相关设置
   */
  getThemeSettings() {
    return this.getMultiple([
      'theme',
      'customThemeColor'
    ]);
  }

  /**
   * 获取编辑器相关设置
   */
  getEditorSettings() {
    return this.getMultiple([
      'auto_save',
      'auto_save_interval'
    ]);
  }
}

module.exports = SettingDAO;