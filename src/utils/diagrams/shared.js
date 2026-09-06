/**
 * 画布图表生成器共享工具
 * 提供颜色、文本测量、网格对齐、Excalidraw 元素工厂等基础能力
 */

export const DIAGRAM_THEME = {
  canvas: '#fcfcfd',
  text: '#243041',
  textSecondary: '#52627a',
  line: '#7c8aa5',
  lifeline: '#bcc6d8',
  labelBg: '#ffffff',
  semantics: {
    primary: { bg: '#dbeafe', stroke: '#2563eb' },
    success: { bg: '#dcfce7', stroke: '#16a34a' },
    warning: { bg: '#fef3c7', stroke: '#d97706' },
    danger: { bg: '#fee2e2', stroke: '#dc2626' },
    accent: { bg: '#ede9fe', stroke: '#7c3aed' },
    info: { bg: '#cffafe', stroke: '#0891b2' },
    neutral: { bg: '#eef2f7', stroke: '#5b6b82' },
  },
  depthPalette: [
    { bg: '#dbeafe', stroke: '#2563eb' },
    { bg: '#dcfce7', stroke: '#16a34a' },
    { bg: '#fef3c7', stroke: '#d97706' },
    { bg: '#fee2e2', stroke: '#dc2626' },
    { bg: '#ede9fe', stroke: '#7c3aed' },
    { bg: '#cffafe', stroke: '#0891b2' },
    { bg: '#fce7f3', stroke: '#db2777' },
    { bg: '#d1fae5', stroke: '#0f766e' },
  ],
}

export const BEAUTIFY_GRID = 8
export const WRAP_CHUNK_CHINESE = 7
export const WRAP_CHUNK_LATIN = 14

export const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

export const randomSeed = () => Math.floor(Math.random() * 2000000000)

export const snapToGrid = (value, size = BEAUTIFY_GRID) => Math.round(value / size) * size

export const containsCJK = (text = '') => /[\u4e00-\u9fa5]/.test(text)

export const normalizeWhitespace = (text = '') => String(text).replace(/\s+/g, ' ').trim()

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
// 画布底色恒为浅色，LLM 有时会按"深色主题"思路输出近白/浅色文字 → 浅底浅字不可见。
// 这里在引擎层兜底：按文字与其背景的对比度，必要时换成深色或白色，保证始终能看清。
const _parseHex = (c) => {
  if (typeof c !== 'string') return null
  let s = c.trim().toLowerCase()
  if (s === 'white') s = '#ffffff'
  if (s === 'black') s = '#000000'
  const m3 = /^#([0-9a-f]{3})$/.exec(s)
  if (m3) return [0, 1, 2].map((i) => parseInt(m3[1][i] + m3[1][i], 16))
  const m6 = /^#([0-9a-f]{6})$/.exec(s)
  if (m6) return [0, 2, 4].map((i) => parseInt(m6[1].slice(i, i + 2), 16))
  return null
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
  const back = _parseHex(bg) || _parseHex(DIAGRAM_THEME.canvas)
  const fg = _parseHex(color)
  const darkOnLight = _relLum(back) > 0.5
  if (!fg) return darkOnLight ? DIAGRAM_THEME.text : '#ffffff'
  if (_contrast(fg, back) >= 2.6) return color
  return darkOnLight ? DIAGRAM_THEME.text : '#ffffff'
}

export const wrapLabel = (text, maxChars = null) => {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return ''
  const chunk = maxChars || (containsCJK(normalized) ? WRAP_CHUNK_CHINESE : WRAP_CHUNK_LATIN)
  if (normalized.length <= chunk) return normalized
  const useChars = containsCJK(normalized)
  const tokens = useChars ? [...normalized] : normalized.split(' ')
  const lines = []
  let current = ''
  for (const word of tokens) {
    const next = useChars ? `${current}${word}` : (current ? `${current} ${word}` : word)
    if (next.length > chunk && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines.join('\n')
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

export const makeText = ({ x, y, text, fontSize = 16, color, align = 'center', verticalAlign = 'middle', metrics, containerId = null, fontFamily = 1, bg = null }) => {
  const wrapped = String(text || '')
  const m = metrics || measureTextBlock(wrapped, fontSize)
  const safeColor = ensureReadableTextColor(color || DIAGRAM_THEME.text, bg || DIAGRAM_THEME.canvas)
  return {
    ...makeBase('text'),
    x: snapToGrid(x),
    y: snapToGrid(y),
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

export const makeRect = ({ x, y, width, height, bg, stroke, strokeWidth = 1, rounded = true, dashed = false }) => ({
  ...makeBase('rectangle'),
  x: snapToGrid(x),
  y: snapToGrid(y),
  width: snapToGrid(width),
  height: snapToGrid(height),
  backgroundColor: bg || 'transparent',
  strokeColor: stroke || DIAGRAM_THEME.line,
  strokeWidth,
  strokeStyle: dashed ? 'dashed' : 'solid',
  roughness: 0,
  roundness: rounded ? { type: 3 } : null,
})

export const makeEllipse = ({ x, y, width, height, bg, stroke, strokeWidth = 1 }) => ({
  ...makeBase('ellipse'),
  x: snapToGrid(x),
  y: snapToGrid(y),
  width: snapToGrid(width),
  height: snapToGrid(height),
  backgroundColor: bg || 'transparent',
  strokeColor: stroke || DIAGRAM_THEME.line,
  strokeWidth,
  roughness: 0,
})

export const makeDiamond = ({ x, y, width, height, bg, stroke, strokeWidth = 1 }) => ({
  ...makeBase('diamond'),
  x: snapToGrid(x),
  y: snapToGrid(y),
  width: snapToGrid(width),
  height: snapToGrid(height),
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
    x: snapToGrid(x),
    y: snapToGrid(y),
    width: Math.max(...xs) - Math.min(...xs) || 0,
    height: Math.max(...ys) - Math.min(...ys) || 0,
    points: points.map(([px, py]) => [snapToGrid(px), snapToGrid(py)]),
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
}) => {
  // 最后一道护栏：任何 NaN/Infinity 坐标都会让 Excalidraw 生成 `<path d="MNaN…">` 直接崩溃。
  // 这里把所有点钳成有限数，保证渲染层永不收到非法坐标。
  const fin = (v) => (Number.isFinite(v) ? v : 0)
  const safePoints = (Array.isArray(points) ? points : [[0, 0]]).map((p) => [fin(p?.[0]), fin(p?.[1])])
  const xs = safePoints.map((p) => p[0])
  const ys = safePoints.map((p) => p[1])
  return {
    ...makeBase('arrow'),
    x: snapToGrid(fin(x)),
    y: snapToGrid(fin(y)),
    width: Math.max(...xs) - Math.min(...xs) || 0,
    height: Math.max(...ys) - Math.min(...ys) || 0,
    points: safePoints.map(([px, py]) => [snapToGrid(px), snapToGrid(py)]),
    strokeColor: stroke || DIAGRAM_THEME.line,
    strokeWidth,
    strokeStyle: dashed ? 'dashed' : 'solid',
    roughness: 0,
    lastCommittedPoint: null,
    startBinding,
    endBinding,
    startArrowhead: null,
    endArrowhead: endArrow,
  }
}

export const palette = (depth = 0) => DIAGRAM_THEME.depthPalette[depth % DIAGRAM_THEME.depthPalette.length]

export const beautifyElements = (elements = []) => elements.map((el) => {
  const next = { ...el }
  if (typeof next.x === 'number') next.x = snapToGrid(next.x)
  if (typeof next.y === 'number') next.y = snapToGrid(next.y)
  // 文本尺寸来自真实字形测量，不能再吸附网格；四舍五入会把边界缩小，
  // 向上吸附整个网格又会制造明显空白，两者都会让选框与文字不一致。
  if (typeof next.width === 'number') {
    next.width = next.type === 'text'
      ? Math.max(1, Math.ceil(next.width))
      : snapToGrid(next.width)
  }
  if (typeof next.height === 'number') {
    next.height = next.type === 'text'
      ? Math.max(1, Math.ceil(next.height))
      : snapToGrid(next.height)
  }
  if (Array.isArray(next.points)) {
    next.points = next.points.map(([x, y]) => [snapToGrid(x), snapToGrid(y)])
  }
  return next
})

export const computeOffset = (existingElements = [], padX = 150, padY = 100) => {
  if (!existingElements.length) return { offsetX: 100, offsetY: 100 }
  const maxX = Math.max(...existingElements.map((e) => (e.x ?? 0) + (e.width ?? 0)))
  return { offsetX: maxX + padX, offsetY: padY }
}
