/**
 * AI 白板图表生成器（Composition IR 架构）
 *
 * 流程：
 *   1) AI 规划画布：输出 outline（描述这张画布上要有哪些区块/自由要素）
 *   2) 对每个需要 DSL 的区块（block.kind ∈ 已注册类型），AI 单独产出 DSL
 *   3) 组装 IR → 渲染成 Excalidraw 元素
 *
 * 兼容点：
 *   - 单一图表场景仍然成立（outline 只产出 1 个 block）
 *   - AI 可输出 freeform.graph (nodes/edges) 直接表示自由结构
 *   - 支持便签/标注/分组框/跨区连接，无需为每种新画法都写代码
 */
import logger from './logger'
import { computeOffset, DIAGRAM_THEME } from './diagrams/shared'
import { renderMermaidNative } from './diagrams/mermaidNative'
import { renderMindmap } from './diagrams/mindmap'
import { renderGantt } from './diagrams/gantt'
import { renderFishbone } from './diagrams/fishbone'
import { renderTimeline, renderQuadrant, renderPie } from './diagrams/extras'
import { renderComposition } from './diagrams/compositionRenderer'
import { IR_VERSION, KNOWN_BLOCK_KINDS, getBlockTier, validateIR, wrapSingleBlockAsIR } from './diagrams/composition'

// ─── 已注册图表类型元信息（供 AI 选用）─────────────
//
// 每个类型显式标注 tier：
//   tier 1 — 官方 Mermaid 原生矢量（flowchart/sequence/class/state/er）
//   tier 2 — 自研矢量渲染（mindmap/fishbone/gantt/timeline/quadrant/pie）
//   tier 3 — 官方 Mermaid 图片快照（architecture，目前唯一）

const BLOCK_TYPES = {
  flowchart: { label: '流程图', tier: 1, use: '步骤流程、分支决策', dslHint: 'flowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]' },
  sequence: { label: '时序图', tier: 1, use: '多角色交互、API 调用', dslHint: 'sequenceDiagram\n  participant 用户\n  participant 服务\n  用户->>服务: 请求' },
  class: { label: '类图', tier: 1, use: '面向对象建模', dslHint: 'classDiagram\n  class Order {\n    +id\n    +submit()\n  }' },
  state: { label: '状态图', tier: 1, use: '状态机、UI 状态切换', dslHint: 'stateDiagram-v2\n  [*] --> 待处理\n  待处理 --> 进行中: 受理' },
  er: { label: 'ER 图', tier: 1, use: '数据库表设计、实体关系', dslHint: 'erDiagram\n  CUSTOMER ||--o{ ORDER : 下单' },

  mindmap: { label: '思维导图', tier: 2, use: '主题归纳、知识树', dslHint: 'mindmap\n  root((中心))\n    分支A\n      子节点' },
  gantt: { label: '甘特图', tier: 2, use: '项目排期、依赖关系', dslHint: 'gantt\n  title 计划\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  任务A :a1, 2025-01-01, 3d' },
  fishbone: { label: '鱼骨图', tier: 2, use: '根因分析', dslHint: 'fishbone\nproblem: 项目延期\nbone: 人\n  - 招聘困难\nbone: 流程\n  - 评审冗长' },
  timeline: { label: '时间轴', tier: 2, use: '历史事件/里程碑', dslHint: 'timeline\n  title 项目里程碑\n  2024-01 : 启动\n  2024-03 : 原型完成' },
  quadrant: { label: '四象限', tier: 2, use: '二维定位/优先级矩阵', dslHint: 'quadrantChart\n  title 重要紧急\n  x-axis 不重要 --> 重要\n  y-axis 不紧急 --> 紧急\n  "需求评审": [0.7, 0.8]' },
  pie: { label: '饼图', tier: 2, use: '占比构成', dslHint: 'pie title 销售构成\n  "服装" : 45\n  "鞋类" : 25' },

  architecture: {
    label: '架构图',
    tier: 3,
    use: '技术架构、系统分层、平台能力地图（图片快照，不可拆元素编辑）',
    dslHint: 'block-beta\ncolumns 1\naccess["接入层\\nWeb站点 / App / API网关"]\nplatform["平台技术层\\n云原生 / 大数据平台 / AI大模型 / 推荐引擎"]\ndata["数据与基础设施层\\nMySQL / Redis / MQ / 对象存储 / 网络"]\naccess --> platform\nplatform --> data',
  },
}

// ─── Stage A：画布规划（outline） ───────────────────

const buildOutlineMessages = (userRequest) => {
  const tierLabel = (t) => (t === 1 ? '★Tier1 原生可编辑' : t === 2 ? '☆Tier2 自研可编辑' : '◐Tier3 图片快照（不可拆图元）')
  const blockList = Object.entries(BLOCK_TYPES).map(([k, v]) => `- ${k} (${v.label} | ${tierLabel(v.tier || getBlockTier(k))}): ${v.use}`).join('\n')
  return [
    {
      role: 'system',
      content: `你是 Flota 白板规划师，负责为用户素材设计一张完整的画布。
你不是单选一种图，而是规划"由哪些区块/便签/分组/连接线组合成"。

可选区块类型 (block)（带能力分层 tier）：
${blockList}

类型选择优先级（重要）：
- 优先选 Tier1：原生可编辑、视觉最佳，能用就用
- 其次选 Tier2：自研可编辑，覆盖 Tier1 不擅长的语义（如 思维导图/鱼骨/时间轴/四象限/饼图/甘特）
- 仅当用户**明确**要求架构图/分层架构/能力地图/技术栈分层时，才使用 Tier3 (architecture)
  Tier3 是图片快照，不可拆图元编辑，用户只能改 DSL 重画。不要为了"看起来高大上"滥用 Tier3。

也可以使用：
- freeform：自由节点边图，给一个 graph: { nodes:[{id,label}], edges:[{from,to,label?}] }
- group：分组框（包住 children id 列表，画带标题的虚线圆角框）
- sticky：便签便条 (color: yellow|pink|green|blue)
- callout：文字标注/说明气泡
- text：纯文字标题

返回严格 JSON，禁止任何 Markdown 标记：
{
  "title": "<整张画布的标题，可选>",
  "nodes": [
    {
      "id": "n1",
      "kind": "block" | "freeform" | "group" | "sticky" | "callout" | "text",
      "blockType": "<仅当 kind=block 时填，从可选区块类型里选一个>",
      "summary": "<这个区块要画什么的中文说明，不要在 outline 阶段写 DSL>",
      "graph": { "nodes":[...], "edges":[...] }, // 仅当 kind=freeform 时填
      "children": ["n2","n3"], // 仅 group
      "text": "...", // sticky/callout/text 必填
      "color": "yellow", // sticky 可选
      "title": "...", // group 标题
      "layout": { "region": "left" | "right" | "top" | "bottom" | "center" | "absolute", "x": 0, "y": 0 }
    }
  ],
  "connectors": [
    { "from": "n1", "to": "n2", "label": "触发", "dashed": false }
  ]
}

规划原则：
1. 单一主题/单一图表 → 只输出 1 个 block 节点；不要为简单需求强行拼装
2. 复合主题（如"项目作战图：流程+排期+根因"）→ 多 block + group 包裹 + connector 串联
3. 节点 id 用 n1/n2/... 短字符串，禁止重复
4. 已注册类型优先用 block；只有没合适类型时才用 freeform
5. layout.region 默认按"主图 center / 辅图 left|right / 标题 top / 注解 bottom"安排
6. 不要在 outline 里写 DSL，只写 summary。DSL 在下一阶段单独生成
7. 禁止生成"图表规范/Mermaid 介绍"等元信息节点`,
    },
    { role: 'user', content: userRequest },
  ]
}

const safeJsonExtract = (text) => {
  if (!text) return null
  let s = String(text).trim()
  s = s.replace(/^```[\w-]*\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(s.slice(start, end + 1)) } catch (e) {
    logger.warn('[outline] JSON 解析失败:', e.message)
    return null
  }
}

const planComposition = async (userRequest) => {
  const res = await window.electronAPI.ai.chat(
    buildOutlineMessages(userRequest),
    { temperature: 0.3, maxTokens: 1500 },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || '画布规划失败')
  }
  const parsed = safeJsonExtract(res.data.content)
  if (!parsed) throw new Error('画布规划返回格式错误')
  return parsed
}

// ─── Stage B：为每个 block 生成具体 DSL ─────────────

const buildDslMessages = (blockType, summary) => {
  const def = BLOCK_TYPES[blockType]
  if (!def) throw new Error(`未知 block 类型: ${blockType}`)
  const extraRules = blockType === 'architecture'
    ? '\n5. 必须使用 Mermaid 官方 block-beta 语法，第一行必须是 block-beta\n6. 只允许使用 columns、块定义、箭头连接这类官方 block-beta 语法，禁止自定义 DSL\n7. 尽量按分层结构输出 3-5 个主块，每个块里概括一层能力，中文内容写在 ["..."] 标签里\n8. 优先生成适合技术架构/能力地图的分层块图，不要退化成流程图或思维导图\n9. 控制文本密度，单个块内最多 3-6 个短语，用 / 或换行分隔'
    : ''
  return [
    {
      role: 'system',
      content: `你是 ${def.label} 生成专家。根据简要说明，输出严格符合 ${blockType} DSL 语法的代码。

要求：
1. 只输出 DSL 代码本身，禁止任何解释、Markdown 代码块标记、前后说明
2. 节点文字必须贴近真实素材内容，禁止生成"图表规范/类型说明"等元信息
3. 节点文字简洁，每个节点不超过 20 个字
4. 控制规模：4-12 个核心元素${extraRules}

DSL 示例：
${def.dslHint}`,
    },
    { role: 'user', content: summary },
  ]
}

const stripCodeFence = (text) => String(text || '').trim()
  .replace(/^```[\w-]*\s*\n?/i, '')
  .replace(/\n?```\s*$/i, '')
  .trim()

const generateDsl = async (blockType, summary) => {
  const res = await window.electronAPI.ai.chat(
    buildDslMessages(blockType, summary),
    { temperature: 0.4 },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(`${blockType} DSL 生成失败`)
  }
  return stripCodeFence(res.data.content)
}

// ─── 把 outline 填充成可渲染的 IR ────────────────────

const materializeIR = async (outline) => {
  const ir = {
    version: IR_VERSION,
    title: outline.title || '',
    canvas: {},
    nodes: [],
    connectors: outline.connectors || [],
  }
  // 并行产 DSL
  const dslJobs = []
  const dslFailures = []
  let dslBlockCount = 0
  for (const node of outline.nodes || []) {
    if (node.kind === 'block') {
      dslBlockCount += 1
      if (!KNOWN_BLOCK_KINDS.has(node.blockType)) {
        logger.warn(`[outline] 未知 blockType=${node.blockType}，降级为 mindmap`)
        node.blockType = 'mindmap'
      }
      dslJobs.push(generateDsl(node.blockType, node.summary || node.title || node.id).then((dsl) => {
        ir.nodes.push({
          id: node.id,
          kind: 'block',
          blockType: node.blockType,
          tier: getBlockTier(node.blockType),
          dsl,
          layout: node.layout || { region: 'center' },
        })
      }).catch((err) => {
        logger.warn(`[outline] block ${node.id} DSL 失败:`, err.message)
        dslFailures.push({
          id: node.id,
          blockType: node.blockType,
          message: err.message || 'DSL 生成失败',
        })
      }))
    } else if (node.kind === 'freeform') {
      ir.nodes.push({
        id: node.id,
        kind: 'freeform',
        graph: node.graph || { nodes: [], edges: [] },
        layout: node.layout || { region: 'center' },
      })
    } else if (node.kind === 'group') {
      ir.nodes.push({
        id: node.id,
        kind: 'group',
        title: node.title || '',
        children: node.children || [],
        color: node.color,
        layout: node.layout || {},
      })
    } else if (node.kind === 'sticky' || node.kind === 'callout' || node.kind === 'text') {
      ir.nodes.push({
        id: node.id,
        kind: node.kind,
        text: node.text || '',
        color: node.color,
        fontSize: node.fontSize,
        layout: node.layout || {},
      })
    }
  }
  await Promise.all(dslJobs)

  if (dslFailures.length > 0) {
    const failedIds = new Set(dslFailures.map(item => item.id))
    const hasRenderableNode = ir.nodes.some((node) => {
      if (!node || node.kind === 'group') return false
      if (node.kind === 'freeform') return Array.isArray(node.graph?.nodes) && node.graph.nodes.length > 0
      if (node.kind === 'sticky' || node.kind === 'callout' || node.kind === 'text') return Boolean(String(node.text || '').trim())
      return true
    })

    if (dslFailures.length === dslBlockCount && !hasRenderableNode) {
      throw new Error(`所有图表区块 DSL 生成失败: ${dslFailures.map(item => `${item.id}(${item.blockType})`).join(', ')}`)
    }

    ir.connectors = (ir.connectors || []).filter((connector) =>
      !failedIds.has(connector?.from) && !failedIds.has(connector?.to)
    )
    ir.warnings = dslFailures.map(item => `区块 ${item.id}(${item.blockType}) 未生成: ${item.message}`)
  }

  if (!ir.nodes.some(node => node && node.kind !== 'group')) {
    throw new Error('画布没有可渲染内容')
  }

  validateIR(ir)
  return ir
}

// ─── 兼容旧路径：单一图表快路径 ─────────────────────

const wrapPlain = (elements) => ({ elements, files: {} })

const SIMPLE_RENDERERS = {
  architecture: async (dsl, off) => {
    const r = await renderMermaidNative(dsl, off)
    return { elements: r.elements, files: r.files || {} }
  },
  flowchart: async (dsl, off) => {
    const r = await renderMermaidNative(dsl, off)
    return { elements: r.elements, files: r.files || {} }
  },
  sequence: async (dsl, off) => {
    const r = await renderMermaidNative(dsl, off)
    return { elements: r.elements, files: r.files || {} }
  },
  class: async (dsl, off) => {
    const r = await renderMermaidNative(dsl, off)
    return { elements: r.elements, files: r.files || {} }
  },
  state: async (dsl, off) => {
    const r = await renderMermaidNative(dsl, off)
    return { elements: r.elements, files: r.files || {} }
  },
  er: async (dsl, off) => {
    const r = await renderMermaidNative(dsl, off)
    return { elements: r.elements, files: r.files || {} }
  },
  mindmap: (dsl, off) => Promise.resolve(wrapPlain(renderMindmap(dsl, off))),
  gantt: (dsl, off) => Promise.resolve(wrapPlain(renderGantt(dsl, off))),
  fishbone: (dsl, off) => Promise.resolve(wrapPlain(renderFishbone(dsl, off))),
  timeline: (dsl, off) => Promise.resolve(wrapPlain(renderTimeline(dsl, off))),
  quadrant: (dsl, off) => Promise.resolve(wrapPlain(renderQuadrant(dsl, off))),
  pie: (dsl, off) => Promise.resolve(wrapPlain(renderPie(dsl, off))),
}

const isSingleBlockOutline = (outline) =>
  Array.isArray(outline?.nodes) &&
  outline.nodes.length === 1 &&
  outline.nodes[0].kind === 'block'

// ─── 对外主入口 ────────────────────────────────────

export async function aiGenerateExcalidrawElements(description, existingElements = []) {
  const offsets = computeOffset(existingElements)
  logger.log('[aiExcalidrawGenerator] 输入:', description, 'offset:', offsets)
  const looksLikeArchitecture = /架构图|技术架构|系统架构|架构设计|分层架构|能力地图/.test(String(description || ''))

  let outline
  try {
    outline = await planComposition(description)
  } catch (e) {
    if (looksLikeArchitecture) {
      logger.warn('[aiExcalidrawGenerator] 架构图规划失败，直接尝试官方 block-beta:', e.message)
      const dsl = await generateDsl('architecture', description)
      return SIMPLE_RENDERERS.architecture(dsl, offsets)
    }
    logger.warn('[aiExcalidrawGenerator] 规划失败，回退单 mindmap:', e.message)
    const dsl = await generateDsl('mindmap', description)
    return wrapPlain(renderMindmap(dsl, offsets))
  }

  // 单区块场景走快路径，避免不必要的 IR 编排开销
  if (isSingleBlockOutline(outline)) {
    const node = outline.nodes[0]
    const blockType = KNOWN_BLOCK_KINDS.has(node.blockType) ? node.blockType : 'mindmap'
    const dsl = await generateDsl(blockType, node.summary || description)
    logger.log(`[aiExcalidrawGenerator] 单块路径 type=${blockType}`)
    try {
      return await SIMPLE_RENDERERS[blockType](dsl, offsets)
    } catch (err) {
      if (blockType === 'architecture') {
        logger.warn('[aiExcalidrawGenerator] 官方架构图渲染失败:', err.message)
        throw err
      }
      logger.warn(`[aiExcalidrawGenerator] ${blockType} 渲染失败，回退 mindmap:`, err.message)
      const fb = await generateDsl('mindmap', description)
      return wrapPlain(renderMindmap(fb, offsets))
    }
  }

  // 多区块/复合路径：组装 IR 渲染
  let ir
  try {
    ir = await materializeIR(outline)
  } catch (e) {
    logger.warn('[aiExcalidrawGenerator] IR 物化失败，回退单 mindmap:', e.message)
    const dsl = await generateDsl('mindmap', description)
    return wrapPlain(renderMindmap(dsl, offsets))
  }
  logger.log('[aiExcalidrawGenerator] IR 节点数:', ir.nodes.length, 'connectors:', ir.connectors.length)
  try {
    const result = await renderComposition(ir, offsets)
    if (Array.isArray(result)) return { ...wrapPlain(result), warnings: ir.warnings || [] }
    return { elements: result.elements || [], files: result.files || {}, warnings: ir.warnings || [] }
  } catch (err) {
    logger.error('[aiExcalidrawGenerator] IR 渲染失败:', err)
    const firstBlock = ir.nodes.find((n) => n.kind === 'block')
    if (firstBlock) return SIMPLE_RENDERERS[firstBlock.blockType](firstBlock.dsl, offsets)
    throw err
  }
}

/**
 * 把整篇 Markdown 转白板（用于"内容转白板"按钮）
 */
export async function aiConvertMarkdownToWhiteboard(markdownContent) {
  const result = await aiGenerateExcalidrawElements(markdownContent, [])
  const elements = Array.isArray(result) ? result : (result.elements || [])
  const fileMap = Array.isArray(result) ? {} : (result.files || {})
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'Flota-local',
    elements,
    appState: {
      viewBackgroundColor: DIAGRAM_THEME.canvas,
      currentItemFontFamily: 1,
      gridSize: null,
    },
    fileMap,
  })
}

/**
 * 调试导出
 */
export const __debug = {
  planComposition,
  generateDsl,
  materializeIR,
  BLOCK_TYPES,
  wrapSingleBlockAsIR,
}
