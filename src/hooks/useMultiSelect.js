import { useState, useCallback, useMemo } from 'react';

/**
 * 通用多选状态管理Hook
 * 遵循SOLID原则，提供独立的多选功能模块
 * @param {Object} options - 配置选项
 * @param {Function} options.onSelectionChange - 选择变化回调
 * @param {Function} options.onModeChange - 模式变化回调
 * @returns {Object} 多选状态和操作方法
 */
export const useMultiSelect = (options = {}) => {
  const { onSelectionChange, onModeChange } = options;
  
  // 多选模式状态
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  
  // 选中的项目ID集合
  const [selectedIds, setSelectedIds] = useState(new Set());
  
  // 进入多选模式
  const enterMultiSelectMode = useCallback((initialId = null) => {
    setIsMultiSelectMode(true);
    if (initialId) {
      const newSelection = new Set([initialId]);
      setSelectedIds(newSelection);
      // 使用 setTimeout 延迟回调，避免在渲染过程中调用
      setTimeout(() => {
        onSelectionChange?.(Array.from(newSelection));
      }, 0);
    }
    setTimeout(() => {
      onModeChange?.(true);
    }, 0);
  }, [onSelectionChange, onModeChange]);
  
  // 退出多选模式
  const exitMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedIds(new Set());
    // 使用 setTimeout 延迟回调，避免在渲染过程中调用
    setTimeout(() => {
      onSelectionChange?.([]);
      onModeChange?.(false);
    }, 0);
  }, [onSelectionChange, onModeChange]);
  
  // 切换项目选中状态
  const toggleSelection = useCallback((id) => {
    if (!isMultiSelectMode) return;
    
    setSelectedIds(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      // 使用 setTimeout 延迟回调，避免在渲染过程中调用
      setTimeout(() => {
        onSelectionChange?.(Array.from(newSelection));
      }, 0);
      return newSelection;
    });
  }, [isMultiSelectMode, onSelectionChange]);
  
  // 选择所有项目
  const selectAll = useCallback((allIds) => {
    if (!isMultiSelectMode) return;
    
    // 如果没有提供allIds，则从options中获取
    const idsToSelect = allIds || options.getAllIds?.() || [];
    const newSelection = new Set(idsToSelect);
    setSelectedIds(newSelection);
    // 使用 setTimeout 延迟回调，避免在渲染过程中调用
    setTimeout(() => {
      onSelectionChange?.(Array.from(newSelection));
    }, 0);
  }, [isMultiSelectMode, onSelectionChange, options]);
  
  // 取消选择所有项目
  const selectNone = useCallback(() => {
    if (!isMultiSelectMode) return;
    
    setSelectedIds(new Set());
    // 使用 setTimeout 延迟回调，避免在渲染过程中调用
    setTimeout(() => {
      onSelectionChange?.([]);
    }, 0);
  }, [isMultiSelectMode, onSelectionChange]);
  
  // 检查项目是否被选中
  const isSelected = useCallback((id) => {
    return selectedIds.has(id);
  }, [selectedIds]);
  
  // 处理右键点击
  const handleContextMenu = useCallback((event, id, currentMode = false, onContextMenuAction = null) => {
    event.preventDefault();

    // 统一规则：如果调用方提供了右键菜单动作，则优先打开菜单，不切换多选模式。
    if (typeof onContextMenuAction === 'function') {
      onContextMenuAction(event, id);
      return;
    }
    
    if (!currentMode) {
      // 如果不在多选模式，右键进入多选模式并选中当前项
      enterMultiSelectMode(id);
    } else {
      // 如果已在多选模式，右键退出多选模式
      exitMultiSelectMode();
    }
  }, [enterMultiSelectMode, exitMultiSelectMode]);
  
  // 处理普通点击
  const handleClick = useCallback((event, id, normalClickHandler) => {
    if (isMultiSelectMode) {
      // 多选模式下，点击切换选中状态
      event.preventDefault();
      toggleSelection(id);
    } else {
      // 普通模式下，执行正常的点击处理
      normalClickHandler?.(id);
    }
  }, [isMultiSelectMode, toggleSelection]);
  
  // 计算选中数量
  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);
  
  // 计算是否全选
  const isAllSelected = useCallback((totalCount) => {
    return selectedCount === totalCount && totalCount > 0;
  }, [selectedCount]);
  
  // 重置状态
  const reset = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedIds(new Set());
    // 使用 setTimeout 延迟回调，避免在渲染过程中调用
    setTimeout(() => {
      onSelectionChange?.([]);
      onModeChange?.(false);
    }, 0);
  }, [onSelectionChange, onModeChange]);
  
  return {
    // 状态
    isMultiSelectMode,
    selectedIds: Array.from(selectedIds),
    selectedCount,
    
    // 操作方法
    enterMultiSelectMode,
    exitMultiSelectMode,
    toggleSelection,
    selectAll,
    selectNone,
    isSelected,
    isAllSelected,
    reset,
    
    // 事件处理器
    handleContextMenu,
    handleClick
  };
};

export default useMultiSelect;