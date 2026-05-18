/**
 * Composition IR → Excalidraw 元素
 *
 * 工作流：
 *   1. 先渲染每个 block / freeform 子区块到独立坐标空间，得到 (elements, width, height)
 *   2. 按 layout.region 把所有顶层节点排到画布坐标系
 *   3. 渲染 group / sticky / callout / text 这些自由要素
 *   4. 渲染 connectors（跨节点连接）
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
import { renderMermaidNative } from './mermaidNative'
import { renderMindmap } from './mindmap'
import { renderGantt } from './gantt'
import { renderFishbone } from './fishbone'
import { renderTimeline, renderQuadrant, renderPie } from './extras'
import { layoutFreeform } from './freeformLayout'

// ─── 子区块渲染 ─────────────────────────────────────

const renderBlock = async (node) => {
  const { blockType, dsl } = node
  const offsets = { offsetX: 0, offsetY: 0 }
  switch (blockType) {
    case 'flowchart':
    case 'sequence':
    case 'class':
    case 'state':
    case 'er':
    case 'architecture': {
      const { elements, files, tier } = await renderMermaidNative(dsl, offsets)
      return { ...computeBoundingBox(elements), files: files || {}, tier }
    }
    case 'mindmap':
      return { ...computeBoundingBox(renderMindmap(dsl, { offsetX: 0, offsetY: 0 })), files: {}, tier: 2 }
    case 'gantt':
      return { ...computeBoundingBox(renderGantt(dsl, offsets)), files: {}, tier: 2 }
    case 'fishbone':
      return { ...computeBoundingBox(renderFishbone(dsl, offsets)), files: {}, tier: 2 }
    case 'timeline':
      return { ...computeBoundingBox(renderTimeline(dsl, offsets)), files: {}, tier: 2 }
    case 'quadrant':
      return { ...computeBoundingBox(renderQuadrant(dsl, offsets)), files: {}, tier: 2 }
    case 'pie':
      return { ...computeBoundingBox(renderPie(dsl, offsets)), files: {}, tier: 2 }
    default:
      throw new Error(`未实现的 block 类型: ${blockType}`)
  }
}

const renderFreeformNode = (node) => {
  const { graph } = node
  const { positions, width, height, sizes } = layoutFreeform(graph)
  const elements = []
  for (const n of graph.nodes) {
    const pos = positions.get(n.id)
    const sz = sizes.get(n.id)
    if (!pos || !sz) continue
    const color = palette(n.depth || 0)
    elements.push(makeRect({
      x: pos.x,
      y: pos.y,
      width: pos.w,
      height: pos.h,
      bg: n.style?.bg || color.bg,
      stroke: n.style?.stroke || color.stroke,
      strokeWidth: 1.5,
    }))
    elements.push(makeText({
      x: pos.x + pos.w / 2 - sz.metrics.width / 2,
      y: pos.y + pos.h / 2 - sz.metrics.height / 2,
      text: sz.wrap,
      fontSize: 14,
      color: DIAGRAM_THEME.text,
      metrics: sz.metrics,
    }))
  }
  for (const e of graph.edges || []) {
    const a = positions.get(e.from)
    const b = positions.get(e.to)
    if (!a || !b) continue
    const sx = a.x + a.w / 2
    const sy = a.y + a.h
    const ex = b.x + b.w / 2
    const ey = b.y
    const midY = (sy + ey) / 2
    elements.push(makeArrow({
      x: sx,
      y: sy,
      points: [[0, 0], [0, midY - sy], [ex - sx, midY - sy], [ex - sx, ey - sy]],
      stroke: DIAGRAM_THEME.line,
      strokeWidth: 1.5,
    }))
  }
  return { elements, width, height, anchors: positions }
}

// ─── 工具：包围盒 / 平移 ────────────────────────────

const computeBoundingBox = (elements) => {
  if (!elements.length) return { elements, width: 100, height: 100 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of elements) {
    const x = el.x ?? 0
    const y = el.y ?? 0
    const w = el.width ?? 0
    const h = el.height ?? 0
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  const shifted = elements.map((el) => ({
    ...el,
    x: typeof el.x === 'number' ? el.x - minX : el.x,
    y: typeof el.y === 'number' ? el.y - minY : el.y,
  }))
  return {
    elements: shifted,
    width: Math.max(40, maxX - minX),
    height: Math.max(40, maxY - minY),
  }
}

const translateElements = (elements, dx, dy) => elements.map((el) => ({
  ...el,
  x: typeof el.x === 'number' ? el.x + dx : el.x,
  y: typeof el.y === 'number' ? el.y + dy : el.y,
}))

// ─── 区块布局编排 ──────────────────────────────────

const BLOCK_GAP = 60
const SECTION_TITLE_H = 36

const arrangeBlocks = (blocks) => {
  // 输入：blocks = [{ id, kind, layout, render: { elements, width, height } }]
  // 输出：每个 block 的最终 (offsetX, offsetY)
  const placements = new Map()

  const partition = (region) => blocks.filter((b) => (b.layout?.region || 'auto') === region)
  const absoluteBlocks = blocks.filter((b) => b.layout?.region === 'absolute')
  const leftBlocks = partition('left')
  const rightBlocks = partition('right')
  const topBlocks = partition('top')
  const bottomBlocks = partition('bottom')
  const centerBlocks = blocks.filter((b) => {
    const r = b.layout?.region || 'auto'
    return r === 'center' || r === 'auto'
  })

  // top 行：水平铺
  let cursorY = 0
  let topRowH = 0
  let cursorX = 0
  for (const b of topBlocks) {
    placements.set(b.id, { x: cursorX, y: cursorY })
    cursorX += b.render.width + BLOCK_GAP
    topRowH = Math.max(topRowH, b.render.height)
  }
  cursorY += (topRowH ? topRowH + BLOCK_GAP : 0)

  // 中段：[left | center stack | right]
  const leftW = Math.max(0, ...leftBlocks.map((b) => b.render.width))
  const rightW = Math.max(0, ...rightBlocks.map((b) => b.render.width))
  const centerW = Math.max(0, ...centerBlocks.map((b) => b.render.width))
  const centerStartX = leftW ? leftW + BLOCK_GAP : 0

  let leftY = cursorY
  for (const b of leftBlocks) {
    placements.set(b.id, { x: 0, y: leftY })
    leftY += b.render.height + BLOCK_GAP
  }
  let centerY = cursorY
  for (const b of centerBlocks) {
    placements.set(b.id, { x: centerStartX, y: centerY })
    centerY += b.render.height + BLOCK_GAP
  }
  const rightStartX = centerStartX + centerW + (centerW && rightW ? BLOCK_GAP : 0)
  let rightY = cursorY
  for (const b of rightBlocks) {
    placements.set(b.id, { x: rightStartX, y: rightY })
    rightY += b.render.height + BLOCK_GAP
  }
  const middleEndY = Math.max(leftY, centerY, rightY)

  // bottom 行
  let bottomCursorX = 0
  let bottomRowH = 0
  for (const b of bottomBlocks) {
    placements.set(b.id, { x: bottomCursorX, y: middleEndY })
    bottomCursorX += b.render.width + BLOCK_GAP
    bottomRowH = Math.max(bottomRowH, b.render.height)
  }

  // absolute 直接用坐标
  for (const b of absoluteBlocks) {
    placements.set(b.id, { x: b.layout.x || 0, y: b.layout.y || 0 })
  }

  return placements
}

// ─── 自由要素渲染 ──────────────────────────────────

const renderSticky = (node, placement) => {
  const elements = []
  const w = node.width || 200
  const h = node.height || 140
  const x = placement.x
  const y = placement.y
  const color = node.color === 'yellow' ? { bg: '#fef9c3', stroke: '#ca8a04' }
    : node.color === 'pink' ? { bg: '#fce7f3', stroke: '#db2777' }
    : node.color === 'green' ? { bg: '#dcfce7', stroke: '#16a34a' }
    : node.color === 'blue' ? { bg: '#dbeafe', stroke: '#2563eb' }
    : { bg: '#fef9c3', stroke: '#ca8a04' }
  elements.push(makeRect({
    x, y, width: w, height: h,
    bg: color.bg, stroke: color.stroke, strokeWidth: 1.5, rounded: true,
  }))
  const wrap = wrapLabel(node.text, containsCJK(node.text) ? 10 : 22)
  const m = measureTextBlock(wrap, 14)
  elements.push(makeText({
    x: x + 14,
    y: y + 14,
    text: wrap,
    fontSize: 14,
    color: DIAGRAM_THEME.text,
    align: 'left',
    metrics: m,
  }))
  return { elements, width: w, height: h }
}

const renderCallout = (node, placement) => {
  const wrap = wrapLabel(node.text, containsCJK(node.text) ? 10 : 24)
  const m = measureTextBlock(wrap, 13)
  const w = m.width + 28
  const h = m.height + 16
  const x = placement.x
  const y = placement.y
  const color = DIAGRAM_THEME.semantics.accent
  return {
    elements: [
      makeRect({ x, y, width: w, height: h, bg: color.bg, stroke: color.stroke, strokeWidth: 1, rounded: true }),
      makeText({ x: x + 14, y: y + 8, text: wrap, fontSize: 13, color: color.stroke, align: 'left', metrics: m }),
    ],
    width: w,
    height: h,
  }
}

const renderTextNode = (node, placement) => {
  const fs = node.fontSize || 22
  const m = measureTextBlock(node.text, fs)
  return {
    elements: [
      makeText({
        x: placement.x,
        y: placement.y,
        text: node.text,
        fontSize: fs,
        color: DIAGRAM_THEME.text,
        align: 'left',
        metrics: m,
      }),
    ],
    width: m.width,
    height: m.height,
  }
}

const renderGroup = (node, childBoxes) => {
  // 包围所有 child 的盒子，加标题框
  if (!node.children?.length) return { elements: [], width: 0, height: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const cid of node.children) {
    const box = childBoxes.get(cid)
    if (!box) continue
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  if (!isFinite(minX)) return { elements: [], width: 0, height: 0 }
  const pad = 18
  const titleH = node.title ? SECTION_TITLE_H : 0
  const x = minX - pad
  const y = minY - pad - titleH
  const w = maxX - minX + pad * 2
  const h = maxY - minY + pad * 2 + titleH
  const color = node.color || DIAGRAM_THEME.semantics.neutral
  const stroke = typeof color === 'string' ? color : color.stroke
  const bg = typeof color === 'string' ? 'transparent' : (color.bg || 'transparent')
  const elements = [
    makeRect({ x, y, width: w, height: h, bg, stroke, strokeWidth: 1.5, rounded: true, dashed: true }),
  ]
  if (node.title) {
    const m = measureTextBlock(node.title, 16)
    elements.push(makeText({
      x: x + 16,
      y: y + (titleH - m.height) / 2,
      text: node.title,
      fontSize: 16,
      color: stroke,
      align: 'left',
      metrics: m,
    }))
  }
  return { elements, width: w, height: h, x, y }
}

// ─── 跨区连接线 ────────────────────────────────────

const buildAnchorMap = (placedBoxes) => {
  // 每个 block/freeform 在画布的最终包围盒中心点 + 边缘锚点
  const map = new Map()
  for (const [id, box] of placedBoxes) {
    map.set(id, {
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    })
  }
  return map
}

const renderConnector = (conn, anchorMap) => {
  const a = anchorMap.get(conn.from)
  const b = anchorMap.get(conn.to)
  if (!a || !b) return []
  // 简化：从 a 中心到 b 中心，但锚到边缘
  const dx = b.cx - a.cx
  const dy = b.cy - a.cy
  const ang = Math.atan2(dy, dx)
  const sx = a.cx + Math.cos(ang) * (a.width / 2)
  const sy = a.cy + Math.sin(ang) * (a.height / 2)
  const ex = b.cx - Math.cos(ang) * (b.width / 2)
  const ey = b.cy - Math.sin(ang) * (b.height / 2)
  const elements = [
    makeArrow({
      x: sx,
      y: sy,
      points: [[0, 0], [ex - sx, ey - sy]],
      stroke: conn.style?.stroke || DIAGRAM_THEME.semantics.accent.stroke,
      strokeWidth: 2,
      dashed: !!conn.dashed,
    }),
  ]
  if (conn.label) {
    const m = measureTextBlock(conn.label, 12)
    elements.push(makeRect({
      x: (sx + ex) / 2 - (m.width + 16) / 2,
      y: (sy + ey) / 2 - (m.height + 8) / 2,
      width: m.width + 16,
      height: m.height + 8,
      bg: '#ffffff',
      stroke: '#cbd5e1',
      strokeWidth: 1,
      rounded: true,
    }))
    elements.push(makeText({
      x: (sx + ex) / 2 - m.width / 2,
      y: (sy + ey) / 2 - m.height / 2,
      text: conn.label,
      fontSize: 12,
      color: DIAGRAM_THEME.textSecondary,
      metrics: m,
    }))
  }
  return elements
}

// ─── 主入口 ────────────────────────────────────────

export const renderComposition = async (ir, { offsetX = 100, offsetY = 100 } = {}) => {
  const allElements = []
  const allFiles = {}
  const placedBoxes = new Map()

  // 1. 渲染所有 block + freeform
  const renderable = []
  for (const node of ir.nodes) {
    if (node.kind === 'block') {
      try {
        const r = await renderBlock(node)
        renderable.push({ id: node.id, kind: 'block', layout: node.layout || {}, render: r })
      } catch (e) {
        logger.warn(`[composition] block ${node.id} 渲染失败:`, e.message)
      }
    } else if (node.kind === 'freeform') {
      const r = renderFreeformNode(node)
      renderable.push({ id: node.id, kind: 'freeform', layout: node.layout || {}, render: r })
    }
  }

  // 2. 区块编排
  const placements = arrangeBlocks(renderable)

  // 3. 应用区块平移到画布坐标
  for (const item of renderable) {
    const placement = placements.get(item.id) || { x: 0, y: 0 }
    const finalX = offsetX + placement.x
    const finalY = offsetY + placement.y
    const translated = translateElements(item.render.elements, finalX, finalY)
    allElements.push(...translated)
    Object.assign(allFiles, item.render.files || {})
    placedBoxes.set(item.id, {
      x: finalX,
      y: finalY,
      width: item.render.width,
      height: item.render.height,
    })
  }

  // 4. 渲染顶层标题
  if (ir.title) {
    const m = measureTextBlock(ir.title, 24)
    allElements.unshift(makeText({
      x: offsetX,
      y: offsetY - m.height - 16,
      text: ir.title,
      fontSize: 24,
      color: DIAGRAM_THEME.text,
      align: 'left',
      metrics: m,
    }))
  }

  // 5. 渲染自由要素 (sticky/callout/text)
  for (const node of ir.nodes) {
    if (node.kind === 'sticky' || node.kind === 'callout' || node.kind === 'text') {
      const placement = node.layout?.region === 'absolute'
        ? { x: offsetX + (node.layout.x || 0), y: offsetY + (node.layout.y || 0) }
        : findFreeSpot(placedBoxes, offsetX, offsetY)
      const r = node.kind === 'sticky' ? renderSticky(node, placement)
        : node.kind === 'callout' ? renderCallout(node, placement)
        : renderTextNode(node, placement)
      allElements.push(...r.elements)
      placedBoxes.set(node.id, { x: placement.x, y: placement.y, width: r.width, height: r.height })
    }
  }

  // 6. 渲染分组框（最后画，确保所有 children 已就位）
  for (const node of ir.nodes) {
    if (node.kind !== 'group') continue
    const childBoxes = new Map()
    for (const cid of node.children || []) {
      const box = placedBoxes.get(cid)
      if (box) childBoxes.set(cid, box)
    }
    const r = renderGroup(node, childBoxes)
    // 分组框要画在底层（先于子元素绘制）
    allElements.unshift(...r.elements)
  }

  // 7. 跨节点连接线
  if (Array.isArray(ir.connectors)) {
    const anchors = buildAnchorMap(placedBoxes)
    for (const conn of ir.connectors) {
      allElements.push(...renderConnector(conn, anchors))
    }
  }

  return {
    elements: beautifyElements(allElements),
    files: allFiles,
  }
}

// 找空地（极简：在已有 box 右下方堆叠）
const findFreeSpot = (placedBoxes, offsetX, offsetY) => {
  if (!placedBoxes.size) return { x: offsetX, y: offsetY }
  let maxX = -Infinity, maxY = -Infinity
  for (const box of placedBoxes.values()) {
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y)
  }
  return { x: maxX + 30, y: maxY }
}
