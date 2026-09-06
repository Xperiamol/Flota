import React from 'react';
import {
  Warning as WarningIcon,
  Flag as FlagIcon,
  FlashOn as FlashOnIcon,
  Schedule as ScheduleIcon,
  Circle as CircleIcon
} from '../components/common/AppIcons';

/**
 * 优先级工具函数
 * 统一管理优先级相关的映射、颜色、图标等
 * 遵循DRY原则，避免代码重复
 */

// 优先级配置常量
export const PRIORITY_CONFIG = {
  urgent: {
    key: 'urgent',
    label: '紧急重要',
    color: '#f44336',
    icon: WarningIcon,
    order: 4
  },
  important: {
    key: 'important',
    label: '重要不紧急',
    color: '#ff9800',
    icon: FlagIcon,
    order: 3
  },
  normal: {
    key: 'normal',
    label: '紧急不重要',
    color: '#2196f3',
    icon: FlashOnIcon,
    order: 2
  },
  low: {
    key: 'low',
    label: '不重要不紧急',
    color: '#9e9e9e',
    icon: CircleIcon,
    order: 1
  }
};

/**
 * 根据重要性和紧急性获取优先级
 * @param {boolean} isImportant - 是否重要
 * @param {boolean} isUrgent - 是否紧急
 * @returns {string} 优先级键值
 */
export const getPriorityFromQuadrant = (isImportant, isUrgent) => {
  if (isImportant && isUrgent) {
    return 'urgent';
  } else if (isImportant && !isUrgent) {
    return 'important';
  } else if (!isImportant && isUrgent) {
    return 'normal';
  } else {
    return 'low';
  }
};

/**
 * 获取优先级颜色
 * @param {string} priority - 优先级键值
 * @returns {string} 颜色值
 */
export const getPriorityColor = (priority) => {
  return PRIORITY_CONFIG[priority]?.color || PRIORITY_CONFIG.low.color;
};

/**
 * 获取优先级图标组件
 * @param {string} priority - 优先级键值
 * @param {object} sx - 样式对象
 * @returns {React.Element} 图标组件
 */
export const getPriorityIcon = (priority, sx = {}) => {
  const IconComponent = PRIORITY_CONFIG[priority]?.icon || ScheduleIcon;
  const color = getPriorityColor(priority);
  return React.createElement(IconComponent, { 
    sx: { 
      color: 'white',
      backgroundColor: color,
      borderRadius: '50%',
      padding: '3px',
      fontSize: '0.8rem',
      width: '20px',
      height: '20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...sx 
    } 
  });
};

/**
 * 获取优先级文本
 * @param {string} priority - 优先级键值
 * @returns {string} 优先级文本
 */
export const getPriorityText = (priority) => {
  return PRIORITY_CONFIG[priority]?.label || '普通';
};

/**
 * 获取优先级排序权重
 * @param {string} priority - 优先级键值
 * @returns {number} 排序权重
 */
export const getPriorityOrder = (priority) => {
  return PRIORITY_CONFIG[priority]?.order || 0;
};

/**
 * 获取所有优先级配置数组
 * @returns {Array} 优先级配置数组
 */
export const getAllPriorities = () => {
  return Object.values(PRIORITY_CONFIG);
};

/**
 * 优先级排序比较函数
 * @param {object} a - 第一个待办项
 * @param {object} b - 第二个待办项
 * @returns {number} 比较结果
 */
export const comparePriority = (a, b) => {
  const orderA = getPriorityOrder(a.priority);
  const orderB = getPriorityOrder(b.priority);
  return orderB - orderA; // 降序排列
};
