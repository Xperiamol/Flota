import { useState, useCallback } from 'react';
import { isTodoCompleted, isFutureRecurringTodo } from '../utils/todoDisplayUtils';

/**
 * 管理Todo完成状态和动画的自定义Hook
 * 提供双击完成机制、庆祝动画等功能
 */
export const useTodoCompletion = (onRefresh) => {
  const [pendingComplete, setPendingComplete] = useState(new Set());
  const [celebratingTodos, setCelebratingTodos] = useState(new Set());

  const handleToggleComplete = useCallback(async (todo) => {
    // 未来重复待办不可完成
    if (isFutureRecurringTodo(todo)) return;

    // 如果已经完成，直接切换状态
    if (isTodoCompleted(todo)) {
      try {
        await window.electronAPI.todos.toggleComplete(todo.id);
        if (onRefresh) {
          onRefresh();
        }
      } catch (error) {
        console.error('更新待办事项失败:', error);
      }
      return;
    }
    
    // 未完成的任务需要双击
    if (pendingComplete.has(todo.id)) {
      // 第二次点击，执行完成操作
      try {
        // 先显示庆祝动画
        setCelebratingTodos(prev => new Set([...prev, todo.id]));
        
        // 延迟执行完成操作，让动画播放
        setTimeout(async () => {
          await window.electronAPI.todos.toggleComplete(todo.id);
          if (onRefresh) {
            onRefresh();
          }
          
          // 清除庆祝状态
          setTimeout(() => {
            setCelebratingTodos(prev => {
              const newSet = new Set(prev);
              newSet.delete(todo.id);
              return newSet;
            });
          }, 1000);
        }, 300);
        
        // 清除待完成状态
        setPendingComplete(prev => {
          const newSet = new Set(prev);
          newSet.delete(todo.id);
          return newSet;
        });
      } catch (error) {
        console.error('更新待办事项失败:', error);
        // 出错时清除待完成状态
        setPendingComplete(prev => {
          const newSet = new Set(prev);
          newSet.delete(todo.id);
          return newSet;
        });
      }
    } else {
      // 第一次点击，标记为待完成
      setPendingComplete(prev => new Set([...prev, todo.id]));
      
      // 3秒后自动清除待完成状态
      setTimeout(() => {
        setPendingComplete(prev => {
          const newSet = new Set(prev);
          newSet.delete(todo.id);
          return newSet;
        });
      }, 3000);
    }
  }, [pendingComplete, onRefresh]);

  // MyDayPanel使用的简化版本（使用invoke而不是todos API）
  const handleToggleCompleteInvoke = useCallback(async (todoId) => {
    if (!window.electronAPI) return;
    
    // 添加到待处理状态
    setPendingComplete(prev => new Set([...prev, todoId]));
    
    try {
      const result = await window.electronAPI.invoke('todo:toggleComplete', todoId);
      
      if (result.success) {
        // 移除待处理状态
        setPendingComplete(prev => {
          const newSet = new Set(prev);
          newSet.delete(todoId);
          return newSet;
        });
        
        // 添加庆祝动画
        setCelebratingTodos(prev => new Set([...prev, todoId]));
        
        // 延迟移除庆祝状态
        setTimeout(() => {
          setCelebratingTodos(prev => {
            const newSet = new Set(prev);
            newSet.delete(todoId);
            return newSet;
          });
        }, 300);
        
        // 刷新数据
        if (onRefresh) {
          onRefresh();
        }
      }
    } catch (error) {
      console.error('切换Todo状态失败:', error);
      // 移除待处理状态
      setPendingComplete(prev => {
        const newSet = new Set(prev);
        newSet.delete(todoId);
        return newSet;
      });
    }
  }, [onRefresh]);

  return {
    pendingComplete,
    celebratingTodos,
    handleToggleComplete,
    handleToggleCompleteInvoke
  };
};