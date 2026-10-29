/**
 * 待办相关工具的 handlers。
 */

const { getLocalDateKey, getTodoTemporalStatus } = require('../../utils');

const REPEAT_TYPES = new Set(['none', 'daily', 'weekly', 'monthly', 'yearly']);

const normalizeRepeat = (todo = {}) => {
  const repeatType = REPEAT_TYPES.has(todo.repeat_type) ? todo.repeat_type : 'none';
  const interval = Number.parseInt(todo.repeat_interval, 10);
  const repeatInterval = Number.isFinite(interval) ? Math.min(Math.max(interval, 1), 365) : 1;
  const repeatDays = repeatType === 'weekly'
    ? [...new Set(String(todo.repeat_days || '')
      .split(',')
      .map((day) => Number.parseInt(day.trim(), 10))
      .filter((day) => day >= 1 && day <= 7))]
      .sort((a, b) => a - b)
      .join(',')
    : '';

  return {
    repeat_type: repeatType,
    repeat_interval: repeatInterval,
    repeat_days: repeatDays,
    is_recurring: repeatType === 'none' ? 0 : 1
  };
};

const buildTodoCreateData = (todo) => ({
  content: todo.content,
  description: todo.description || '',
  due_date: todo.due_date || null,
  is_important: todo.is_important ? 1 : 0,
  is_urgent: todo.is_urgent ? 1 : 0,
  tags: todo.tags || '',
  ...normalizeRepeat(todo)
});

const createTodoWithSubtasks = (todoDAO, todo) => {
  let existingParent = null;
  if (todo.parent_id != null) {
    existingParent = todoDAO.findById(todo.parent_id);
    if (!existingParent) throw new Error(`未找到ID为 ${todo.parent_id} 的父待办`);
  }
  const parent = todoDAO.create({
    ...buildTodoCreateData(todo),
    parent_todo_id: existingParent?.sync_id || null
  });
  const subtasks = [];
  for (const subtask of Array.isArray(todo.subtasks) ? todo.subtasks : []) {
    if (!subtask?.content) continue;
    const created = todoDAO.create({
      ...buildTodoCreateData(subtask),
      parent_todo_id: parent.sync_id
    });
    subtasks.push({ id: created.id, content: created.content, is_completed: created.is_completed });
  }
  return { parent, subtasks };
};

const serializeTodo = (todo, todoDAO) => {
  const temporal = getTodoTemporalStatus(todo);
  return {
    id: todo.id,
    sync_id: todo.sync_id,
    content: todo.content,
    description: todo.description,
    is_completed: todo.is_completed,
    is_important: todo.is_important,
    is_urgent: todo.is_urgent,
    due_date: todo.due_date,
    tags: todo.tags,
    repeat_type: todo.repeat_type || 'none',
    repeat_interval: todo.repeat_interval || 1,
    repeat_days: todo.repeat_days || '',
    subtasks: todo.sync_id ? todoDAO.getSubtasks(todo.sync_id).map((subtask) => ({
      id: subtask.id,
      content: subtask.content,
      description: subtask.description,
      is_completed: subtask.is_completed,
      due_date: subtask.due_date
    })) : [],
    timeLabel: temporal.label,
    isOverdue: temporal.isOverdue,
    isDueToday: temporal.isDueToday,
    isUpcoming: temporal.isUpcoming
  };
};

const search_todos = async (args, _runtime, { todoDAO }) => {
  const opts = { limit: args.limit || 10, page: 1 };
  if (args.status === 'completed') opts.status = 'completed';
  else if (args.status === 'pending') opts.status = 'pending';
  if (args.query) opts.search = args.query;
  const results = todoDAO.findAll(opts);
  const todos = (results.todos || results || []).map((t) => serializeTodo(t, todoDAO));
  return JSON.stringify(todos);
};

const get_today_todos = async (_args, _runtime, { todoDAO }) => {
  const today = getLocalDateKey();
  const results = todoDAO.findAll({ due_date: today, limit: 50, page: 1 });
  const todos = (results.todos || results || []).map((t) => serializeTodo(t, todoDAO));
  return JSON.stringify(todos);
};

// A note/task edit is one transaction: never leave orphan tasks if note persistence fails.
const createLinkedTodos = (args, list, { todoDAO, noteDAO }) => {
  const execute = () => {
    let note = null;
    if (args.source_note_id != null) {
      note = noteDAO?.findBySyncId?.(String(args.source_note_id)) || noteDAO?.findById?.(args.source_note_id);
      if (!note || note.is_deleted) throw new Error('来源笔记不存在或已删除');
      if (args.embed_in_note && note.note_type && note.note_type !== 'markdown') throw new Error('待办清单只能插入文本笔记');
    }
    if (args.embed_in_note && !note) throw new Error('插入待办清单需要指定 source_note_id');
    const link = note ? `[${String(note.title || '来源笔记').replace(/[\\[\]\r\n]/g, ' ')}](app://note/${encodeURIComponent(note.sync_id || note.id)})` : '';
    const linkTask = todo => ({ ...todo, description: [todo.description, link].filter(Boolean).join('\n\n'),
      subtasks: Array.isArray(todo.subtasks) ? todo.subtasks.map(subtask => ({ ...subtask, description: [subtask.description, link].filter(Boolean).join('\n\n') })) : todo.subtasks });
    const created = list.filter(todo => todo?.content?.trim()).map(todo => {
      const { parent, subtasks } = createTodoWithSubtasks(todoDAO, link ? linkTask(todo) : todo);
      return { id: parent.id, sync_id: parent.sync_id, content: parent.content, repeat_type: parent.repeat_type,
        repeat_interval: parent.repeat_interval, repeat_days: parent.repeat_days, subtasks };
    });
    if (note && args.embed_in_note && created.length) {
      const reference = `app://todo-list/${encodeURIComponent(`note/${note.sync_id || note.id}`)}`;
      if (!String(note.content || '').includes(reference)) {
        const updated = noteDAO.update(note.id, { content: `${note.content || ''}\n\n[待办清单](${reference})\n\n` });
        if (!updated) throw new Error('保存笔记失败');
      }
    }
    return created;
  };
  // Existing unlinked callers and test doubles keep their previous path.
  return args.source_note_id != null ? todoDAO.getDB().transaction(execute)() : execute();
};

const create_todo = async (args, _runtime, services) => {
  const [todo] = createLinkedTodos(args, [args], services);
  if (!todo) throw new Error('待办内容不能为空');
  return JSON.stringify({ success: true, ...todo, noteId: args.source_note_id || null });
};

const create_todos = async (args, _runtime, services) => {
  const created = createLinkedTodos(args, Array.isArray(args.todos) ? args.todos : [], services);
  return JSON.stringify({ success: true, count: created.length, todos: created, noteId: args.source_note_id || null });
};

module.exports = { search_todos, get_today_todos, create_todo, create_todos };
