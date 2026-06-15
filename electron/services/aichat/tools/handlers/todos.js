/**
 * 待办相关工具的 handlers。
 */

const { getLocalDateKey, getTodoTemporalStatus } = require('../../utils');

const search_todos = async (args, _runtime, { todoDAO }) => {
  const opts = { limit: args.limit || 10, page: 1 };
  if (args.status === 'completed') opts.status = 'completed';
  else if (args.status === 'pending') opts.status = 'pending';
  if (args.query) opts.search = args.query;
  const results = todoDAO.findAll(opts);
  const todos = (results.todos || results || []).map((t) => {
    const temporal = getTodoTemporalStatus(t);
    return {
      id: t.id,
      content: t.content,
      description: t.description,
      is_completed: t.is_completed,
      is_important: t.is_important,
      is_urgent: t.is_urgent,
      due_date: t.due_date,
      tags: t.tags,
      timeLabel: temporal.label,
      isOverdue: temporal.isOverdue,
      isDueToday: temporal.isDueToday,
      isUpcoming: temporal.isUpcoming
    };
  });
  return JSON.stringify(todos);
};

const get_today_todos = async (_args, _runtime, { todoDAO }) => {
  const today = getLocalDateKey();
  const results = todoDAO.findAll({ due_date: today, limit: 50, page: 1 });
  const todos = (results.todos || results || []).map((t) => {
    const temporal = getTodoTemporalStatus(t);
    return {
      id: t.id,
      content: t.content,
      is_completed: t.is_completed,
      is_important: t.is_important,
      is_urgent: t.is_urgent,
      due_date: t.due_date,
      timeLabel: temporal.label,
      isOverdue: temporal.isOverdue,
      isDueToday: temporal.isDueToday
    };
  });
  return JSON.stringify(todos);
};

const create_todo = async (args, _runtime, { todoDAO }) => {
  const todo = todoDAO.create({
    content: args.content,
    description: args.description || '',
    due_date: args.due_date || null,
    is_important: args.is_important ? 1 : 0,
    is_urgent: args.is_urgent ? 1 : 0,
    tags: args.tags || ''
  });
  return JSON.stringify({ success: true, id: todo.id, content: todo.content });
};

const create_todos = async (args, _runtime, { todoDAO }) => {
  const list = Array.isArray(args.todos) ? args.todos : [];
  const created = [];
  for (const t of list) {
    if (!t?.content) continue;
    const todo = todoDAO.create({
      content: t.content,
      description: t.description || '',
      due_date: t.due_date || null,
      is_important: t.is_important ? 1 : 0,
      is_urgent: t.is_urgent ? 1 : 0,
      tags: t.tags || ''
    });
    created.push({ id: todo.id, content: todo.content });
  }
  return JSON.stringify({ success: true, count: created.length, todos: created });
};

module.exports = { search_todos, get_today_todos, create_todo, create_todos };
