/**
 * AI 画布图表生成器（Composition IR 架构）
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
import { renderComposer } from './diagrams/composer'
import { KNOWN_BLOCK_KINDS } from './diagrams/composition'

// ─── 已注册图表类型元信息（供 AI 选用）─────────────
//
// 每个类型显式标注 tier：
//   tier 1 — 官方 Mermaid 原生矢量（flowchart/sequence/class/state/er/hierarchy->flowchart）
//   tier 2 — 自研矢量渲染（fishbone/gantt/timeline/quadrant/pie）
//   tier 3 — 自研 composer 通用合成引擎（思维导图/总览/原型等一切默认走它）

const BLOCK_TYPES = {
  flowchart: { label: '流程图', tier: 1, use: '步骤流程、分支决策', dslHint: 'flowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]' },
  sequence: { label: '时序图', tier: 1, use: '多角色交互、API 调用', dslHint: 'sequenceDiagram\n  participant 用户\n  participant 服务\n  用户->>服务: 请求' },
  class: { label: '类图', tier: 1, use: '面向对象建模', dslHint: 'classDiagram\n  class Order {\n    +id\n    +submit()\n  }' },
  state: { label: '状态图', tier: 1, use: '状态机、UI 状态切换', dslHint: 'stateDiagram-v2\n  [*] --> 待处理\n  待处理 --> 进行中: 受理' },
  er: { label: 'ER 图', tier: 1, use: '数据库表设计、实体关系', dslHint: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    int id PK\n    string name\n    string email\n  }\n  ORDER {\n    int id PK\n    int customer_id FK\n    decimal total\n  }' },

  hierarchy: {
    label: '层级结构图',
    tier: 1,
    use: '栏目结构、组织架构、分类树、主题分层',
    dslHint: 'hierarchy\n科技日报\n  - 头版要闻\n    - 政策解读\n  - 海外科技新突破\n    - 国际科技',
  },
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

const buildDiagramIntentMessages = (userRequest) => {
  const blockList = Object.entries(BLOCK_TYPES)
    .map(([k, v]) => `- ${k}: ${v.label}，适合 ${v.use}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `你是 Flota 白板图型路由器。请判断用户更适合：
1. 单一图型 single：从下列 blockType 中选一个
2. 复合画布 composition：需要多个区块/便签/连接线组合

可选 blockType：
${blockList}

要求：
- 栏目结构、组织架构、分类树、目录结构，优先用 hierarchy
- 简单单主题，优先 single，不要滥用 composition
- 只有明显要求多图区块拼装、作战图、总览画布时，才返回 composition
- 返回严格 JSON，不要 Markdown：
{"mode":"single"|"composition","blockType":"flowchart"|null,"reason":"简短中文原因","confidence":0.0}`,
    },
    { role: 'user', content: userRequest },
  ]
}

const classifyDiagramIntent = async (userRequest) => {
  const heuristic = inferDiagramIntentHeuristically(userRequest)
  try {
    const res = await window.electronAPI.ai.chat(
      buildDiagramIntentMessages(userRequest),
      { temperature: 0 },
    )
    const parsed = safeJsonExtract(res?.data?.content || '')
    if (!parsed || (parsed.mode !== 'single' && parsed.mode !== 'composition')) {
      return heuristic
    }
    if (parsed.mode === 'single' && !KNOWN_BLOCK_KINDS.has(parsed.blockType)) {
      return heuristic
    }
    return {
      mode: parsed.mode,
      blockType: parsed.mode === 'single' ? parsed.blockType : null,
      reason: parsed.reason || heuristic.reason,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    }
  } catch (e) {
    logger.warn('[diagramIntent] 分类失败，回退启发式:', e.message)
    return heuristic
  }
}

// ─── 路由收敛 ──────────────────────────────────────
//
// flowchart 家族（flowchart/sequence/class/state/er）→ Mermaid 原生矢量
// 其余一切（思维导图/总览/原型/看板/分层图…）→ composer 自研通用合成引擎
//
// ER 曾迁移到自研 graph 引擎，但视觉上不如官方 Mermaid ER 渲染干净，重新走 Mermaid。

const FLOWCHART_BLOCKTYPES = new Set(['flowchart', 'sequence', 'class', 'state', 'er'])

const classifyCanvasRoute = (diagramIntent) => {
  if (diagramIntent?.mode === 'single' && FLOWCHART_BLOCKTYPES.has(diagramIntent.blockType)) {
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
    content: `你是 Flota 画布合成器。你不输出 Mermaid，也不输出图片，而是用「原语 + 布局容器」组合出一棵节点树，由引擎自动排版。你永远不需要自己计算坐标。

节点结构：{ "type": "<原语名>", "props": { ... }, "children": [ ... ] }

可用布局容器（靠它们排列子节点，children 必填）：
- stack.v  纵向堆叠。props: { gap?, padding?, align?: "stretch"|"center"|"end", bg?, stroke? }
- stack.h  横向排列。props: { gap?, padding?, align?: "start"|"center"|"end"(纵向对齐), justify?: "start"|"center"|"end"|"between" }
- grid     等分网格。props: { cols, gap?, padding? }
- graph    分层关系图（流程图/ER/依赖图/拓扑/人物关系 用它）。props: { direction?: "TB"|"LR", edges: [{ from, to, label?, dashed?, tone? }] }。children 是图的节点（每个必须带 props.id），引擎按 edges 的依赖关系自动分层、错峰、避免连线交叉——你绝不要自己摆位置。
- screen   设备外壳（手机/平板/桌面）。props: { device?: "phone"|"tablet"|"desktop"|"window", title?, accent? }，内部放 nav/list/button 等
- group    带标题的虚线分组框。props: { title?, tone?, padding?, gap?, dashed? }

可用内容原语（叶子，一般无 children）：
- text     文字。props: { content, level?: "h1"|"h2"|"h3"|"body"|"caption", align?, color? }
- card     卡片。props: { title?, body?, accent?/tone?, fill? }
- callout  标注气泡。props: { text, tone? }
- badge    徽标。props: { text/count, tone? }
- icon     图标占位。props: { symbol(emoji或字符), size?, color? }
- avatar   头像。props: { label?, size? }
- image    占位图。props: { label?, ratio?, w?, h? }
- divider  分割线（无 props）
- nav.top  顶部导航。props: { title?, back?: true, actions?: ["保存"] }
- nav.bottom 底部 tab 栏。props: { tabs: ["首页","我的"], active?: 0 }
- input    输入框。props: { label?, placeholder?, value? }
- button   按钮。props: { label, variant?: "primary"|"secondary"|"text", block?: true }
- list     列表。props: { items: [ "纯文本" | { title, subtitle?, trailing?, checkbox?/done? } ] }
- table    表格。props: { headers: [...], rows: [[...],[...]] }
- rect/ellipse/line 原始图元（兜底用）。props: { w?, h?, fill?, stroke?, dashed? }

tone/accent 取值：primary|success|warning|danger|accent|info|neutral

任意节点都可加 props.id（字符串），用于在 connectors 里跨容器画箭头连线。

返回严格 JSON，禁止 Markdown 代码块，禁止任何注释（不要写 // 或 /* */）：
{
  "title": "<画布标题，可选>",
  "layout": { "type": "stack.v"|"stack.h"|"grid", "gap"?: 32, "cols"?: 3, "align"?: "..." },
  "children": [ <顶层节点...> ],
  "connectors": [ { "from": "<节点id>", "to": "<节点id>", "label"?: "触发", "dashed"?: false, "tone"?: "primary" } ]
}

few-shot 示例 1（移动端登录原型）：
{"title":"登录页","children":[{"type":"screen","props":{"device":"phone","title":"欢迎登录"},"children":[{"type":"stack.v","props":{"gap":24,"padding":24},"children":[{"type":"stack.v","props":{"gap":8,"align":"center"},"children":[{"type":"avatar","props":{"size":64}},{"type":"text","props":{"content":"欢迎回来","level":"h2","align":"center"}}]},{"type":"stack.v","props":{"gap":16},"children":[{"type":"input","props":{"label":"手机号","placeholder":"请输入手机号"}},{"type":"input","props":{"label":"密码","placeholder":"请输入密码"}}]},{"type":"stack.v","props":{"gap":12},"children":[{"type":"button","props":{"label":"登录","variant":"primary"}},{"type":"button","props":{"label":"忘记密码？","variant":"text"}}]}]}]}]}

few-shot 示例 2（看板 - 注重留白、虚线分组与轻量装饰）：
{"title":"项目看板","layout":{"type":"grid","cols":3,"gap":32},"children":[{"type":"group","props":{"title":"📝 待办","tone":"neutral","padding":20,"gap":16,"dashed":true},"children":[{"type":"card","props":{"title":"需求评审","body":"周三前完成"}},{"type":"card","props":{"title":"接口联调","body":"等待后端提供 API"}},{"type":"badge","props":{"text":"2 项待处理","tone":"neutral"}}]},{"type":"group","props":{"title":"⏳ 进行中","tone":"warning","padding":20,"gap":16},"children":[{"type":"card","props":{"title":"首页视觉改版","body":"正在重构组件","tone":"warning"}},{"type":"callout","props":{"text":"本周优先保证主路径可用","tone":"warning"}}]},{"type":"group","props":{"title":"✅ 已完成","tone":"success","padding":20,"gap":16,"dashed":true},"children":[{"type":"card","props":{"title":"登录态优化","body":"已全量上线","tone":"success"}},{"type":"badge","props":{"text":"稳定运行","tone":"success"}}]}]}

few-shot 示例 3（带连线的流程，优先使用 graph 自动排版）：
{"title":"下单核心链路","children":[{"type":"graph","props":{"direction":"LR","edges":[{"from":"browse","to":"cart"},{"from":"cart","to":"order"},{"from":"order","to":"pay","label":"提交"},{"from":"pay","to":"done","label":"支付成功","tone":"success"},{"from":"pay","to":"cart","label":"支付失败","dashed":true,"tone":"danger"}]},"children":[{"type":"card","props":{"id":"browse","title":"1. 浏览商品","tone":"neutral"}},{"type":"card","props":{"id":"cart","title":"2. 购物车","tone":"neutral"}},{"type":"card","props":{"id":"order","title":"3. 提交订单","tone":"primary"}},{"type":"card","props":{"id":"pay","title":"4. 唤起支付","tone":"warning"}},{"type":"card","props":{"id":"done","title":"5. 交易完成","tone":"success"}}]}]}

few-shot 示例 4（个人全景仪表盘 — 宽敞现代、允许不同分区风格混搭）：
{"title":"个人星系全景图","layout":{"type":"stack.v","gap":40},"children":[{"type":"stack.h","props":{"gap":20,"align":"center"},"children":[{"type":"avatar","props":{"label":"叶","size":64}},{"type":"stack.v","props":{"gap":4},"children":[{"type":"text","props":{"content":"叶茂 Kevin","level":"h1"}},{"type":"text","props":{"content":"AI 工程师 · 创作者 · 在读硕士","level":"body","color":"#7c3aed"}}]},{"type":"badge","props":{"text":"已录取","tone":"success"}}]},{"type":"grid","props":{"cols":3,"gap":24},"children":[{"type":"card","props":{"title":"86%","body":"EvalAgent 评测准确率","tone":"primary"}},{"type":"card","props":{"title":"-75%","body":"评测成本大幅下降","tone":"success"}},{"type":"card","props":{"title":"-60%","body":"审批流程流转时长缩短","tone":"warning"}}]},{"type":"grid","props":{"cols":2,"gap":32},"children":[{"type":"group","props":{"title":"🔥 核心项目","tone":"danger","gap":16,"padding":24,"dashed":true},"children":[{"type":"list","props":{"items":["SQLReader（基于 MCP 协议）","Power BI 数据可视化大屏","Flota AI 记录与白板软件"]}},{"type":"callout","props":{"text":"偏工程产出，强调落地结果","tone":"danger"}}]},{"type":"group","props":{"title":"✍️ 创作宇宙","tone":"accent","gap":16,"padding":24},"children":[{"type":"list","props":{"items":[{"title":"《青藤书院的第七层》","subtitle":"民国悬疑 · 19 章"},{"title":"《镜中教室》","subtitle":"校园悬疑 · 双时间线"}]}},{"type":"badge","props":{"text":"持续更新","tone":"accent"}}]}]}]}

few-shot 示例 5（系统/技术架构图 — 大模块分区，内部网格对齐，留白充足）：
{"title":"电商系统分层架构","layout":{"type":"stack.v","gap":32},"children":[{"type":"stack.h","props":{"gap":16,"align":"center"},"children":[{"type":"icon","props":{"symbol":"⛳","size":28,"color":"#2563eb"}},{"type":"stack.v","props":{"gap":4},"children":[{"type":"text","props":{"content":"电商系统分层架构","level":"h1"}},{"type":"text","props":{"content":"按接入、业务、基础能力、数据存储分区展示，结构清晰","level":"body"}}]}]},{"type":"group","props":{"title":"接入层","tone":"primary","gap":20,"padding":24},"children":[{"type":"grid","props":{"cols":4,"gap":16},"children":[{"type":"card","props":{"title":"API Gateway","body":"鉴权 / 限流 / 路由","tone":"primary"}},{"type":"card","props":{"title":"Web BFF","body":"Web 端适配"}},{"type":"card","props":{"title":"App BFF","body":"移动端适配"}},{"type":"card","props":{"title":"H5 BFF","body":"活动页适配"}}]}]},{"type":"group","props":{"title":"业务服务层","tone":"success","gap":20,"padding":24},"children":[{"type":"grid","props":{"cols":5,"gap":16},"children":[{"type":"card","props":{"title":"用户服务","body":"注册 / 登录","tone":"success"}},{"type":"card","props":{"title":"商品服务","body":"SPU / SKU / 库存"}},{"type":"card","props":{"title":"订单服务","body":"下单 / 退款","tone":"success"}},{"type":"card","props":{"title":"营销服务","body":"优惠券 / 秒杀"}},{"type":"card","props":{"title":"搜索服务","body":"ES 索引 / 排序"}}]}]},{"type":"group","props":{"title":"基础能力层","tone":"warning","gap":20,"padding":24},"children":[{"type":"grid","props":{"cols":5,"gap":16},"children":[{"type":"card","props":{"title":"支付中台","body":"多渠道支付接入","tone":"warning"}},{"type":"card","props":{"title":"消息中心","body":"站内信 / Push"}},{"type":"card","props":{"title":"文件服务","body":"OSS / CDN"}},{"type":"card","props":{"title":"配置中心","body":"Apollo 配置管理"}},{"type":"card","props":{"title":"任务调度","body":"XXL-Job 分布式调度"}}]}]}]}

可大胆使用的"丰富感"手法：
- 顶部用 avatar + 标题 + badge 组合出"人物 / 主体头图"
- 用 grid(cols:2~4) 摆一排 card 当"数据指标卡 / KPI"，标题写大数字、body 写说明、配 tone 上色
- 不同主题分区用 group 包起来，标题带 emoji，整组上不同 tone（danger/accent/success…）拉开色彩层次
- 可以适度混入不同区块风格：例如部分 group 用 dashed 虚线边框、部分 card 用更轻的 tone、局部搭配 badge / callout 做节奏变化，但不要整张图每个块都花哨
- 列表项用 {title, subtitle} 结构而非纯文本，信息更立体
- 关键信息用 callout 气泡 / badge 徽标点缀，icon 给条目加图标
- 只有少量跨区重点关系才用 connectors；不要为了“看起来有关系”把所有卡片都连起来

合成原则：
1. 先想清楚整张画布的骨架用哪个容器（纵向流/横向分栏/网格/设备壳），再往里填内容原语
2. 大胆嵌套、大胆铺量：容器里再放容器，组合出多分区 + 卡片墙 + 指标行，让画布饱满有信息量（信息类总览画布通常 15-40 个节点）。如果用户要架构图/能力地图/系统全景，必须至少 3 个 group 分区，每个分区内用 grid 放 3-6 张 card
3. 主动调用多种原语：一张画布里尽量混用 card / list / badge / icon / callout / avatar / group，不要从头到尾只有 card 或只有文字
4. 可读性优先于炫技：主要信息优先用 h1/h2/h3/body，caption 只用于次要辅助信息；不要把核心内容做成小字
5. 禁止低对比文本：画布底色恒为浅色，绝不要输出接近白色/浅灰/浅黄等淡色文字；正文一律深色。不要假设深色主题
6. 文字优先内嵌到块里：信息尽量用 card(title/body) / list(items) / group(title) / callout(text) / button(label) 这类自带容器的原语承载，让"字在块内"；尽量不要用裸 text 原语去标注另一个 rect/ellipse（容易错位、白字）。需要纯色块时优先用 card 而非 rect+text
7. 不要把内容塞得过密：单个 card 或 list item 尽量控制在 2-4 行，太长就拆成多个 card/list/group；区块之间保留足够 gap/padding
8. 用 tone/accent 给不同分区和卡片上色，制造视觉层次与重点，但不要牺牲对比度和可读性
8.1. 允许有控制地探索风格变化：虚线边框、弱底色分区、局部 badge/callout 点缀都可以；但整张画布最多 1-2 种强调手法，避免杂乱
9. 文字贴近用户真实素材，禁止"标题1/卡片A"这类占位词；数字、比例、专有名词照搬用户内容
10. 原型类（App/网页/界面）用 screen + nav + input/button/list；信息类（看板/分层/总览/全景）用 grid/stack + group + 指标 card + list；架构图/系统分层图必须用 stack.v + 多个 group 分区，不要输出单一大网格
11. 凡是"流转/因果/依赖/层级/实体关系"这类带连线的关系图（流程图、ER、依赖图、拓扑、人物关系），一律用 graph 容器：子节点各带 props.id，连线写在 graph 的 props.edges 里，引擎会自动分层排布、避免交叉。不要用 stack.h+connectors 去硬摆关系图，更不要用裸 line/arrow 手画。只有"分区之间的少量补充关系"才用顶层 connectors。系统架构/分层架构默认不要使用顶层 connectors，把依赖写进 card.body / callout；除非用户明确要求“调用链/链路/依赖箭头”
12. 不要输出 Mermaid、SVG、伪代码或任何解释文字`,
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
  const def = BLOCK_TYPES[blockType]
  if (!def) throw new Error(`未知 block 类型: ${blockType}`)
  const extraRules = blockType === 'architecture'
    ? '\n5. 必须使用 Mermaid 官方 block-beta 语法，第一行必须是 block-beta\n6. 只允许使用 columns、块定义、箭头连接这类官方 block-beta 语法，禁止自定义 DSL\n7. 尽量按分层结构输出 3-5 个主块，每个块里概括一层能力，中文内容写在 ["..."] 标签里\n8. 优先生成适合技术架构/能力地图的分层块图，不要退化成流程图或思维导图\n9. 控制文本密度，单个块内最多 3-6 个短语，用 / 或换行分隔'
    : blockType === 'er'
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

// ─── 兼容旧路径：单一图表快路径 ─────────────────────

const SIMPLE_RENDERERS = {
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
}

const renderSimpleBlockWithReflection = async (blockType, description, offsets) => {
  const dsl = await generateDsl(blockType, description)
  try {
    return await SIMPLE_RENDERERS[blockType](dsl, offsets)
  } catch (firstError) {
    if (!shouldUseModelReflection(firstError)) throw firstError
    logger.warn(`[aiExcalidrawGenerator] ${blockType} 首次渲染失败，触发模型反思重写:`, firstError.message)
    const fixedDsl = await regenerateDslWithFeedback(blockType, description, dsl, firstError)
    try {
      const result = await SIMPLE_RENDERERS[blockType](fixedDsl, offsets)
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
    return { elements: result.elements, files: result.files || {}, warnings: [] }
  }
  throw new Error('composer 渲染结果为空')
}

const renderComposerWithReflection = async (description, offsets) => {
  let tree = null
  try {
    tree = await planComposerCanvas(description)
    logger.log('[aiExcalidrawGenerator] 命中 composer 路径')
    return renderComposerTree(tree, offsets)
  } catch (firstError) {
    if (!shouldUseModelReflection(firstError)) throw firstError
    logger.warn('[aiExcalidrawGenerator] composer 首次生成/渲染失败，触发模型反思重写:', firstError.message)
    try {
      const fixedTree = await replanComposerCanvasWithFeedback(description, tree, firstError)
      const result = renderComposerTree(fixedTree, offsets)
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
