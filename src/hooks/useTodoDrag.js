import { useState } from 'react';
import { updateTodo } from '../api/todoAPI';
import { getPriorityFromQuadrant } from '../utils/priorityUtils';

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
   */
  const handleDragStart = (e, todo) => {
    setDraggedTodo(todo);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', todo.id);
    
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
      // 更新 todo 的 due_date
      const newDueDate = new Date(targetDate);
      
      // 保留原有的时间部分
      if (draggedTodo.due_date) {
        const oldDate = new Date(draggedTodo.due_date);
        newDueDate.setHours(oldDate.getHours());
        newDueDate.setMinutes(oldDate.getMinutes());
        newDueDate.setSeconds(oldDate.getSeconds());
      }
      
      await updateTodo(draggedTodo.id, {
        ...draggedTodo,
        due_date: newDueDate.toISOString()
      });
      
      if (onUpdate) {
        onUpdate();
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
