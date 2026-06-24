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
 *   1) SVG → 高分辨率 PNG，避免 Excalidraw `normalizeSVG` 严格校验失败 + 解决低清糊化
 *   2) 给每个 image 元素附 customData = { tier:3, kind:'mermaid-image', mermaidSource }，
 *      以后可双击编辑 DSL 重新生成
 */
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import logger from '../logger'

const SVG_MIME = 'image/svg+xml'

// 高分辨率渲染倍率：Retina 屏取 DPR，封顶 4，避免极端机型生成超大图导致内存爆炸
const computeRenderScale = () => {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return Math.min(4, Math.max(2, Math.round(dpr * 1.5)))
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
const MERMAID_RESERVED_AS_ID_RE = /\b(class|graph|flowchart|end|subgraph|style|click|direction|linkStyle|classDef)([\[\(\{])/g
const escapeReservedNodeIds = (code = '') => String(code || '').replace(
  MERMAID_RESERVED_AS_ID_RE,
  (_, word, bracket) => `_${word}${bracket}`,
)

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
// 用来识别模型偶尔自造的伪指令行（例如 `bg #0f172a,#1e1b4b`），并整行丢弃。
const FLOWCHART_KEYWORD_RE = /^(flowchart|graph|subgraph|end|style|classDef|class|linkStyle|direction|click)\b/i
const FLOWCHART_LINK_RE = /(-->|---|-\.->|-\.-|==>|===|<-->|o--|--o|x--|--x)/
const FLOWCHART_NODE_SHAPE_RE = /[\[\]\(\){}<>]/

const isFlowchartGarbageLine = (line, kind, isFirstNonHeader) => {
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
  return !isFirstNonHeader
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

const sanitizeMermaidCode = (code = '') => {
  const stripped = stripFence(String(code || '').replace(/\r/g, ''))
  const indented = normalizeIndent(stripped)
  const escaped = escapeReservedNodeIds(indented)
  const classFixed = normalizeClassDiagramSpacing(escaped)
  const normalized = autoQuoteFlowchartLabels(normalizeStatementBoundaries(classFixed))
  const kind = detectDiagramKind(normalized)
  const reservedFixed = kind === 'erdiagram' ? renameErReservedEntities(normalized) : normalized
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
    if (isFlowchartGarbageLine(line, kind, false)) continue
    const cleaned = sanitizeMermaidStyleLine(line)
    if (cleaned) out.push(cleaned)
  }
  return out.filter(Boolean).join('\n')
}

const flattenSubgraphFlowchart = (code = '') => {
  const lines = String(code || '').replace(/\r/g, '').split('\n')
  return lines
    .filter((line) => !/^\s*subgraph\b/i.test(line))
    .filter((line) => !/^\s*end\s*$/i.test(line))
    .join('\n')
}

/**
 * SVG dataURL → 高分辨率 PNG dataURL
 * 关键：canvas 像素缓冲 = 逻辑显示尺寸 × scale，最终图片在画布里仍然按逻辑尺寸显示，
 * 但因为像素密度更高，缩放后依然清晰。
 */
const svgDataURLToPng = ({ dataURL, width = 1200, height = 800 }) => new Promise((resolve, reject) => {
  const svgText = sanitizeSvgText(decodeDataURL(dataURL))
  const img = new Image()
  img.onload = () => {
    const logicalW = Math.max(1, Math.ceil(width || img.naturalWidth || 1200))
    const logicalH = Math.max(1, Math.ceil(height || img.naturalHeight || 800))
    const scale = computeRenderScale()
    const canvas = document.createElement('canvas')
    canvas.width = logicalW * scale
    canvas.height = logicalH * scale
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
  const scale = computeRenderScale()
  const logicalW = Math.max(1, Math.ceil(width || 1200))
  const logicalH = Math.max(1, Math.ceil(height || 800))
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
  const parseWithFallback = async (sourceCode) => {
    const sanitizedCode = sanitizeMermaidCode(sourceCode)
    try {
      return await parseMermaidToExcalidraw(sanitizedCode, {
        themeVariables: { fontSize: '16px' },
      })
    } catch (error) {
      if (/SubGraph element not found/i.test(error?.message || '') && /\bsubgraph\b/i.test(sanitizedCode)) {
        logger.warn('[mermaidNative] subgraph 解析失败，尝试扁平化重试')
        const flattened = flattenSubgraphFlowchart(sanitizedCode)
        return parseMermaidToExcalidraw(flattened, {
          themeVariables: { fontSize: '16px' },
        })
      }
      throw error
    }
  }

  const effectiveCode = sanitizeMermaidCode(mermaidCode)
  const { elements: skeletons, files } = await parseWithFallback(effectiveCode)
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
