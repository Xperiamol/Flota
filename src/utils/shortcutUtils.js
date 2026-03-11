// 快捷键工具函数和配置

// 默认快捷键配置
export const DEFAULT_SHORTCUTS = {
  // ── 全局快捷键 ──
  'global.newNote': {
    id: 'global.newNote', name: '新建笔记', description: '创建一个新的笔记',
    category: 'global', defaultKey: 'CmdOrCtrl+N', currentKey: 'CmdOrCtrl+N',
    type: 'global', action: 'new-note',
  },
  'global.quickInput': {
    id: 'global.quickInput', name: '快速输入', description: '打开快速输入窗口',
    category: 'global', defaultKey: 'CmdOrCtrl+Shift+N', currentKey: 'CmdOrCtrl+Shift+N',
    type: 'global', action: 'quick-input',
  },
  'global.newTodo': {
    id: 'global.newTodo', name: '新建待办', description: '创建一个新的待办事项',
    category: 'global', defaultKey: 'CmdOrCtrl+T', currentKey: 'CmdOrCtrl+T',
    type: 'global', action: 'new-todo',
  },
  'global.quit': {
    id: 'global.quit', name: '退出应用', description: '退出 Flota 应用',
    category: 'global', defaultKey: 'Ctrl+Q', currentKey: 'Ctrl+Q',
    type: 'global', action: 'quit-app',
  },

  // ── 基础操作 ──
  'basics.undo':      { id: 'basics.undo',      name: '撤销',   category: 'basics', defaultKey: 'Ctrl+Z',       currentKey: 'Ctrl+Z',       type: 'local' },
  'basics.redo':      { id: 'basics.redo',      name: '重做',   category: 'basics', defaultKey: 'Ctrl+Shift+Z', currentKey: 'Ctrl+Shift+Z', type: 'local' },
  'basics.selectAll': { id: 'basics.selectAll', name: '全选',   category: 'basics', defaultKey: 'Ctrl+A',       currentKey: 'Ctrl+A',       type: 'local' },
  'basics.copy':      { id: 'basics.copy',      name: '复制',   category: 'basics', defaultKey: 'Ctrl+C',       currentKey: 'Ctrl+C',       type: 'local' },
  'basics.cut':       { id: 'basics.cut',       name: '剪切',   category: 'basics', defaultKey: 'Ctrl+X',       currentKey: 'Ctrl+X',       type: 'local' },
  'basics.paste':     { id: 'basics.paste',     name: '粘贴',   category: 'basics', defaultKey: 'Ctrl+V',       currentKey: 'Ctrl+V',       type: 'local' },
  'basics.save':      { id: 'basics.save',      name: '保存笔记', category: 'basics', defaultKey: 'Ctrl+S',     currentKey: 'Ctrl+S',       type: 'local' },

  // ── 文本格式 ──
  'format.bold':      { id: 'format.bold',      name: '粗体',   category: 'format', defaultKey: 'Ctrl+B', currentKey: 'Ctrl+B', type: 'local' },
  'format.italic':    { id: 'format.italic',    name: '斜体',   category: 'format', defaultKey: 'Ctrl+I', currentKey: 'Ctrl+I', type: 'local' },
  'format.underline': { id: 'format.underline', name: '下划线', category: 'format', defaultKey: 'Ctrl+U', currentKey: 'Ctrl+U', type: 'local' },
  // 以下格式默认无快捷键，用户可自行设定
  'format.strike':       { id: 'format.strike',       name: '删除线',   category: 'format', defaultKey: '', currentKey: '', type: 'local' },
  'format.inlineCode':   { id: 'format.inlineCode',   name: '行内代码', category: 'format', defaultKey: '', currentKey: '', type: 'local' },
  'format.highlight':    { id: 'format.highlight',    name: '高亮',     category: 'format', defaultKey: '', currentKey: '', type: 'local' },
  'format.codeBlock':    { id: 'format.codeBlock',    name: '代码块',   category: 'format', defaultKey: '', currentKey: '', type: 'local' },
  'format.bulletList':   { id: 'format.bulletList',   name: '无序列表', category: 'format', defaultKey: '', currentKey: '', type: 'local' },
  'format.orderedList':  { id: 'format.orderedList',  name: '有序列表', category: 'format', defaultKey: '', currentKey: '', type: 'local' },
  'format.blockquote':   { id: 'format.blockquote',   name: '引用',     category: 'format', defaultKey: '', currentKey: '', type: 'local' },
  'format.horizontalRule':{ id: 'format.horizontalRule', name: '分割线', category: 'format', defaultKey: '', currentKey: '', type: 'local' },
};

// 快捷键分类
export const SHORTCUT_CATEGORIES = {
  global: {
    name: '全局',
    description: '在应用的任何地方都可以使用',
  },
  basics: {
    name: '基础操作',
    description: '撤销、复制、粘贴等基础操作',
  },
  format: {
    name: '文本格式',
    description: '编辑器中的格式化快捷键',
  },
};

// 解析快捷键字符串
export const parseShortcut = (shortcut) => {
  if (!shortcut) return { keys: [], display: '' };
  
  const keys = shortcut.split('+').map(key => key.trim());
  const display = keys.join(' + ');
  
  return { keys, display };
};

// 格式化快捷键显示
export const formatShortcutDisplay = (shortcut) => {
  if (!shortcut) return '';
  
  // 在浏览器环境中统一使用Ctrl，避免使用process对象
  return shortcut
    .replace('CmdOrCtrl', 'Ctrl')
    .replace('Cmd', '⌘')
    .replace('Ctrl', 'Ctrl')
    .replace('Alt', 'Alt')
    .replace('Shift', 'Shift')
    .replace('+', ' + ');
};

// 验证快捷键格式
export const validateShortcut = (shortcut) => {
  if (!shortcut) return { valid: false, error: '快捷键不能为空' };
  
  const validKeys = ['Ctrl', 'Cmd', 'CmdOrCtrl', 'Alt', 'Shift', 'Meta'];
  const validSingleKeys = /^[A-Za-z0-9]$|^F[1-9]$|^F1[0-2]$|^(Enter|Space|Tab|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;
  
  const keys = shortcut.split('+').map(key => key.trim());
  
  if (keys.length === 0) {
    return { valid: false, error: '快捷键格式无效' };
  }
  
  const lastKey = keys[keys.length - 1];
  if (!validSingleKeys.test(lastKey)) {
    return { valid: false, error: '最后一个按键必须是字母、数字或功能键' };
  }
  
  const modifiers = keys.slice(0, -1);
  for (const modifier of modifiers) {
    if (!validKeys.includes(modifier)) {
      return { valid: false, error: `无效的修饰键: ${modifier}` };
    }
  }
  
  return { valid: true };
};

// 检查快捷键冲突
export const checkShortcutConflict = (newShortcut, currentShortcuts, excludeId = null) => {
  const conflicts = [];
  
  for (const [id, config] of Object.entries(currentShortcuts)) {
    if (id === excludeId) continue;
    
    if (config.currentKey === newShortcut) {
      conflicts.push({
        id,
        name: config.name,
        category: config.category
      });
    }
  }
  
  return conflicts;
};

// 获取按分类分组的快捷键
export const getShortcutsByCategory = (shortcuts) => {
  const grouped = {};
  
  for (const category of Object.keys(SHORTCUT_CATEGORIES)) {
    grouped[category] = [];
  }
  
  for (const [id, config] of Object.entries(shortcuts)) {
    if (grouped[config.category]) {
      grouped[config.category].push({ id, ...config });
    }
  }
  
  return grouped;
};

// 重置快捷键到默认值
export const resetShortcutsToDefault = () => {
  const reset = {};
  for (const [id, config] of Object.entries(DEFAULT_SHORTCUTS)) {
    reset[id] = {
      ...config,
      currentKey: config.defaultKey
    };
  }
  return reset;
};