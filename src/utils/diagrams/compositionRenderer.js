/**
 * Composition IR → Excalidraw 元素
 *
 * 工作流：
 *   1. 先渲染每个 block / freeform 子区块到独立坐标空间，得到 (elements, width, height)
 *   2. 按 layout.region 把所有顶层节点排到画布坐标系
 *   3. 渲染 group / sticky / callout / text 这些自由要素
 *   4. 渲染 connectors（跨节点连接）
 */
import {
  DIAGRAM_THEME,
  beautifyElements,
  containsCJK,
  makeArrow,
  makeDiamond,
  makeRect,
  makeText,
  measureTextBlock,
  palette,
  wrapLabel,
} from './shared'
import { layoutFreeform } from './freeformLayout'

// ─── 子区块渲染 ─────────────────────────────────────

const getBoxCenter = (box) => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
})

const getPortPoint = (box, side, offset = 0) => {
  if (side === 'left') return { x: box.x, y: box.y + box.h / 2 + offset }
  if (side === 'right') return { x: box.x + box.w, y: box.y + box.h / 2 + offset }
  if (side === 'top') return { x: box.x + box.w / 2 + offset, y: box.y }
  return { x: box.x + box.w / 2 + offset, y: box.y + box.h }
}

const choosePortSides = (fromBox, toBox) => {
  const a = getBoxCenter(fromBox)
  const b = getBoxCenter(toBox)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  }
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

const orthogonalPointsBetweenBoxes = (fromBox, toBox, opts = {}) => {
  const [fromSide, toSide] = choosePortSides(fromBox, toBox)
  const start = getPortPoint(fromBox, fromSide, opts.fromOffset || 0)
  const end = getPortPoint(toBox, toSide, opts.toOffset || 0)
  const dx = end.x - start.x
  const dy = end.y - start.y
  // 单边对齐时直走，避免无意义的拐弯
  if (Math.abs(dx) < 8 || Math.abs(dy) < 8) {
    return { start, points: [[0, 0], [dx, dy]], fromSide, toSide }
  }
  // 关键修正：拐弯点取两个盒子之间的真实 gap 中线，而不是两点连线中点。
  // 旧实现 `midX = start.x + dx/2` 在节点近距离/重叠时会让转角穿过节点本体。
  if (fromSide === 'left' || fromSide === 'right') {
    const fromRight = fromBox.x + fromBox.w
    const toRight = toBox.x + toBox.w
    let midX
    if (fromRight <= toBox.x) {
      midX = (fromRight + toBox.x) / 2  // 从左到右，midX 取右-左 gap 中线
    } else if (toRight <= fromBox.x) {
      midX = (toRight + fromBox.x) / 2  // 反向 gap
    } else {
      midX = start.x + dx / 2  // 横向重叠时退回中点
    }
    // 多条线分散：拐弯线 X 坐标按 channel 偏移，避免不同 arrow 的横线重叠
    midX += (opts.channelOffset || 0)
    return {
      start,
      points: [[0, 0], [midX - start.x, 0], [midX - start.x, dy], [dx, dy]],
      fromSide,
      toSide,
    }
  }
  const fromBottom = fromBox.y + fromBox.h
  const toBottom = toBox.y + toBox.h
  let midY
  if (fromBottom <= toBox.y) {
    midY = (fromBottom + toBox.y) / 2
  } else if (toBottom <= fromBox.y) {
    midY = (toBottom + fromBox.y) / 2
  } else {
    midY = start.y + dy / 2
  }
  midY += (opts.channelOffset || 0)
  return {
    start,
    points: [[0, 0], [0, midY - start.y], [dx, midY - start.y], [dx, dy]],
    fromSide,
    toSide,
  }
}

const getLabelPositionFromPolyline = (start, points) => {
  if (!Array.isArray(points) || points.length < 2) {
    return { x: start.x, y: start.y }
  }
  const midIndex = Math.max(0, Math.floor((points.length - 1) / 2))
  const a = points[midIndex]
  const b = points[midIndex + 1] || points[midIndex]
  return {
    x: start.x + (a[0] + b[0]) / 2,
    y: start.y + (a[1] + b[1]) / 2,
  }
}

const bindArrowToElements = (arrow, fromBox, toBox) => {
  if (!arrow) return arrow
  if (fromBox?.elementId) {
    arrow.startBinding = {
      elementId: fromBox.elementId,
      focus: 0,
      gap: 8,
    }
    if (fromBox.elementRef) {
      fromBox.elementRef.boundElements = [
        ...(fromBox.elementRef.boundElements || []),
        { id: arrow.id, type: 'arrow' },
      ]
    }
  }
  if (toBox?.elementId) {
    arrow.endBinding = {
      elementId: toBox.elementId,
      focus: 0,
      gap: 8,
    }
    if (toBox.elementRef) {
      toBox.elementRef.boundElements = [
        ...(toBox.elementRef.boundElements || []),
        { id: arrow.id, type: 'arrow' },
      ]
    }
  }
  return arrow
}

const bindTextToElement = (text, element) => {
  if (!text || !element?.id) return text
  text.containerId = element.id
  element.boundElements = [
    ...(element.boundElements || []),
    { id: text.id, type: 'text' },
  ]
  return text
}

const renderFreeformNode = (node) => {
  const { graph } = node
  const { positions, width, height, sizes } = layoutFreeform(graph)
  const elements = []
  const anchors = new Map()
  for (const n of graph.nodes) {
    const pos = positions.get(n.id)
    const sz = sizes.get(n.id)
    if (!pos || !sz) continue
    const color = palette(n.depth || 0)
    const rect = makeRect({
      x: pos.x,
      y: pos.y,
      width: pos.w,
      height: pos.h,
      bg: n.style?.bg || color.bg,
      stroke: n.style?.stroke || color.stroke,
      strokeWidth: 1.5,
    })
    elements.push(rect)
    anchors.set(n.id, { ...pos, elementId: rect.id, elementRef: rect })
    const label = makeText({
      x: pos.x + pos.w / 2 - sz.metrics.width / 2,
      y: pos.y + pos.h / 2 - sz.metrics.height / 2,
      text: sz.wrap,
      fontSize: 14,
      color: DIAGRAM_THEME.text,
      metrics: sz.metrics,
    })
    elements.push(bindTextToElement(label, rect))
  }
  const portUsage = new Map()
  for (const e of graph.edges || []) {
    const a = anchors.get(e.from)
    const b = anchors.get(e.to)
    if (!a || !b) continue
    const [fromSide, toSide] = choosePortSides(a, b)
    const fromKey = `${e.from}|${fromSide}`
    const toKey = `${e.to}|${toSide}`
    if (!portUsage.has(fromKey)) portUsage.set(fromKey, [])
    if (!portUsage.has(toKey)) portUsage.set(toKey, [])
    portUsage.get(fromKey).push(e)
    portUsage.get(toKey).push(e)
  }
  // 给每条 edge 计算 port 偏移：同侧 N 条线在 [-(N-1)/2 .. (N-1)/2] * step 内均匀分散
  const portOffset = (key, edge, sideAxisLength) => {
    const list = portUsage.get(key)
    if (!list || list.length <= 1) return 0
    const idx = list.indexOf(edge)
    const n = list.length
    const step = Math.min(18, Math.max(8, sideAxisLength / (n + 1)))
    return (idx - (n - 1) / 2) * step
  }
  for (let ei = 0; ei < (graph.edges || []).length; ei++) {
    const e = graph.edges[ei]
    const a = anchors.get(e.from)
    const b = anchors.get(e.to)
    if (!a || !b) continue
    const [fromSide, toSide] = choosePortSides(a, b)
    const fromAxis = (fromSide === 'left' || fromSide === 'right') ? a.h : a.w
    const toAxis = (toSide === 'left' || toSide === 'right') ? b.h : b.w
    const fromOffset = portOffset(`${e.from}|${fromSide}`, e, fromAxis)
    const toOffset = portOffset(`${e.to}|${toSide}`, e, toAxis)
    // channel offset：让不同 edge 的中线拐弯不重叠
    const channelOffset = (ei % 5 - 2) * 12
    const routed = orthogonalPointsBetweenBoxes(a, b, { fromOffset, toOffset, channelOffset })
    const arrow = makeArrow({
      x: routed.start.x,
      y: routed.start.y,
      points: routed.points,
      stroke: DIAGRAM_THEME.line,
      strokeWidth: 1.5,
    })
    elements.push(bindArrowToElements(arrow, a, b))
  }
  return { elements, width, height, anchors }
}

// ─── 工具：平移 ────────────────────────────────────

const translateElements = (elements, dx, dy) => elements.map((el) => ({
  ...el,
  x: typeof el.x === 'number' ? el.x + dx : el.x,
  y: typeof el.y === 'number' ? el.y + dy : el.y,
}))

// ─── 区块布局编排 ──────────────────────────────────

const BLOCK_GAP = 60
const SECTION_TITLE_H = 36
const CARD_W = 220
const CARD_H = 118
const SECTION_PAD = 24
const SECTION_GAP = 18

const semanticColor = (kind, tone) => {
  if (tone && DIAGRAM_THEME.semantics[tone]) return DIAGRAM_THEME.semantics[tone]
  if (kind === 'decision') return DIAGRAM_THEME.semantics.warning
  if (kind === 'summary') return DIAGRAM_THEME.semantics.accent
  if (kind === 'evidence') return DIAGRAM_THEME.semantics.info
  if (kind === 'risk') return DIAGRAM_THEME.semantics.danger
  if (kind === 'result') return DIAGRAM_THEME.semantics.success
  return DIAGRAM_THEME.semantics.primary
}

const CARD_HEADER_H = 38
const CARD_PAD_X = 14
const CARD_PAD_Y = 12

const renderSemanticCard = (node, placement, options = {}) => {
  const x = placement.x
  const y = placement.y
  const w = options.width || node.width || CARD_W
  const kind = node.type || node.kind
  const color = semanticColor(kind, node.tone)
  const isCJK = containsCJK(`${node.title || ''}${node.text || node.body || ''}`)
  const charsPerLine = Math.max(6, Math.floor((w - CARD_PAD_X * 2) / (isCJK ? 14 : 8)))
  const titleText = wrapLabel(node.title || '', charsPerLine)
  const bodyText = wrapLabel(node.text || node.body || '', charsPerLine)

  const titleM = titleText ? measureTextBlock(titleText, 14) : { width: 0, height: 0 }
  const bodyM = bodyText ? measureTextBlock(bodyText, 13) : { width: 0, height: 0 }

  const headerH = titleText ? Math.max(CARD_HEADER_H, titleM.height + 14) : 0
  const bodyH = bodyText ? bodyM.height + CARD_PAD_Y * 2 : 0
  const minH = options.height || node.height || CARD_H
  const h = Math.max(minH, headerH + bodyH)

  // 整张白底卡片（带描边、圆角）
  const rootElement = makeRect({
    x, y, width: w, height: h,
    bg: '#ffffff',
    stroke: color.stroke,
    strokeWidth: 1.4,
    rounded: true,
  })
  const elements = [rootElement]

  // 顶部色带 = 标题区。用半圆角 rect 覆盖在卡片顶部，营造"标题条"层次。
  if (titleText) {
    const headerBand = makeRect({
      x, y, width: w, height: headerH,
      bg: color.bg,
      stroke: color.stroke,
      strokeWidth: 0,
      rounded: true,
    })
    elements.push(headerBand)
    const titleEl = makeText({
      x: x + CARD_PAD_X,
      y: y + (headerH - titleM.height) / 2,
      text: titleText,
      fontSize: 14,
      color: color.stroke,
      align: 'left',
      metrics: titleM,
    })
    elements.push(titleEl)
  }

  // 正文：bind 到 root rect 上，便于跟随拖动
  if (bodyText) {
    const bodyEl = makeText({
      x: x + CARD_PAD_X,
      y: y + headerH + CARD_PAD_Y,
      text: bodyText,
      fontSize: 13,
      color: DIAGRAM_THEME.text,
      align: 'left',
      metrics: bodyM,
    })
    elements.push(bindTextToElement(bodyEl, rootElement))
  }

  return { elements, width: w, height: h, rootElementId: rootElement.id, rootElementRef: rootElement }
}

const renderDecisionNode = (node, placement, options = {}) => {
  const x = placement.x
  const y = placement.y
  const w = options.width || node.width || 190
  const color = semanticColor('decision', node.tone)
  const isCJK = containsCJK(`${node.title || ''}${node.text || ''}`)
  // 菱形内有效宽度只有外接矩形的约 60%，因此换行字数要按这个比例反推
  const charsPerLine = Math.max(5, Math.floor((w * 0.6 - 16) / (isCJK ? 14 : 8)))
  const title = wrapLabel(node.title || '', charsPerLine)
  const detail = wrapLabel(node.text || '', charsPerLine)
  const text = [title, detail].filter(Boolean).join('\n')
  const textM = measureTextBlock(text, 13)
  const minH = options.height || node.height || 126
  // 菱形高度按文字高度反推（菱形内有效高度也只有约 60%）
  const h = Math.max(minH, Math.ceil(textM.height / 0.6) + 24)
  const rootElement = makeDiamond({ x, y, width: w, height: h, bg: color.bg, stroke: color.stroke, strokeWidth: 1.7 })
  const label = makeText({
    x: x + w / 2 - textM.width / 2,
    y: y + h / 2 - textM.height / 2,
    text,
    fontSize: 13,
    color: color.stroke,
    metrics: textM,
  })
  const elements = [
    rootElement,
    bindTextToElement(label, rootElement),
  ]
  return { elements, width: w, height: h, rootElementId: rootElement.id, rootElementRef: rootElement }
}

const renderSummaryNode = (node, placement, options = {}) => {
  const x = placement.x
  const y = placement.y
  const w = options.width || node.width || 260
  const color = semanticColor('summary', node.tone)
  const isCJK = containsCJK(`${node.title || ''}${node.text || ''}`)
  const charsPerLine = Math.max(8, Math.floor((w - 32) / (isCJK ? 14 : 8)))
  const title = wrapLabel(node.title || '结论', charsPerLine)
  const body = wrapLabel(node.text || '', charsPerLine)
  const text = [title, body].filter(Boolean).join('\n')
  const textM = measureTextBlock(text, 13)
  const h = options.height || node.height || Math.max(108, textM.height + 40)
  const rootElement = makeRect({ x, y, width: w, height: h, bg: color.bg, stroke: color.stroke, strokeWidth: 2, rounded: true })
  const label = makeText({
    x: x + w / 2 - textM.width / 2,
    y: y + h / 2 - textM.height / 2,
    text,
    fontSize: 13,
    color: DIAGRAM_THEME.text,
    metrics: textM,
  })
  return {
    elements: [
      rootElement,
      bindTextToElement(label, rootElement),
    ],
    width: w,
    height: h,
    rootElementId: rootElement.id,
    rootElementRef: rootElement,
  }
}

const renderSemanticNode = (node, placement, options = {}) => {
  if (node.kind === 'decision') return renderDecisionNode(node, placement, options)
  if (node.kind === 'summary') return renderSummaryNode(node, placement, options)
  return renderSemanticCard(node, placement, options)
}

const renderSectionNode = (node) => {
  const title = node.title || '分区'
  const items = Array.isArray(node.items) ? node.items.slice(0, 8) : []
  const cols = Math.min(2, Math.max(1, Math.ceil(Math.sqrt(Math.max(items.length, 1)))))
  const itemW = CARD_W + 18
  const minItemH = CARD_H + 10
  const titleH = 54
  const color = semanticColor(node.type || 'section', node.tone || 'neutral')
  const titleM = measureTextBlock(title, 18)

  // 两遍布局：先量出每个卡片真实高度，再按"行最大高"排坐标，避免文字溢出/重叠
  const measured = items.map((item) => {
    const kind = ['card', 'decision', 'summary'].includes(item.kind) ? item.kind : 'card'
    const w = kind === 'decision' ? 190 : itemW
    const rendered = renderSemanticNode({ ...item, kind }, { x: 0, y: 0 }, {
      width: w,
      height: minItemH,
    })
    return { item, kind, w, h: rendered.height }
  })
  const rowHeights = []
  for (let row = 0; row * cols < measured.length; row++) {
    let rowH = minItemH
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (idx >= measured.length) break
      rowH = Math.max(rowH, measured[idx].h)
    }
    rowHeights.push(rowH)
  }
  const totalRowsH = rowHeights.reduce((s, h) => s + h, 0)
  const gapsH = Math.max(0, rowHeights.length - 1) * SECTION_GAP

  const width = SECTION_PAD * 2 + cols * itemW + (cols - 1) * SECTION_GAP
  const height = SECTION_PAD * 2 + titleH + totalRowsH + gapsH

  const rootElement = makeRect({ x: 0, y: 0, width, height, bg: '#f8fbff', stroke: color.stroke, strokeWidth: 1.6, rounded: true, dashed: true })
  const titleText = makeText({
    x: SECTION_PAD,
    y: 16,
    text: title,
    fontSize: 18,
    color: color.stroke,
    align: 'left',
    metrics: titleM,
  })
  const elements = [
    rootElement,
    titleText,
  ]

  let cursorY = SECTION_PAD + titleH
  for (let row = 0; row * cols < measured.length; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (idx >= measured.length) break
      const m = measured[idx]
      const placement = {
        x: SECTION_PAD + col * (itemW + SECTION_GAP),
        y: cursorY,
      }
      const rendered = renderSemanticNode({ ...m.item, kind: m.kind }, placement, {
        width: m.w,
        height: rowHeights[row],
      })
      elements.push(...rendered.elements)
    }
    cursorY += rowHeights[row] + SECTION_GAP
  }
  return { elements, width, height, anchors: new Map(), rootElementId: rootElement.id, rootElementRef: rootElement }
}

const arrangeBlocks = (blocks) => {
  // 输入：blocks = [{ id, kind, layout, render: { elements, width, height } }]
  // 输出：每个 block 的最终 (offsetX, offsetY)
  const placements = new Map()
  const absoluteBlocks = blocks.filter((b) => b.layout?.region === 'absolute')
  const normalBlocks = blocks.filter((b) => b.layout?.region !== 'absolute')
  const partition = (region) => normalBlocks.filter((b) => (b.layout?.region || 'auto') === region)
  const topBlocks = partition('top')
  const bottomBlocks = partition('bottom')
  const leftBlocks = partition('left')
  const rightBlocks = partition('right')
  let centerBlocks = normalBlocks.filter((b) => {
    const r = b.layout?.region || 'auto'
    return r === 'center' || r === 'auto'
  })

  if (!centerBlocks.length && normalBlocks.length) {
    const biggest = [...normalBlocks].sort((a, b) =>
      (b.render.width * b.render.height) - (a.render.width * a.render.height)
    )[0]
    centerBlocks = [biggest]
  }
  const centerIds = new Set(centerBlocks.map((b) => b.id))
  const sideBlocks = [...leftBlocks, ...rightBlocks].filter((b) => !centerIds.has(b.id)).slice(0, 4)

  const placeRow = (items, y, maxWidth = 0) => {
    let totalW = items.reduce((sum, b) => sum + b.render.width, 0) + Math.max(0, items.length - 1) * BLOCK_GAP
    let x = maxWidth > totalW ? (maxWidth - totalW) / 2 : 0
    let rowH = 0
    for (const b of items) {
      placements.set(b.id, { x, y })
      x += b.render.width + BLOCK_GAP
      rowH = Math.max(rowH, b.render.height)
    }
    return { width: totalW, height: rowH }
  }

  const placeStack = (items, x, y) => {
    let cursorY = y
    let width = 0
    for (const b of items) {
      placements.set(b.id, { x, y: cursorY })
      cursorY += b.render.height + BLOCK_GAP
      width = Math.max(width, b.render.width)
    }
    return {
      width,
      height: items.length ? cursorY - y - BLOCK_GAP : 0,
    }
  }

  let cursorY = 0
  const topRow = placeRow(topBlocks, cursorY)
  cursorY += topRow.height ? topRow.height + BLOCK_GAP : 0

  const mainBlocks = centerBlocks.filter((b) => !sideBlocks.some((side) => side.id === b.id))
  const mainStackWidth = Math.max(0, ...mainBlocks.map((b) => b.render.width))
  const sideStackWidth = Math.max(0, ...sideBlocks.map((b) => b.render.width))
  const sideOnLeft = sideBlocks.some((b) => b.layout?.region === 'left')
  const mainX = sideOnLeft && sideStackWidth ? sideStackWidth + BLOCK_GAP : 0
  const sideX = sideOnLeft ? 0 : mainStackWidth + (mainStackWidth && sideStackWidth ? BLOCK_GAP : 0)
  const mainStack = placeStack(mainBlocks, mainX, cursorY)
  const sideStack = placeStack(sideBlocks, sideX, cursorY)
  const middleHeight = Math.max(mainStack.height, sideStack.height)
  const middleWidth = Math.max(
    topRow.width,
    mainStackWidth + (mainStackWidth && sideStackWidth ? BLOCK_GAP : 0) + sideStackWidth,
  )
  cursorY += middleHeight ? middleHeight + BLOCK_GAP : 0

  const bottomRow = placeRow(bottomBlocks.filter((b) => !placements.has(b.id)), cursorY, middleWidth)
  const canvasWidth = Math.max(middleWidth, topRow.width, bottomRow.width)

  // 顶部行在知道整体宽度后再居中一次
  if (topBlocks.length && canvasWidth > topRow.width) {
    const dx = (canvasWidth - topRow.width) / 2
    for (const b of topBlocks) {
      const p = placements.get(b.id)
      if (p) placements.set(b.id, { x: p.x + dx, y: p.y })
    }
  }

  for (const b of normalBlocks) {
    if (placements.has(b.id)) continue
    placements.set(b.id, { x: 0, y: cursorY })
    cursorY += b.render.height + BLOCK_GAP
  }

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

const MAX_TOP_LEVEL_CONNECTORS = 3
const MAX_CONNECTOR_DISTANCE = 1200

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
      elementId: box.elementId,
      elementRef: box.elementRef,
    })
  }
  return map
}

const renderConnector = (conn, anchorMap) => {
  const a = anchorMap.get(conn.from)
  const b = anchorMap.get(conn.to)
  if (!a || !b) return []
  const dx = b.cx - a.cx
  const dy = b.cy - a.cy
  if (Math.abs(dx) + Math.abs(dy) > MAX_CONNECTOR_DISTANCE) return []
  const routed = orthogonalPointsBetweenBoxes(
    { x: a.x, y: a.y, w: a.width, h: a.height },
    { x: b.x, y: b.y, w: b.width, h: b.height },
  )
  const arrow = makeArrow({
    x: routed.start.x,
    y: routed.start.y,
    points: routed.points,
    stroke: conn.style?.stroke || DIAGRAM_THEME.semantics.accent.stroke,
    strokeWidth: 2,
    dashed: !!conn.dashed,
  })
  const elements = [
    bindArrowToElements(arrow, a, b),
  ]
  if (conn.label) {
    const m = measureTextBlock(conn.label, 12)
    const labelPos = getLabelPositionFromPolyline(routed.start, routed.points)
    elements.push(makeRect({
      x: labelPos.x - (m.width + 16) / 2,
      y: labelPos.y - (m.height + 8) / 2,
      width: m.width + 16,
      height: m.height + 8,
      bg: '#ffffff',
      stroke: '#cbd5e1',
      strokeWidth: 1,
      rounded: true,
    }))
    elements.push(makeText({
      x: labelPos.x - m.width / 2,
      y: labelPos.y - m.height / 2,
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

  // 1. 渲染所有 freeform + section
  const renderable = []
  for (const node of ir.nodes) {
    if (node.kind === 'freeform') {
      const r = renderFreeformNode(node)
      renderable.push({ id: node.id, kind: 'freeform', layout: node.layout || {}, render: r })
    } else if (node.kind === 'section') {
      const r = renderSectionNode(node)
      renderable.push({ id: node.id, kind: 'section', layout: node.layout || {}, render: r })
    } else if (node.kind === 'card' || node.kind === 'decision' || node.kind === 'summary') {
      const r = renderSemanticNode(node, { x: 0, y: 0 })
      renderable.push({ id: node.id, kind: node.kind, layout: node.layout || {}, render: r })
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
    const rootElementId = item.render.rootElementId || null
    const rootElementRef = rootElementId
      ? translated.find((element) => element.id === rootElementId)
      : null
    placedBoxes.set(item.id, {
      x: finalX,
      y: finalY,
      width: item.render.width,
      height: item.render.height,
      elementId: rootElementId,
      elementRef: rootElementRef,
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
    if (
      node.kind === 'sticky' ||
      node.kind === 'callout' ||
      node.kind === 'text'
    ) {
      const placement = node.layout?.region === 'absolute'
        ? { x: offsetX + (node.layout.x || 0), y: offsetY + (node.layout.y || 0) }
        : findFreeSpot(placedBoxes, offsetX, offsetY)
      const r = node.kind === 'sticky' ? renderSticky(node, placement)
        : node.kind === 'callout' ? renderCallout(node, placement)
        : renderTextNode(node, placement)
      allElements.push(...r.elements)
      placedBoxes.set(node.id, {
        x: placement.x,
        y: placement.y,
        width: r.width,
        height: r.height,
        elementId: r.rootElementId || null,
        elementRef: r.rootElementRef || null,
      })
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
    for (const conn of ir.connectors.slice(0, MAX_TOP_LEVEL_CONNECTORS)) {
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
