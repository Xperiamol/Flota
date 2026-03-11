// 默认快捷键配置
const DEFAULT_SHORTCUTS = {
  'global.newNote': {
    id: 'global.newNote',
    name: '新建笔记',
    description: '创建一个新的笔记',
    defaultKey: 'CmdOrCtrl+N',
    currentKey: 'CmdOrCtrl+N',
    category: 'global',
    type: 'global',
    action: 'new-note'
  },
  'global.quickInput': {
    id: 'global.quickInput',
    name: '快速输入',
    description: '打开快速输入窗口',
    defaultKey: 'CmdOrCtrl+Shift+N',
    currentKey: 'CmdOrCtrl+Shift+N',
    category: 'global',
    type: 'global',
    action: 'quick-input'
  },
  'global.quit': {
    id: 'global.quit',
    name: '退出应用',
    description: '退出Flota应用',
    defaultKey: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
    currentKey: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
    category: 'global',
    type: 'global',
    action: 'quit-app'
  },
  'global.newTodo': {
    id: 'global.newTodo',
    name: '新建待办',
    description: '创建一个新的待办事项',
    defaultKey: 'CmdOrCtrl+T',
    currentKey: 'CmdOrCtrl+T',
    category: 'global',
    type: 'global',
    action: 'new-todo'
  },
  'editor.save': {
    id: 'editor.save',
    name: '保存笔记',
    description: '保存当前编辑的笔记',
    defaultKey: 'Ctrl+S',
    currentKey: 'Ctrl+S',
    category: 'editor',
    type: 'local',
    action: 'save-note'
  },
  'editor.bold': {
    id: 'editor.bold',
    name: '加粗文本',
    description: '将选中文本设置为粗体',
    defaultKey: 'Ctrl+B',
    currentKey: 'Ctrl+B',
    category: 'editor',
    type: 'local',
    action: 'bold-text'
  },
  'editor.italic': {
    id: 'editor.italic',
    name: '斜体文本',
    description: '将选中文本设置为斜体',
    defaultKey: 'Ctrl+I',
    currentKey: 'Ctrl+I',
    category: 'editor',
    type: 'local',
    action: 'italic-text'
  },
  'editor.indent': {
    id: 'editor.indent',
    name: '缩进文本',
    description: '增加文本缩进',
    defaultKey: 'Tab',
    currentKey: 'Tab',
    category: 'editor',
    type: 'local',
    action: 'indent-text'
  }
};

// 快捷键分类
const SHORTCUT_CATEGORIES = {
  global: {
    name: '全局快捷键',
    description: '在任何地方都可以使用的快捷键'
  },
  editor: {
    name: '编辑器快捷键',
    description: '在笔记编辑器中使用的快捷键'
  }
};

/**
 * 解析快捷键字符串为组件
 * @param {string} shortcut 快捷键字符串，如 'Ctrl+Shift+A'
 * @returns {Object} 包含修饰键和主键的对象
 */
function parseShortcut(shortcut) {
  if (!shortcut) return { modifiers: [], key: '' };
  
  const parts = shortcut.split('+');
  const key = parts.pop(); // 最后一个是主键
  const modifiers = parts.map(mod => mod.toLowerCase());
  
  return { modifiers, key };
}

/**
 * 格式化快捷键显示
 * @param {string} shortcut 快捷键字符串
 * @returns {string} 格式化后的快捷键字符串
 */
function formatShortcut(shortcut) {
  if (!shortcut) return '';
  
  // 替换常见的修饰键为更友好的显示
  return shortcut
    .replace(/CmdOrCtrl/g, process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
    .replace(/Cmd/g, '⌘')
    .replace(/Ctrl/g, 'Ctrl')
    .replace(/Shift/g, 'Shift')
    .replace(/Alt/g, 'Alt')
    .replace(/Meta/g, 'Win');
}

/**
 * 验证快捷键格式
 * @param {string} shortcut 快捷键字符串
 * @returns {boolean} 是否有效
 */
function validateShortcut(shortcut) {
  if (!shortcut || typeof shortcut !== 'string') return false;
  
  // 基本格式检查
  const parts = shortcut.split('+');
  if (parts.length < 1) return false;
  
  // 检查是否有主键
  const key = parts[parts.length - 1];
  if (!key || key.length === 0) return false;
  
  // 检查修饰键是否有效
  const validModifiers = ['ctrl', 'cmd', 'cmdorctrl', 'shift', 'alt', 'meta', 'super'];
  const modifiers = parts.slice(0, -1).map(mod => mod.toLowerCase());
  
  for (const modifier of modifiers) {
    if (!validModifiers.includes(modifier)) {
      return false;
    }
  }
  
  return true;
}

/**
 * 检查快捷键冲突
 * @param {string} newShortcut 新的快捷键
 * @param {Object} existingShortcuts 现有快捷键配置
 * @param {string} excludeId 排除的快捷键ID（用于更新时排除自己）
 * @returns {Array} 冲突的快捷键列表
 */
function checkShortcutConflict(newShortcut, existingShortcuts, excludeId = null) {
  const conflicts = [];
  
  if (!newShortcut || !validateShortcut(newShortcut)) {
    return conflicts;
  }
  
  for (const [id, config] of Object.entries(existingShortcuts)) {
    if (id === excludeId) continue; // 排除自己
    
    if (config.currentKey === newShortcut) {
      conflicts.push({
        id,
        name: config.name,
        shortcut: config.currentKey
      });
    }
  }
  
  return conflicts;
}

/**
 * 按分类获取快捷键
 * @param {string} category 分类名称
 * @param {Object} shortcuts 快捷键配置对象
 * @returns {Object} 该分类的快捷键
 */
function getShortcutsByCategory(category, shortcuts = DEFAULT_SHORTCUTS) {
  const result = {};
  
  for (const [id, config] of Object.entries(shortcuts)) {
    if (config.category === category) {
      result[id] = config;
    }
  }
  
  return result;
}

/**
 * 重置快捷键为默认值
 * @param {Object} customDefaults 自定义默认值（可选）
 * @returns {Object} 重置后的快捷键配置
 */
function resetShortcutsToDefault(customDefaults = null) {
  const defaults = customDefaults || DEFAULT_SHORTCUTS;
  const reset = {};
  
  for (const [id, config] of Object.entries(defaults)) {
    reset[id] = {
      ...config,
      currentKey: config.defaultKey
    };
  }
  
  return reset;
}

/**
 * 标准化快捷键字符串
 * @param {string} shortcut 快捷键字符串
 * @returns {string} 标准化后的快捷键字符串
 */
function normalizeShortcut(shortcut) {
  if (!shortcut) return '';
  
  // 统一大小写和格式
  return shortcut
    .split('+')
    .map(part => {
      const normalized = part.trim().toLowerCase();
      // 标准化修饰键名称
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
          // 主键保持原样但首字母大写
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
    })
    .join('+');
}

module.exports = {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  parseShortcut,
  formatShortcut,
  validateShortcut,
  checkShortcutConflict,
  getShortcutsByCategory,
  resetShortcutsToDefault,
  normalizeShortcut
};