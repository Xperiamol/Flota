import { BLUR } from './materials';

/**
 * 通用样式常量 - 统一管理组件间重复的 sx 样式
 * 减少样式碎片化，提高可维护性
 */

// 列表操作覆盖在内容上，仅交互时显示，不为隐藏按钮预留整列。
export const rowActionRevealSx = {
  '& .row-inline-action': {
    isolation: 'isolate',
    color: 'text.primary',
    pointerEvents: 'none',
    background: 'transparent',
    transition: 'color 150ms ease',
    '& > svg, & > .MuiCircularProgress-root': {
      opacity: 0,
      zIndex: 1,
      transition: 'opacity 150ms ease, transform 150ms ease',
    },
    // 只模糊按钮后方的内容，不叠加白／黑底色，保留壁纸原本的颜色。
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: -8,
      zIndex: 0,
      opacity: 0,
      borderRadius: '50%',
      background: 'transparent',
      backdropFilter: BLUR.halo,
      WebkitBackdropFilter: BLUR.halo,
      maskImage: 'radial-gradient(ellipse closest-side, #000 35%, rgba(0,0,0,0.65) 60%, transparent 100%)',
      transition: 'opacity 150ms ease',
      pointerEvents: 'none',
    },
    '& > svg': { position: 'relative' },
    // 用图标反馈交互，避免 MUI 点击涟漪又画出一块有颜色的按钮底。
    '& > .MuiTouchRipple-root': { display: 'none' },
    '&:hover, &.Mui-focusVisible': { color: 'primary.main', background: 'transparent' },
    '&:active': { background: 'transparent', '& > svg': { transform: 'scale(0.92)' } },
  },
  // 只在鼠标悬停 / 键盘聚焦时显示；鼠标点击留下的焦点不应让按钮一直挂着
  '&:hover .row-inline-action, &:has(.row-inline-action:focus-visible) .row-inline-action, &[data-menu-open="true"] .row-inline-action': {
    pointerEvents: 'auto',
    '& > svg, & > .MuiCircularProgress-root, &::before': { opacity: 1 },
  },
  '@media (hover: none)': {
    '& .row-inline-action': {
      pointerEvents: 'auto',
      '& > svg, & > .MuiCircularProgress-root, &::before': { opacity: 1 },
    },
  },
  '@media (prefers-reduced-motion: reduce)': {
    '& .row-inline-action, & .row-inline-action::before, & .row-inline-action > svg, & .row-inline-action > .MuiCircularProgress-root': { transition: 'none' },
  },
};

// ========== 间距相关 ==========
export const spacing = {
  mb1: { mb: 1 },
  mb2: { mb: 2 },
  mb3: { mb: 3 },
  mt1: { mt: 1 },
  mt2: { mt: 2 },
  mt3: { mt: 3 },
  mt4: { mt: 4 },
  p3: { p: 3 },
  py4: { py: 4 }
};

// ========== Flexbox 布局 ==========
export const flex = {
  // 基础 flex 容器
  row: { display: 'flex', alignItems: 'center' },
  rowGap1: { display: 'flex', alignItems: 'center', gap: 1 },
  rowGap2: { display: 'flex', alignItems: 'center', gap: 2 },
  
  // 水平布局变体
  rowWrap: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' },
  rowGap1Wrap: { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' },
  rowGap2Wrap: { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' },
  
  // 垂直布局
  column: { display: 'flex', flexDirection: 'column' },
  columnGap1: { display: 'flex', flexDirection: 'column', gap: 1 },
  
  // 居中对齐
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  centerColumn: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  spaceBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  
  // 伸展容器
  flex1: { flex: 1 },
  flexAuto: { flex: 1, overflow: 'auto' }
};

// ========== 颜色组合（icon + color 常见组合） ==========
export const iconWithColor = {
  disabled: { fontSize: 20, color: 'text.disabled' },
  warning: { fontSize: 20, color: 'warning.main' },
  primary: { fontSize: 20, color: 'primary.main' },
  error: { fontSize: 20, color: 'error.main' },
  success: { fontSize: 20, color: 'success.main' }
};

// ========== 组合样式（常用场景预设） ==========
export const combo = {
  // Alert 常见间距
  alertMb2: { mb: 2 },
  
  // Section 容器
  section: { mb: 3 },
  
  // 固定宽度列
  col80: { minWidth: 80, maxWidth: 80 },
  col160: { minWidth: 160, maxWidth: 160 },
  
  // 位置布局
  relative: { position: 'relative' }
};

// ========== 卡片样式（quiet surface + restrained accent） ==========
/**
 * Hero 横幅卡片样式（个人中心顶部 / 插件商店头图等场景）
 * 用法：<Box sx={heroCardSx}>...</Box>
 */
export const heroCardSx = (muiTheme) => ({
  display: 'flex',
  alignItems: 'center',
  mb: 3,
  p: 3,
  borderRadius: '14px',
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: muiTheme.palette.background.paper,
  border: `1px solid ${muiTheme.palette.divider}`,
});

/**
 * 内容卡片样式（个人中心 / 插件卡 / 其他列表卡的通用风格）
 * 以柔和边框、玻璃背景和 hover 阴影表达层次，不额外添加装饰色条。
 * @returns {Function} sx 工厂函数（接收 muiTheme，返回 sx 对象）
 */
export const createSoftGlassCardSx = () => (muiTheme) => ({
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '14px',
  border: `1px solid ${muiTheme.palette.divider}`,
  backgroundColor: muiTheme.palette.background.paper,
  boxShadow: 'none',
  transition: 'border-color 150ms ease',
  '&:hover': {
    borderColor: muiTheme.palette.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)',
  },
});

// ========== 现代界面基础面板 ==========
export const modernSurfaceSx = (muiTheme) => ({
  borderRadius: '14px',
  border: `1px solid ${muiTheme.palette.divider}`,
  background: muiTheme.palette.background.paper,
});

export const sectionHeaderSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  mb: 1.5,
};

export const sectionTitleSx = {
  fontWeight: 650,
  fontSize: '1.05rem',
  letterSpacing: '-0.01em',
};

export const sectionDescriptionSx = {
  display: 'block',
  mt: 0.25,
  color: 'text.secondary',
};


export const emptyStateSx = (muiTheme) => ({
  ...modernSurfaceSx(muiTheme),
  p: 4,
  textAlign: 'center',
  color: muiTheme.palette.text.secondary,
});

// 设置分组：直接放在主内容面板上，不再套一层卡片
export const settingsSectionSx = () => ({
  px: 1,
  pt: 1,
  pb: 2,
  mb: 2,
  // 设置分组直接放在主面板上：常被用在 Paper 上，需要显式去掉 Paper 的白底，
  // 否则设了壁纸后每个分组都是一块白色色块
  backgroundColor: 'transparent',
  backgroundImage: 'none',
});

// 设置项：分组列表里的一行，行与行之间用细分割线，不再每行套一个框
export const settingsRowSx = (muiTheme) => ({
  px: 0.5,
  py: 1.75,
  borderBottom: `1px solid ${muiTheme.palette.divider}`,
  '&:last-of-type': { borderBottom: 'none' },
});

export const settingsFieldGroupSx = (muiTheme) => ({
  ...settingsRowSx(muiTheme),
  display: 'block',
});

// ========== 二级面板（侧栏 / MyDay 等容器） ==========
/**
 * 标准的紧凑玻璃面板：高斯模糊 + 半透明底色 + 内边距。
 * 用法：<Box sx={(t) => ({ ...compactGlassPanelSx(t), ...其他覆盖 })}>
 */
export const compactGlassPanelSx = (muiTheme) => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  p: 1.25,
  backgroundColor: 'transparent',
});

// ========== 细长滚动条（侧栏列表通用） ==========
/**
 * 与 panel 内边距协同的细滚动条。caller 通过 mr 把滚动条贴到 panel 边缘。
 */
export const thinScrollbarSx = {
  overflowY: 'auto',
  scrollbarGutter: 'stable',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(150, 150, 150, 0.2)',
    borderRadius: '3px',
    transition: 'background 0.3s ease',
  },
  '&::-webkit-scrollbar-thumb:hover': {
    background: 'rgba(150, 150, 150, 0.4)',
  },
  '&::-webkit-scrollbar-thumb:active': {
    background: 'rgba(150, 150, 150, 0.5)',
  },
  '&::-webkit-scrollbar-button': { display: 'none' },
};

// ========== 编辑区易抓取滚动条 ==========
// 12px 命中区域配合透明边框，静止时仍只显示 6px 滑块。
export const editorScrollbarSx = {
  scrollbarGutter: 'stable',
  scrollbarWidth: 'auto',
  '&::-webkit-scrollbar': {
    width: '12px',
    height: '12px',
  },
  '&::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    minHeight: '44px',
    backgroundColor: 'rgba(110,110,118, 0.34)',
    backgroundClip: 'content-box',
    border: '3px solid transparent',
    borderRadius: '999px',
    transition: 'background-color 160ms ease, border-width 160ms ease',
  },
  '&::-webkit-scrollbar-thumb:hover': {
    backgroundColor: 'rgba(110,110,118, 0.58)',
    borderWidth: '2px',
  },
  '&::-webkit-scrollbar-thumb:active': {
    backgroundColor: 'rgba(77,77,85, 0.76)',
    borderWidth: '2px',
  },
  '&::-webkit-scrollbar-button': {
    display: 'none',
  },
};

// ========== 主题色预设色块 ==========
/**
 * 设置页"主题色预设"色块的 sx 工厂。
 * @param {object} options
 * @param {string} options.color   该色块的色值
 * @param {boolean} options.selected 是否被选中
 * @param {boolean} options.isDark 当前是否是暗色模式
 * @param {(c: string, a: number) => string} options.alpha MUI alpha 工具
 */
export const colorPresetSwatchSx = ({ color, selected, isDark, alpha }) => ({
  position: 'relative',
  width: 30,
  height: 30,
  borderRadius: '50%',
  backgroundColor: color,
  cursor: 'pointer',
  transition: 'transform 160ms ease, box-shadow 200ms ease',
  boxShadow: selected
    ? `0 0 0 2px ${isDark ? '#161618' : '#ffffff'}, 0 0 0 4px ${alpha(color, 0.55)}, 0 4px 14px ${alpha(color, 0.32)}`
    : `inset 0 0 0 1px ${alpha('#000', isDark ? 0.35 : 0.10)}, 0 1px 2px ${alpha('#000', isDark ? 0.32 : 0.06)}`,
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: selected
      ? `0 0 0 2px ${isDark ? '#161618' : '#ffffff'}, 0 0 0 4px ${alpha(color, 0.65)}, 0 6px 18px ${alpha(color, 0.36)}`
      : `inset 0 0 0 1px ${alpha('#000', isDark ? 0.35 : 0.10)}, 0 4px 12px ${alpha(color, 0.28)}`,
  },
  '&::after': selected ? {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 8,
    height: 4,
    borderLeft: '2px solid #fff',
    borderBottom: '2px solid #fff',
    transform: 'translate(-50%, -65%) rotate(-45deg)',
  } : undefined,
});
