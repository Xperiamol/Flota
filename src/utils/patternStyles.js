/** 本地材质纹理；保留背景设置键，兼容旧版本的几何背景。 */
export const TEXTURE_STYLES = {
  leather: { name: '细纹皮革', detail: '温润 · 压纹', light: '#d3bba2', dark: '#392e27', frequency: '.055', seed: 8, relief: true },
  steel: { name: '拉丝钢', detail: '冷调 · 金属光泽', light: '#cdd3d8', dark: '#353d46', frequency: '.012 .75', seed: 3 },
  paper: { name: '棉质纸', detail: '柔和 · 纤维颗粒', light: '#f1ece1', dark: '#302e29', frequency: '.7', seed: 2 },
  linen: { name: '天然亚麻', detail: '细密 · 交织肌理', light: '#ded7c8', dark: '#37352f', frequency: '.45', seed: 5 },
  frost: { name: '磨砂玻璃', detail: '清透 · 雾面微粒', light: '#dce6ea', dark: '#29353c', frequency: '.9', seed: 11 },
  carbon: { name: '碳纤维', detail: '深邃 · 精密编织', light: '#727b82', dark: '#21262b', frequency: '.6', seed: 7 },
}

const legacyTextures = { dots: 'paper', grid: 'steel', waves: 'leather', cross: 'linen', isometric: 'carbon', orbit: 'frost', contour: 'leather', arcTiles: 'paper' }
export const normalizeTextureId = id => legacyTextures[id] || id

export function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return match ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) } : { r: 99, g: 102, b: 241 }
}

// SVG 在设备上生成静态颗粒，不下载图片、不运行逐帧滤镜。
const grainImage = (texture, strength) => {
  const relief = texture.relief ? '<feDiffuseLighting surfaceScale="2.2" diffuseConstant="1.1" lighting-color="white"><feDistantLight azimuth="225" elevation="48"/></feDiffuseLighting>' : '<feColorMatrix type="saturate" values="0"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="${texture.frequency}" numOctaves="3" seed="${texture.seed}" stitchTiles="stitch"/>${relief}</filter><rect width="100%" height="100%" filter="url(#grain)" opacity="${Math.min(.7, .22 * strength).toFixed(3)}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export function getPatternBackgroundStyle(textureId, primaryColor, strength = 1, mode = 'light') {
  const id = normalizeTextureId(textureId)
  const texture = TEXTURE_STYLES[id]
  if (!texture) return {}
  const dark = mode === 'dark'
  const { r, g, b } = hexToRgb(primaryColor)
  const tint = `rgba(${r}, ${g}, ${b}, ${(Math.min(strength, 2) * .035).toFixed(3)})`
  const grain = grainImage(texture, strength)
  const light = dark ? '.08' : '.38'
  const layers = {
    leather: [grain, `linear-gradient(135deg, rgba(255,255,255,${light}), transparent 45%, rgba(0,0,0,.13))`],
    steel: [grain, `linear-gradient(105deg, transparent 5%, rgba(255,255,255,${light}) 28%, rgba(0,0,0,.09) 49%, rgba(255,255,255,${light}) 67%, transparent 92%)`],
    paper: [grain, 'linear-gradient(110deg, rgba(255,255,255,.08), transparent)'],
    linen: [grain, 'repeating-linear-gradient(0deg, rgba(255,255,255,.12) 0 1px, transparent 1px 3px)', 'repeating-linear-gradient(90deg, rgba(0,0,0,.045) 0 1px, transparent 1px 3px)'],
    frost: [grain, `radial-gradient(ellipse at 20% 10%, rgba(255,255,255,${light}), transparent 65%)`, 'radial-gradient(ellipse at 90% 90%, rgba(90,140,160,.09), transparent 70%)'],
    carbon: [grain, 'repeating-linear-gradient(45deg, rgba(0,0,0,.17) 0 2px, transparent 2px 6px)', 'repeating-linear-gradient(135deg, rgba(255,255,255,.1) 0 2px, transparent 2px 6px)'],
  }
  return {
    backgroundColor: dark ? texture.dark : texture.light,
    backgroundImage: [...layers[id], `linear-gradient(${tint}, ${tint})`].join(', '),
    backgroundSize: ['256px 256px', ...layers[id].slice(1).map(() => 'auto'), 'auto'].join(', '),
    opacity: Math.max(0, Math.min(1, strength)),
  }
}

/** 背景设置沿用原有接口；mode 保证材质适配明暗主题。 */
export function generatePatternCSS(textureId, primaryColor, strength = 1, wallpaperUrl, mode = 'light') {
  if (!textureId || textureId === 'none') return ''
  const style = textureId === 'custom' && wallpaperUrl ? {
    backgroundImage: `url('${wallpaperUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', opacity: Math.max(0, Math.min(1, strength)),
  } : getPatternBackgroundStyle(textureId, primaryColor, strength, mode)
  if (!Object.keys(style).length) return ''
  const css = Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${value};`).join('\n')
  return `body::before { content: ''; position: fixed; inset: 0; ${css} pointer-events: none; z-index: 0; } #root { position: relative; z-index: 1; }`
}
