import { useState } from 'react';

/**
 * 筛选面板可见性
 *
 * 筛选器已从常驻筛选栏改为可拖动的浮动面板：它浮在列表和正文之上，
 * 如果沿用旧的「默认显示 + 跨会话记住打开状态」，每次启动都会盖住笔记列表和编辑区。
 * 因此每次进入都从关闭开始，由用户点筛选按钮打开（面板位置仍会被记住）。
 */
export const useFiltersVisibility = (storageKey = 'filters_visible') => {
  const [filtersVisible, setFiltersVisible] = useState(() => {
    // 清理旧版本残留的“记住打开”状态
    try { localStorage.removeItem(storageKey); } catch {}
    return false;
  });

  const toggleFiltersVisibility = () => {
    setFiltersVisible(prev => !prev);
  };

  return {
    filtersVisible,
    toggleFiltersVisibility,
    setFiltersVisible
  };
};
