/**
 * 通用样式常量 - 统一管理组件间重复的 sx 样式
 * 减少样式碎片化，提高可维护性
 */

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
  borderRadius: '16px',
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(30,41,59,0.84)'
    : 'rgba(255,255,255,0.9)',
  border: '1px solid',
  borderColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(148,163,184,0.16)'
    : 'rgba(15,23,42,0.08)',
  boxShadow: muiTheme.palette.mode === 'dark'
    ? '0 8px 24px rgba(0,0,0,0.18)'
    : '0 8px 24px rgba(15,23,42,0.055)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
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
  border: '1px solid',
  borderColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(148,163,184,0.14)'
    : 'rgba(15,23,42,0.08)',
  backgroundColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(30,41,59,0.78)'
    : 'rgba(255,255,255,0.86)',
  boxShadow: muiTheme.palette.mode === 'dark'
    ? '0 3px 12px rgba(0,0,0,0.16)'
    : '0 3px 12px rgba(15,23,42,0.045)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  transition: 'border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease',
  '&:hover': {
    borderColor: muiTheme.palette.mode === 'dark'
      ? 'rgba(148,163,184,0.34)'
      : 'rgba(15,23,42,0.18)',
    backgroundColor: muiTheme.palette.mode === 'dark'
      ? 'rgba(30,41,59,0.9)'
      : 'rgba(255,255,255,0.96)',
    boxShadow: muiTheme.palette.mode === 'dark'
      ? '0 6px 18px rgba(0,0,0,0.2)'
      : '0 6px 18px rgba(15,23,42,0.075)',
  },
});

// ========== 现代界面基础面板 ==========
export const modernSurfaceSx = (muiTheme) => ({
  borderRadius: '14px',
  border: '1px solid',
  borderColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(148,163,184,0.14)'
    : 'rgba(15,23,42,0.08)',
  background: muiTheme.palette.mode === 'dark'
    ? 'rgba(30,41,59,0.7)'
    : 'rgba(255,255,255,0.84)',
  boxShadow: muiTheme.palette.mode === 'dark'
    ? '0 2px 10px rgba(0,0,0,0.14)'
    : '0 2px 10px rgba(15,23,42,0.04)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
});

export const sectionHeaderSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  mb: 1.5,
};

export const sectionTitleSx = {
  fontWeight: 700,
  letterSpacing: '-0.01em',
};

export const sectionDescriptionSx = {
  display: 'block',
  mt: 0.25,
  color: 'text.secondary',
};

export const segmentedControlSx = (muiTheme) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  p: '3px',
  borderRadius: '10px',
  border: '1px solid',
  borderColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(148,163,184,0.14)'
    : 'rgba(15,23,42,0.08)',
  backgroundColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(255,255,255,0.055)'
    : 'rgba(15,23,42,0.045)',
});

export const segmentedButtonSx = (active) => (muiTheme) => ({
  px: 1.5,
  py: 0.4,
  minWidth: 0,
  borderRadius: '7px',
  border: '1px solid transparent',
  textTransform: 'none',
  lineHeight: 1.5,
  fontSize: '0.78rem',
  fontWeight: 650,
  letterSpacing: '0.01em',
  transition: 'background-color 180ms cubic-bezier(0.32,0.72,0,1), color 180ms cubic-bezier(0.32,0.72,0,1), box-shadow 180ms cubic-bezier(0.32,0.72,0,1)',
  ...(active ? {
    bgcolor: muiTheme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.105)'
      : 'rgba(255,255,255,0.82)',
    color: muiTheme.palette.text.primary,
    borderColor: muiTheme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.1)'
      : 'rgba(15,23,42,0.09)',
    backgroundImage: 'none',
    boxShadow: muiTheme.palette.mode === 'dark'
      ? '0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)'
      : '0 1px 4px rgba(15,23,42,0.07), inset 0 1px 0 rgba(255,255,255,0.8)',
    '&:hover': {
      bgcolor: muiTheme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.13)'
        : 'rgba(255,255,255,0.94)',
    },
  } : {
    color: muiTheme.palette.text.secondary,
    bgcolor: 'transparent',
    '&:hover': {
      bgcolor: muiTheme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(15,23,42,0.055)',
      color: muiTheme.palette.text.primary,
    },
  }),
});

export const emptyStateSx = (muiTheme) => ({
  ...modernSurfaceSx(muiTheme),
  p: 4,
  textAlign: 'center',
  color: muiTheme.palette.text.secondary,
});

export const settingsSectionSx = (muiTheme) => ({
  ...modernSurfaceSx(muiTheme),
  p: 2,
  mb: 2,
});

export const settingsRowSx = (muiTheme) => ({
  px: 2,
  py: 1.5,
  mb: 1,
  borderRadius: '10px',
  border: '1px solid',
  borderColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(148,163,184,0.10)'
    : 'rgba(15,23,42,0.06)',
  bgcolor: muiTheme.palette.mode === 'dark'
    ? 'rgba(255,255,255,0.025)'
    : 'rgba(255,255,255,0.58)',
  transition: 'background-color 180ms cubic-bezier(0.32,0.72,0,1), border-color 180ms cubic-bezier(0.32,0.72,0,1)',
  '&:hover': {
    bgcolor: muiTheme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.045)'
      : 'rgba(255,255,255,0.76)',
    borderColor: muiTheme.palette.mode === 'dark'
      ? 'rgba(148,163,184,0.18)'
      : 'rgba(15,23,42,0.10)',
  },
});

export const settingsFieldGroupSx = (muiTheme) => ({
  ...settingsRowSx(muiTheme),
  display: 'block',
  '&:hover': {
    bgcolor: muiTheme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.035)'
      : 'rgba(255,255,255,0.72)',
    borderColor: muiTheme.palette.mode === 'dark'
      ? 'rgba(148,163,184,0.14)'
      : 'rgba(15,23,42,0.08)',
  },
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
  backgroundColor: muiTheme.palette.mode === 'dark'
    ? 'rgba(15,23,42,0.42)'
    : 'rgba(248,251,255,0.72)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
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
    ? `0 0 0 2px ${isDark ? '#0f172a' : '#ffffff'}, 0 0 0 4px ${alpha(color, 0.55)}, 0 4px 14px ${alpha(color, 0.32)}`
    : `inset 0 0 0 1px ${alpha('#000', isDark ? 0.35 : 0.10)}, 0 1px 2px ${alpha('#000', isDark ? 0.32 : 0.06)}`,
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: selected
      ? `0 0 0 2px ${isDark ? '#0f172a' : '#ffffff'}, 0 0 0 4px ${alpha(color, 0.65)}, 0 6px 18px ${alpha(color, 0.36)}`
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
