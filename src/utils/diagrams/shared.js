/**
 * 画布图表生成器共享工具
 * 提供颜色、文本测量、网格对齐、Excalidraw 元素工厂等基础能力
 */

export const DIAGRAM_THEME = {
  canvas: '#f8fafc',
  text: '#172033',
  textSecondary: '#64748b',
  line: '#94a3b8',
  border: '#dce3ed',
  surface: '#ffffff',
  lifeline: '#cbd5e1',
  labelBg: '#ffffff',
  semantics: {
    primary: { bg: '#eef2ff', stroke: '#4f46e5' },
    success: { bg: '#ecfdf5', stroke: '#047857' },
    warning: { bg: '#fffbeb', stroke: '#b45309' },
    danger: { bg: '#fff1f2', stroke: '#be123c' },
    accent: { bg: '#faf5ff', stroke: '#7e22ce' },
    info: { bg: '#ecfeff', stroke: '#0e7490' },
    neutral: { bg: '#f8fafc', stroke: '#64748b' },
  },
  depthPalette: [
    { bg: '#eef2ff', stroke: '#4f46e5' },
    { bg: '#ecfdf5', stroke: '#047857' },
    { bg: '#fffbeb', stroke: '#b45309' },
    { bg: '#faf5ff', stroke: '#7e22ce' },
    { bg: '#ecfeff', stroke: '#0e7490' },
    { bg: '#fff1f2', stroke: '#be123c' },
  ],
}

export const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

export const randomSeed = () => Math.floor(Math.random() * 2000000000)

let textMeasureContext = null

const getTextMeasureContext = () => {
  if (textMeasureContext) return textMeasureContext
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  textMeasureContext = canvas.getContext('2d')
  return textMeasureContext
}

// 与 AI 画布最终使用的 Helvetica/Arial 无衬线字体保持一致。Canvas 不可用时才回退字符估算。
export const measureTextWidth = (text, fontSize = 16) => {
  const value = String(text || '')
  const context = getTextMeasureContext()
  if (context) {
    context.font = `${fontSize}px Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif`
    return context.measureText(value).width
  }
  let width = 0
  for (const char of [...value]) {
    if (/\s/.test(char)) width += fontSize * 0.33
    else if (char.charCodeAt(0) > 255) width += fontSize
    else if (/[MW@#%&]/.test(char)) width += fontSize * 0.82
    else if (/[ilI1.,'`]/.test(char)) width += fontSize * 0.3
    else width += fontSize * 0.56
  }
  return width
}

// 按实际像素宽度换行，同时保留用户/模型给出的显式换行。英文优先在空格处断行，
// 中日韩文字可逐字断行，避免“整段含一个中文字符就把所有英文当全角字”的过度换行。
// 行首禁则（不能出现在行首的标点）与行尾禁则（不能留在行尾的开括号/引号）
const NO_LINE_START = new Set([...'，。、；：！？）】》」』”’…—,.;:!?)]}%'])
const NO_LINE_END = new Set([...'（【《「『“‘([{'])

export const wrapTextToWidth = (text, maxWidth, fontSize = 16) => {
  const source = String(text ?? '')
  const limit = Number.isFinite(maxWidth) ? Math.max(fontSize * 4, maxWidth) : Infinity
  if (!source || limit === Infinity) return source

  const output = []
  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/[\t ]+/g, ' ').trim()
    if (!line) {
      output.push('')
      continue
    }
    let current = ''
    for (const char of [...line]) {
      const candidate = current + char
      if (current && measureTextWidth(candidate, fontSize) > limit) {
        const breakAt = current.lastIndexOf(' ')
        if (breakAt > 0) {
          output.push(current.slice(0, breakAt).trimEnd())
          current = `${current.slice(breakAt + 1)}${char}`.trimStart()
        } else if ((NO_LINE_START.has(char) || NO_LINE_END.has([...current].pop())) && [...current].length > 1) {
          // 中文避头尾：标点不出现在行首、开括号不留在行尾——把上一行最后一个字一起带到下一行。
          const chars = [...current]
          // 连续标点（如「）。」）要一起带走，直到上一行末尾是普通字符
          let carry = 1
          while (carry < chars.length - 1 && NO_LINE_START.has(chars[chars.length - carry])) carry++
          output.push(chars.slice(0, -carry).join(''))
          current = chars.slice(-carry).join('') + char
        } else {
          output.push(current)
          current = char.trimStart()
        }
      } else {
        current = candidate
      }
    }
    output.push(current.trimEnd())
  }
  return output.join('\n')
}

// ─── 文字可读性护栏 ──────────────────────────────────
// 原生形状使用可移植的纯色；渐变应使用 SVG。渲染与对比度检查必须理解同一种颜色。
export const normalizeDiagramColor = (value) => {
  if (typeof value !== 'string') return null
  let color = value.trim().toLowerCase()
  if (color === 'transparent') return color
  if (color === 'white') color = '#ffffff'
  if (color === 'black') color = '#000000'
  if (/^#[0-9a-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(c => c + c).join('')
  if (/^#[0-9a-f]{6}$/.test(color)) return color
  // rgb(15, 23, 42) and rgb(15 23 42), including percentage channels.
  const rgb = /^rgb\(\s*([^()]+)\s*\)$/.exec(color)
  if (!rgb) return null
  const parts = rgb[1].trim().split(/\s*,\s*|\s+/)
  if (parts.length !== 3 || parts.some(part => !/^\d+(?:\.\d+)?%?$/.test(part))) return null
  const channels = parts.map(part => Number.parseFloat(part) * (part.endsWith('%') ? 2.55 : 1))
  if (channels.some(channel => channel < 0 || channel > 255)) return null
  return '#' + channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')
}
export const coerceDiagramColor = (value, fallback = null) => {
  const normalized = normalizeDiagramColor(value)
  if (normalized) return normalized
  // Legacy Composer scenes may contain CSS gradients. Excalidraw treats these
  // as invalid canvas colors and paints the shape black; keep the first solid
  // stop as a deterministic, editable fallback until SVG gradients are used.
  if (typeof value === 'string' && /^(?:linear|radial)-gradient\(/i.test(value.trim())) {
    const stop = value.match(/#[0-9a-f]{3,8}/i)?.[0]
    if (stop) return normalizeDiagramColor(stop)
  }
  return fallback
}

const _parseColor = (color) => {
  const hex = normalizeDiagramColor(color)
  return hex && hex !== 'transparent' ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : null
}
const _relLum = ([r, g, b]) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const _contrast = (a, b) => {
  const la = _relLum(a), lb = _relLum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
export const ensureReadableTextColor = (color, bg = DIAGRAM_THEME.canvas) => {
  const back = _parseColor(bg) || _parseColor(DIAGRAM_THEME.canvas)
  const fg = _parseColor(color)
  if (fg && _contrast(fg, back) >= 4.5) return normalizeDiagramColor(color)
  if (_contrast(_parseColor(DIAGRAM_THEME.text), back) >= 4.5) return DIAGRAM_THEME.text
  // 中间亮度底色也要满足 4.5:1，不能简单按亮/暗阈值选白字。
  return _contrast([0, 0, 0], back) > _contrast([255, 255, 255], back) ? '#000000' : '#ffffff'
}

export const measureTextBlock = (text, fontSize = 16) => {
  const measured = String(text ?? '').split('\n')
  const lineHeight = 1.25
  const width = measured.reduce((max, line) => Math.max(max, measureTextWidth(line, fontSize)), 0)
  return {
    // 文本元素自身只记录真实字形尺寸；留白由 card/group/callout 等容器负责。
    // 旧实现把 26px/18px 内边距塞进文本框，导致选框与布局尺寸都失真。
    width: Math.max(1, Math.ceil(width) + 2),
    height: Math.max(fontSize * lineHeight, Math.ceil(measured.length * fontSize * lineHeight)),
    lines: measured.length,
  }
}

export const makeBase = (type) => ({
  id: generateId(),
  type,
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 1,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: type === 'arrow' || type === 'line' ? { type: 2 } : { type: 3 },
  seed: randomSeed(),
  version: 1,
  versionNonce: randomSeed(),
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
})

export const makeText = ({ x, y, text, fontSize = 16, color, align = 'center', verticalAlign = 'middle', metrics, containerId = null, fontFamily = 2, bg = null }) => {
  const wrapped = String(text || '')
  const m = metrics || measureTextBlock(wrapped, fontSize)
  const safeColor = ensureReadableTextColor(color || DIAGRAM_THEME.text, bg || DIAGRAM_THEME.canvas)
  return {
    ...makeBase('text'),
    x,
    y,
    width: m.width,
    height: m.height,
    text: wrapped,
    fontSize,
    fontFamily,
    textAlign: align,
    verticalAlign,
    baseline: fontSize,
    containerId,
    originalText: wrapped,
    lineHeight: 1.25,
    autoResize: true,
    strokeColor: safeColor,
    backgroundColor: 'transparent',
    roundness: null,
  }
}

// radius：圆角像素（Excalidraw 自适应圆角，短边很小时按 25% 收小）；不传沿用 Excalidraw 默认 32
export const makeRect = ({ x, y, width, height, bg, stroke, strokeWidth = 1, rounded = true, dashed = false, radius }) => ({
  ...makeBase('rectangle'),
  x,
  y,
  width,
  height,
  backgroundColor: bg || 'transparent',
  strokeColor: stroke || DIAGRAM_THEME.line,
  strokeWidth,
  strokeStyle: dashed ? 'dashed' : 'solid',
  roughness: 0,
  roundness: !rounded || radius === 0 ? null : (Number.isFinite(radius) ? { type: 3, value: radius } : { type: 3 }),
})

export const makeEllipse = ({ x, y, width, height, bg, stroke, strokeWidth = 1 }) => ({
  ...makeBase('ellipse'),
  x,
  y,
  width,
  height,
  backgroundColor: bg || 'transparent',
  strokeColor: stroke || DIAGRAM_THEME.line,
  strokeWidth,
  roughness: 0,
})

export const makeLine = ({ x, y, points, stroke, strokeWidth = 1, dashed = false }) => {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    ...makeBase('line'),
    x,
    y,
    width: Math.max(...xs) - Math.min(...xs) || 0,
    height: Math.max(...ys) - Math.min(...ys) || 0,
    points: points.map(([px, py]) => [px, py]),
    strokeColor: stroke || DIAGRAM_THEME.line,
    strokeWidth,
    strokeStyle: dashed ? 'dashed' : 'solid',
    roughness: 0,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  }
}

export const makeArrow = ({
  x,
  y,
  points,
  stroke,
  strokeWidth = 2,
  dashed = false,
  endArrow = 'arrow',
  startBinding = null,
  endBinding = null,
  rounded = true,
}) => {
  // 最后一道护栏：任何 NaN/Infinity 坐标都会让 Excalidraw 生成 `<path d="MNaN…">` 直接崩溃。
  // 这里把所有点钳成有限数，保证渲染层永不收到非法坐标。
  const fin = (v) => (Number.isFinite(v) ? v : 0)
  const safePoints = (Array.isArray(points) ? points : [[0, 0]]).map((p) => [fin(p?.[0]), fin(p?.[1])])
  const xs = safePoints.map((p) => p[0])
  const ys = safePoints.map((p) => p[1])
  return {
    ...makeBase('arrow'),
    x: fin(x),
    y: fin(y),
    width: Math.max(...xs) - Math.min(...xs) || 0,
    height: Math.max(...ys) - Math.min(...ys) || 0,
    points: safePoints.map(([px, py]) => [px, py]),
    strokeColor: stroke || DIAGRAM_THEME.line,
    strokeWidth,
    strokeStyle: dashed ? 'dashed' : 'solid',
    roughness: 0,
    lastCommittedPoint: null,
    startBinding,
    endBinding,
    startArrowhead: null,
    endArrowhead: endArrow,
    // rounded=false 时用直角折线；rounded=true 由调用方（模型的 curve 选项）显式要求曲线。
    roundness: rounded ? { type: 2 } : null,
  }
}

export const palette = (depth = 0) => DIAGRAM_THEME.depthPalette[depth % DIAGRAM_THEME.depthPalette.length]

// Layout already establishes relationships. Validate geometry without shifting elements onto a different grid.
export const beautifyElements = (elements = []) => elements.map(el => {
  const next = { ...el }
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(next[key])) throw new Error(`画布元素 ${el.id} 的 ${key} 无效`)
    next[key] = key === 'width' || key === 'height' ? Math.max(0, next[key]) : next[key]
  }
  return next
})

export const computeOffset = (existingElements = [], padX = 150, padY = 100) => {
  if (!existingElements.length) return { offsetX: 100, offsetY: 100 }
  const maxX = Math.max(...existingElements.map((e) => (e.x ?? 0) + (e.width ?? 0)))
  return { offsetX: maxX + padX, offsetY: padY }
}
