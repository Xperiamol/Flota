/**
 * AI 画布图表生成器
 *
 * 流程：
 *   1) 本地规则识别明确的 Mermaid / 整体 SVG 请求
 *   2) 其余交给 Composer 生成可编辑布局
 *   3) Composer 可在原生图元之间穿插局部 SVG
 */
import logger from './logger'
import { computeOffset, DIAGRAM_THEME } from './diagrams/shared'
import { renderMermaidNative } from './diagrams/mermaidNative'
import { renderComposer } from './diagrams/composer'
import { createSvgAsset } from './diagrams/svgAsset'

// 只有 Mermaid 快路径需要 DSL 元信息；其它类型统一由 Composer 描述。

const MERMAID_BLOCKS = {
  flowchart: { label: '流程图', dslHint: 'flowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]' },
  sequence: { label: '时序图', dslHint: 'sequenceDiagram\n  participant 用户\n  participant 服务\n  用户->>服务: 请求' },
  class: { label: '类图', dslHint: 'classDiagram\n  class Order {\n    +id\n    +submit()\n  }' },
  state: { label: '状态图', dslHint: 'stateDiagram-v2\n  [*] --> 待处理\n  待处理 --> 进行中: 受理' },
  er: { label: 'ER 图', dslHint: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    int id PK\n    string name\n  }' },
}

const MERMAID_BLOCK_TYPES = new Set(Object.keys(MERMAID_BLOCKS))

const safeJsonExtract = (text) => {
  if (!text) return null
  let s = String(text).trim()
  s = s.replace(/^```[\w-]*\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(s.slice(start, end + 1)) } catch (e) {
    logger.warn('[composer] JSON 解析失败:', e.message)
    return null
  }
}

const buildComposerRepairMessages = (userRequest, brokenOutput) => [
  {
    role: 'system',
    content: `你是 Flota 的 JSON 修复器。你的唯一任务是把一段“接近合法 JSON、但格式损坏”的画布描述修成严格合法 JSON。

要求：
1. 只返回 JSON 本身，禁止 Markdown、解释、注释、前后说明
2. 保留原有信息结构与语义，不要改成别的题材
3. 输出结构必须符合：
{
  "title": "<可选>",
  "layout": { "type": "stack.v"|"stack.h"|"grid", "gap"?: 32, "cols"?: 3, "align"?: "..." },
  "children": [ ... ],
  "connectors": [ { "from": "<id>", "to": "<id>", "label"?: "...", "dashed"?: false, "tone"?: "primary" } ]
}
4. children 必须是节点数组；节点结构为 { "type": "...", "props"?: { ... }, "children"?: [ ... ] }
5. 不要输出 //、/* */、尾随逗号、半截字符串、半截括号
6. 可读性优先：不要把大段正文塞进单个节点，主要信息优先用 h1/h2/h3/body，不要把核心内容放进 caption`,
  },
  {
    role: 'user',
    content: `原始用户需求：\n${String(userRequest || '')}\n\n待修复内容：\n${String(brokenOutput || '')}`,
  },
]

const repairComposerJSON = async (userRequest, brokenOutput) => {
  const res = await window.electronAPI.ai.chat(
    buildComposerRepairMessages(userRequest, brokenOutput),
    { temperature: 0, timeoutMs: 600000, bypassTokenLimit: true },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || 'Composer JSON 二次修复失败')
  }
  return res.data.content
}

const parseComposerCanvasResponse = async (userRequest, rawContent) => {
  const parsed = safeJsonExtract(rawContent)
  if (parsed) return parsed
  logger.warn('[composer] 首次 JSON 解析失败，尝试二次 AI 修复')
  const repairedContent = await repairComposerJSON(userRequest, rawContent)
  const repaired = safeJsonExtract(repairedContent)
  if (!repaired) {
    throw new Error('Composer JSON 二次修复后仍不合法')
  }
  return repaired
}

const isContentBlockedError = (error) => /blocked|content.*blocked|machine outputted|安全|拦截|审核|风控/i.test(String(error?.message || error || ''))

// 网络层错误（请求未成功发出/被中断/超时）：应直接向上抛出，由 UI 给用户明确反馈
const isNetworkError = (error) => /fetch failed|network|网络|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|timeout|超时|aborted|abort/i.test(String(error?.message || error || ''))

// 上游网关瞬时故障（502/503/504/429）：AI 服务商临时不可用，稍后重试即可恢复
const isGatewayError = (error) => /请求失败 \((?:429|502|503|504)\)|\b(?:502|503|504)\b|bad gateway|gateway timeout|service unavailable|too many requests|rate limit/i.test(String(error?.message || error || ''))

const normalizeWhiteboardError = (error) => {
  if (isContentBlockedError(error)) return new Error('模型内容审核拦截，无法生成该画布')
  if (isGatewayError(error)) return new Error('AI 服务暂时不可用（网关繁忙），请稍后重试')
  if (isNetworkError(error)) return new Error('网络请求失败，请检查网络或 AI 配置后重试')
  return error instanceof Error ? error : new Error(String(error || '画布生成失败'))
}

const shouldUseModelReflection = (error) => (
  !isContentBlockedError(error) &&
  !isGatewayError(error) &&
  !isNetworkError(error)
)

const compactFeedbackPayload = (value, maxLen = 12000) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!s) return ''
  return s.length > maxLen ? `${s.slice(0, maxLen)}\n...（内容过长已截断）` : s
}

const inferDiagramIntentHeuristically = (text) => {
  const s = String(text || '')
  if (!s.trim()) return { mode: 'composition', blockType: null, reason: '空请求默认交给组合规划' }
  const avoidsSvg = /(?:不要|不用|禁止|避免|无需).{0,8}(?:svg|矢量|图片)|可编辑|可拆分|逐个修改|单独修改|方便修改/i.test(s)
  const forcesSvg = /^\s*以\s*SVG\s*矢量图呈现|只(?:用|要).{0,8}(?:svg|矢量)|(?:全部|整体).{0,8}(?:svg|矢量)/i.test(s)
  const asksSvg = /(?:svg|矢量(?:图|插画|视觉|海报|图形)?)/i.test(s)
  const needsEditableStructure = /流程|架构|脑图|思维导图|组织|层级|关系|时序|状态|ER图|数据库|甘特|排期|四象限|鱼骨|看板|原型|表格/i.test(s)
  const benefitsFromArtwork = /插画|视觉|信息图|科普图|示意图|主视觉|内容丰富|生动|穿插|混合|图文/i.test(s)
  if (!avoidsSvg && forcesSvg) {
    return { mode: 'single', blockType: 'svg', reason: '用户明确指定 SVG/矢量成图' }
  }
  if (!avoidsSvg && needsEditableStructure && (asksSvg || benefitsFromArtwork)) {
    return { mode: 'composition', blockType: null, reason: '结构图与视觉插画混合生成' }
  }
  if (!avoidsSvg && asksSvg) {
    return { mode: 'single', blockType: 'svg', reason: '用户明确指定 SVG/矢量成图' }
  }
  if (!avoidsSvg && !needsEditableStructure && /海报|封面|宣传图|主视觉|插画|视觉卡片|品牌视觉|概念视觉|装饰图|一图看懂/i.test(s)) {
    return { mode: 'single', blockType: 'svg', reason: '成品视觉优先整体 SVG 表现' }
  }
  if (/对比.*流程|同时.*流程|流程.*时间轴|一张图.*包含|作战图|全景图|看板|汇总到一张|多个图|组合图|复合图/.test(s)) {
    return { mode: 'composition', blockType: null, reason: '复合画布关键词' }
  }
  if (/组织架构|层级图|树状图|分类树|栏目结构|目录结构|架构层级|父子关系|分层结构/.test(s)) {
    return { mode: 'single', blockType: 'hierarchy', reason: '层级结构关键词' }
  }
  if (/流程图|流程|步骤|审批|决策树|流转|SOP/.test(s)) {
    return { mode: 'single', blockType: 'flowchart', reason: '流程关键词' }
  }
  if (/思维导图|脑图|发散|主题归纳|知识图谱|知识树/.test(s)) {
    return { mode: 'composition', blockType: null, reason: '思维导图/发散类交给 composer' }
  }
  if (/鱼骨图|根因|原因分析|因果分析/.test(s)) {
    return { mode: 'single', blockType: 'fishbone', reason: '鱼骨图关键词' }
  }
  if (/时间轴|里程碑|发展历程|演进/.test(s)) {
    return { mode: 'single', blockType: 'timeline', reason: '时间轴关键词' }
  }
  if (/甘特|排期|项目计划|项目进度/.test(s)) {
    return { mode: 'single', blockType: 'gantt', reason: '甘特图关键词' }
  }
  if (/四象限|优先级矩阵|重要紧急|象限图/.test(s)) {
    return { mode: 'single', blockType: 'quadrant', reason: '四象限关键词' }
  }
  if (/饼图|占比|份额|比例构成/.test(s)) {
    return { mode: 'single', blockType: 'pie', reason: '饼图关键词' }
  }
  if (/时序图|交互时序|请求链路|调用链/.test(s)) {
    return { mode: 'single', blockType: 'sequence', reason: '时序关键词' }
  }
  if (/类图|对象关系|类关系|继承关系/.test(s)) {
    return { mode: 'single', blockType: 'class', reason: '类图关键词' }
  }
  if (/ER图|实体关系|数据库表|表结构/.test(s)) {
    return { mode: 'single', blockType: 'er', reason: 'ER 关键词' }
  }
  if (/状态图|状态机|状态流转/.test(s)) {
    return { mode: 'single', blockType: 'state', reason: '状态图关键词' }
  }
  if (/架构图|技术架构|系统架构|分层架构|能力地图/.test(s)) {
    return { mode: 'single', blockType: 'architecture', reason: '架构关键词' }
  }
  return { mode: 'composition', blockType: null, reason: '默认交给组合规划' }
}

// 明确类型由本地规则路由，模糊和复合需求直接交给 Composer。
// 这里不再额外调用一次 AI 做分类，减少延迟、成本和决策漂移。
const classifyDiagramIntent = (userRequest) => inferDiagramIntentHeuristically(userRequest)

// ─── 路由收敛 ──────────────────────────────────────
//
// 成品视觉 → 整体 SVG；flowchart 家族 → Mermaid 原生图元；其余 → composer 可编辑图元。
//
// ER 曾迁移到自研 graph 引擎，但视觉上不如官方 Mermaid ER 渲染干净，重新走 Mermaid。

const classifyCanvasRoute = (diagramIntent) => {
  if (diagramIntent?.mode === 'single' && diagramIntent.blockType === 'svg') {
    return { route: 'svg', blockType: 'svg' }
  }
  if (diagramIntent?.mode === 'single' && MERMAID_BLOCK_TYPES.has(diagramIntent.blockType)) {
    return { route: 'flowchart', blockType: diagramIntent.blockType }
  }
  return { route: 'composer', blockType: null }
}

// ─── Composer 通用画布：原语自由组合 ─────────────────
//
// 让 LLM 用「原语 + 布局容器」自由组合一棵节点树，由 composer 引擎两遍式布局。
// LLM 永不算坐标，只描述结构。这是 flowchart/mindmap 之外的默认路径。

const buildComposerMessages = (userRequest) => [
  {
    role: 'system',
    content: `你是 Flota 白板设计器。只返回严格 JSON，不要 Markdown、注释、Mermaid、坐标或解释。

格式：
{"title":"可选","layout":{"type":"stack.v","gap":32},"children":[],"connectors":[{"from":"id","to":"id","label":"可选"}]}

容器：
- stack.v / stack.h / grid：props 可含 gap、padding、align、cols
- graph：props 含 direction("TB"|"LR")、edges；children 中节点必须有 props.id
- group：props 含 title、tone、padding、gap、dashed
- screen：props 含 device、title；适合界面原型

内容：
- text {content,level}；card {title,body,tone}；list {items}
- callout {text,tone}；badge {text,tone}；icon {symbol,size}
- table {headers,rows}；input {label,placeholder}；button {label,variant}
- avatar {label,size}；divider；image {label,ratio}
- svg {prompt,title?,w?,h?}：局部整体矢量插画，生成后不能拆分编辑

原则：
1. 结构、步骤和关系用可编辑原生节点；局部插画、场景图、装饰性视觉可穿插 svg，不必二选一。
2. 流程、依赖和层级关系放进 graph，不手算位置；其余用容器自动排版。
3. 大胆但有秩序：用分区、色彩、图标和 10-30 个信息节点形成层次，避免整图只有卡片或只有文字。
4. SVG 最多 2 个；prompt 只描述该局部画面及风格，不写 SVG 源码。纯结构图或用户要求可拆分时可不用 SVG。
5. 文字简短、具体、深色可读，来自用户素材；没有的数据不要编造。

混合示例：
{"title":"急救处置","layout":{"type":"grid","cols":2,"gap":32},"children":[{"type":"svg","props":{"prompt":"中性医学科教风格的人体急救姿势抽象插画，蓝绿色，无血腥","w":420,"h":360}},{"type":"group","props":{"title":"处置流程","tone":"primary","padding":20,"gap":16},"children":[{"type":"graph","props":{"direction":"TB","edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]},"children":[{"type":"card","props":{"id":"a","title":"评估环境"}},{"type":"card","props":{"id":"b","title":"呼叫支援","tone":"warning"}},{"type":"card","props":{"id":"c","title":"持续观察","tone":"success"}}]}]}]}`,
  },
  { role: 'user', content: userRequest },
]

const validateComposerCanvasTree = (parsed) => {
  if (!parsed) throw new Error('Composer 画布规划返回格式错误')
  const hasChildren = Array.isArray(parsed.children) && parsed.children.length > 0
  const isNode = parsed.type && typeof parsed.type === 'string'
  if (!hasChildren && !isNode) throw new Error('Composer 画布无可渲染内容')
  return parsed
}

const planComposerCanvas = async (userRequest) => {
  const messages = buildComposerMessages(userRequest)
  const res = await window.electronAPI.ai.chat(
    messages,
    { temperature: 0.4, timeoutMs: 600000, bypassTokenLimit: true },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || 'Composer 画布规划失败')
  }
  const parsed = await parseComposerCanvasResponse(userRequest, res.data.content)
  return validateComposerCanvasTree(parsed)
}

const replanComposerCanvasWithFeedback = async (userRequest, previousTree, generationError) => {
  const messages = [
    ...buildComposerMessages(userRequest),
    {
      role: 'assistant',
      content: previousTree
        ? compactFeedbackPayload(previousTree)
        : '上一版没有产出可用的合法 JSON，或在渲染前就失败。',
    },
    {
      role: 'user',
      content: `上一版画布生成/渲染失败，错误如下：\n\n${String(generationError?.message || generationError || '')}\n\n请反思失败原因，重新输出一份**完整且可渲染**的 composer JSON。要求：\n1. 只输出 JSON，不要 Markdown 代码块、解释或注释\n2. 保留原始用户意图，但修复导致失败的结构/字段/连线/id/节点类型问题\n3. children 必须非空；如果有 connectors/graph.edges，from/to 必须引用真实存在的 props.id\n4. 不要输出 Mermaid、SVG、伪代码或自然语言说明`,
    },
  ]
  const res = await window.electronAPI.ai.chat(
    messages,
    { temperature: 0.2, timeoutMs: 600000, bypassTokenLimit: true },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || 'Composer 画布反思重写失败')
  }
  const parsed = await parseComposerCanvasResponse(userRequest, res.data.content)
  return validateComposerCanvasTree(parsed)
}

// ─── Stage B：为每个 block 生成具体 DSL ─────────────

const buildDslMessages = (blockType, summary) => {
  const def = MERMAID_BLOCKS[blockType]
  if (!def) throw new Error(`未知 block 类型: ${blockType}`)
  const extraRules = blockType === 'er'
      ? '\n5. 严格遵守 Mermaid erDiagram 语法：实体名用英文大写或下划线（如 USER、CHAT_LOG），不能用中文/空格/标点\n6. 实体名禁止使用 Mermaid 保留字（CLASS / ORDER / GROUP / TYPE / KEY / TABLE / INDEX / VIEW / DATABASE / SCHEMA / ENTITY / RELATION 等）。如果概念冲突，请加后缀或前缀（如 SCHOOL_CLASS、ORDER_INFO、USER_GROUP），不要写裸 CLASS / ORDER\n7. 实体属性块格式必须是 `<类型> <字段名> [PK|FK]`，每行一对，类型必须有（int/string/datetime/decimal/bool/text 等）。绝不能写裸字段名、不能省略类型，也不能在一行里堆多个属性\n8. 关系语法 `A ||--o{ B : 动词`，动词用英文小写（如 places/owns/has），不要用中文短语\n9. 标签描述（实体的中文名/字段中文释义）写在每行末尾的英文双引号 "中文" 里，例如 `string name "用户姓名"`\n10. 控制规模：4-10 个实体，每个实体 3-7 个属性'
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

const buildSvgMessages = (description) => [
  {
    role: 'system',
    content: `生成一张适合白板的精致 SVG。只输出完整 <svg>…</svg> 源码。
必须有 viewBox；内容不能越界。禁用 script、foreignObject、iframe、动画、外链、外部字体、远程 URL 和 style 标签。只用原生 SVG 图形、path、text/tspan、渐变、滤镜、clipPath、mask及内联属性。文字清晰可读，配色克制，构图大胆但不杂乱；不编造用户未提供的数据。`,
  },
  { role: 'user', content: description },
]

const generateSvgArtwork = async (description, offsets, size = {}) => {
  const res = await window.electronAPI.ai.chat(
    buildSvgMessages(description),
    { temperature: 0.6, timeoutMs: 600000, bypassTokenLimit: true },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || 'SVG 生成失败')
  }
  const createAsset = (content) => createSvgAsset(content, {
    offsetX: offsets.offsetX,
    offsetY: offsets.offsetY,
    source: 'ai',
    maxWidth: Number(size.maxWidth) || 960,
    maxHeight: Number(size.maxHeight) || 720,
  })

  try {
    return createAsset(res.data.content)
  } catch (firstError) {
    if (!shouldUseModelReflection(firstError)) throw firstError
    logger.warn('[aiExcalidrawGenerator] 首版 SVG 校验失败，触发模型修复:', firstError.message)
    const repairMessages = [
      ...buildSvgMessages(description),
      { role: 'assistant', content: compactFeedbackPayload(res.data.content, 18_000) },
      {
        role: 'user',
        content: `上面的 SVG 无法解析或未通过安全校验：${String(firstError?.message || firstError)}\n请修复后重新输出完整 SVG。只输出 <svg>…</svg>，确保 XML 标签闭合、& 写成 &amp;，不使用 script、foreignObject、动画、外链或 <style> 标签。`,
      },
    ]
    const repaired = await window.electronAPI.ai.chat(
      repairMessages,
      { temperature: 0.2, timeoutMs: 600000, bypassTokenLimit: true },
    )
    if (!repaired?.success || !repaired.data?.content) {
      throw new Error(repaired?.error || `SVG 自动修复失败：${firstError.message}`)
    }
    try {
      return createAsset(repaired.data.content)
    } catch (secondError) {
      throw new Error(`SVG 首次校验失败：${firstError.message}；自动修复后仍失败：${secondError.message}`)
    }
  }
}

const MAX_COMPOSER_SVGS = 2

const collectComposerSvgNodes = (node, list = []) => {
  if (!node || typeof node !== 'object') return list
  if (node.type === 'svg') list.push(node)
  for (const child of Array.isArray(node.children) ? node.children : []) {
    collectComposerSvgNodes(child, list)
  }
  return list
}

const fallbackSvgNodeToCard = (node) => {
  const props = node.props || {}
  node.type = 'card'
  node.props = {
    title: props.title || '视觉补充',
    body: String(props.prompt || '').slice(0, 100),
    tone: 'info',
  }
}

const hydrateComposerSvgNodes = async (tree, userRequest) => {
  const nodes = collectComposerSvgNodes(tree)
  const warnings = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (index >= MAX_COMPOSER_SVGS) {
      fallbackSvgNodeToCard(node)
      continue
    }
    const props = node.props || {}
    const prompt = String(props.prompt || props.title || '').trim()
    if (!prompt) {
      fallbackSvgNodeToCard(node)
      continue
    }
    const maxWidth = Math.max(240, Math.min(720, Number(props.w) || 520))
    const maxHeight = Math.max(180, Math.min(640, Number(props.h) || 420))
    try {
      const asset = await generateSvgArtwork(
        `${prompt}\n整体画布主题：${String(userRequest || '').slice(0, 600)}`,
        { offsetX: 0, offsetY: 0 },
        { maxWidth, maxHeight },
      )
      Object.defineProperty(node, '_asset', { value: asset.elements[0], configurable: true })
      Object.defineProperty(node, '_files', { value: asset.files, configurable: true })
    } catch (error) {
      warnings.push(`局部 SVG 未生成：${error.message}`)
      fallbackSvgNodeToCard(node)
    }
  }
  return warnings
}

const generateDsl = async (blockType, summary) => {
  const res = await window.electronAPI.ai.chat(
    buildDslMessages(blockType, summary),
    { temperature: 0.4, timeoutMs: 600000 },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(`${blockType} DSL 生成失败`)
  }
  return stripCodeFence(res.data.content)
}

const regenerateDslWithFeedback = async (blockType, summary, previousDsl, generationError) => {
  const messages = [
    ...buildDslMessages(blockType, summary),
    { role: 'assistant', content: previousDsl },
    {
      role: 'user',
      content: `上一版 DSL 生成/渲染失败，错误如下：\n\n${String(generationError?.message || generationError || '')}\n\n请根据错误信息反思并修正语法，重新输出**完整** DSL。要求：\n1. 只输出 DSL，不要解释、不要 Markdown 代码块\n2. 保留原始用户意图和图表类型\n3. 优先修复报错行附近的语法、保留字、字段格式、节点 id、关系写法问题\n4. 不要输出与该图型无关的语法`,
    },
  ]
  const res = await window.electronAPI.ai.chat(
    messages,
    { temperature: 0.2, timeoutMs: 600000 },
  )
  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || `${blockType} DSL 反思重写失败`)
  }
  return stripCodeFence(res.data.content)
}

// ─── Mermaid 单图快路径 ────────────────────────────

const renderMermaidBlock = async (dsl, offsets) => {
  const result = await renderMermaidNative(dsl, offsets)
  return { elements: result.elements, files: result.files || {} }
}

const renderSimpleBlockWithReflection = async (blockType, description, offsets) => {
  const dsl = await generateDsl(blockType, description)
  try {
    return await renderMermaidBlock(dsl, offsets)
  } catch (firstError) {
    if (!shouldUseModelReflection(firstError)) throw firstError
    logger.warn(`[aiExcalidrawGenerator] ${blockType} 首次渲染失败，触发模型反思重写:`, firstError.message)
    const fixedDsl = await regenerateDslWithFeedback(blockType, description, dsl, firstError)
    try {
      const result = await renderMermaidBlock(fixedDsl, offsets)
      logger.log(`[aiExcalidrawGenerator] ${blockType} 反思重写后渲染成功`)
      return result
    } catch (secondError) {
      throw new Error(`首次错误：${firstError.message || firstError}；反思重试后仍失败：${secondError.message || secondError}`)
    }
  }
}

const renderComposerTree = (tree, offsets) => {
  const result = renderComposer(tree, offsets)
  if ((result.elements || []).length > 0) {
    return { elements: result.elements, files: result.files || {} }
  }
  throw new Error('composer 渲染结果为空')
}

const renderComposerWithReflection = async (description, offsets) => {
  let tree = null
  try {
    tree = await planComposerCanvas(description)
    const warnings = await hydrateComposerSvgNodes(tree, description)
    logger.log('[aiExcalidrawGenerator] 命中 composer 路径')
    return { ...renderComposerTree(tree, offsets), warnings }
  } catch (firstError) {
    if (!shouldUseModelReflection(firstError)) throw firstError
    logger.warn('[aiExcalidrawGenerator] composer 首次生成/渲染失败，触发模型反思重写:', firstError.message)
    try {
      const fixedTree = await replanComposerCanvasWithFeedback(description, tree, firstError)
      const warnings = await hydrateComposerSvgNodes(fixedTree, description)
      const result = { ...renderComposerTree(fixedTree, offsets), warnings }
      logger.log('[aiExcalidrawGenerator] composer 反思重写后渲染成功')
      return result
    } catch (secondError) {
      throw new Error(`首次错误：${firstError.message || firstError}；反思重试后仍失败：${secondError.message || secondError}`)
    }
  }
}

// ─── 对外主入口 ────────────────────────────────────

export async function aiGenerateExcalidrawElements(description, existingElements = []) {
  const offsets = computeOffset(existingElements)
  logger.log('[aiExcalidrawGenerator] 输入:', description, 'offset:', offsets)

  const diagramIntent = await classifyDiagramIntent(description)
  logger.log('[aiExcalidrawGenerator] 图型意图:', diagramIntent)

  const { route, blockType } = classifyCanvasRoute(diagramIntent)
  logger.log('[aiExcalidrawGenerator] 画布路由:', route, blockType || '')

  if (route === 'svg') {
    try {
      logger.log('[aiExcalidrawGenerator] 命中 SVG 矢量视觉路径')
      return await generateSvgArtwork(description, offsets)
    } catch (err) {
      logger.warn('[aiExcalidrawGenerator] SVG 生成失败:', err.message)
      throw normalizeWhiteboardError(err)
    }
  }

  // ── 路由 1：flowchart 家族 → Mermaid 原生矢量 ──
  // 失败就明确报错，绝不退回 composer「勉强渲染」（那会画出缠绕错乱的图）。
  if (route === 'flowchart') {
    try {
      return await renderSimpleBlockWithReflection(blockType, description, offsets)
    } catch (err) {
      logger.warn(`[aiExcalidrawGenerator] ${blockType} 生成失败:`, err.message)
      throw normalizeWhiteboardError(err)
    }
  }

  // ── 路由 2（默认）：composer 通用合成引擎（原语 + 布局容器）──
  try {
    return await renderComposerWithReflection(description, offsets)
  } catch (err) {
    logger.warn('[aiExcalidrawGenerator] composer 路径失败:', err.message)
    throw normalizeWhiteboardError(err)
  }
}

/**
 * 把整篇 Markdown 转画布（用于"内容转画布"按钮）
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
