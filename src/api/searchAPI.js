/**
 * 搜索API模块
 * 遵循SOLID原则中的单一职责原则，专门处理搜索相关的API调用
 * 遵循DRY原则，统一管理所有搜索API
 */

/**
 * 搜索笔记
 * @param {string} query - 搜索查询字符串
 * @returns {Promise<Object>} 搜索结果
 */
import { normalizeTags } from '../utils/tagUtils'
import { isTodoCompleted } from '../utils/todoDisplayUtils'

export const searchNotesAPI = async (query) => {
  try {
    if (!window.electronAPI?.notes?.search) {
      throw new Error('Notes search API not available');
    }

    const result = await window.electronAPI.notes.search(query);

    if (result?.success) {
      // 使用tagUtils标准化笔记数据格式
      const normalizedNotes = (result.data || []).map(note => ({
        ...note,
        tags: normalizeTags(note.tags)
      }));

      return {
        success: true,
        data: normalizedNotes
      };
    }

    return result;
  } catch (error) {
    console.error('Failed to search notes:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 搜索待办事项
 * @param {string} query - 搜索查询字符串
 * @returns {Promise<Object>} 搜索结果
 */
export const searchTodosAPI = async (query) => {
  try {
    if (!window.electronAPI?.todos?.search) {
      throw new Error('Todos search API not available');
    }
    
    const result = await window.electronAPI.todos.search(query);
    
    if (result?.success) {
      // 标准化待办事项数据格式
      const normalizedTodos = (result.data || []).map(todo => ({
        ...todo,
        completed: isTodoCompleted(todo),
        title: todo.content,
        priority: getPriorityFromQuadrant(todo.is_important, todo.is_urgent)
      }));
      
      return {
        success: true,
        data: normalizedTodos
      };
    }
    
    return result;
  } catch (error) {
    console.error('Failed to search todos:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 根据重要性和紧急性获取优先级
 * @param {boolean} isImportant - 是否重要
 * @param {boolean} isUrgent - 是否紧急
 * @returns {string} 优先级字符串
 */
const getPriorityFromQuadrant = (isImportant, isUrgent) => {
  if (isImportant && isUrgent) return 'high';
  if (isImportant && !isUrgent) return 'medium';
  if (!isImportant && isUrgent) return 'medium';
  return 'low';
};

/**
 * 通用搜索函数工厂
 * @param {string} type - 搜索类型 ('notes' | 'todos')
 * @returns {Function} 对应的搜索API函数
 */
export const createSearchAPI = (type) => {
  switch (type) {
    case 'notes':
      return searchNotesAPI;
    case 'todos':
      return searchTodosAPI;
    default:
      throw new Error(`Unsupported search type: ${type}`);
  }
};

export default {
  searchNotesAPI,
  searchTodosAPI,
  createSearchAPI
};