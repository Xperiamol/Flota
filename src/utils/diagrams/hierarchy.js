import {
  containsCJK,
  DIAGRAM_THEME,
  makeArrow,
  makeRect,
  makeText,
  measureTextBlock,
  palette,
  wrapLabel,
} from './shared'

const NODE_MIN_W = 156
const NODE_MIN_H = 58
const PAD_X = 40
const PAD_Y = 32
const GAP_Y = 28
const LEVEL_W = 228

const normalizeDsl = (dsl = '') => String(dsl || '')
  .replace(/\r/g, '')
  .split('\n')
  .map((line) => line.replace(/\t/g, '  '))

export const parseHierarchyDsl = (dsl) => {
  const lines = normalizeDsl(dsl)
    .map((raw) => {
      const trimmed = raw.trim()
      if (!trimmed) return null
      if (/^hierarchy$/i.test(trimmed)) return null
      return raw
    })
    .filter(Boolean)

  if (lines.length === 0) {
    return { id: 'root', label: '层级图', children: [] }
  }

  const nodes = []
  let autoId = 0
  for (const raw of lines) {
    const indent = raw.match(/^\s*/)?.[0]?.length || 0
    const level = Math.floor(indent / 2)
    const label = raw.trim()
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^#{1,6}\s+/, '')
      .trim()
    if (!label) continue
    nodes.push({
      id: `h-${autoId++}`,
      label,
      level,
      children: [],
    })
  }

  if (nodes.length === 0) {
    return { id: 'root', label: '层级图', children: [] }
  }

  const root = nodes[0]
  root.level = 0
  const stack = [root]
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i]
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop()
    }
    const parent = stack[stack.length - 1] || root
    node.level = Math.max(1, parent.level + 1)
    parent.children.push(node)
    stack.push(node)
  }
  return root
}

const sanitizeNodeId = (label = '', fallback = 'node') => {
  const base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
    .replace(/^_+|_+$/g, '')
  return base || fallback
}

const mermaidLabel = (label = '') => String(label || '')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '<br/>')

export const hierarchyDslToMermaidFlowchart = (dsl = '') => {
  const root = parseHierarchyDsl(dsl)
  const lines = ['flowchart TD']
  const queue = [{ node: root, parentId: null }]
  let index = 0

  while (queue.length > 0) {
    const { node, parentId } = queue.shift()
    const nodeId = `${sanitizeNodeId(node.label, 'node')}_${index++}`
    lines.push(`  ${nodeId}["${mermaidLabel(node.label || '层级图')}"]`)
    if (parentId) {
      lines.push(`  ${parentId} --> ${nodeId}`)
    }
    for (const child of node.children || []) {
      queue.push({ node: child, parentId: nodeId })
    }
  }

  return lines.join('\n')
}

const measureNode = (label, depth) => {
  const wrap = wrapLabel(label, containsCJK(label) ? 8 : 16)
  const metrics = measureTextBlock(wrap, 16)
  const width = Math.max(NODE_MIN_W, Math.min(220, metrics.width + 28))
  const height = Math.max(NODE_MIN_H, metrics.height + 18)
  const colors = depth === 0 ? DIAGRAM_THEME.semantics.primary : palette(Math.max(0, depth - 1))
  return { wrap, metrics, width, height, colors }
}

const computeSubtree = (node, measures) => {
  const self = measures.get(node.id)
  if (!node.children.length) return self.height
  const childHeights = node.children.map((child) => computeSubtree(child, measures))
  const childrenTotal = childHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, node.children.length - 1) * GAP_Y
  return Math.max(self.height, childrenTotal)
}

const layoutTree = (node, depth, topY, measures, positions) => {
  const self = measures.get(node.id)
  const subtreeHeight = computeSubtree(node, measures)
  const x = PAD_X + depth * LEVEL_W
  const y = topY + subtreeHeight / 2 - self.height / 2
  positions.set(node.id, { x, y, width: self.width, height: self.height, depth })

  if (!node.children.length) return subtreeHeight
  let childTop = topY + (subtreeHeight - (node.children
    .map((child) => computeSubtree(child, measures))
    .reduce((sum, h) => sum + h, 0) + Math.max(0, node.children.length - 1) * GAP_Y)) / 2
  for (const child of node.children) {
    const childHeight = computeSubtree(child, measures)
    layoutTree(child, depth + 1, childTop, measures, positions)
    childTop += childHeight + GAP_Y
  }
  return subtreeHeight
}

const collectNodes = (root) => {
  const out = []
  const walk = (node, depth) => {
    out.push({ ...node, depth })
    node.children.forEach((child) => walk(child, depth + 1))
  }
  walk(root, 0)
  return out
}

const makeOrthArrow = (from, to) => {
  const sx = from.x + from.width
  const sy = from.y + from.height / 2
  const ex = to.x
  const ey = to.y + to.height / 2
  const dx = ex - sx
  const midX = sx + Math.max(40, dx / 2)
  return makeArrow({
    x: sx,
    y: sy,
    points: [
      [0, 0],
      [midX - sx, 0],
      [midX - sx, ey - sy],
      [ex - sx, ey - sy],
    ],
    stroke: DIAGRAM_THEME.line,
    strokeWidth: 2,
  })
}

/**
 * @deprecated 已被 composer 通用合成引擎取代（src/utils/diagrams/composer）。
 * 仅作为 flowchart/mindmap 之外旧路径的兜底保留，勿在新代码引用。
 */
export const renderHierarchy = (dsl, { offsetX = 0, offsetY = 0 } = {}) => {
  const root = parseHierarchyDsl(dsl)
  const flat = collectNodes(root)
  const measures = new Map(flat.map((node) => [node.id, measureNode(node.label, node.depth)]))
  const positions = new Map()
  const totalHeight = layoutTree(root, 0, PAD_Y, measures, positions)

  const maxDepth = Math.max(...flat.map((node) => node.depth))
  const width = PAD_X * 2 + LEVEL_W * maxDepth + Math.max(...flat.map((node) => measures.get(node.id).width))
  const height = totalHeight + PAD_Y * 2
  const elements = []

  for (const node of flat) {
    const pos = positions.get(node.id)
    const m = measures.get(node.id)
    elements.push(makeRect({
      x: offsetX + pos.x,
      y: offsetY + pos.y,
      width: pos.width,
      height: pos.height,
      bg: m.colors.bg,
      stroke: m.colors.stroke,
      strokeWidth: node.depth === 0 ? 2.25 : 2,
      rounded: true,
    }))
    elements.push(makeText({
      x: offsetX + pos.x + pos.width / 2 - m.metrics.width / 2,
      y: offsetY + pos.y + pos.height / 2 - m.metrics.height / 2,
      text: m.wrap,
      fontSize: 16,
      color: DIAGRAM_THEME.text,
      metrics: m.metrics,
    }))
    for (const child of node.children) {
      const childPos = positions.get(child.id)
      if (childPos) {
        elements.push(makeOrthArrow(pos, childPos))
      }
    }
  }

  return { elements, width, height, tier: 2 }
}
