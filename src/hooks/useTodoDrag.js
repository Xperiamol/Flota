import { useState } from 'react';
import { updateTodo } from '../api/todoAPI';
import { getPriorityFromQuadrant } from '../utils/priorityUtils';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const startOfLocalDay = (value) => {
  const d = value instanceof Date ? new Date(value) : parseLocalDate(value);
  if (!d || Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};

// "YYYY-MM-DD" 按本地日期解析（new Date('2026-01-02') 会当作 UTC，跨时区会差一天）
const parseLocalDate = (value) => {
  if (!value) return null;
  const text = String(value);
  if (DATE_ONLY_RE.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(text);
};

export const formatDateOnly = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// 按天数平移一个日期值，保持它原来的形态（纯日期 / 带时间）
const shiftDateValue = (value, dayDelta, hasTime) => {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return value;
  // 用本地日期运算，避免夏令时导致的 ±1 小时偏差
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayDelta,
    date.getHours(), date.getMinutes(), date.getSeconds());
  return hasTime ? shifted.toISOString() : formatDateOnly(shifted);
};

/**
 * 计算把待办拖到目标日期时需要更新的字段。
 * - 按「从哪天拖出 → 拖到哪天」的天数差平移，重复待办、跨天待办（end_date）一起平移
 * - 保留原来是否带具体时间；全天待办不会被改成 00:00 的定时待办
 * - 同一天放下返回 null
 */
export const buildDateMovePatch = (todo, targetDate, sourceDate = null) => {
  const target = startOfLocalDay(targetDate);
  if (!target) return null;
  const hasTime = todo.has_time !== undefined && todo.has_time !== null
    ? Boolean(Number(todo.has_time))
    : /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(String(todo.due_date || ''));

  if (!todo.due_date) {
    return { due_date: formatDateOnly(target), has_time: 0 };
  }
  const source = startOfLocalDay(sourceDate || todo.due_date);
  if (!source) return null;
  const dayDelta = Math.round((target.getTime() - source.getTime()) / DAY_MS);
  if (dayDelta === 0) return null;

  const patch = { due_date: shiftDateValue(todo.due_date, dayDelta, hasTime), has_time: hasTime ? 1 : 0 };
  if (todo.end_date) {
    patch.end_date = shiftDateValue(todo.end_date, dayDelta, /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(String(todo.end_date)));
  }
  return patch;
};

/**
 * 可复用的 Todo 拖放 Hook
 * 遵循 DRY 和 SOLID 原则
 * 
 * @param {Function} onUpdate - 更新成功后的回调函数
 * @param {Function} onError - 错误处理回调函数
 * @returns {Object} 拖放相关的状态和处理函数
 */
const useTodoDrag = (onUpdate, onError) => {
  const [draggedTodo, setDraggedTodo] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);

  /**
   * 处理拖动开始
   * @param {Date} [sourceDate] - 从日历哪一天拖出（重复待办 / 跨天待办按天数差平移）
   */
  const handleDragStart = (e, todo, sourceDate = null) => {
    setDraggedTodo(sourceDate ? { ...todo, __dragSourceDate: sourceDate } : todo);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(todo.id));
    
    // 添加半透明效果
    if (e.target) {
      e.target.style.opacity = '0.5';
    }
  };

  /**
   * 处理拖动结束
   */
  const handleDragEnd = (e) => {
    if (e.target) {
      e.target.style.opacity = '1';
    }
    setDraggedTodo(null);
    setDragOverTarget(null);
  };

  /**
   * 处理拖动经过
   */
  const handleDragOver = (e, target) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(target);
  };

  /**
   * 处理拖动离开
   */
  const handleDragLeave = (e) => {
    // 只在离开目标区域时清除，不在内部元素间移动时清除
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) {
      setDragOverTarget(null);
    }
  };

  /**
   * 处理放置 - 更新日期
   * @param {Event} e - 拖放事件
   * @param {Date} targetDate - 目标日期
   */
  const handleDropDate = async (e, targetDate) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedTodo) return;

    try {
      const patch = buildDateMovePatch(draggedTodo, targetDate, draggedTodo.__dragSourceDate);
      if (!patch) return;
      // 只提交日期字段：整条待办回写会重复计算标签使用次数、覆盖并发修改
      await updateTodo(draggedTodo.id, patch);
      
      if (onUpdate) {
        onUpdate({ todo: draggedTodo, targetDate, patch });
      }
    } catch (error) {
      console.error('更新待办事项日期失败:', error);
      if (onError) {
        onError(error);
      }
    } finally {
      setDraggedTodo(null);
      setDragOverTarget(null);
    }
  };

  /**
   * 处理放置 - 更新象限（重要性和紧急度）
   * @param {Event} e - 拖放事件
   * @param {Object} quadrant - 目标象限信息 { isImportant, isUrgent }
   */
  const handleDropQuadrant = async (e, quadrant) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedTodo) return;

    try {
      // 检查是否需要更新
      const priority = getPriorityFromQuadrant(quadrant.isImportant, quadrant.isUrgent);
      const needsUpdate = 
        draggedTodo.is_important !== quadrant.isImportant ||
        draggedTodo.is_urgent !== quadrant.isUrgent ||
        draggedTodo.priority !== priority;

      if (!needsUpdate) {
        setDraggedTodo(null);
        setDragOverTarget(null);
        return;
      }

      await updateTodo(draggedTodo.id, {
        ...draggedTodo,
        is_important: quadrant.isImportant,
        is_urgent: quadrant.isUrgent,
        priority
      });
      
      if (onUpdate) {
        onUpdate();
      }
    } catch (error) {
      console.error('更新待办事项象限失败:', error);
      if (onError) {
        onError(error);
      }
    } finally {
      setDraggedTodo(null);
      setDragOverTarget(null);
    }
  };

  /**
   * 检查目标是否被拖动经过
   */
  const isDragOver = (target) => {
    if (!dragOverTarget || !target) return false;
    
    // 支持日期比较
    if (target instanceof Date && dragOverTarget instanceof Date) {
      return target.toDateString() === dragOverTarget.toDateString();
    }
    
    // 支持字符串比较（象限 key）
    return dragOverTarget === target;
  };

  return {
    draggedTodo,
    dragOverTarget,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDropDate,
    handleDropQuadrant,
    isDragOver
  };
};

export default useTodoDrag;
