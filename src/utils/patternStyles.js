/**
 * 主题壁纸 - 几何花纹背景样式定义
 * 内置到应用设置-外观中
 */

export const PATTERN_STYLES = {
  dots: {
    name: '圆点',
    css: `
      background-image: radial-gradient(circle, rgba(99, 102, 241, 0.06) 1px, transparent 1px);
      background-size: 20px 20px;
    `
  },
  grid: {
    name: '网格',
    css: `
      background-image: 
        linear-gradient(rgba(99, 102, 241, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(99, 102, 241, 0.04) 1px, transparent 1px);
      background-size: 30px 30px;
    `
  },
  waves: {
    name: '波浪',
    css: `
      background-image: 
        radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(99, 102, 241, 0.03) 60%),
        radial-gradient(ellipse at 50% 50%, rgba(99, 102, 241, 0.02) 0%, transparent 50%);
      background-size: 50px 50px;
      background-position: 0 0, 25px 25px;
    `
  }
}

/**
 * 将十六进制颜色转换为 RGB
 */
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 99, g: 102, b: 241 }
}

/**
 * 生成花纹 CSS，替换颜色为主题色并应用透明度
 * @param {string} patternId - 花纹ID: 'none' | 'dots' | 'grid' | 'waves' | 'custom'
 * @param {string} primaryColor - 主题色 hex
 * @param {number} opacity - 透明度倍率 0-2
 * @param {string} wallpaperUrl - 壁纸 app:// URL（仅 custom 模式）
 */
export function generatePatternCSS(patternId, primaryColor, opacity, wallpaperUrl) {
  if (patternId === 'none') return ''

  // 自定义壁纸 - 使用 app:// 协议URL
  if (patternId === 'custom' && wallpaperUrl) {
    return `
      body::before {
        content: '';
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-image: url('${wallpaperUrl}');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        opacity: ${Math.max(0, Math.min(1, opacity))};
        pointer-events: none;
        z-index: 0;
      }
      #root { position: relative; z-index: 1; }
    `
  }

  const style = PATTERN_STYLES[patternId]
  if (!style) return ''

  const rgb = hexToRgb(primaryColor)
  let css = style.css.trim()

  // 替换硬编码颜色为主题色，并应用透明度
  css = css.replace(/rgba\(99,\s*102,\s*241,\s*([\d.]+)\)/g, (_, alpha) => {
    const newAlpha = parseFloat(alpha) * opacity
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha.toFixed(3)})`
  })

  return `
    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      ${css}
      background-attachment: fixed;
      pointer-events: none;
      z-index: 0;
    }
    #root { position: relative; z-index: 1; }
  `
}
