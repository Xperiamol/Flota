/**
 * AI Excalidraw 生成器 — Mermaid 中间格式方案
 * AI 输出 Mermaid 语法（极少 token）→ 本地解析 + 自动布局 → Excalidraw 元素
 * 速度比直接生成 JSON 快 5-10 倍
 */
import logger from './logger'

// ─── 工具函数 ────────────────────────────────────────

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function seed() {
  return Math.floor(Math.random() * 2000000000)
}

// 颜色面板 — 按层级自动分配
const PALETTE = [
  { bg: '#a5d8ff', stroke: '#1971c2' }, // 蓝
  { bg: '#b2f2bb', stroke: '#2f9e44' }, // 绿
  { bg: '#ffec99', stroke: '#f08c00' }, // 橙
  { bg: '#ffc9c9', stroke: '#e03131' }, // 红
  { bg: '#d0bfff', stroke: '#9c36b5' }, // 紫
  { bg: '#c3fae8', stroke: '#0ca678' }, // 青
  { bg: '#ffd8a8', stroke: '#e8590c' }, // 深橙
  { bg: '#eebefa', stroke: '#ae3ec9' }, // 粉紫
]

// ─── AI Prompt（要求输出 Mermaid）────────────────────

const MERMAID_SYSTEM_PROMPT = `你是一个图表助手。根据用户输入生成 Mermaid 语法。

规则：
1. 只输出 Mermaid 代码，不要任何解释或 markdown 代码块标记
2. 支持的图表类型：
   - 流程图: graph TD 或 graph LR
   - 思维导图: mindmap
   - 时序图: sequenceDiagram
3. 流程图节点形状：
   - [矩形]  (圆角)  {菱形}  ((圆形))  >旗帜]
4. 流程图连线：--> 或 -->|标签|
5. 思维导图用缩进表示层级
6. 时序图参与者用 participant 声明，消息用 ->> 或 -->> 表示
7. 节点文本要简洁，每个节点不超过15字
8. 根据内容性质自动选择最合适的图表类型
9. 生成高质量、结构清晰的图表`

// ─── Mermaid 解析器 ──────────────────────────────────

/**
 * 解析 Mermaid 流程图语法
 * 支持: graph TD/LR/BT/RL, 节点声明, 边, 子图
 */
function parseFlowchart(lines) {
  const nodes = new Map()  // id -> { label, shape }
  const edges = []
  let direction = 'TD'

  // 第一行: graph TD / graph LR 等
  const dirLine = lines[0]?.trim() || ''
  const dirMatch = dirLine.match(/^graph\s+(TD|TB|LR|RL|BT)/i)
  if (dirMatch) direction = dirMatch[1].toUpperCase()
  if (direction === 'TB') direction = 'TD'

  // 解析节点形状
  function parseNodeDef(raw) {
    raw = raw.trim()
    let id, label, shape

    // A[label] / A(label) / A{label} / A((label)) / A>label] / A([label]) / A[[label]]
    const patterns = [
      { re: /^(\w+)\(\((.+?)\)\)$/, shape: 'ellipse' },
      { re: /^(\w+)\((.+?)\)$/, shape: 'rounded' },
      { re: /^(\w+)\{(.+?)\}$/, shape: 'diamond' },
      { re: /^(\w+)>(.+?)\]$/, shape: 'flag' },
      { re: /^(\w+)\[(.+?)\]$/, shape: 'rect' },
    ]

    for (const p of patterns) {
      const m = raw.match(p.re)
      if (m) {
        id = m[1]
        label = m[2].replace(/^["']|["']$/g, '')
        shape = p.shape
        break
      }
    }

    if (!id) {
      // 纯 ID，无形状声明
      id = raw.replace(/^["']|["']$/g, '')
      label = id
      shape = 'rect'
    }

    return { id, label, shape }
  }

  function ensureNode(raw) {
    const def = parseNodeDef(raw)
    if (!nodes.has(def.id)) {
      nodes.set(def.id, { label: def.label, shape: def.shape })
    } else if (def.label !== def.id) {
      // 更新 label（如果之前只有 ID）
      nodes.get(def.id).label = def.label
      nodes.get(def.id).shape = def.shape
    }
    return def.id
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('graph ') || line.startsWith('%%') || line === 'end' || line.startsWith('subgraph')) continue

    // 尝试匹配边: A --> B, A -->|label| B, A -- text --> B
    // 支持链式: A --> B --> C
    const edgePattern = /^(.+?)(\s*-+->|--[->]|=+=>|-.->)\s*(?:\|([^|]*)\|\s*)?(.+)$/
    const m = line.match(edgePattern)
    if (m) {
      const leftRaw = m[1].trim()
      const edgeLabel = m[3]?.trim() || ''
      const rightPart = m[4].trim()

      const fromId = ensureNode(leftRaw)

      // 右边可能是链式: B --> C
      const chainMatch = rightPart.match(/^(.+?)(\s*-+->|--[->]|=+=>|-.->)\s*(?:\|([^|]*)\|\s*)?(.+)$/)
      if (chainMatch) {
        const midId = ensureNode(chainMatch[1].trim())
        edges.push({ from: fromId, to: midId, label: edgeLabel })
        // 递归处理剩余部分（简化：只处理一级链）
        const toId = ensureNode(chainMatch[4].trim())
        edges.push({ from: midId, to: toId, label: chainMatch[3]?.trim() || '' })
      } else {
        const toId = ensureNode(rightPart)
        edges.push({ from: fromId, to: toId, label: edgeLabel })
      }
      continue
    }

    // 独立节点声明
    if (/^\w+[\[\(\{>]/.test(line)) {
      ensureNode(line)
    }
  }

  return { type: 'flowchart', direction, nodes, edges }
}

/**
 * 解析 Mermaid 思维导图语法
 * mindmap
 *   root(Central Topic)
 *     Branch 1
 *       Leaf 1
 *     Branch 2
 */
function parseMindmap(lines) {
  const tree = { label: 'Root', children: [], depth: -1 }
  const stack = [tree]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim() === 'mindmap') continue

    // 计算缩进深度（空格数 / 2 或 tab 数）
    const indent = line.search(/\S/)
    if (indent < 0) continue

    const raw = line.trim()
    // 提取标签（去掉可选的形状标记）
    let label = raw
    const shapeMatch = raw.match(/^(?:\w+)?\(?\(?(.+?)\)?\)?$/)
    if (shapeMatch) label = shapeMatch[1]
    // 清理：去掉 root((xxx)) 等标记
    label = label.replace(/^\(\((.+)\)\)$/, '$1').replace(/^\((.+)\)$/, '$1').replace(/^\[(.+)\]$/, '$1')

    const node = { label, children: [], depth: indent }

    // 找到合适的父节点
    while (stack.length > 1 && stack[stack.length - 1].depth >= indent) {
      stack.pop()
    }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  return { type: 'mindmap', tree }
}

/**
 * 解析 Mermaid 时序图语法
 * sequenceDiagram
 *   participant A as Alice
 *   participant B as Bob
 *   A->>B: Hello
 *   B-->>A: Hi
 */
function parseSequenceDiagram(lines) {
  const participants = [] // { id, label }
  const messages = []     // { from, to, label, isDashed }
  const seen = new Set()

  function ensureParticipant(id, label) {
    if (!seen.has(id)) {
      seen.add(id)
      participants.push({ id, label: label || id })
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line === 'sequenceDiagram' || line.startsWith('%%')) continue

    // participant / actor 声明
    const pMatch = line.match(/^(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/i)
    if (pMatch) {
      ensureParticipant(pMatch[1], pMatch[2]?.trim() || pMatch[1])
      continue
    }

    // Note / activate / deactivate / loop / end / alt / else — 跳过
    if (/^(Note|activate|deactivate|loop|end|alt|else|opt|par|rect|critical|break)/i.test(line)) continue

    // 消息: A->>B: text, A-->>B: text, A->>+B, A-)B: text 等
    const mMatch = line.match(/^(\w+)\s*(-?->>?\+?-?|-->>?\+?-?)\s*(\w+)\s*:\s*(.*)$/)
    if (mMatch) {
      const from = mMatch[1]
      const arrow = mMatch[2]
      const to = mMatch[3]
      const label = mMatch[4].trim()
      ensureParticipant(from)
      ensureParticipant(to)
      messages.push({ from, to, label, isDashed: arrow.startsWith('--') })
    }
  }

  return { type: 'sequence', participants, messages }
}

/**
 * 从 AI 回复中提取 Mermaid 代码
 */
function extractMermaid(text) {
  let code = text.trim()
  // 去掉 markdown 代码块
  code = code.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
  return code.trim()
}

/**
 * 解析 Mermaid 文本为图结构
 */
function parseMermaid(code) {
  const lines = code.split('\n')
  const firstLine = lines[0]?.trim().toLowerCase() || ''

  try {
    if (firstLine.startsWith('mindmap')) {
      return parseMindmap(lines)
    }
    if (firstLine.startsWith('sequencediagram')) {
      return parseSequenceDiagram(lines)
    }
    // 默认当flowchart处理
    const result = parseFlowchart(lines)
    if (result.nodes.size === 0) throw new Error('解析结果为空')
    return result
  } catch (e) {
    logger.log('[aiExcalidrawGenerator] Mermaid 解析失败，使用 fallback:', e.message)
    return fallbackParse(code)
  }
}

/**
 * Fallback 解析：用正则从任意文本中提取节点和关系
 */
function fallbackParse(code) {
  const nodes = new Map()
  const edges = []
  let nodeId = 0
  const labelToId = new Map()

  function getOrCreate(label) {
    label = label.trim().replace(/^["'\[\(\{]+|["'\]\)\}]+$/g, '')
    if (!label) return null
    if (labelToId.has(label)) return labelToId.get(label)
    const id = `fb_${nodeId++}`
    labelToId.set(label, id)
    nodes.set(id, { label, shape: 'rect' })
    return id
  }

  // 尝试提取所有 A --> B 模式
  const arrowRe = /(\S+(?:\s+\S+)?)\s*-+>+\s*(?:\|([^|]*)\|\s*)?(\S+(?:\s+\S+)?)/g
  let m
  while ((m = arrowRe.exec(code)) !== null) {
    const fromId = getOrCreate(m[1])
    const toId = getOrCreate(m[3])
    if (fromId && toId) edges.push({ from: fromId, to: toId, label: m[2]?.trim() || '' })
  }

  // 如果还是空，将每行当独立节点
  if (nodes.size === 0) {
    for (const line of code.split('\n')) {
      const text = line.trim()
      if (text && text.length < 60) getOrCreate(text)
    }
  }

  return { type: 'flowchart', direction: 'TD', nodes, edges }
}

// ─── 自动布局引擎 ────────────────────────────────────

const NODE_W = 160
const NODE_H = 60
const GAP_X = 80
const GAP_Y = 80

/**
 * 流程图分层布局（Sugiyama 简化版）
 */
function layoutFlowchart(graph, offsetX = 100, offsetY = 100) {
  const { nodes, edges, direction } = graph
  const isHorizontal = direction === 'LR' || direction === 'RL'
  const isReversed = direction === 'BT' || direction === 'RL'

  // 构建邻接表和入度
  const adj = new Map()
  const inDeg = new Map()
  for (const [id] of nodes) {
    adj.set(id, [])
    inDeg.set(id, 0)
  }
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from).push(e.to)
    inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1)
  }

  // BFS 拓扑分层
  const layers = []
  const layerOf = new Map()
  const queue = []
  for (const [id] of nodes) {
    if ((inDeg.get(id) || 0) === 0) queue.push(id)
  }
  // 处理无入度的为第0层
  if (queue.length === 0 && nodes.size > 0) {
    // 有环？取第一个为起点
    queue.push(nodes.keys().next().value)
  }

  const visited = new Set()
  while (queue.length > 0) {
    const batch = [...queue]
    queue.length = 0
    const layer = []
    for (const id of batch) {
      if (visited.has(id)) continue
      visited.add(id)
      layerOf.set(id, layers.length)
      layer.push(id)
      for (const next of (adj.get(id) || [])) {
        const newDeg = (inDeg.get(next) || 1) - 1
        inDeg.set(next, newDeg)
        if (newDeg <= 0 && !visited.has(next)) queue.push(next)
      }
    }
    if (layer.length > 0) layers.push(layer)
  }

  // 补充未访问节点
  for (const [id] of nodes) {
    if (!visited.has(id)) {
      layers.push([id])
      layerOf.set(id, layers.length - 1)
      visited.add(id)
    }
  }

  if (isReversed) layers.reverse()

  // Barycenter 排序：减少层间边交叉
  const adjAll = new Map()
  for (const [id] of nodes) adjAll.set(id, [])
  for (const e of edges) {
    if (adjAll.has(e.from)) adjAll.get(e.from).push(e.to)
    if (adjAll.has(e.to)) adjAll.get(e.to).push(e.from)
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let li = 1; li < layers.length; li++) {
      const prevLayer = layers[li - 1]
      const prevPos = new Map()
      prevLayer.forEach((id, idx) => prevPos.set(id, idx))
      layers[li].sort((a, b) => {
        const neighborsA = (adjAll.get(a) || []).filter(n => prevPos.has(n))
        const neighborsB = (adjAll.get(b) || []).filter(n => prevPos.has(n))
        const baryA = neighborsA.length > 0 ? neighborsA.reduce((s, n) => s + prevPos.get(n), 0) / neighborsA.length : Infinity
        const baryB = neighborsB.length > 0 ? neighborsB.reduce((s, n) => s + prevPos.get(n), 0) / neighborsB.length : Infinity
        return baryA - baryB
      })
    }
  }

  // 分配坐标
  const positions = new Map()
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]
    const totalSpan = layer.length * (isHorizontal ? NODE_H : NODE_W) + (layer.length - 1) * (isHorizontal ? GAP_Y : GAP_X)
    const startCross = -totalSpan / 2

    for (let ni = 0; ni < layer.length; ni++) {
      const id = layer[ni]
      const mainPos = li * ((isHorizontal ? NODE_W : NODE_H) + (isHorizontal ? GAP_X : GAP_Y))
      const crossPos = startCross + ni * ((isHorizontal ? NODE_H : NODE_W) + (isHorizontal ? GAP_Y : GAP_X))

      if (isHorizontal) {
        positions.set(id, { x: offsetX + mainPos, y: offsetY + crossPos + totalSpan / 2 })
      } else {
        positions.set(id, { x: offsetX + crossPos + totalSpan / 2, y: offsetY + mainPos })
      }
    }
  }

  return positions
}

/**
 * 思维导图树形布局
 */
function layoutMindmap(tree, offsetX = 400, offsetY = 100) {
  const positions = new Map()
  let idCounter = 0
  const nodeList = [] // { id, label, depth, parentId }
  const edgeList = []

  function flatten(node, parentId, depth) {
    const id = `mm_${idCounter++}`
    nodeList.push({ id, label: node.label, depth })
    if (parentId) edgeList.push({ from: parentId, to: id, label: '' })
    for (const child of node.children) {
      flatten(child, id, depth + 1)
    }
    return id
  }

  // 先将第一层children作为 roots
  if (tree.children.length === 1) {
    flatten(tree.children[0], null, 0)
  } else if (tree.children.length > 0) {
    const rootId = `mm_${idCounter++}`
    nodeList.push({ id: rootId, label: tree.children[0]?.label || 'Root', depth: 0 })
    for (const child of tree.children.slice(tree.children.length > 1 ? 0 : 1)) {
      flatten(child, rootId, 1)
    }
  }

  // 按 depth 分组
  const depthGroups = new Map()
  for (const n of nodeList) {
    if (!depthGroups.has(n.depth)) depthGroups.set(n.depth, [])
    depthGroups.get(n.depth).push(n)
  }

  // 水平布局：depth => x 层级
  const MW = 180, MH = 50, MGX = 100, MGY = 30
  for (const [depth, group] of depthGroups) {
    const x = offsetX + depth * (MW + MGX)
    const totalH = group.length * MH + (group.length - 1) * MGY
    const startY = offsetY + (depth === 0 ? totalH / 2 : 0) - totalH / 2
    for (let i = 0; i < group.length; i++) {
      positions.set(group[i].id, { x, y: startY + i * (MH + MGY) })
    }
  }

  // 构建 nodes Map
  const nodesMap = new Map()
  for (const n of nodeList) {
    nodesMap.set(n.id, { label: n.label, shape: n.depth === 0 ? 'rounded' : 'rect' })
  }

  return { positions, nodes: nodesMap, edges: edgeList }
}

// ─── 图结构 → Excalidraw 元素 ────────────────────────

function makeBase(type) {
  return {
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
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  }
}

function shapeTypeMap(shape) {
  switch (shape) {
    case 'diamond': return 'diamond'
    case 'ellipse': case 'circle': return 'ellipse'
    default: return 'rectangle'
  }
}

function measureText(text, fontSize = 16) {
  // 粗略估算：每个字符 0.6em 宽，中文约 1em
  const chars = [...text]
  let w = 0
  for (const ch of chars) {
    w += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.6
  }
  return { width: Math.max(w + 24, 80), height: fontSize * 1.5 + 16 }
}

/**
 * 将图结构转为 Excalidraw 元素数组
 */
function graphToElements(nodesMap, edges, positions, isHorizontal = false) {
  const elements = []

  // 预计算每个节点的实际尺寸
  const nodeSizes = new Map()
  for (const [id, node] of nodesMap) {
    const measured = measureText(node.label, 16)
    const w = Math.max(NODE_W, measured.width)
    const h = NODE_H
    nodeSizes.set(id, { w, h })
  }

  let colorIdx = 0
  const nodeColorCache = new Map()

  // 1. 生成节点（shape + text）
  for (const [id, node] of nodesMap) {
    const pos = positions.get(id)
    if (!pos) continue
    const { w, h } = nodeSizes.get(id)

    // 分配颜色
    if (!nodeColorCache.has(id)) {
      nodeColorCache.set(id, PALETTE[colorIdx % PALETTE.length])
      colorIdx++
    }
    const color = nodeColorCache.get(id)
    const shapeType = shapeTypeMap(node.shape)

    // 形状元素
    const shapeEl = {
      ...makeBase(shapeType),
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      strokeColor: color.stroke,
      backgroundColor: color.bg,
      roundness: node.shape === 'rounded'
        ? { type: 3 }
        : shapeType === 'rectangle' ? { type: 3 } : (shapeType === 'diamond' ? null : { type: 2 }),
    }
    elements.push(shapeEl)

    // 文本元素（居中）
    const fontSize = 16
    const textEl = {
      ...makeBase('text'),
      x: pos.x + w / 2 - measureText(node.label, fontSize).width / 2 + 12,
      y: pos.y + h / 2 - fontSize * 0.75,
      width: measureText(node.label, fontSize).width,
      height: fontSize * 1.5,
      text: node.label,
      fontSize,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      baseline: fontSize,
      containerId: null,
      originalText: node.label,
      lineHeight: 1.25,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      roundness: null,
    }
    elements.push(textEl)
  }

  // 2. 生成箭头
  for (const edge of edges) {
    const fromPos = positions.get(edge.from)
    const toPos = positions.get(edge.to)
    if (!fromPos || !toPos) continue

    const fromSize = nodeSizes.get(edge.from) || { w: NODE_W, h: NODE_H }
    const toSize = nodeSizes.get(edge.to) || { w: NODE_W, h: NODE_H }

    // 计算起点和终点（从节点边缘出发）
    let sx, sy, ex, ey
    if (isHorizontal) {
      sx = fromPos.x + fromSize.w
      sy = fromPos.y + fromSize.h / 2
      ex = toPos.x
      ey = toPos.y + toSize.h / 2
    } else {
      sx = fromPos.x + fromSize.w / 2
      sy = fromPos.y + fromSize.h
      ex = toPos.x + toSize.w / 2
      ey = toPos.y
    }

    const dx = ex - sx
    const dy = ey - sy

    const arrowEl = {
      ...makeBase('arrow'),
      x: sx,
      y: sy,
      width: Math.abs(dx),
      height: Math.abs(dy),
      points: [[0, 0], [dx, dy]],
      strokeColor: '#868e96',
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: 'arrow',
    }
    elements.push(arrowEl)

    // 边标签
    if (edge.label) {
      const labelEl = {
        ...makeBase('text'),
        x: sx + dx / 2 - 20,
        y: sy + dy / 2 - 10,
        width: 80,
        height: 20,
        text: edge.label,
        fontSize: 14,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        baseline: 14,
        containerId: null,
        originalText: edge.label,
        lineHeight: 1.25,
        strokeColor: '#495057',
        backgroundColor: 'transparent',
        roundness: null,
      }
      elements.push(labelEl)
    }
  }

  return elements
}

// ─── 时序图布局 + 渲染 ─────────────────────────────

function layoutAndRenderSequence(graph, offsetX = 100, offsetY = 100) {
  const { participants, messages } = graph
  const elements = []
  const PART_W = 120
  const PART_H = 40
  const PART_GAP = 60
  const MSG_GAP = 50
  const totalH = (messages.length + 2) * MSG_GAP + PART_H * 2

  // 参与者位置
  const partPos = new Map()
  participants.forEach((p, i) => {
    const x = offsetX + i * (PART_W + PART_GAP)
    partPos.set(p.id, x)
  })

  // 上方参与者方框 + 生命线
  let colorIdx = 0
  for (const p of participants) {
    const x = partPos.get(p.id)
    const color = PALETTE[colorIdx++ % PALETTE.length]

    // 顶部方框
    elements.push({
      ...makeBase('rectangle'),
      x: x, y: offsetY,
      width: PART_W, height: PART_H,
      strokeColor: color.stroke, backgroundColor: color.bg,
    })
    elements.push({
      ...makeBase('text'),
      x: x + PART_W / 2 - measureText(p.label, 14).width / 2 + 12,
      y: offsetY + PART_H / 2 - 10,
      width: measureText(p.label, 14).width, height: 20,
      text: p.label, fontSize: 14, fontFamily: 1, textAlign: 'center',
      verticalAlign: 'middle', baseline: 14, containerId: null,
      originalText: p.label, lineHeight: 1.25,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent', roundness: null,
    })

    // 生命线（虚线）
    const lifelineX = x + PART_W / 2
    elements.push({
      ...makeBase('line'),
      x: lifelineX, y: offsetY + PART_H,
      width: 0, height: totalH - PART_H * 2,
      points: [[0, 0], [0, totalH - PART_H * 2]],
      strokeColor: '#adb5bd', strokeStyle: 'dashed',
      startArrowhead: null, endArrowhead: null,
    })
  }

  // 消息箭头
  messages.forEach((msg, i) => {
    const fromX = partPos.get(msg.from)
    const toX = partPos.get(msg.to)
    if (fromX == null || toX == null) return

    const y = offsetY + PART_H + (i + 1) * MSG_GAP
    const sx = (fromX < toX ? fromX : fromX) + PART_W / 2
    const ex = (toX < fromX ? toX : toX) + PART_W / 2
    const dx = ex - sx

    elements.push({
      ...makeBase('arrow'),
      x: sx, y: y,
      width: Math.abs(dx), height: 0,
      points: [[0, 0], [dx, 0]],
      strokeColor: msg.isDashed ? '#868e96' : '#495057',
      strokeStyle: msg.isDashed ? 'dashed' : 'solid',
      lastCommittedPoint: null,
      startBinding: null, endBinding: null,
      startArrowhead: null, endArrowhead: 'arrow',
    })

    // 消息标签
    if (msg.label) {
      const labelW = measureText(msg.label, 13).width
      elements.push({
        ...makeBase('text'),
        x: sx + dx / 2 - labelW / 2 + 12,
        y: y - 18,
        width: labelW, height: 16,
        text: msg.label, fontSize: 13, fontFamily: 1, textAlign: 'center',
        verticalAlign: 'middle', baseline: 13, containerId: null,
        originalText: msg.label, lineHeight: 1.25,
        strokeColor: '#495057', backgroundColor: 'transparent', roundness: null,
      })
    }
  })

  return elements
}

// ─── 主流程：AI → Mermaid → 解析 → 布局 → 元素 ─────

const MERMAID_PROMPT_CONVERT = `请将以下 Markdown 笔记内容转换为 Mermaid 图表（选择最合适的图表类型：流程图 graph TD/LR、思维导图 mindmap 或时序图 sequenceDiagram），要求结构清晰、层级合理：

`

const MERMAID_PROMPT_GENERATE = `请根据以下描述生成 Mermaid 图表（选择最合适的图表类型：流程图 graph TD/LR、思维导图 mindmap 或时序图 sequenceDiagram），要求结构清晰：

`

/**
 * 使用 AI 将 Markdown 内容转换为 Excalidraw 白板数据
 * AI 输出 Mermaid → 本地解析布局 → Excalidraw 元素
 */
export async function aiConvertMarkdownToWhiteboard(markdownContent) {
  logger.log('[aiExcalidrawGenerator] 开始 AI Mermaid 转换，内容长度:', markdownContent?.length)

  const messages = [
    { role: 'system', content: MERMAID_SYSTEM_PROMPT },
    { role: 'user', content: MERMAID_PROMPT_CONVERT + markdownContent },
  ]

  const res = await window.electronAPI.ai.chat(messages, {})
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || 'AI 调用失败')
  }

  const mermaidCode = extractMermaid(res.data.content)
  logger.log('[aiExcalidrawGenerator] AI 返回 Mermaid:\n', mermaidCode)

  const elements = mermaidToElements(mermaidCode)
  logger.log('[aiExcalidrawGenerator] 生成元素数量:', elements.length)

  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'Flota-local',
    elements,
    appState: {
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1,
      gridSize: null,
    },
    fileMap: {},
  })
}

/**
 * 使用 AI 基于描述和现有白板数据生成新元素
 * @param {string} description - 用户描述
 * @param {Array} existingElements - 现有白板元素
 * @returns {Promise<Array>} 新生成的 Excalidraw 元素数组
 */
export async function aiGenerateExcalidrawElements(description, existingElements = []) {
  // 计算偏移量，避免与现有内容重叠
  let offsetX = 100, offsetY = 100
  if (existingElements.length > 0) {
    const maxX = Math.max(...existingElements.map(e => (e.x ?? 0) + (e.width ?? 0)))
    const maxY = Math.max(...existingElements.map(e => (e.y ?? 0) + (e.height ?? 0)))
    // 放在现有内容右侧或下方
    offsetX = maxX + 150
    offsetY = 100
  }

  logger.log('[aiExcalidrawGenerator] AI Mermaid 生成，描述:', description)

  const messages = [
    { role: 'system', content: MERMAID_SYSTEM_PROMPT },
    { role: 'user', content: MERMAID_PROMPT_GENERATE + description },
  ]

  const res = await window.electronAPI.ai.chat(messages, {})
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || 'AI 调用失败')
  }

  const mermaidCode = extractMermaid(res.data.content)
  logger.log('[aiExcalidrawGenerator] AI 返回 Mermaid:\n', mermaidCode)

  return mermaidToElements(mermaidCode, offsetX, offsetY)
}

/**
 * Mermaid 代码 → Excalidraw 元素（完整流水线）
 */
function mermaidToElements(mermaidCode, offsetX = 100, offsetY = 100) {
  const graph = parseMermaid(mermaidCode)

  if (graph.type === 'mindmap') {
    const { positions, nodes, edges } = layoutMindmap(graph.tree, offsetX, offsetY)
    return graphToElements(nodes, edges, positions, true)
  }

  if (graph.type === 'sequence') {
    return layoutAndRenderSequence(graph, offsetX, offsetY)
  }

  // flowchart
  const isHorizontal = graph.direction === 'LR' || graph.direction === 'RL'
  const positions = layoutFlowchart(graph, offsetX, offsetY)
  return graphToElements(graph.nodes, graph.edges, positions, isHorizontal)
}
