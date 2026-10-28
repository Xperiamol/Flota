/**
 * 通用 Mermaid 图表 → Excalidraw 元素
 * 复用官方 @excalidraw/mermaid-to-excalidraw（业界基准）
 *
 * 官方原生矢量分支（Tier 1，可拆图元编辑）：
 *   flowchart / sequence / class / state / er
 *
 * 官方非原生分支（Tier 3，回退 SVG → PNG 图片快照，不可拆图元编辑）：
 *   architecture-beta / block-beta / gantt / pie / timeline / mindmap / quadrantChart / xychart-beta 等
 *
 * 本模块对 Tier 3 路径做了两件关键事：
 *   1) 优先保留为矢量 SVG（任意缩放都清晰）；SVG 不合法时才回退为高分辨率 PNG
 *   2) 给每个 image 元素附 customData = { tier:3, kind:'mermaid-image', mermaidSource }，
 *      以后可双击编辑 DSL 重新生成
 */
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import logger from '../logger'

const SVG_MIME = 'image/svg+xml'

/**
 * Mermaid 11.14+ 会在 render(renderId, ...) 生成的 SVG 内部给所有 <g>/<path> 的 id
 * 加上 `${renderId}-` 前缀（例如 `id="mermaid-to-excalidraw-0-SG1"`），
 * 但 getDiagramFromText() 阶段产出的 diagram.db 仍保留无前缀的原始 id（如 `SG1`）。
 * @excalidraw/mermaid-to-excalidraw@2.2.2 的 parseSubGraph / parseClasses / parseEntity / parseState
 * 使用精确选择器 `[id='${data.id}']` 查询 DOM，导致所有带 subgraph 的流程图必报
 * `Error: SubGraph element not found` 并静默退化为不可编辑的静态图片。
 *
 * 这里剥离图形元素上的 `${renderId}-` 前缀，同时保留 <defs> 内 filter/gradient/marker 的 id。
 */
export const stripMermaidRenderIdPrefix = (svg = '', renderId = '') => {
  const rawSvg = String(svg || '')
  const prefix = String(renderId || '').trim()
  if (!rawSvg || !prefix) return rawSvg
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tagIdRe = new RegExp(
    `(<(?:g|path|rect|circle|ellipse|polygon|polyline|line|text|foreignObject)\\b[^>]*?\\bid=(["']))${escaped}-(?!drop-shadow|gradient)`,
    'gi',
  )
  return rawSvg.replace(tagIdRe, '$1')
}

const MERMAID_CONTAINER_ID_RE = /^mermaid-to-excalidraw-\d+-container$/

// The converter creates an offscreen container before assigning the rendered SVG.
// Adapt only that container; Mermaid's API is frozen and DOM prototypes stay untouched.
let conversionQueue = Promise.resolve()
const parseCompatibleMermaid = (code, options) => {
  const run = async () => {
    const body = document.body
    const ownAppend = Object.getOwnPropertyDescriptor(body, 'appendChild')
    const append = body.appendChild
    const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')
    body.appendChild = function (node) {
      if (node instanceof Element && MERMAID_CONTAINER_ID_RE.test(node.id)) {
        const renderId = node.id.replace(/-container$/, '')
        Object.defineProperty(node, 'innerHTML', {
          configurable: true,
          get() { return innerHTML.get.call(this) },
          set(value) { innerHTML.set.call(this, stripMermaidRenderIdPrefix(value, renderId)) },
        })
      }
      return append.call(this, node)
    }
    try { return await parseMermaidToExcalidraw(code, options) }
    finally {
      if (ownAppend) Object.defineProperty(body, 'appendChild', ownAppend)
      else delete body.appendChild
    }
  }
  const pending = conversionQueue.then(run)
  conversionQueue = pending.catch(() => {})
  return pending
}

// PNG 回退时的渲染倍率：尽量高（放大查看仍清晰），但限制总像素，避免超大图导致内存爆炸
const MAX_RASTER_PIXELS = 36_000_000
const computeRenderScale = (logicalW = 1200, logicalH = 800) => {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const preferred = Math.min(6, Math.max(3, dpr * 3))
  const areaCap = Math.sqrt(MAX_RASTER_PIXELS / Math.max(1, logicalW * logicalH))
  return Math.max(1, Math.min(preferred, areaCap))
}

const offsetElements = (elements, offsetX, offsetY) => elements.map((el) => {
  if (el == null) return el
  const next = { ...el }
  if (typeof next.x === 'number') next.x += offsetX
  if (typeof next.y === 'number') next.y += offsetY
  return next
})

const decodeDataURL = (dataURL = '') => {
  const [, meta = '', data = ''] = String(dataURL).match(/^data:([^,]*),(.*)$/) || []
  if (!data) return ''
  if (meta.includes(';base64')) {
    const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  }
  return decodeURIComponent(data)
}

const encodeSvgDataURL = (svgText) => {
  const bytes = new TextEncoder().encode(svgText)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return `data:${SVG_MIME};base64,${btoa(binary)}`
}

const sanitizeSvgText = (svgText = '') => String(svgText)
  .replace(/<br>/gi, '<br/>')
  .replace(/<hr>/gi, '<hr/>')
  .replace(/&nbsp;/gi, '&#160;')

/**
 * 把 Mermaid 输出的 SVG 规范成 Excalidraw 可直接使用的矢量图：
 * 校验 XML 合法、补 xmlns、写入明确的数值宽高与 viewBox。失败返回 null（调用方回退 PNG）。
 */
const normalizeMermaidSvg = (svgText, width, height) => {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return null
  try {
    const doc = new DOMParser().parseFromString(sanitizeSvgText(svgText), SVG_MIME)
    const root = doc.documentElement
    if (doc.querySelector('parsererror') || root?.localName?.toLowerCase() !== 'svg') return null
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const viewBox = String(root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    const hasViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0
    const w = Number(width) > 0 ? Number(width) : (hasViewBox ? viewBox[2] : 0)
    const h = Number(height) > 0 ? Number(height) : (hasViewBox ? viewBox[3] : 0)
    if (!(w > 0 && h > 0)) return null
    if (!hasViewBox) root.setAttribute('viewBox', `0 0 ${w} ${h}`)
    root.setAttribute('width', String(w))
    root.setAttribute('height', String(h))
    // Mermaid 会写 max-width:100% 之类的样式，脱离页面容器后会导致尺寸异常
    root.style?.removeProperty?.('max-width')
    return new XMLSerializer().serializeToString(root)
  } catch {
    return null
  }
}

const splitTopLevel = (text, separator = ',') => {
  const out = []
  let depth = 0
  let buf = ''
  for (const ch of String(text)) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if (ch === separator && depth === 0) {
      out.push(buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  if (buf) out.push(buf)
  return out
}

const isSafeStyleProp = (prop) => {
  // Mermaid 只支持简单颜色/数字/关键词，丢掉所有带函数调用的（gradient/url/var/calc/drop-shadow 等）
  if (/[()]/.test(prop)) return false
  if (/(gradient|url\b|var\b|calc\b|attr\b|drop-shadow|filter\s*:)/i.test(prop)) return false
  if (/^\s*(box-shadow|text-shadow|backdrop-filter|transform|animation|transition)\s*:/i.test(prop)) return false
  return true
}

// Mermaid 接收属性的语句有三种：`style <id> <props>`、`classDef <name> <props>`、`linkStyle <selector> <props>`。
// 三者属性语法相同，但前缀不同；这里统一识别再清洗，避免每加一种就漏一类。
const STYLE_DIRECTIVE_RE = /^(\s*(?:style|classDef|linkStyle)\s+\S+\s+)(.+)$/i

const sanitizeMermaidStyleLine = (line = '') => {
  const match = String(line).match(STYLE_DIRECTIVE_RE)
  if (!match) return line
  const prefix = match[1]
  const rawProps = match[2]
  const kept = splitTopLevel(rawProps, ',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => isSafeStyleProp(part))
  return kept.length > 0 ? `${prefix}${kept.join(',')}` : ''
}

// 在 Mermaid 不认的指令前补换行，避免模型把多条语句粘成一行（例如 `class A,B foolinkStyle default ...`）
const normalizeStatementBoundaries = (code = '') => String(code || '')
  .replace(/([^\n])(\s*)(linkStyle\b)/g, '$1\n$3')
  .replace(/([^\n])(\s*)(classDef\b)/g, '$1\n$3')
  // class 关键字后必跟 id/idlist + 类名（中间不能有 -->/===），匹配到再补换行；
  // 用先行断言避免误伤节点 label 内出现的 "class" 字面量
  .replace(/([^\n])(\s+)(class\s+[A-Za-z_][\w,\s]*\s+[A-Za-z_][\w-]*)(?=\s|$)/g, '$1\n$3')
  .replace(/([^\n])(\s*)(style\s+\S+\s+)/g, '$1\n$3')

// flowchart 节点 label 里出现 `()` `:` `;` 等特殊字符时 Mermaid 要求加引号；
// 模型经常忘加，统一在 sanitizer 里自动包裹，避免每次都靠 prompt 提醒。
const FLOWCHART_LABEL_BRACKETS = [
  { open: '[', close: ']' },   // [text]
  { open: '(', close: ')' },   // (text)
  { open: '{', close: '}' },   // {text}
]
const LABEL_NEEDS_QUOTE_RE = /[():;]/

const autoQuoteFlowchartLabels = (code = '') => {
  let out = String(code || '')
  // 仅在 flowchart/graph 方言中处理；其它方言（class/sequence 等）用完全不同的语法
  const kind = detectDiagramKind(out)
  if (kind !== 'flowchart' && kind !== 'graph') return out

  for (const { open, close } of FLOWCHART_LABEL_BRACKETS) {
    // 查找 `id[xxx]` / `id(xxx)` / `id{xxx}` 形式（id 由字母/数字/下划线组成），
    // 跳过已经用引号包裹的 label：`id["xxx"]`
    const re = new RegExp(
      `(\\b[A-Za-z_][\\w-]*\\s*)\\${open}(?!")([^${open === '(' ? '()' : open === '{' ? '{}' : '\\[\\]'}\\n]*?)\\${close}`,
      'g',
    )
    out = out.replace(re, (match, prefix, label) => {
      const trimmed = label.trim()
      if (!trimmed) return match
      if (!LABEL_NEEDS_QUOTE_RE.test(trimmed)) return match
      // label 内若已含未转义引号，跳过（让 Mermaid 自己报错，比误处理安全）
      if (/"/.test(trimmed)) return match
      return `${prefix}${open}"${trimmed}"${close}`
    })
  }

  // 边 label：`-->|文字|`、`-.->|文字|` 等，文字含中文/`:;()`/换行时给加引号
  out = out.replace(
    /(--+>?\s*\|)([^|"\n]*?[():;\u4e00-\u9fa5][^|"\n]*?)(\|)/g,
    (match, lhs, label, rhs) => {
      const trimmed = label.trim()
      if (!trimmed || /"/.test(trimmed)) return match
      return `${lhs}"${trimmed}"${rhs}`
    },
  )

  return out
}

// Mermaid 关键字（flowchart/graph/class/end/subgraph 等）若被模型误用作节点 id 会引发
// lex 错误。识别 `保留字[...]` `保留字(...)` `保留字{...}` 形式，统一加 `_` 前缀避开冲突。
// 注意：行首的 `subgraph[...]` 是模型漏写空格的 subgraph 标题声明，不能当作普通节点转义。
const MERMAID_RESERVED_AS_ID_RE = /\b(class|graph|flowchart|end|subgraph|style|click|direction|linkStyle|classDef)([\[\(\{])/g
const escapeReservedNodeIds = (code = '') => String(code || '')
  .split('\n')
  .map((line) => {
    if (/^\s*subgraph\s*[\[\(\{]/i.test(line)) {
      return line.replace(/^(\s*subgraph)\s*([\[\(\{])/i, '$1 $2')
    }
    return line.replace(
      MERMAID_RESERVED_AS_ID_RE,
      (_, word, bracket) => `_${word}${bracket}`,
    )
  })
  .join('\n')

/**
 * 规范化 flowchart/graph 中的 subgraph 声明并剔除空 subgraph：
 * 1) 将 `subgraph 中文标题`、`subgraph "标题"`、`subgraph [标题]`、`subgraph id[标题]`
 *    统一规范为具有唯一安全 ASCII id 的 `subgraph sg_N ["标题"]`（保留原本合法且不与节点冲突的 ASCII id），
 *    避免中文/引号/连字符 id 在 DOM 选择器 `[id='${data.id}']` 中失配。
 * 2) 若 subgraph id 与普通节点 id 重名，自动重命名 subgraph id，防止 dagre 父子循环或覆盖。
 * 3) 移除内部没有任何有效语句的空 `subgraph ... end` 块（空块在 Mermaid dagre 中不会生成 cluster 节点）。
 */
export const normalizeFlowchartSubgraphs = (code = '') => {
  const raw = String(code || '')
  const kind = detectDiagramKind(raw)
  if (kind !== 'flowchart' && kind !== 'graph') return raw
  if (!/\bsubgraph\b/i.test(raw)) return raw

  const lines = raw.split('\n')
  const vertexIds = new Set()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%%')) continue
    if (/^(flowchart|graph|subgraph|end|style|classDef|class|linkStyle|direction|click)\b/i.test(trimmed)) {
      continue
    }
    // 提取节点定义与连线端点中的 ASCII 节点 id
    const shapeMatches = trimmed.matchAll(/\b([A-Za-z_][\w-]*)\s*[\[\(\{>]/g)
    for (const m of shapeMatches) vertexIds.add(m[1])
    if (FLOWCHART_LINK_RE.test(trimmed)) {
      const parts = trimmed.split(/(?:-->|---|-\.->|-\.-|==>|===|<-->|o--|--o|x--|--x)(?:\s*\|[^|]*\|)?/)
      for (const part of parts) {
        const token = part.trim().match(/^([A-Za-z_][\w-]*)/)
        if (token) vertexIds.add(token[1])
      }
    }
  }

  const usedSubgraphIds = new Set()
  const renamedSubgraphMap = new Map()
  let sgCounter = 1
  const nextSubgraphId = () => {
    while (usedSubgraphIds.has(`sg_${sgCounter}`) || vertexIds.has(`sg_${sgCounter}`)) {
      sgCounter += 1
    }
    const id = `sg_${sgCounter}`
    usedSubgraphIds.add(id)
    sgCounter += 1
    return id
  }

  const cleanSubgraphTitle = (title = '') => String(title || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/"/g, "'")
    .trim()

  const normalizedLines = lines.map((line) => {
    const match = line.match(/^(\s*)subgraph\b(.*)$/i)
    if (!match) return line
    const indent = match[1] || ''
    const rest = (match[2] || '').trim()

    if (!rest) {
      const safeId = nextSubgraphId()
      return `${indent}subgraph ${safeId}`
    }

    // 形式 1: `subgraph id ["title"]` 或 `subgraph id [title]`
    const idWithBracket = rest.match(/^([^\s\[\]()"']+)\s*\[([\s\S]*)\]\s*$/)
    if (idWithBracket) {
      const rawId = idWithBracket[1].trim()
      const title = cleanSubgraphTitle(idWithBracket[2]) || rawId
      const isValidSafeAscii = /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawId) && !/^flowchart_/i.test(rawId)
      const hasCollision = vertexIds.has(rawId) || usedSubgraphIds.has(rawId)
      const safeId = (isValidSafeAscii && !hasCollision) ? rawId : nextSubgraphId()
      usedSubgraphIds.add(safeId)
      if (safeId !== rawId && !vertexIds.has(rawId)) {
        renamedSubgraphMap.set(rawId, safeId)
      }
      return `${indent}subgraph ${safeId} ["${title}"]`
    }

    // 形式 2: `subgraph ["title"]` 或 `subgraph [title]`
    const bracketOnly = rest.match(/^\[([\s\S]*)\]\s*$/)
    if (bracketOnly) {
      const safeId = nextSubgraphId()
      const title = cleanSubgraphTitle(bracketOnly[1]) || safeId
      return `${indent}subgraph ${safeId} ["${title}"]`
    }

    // 形式 3: 仅单个安全 ASCII 标识符 `subgraph SG1`
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(rest)) {
      if (!vertexIds.has(rest) && !usedSubgraphIds.has(rest)) {
        usedSubgraphIds.add(rest)
        return `${indent}subgraph ${rest}`
      }
      const safeId = nextSubgraphId()
      return `${indent}subgraph ${safeId} ["${rest}"]`
    }

    // 形式 4: `subgraph "标题"`、`subgraph 中文标题`、`subgraph A-B`、`subgraph Multi Word Title`
    const safeId = nextSubgraphId()
    const title = cleanSubgraphTitle(rest) || safeId
    if (!/\s/.test(rest) && !/^["']/.test(rest) && !vertexIds.has(rest)) {
      renamedSubgraphMap.set(rest, safeId)
    }
    return `${indent}subgraph ${safeId} ["${title}"]`
  })

  // 同步更新针对被重命名 subgraph id 的 style 指向
  const styleUpdatedLines = normalizedLines.map((line) => {
    const styleMatch = line.match(/^(\s*style\s+)(\S+)(\s+.+)$/i)
    if (styleMatch && renamedSubgraphMap.has(styleMatch[2])) {
      return `${styleMatch[1]}${renamedSubgraphMap.get(styleMatch[2])}${styleMatch[3]}`
    }
    return line
  })

  // 剥离空的 `subgraph ... end` 块（自内向外迭代，确保只含空子块的父块也能被剥离）
  let current = styleUpdatedLines
  let changed = true
  while (changed) {
    changed = false
    const stack = []
    const dropIndices = new Set()
    for (let i = 0; i < current.length; i += 1) {
      const trimmed = current[i].trim()
      if (!trimmed || trimmed.startsWith('%%')) continue
      if (/^subgraph\b/i.test(trimmed)) {
        stack.push({ startIndex: i, hasContent: false })
        continue
      }
      if (/^end\s*$/i.test(trimmed)) {
        const top = stack.pop()
        if (top) {
          if (!top.hasContent) {
            dropIndices.add(top.startIndex)
            dropIndices.add(i)
            changed = true
          } else if (stack.length > 0) {
            stack[stack.length - 1].hasContent = true
          }
        }
        continue
      }
      if (/^(direction|style|classDef|class|linkStyle|click)\b/i.test(trimmed)) {
        continue
      }
      if (stack.length > 0) {
        stack[stack.length - 1].hasContent = true
      }
    }
    if (changed) {
      current = current.filter((_, idx) => !dropIndices.has(idx))
    }
  }

  return current.join('\n')
}

// classDiagram 中 `class A{` 缺空格会触发 lexical error，这里强制补一个空格
const normalizeClassDiagramSpacing = (code = '') => String(code || '').replace(
  /\bclass\s+([A-Za-z_][\w]*)\s*\{/g,
  'class $1 {',
)

// 模型偶发把 ```mermaid 代码块标记包到 DSL 里；sanitizer 入口先剥一次保险
const stripFence = (code = '') => String(code || '')
  .replace(/^\s*```(?:mermaid)?\s*\n/i, '')
  .replace(/\n\s*```\s*$/i, '')
  .trim()

// mindmap/hierarchy 等靠缩进识别层级；模型偶尔输出 tab 或全角空格导致层级错乱
const normalizeIndent = (code = '') => String(code || '')
  .replace(/\t/g, '  ')
  .replace(/\u3000/g, '  ')

// 整行级别的硬过滤：Mermaid 各方言对 `linkStyle` 支持不一致（flowchart/graph 支持，block-beta/architecture/timeline 等不支持）。
// 这里只在非 flowchart 方言里整行丢弃 linkStyle，保证 flowchart 仍可受益于它。
const detectDiagramKind = (code = '') => {
  const firstLine = String(code).split('\n').map((l) => l.trim()).find(Boolean) || ''
  const m = firstLine.match(/^([A-Za-z][\w-]*)/)
  return (m ? m[1] : '').toLowerCase()
}

const isUnsupportedDirectiveLine = (line, kind) => {
  if (/^\s*linkStyle\b/i.test(line)) {
    return kind !== 'flowchart' && kind !== 'graph'
  }
  return false
}

// flowchart 合法语句的白名单关键字与节点/连接行的特征字符。
// 用来识别模型偶尔自造的伪指令行（例如 `bg #161618,#1e1b4b`），并整行丢弃。
const FLOWCHART_KEYWORD_RE = /^(flowchart|graph|subgraph|end|style|classDef|class|linkStyle|direction|click)\b/i
const FLOWCHART_LINK_RE = /(-->|---|-\.->|-\.-|==>|===|<-->|o--|--o|x--|--x)/
const FLOWCHART_NODE_SHAPE_RE = /[\[\]\(\){}<>]/

const isFlowchartGarbageLine = (line, kind) => {
  if (kind !== 'flowchart' && kind !== 'graph') return false
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('%%')) return false
  if (FLOWCHART_KEYWORD_RE.test(trimmed)) return false
  if (FLOWCHART_LINK_RE.test(trimmed)) return false
  if (FLOWCHART_NODE_SHAPE_RE.test(trimmed)) return false
  // 单独的节点 id 行（仅字母数字和下划线）也是合法的，保留
  if (/^[A-Za-z_][\w-]*\s*$/.test(trimmed)) return false
  // 其他都视为伪指令（例如 `bg #xxx,#yyy`、`theme dark` 这类模型自造）
  return true
}

// Mermaid erDiagram 的词法表里 CLASS / ORDER / GROUP / TYPE 等是保留 token，
// 模型经常拿它们当实体名，导致 `DEPARTMENT ||--o{ CLASS : has` 在 CLASS 处直接报
// `Expecting 'ENTITY_NAME', got 'CLASS'`。这里在解析前批量改名（CLASS → CLASS_）
// 同时同步替换实体定义块和关系行，让原本合法的 ER 语义保留。
const ER_RESERVED = ['CLASS', 'ORDER', 'GROUP', 'TYPE', 'KEY', 'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'ENTITY', 'RELATION', 'DEFAULT', 'NULL', 'TRUE', 'FALSE']
const renameErReservedEntities = (code) => {
  let out = code
  for (const word of ER_RESERVED) {
    // 仅替换"独立大写单词"出现的位置（不会动 CLASSROOM / SCHOOL_CLASS 这类已加修饰的词）
    const re = new RegExp(`(^|[\\s|}{])${word}(?=[\\s{|]|$)`, 'gm')
    out = out.replace(re, (_, pre) => `${pre}${word}_`)
  }
  return out
}

export const sanitizeMermaidCode = (code = '') => {
  const stripped = stripFence(String(code || '').replace(/\r/g, ''))
  const indented = normalizeIndent(stripped)
  const escaped = escapeReservedNodeIds(indented)
  const classFixed = normalizeClassDiagramSpacing(escaped)
  const normalized = autoQuoteFlowchartLabels(normalizeStatementBoundaries(classFixed))
  const subgraphNormalized = normalizeFlowchartSubgraphs(normalized)
  const kind = detectDiagramKind(subgraphNormalized)
  const reservedFixed = kind === 'erdiagram' ? renameErReservedEntities(subgraphNormalized) : subgraphNormalized
  const lines = reservedFixed.split('\n')
  const out = []
  let seenHeader = false
  for (const line of lines) {
    if (!seenHeader) {
      out.push(line)
      if (line.trim()) seenHeader = true
      continue
    }
    if (isUnsupportedDirectiveLine(line, kind)) continue
    if (isFlowchartGarbageLine(line, kind)) continue
    const cleaned = sanitizeMermaidStyleLine(line)
    if (cleaned) out.push(cleaned)
  }
  return out.filter(Boolean).join('\n')
}

/**
 * SVG dataURL → 高分辨率 PNG dataURL
 * 关键：canvas 像素缓冲 = 逻辑显示尺寸 × scale，最终图片在画布里仍然按逻辑尺寸显示，
 * 但因为像素密度更高，缩放后依然清晰。
 */
const svgDataURLToPng = ({ dataURL, width = 1200, height = 800 }) => new Promise((resolve, reject) => {
  const logicalW = Math.max(1, Math.ceil(width || 1200))
  const logicalH = Math.max(1, Math.ceil(height || 800))
  const scale = computeRenderScale(logicalW, logicalH)
  const pixelW = Math.round(logicalW * scale)
  const pixelH = Math.round(logicalH * scale)
  // 让 SVG 按目标像素尺寸光栅化，而不是先按小尺寸渲染再被拉伸
  const rawSvg = decodeDataURL(dataURL)
  const svgText = normalizeMermaidSvg(rawSvg, logicalW, logicalH)
    ?.replace(/(<svg\b[^>]*?)\swidth="[^"]*"/, `$1 width="${pixelW}"`)
    .replace(/(<svg\b[^>]*?)\sheight="[^"]*"/, `$1 height="${pixelH}"`)
    || sanitizeSvgText(rawSvg)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = pixelW
    canvas.height = pixelH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('无法创建 Canvas 上下文'))
      return
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    resolve({
      dataURL: canvas.toDataURL('image/png'),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      logicalWidth: logicalW,
      logicalHeight: logicalH,
    })
  }
  img.onerror = () => reject(new Error('SVG 转 PNG 失败'))
  img.src = encodeSvgDataURL(svgText)
})

const createFallbackPng = ({ width = 1200, height = 800, message = 'Mermaid image render failed' } = {}) => {
  const logicalW = Math.max(1, Math.ceil(width || 1200))
  const logicalH = Math.max(1, Math.ceil(height || 800))
  const scale = Math.min(2, computeRenderScale(logicalW, logicalH))
  const canvas = document.createElement('canvas')
  canvas.width = logicalW * scale
  canvas.height = logicalH * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, logicalW, logicalH)
  ctx.strokeStyle = '#e03131'
  ctx.lineWidth = 3
  ctx.strokeRect(12, 12, logicalW - 24, logicalH - 24)
  ctx.fillStyle = '#e03131'
  ctx.font = '24px sans-serif'
  ctx.fillText(message, 32, 56)
  return canvas.toDataURL('image/png')
}

const normalizeMermaidFiles = async (files = {}, elements = []) => {
  const now = Date.now()
  const elementByFileId = new Map(
    elements
      .filter(el => el?.type === 'image' && el.fileId)
      .map(el => [el.fileId, el]),
  )

  const entries = await Promise.all(Object.entries(files || {}).map(async ([id, file]) => {
    if (!file) return [id, file]
    const base = {
      ...file,
      id: file.id || id,
      created: file.created || now,
      lastRetrieved: file.lastRetrieved || now,
    }
    if (base.mimeType !== SVG_MIME) return [id, base]

    const imageElement = elementByFileId.get(base.id)
    const displayW = imageElement?.width || base.width
    const displayH = imageElement?.height || base.height
    // 首选：保留矢量 SVG，Excalidraw 按当前缩放实时绘制，放大不糊、文件也更小
    const vectorSvg = normalizeMermaidSvg(decodeDataURL(base.dataURL), displayW, displayH)
    if (vectorSvg) {
      return [id, { ...base, mimeType: SVG_MIME, dataURL: encodeSvgDataURL(vectorSvg) }]
    }
    try {
      const png = await svgDataURLToPng({
        dataURL: base.dataURL,
        width: imageElement?.width || base.width,
        height: imageElement?.height || base.height,
      })
      return [id, {
        ...base,
        mimeType: 'image/png',
        dataURL: png.dataURL,
      }]
    } catch (error) {
      logger.warn('[mermaidNative] SVG 转 PNG 失败，使用 PNG 占位图:', error.message)
      const fallback = createFallbackPng({
        width: imageElement?.width || base.width,
        height: imageElement?.height || base.height,
      })
      return [id, {
        ...base,
        mimeType: 'image/png',
        dataURL: fallback,
      }]
    }
  }))

  return Object.fromEntries(entries)
}

/**
 * 给元素打 tier / customData，让前端能识别"图片快照"和反查 DSL
 */
const annotateElements = (elements, { tier, mermaidSource }) => elements.map((el) => {
  if (el == null) return el
  const next = { ...el }
  if (next.type === 'image') {
    next.customData = {
      ...(next.customData || {}),
      tier: 3,
      kind: 'mermaid-image',
      mermaidSource: mermaidSource || '',
    }
  } else {
    next.customData = {
      ...(next.customData || {}),
      tier,
      kind: 'mermaid-native',
    }
  }
  return next
})

export const renderMermaidNative = async (mermaidCode, { offsetX = 100, offsetY = 100 } = {}) => {
  const effectiveCode = sanitizeMermaidCode(mermaidCode)
  const { elements: skeletons, files } = await parseCompatibleMermaid(effectiveCode, {
    themeVariables: { fontSize: '16px' },
  })
  if (!skeletons?.length) {
    throw new Error('Mermaid 解析未生成任何元素')
  }
  const concrete = convertToExcalidrawElements(skeletons, { regenerateIds: true })
  const normalizedFiles = await normalizeMermaidFiles(files, concrete)
  const hasImage = concrete.some(el => el?.type === 'image')
  const annotated = annotateElements(concrete, {
    tier: hasImage ? 3 : 1,
    mermaidSource: effectiveCode,
  })
  logger.log(`[mermaidNative] 元素数=${concrete.length} tier=${hasImage ? 3 : 1}`)
  return {
    elements: offsetElements(annotated, offsetX, offsetY),
    files: normalizedFiles,
    tier: hasImage ? 3 : 1,
  }
}
