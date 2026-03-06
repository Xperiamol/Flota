/**
 * 快捷键管理器 - 统一管理前端快捷键逻辑
 * 遵循SOLID原则：单一职责、开闭原则、依赖倒置
 */

import { parseShortcut } from './shortcutUtils';
import logger from './logger';

class ShortcutManager {
  constructor() {
    this.shortcuts = {};
    this.listeners = new Map();
    this.isInitialized = false;
  }

  /**
   * 初始化快捷键管理器
   * @param {Object} shortcutConfig 快捷键配置
   */
  async initialize(shortcutConfig = null) {
    try {
      // 加载快捷键配置
      if (shortcutConfig) {
        this.shortcuts = shortcutConfig;
      } else {
        await this.loadShortcuts();
      }
      
      this.isInitialized = true;
      logger.log('快捷键管理器初始化完成:', this.shortcuts);
    } catch (error) {
      console.error('快捷键管理器初始化失败:', error);
      // 使用默认配置
      const { DEFAULT_SHORTCUTS } = await import('./shortcutUtils');
      this.shortcuts = DEFAULT_SHORTCUTS;
      this.isInitialized = true;
    }
  }

  /**
   * 从设置中加载快捷键配置
   */
  async loadShortcuts() {
    try {
      if (window.electronAPI?.settings) {
        const result = await window.electronAPI.settings.get('shortcuts');
        if (result.success && result.data && typeof result.data === 'object' && Object.keys(result.data).length > 0) {
          this.shortcuts = result.data;
          logger.log('快捷键配置加载成功:', result.data);
          return;
        } else {
          logger.log('快捷键配置为空或无效，使用默认配置');
        }
      } else {
        logger.log('electronAPI不可用，使用默认配置');
      }
    } catch (error) {
      console.error('加载快捷键配置时发生错误:', error);
    }
    
    // 统一的默认配置处理
    try {
      const { DEFAULT_SHORTCUTS } = await import('./shortcutUtils');
      this.shortcuts = DEFAULT_SHORTCUTS;
      logger.log('使用默认快捷键配置');
    } catch (importError) {
      console.error('导入默认快捷键配置失败:', importError);
      this.shortcuts = {};
    }
  }

  /**
   * 注册快捷键监听器
   * @param {HTMLElement} element 要监听的元素
   * @param {Object} handlers 快捷键处理函数映射
   */
  registerListener(element, handlers) {
    if (!element || !handlers) {
      console.error('注册快捷键监听器失败：缺少必要参数');
      return;
    }

    const handleKeyDown = (event) => {
      this.handleKeyEvent(event, handlers);
    };

    element.addEventListener('keydown', handleKeyDown);
    
    // 存储监听器以便后续清理
    this.listeners.set(element, handleKeyDown);
    
    logger.log('快捷键监听器已注册到元素:', element.tagName);
  }

  /**
   * 移除快捷键监听器
   * @param {HTMLElement} element 要移除监听的元素
   */
  unregisterListener(element) {
    if (this.listeners.has(element)) {
      const handler = this.listeners.get(element);
      element.removeEventListener('keydown', handler);
      this.listeners.delete(element);
      logger.log('快捷键监听器已移除');
    }
  }

  /**
   * 处理键盘事件
   * @param {KeyboardEvent} event 键盘事件
   * @param {Object} handlers 处理函数映射
   */
  handleKeyEvent(event, handlers) {
    if (!this.isInitialized) {
      console.warn('快捷键管理器未初始化');
      return;
    }

    if (!handlers || typeof handlers !== 'object') {
      console.warn('快捷键处理函数映射无效');
      return;
    }

    try {
      const pressedKey = this.getKeyFromEvent(event);
      logger.log('按键事件:', pressedKey, '修饰键:', {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey
      });

      // 检查所有快捷键
      for (const [shortcutId, config] of Object.entries(this.shortcuts)) {
        if (!config || typeof config !== 'object') {
          console.warn(`快捷键配置无效: ${shortcutId}`);
          continue;
        }

        if (config.type === 'local' && this.isShortcutMatch(event, config.currentKey)) {
          logger.log(`快捷键匹配: ${shortcutId} (${config.currentKey})`);
          
          // 查找对应的处理函数
          const handlerKey = shortcutId.split('.').pop(); // 获取动作名称
          const handler = handlers[handlerKey] || handlers[shortcutId];
          
          if (handler && typeof handler === 'function') {
            try {
              event.preventDefault();
              event.stopPropagation();
              logger.log(`执行快捷键动作: ${shortcutId}`);
              handler(event);
              return;
            } catch (handlerError) {
              console.error(`执行快捷键处理函数失败: ${shortcutId}`, handlerError);
              return;
            }
          } else {
            console.warn(`未找到快捷键处理函数: ${shortcutId}`);
          }
        }
      }
    } catch (error) {
      console.error('处理键盘事件时发生错误:', error);
    }
  }

  /**
   * 从键盘事件获取按键字符串
   * @param {KeyboardEvent} event 键盘事件
   * @returns {string} 按键字符串
   */
  getKeyFromEvent(event) {
    const parts = [];
    
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    
    // 处理特殊按键
    let key = event.key;
    if (key === ' ') key = 'Space';
    else if (key === 'Enter') key = 'Return';
    else if (key.length === 1) key = key.toUpperCase();
    
    parts.push(key);
    
    return parts.join('+');
  }

  /**
   * 检查按键事件是否匹配快捷键
   * @param {KeyboardEvent} event 键盘事件
   * @param {string} shortcutKey 快捷键字符串
   * @returns {boolean} 是否匹配
   */
  isShortcutMatch(event, shortcutKey) {
    if (!shortcutKey) return false;
    
    // 解析快捷键字符串
    const parts = shortcutKey.split('+').map(part => part.trim());
    if (parts.length === 0) return false;
    
    const mainKey = parts[parts.length - 1]; // 最后一个是主键
    const modifiers = parts.slice(0, -1).map(mod => mod.toLowerCase());
    
    // 检查修饰键
    const hasCtrl = modifiers.includes('ctrl') || modifiers.includes('control');
    const hasAlt = modifiers.includes('alt');
    const hasShift = modifiers.includes('shift');
    const hasMeta = modifiers.includes('meta') || modifiers.includes('cmd') || modifiers.includes('command');
    
    if (hasCtrl !== event.ctrlKey) return false;
    if (hasAlt !== event.altKey) return false;
    if (hasShift !== event.shiftKey) return false;
    if (hasMeta !== event.metaKey) return false;
    
    // 检查主键
    let eventKey = event.key;
    if (eventKey === ' ') eventKey = 'Space';
    else if (eventKey === 'Enter') eventKey = 'Return';
    
    return mainKey.toLowerCase() === eventKey.toLowerCase();
  }

  /**
   * 检测快捷键冲突
   * @param {string} newShortcut 新的快捷键字符串
   * @param {string} excludeId 要排除的快捷键ID（用于更新现有快捷键时）
   * @returns {Object} 冲突检测结果
   */
  detectConflict(newShortcut, excludeId = null) {
    const conflicts = [];
    
    if (!newShortcut) {
      return { hasConflict: false, conflicts: [] };
    }

    try {
      // 标准化快捷键字符串
      const normalizedNew = this.normalizeShortcut(newShortcut);
      
      for (const [shortcutId, config] of Object.entries(this.shortcuts)) {
        if (shortcutId === excludeId) continue;
        
        if (config && config.currentKey) {
          const normalizedExisting = this.normalizeShortcut(config.currentKey);
          
          if (normalizedNew === normalizedExisting) {
            conflicts.push({
              id: shortcutId,
              name: config.name || shortcutId,
              key: config.currentKey,
              type: config.type
            });
          }
        }
      }
      
      return {
        hasConflict: conflicts.length > 0,
        conflicts: conflicts
      };
    } catch (error) {
      console.error('检测快捷键冲突时发生错误:', error);
      return { hasConflict: false, conflicts: [], error: error.message };
    }
  }

  /**
   * 标准化快捷键字符串
   * @param {string} shortcut 快捷键字符串
   * @returns {string} 标准化后的快捷键字符串
   */
  normalizeShortcut(shortcut) {
    if (!shortcut) return '';
    
    return shortcut
      .split('+')
      .map(part => {
        const normalized = part.trim().toLowerCase();
        switch (normalized) {
          case 'control':
          case 'ctrl':
            return 'Ctrl';
          case 'command':
          case 'cmd':
            return 'Cmd';
          case 'cmdorctrl':
            return 'CmdOrCtrl';
          case 'shift':
            return 'Shift';
          case 'alt':
          case 'option':
            return 'Alt';
          case 'meta':
          case 'super':
          case 'win':
            return 'Meta';
          default:
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        }
      })
      .join('+');
  }

  /**
   * 更新快捷键配置
   * @param {Object} newShortcuts 新的快捷键配置
   * @param {boolean} checkConflicts 是否检查冲突
   * @returns {Object} 更新结果
   */
  updateShortcuts(newShortcuts, checkConflicts = true) {
    try {
      const conflicts = [];
      
      if (checkConflicts) {
        // 检查新配置中的冲突
        for (const [shortcutId, config] of Object.entries(newShortcuts)) {
          if (config && config.currentKey) {
            const conflictResult = this.detectConflict(config.currentKey, shortcutId);
            if (conflictResult.hasConflict) {
              conflicts.push({
                shortcutId,
                conflicts: conflictResult.conflicts
              });
            }
          }
        }
      }
      
      this.shortcuts = { ...this.shortcuts, ...newShortcuts };
      logger.log('快捷键配置已更新:', this.shortcuts);
      
      return {
        success: true,
        conflicts: conflicts,
        hasConflicts: conflicts.length > 0
      };
    } catch (error) {
      console.error('更新快捷键配置时发生错误:', error);
      return {
        success: false,
        error: error.message,
        conflicts: []
      };
    }
  }

  /**
   * 获取指定类型的快捷键
   * @param {string} type 快捷键类型 ('global' 或 'local')
   * @returns {Object} 过滤后的快捷键配置
   */
  getShortcutsByType(type) {
    return Object.fromEntries(
      Object.entries(this.shortcuts).filter(([_, config]) => config.type === type)
    );
  }

  /**
   * 获取快捷键配置
   * @param {string} shortcutId 快捷键ID
   * @returns {Object|null} 快捷键配置
   */
  getShortcut(shortcutId) {
    return this.shortcuts[shortcutId] || null;
  }

  /**
   * 清理所有监听器
   */
  cleanup() {
    for (const [element, handler] of this.listeners) {
      element.removeEventListener('keydown', handler);
    }
    this.listeners.clear();
    logger.log('快捷键管理器已清理');
  }
}

// 创建单例实例
const shortcutManager = new ShortcutManager();

export default shortcutManager;
export { ShortcutManager };