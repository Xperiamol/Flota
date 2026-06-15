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

  // ── 面板与导航 ──
  'panels.aiCommandCenter': {
    id: 'panels.aiCommandCenter', name: '切换问 AI 窗口', description: '在非输入区域打开或关闭悬浮问 AI 窗口',
    category: 'panels', defaultKey: 'CmdOrCtrl+K', currentKey: 'CmdOrCtrl+K', type: 'local',
  },
  'panels.noteNavigator': {
    id: 'panels.noteNavigator', name: '切换笔记导航', description: '打开或关闭笔记导航小窗（大纲 / 最近笔记快速跳转）',
    category: 'panels', defaultKey: 'CmdOrCtrl+J', currentKey: 'CmdOrCtrl+J', type: 'local',
  },
  'editor.paragraph': {
    id: 'editor.paragraph', name: '设为正文', description: '将当前块切换为正文段落',
    category: 'editor', defaultKey: 'CmdOrCtrl+0', currentKey: 'CmdOrCtrl+0', type: 'local', readOnly: true,
  },
  'editor.heading1': {
    id: 'editor.heading1', name: '设为标题 1', description: '将当前块切换为一级标题；再次按下回到正文',
    category: 'editor', defaultKey: 'CmdOrCtrl+1', currentKey: 'CmdOrCtrl+1', type: 'local', readOnly: true,
  },
  'editor.heading2': {
    id: 'editor.heading2', name: '设为标题 2', description: '将当前块切换为二级标题；再次按下回到正文',
    category: 'editor', defaultKey: 'CmdOrCtrl+2', currentKey: 'CmdOrCtrl+2', type: 'local', readOnly: true,
  },
  'editor.heading3': {
    id: 'editor.heading3', name: '设为标题 3', description: '将当前块切换为三级标题；再次按下回到正文',
    category: 'editor', defaultKey: 'CmdOrCtrl+3', currentKey: 'CmdOrCtrl+3', type: 'local', readOnly: true,
  },
  'editor.heading4': {
    id: 'editor.heading4', name: '设为标题 4', description: '将当前块切换为四级标题；再次按下回到正文',
    category: 'editor', defaultKey: 'CmdOrCtrl+4', currentKey: 'CmdOrCtrl+4', type: 'local', readOnly: true,
  },
  'editor.heading5': {
    id: 'editor.heading5', name: '设为标题 5', description: '将当前块切换为五级标题；再次按下回到正文',
    category: 'editor', defaultKey: 'CmdOrCtrl+5', currentKey: 'CmdOrCtrl+5', type: 'local', readOnly: true,
  },
  'editor.heading6': {
    id: 'editor.heading6', name: '设为标题 6', description: '将当前块切换为六级标题；再次按下回到正文',
    category: 'editor', defaultKey: 'CmdOrCtrl+6', currentKey: 'CmdOrCtrl+6', type: 'local', readOnly: true,
  },
  'panels.commandPalette': {
    id: 'panels.commandPalette', name: '打开命令面板', description: '打开命令面板并搜索命令',
    category: 'panels', defaultKey: 'CmdOrCtrl+Shift+P', currentKey: 'CmdOrCtrl+Shift+P', type: 'local',
  },

  // ── 基础操作 ──
  // 注：undo/redo/selectAll/copy/cut/paste 由编辑器内置实现处理，无法在此修改
  'basics.undo':      { id: 'basics.undo',      name: '撤销',   category: 'basics', defaultKey: 'Ctrl+Z',       currentKey: 'Ctrl+Z',       type: 'local', readOnly: true },
  'basics.redo':      { id: 'basics.redo',      name: '重做',   category: 'basics', defaultKey: 'Ctrl+Shift+Z', currentKey: 'Ctrl+Shift+Z', type: 'local', readOnly: true },
  'basics.selectAll': { id: 'basics.selectAll', name: '全选',   category: 'basics', defaultKey: 'Ctrl+A',       currentKey: 'Ctrl+A',       type: 'local', readOnly: true },
  'basics.copy':      { id: 'basics.copy',      name: '复制',   category: 'basics', defaultKey: 'Ctrl+C',       currentKey: 'Ctrl+C',       type: 'local', readOnly: true },
  'basics.cut':       { id: 'basics.cut',       name: '剪切',   category: 'basics', defaultKey: 'Ctrl+X',       currentKey: 'Ctrl+X',       type: 'local', readOnly: true },
  'basics.paste':     { id: 'basics.paste',     name: '粘贴',   category: 'basics', defaultKey: 'Ctrl+V',       currentKey: 'Ctrl+V',       type: 'local', readOnly: true },
  'basics.save':      { id: 'basics.save',      name: '保存笔记', category: 'basics', defaultKey: 'Ctrl+S',     currentKey: 'Ctrl+S',       type: 'local' },

  // ── 文本格式 ──
  // 注：bold/italic/underline 由编辑器内置实现处理，无法在此修改
  'format.bold':      { id: 'format.bold',      name: '粗体',   category: 'format', defaultKey: 'Ctrl+B', currentKey: 'Ctrl+B', type: 'local', readOnly: true },
  'format.italic':    { id: 'format.italic',    name: '斜体',   category: 'format', defaultKey: 'Ctrl+I', currentKey: 'Ctrl+I', type: 'local', readOnly: true },
  'format.underline': { id: 'format.underline', name: '下划线', category: 'format', defaultKey: 'Ctrl+U', currentKey: 'Ctrl+U', type: 'local', readOnly: true },
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
  panels: {
    name: '面板与导航',
    description: '控制问 AI、命令面板等应用级浮层与入口',
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

// 标准化快捷键字符串：将 CmdOrCtrl 拆成 Cmd/Ctrl 两种等价形式，并对修饰键排序，
// 让 'CmdOrCtrl+N' 与 'Ctrl+N' / 'Cmd+N' 视为冲突。
const normalizeShortcutForCompare = (shortcut) => {
  if (!shortcut || typeof shortcut !== 'string') return [];
  const parts = shortcut.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];

  const sortMods = (segs) => {
    const mods = [];
    let key = '';
    for (const s of segs) {
      const lower = s.toLowerCase();
      if (lower === 'ctrl' || lower === 'cmd' || lower === 'meta' ||
          lower === 'alt' || lower === 'option' || lower === 'shift') {
        // 归一化 Meta -> Cmd, Option -> Alt
        const norm = lower === 'meta' ? 'Cmd' : lower === 'option' ? 'Alt' : (lower.charAt(0).toUpperCase() + lower.slice(1));
        mods.push(norm);
      } else {
        key = s.length === 1 ? s.toUpperCase() : s;
      }
    }
    mods.sort();
    return [...mods, key].filter(Boolean).join('+');
  };

  // 含 CmdOrCtrl → 展开成两条
  if (parts.some((p) => p === 'CmdOrCtrl')) {
    const ctrlVer = sortMods(parts.map((p) => (p === 'CmdOrCtrl' ? 'Ctrl' : p)));
    const cmdVer = sortMods(parts.map((p) => (p === 'CmdOrCtrl' ? 'Cmd' : p)));
    return [ctrlVer, cmdVer];
  }
  return [sortMods(parts)];
};

// 检查快捷键冲突
export const checkShortcutConflict = (newShortcut, currentShortcuts, excludeId = null) => {
  const conflicts = [];
  const newKeys = new Set(normalizeShortcutForCompare(newShortcut));
  if (newKeys.size === 0) return conflicts;

  for (const [id, config] of Object.entries(currentShortcuts)) {
    if (id === excludeId) continue;
    if (!config?.currentKey) continue;

    const existKeys = normalizeShortcutForCompare(config.currentKey);
    if (existKeys.some((k) => newKeys.has(k))) {
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
