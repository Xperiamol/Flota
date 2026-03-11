import { invoke } from './ipc';

export const fetchTodos = (options = {}) => invoke('todo:getAll', options);
export const fetchTodosByQuadrant = (includeCompleted = false) => invoke('todo:getByQuadrant', includeCompleted);
export const fetchTodosByPriority = () => invoke('todo:getByPriority');
export const fetchTodosByDueDate = () => invoke('todo:getByDueDate');
export const fetchTodosByCreatedAt = () => invoke('todo:getByCreatedAt');
export const fetchTodosByDate = (dateString) => invoke('todo:getByDate', dateString);
export const fetchTodosDueToday = () => invoke('todo:getDueToday');
export const fetchOverdueTodos = () => invoke('todo:getOverdue');
export const fetchTodoStats = () => invoke('todo:getStats');
export const searchTodos = (query) => invoke('todo:search', query);
export const fetchTodoPriorityStats = () => invoke('todo:getPriorityStats');
export const fetchTodoTagStats = () => invoke('todo:getTodoTagStats');
export const fetchRecurringTodos = () => invoke('todo:getRecurring');
export const processRecurringTodos = () => invoke('todo:processRecurring');

export const createTodo = (todoData) => invoke('todo:create', todoData);
export const updateTodo = (id, todoData) => invoke('todo:update', id, todoData);
export const deleteTodo = (id) => invoke('todo:delete', id);
export const toggleTodoComplete = (id) => invoke('todo:toggleComplete', id);
export const fetchSubtasks = (parentSyncId) => invoke('todo:getSubtasks', parentSyncId);
export const addTodoFocusTime = (id, durationSeconds) => invoke('todo:addFocusTime', id, durationSeconds);

export const batchUpdateTodos = (updates) => invoke('todo:batchUpdate', updates);
export const batchDeleteTodos = (ids) => invoke('todo:batchDelete', ids);
export const batchCompleteTodos = (ids) => invoke('todo:batchComplete', ids);

export const getTodoTagSuggestions = async (query) => {
  try {
    return await invoke('todo:getTagSuggestions', query);
  } catch (error) {
    console.error('获取标签建议失败:', error);
    return [];
  }
};

export const searchTodoTags = (query) => invoke('todo:searchTags', query);

export const exportTodos = (options) => invoke('todo:export', options);
