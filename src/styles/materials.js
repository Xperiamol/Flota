/**
 * 全应用的材质与圆角规格。
 *
 * 主题在 createAppTheme 里把这里的结果挂到 theme.custom.material / theme.custom.radius，
 * 组件不要再手写 backdropFilter、半透明底色和高光边，统一用 glassSx(theme, '材质名')。
 *
 * 材质一览（从「最浮」到「最贴近内容」）：
 * - popover   菜单、弹出框、对话框、浮动工具栏
 * - floating  可拖动的浮窗（AI 小窗、筛选器、拖拽预览），比 popover 更透
 * - window    独立的小窗口（提醒、专注迷你窗），几乎不透明
 * - bar       盖在滚动内容上的横条（吸顶搜索栏、AI 建议条、多选工具栏）
 * - card      内容里的半透明卡片（时间轴条目、子任务列表）
 * - chip      浮在内容上的小徽标 / 小按钮（字数统计、复制按钮）
 * - scrim     模态框后面的遮罩
 */

// 模糊强度：数值越大越「浮」
export const BLUR = {
  subtle: 'blur(10px) saturate(150%)',
  medium: 'blur(16px) saturate(170%)',
  regular: 'blur(24px) saturate(165%)',
  strong: 'blur(28px) saturate(180%)',
  scrim: 'blur(4px)',
  // 只虚化按钮背后的一小圈内容，不改颜色（列表行内的悬停按钮）
  halo: 'blur(9px)',
  // 壁纸上的面板：大半径模糊 + 压低背景对比，浅色略提亮、深色略压暗（见 paneStyles）
  paneLight: 'blur(36px) saturate(160%) contrast(0.72) brightness(1.1)',
  paneDark: 'blur(36px) saturate(150%) contrast(0.72) brightness(0.82)',
}

// 圆角规格（px）。sx 里也可以写数字：1 / 1.5 / 2 = 8 / 12 / 16（主题 shape.borderRadius = 8）
// - sm：按钮、单行输入框、菜单项、列表里的小条目、标签
// - md：卡片、菜单 / 弹出框、多行输入区、笔记行
// - lg：外框面板、对话框、独立小窗口
// - pill：开关、头像、徽标
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
}

export const createMaterials = (isDark) => {
  const hairline = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(22,22,24,0.08)'
  const highlight = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 1px 0 rgba(255,255,255,0.75)'

  return {
    popover: {
      backgroundColor: isDark ? 'rgba(31,31,35,0.72)' : 'rgba(255,255,255,0.72)',
      backgroundImage: isDark
        ? 'linear-gradient(135deg, rgba(255,255,255,0.075), rgba(255,255,255,0) 48%, rgba(120,150,255,0.035))'
        : 'linear-gradient(135deg, rgba(255,255,255,0.52), rgba(255,255,255,0.06) 48%, rgba(120,150,255,0.025))',
      backdropFilter: BLUR.regular,
      border: isDark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.72)',
      boxShadow: isDark
        ? '0 12px 32px rgba(0,0,0,0.45)'
        : '0 12px 32px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.04)',
      // 半透明边框下不铺底色，边缘才不会发灰
      backgroundClip: 'padding-box',
    },
    floating: {
      backgroundColor: isDark ? 'rgba(38,38,42,0.62)' : 'rgba(255,255,255,0.58)',
      backgroundImage: 'none',
      backdropFilter: BLUR.strong,
      border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(255,255,255,0.7)',
      boxShadow: isDark ? '0 10px 30px rgba(0,0,0,0.32)' : '0 10px 30px rgba(20,20,24,0.10)',
    },
    window: {
      backgroundColor: isDark ? 'rgba(31,31,34,0.96)' : 'rgba(255,255,255,0.96)',
      backgroundImage: 'none',
      backdropFilter: BLUR.regular,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.13)' : 'rgba(22,22,24,0.10)'}`,
      boxShadow: highlight,
    },
    bar: {
      backgroundColor: isDark ? 'rgba(31,31,34,0.84)' : 'rgba(255,255,255,0.86)',
      backgroundImage: 'none',
      backdropFilter: BLUR.medium,
    },
    card: {
      backgroundColor: isDark ? 'rgba(31,31,34,0.82)' : 'rgba(255,255,255,0.92)',
      backgroundImage: 'none',
      backdropFilter: BLUR.subtle,
      border: `1px solid ${hairline}`,
      boxShadow: isDark ? '0 3px 12px rgba(0,0,0,0.16)' : '0 3px 12px rgba(22,22,24,0.05)',
    },
    chip: {
      backgroundColor: isDark ? 'rgba(31,31,34,0.6)' : 'rgba(255,255,255,0.7)',
      backgroundImage: 'none',
      backdropFilter: BLUR.subtle,
      border: `1px solid ${hairline}`,
    },
    scrim: {
      backgroundColor: isDark ? 'rgba(0,0,0,0.36)' : 'rgba(22,22,24,0.18)',
      backdropFilter: BLUR.scrim,
    },
    // 菜单比普通浮层多一层更深的投影
    menuShadow: isDark
      ? '0 18px 56px rgba(0,0,0,0.48), 0 4px 16px rgba(0,0,0,0.18)'
      : '0 18px 56px rgba(22,22,24,0.18), 0 4px 16px rgba(22,22,24,0.08)',
  }
}

const fallbackMaterials = { light: createMaterials(false), dark: createMaterials(true) }

/**
 * 某种材质的 sx 片段（底色、高光渐变、模糊、边框、投影）。
 * @param {object} theme MUI theme
 * @param {'popover'|'floating'|'window'|'bar'|'card'|'chip'|'scrim'} [kind]
 * @param {{ radius?: 'sm'|'md'|'lg'|'pill'|number, shadow?: 'menu'|'none' }} [options]
 */
export const glassSx = (theme, kind = 'popover', { radius, shadow } = {}) => {
  const materials = theme?.custom?.material || fallbackMaterials[theme?.palette?.mode === 'dark' ? 'dark' : 'light']
  const { backdropFilter, ...rest } = materials[kind] || materials.popover
  const sx = { ...rest, backdropFilter, WebkitBackdropFilter: backdropFilter }
  if (shadow === 'menu') sx.boxShadow = materials.menuShadow
  if (shadow === 'none') sx.boxShadow = 'none'
  if (radius != null) sx.borderRadius = radiusPx(radius)
  return sx
}

/** 圆角规格名 → px 字符串；数字当作 px，其他字符串（如 '50%'）原样返回 */
export const radiusPx = (radius) => {
  if (typeof radius === 'number') return `${radius}px`
  return radius in RADIUS ? `${RADIUS[radius]}px` : String(radius)
}

/**
 * 不方便拿到 theme 的地方（普通 sx 对象里展开）用这个：每个属性都是 (theme) => 值。
 * 例：sx={{ position: 'fixed', ...glassSxFor('popover', { radius: 'md', shadow: 'menu' }) }}
 */
export const glassSxFor = (kind = 'popover', options = {}) => {
  const keys = ['backgroundColor', 'backgroundImage', 'backdropFilter', 'WebkitBackdropFilter', 'border', 'boxShadow', 'backgroundClip']
  const sx = Object.fromEntries(keys.map((key) => [key, (theme) => glassSx(theme, kind, options)[key]]))
  if (options.radius != null) sx.borderRadius = radiusPx(options.radius)
  return sx
}
