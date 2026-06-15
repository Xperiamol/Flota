/**
 * Composition IR（画布组合中间表示）
 *
 * 设计目标：让 AI 能在一张画布上自由组合多种图表 + 自由要素，
 * 摆脱"一次只能选一种类型"的硬编码束缚。
 *
 * IR 顶层：
 *   {
 *     version: 1,
 *     title?: string,
 *     canvas: { width?, height? },
 *     nodes: CompositionNode[]      // 区块/分组/便签/自由图等一切顶层要素
 *     connectors: Connector[]       // 跨节点连接线（用 anchor id 寻址）
 *   }
 *
 * 节点种类（kind）：
 *   block     — 已注册图表区块（architecture/flowchart/sequence/class/state/er/mindmap/gantt/fishbone/timeline/quadrant/pie）
 *   freeform  — 自由节点边图（AI 出 nodes+edges，本地布局引擎排坐标）
 *   group     — 分组框，children 为内部节点 id 列表，渲染为带标题的圆角虚线框
 *   sticky    — 便签便条
 *   callout   — 文字标注/说明气泡
 *   text      — 纯文字标题
 *
 * 布局策略（layout.region）：
 *   row | column | grid | absolute | center | left | right | top | bottom
 *   其中 absolute 必须给出 x, y
 */

export const IR_VERSION = 1

export const KNOWN_BLOCK_KINDS = new Set([
  'architecture',
  'flowchart', 'sequence', 'class', 'state', 'er',
  'mindmap', 'hierarchy', 'gantt', 'fishbone', 'timeline', 'quadrant', 'pie',
])

/**
 * 能力分层：
 *   Tier 1 — 官方原生 Mermaid，矢量图元，可拆分编辑（最佳手感）
 *   Tier 2 — 自研渲染器，矢量图元，可拆分编辑（视觉一致性由本工程负责）
 *   Tier 3 — 官方 Mermaid 回退图片快照，不可拆分编辑（可双击改 DSL 重画）
 *
 * 这是显式分发表，未来加新类型只动这张表，不再回到 switch(type) 的硬编码。
 */
export const BLOCK_TIER = {
  flowchart: 1,
  sequence: 1,
  class: 1,
  state: 1,
  er: 1,

  mindmap: 2,
  hierarchy: 2,
  fishbone: 2,
  timeline: 2,
  quadrant: 2,
  pie: 2,
  gantt: 2,

  architecture: 3,
}

export const getBlockTier = (blockType) => BLOCK_TIER[blockType] || 2

export const validateIR = (ir) => {
  if (!ir || typeof ir !== 'object') throw new Error('IR 必须是对象')
  if (ir.version !== IR_VERSION) throw new Error(`IR 版本不匹配，期望 ${IR_VERSION}`)
  if (!Array.isArray(ir.nodes)) throw new Error('IR.nodes 必须是数组')
  const ids = new Set()
  for (const node of ir.nodes) {
    if (!node?.id) throw new Error('每个节点必须有 id')
    if (ids.has(node.id)) throw new Error(`节点 id 重复: ${node.id}`)
    ids.add(node.id)
    validateNode(node)
  }
  if (ir.connectors) {
    if (!Array.isArray(ir.connectors)) throw new Error('IR.connectors 必须是数组')
    for (const conn of ir.connectors) {
      if (!conn.from || !conn.to) throw new Error('connector 必须包含 from/to')
    }
  }
  return ir
}

const validateNode = (node) => {
  switch (node.kind) {
    case 'block':
      if (!KNOWN_BLOCK_KINDS.has(node.blockType)) {
        throw new Error(`未知 block 类型: ${node.blockType}`)
      }
      if (typeof node.dsl !== 'string' || !node.dsl.trim()) {
        throw new Error(`block ${node.id} 缺少 dsl`)
      }
      break
    case 'freeform':
      if (!Array.isArray(node.graph?.nodes)) throw new Error('freeform 缺少 graph.nodes')
      if (!Array.isArray(node.graph?.edges)) node.graph.edges = []
      break
    case 'group':
      if (!Array.isArray(node.children)) throw new Error('group 缺少 children')
      break
    case 'sticky':
    case 'callout':
    case 'text':
      if (typeof node.text !== 'string') throw new Error(`${node.kind} 缺少 text`)
      break
    default:
      throw new Error(`未知节点类型: ${node.kind}`)
  }
}

/**
 * 把单一图表（旧路径）包装成最小 IR，复用 IR 渲染管线
 */
export const wrapSingleBlockAsIR = ({ blockType, dsl, title }) => ({
  version: IR_VERSION,
  title,
  canvas: {},
  nodes: [
    {
      id: 'b1',
      kind: 'block',
      blockType,
      tier: getBlockTier(blockType),
      dsl,
      layout: { region: 'center' },
    },
  ],
  connectors: [],
})
