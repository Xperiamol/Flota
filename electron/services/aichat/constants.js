/**
 * AI Chat 通用常量。
 */

const WRITE_TOOL_NAMES = new Set(['create_note', 'edit_note', 'edit_notes', 'create_whiteboard', 'update_whiteboard', 'create_todo', 'create_todos', 'add_memory', 'update_memory', 'write_long_document']);

const ACTION_LABELS = {
  create_note: '创建笔记',
  edit_note: '编辑笔记',
  edit_notes: '批量编辑笔记',
  create_whiteboard: '创建画布',
  update_whiteboard: '修改画布',
  create_todo: '创建待办',
  create_todos: '批量创建待办',
  add_memory: '保存记忆',
  update_memory: '更新记忆',
  write_long_document: '生成并保存长文档'
};

const DEFAULT_CHAT_MAX_TOKENS = 320000;

// 输入上下文预算：system prompt + 历史消息的粗估 token 上限，超出则从最早的历史轮次开始丢弃
const MAX_CONTEXT_TOKENS = 120000;

// profile 记忆注入上限：只取最重要的前 N 条、每条截断，更多靠 search_memory 按需检索
const PROFILE_INJECT_LIMIT = 8;
const PROFILE_INJECT_CHARS = 120;

// 当前笔记上下文：≤ INLINE 字符直接给全文（上限 MAX），超过则走摘要切片
const CURRENT_NOTE_INLINE_CHARS = 12000;
const CURRENT_NOTE_MAX_CHARS = 24000;

module.exports = {
  WRITE_TOOL_NAMES,
  ACTION_LABELS,
  DEFAULT_CHAT_MAX_TOKENS,
  MAX_CONTEXT_TOKENS,
  PROFILE_INJECT_LIMIT,
  PROFILE_INJECT_CHARS,
  CURRENT_NOTE_INLINE_CHARS,
  CURRENT_NOTE_MAX_CHARS
};
