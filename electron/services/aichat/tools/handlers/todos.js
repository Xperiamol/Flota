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

const create_todo = async (args, _runtime, { todoDAO }) => {
  const { parent: todo, subtasks } = createTodoWithSubtasks(todoDAO, args);
  return JSON.stringify({
    success: true,
    id: todo.id,
    content: todo.content,
    repeat_type: todo.repeat_type,
    repeat_interval: todo.repeat_interval,
    repeat_days: todo.repeat_days,
    subtasks
  });
};

const create_todos = async (args, _runtime, { todoDAO }) => {
  const list = Array.isArray(args.todos) ? args.todos : [];
  const created = [];
  for (const t of list) {
    if (!t?.content) continue;
    const { parent: todo, subtasks } = createTodoWithSubtasks(todoDAO, t);
    created.push({
      id: todo.id,
      content: todo.content,
      repeat_type: todo.repeat_type,
      repeat_interval: todo.repeat_interval,
      repeat_days: todo.repeat_days,
      subtasks
    });
  }
  return JSON.stringify({ success: true, count: created.length, todos: created });
};

module.exports = { search_todos, get_today_todos, create_todo, create_todos };
