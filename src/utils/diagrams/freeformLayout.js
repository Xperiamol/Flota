/**
 * Freeform 图布局引擎
 * 输入：{ nodes:[{id,label,style?}], edges:[{from,to,label?}] }
 * 输出：{ positions: Map<id, {x,y,w,h}>, width, height }
 *
 * 策略：分层（如果是 DAG）+ Barycenter 排序 → 兜底 force-directed
 * 这是简化版业界做法，能兼顾"有向流程图"和"无向网络图"两种形态
 */
import { containsCJK, measureTextBlock, wrapLabel } from './shared'

const MIN_W = 140
const MIN_H = 56
const GAP_X = 90
const GAP_Y = 70
const PADDING = 30

const measure = (label) => {
  const wrap = wrapLabel(label, containsCJK(label) ? 8 : 16)
  const m = measureTextBlock(wrap, 14)
  return {
    width: Math.max(MIN_W, m.width + 16),
    height: Math.max(MIN_H, m.height + 12),
    wrap,
    metrics: m,
  }
}

const detectDAG = (nodes, edges) => {
  // 简单环检测
  const inDeg = new Map(nodes.map((n) => [n.id, 0]))
  const adj = new Map(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (!adj.has(e.from) || !inDeg.has(e.to)) continue
    adj.get(e.from).push(e.to)
    inDeg.set(e.to, inDeg.get(e.to) + 1)
  }
  const queue = []
  for (const [id, d] of inDeg) if (d === 0) queue.push(id)
  let visited = 0
  const layered = new Map()
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    visited++
    const layer = layered.get(id) ?? 0
    for (const next of adj.get(id) || []) {
      const nl = Math.max((layered.get(next) ?? 0), layer + 1)
      layered.set(next, nl)
      const nd = inDeg.get(next) - 1
      inDeg.set(next, nd)
      if (nd === 0) {
        if (!layered.has(next)) layered.set(next, nl)
        queue.push(next)
      }
    }
    if (!layered.has(id)) layered.set(id, layer)
  }
  return { isDAG: visited === nodes.length, layers: layered }
}

const layoutDAG = (nodes, edges, sizes, layers) => {
  // 按 layer 分桶
  const buckets = new Map()
  for (const n of nodes) {
    const l = layers.get(n.id) ?? 0
    if (!buckets.has(l)) buckets.set(l, [])
    buckets.get(l).push(n)
  }
  const layerKeys = [...buckets.keys()].sort((a, b) => a - b)

  // Barycenter 排序减少交叉
  const adj = new Map(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from).push(e.to)
    if (adj.has(e.to)) adj.get(e.to).push(e.from)
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let li = 1; li < layerKeys.length; li++) {
      const prev = buckets.get(layerKeys[li - 1])
      const prevPos = new Map(prev.map((n, i) => [n.id, i]))
      buckets.get(layerKeys[li]).sort((a, b) => {
        const aN = (adj.get(a.id) || []).filter((x) => prevPos.has(x))
        const bN = (adj.get(b.id) || []).filter((x) => prevPos.has(x))
        const aB = aN.length ? aN.reduce((s, x) => s + prevPos.get(x), 0) / aN.length : Infinity
        const bB = bN.length ? bN.reduce((s, x) => s + prevPos.get(x), 0) / bN.length : Infinity
        return aB - bB
      })
    }
  }

  const positions = new Map()
  const layerHeights = layerKeys.map((k) => {
    const arr = buckets.get(k)
    return Math.max(...arr.map((n) => sizes.get(n.id).height))
  })

  let cursorY = PADDING
  let maxRowW = 0
  for (let li = 0; li < layerKeys.length; li++) {
    const arr = buckets.get(layerKeys[li])
    const totalW = arr.reduce((s, n) => s + sizes.get(n.id).width, 0) + (arr.length - 1) * GAP_X
    let cursorX = PADDING
    for (const n of arr) {
      const sz = sizes.get(n.id)
      positions.set(n.id, {
        x: cursorX,
        y: cursorY + (layerHeights[li] - sz.height) / 2,
        w: sz.width,
        h: sz.height,
      })
      cursorX += sz.width + GAP_X
    }
    maxRowW = Math.max(maxRowW, totalW)
    cursorY += layerHeights[li] + GAP_Y
  }
  // 居中对齐
  for (const [id, p] of positions) {
    const layer = layers.get(id) ?? 0
    const arr = buckets.get(layer)
    const totalW = arr.reduce((s, n) => s + sizes.get(n.id).width, 0) + (arr.length - 1) * GAP_X
    const offset = (maxRowW - totalW) / 2
    p.x += offset
  }
  return {
    positions,
    width: maxRowW + PADDING * 2,
    height: cursorY + PADDING,
  }
}

const layoutForce = (nodes, edges, sizes) => {
  // 简化 force-directed：弹簧 + 排斥
  const positions = new Map()
  const cols = Math.ceil(Math.sqrt(nodes.length))
  nodes.forEach((n, i) => {
    const sz = sizes.get(n.id)
    positions.set(n.id, {
      x: (i % cols) * (MIN_W + GAP_X) + PADDING,
      y: Math.floor(i / cols) * (MIN_H + GAP_Y) + PADDING,
      w: sz.width,
      h: sz.height,
      vx: 0, vy: 0,
    })
  })
  const REP = 8000
  const SPRING_LEN = 180
  const SPRING_K = 0.04
  for (let iter = 0; iter < 80; iter++) {
    // 排斥
    for (const a of nodes) {
      const pa = positions.get(a.id)
      pa.vx = 0; pa.vy = 0
      for (const b of nodes) {
        if (a.id === b.id) continue
        const pb = positions.get(b.id)
        const dx = (pa.x + pa.w / 2) - (pb.x + pb.w / 2)
        const dy = (pa.y + pa.h / 2) - (pb.y + pb.h / 2)
        const d2 = dx * dx + dy * dy + 0.01
        const f = REP / d2
        pa.vx += (dx / Math.sqrt(d2)) * f
        pa.vy += (dy / Math.sqrt(d2)) * f
      }
    }
    // 弹簧
    for (const e of edges) {
      const pa = positions.get(e.from)
      const pb = positions.get(e.to)
      if (!pa || !pb) continue
      const dx = (pb.x + pb.w / 2) - (pa.x + pa.w / 2)
      const dy = (pb.y + pb.h / 2) - (pa.y + pa.h / 2)
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      const f = SPRING_K * (d - SPRING_LEN)
      pa.vx += (dx / d) * f
      pa.vy += (dy / d) * f
      pb.vx -= (dx / d) * f
      pb.vy -= (dy / d) * f
    }
    // 应用速度
    for (const p of positions.values()) {
      p.x += Math.max(-15, Math.min(15, p.vx))
      p.y += Math.max(-15, Math.min(15, p.vy))
    }
  }
  // 平移到正坐标
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.w)
    maxY = Math.max(maxY, p.y + p.h)
  }
  for (const p of positions.values()) {
    p.x = p.x - minX + PADDING
    p.y = p.y - minY + PADDING
  }
  return {
    positions,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  }
}

export const layoutFreeform = (graph) => {
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const sizes = new Map(nodes.map((n) => [n.id, measure(n.label || n.id)]))
  if (nodes.length === 0) return { positions: new Map(), width: 0, height: 0, sizes }
  const { isDAG, layers } = detectDAG(nodes, edges)
  const result = isDAG && nodes.length <= 60
    ? layoutDAG(nodes, edges, sizes, layers)
    : layoutForce(nodes, edges, sizes)
  result.sizes = sizes
  return result
}
