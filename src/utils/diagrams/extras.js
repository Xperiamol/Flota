/**
 * Timeline / Quadrant / Pie 生成器
 * 这三种业界画板都常见但 Mermaid 原生支持参差不齐，统一在此自实现
 */
import logger from '../logger'
import {
  DIAGRAM_THEME,
  beautifyElements,
  containsCJK,
  makeArrow,
  makeBase,
  makeLine,
  makeRect,
  makeText,
  measureTextBlock,
  palette,
  randomSeed,
  snapToGrid,
  wrapLabel,
} from './shared'

// ─── Timeline ────────────────────────────────────
// DSL 兼容 Mermaid timeline：
//   timeline
//     title 项目里程碑
//     2024-01 : 启动会议 : 需求确认
//     2024-03 : 原型完成
//     2024-06 : 内测发布

const parseTimeline = (code) => {
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean)
  const result = { title: '', sections: [], events: [] }
  let currentSection = null
  for (const line of lines) {
    if (/^timeline\b/i.test(line)) continue
    const tm = line.match(/^title\s+(.+)$/i)
    if (tm) { result.title = tm[1].trim(); continue }
    const sm = line.match(/^section\s+(.+)$/i)
    if (sm) { currentSection = sm[1].trim(); result.sections.push(currentSection); continue }
    const parts = line.split(':').map((s) => s.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const [time, ...rest] = parts
      result.events.push({ time, items: rest, section: currentSection })
    }
  }
  return result
}

export const renderTimeline = (code, { offsetX = 100, offsetY = 120 } = {}) => {
  const { title, events } = parseTimeline(code)
  const elements = []
  if (!events.length) return elements
  const STEP = 220
  const TRACK_Y = offsetY + 200
  const TRACK_W = Math.max(events.length * STEP + 60, 600)

  if (title) {
    const m = measureTextBlock(title, 20)
    elements.push(makeText({
      x: offsetX,
      y: offsetY,
      text: title,
      fontSize: 20,
      color: DIAGRAM_THEME.text,
      align: 'left',
      metrics: m,
    }))
  }

  // 主轴
  elements.push(makeArrow({
    x: offsetX,
    y: TRACK_Y,
    points: [[0, 0], [TRACK_W, 0]],
    stroke: DIAGRAM_THEME.line,
    strokeWidth: 2.5,
  }))

  events.forEach((event, i) => {
    const cx = offsetX + 60 + i * STEP
    const isUp = i % 2 === 0
    const dotR = 8
    const color = palette(i)

    // 节点圆点
    elements.push({
      ...makeBase('ellipse'),
      x: snapToGrid(cx - dotR),
      y: snapToGrid(TRACK_Y - dotR),
      width: dotR * 2,
      height: dotR * 2,
      backgroundColor: color.stroke,
      strokeColor: color.stroke,
      strokeWidth: 2,
      roughness: 0,
      seed: randomSeed(),
    })

    // 时间标签
    const tm = measureTextBlock(event.time, 13)
    const timeY = isUp ? TRACK_Y + 16 : TRACK_Y - tm.height - 16
    elements.push(makeText({
      x: cx - tm.width / 2,
      y: timeY,
      text: event.time,
      fontSize: 13,
      color: DIAGRAM_THEME.textSecondary,
      metrics: tm,
    }))

    // 引线 + 卡片
    const cardOffset = 90
    const cardY = isUp ? TRACK_Y - cardOffset : TRACK_Y + cardOffset
    elements.push(makeLine({
      x: cx,
      y: TRACK_Y,
      points: [[0, 0], [0, cardY - TRACK_Y + (isUp ? 0 : 0)]],
      stroke: color.stroke,
      strokeWidth: 1.5,
      dashed: true,
    }))

    const itemsText = event.items.join('\n')
    const wrapped = wrapLabel(itemsText, containsCJK(itemsText) ? 9 : 18)
    const wm = measureTextBlock(wrapped, 13)
    const cardW = Math.max(160, wm.width + 24)
    const cardH = wm.height + 18
    const cardYTop = isUp ? cardY - cardH : cardY
    elements.push(makeRect({
      x: cx - cardW / 2,
      y: cardYTop,
      width: cardW,
      height: cardH,
      bg: color.bg,
      stroke: color.stroke,
      strokeWidth: 1.5,
    }))
    elements.push(makeText({
      x: cx - wm.width / 2,
      y: cardYTop + cardH / 2 - wm.height / 2,
      text: wrapped,
      fontSize: 13,
      color: DIAGRAM_THEME.text,
      metrics: wm,
    }))
  })

  logger.log('[timeline] 事件:', events.length, '元素:', elements.length)
  return beautifyElements(elements)
}

// ─── Quadrant 四象限 ────────────────────────────────
// 兼容 Mermaid quadrantChart 子集：
//   quadrantChart
//     title 重要紧急矩阵
//     x-axis 不重要 --> 重要
//     y-axis 不紧急 --> 紧急
//     quadrant-1 立刻做
//     quadrant-2 计划做
//     quadrant-3 不做
//     quadrant-4 委派
//     "需求评审": [0.7, 0.8]
//     "代码评审": [0.4, 0.6]

const parseQuadrant = (code) => {
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean)
  const result = {
    title: '',
    xAxis: { left: 'Low', right: 'High' },
    yAxis: { bottom: 'Low', top: 'High' },
    quadrants: { q1: '', q2: '', q3: '', q4: '' },
    points: [],
  }
  for (const line of lines) {
    if (/^quadrantchart\b/i.test(line)) continue
    const tm = line.match(/^title\s+(.+)$/i)
    if (tm) { result.title = tm[1].trim(); continue }
    const xm = line.match(/^x-axis\s+(.+?)\s*-+>\s*(.+)$/i)
    if (xm) { result.xAxis = { left: xm[1].trim(), right: xm[2].trim() }; continue }
    const ym = line.match(/^y-axis\s+(.+?)\s*-+>\s*(.+)$/i)
    if (ym) { result.yAxis = { bottom: ym[1].trim(), top: ym[2].trim() }; continue }
    const qm = line.match(/^quadrant-([1-4])\s+(.+)$/i)
    if (qm) { result.quadrants[`q${qm[1]}`] = qm[2].trim(); continue }
    const pm = line.match(/^["“](.+?)["”]\s*:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]$/)
    if (pm) {
      result.points.push({ name: pm[1].trim(), x: parseFloat(pm[2]), y: parseFloat(pm[3]) })
    }
  }
  return result
}

export const renderQuadrant = (code, { offsetX = 100, offsetY = 100 } = {}) => {
  const data = parseQuadrant(code)
  const elements = []
  const SIZE = 480
  const left = offsetX + 40
  const top = offsetY + 60

  if (data.title) {
    const m = measureTextBlock(data.title, 20)
    elements.push(makeText({
      x: offsetX + SIZE / 2 - m.width / 2,
      y: offsetY,
      text: data.title,
      fontSize: 20,
      color: DIAGRAM_THEME.text,
      metrics: m,
    }))
  }

  // 四象限底色（左下/右下/左上/右上 = q3/q4/q2/q1）
  const half = SIZE / 2
  const cells = [
    { key: 'q2', x: left, y: top, color: DIAGRAM_THEME.semantics.info },
    { key: 'q1', x: left + half, y: top, color: DIAGRAM_THEME.semantics.success },
    { key: 'q3', x: left, y: top + half, color: DIAGRAM_THEME.semantics.neutral },
    { key: 'q4', x: left + half, y: top + half, color: DIAGRAM_THEME.semantics.warning },
  ]
  for (const cell of cells) {
    elements.push(makeRect({
      x: cell.x,
      y: cell.y,
      width: half,
      height: half,
      bg: cell.color.bg,
      stroke: cell.color.stroke,
      strokeWidth: 1,
      rounded: false,
    }))
    const text = data.quadrants[cell.key]
    if (text) {
      const wrap = wrapLabel(text, containsCJK(text) ? 9 : 18)
      const m = measureTextBlock(wrap, 14)
      elements.push(makeText({
        x: cell.x + half / 2 - m.width / 2,
        y: cell.y + 14,
        text: wrap,
        fontSize: 14,
        color: cell.color.stroke,
        metrics: m,
      }))
    }
  }

  // 轴
  elements.push(makeLine({
    x: left,
    y: top + half,
    points: [[0, 0], [SIZE, 0]],
    stroke: DIAGRAM_THEME.text,
    strokeWidth: 2,
  }))
  elements.push(makeLine({
    x: left + half,
    y: top,
    points: [[0, 0], [0, SIZE]],
    stroke: DIAGRAM_THEME.text,
    strokeWidth: 2,
  }))

  // 轴标签
  const axisFs = 12
  const xLeftM = measureTextBlock(data.xAxis.left, axisFs)
  elements.push(makeText({ x: left - xLeftM.width - 6, y: top + half - xLeftM.height / 2, text: data.xAxis.left, fontSize: axisFs, color: DIAGRAM_THEME.textSecondary, metrics: xLeftM, align: 'right' }))
  const xRightM = measureTextBlock(data.xAxis.right, axisFs)
  elements.push(makeText({ x: left + SIZE + 6, y: top + half - xRightM.height / 2, text: data.xAxis.right, fontSize: axisFs, color: DIAGRAM_THEME.textSecondary, metrics: xRightM, align: 'left' }))
  const yTopM = measureTextBlock(data.yAxis.top, axisFs)
  elements.push(makeText({ x: left + half - yTopM.width / 2, y: top - yTopM.height - 6, text: data.yAxis.top, fontSize: axisFs, color: DIAGRAM_THEME.textSecondary, metrics: yTopM }))
  const yBotM = measureTextBlock(data.yAxis.bottom, axisFs)
  elements.push(makeText({ x: left + half - yBotM.width / 2, y: top + SIZE + 6, text: data.yAxis.bottom, fontSize: axisFs, color: DIAGRAM_THEME.textSecondary, metrics: yBotM }))

  // 数据点
  data.points.forEach((p, i) => {
    const px = left + p.x * SIZE
    const py = top + (1 - p.y) * SIZE
    const r = 6
    const color = palette(i)
    elements.push({
      ...makeBase('ellipse'),
      x: snapToGrid(px - r),
      y: snapToGrid(py - r),
      width: r * 2,
      height: r * 2,
      backgroundColor: color.stroke,
      strokeColor: color.stroke,
      strokeWidth: 2,
      roughness: 0,
    })
    const m = measureTextBlock(p.name, 12)
    elements.push(makeText({
      x: px + 8,
      y: py - m.height / 2,
      text: p.name,
      fontSize: 12,
      color: DIAGRAM_THEME.text,
      align: 'left',
      metrics: m,
    }))
  })

  logger.log('[quadrant] 点:', data.points.length, '元素:', elements.length)
  return beautifyElements(elements)
}

// ─── Pie ────────────────────────────────────
// pie title 销售构成
//     "服装" : 45
//     "鞋类" : 25
//     "配饰" : 30

const parsePie = (code) => {
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean)
  const result = { title: '', slices: [] }
  for (const line of lines) {
    if (/^pie\b/i.test(line)) {
      const tm = line.match(/title\s+(.+)$/i)
      if (tm) result.title = tm[1].trim()
      continue
    }
    const tm = line.match(/^title\s+(.+)$/i)
    if (tm) { result.title = tm[1].trim(); continue }
    const sm = line.match(/^["“](.+?)["”]\s*:\s*([\d.]+)$/)
    if (sm) result.slices.push({ label: sm[1].trim(), value: parseFloat(sm[2]) })
  }
  return result
}

const polarToCartesian = (cx, cy, r, angle) => ({
  x: cx + r * Math.cos(angle),
  y: cy + r * Math.sin(angle),
})

export const renderPie = (code, { offsetX = 100, offsetY = 100 } = {}) => {
  const { title, slices } = parsePie(code)
  const elements = []
  if (!slices.length) return elements
  const total = slices.reduce((s, x) => s + x.value, 0) || 1
  const cx = offsetX + 240
  const cy = offsetY + 260
  const r = 160

  if (title) {
    const m = measureTextBlock(title, 20)
    elements.push(makeText({
      x: cx - m.width / 2,
      y: offsetY,
      text: title,
      fontSize: 20,
      color: DIAGRAM_THEME.text,
      metrics: m,
    }))
  }

  // 用三角片近似饼图（Excalidraw 不支持原生扇形，用细分线段拼成多边形）
  let angle = -Math.PI / 2
  slices.forEach((slice, i) => {
    const portion = slice.value / total
    const sweep = portion * Math.PI * 2
    const segments = Math.max(8, Math.round(portion * 64))
    const points = [[0, 0]]
    for (let s = 0; s <= segments; s++) {
      const a = angle + (sweep * s) / segments
      const p = polarToCartesian(0, 0, r, a)
      points.push([p.x, p.y])
    }
    points.push([0, 0])
    const color = palette(i)
    elements.push({
      ...makeBase('line'),
      x: snapToGrid(cx),
      y: snapToGrid(cy),
      width: r * 2,
      height: r * 2,
      points,
      backgroundColor: color.bg,
      fillStyle: 'solid',
      strokeColor: color.stroke,
      strokeWidth: 2,
      roughness: 0,
      lastCommittedPoint: null,
    })

    // 标签：百分比
    const midA = angle + sweep / 2
    const labelP = polarToCartesian(cx, cy, r * 0.65, midA)
    const pct = `${slice.label} ${(portion * 100).toFixed(1)}%`
    const m = measureTextBlock(pct, 13)
    elements.push(makeText({
      x: labelP.x - m.width / 2,
      y: labelP.y - m.height / 2,
      text: pct,
      fontSize: 13,
      color: DIAGRAM_THEME.text,
      metrics: m,
    }))
    angle += sweep
  })

  logger.log('[pie] 切片:', slices.length, '元素:', elements.length)
  return beautifyElements(elements)
}
