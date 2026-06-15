/**
 * 全局动画配置
 * 标准曲线选用 Apple 风 cubic-bezier(0.32, 0.72, 0, 1)
 * — 比 Material 的 (0.4, 0, 0.2, 1) 更跟手、更紧致，参见 Apple HIG / Linear / Raycast
 */

export const EASING = {
  // 标准缓动（项目主曲线）：Apple "spring-out" 风
  standard: 'cubic-bezier(0.32, 0.72, 0, 1)',
  // 加速缓动：用于离场
  accelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  // 减速缓动：用于入场
  decelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
  // 强调：长距离移动 / 大尺寸过渡
  emphasize: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
};

// 动画时长 — 全局只用以下三档
export const DURATION = {
  fast: '0.12s',     // 微反馈：press / 颜色切换
  normal: '0.18s',   // 主交互：hover / nav / 状态变化
  slow: '0.24s',     // 进出场：dialog / popover / 列表项
  verySlow: '0.32s', // 大尺寸过渡：sidebar 折叠 / 视图切换
};

// 数值版（用于需要 number 的场景）
export const DURATION_MS = {
  fast: 120,
  normal: 180,
  slow: 240,
  verySlow: 320,
};

// 预定义动画配置（旧 API 保持兼容）
export const ANIMATIONS = {
  hover:        { duration: DURATION.normal, easing: EASING.standard, property: 'all' },
  stateChange:  { duration: DURATION.normal, easing: EASING.standard, property: 'all' },
  button:       { duration: DURATION.fast,   easing: EASING.standard, property: 'all' },
  listItem:     { duration: DURATION.normal, easing: EASING.standard, property: 'all' },
  card:         { duration: DURATION.slow,   easing: EASING.standard, property: 'all' },
  dragTransition: { duration: DURATION.fast, easing: EASING.standard, property: 'transform' },
  completion:   { duration: DURATION.fast,   easing: EASING.standard, keyframes: 'greenSweep' },
  pulse:        { duration: '1s',            easing: EASING.standard, iteration: 'infinite' },
};

export const createAnimationString = (config) => {
  const { duration, easing, keyframes, iteration = 'forwards' } = config;
  return `${keyframes} ${duration} ${easing} ${iteration}`;
};

export const createTransitionString = (config) => {
  const { property = 'all', duration, easing } = config;
  return `${property} ${duration} ${easing}`;
};

export const GREEN_SWEEP_KEYFRAMES = {
  '@keyframes greenSweep': {
    '0%': { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(0%)' },
  },
};

export const PULSE_KEYFRAMES = {
  '@keyframes pulse': {
    '0%':   { opacity: 1, transform: 'scale(1)' },
    '50%':  { opacity: 0.7, transform: 'scale(1.1)' },
    '100%': { opacity: 1, transform: 'scale(1)' },
  },
};

export default {
  EASING,
  DURATION,
  DURATION_MS,
  ANIMATIONS,
  createAnimationString,
  createTransitionString,
  GREEN_SWEEP_KEYFRAMES,
  PULSE_KEYFRAMES,
};
