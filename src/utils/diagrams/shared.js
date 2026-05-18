/**
 * 白板图表生成器共享工具
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
  const lines = String(text || '').split('\n').filter(Boolean)
  const measured = lines.length > 0 ? lines : ['']
  let width = 0
  for (const line of measured) {
    let lineWidth = 0
    for (const ch of [...line]) {
      lineWidth += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.58
    }
    width = Math.max(width, lineWidth)
  }
  return {
    width: Math.max(width + 26, 80),
    height: Math.max(measured.length * fontSize * 1.45 + 18, fontSize * 1.5 + 16),
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

export const makeText = ({ x, y, text, fontSize = 16, color, align = 'center', verticalAlign = 'middle', metrics }) => {
  const wrapped = String(text || '')
  const m = metrics || measureTextBlock(wrapped, fontSize)
  return {
    ...makeBase('text'),
    x: snapToGrid(x),
    y: snapToGrid(y),
    width: m.width,
    height: m.height,
    text: wrapped,
    fontSize,
    fontFamily: 1,
    textAlign: align,
    verticalAlign,
    baseline: fontSize,
    containerId: null,
    originalText: wrapped,
    lineHeight: 1.25,
    strokeColor: color || DIAGRAM_THEME.text,
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

export const makeArrow = ({ x, y, points, stroke, strokeWidth = 2, dashed = false, endArrow = 'arrow' }) => {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    ...makeBase('arrow'),
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
    endArrowhead: endArrow,
  }
}

export const palette = (depth = 0) => DIAGRAM_THEME.depthPalette[depth % DIAGRAM_THEME.depthPalette.length]

export const beautifyElements = (elements = []) => elements.map((el) => {
  const next = { ...el }
  if (typeof next.x === 'number') next.x = snapToGrid(next.x)
  if (typeof next.y === 'number') next.y = snapToGrid(next.y)
  if (typeof next.width === 'number') next.width = snapToGrid(next.width)
  if (typeof next.height === 'number') next.height = snapToGrid(next.height)
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
