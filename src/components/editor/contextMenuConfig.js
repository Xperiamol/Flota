// 上下文菜单项配置常量（从 WYSIWYGEditor 抽出，避免 Settings 反向 import 整个编辑器）
export const DEFAULT_CONTEXT_MENU_ITEMS = [
  'bookmark',
  'undo', 'redo', 'cut', 'copy', 'paste', 'pastePlain', 'selectAll',
  'bold', 'italic', 'link', 'blockSelect', 'table',
]

export const ALL_CONTEXT_MENU_ITEMS = [
  'bookmark',
  'undo', 'redo', 'cut', 'copy', 'paste', 'pastePlain', 'selectAll',
  'bold', 'italic', 'code', 'link',
  'heading1', 'heading2', 'bulletList', 'orderedList', 'taskList', 'blockquote',
  'paragraph', 'blockSelect', 'copyBlock', 'duplicateBlock', 'deleteBlock', 'callout', 'table',
]

export const CONTEXT_MENU_ITEM_LABELS = {
  bookmark: '添加书签',
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  pastePlain: '无格式粘贴',
  selectAll: '全选',
  bold: '加粗',
  italic: '斜体',
  code: '行内代码',
  link: '链接',
  heading1: '标题 1',
  heading2: '标题 2',
  bulletList: '项目符号列表',
  orderedList: '编号列表',
  taskList: '任务列表',
  blockquote: '引用',
  paragraph: '正文',
  blockSelect: '块多选',
  copyBlock: '复制当前块',
  duplicateBlock: '复制一份当前块',
  deleteBlock: '删除当前块',
  callout: 'Callout',
  table: '表格操作',
}
