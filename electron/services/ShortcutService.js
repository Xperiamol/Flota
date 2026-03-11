const { globalShortcut, BrowserWindow } = require('electron');
const { DEFAULT_SHORTCUTS } = require('../utils/shortcutUtils');

const PLUGIN_SHORTCUT_SETTING_KEY = 'pluginShortcuts';

class ShortcutService {
  constructor() {
    this.registeredShortcuts = new Map();
    this.mainWindow = null;
    this.windowManager = null;
    this.pluginManager = null;
    this.pluginCommandShortcuts = new Map(); // key -> { shortcutId, accelerator }
    this.pluginShortcutSettings = new Map(); // key -> binding metadata
    this.settingsService = null;
  }

  /**
   * 设置主窗口引用
   * @param {BrowserWindow} window 
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * 设置WindowManager引用
   * @param {import('./WindowManager')} windowManager
   */
  setWindowManager(windowManager) {
    this.windowManager = windowManager;
  }

  /**
   * 注入插件管理器，用于执行插件命令
   * @param {import('./PluginManager')} pluginManager
   */
  setPluginManager(pluginManager) {
    this.pluginManager = pluginManager;
  }

  async ensureSettingsService() {
    if (this.settingsService) {
      return this.settingsService;
    }

    const SettingsService = require('./SettingsService');
    this.settingsService = new SettingsService();
    return this.settingsService;
  }

  async loadPluginShortcutSettings() {
    try {
      const service = await this.ensureSettingsService();
      const result = await service.getSetting(PLUGIN_SHORTCUT_SETTING_KEY);
      const payload = result.success && result.data && typeof result.data === 'object' ? result.data : {};

      this.pluginShortcutSettings.clear();
      Object.entries(payload).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
          this.pluginShortcutSettings.set(key, {
            pluginId: value.pluginId,
            commandId: value.commandId,
            pluginName: value.pluginName,
            title: value.title,
            description: value.description,
            defaultKey: value.defaultKey || '',
            currentKey: value.currentKey || '',
            enabled: value.enabled !== false
          });
        }
      });

      return payload;
    } catch (error) {
      console.error('加载插件快捷键配置失败:', error);
      return {};
    }
  }

  async savePluginShortcutSettings(settings) {
    try {
      const service = await this.ensureSettingsService();
      await service.setSetting(PLUGIN_SHORTCUT_SETTING_KEY, settings || {});

      this.pluginShortcutSettings.clear();
      Object.entries(settings || {}).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
          this.pluginShortcutSettings.set(key, {
            pluginId: value.pluginId,
            commandId: value.commandId,
            pluginName: value.pluginName,
            title: value.title,
            description: value.description,
            defaultKey: value.defaultKey || '',
            currentKey: value.currentKey || '',
            enabled: value.enabled !== false
          });
        }
      });
    } catch (error) {
      console.error('保存插件快捷键配置失败:', error);
    }
  }

  getPluginCommandBinding(pluginId, commandId) {
    const key = `${pluginId}:${commandId}`;
    return this.pluginShortcutSettings.get(key) || null;
  }

  /**
   * 注册所有全局快捷键
   * @param {Object} shortcuts 快捷键配置对象
   * @returns {Object} 注册结果统计
   */
  async registerAllShortcuts(shortcuts = DEFAULT_SHORTCUTS) {
    const stats = {
      total: 0,
      registered: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    try {
      // 先清除所有已注册的快捷键
      this.unregisterAllShortcuts();

      console.log('开始注册快捷键，配置数据:', JSON.stringify(shortcuts, null, 2));

      // 注册全局快捷键
      for (const [shortcutId, config] of Object.entries(shortcuts)) {
        stats.total++;
        
        console.log(`检查快捷键 ${shortcutId}:`, {
          type: config.type,
          currentKey: config.currentKey,
          action: config.action
        });
        
        if (config.type === 'global' && config.currentKey) {
          try {
            const success = await this.registerShortcut(shortcutId, config.currentKey, config.action);
            if (success) {
              stats.registered++;
            } else {
              stats.failed++;
              stats.errors.push(`${shortcutId}: 注册失败`);
            }
          } catch (error) {
            stats.failed++;
            stats.errors.push(`${shortcutId}: ${error.message}`);
            console.error(`注册快捷键 ${shortcutId} 时发生错误:`, error);
          }
        } else {
          stats.skipped++;
          console.log(`跳过快捷键 ${shortcutId}: type=${config.type}, currentKey=${config.currentKey}`);
        }
      }

      console.log(`快捷键注册完成统计:`, {
        总数: stats.total,
        成功: stats.registered,
        跳过: stats.skipped,
        失败: stats.failed
      });

      if (stats.errors.length > 0) {
        console.warn('注册失败的快捷键:', stats.errors);
      }

      // 重新注册插件命令快捷键
      try {
        for (const [key, entry] of this.pluginCommandShortcuts.entries()) {
          if (!entry || !entry.accelerator) continue;
          const shortcutId = entry.shortcutId;
          const [pluginId, commandId] = key.split(':');
          if (!pluginId || !commandId) continue;

          await this.registerShortcut(shortcutId, entry.accelerator, {
            type: 'plugin-command',
            pluginId,
            commandId
          });
        }
      } catch (error) {
        console.error('重新注册插件快捷键失败:', error);
      }

      return stats;
    } catch (error) {
      console.error('注册快捷键过程中发生严重错误:', error);
      stats.errors.push(`严重错误: ${error.message}`);
      return stats;
    }
  }

  async registerPluginCommand(pluginId, command) {
    if (!pluginId || !command || !command.id) {
      return null;
    }

    const key = `${pluginId}:${command.id}`;
    const shortcutId = `plugin:${key}`;

    const settings = await this.loadPluginShortcutSettings();
    const existing = settings[key] || {};
    const shortcutMeta = command.shortcut;

    const declaredDefault = typeof shortcutMeta === 'string'
      ? shortcutMeta
      : (shortcutMeta && typeof shortcutMeta === 'object' ? shortcutMeta.default || shortcutMeta.key || '' : '');

    const resolvedDefault = existing.defaultKey || declaredDefault || '';
    const resolvedCurrent = existing.currentKey !== undefined
      ? existing.currentKey
      : typeof shortcutMeta === 'string'
        ? shortcutMeta
        : shortcutMeta && typeof shortcutMeta === 'object'
          ? shortcutMeta.current || shortcutMeta.default || ''
          : declaredDefault;

  const enabled = existing.enabled !== undefined ? existing.enabled : true;

  const pluginName = command.pluginName || existing.pluginName || '';

    settings[key] = {
      pluginId,
      commandId: command.id,
      pluginName,
      title: command.title || command.id,
      description: command.description || '',
      defaultKey: resolvedDefault,
      currentKey: resolvedCurrent || '',
      enabled
    };

    await this.savePluginShortcutSettings(settings);

    const binding = this.pluginShortcutSettings.get(key) || null;

    if (binding && binding.enabled && binding.currentKey) {
      const action = { type: 'plugin-command', pluginId, commandId: command.id };
      await this.registerShortcut(shortcutId, binding.currentKey, action);
      this.pluginCommandShortcuts.set(key, {
        shortcutId,
        accelerator: binding.currentKey
      });
    } else {
      this.pluginCommandShortcuts.delete(key);
    }

    return binding;
  }

  async unregisterPluginCommand(pluginId, commandId, options = {}) {
    const key = `${pluginId}:${commandId}`;
    const shortcutId = `plugin:${key}`;

    this.unregisterShortcut(shortcutId);
    this.pluginCommandShortcuts.delete(key);

    if (options.removeSetting) {
      const settings = await this.loadPluginShortcutSettings();
      if (settings[key]) {
        delete settings[key];
        await this.savePluginShortcutSettings(settings);
      }
    }
  }

  async disablePluginCommands(pluginId) {
    for (const [key, entry] of this.pluginCommandShortcuts.entries()) {
      if (key.startsWith(`${pluginId}:`)) {
        this.unregisterShortcut(entry.shortcutId);
        this.pluginCommandShortcuts.delete(key);
      }
    }
  }

  async removePluginCommands(pluginId) {
    await this.disablePluginCommands(pluginId);
    const settings = await this.loadPluginShortcutSettings();
    let changed = false;

    Object.keys(settings).forEach((key) => {
      if (settings[key]?.pluginId === pluginId) {
        delete settings[key];
        changed = true;
      }
    });

    if (changed) {
      await this.savePluginShortcutSettings(settings);
    }
  }

  /**
   * 注册单个全局快捷键
   * @param {string} shortcutId 快捷键ID
   * @param {string} accelerator 快捷键组合
   * @param {string} action 动作类型
   */
  async registerShortcut(shortcutId, accelerator, action) {
    if (!accelerator) {
      console.warn(`快捷键 ${shortcutId} 的accelerator为空，跳过注册`);
      return false;
    }

    try {
      // 验证快捷键字符串格式
      if (!this.validateAccelerator(accelerator)) {
        throw new Error(`无效的快捷键格式: ${accelerator}`);
      }

      // 如果已经注册了这个快捷键，先取消注册
      if (this.registeredShortcuts.has(shortcutId)) {
        const oldAccelerator = this.registeredShortcuts.get(shortcutId);
        try {
          globalShortcut.unregister(oldAccelerator);
        } catch (unregError) {
          console.warn(`取消注册旧快捷键失败: ${oldAccelerator}`, unregError);
        }
      }

      // 检查快捷键是否已被当前应用注册
      if (globalShortcut.isRegistered(accelerator)) {
        console.warn(`快捷键 ${accelerator} 已被当前应用注册`);
        return false;
      }

      // 注册新的快捷键
      const success = globalShortcut.register(accelerator, () => {
        try {
          this.handleShortcutAction(action, shortcutId);
        } catch (actionError) {
          console.error(`执行快捷键动作失败: ${shortcutId}`, actionError);
        }
      });

      if (success) {
        this.registeredShortcuts.set(shortcutId, accelerator);
        console.log(`快捷键 ${accelerator} (${shortcutId}) 注册成功`);
        return true;
      } else {
        console.error(`快捷键 ${accelerator} (${shortcutId}) 注册失败，可能已被其他应用占用`);
        return false;
      }
    } catch (error) {
      console.error(`注册快捷键 ${accelerator} 失败:`, error);
      return false;
    }
  }

  /**
   * 更新单个快捷键
   * @param {string} shortcutId 快捷键ID
   * @param {string} newAccelerator 新的快捷键组合
   * @param {string} action 动作类型
   * @param {Object} completeShortcuts 完整的快捷键配置（可选，优先使用）
   */
  async updateShortcut(shortcutId, newAccelerator, action, completeShortcuts = null) {
    try {
      let allShortcuts;
      
      // 如果传递了完整配置，直接使用（避免数据不一致）
      if (completeShortcuts && typeof completeShortcuts === 'object' && Object.keys(completeShortcuts).length > 0) {
        console.log('使用传递的完整快捷键配置');
        allShortcuts = completeShortcuts;
      } else {
        // 否则获取当前配置并更新单个
        allShortcuts = await this.getAllShortcuts();
        
        if (allShortcuts[shortcutId]) {
          allShortcuts[shortcutId] = {
            ...allShortcuts[shortcutId],
            currentKey: newAccelerator
          };
        } else {
          console.warn(`快捷键 ${shortcutId} 不存在于配置中，创建新配置`);
          allShortcuts[shortcutId] = {
            id: shortcutId,
            currentKey: newAccelerator,
            defaultKey: newAccelerator,
            type: action && typeof action === 'object' ? 'local' : 'global',
            action: action
          };
        }
      }

      // 保存完整配置到数据库（指定类型为json）
      const SettingsService = require('./SettingsService');
      const settingsService = new SettingsService();
      await settingsService.setSetting('shortcuts', allShortcuts, 'json', '快捷键配置');
      console.log(`完整快捷键配置已保存，包含 ${Object.keys(allShortcuts).length} 个快捷键`);

      // 如果是全局快捷键，重新注册
      if (allShortcuts[shortcutId] && allShortcuts[shortcutId].type === 'global') {
        await this.registerShortcut(shortcutId, newAccelerator, action);
      }
      
      return allShortcuts[shortcutId];
    } catch (error) {
      console.error(`更新快捷键 ${shortcutId} 失败:`, error);
      throw error;
    }
  }

  /**
   * 取消注册单个快捷键
   * @param {string} shortcutId 快捷键ID
   */
  unregisterShortcut(shortcutId) {
    try {
      if (this.registeredShortcuts.has(shortcutId)) {
        const accelerator = this.registeredShortcuts.get(shortcutId);
        globalShortcut.unregister(accelerator);
        this.registeredShortcuts.delete(shortcutId);
        console.log(`快捷键 ${accelerator} (${shortcutId}) 已取消注册`);
      }
    } catch (error) {
      console.error(`取消注册快捷键 ${shortcutId} 失败:`, error);
    }
  }

  /**
   * 取消注册所有快捷键
   */
  unregisterAllShortcuts() {
    try {
      globalShortcut.unregisterAll();
      this.registeredShortcuts.clear();
      console.log('所有全局快捷键已取消注册');
    } catch (error) {
      console.error('取消注册所有快捷键失败:', error);
    }
  }

  /**
   * 处理快捷键动作
   * @param {string} action 动作类型
   * @param {string} shortcutId 快捷键ID
   */
  handleShortcutAction(action, shortcutId) {
    try {
      if (action && typeof action === 'object') {
        if (action.type === 'plugin-command') {
          if (!this.pluginManager || typeof this.pluginManager.executeCommand !== 'function') {
            console.warn('插件管理器未准备好，无法执行插件命令快捷键');
            return;
          }

          this.pluginManager.executeCommand(action.pluginId, action.commandId).catch((error) => {
            console.error(`执行插件命令快捷键失败: ${action.pluginId}:${action.commandId}`, error);
          });
          return;
        }
      }

      switch (action) {
        case 'new-note':
          this.handleNewNote();
          break;
        case 'new-todo':
          this.handleNewTodo();
          break;
        case 'quick-input':
          this.handleQuickInput();
          break;
        case 'quit-app':
          this.handleQuitApp();
          break;
        case 'show-hide-window':
          this.handleShowHideWindow();
          break;
        case 'open-settings':
          this.handleOpenSettings();
          break;
        default:
          console.warn(`未知的快捷键动作: ${action}`);
      }
    } catch (error) {
      console.error(`处理快捷键动作 ${action} 失败:`, error);
    }
  }

  /** 发送消息到主窗口并聚焦 */
  _sendToWindow(channel) {
    if (!this.mainWindow) return
    this.mainWindow.webContents.send(channel)
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  handleNewNote()     { this._sendToWindow('create-new-note') }
  handleNewTodo()     { this._sendToWindow('create-new-todo') }

  /**
   * 处理快速输入动作
   */
  async handleQuickInput() {
    try {
      // 检查windowManager是否初始化
      if (!this.windowManager) {
        console.error('快速输入：WindowManager未初始化');
        return;
      }
      
      // 获取NoteService实例
      const NoteService = require('./NoteService');
      const noteService = new NoteService();
      
      // 创建空白笔记
      const result = await noteService.createNote({
        title: '快速笔记',
        content: '',
        category: '',
        tags: []
      });
      
      if (result.success && result.data) {
        // 在独立窗口打开
        await this.windowManager.createNoteWindow(result.data.id);
        console.log('快速输入：创建笔记并在独立窗口打开成功');
      }
    } catch (error) {
      console.error('快速输入失败:', error);
    }
  }

  /**
   * 处理退出应用动作
   */
  handleQuitApp() {
    const { app } = require('electron');
    app.quit();
  }

  /**
   * 处理显示/隐藏窗口动作
   */
  handleShowHideWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isVisible() && this.mainWindow.isFocused()) {
        this.mainWindow.hide();
      } else {
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    }
  }

  /**
   * 处理打开设置动作
   */
  handleOpenSettings() { this._sendToWindow('open-settings') }

  /**
   * 验证快捷键字符串格式
   * @param {string} accelerator 快捷键组合
   * @returns {boolean} 是否为有效格式
   */
  validateAccelerator(accelerator) {
    if (!accelerator || typeof accelerator !== 'string') {
      return false;
    }

    // 基本格式检查：必须包含+号分隔的组合
    const parts = accelerator.split('+');
    if (parts.length < 1) {
      return false;
    }

    // 检查是否包含有效的修饰键和主键
    const validModifiers = ['Ctrl', 'Alt', 'Shift', 'Meta', 'Cmd', 'CmdOrCtrl', 'Command', 'Control'];
    const validKeys = /^[A-Za-z0-9]$|^F[1-9]$|^F1[0-2]$|^(Space|Tab|Backspace|Delete|Enter|Return|Esc|Escape|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert)$/;

    const lastPart = parts[parts.length - 1];
    
    // 最后一部分必须是有效的主键
    if (!validKeys.test(lastPart)) {
      return false;
    }

    // 检查修饰键（除了最后一个主键）
    for (let i = 0; i < parts.length - 1; i++) {
      if (!validModifiers.includes(parts[i])) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查快捷键是否已被注册
   * @param {string} accelerator 快捷键组合
   * @returns {boolean}
   */
  isShortcutRegistered(accelerator) {
    return globalShortcut.isRegistered(accelerator);
  }

  /**
   * 获取所有已注册的快捷键
   * @returns {Map}
   */
  getRegisteredShortcuts() {
    return new Map(this.registeredShortcuts);
  }

  /**
   * 获取所有快捷键配置
   * @returns {Object} 快捷键配置对象
   */
  async getAllShortcuts() {
    try {
      const SettingsService = require('./SettingsService');
      const settingsService = new SettingsService();
      const result = await settingsService.getSetting('shortcuts');
      return result.success ? result.data : DEFAULT_SHORTCUTS;
    } catch (error) {
      console.error('获取快捷键配置失败:', error);
      return DEFAULT_SHORTCUTS;
    }
  }

  /**
   * 重置单个快捷键为默认值
   * @param {string} shortcutId 快捷键ID
   */
  async resetShortcut(shortcutId) {
    try {
      const defaultConfig = DEFAULT_SHORTCUTS[shortcutId];
      if (!defaultConfig) {
        throw new Error(`未找到快捷键配置: ${shortcutId}`);
      }

      // 获取当前所有快捷键配置
      const allShortcuts = await this.getAllShortcuts();
      
      // 重置指定快捷键
      allShortcuts[shortcutId] = {
        ...defaultConfig,
        currentKey: defaultConfig.defaultKey
      };

      // 保存配置（指定类型为json）
      const SettingsService = require('./SettingsService');
      const settingsService = new SettingsService();
      await settingsService.setSetting('shortcuts', allShortcuts, 'json', '快捷键配置');

      // 重新注册快捷键
      if (defaultConfig.type === 'global') {
        await this.registerShortcut(shortcutId, defaultConfig.defaultKey, defaultConfig.action);
      }

      console.log(`快捷键 ${shortcutId} 已重置为默认值`);
      return allShortcuts[shortcutId];
    } catch (error) {
      console.error(`重置快捷键 ${shortcutId} 失败:`, error);
      throw error;
    }
  }

  /**
   * 重置所有快捷键为默认值
   * @param {Object} defaultShortcuts 默认快捷键配置
   */
  async resetAllShortcuts(defaultShortcuts = DEFAULT_SHORTCUTS) {
    try {
      // 保存默认配置到设置（指定类型为json）
      const SettingsService = require('./SettingsService');
      const settingsService = new SettingsService();
      await settingsService.setSetting('shortcuts', defaultShortcuts, 'json', '快捷键配置');

      // 重新注册所有快捷键
      await this.registerAllShortcuts(defaultShortcuts);
      console.log('所有快捷键已重置为默认值');
      return defaultShortcuts;
    } catch (error) {
      console.error('重置快捷键失败:', error);
      throw error;
    }
  }
}

module.exports = ShortcutService;