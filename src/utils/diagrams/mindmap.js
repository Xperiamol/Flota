/**
 * 思维导图（Mindmap）生成器
 * 算法：Reingold–Tilford "tidy tree" 布局
 * - 中心主题居中，一级分支左右交替
 * - 每个子树占用的纵向空间由其叶子数量决定
 * - 同层节点严格按子树高度对齐，不再出现"挤成一列"
 */
import logger from '../logger'
import {
  DIAGRAM_THEME,
  beautifyElements,
  containsCJK,
  makeArrow,
  makeRect,
  makeText,
  measureTextBlock,
  palette,
  wrapLabel,
} from './shared'

const MM_NODE_W = 180
const MM_NODE_H = 50
const MM_GAP_X = 110
const MM_GAP_Y = 28

const parseMindmap = (lines) => {
  const root = { label: 'Root', children: [], depth: -1 }
  const stack = [root]
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().toLowerCase() === 'mindmap') continue
    const indent = raw.search(/\S/)
    if (indent < 0) continue
    let label = raw.trim()
    label = label
      .replace(/^root\s*\(\((.+)\)\)$/i, '$1')
      .replace(/^\(\((.+)\)\)$/, '$1')
      .replace(/^\((.+)\)$/, '$1')
      .replace(/^\[(.+)\]$/, '$1')
      .replace(/^\{(.+)\}$/, '$1')
      .replace(/^["'`](.+)["'`]$/, '$1')
    const node = { label, children: [], depth: indent }
    while (stack.length > 1 && stack[stack.length - 1].depth >= indent) stack.pop()
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return root
}

const flattenSide = (node, parentId, depth, list, edges, idGen, side) => {
  const id = idGen()
  list.push({ id, label: node.label, depth, parentId, side })
  if (parentId) edges.push({ from: parentId, to: id })
  for (const child of node.children || []) flattenSide(child, id, depth + 1, list, edges, idGen, side)
  return id
}

/**
 * 子树高度（占用纵向格子数，单位为 NODE_H + GAP_Y）
 * 业界 tidy tree 的 first walk：自底向上估算空间
 */
const computeSubtreeHeight = (node) => {
  const children = node.children || []
  if (!children.length) return 1
  return children.reduce((sum, child) => sum + computeSubtreeHeight(child), 0)
}

/**
 * Reingold-Tilford 简化版：从中心点出发，按子树高度分配纵向空间
 * 每个子树占用 = (叶子数) * 单位高度
 */
const layoutSide = (rootChildren, side, originX, originY) => {
  const positions = new Map()
  const direction = side === 'left' ? -1 : 1
  const stepX = MM_NODE_W + MM_GAP_X
  const stepY = MM_NODE_H + MM_GAP_Y

  const totalLeaves = rootChildren.reduce((s, c) => s + computeSubtreeHeight(c), 0) || 1
  const totalH = totalLeaves * stepY
  let cursorY = originY - totalH / 2

  const placeSubtree = (node, depth, topY) => {
    const leaves = computeSubtreeHeight(node)
    const subtreeHeight = leaves * stepY
    const centerY = topY + subtreeHeight / 2 - stepY / 2
    const x = originX + direction * depth * stepX - (direction < 0 ? MM_NODE_W : 0)
    positions.set(node.__id, { x, y: centerY, depth })
    let childTop = topY
    for (const child of node.children || []) {
      const childLeaves = computeSubtreeHeight(child)
      placeSubtree(child, depth + 1, childTop)
      childTop += childLeaves * stepY
    }
  }

  for (const child of rootChildren) {
    placeSubtree(child, 1, cursorY)
    cursorY += computeSubtreeHeight(child) * stepY
  }
  return positions
}

const assignIds = (node, idGen) => {
  node.__id = idGen()
  for (const child of node.children || []) assignIds(child, idGen)
}

const collectAllNodes = (node, list = []) => {
  list.push(node)
  for (const child of node.children || []) collectAllNodes(child, list)
  return list
}

export const renderMindmap = (mermaidCode, { offsetX = 400, offsetY = 320 } = {}) => {
  const lines = mermaidCode.split('\n')
  const root = parseMindmap(lines)
  const center = root.children[0] || { label: '主题', children: [] }

  let counter = 0
  const idGen = () => `mm_${counter++}`
  assignIds(center, idGen)

  const elements = []

  // 一级分支左右分流
  const firstLevel = center.children || []
  const half = Math.ceil(firstLevel.length / 2)
  const rightChildren = firstLevel.slice(0, half)
  const leftChildren = firstLevel.slice(half)

  const positions = new Map()
  const rightPositions = layoutSide(rightChildren, 'right', offsetX + MM_NODE_W / 2 + MM_GAP_X / 2, offsetY)
  const leftPositions = layoutSide(leftChildren, 'left', offsetX - MM_NODE_W / 2 - MM_GAP_X / 2, offsetY)
  for (const [k, v] of rightPositions) positions.set(k, v)
  for (const [k, v] of leftPositions) positions.set(k, v)

  // 中心节点
  const centerW = Math.max(MM_NODE_W, measureTextBlock(wrapLabel(center.label, containsCJK(center.label) ? 8 : 16)).width + 24)
  const centerH = MM_NODE_H + 8
  const centerX = offsetX - centerW / 2
  const centerY = offsetY - centerH / 2
  const centerColor = DIAGRAM_THEME.semantics.primary
  elements.push(makeRect({
    x: centerX,
    y: centerY,
    width: centerW,
    height: centerH,
    bg: centerColor.bg,
    stroke: centerColor.stroke,
    strokeWidth: 2,
  }))
  const centerLabel = wrapLabel(center.label, containsCJK(center.label) ? 8 : 16)
  const centerMetrics = measureTextBlock(centerLabel, 16)
  elements.push(makeText({
    x: centerX + centerW / 2 - centerMetrics.width / 2,
    y: centerY + centerH / 2 - centerMetrics.height / 2,
    text: centerLabel,
    fontSize: 16,
    color: DIAGRAM_THEME.text,
    metrics: centerMetrics,
  }))
  positions.set('__center__', { x: centerX, y: centerY, w: centerW, h: centerH, depth: 0 })

  // 普通节点
  const renderNode = (node) => {
    const pos = positions.get(node.__id)
    if (!pos) return
    const wrapped = wrapLabel(node.label, containsCJK(node.label) ? 8 : 16)
    const metrics = measureTextBlock(wrapped, 15)
    const w = Math.max(MM_NODE_W, metrics.width + 16)
    const h = Math.max(MM_NODE_H, metrics.height + 8)
    const color = palette(pos.depth)
    elements.push(makeRect({
      x: pos.x,
      y: pos.y - h / 2 + MM_NODE_H / 2,
      width: w,
      height: h,
      bg: color.bg,
      stroke: color.stroke,
      strokeWidth: pos.depth === 1 ? 2 : 1,
    }))
    elements.push(makeText({
      x: pos.x + w / 2 - metrics.width / 2,
      y: pos.y - metrics.height / 2 + MM_NODE_H / 2,
      text: wrapped,
      fontSize: 15,
      color: DIAGRAM_THEME.text,
      metrics,
    }))
    pos.w = w
    pos.h = h
  }

  for (const child of firstLevel) {
    for (const node of collectAllNodes(child)) renderNode(node)
  }

  // 连线：贝塞尔曲线感的折线
  const drawConnection = (from, to, side) => {
    const fromCenterY = from.y + (from.h ?? MM_NODE_H) / 2
    const toCenterY = to.y + (to.h ?? MM_NODE_H) / 2
    const startX = side === 'right' ? from.x + (from.w ?? MM_NODE_W) : from.x
    const endX = side === 'right' ? to.x : to.x + (to.w ?? MM_NODE_W)
    const dx = endX - startX
    const dy = toCenterY - fromCenterY
    const midX = dx / 2
    elements.push(makeArrow({
      x: startX,
      y: fromCenterY,
      points: [[0, 0], [midX, 0], [midX, dy], [dx, dy]],
      stroke: DIAGRAM_THEME.line,
      strokeWidth: 1.5,
      endArrow: null,
    }))
  }

  // 中心 → 一级分支
  for (let i = 0; i < firstLevel.length; i++) {
    const child = firstLevel[i]
    const side = i < half ? 'right' : 'left'
    const fromCenter = positions.get('__center__')
    const childPos = positions.get(child.__id)
    if (!fromCenter || !childPos) continue
    drawConnection(fromCenter, childPos, side)
  }
  // 各级父子
  const drawSubtree = (node, side) => {
    for (const child of node.children || []) {
      const fromPos = positions.get(node.__id)
      const toPos = positions.get(child.__id)
      if (fromPos && toPos) drawConnection(fromPos, toPos, side)
      drawSubtree(child, side)
    }
  }
  for (let i = 0; i < firstLevel.length; i++) {
    drawSubtree(firstLevel[i], i < half ? 'right' : 'left')
  }

  logger.log('[mindmap] 节点:', positions.size, '元素:', elements.length)
  return beautifyElements(elements)
}
