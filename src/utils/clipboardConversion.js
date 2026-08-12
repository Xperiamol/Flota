import { encodeFlotaTable } from './flotaTableFormat.js'

/**
 * 剪贴板内容 → Markdown 转换工具
 *
 * 设计目标：
 * 1. 在 Markdown 源码模式下，把网页/Excel/Notion/飞书等来源的 HTML 表格、
 *    电子表格 TSV 文本，统一转成 Markdown 表格，避免格式严重退化。
 * 2. 把常见富文本结构（标题、列表、代码、引用、链接、图片）尽量保留为 Markdown，
 *    其余结构降级为纯文本。
 * 3. 不引入新依赖，纯前端实现，避免把整套 turndown 类库带进来造成包体膨胀。
 *
 * 注意：
 * - 这里只做"宽松"转换，目的是不丢内容，不追求 100% 还原 HTML 语义。
 * - 调用方应将本工具产物作为"提议"插入，遇到异常时回退到原始 text/plain。
 */

const TABLE_HTML_RE = /<table[\s\S]*?<\/table>/i
const TSV_LINE_BREAK_RE = /\r\n?|\n/

const escapeMarkdownTableCell = (text) => String(text ?? '')
  .replace(/\|/g, '\\|')
  .replace(/\r?\n+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const buildMarkdownTable = (rows) => {
  if (!rows || rows.length === 0) return ''
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (width === 0) return ''

  const normalize = (row) => {
    const next = row.slice(0, width)
    while (next.length < width) next.push('')
    return next.map(escapeMarkdownTableCell)
  }

  const header = normalize(rows[0])
  const divider = new Array(width).fill('---')
  const body = rows.slice(1).map(normalize)

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`)
  ]
  return lines.join('\n')
}

const cellTextFromElement = (el) => {
  if (!el) return ''
  // 先把 <br> 转换成空格，避免单元格内换行干扰 Markdown 表格
  const clone = el.cloneNode(true)
  clone.querySelectorAll('br').forEach(br => br.replaceWith(' '))
  return clone.textContent || ''
}

/**
 * 解析 HTML 字符串里的第一个 <table>，返回 Markdown 表格字符串。
 * 找不到合法表格时返回空字符串。
 */
export const htmlTableToMarkdown = (html) => {
  if (!html || typeof html !== 'string') return ''
  if (!TABLE_HTML_RE.test(html)) return ''

  let doc
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch (_) {
    return ''
  }
  const table = doc.querySelector('table')
  if (!table) return ''

  const sourceRows = Array.from(table.querySelectorAll('tr'))
  const semanticRows = sourceRows.map(tr => Array.from(tr.children)
    .filter(cell => /^(th|td)$/i.test(cell.tagName))
    .map(cell => ({
      text: cellTextFromElement(cell),
      colspan: Math.min(Math.max(Number(cell.getAttribute('colspan')) || 1, 1), 50),
      rowspan: Math.min(Math.max(Number(cell.getAttribute('rowspan')) || 1, 1), 500),
      header: cell.tagName.toLowerCase() === 'th',
    })))
  const hasMergedCells = semanticRows.some(row => row.some(cell => cell.colspan > 1 || cell.rowspan > 1))
  if (hasMergedCells) return encodeFlotaTable(semanticRows)

  const grid = []
  let width = 0

  sourceRows.forEach((tr, rowIndex) => {
    if (!grid[rowIndex]) grid[rowIndex] = []
    let columnIndex = 0
    Array.from(tr.children)
      .filter(cell => /^(th|td)$/i.test(cell.tagName))
      .forEach((cell) => {
        while (grid[rowIndex][columnIndex] !== undefined) columnIndex += 1
        const colSpan = Math.min(Math.max(Number(cell.getAttribute('colspan')) || 1, 1), 50)
        const rowSpan = Math.min(Math.max(Number(cell.getAttribute('rowspan')) || 1, 1), 500)
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          const targetRow = rowIndex + rowOffset
          if (!grid[targetRow]) grid[targetRow] = []
          for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
            grid[targetRow][columnIndex + colOffset] =
              rowOffset === 0 && colOffset === 0 ? cellTextFromElement(cell) : ''
          }
        }
        columnIndex += colSpan
        width = Math.max(width, columnIndex)
      })
  })

  const rows = grid.map(row => Array.from({ length: width }, (_, index) => row[index] || ''))
    .filter(row => row.some(cell => cell !== ''))

  return buildMarkdownTable(rows)
}

/**
 * Converts every legacy HTML table embedded in otherwise-valid Markdown.
 * Uses a bounded, linear tag scanner instead of a cross-document regex so malformed notes cannot
 * trigger pathological backtracking at the save boundary.
 */
export const normalizeHtmlTablesInMarkdown = (markdown) => {
  const source = String(markdown || '')
  const lower = source.toLowerCase()
  const findTag = (token, from) => {
    let index = from
    while (index < lower.length) {
      const found = lower.indexOf(token, index)
      if (found < 0) return -1
      const boundary = lower[found + token.length]
      if (boundary === undefined || boundary === '>' || boundary === '/' || /\s/.test(boundary)) return found
      index = found + token.length
    }
    return -1
  }
  if (!source || findTag('<table', 0) < 0) return source

  const output = []
  let cursor = 0

  while (cursor < source.length) {
    const start = findTag('<table', cursor)
    if (start < 0) {
      output.push(source.slice(cursor))
      break
    }
    output.push(source.slice(cursor, start))

    let depth = 1
    let scan = start + 6
    let end = -1
    while (scan < source.length && depth > 0) {
      const nextOpen = findTag('<table', scan)
      const nextClose = findTag('</table', scan)
      if (nextClose < 0) break
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1
        scan = nextOpen + 6
      } else {
        const closeBracket = lower.indexOf('>', nextClose + 7)
        if (closeBracket < 0) break
        depth -= 1
        scan = closeBracket + 1
        if (depth === 0) end = scan
      }
    }

    if (end < 0) {
      // Preserve malformed source verbatim. Android's compatibility reader can still display a
      // safe text fallback, while saving must never silently discard user content.
      output.push(source.slice(start))
      break
    }

    const originalTable = source.slice(start, end)
    output.push(htmlTableToMarkdown(originalTable) || originalTable)
    cursor = end
  }

  return output.join('')
}

/**
 * 判断纯文本是否可被合理识别为电子表格 TSV（来自 Excel/Numbers/飞书表格等）。
 * 条件：至少 2 行、至少 2 列、所有行列数一致或差异极小。
 */
export const looksLikeTsvTable = (text) => {
  if (!text || typeof text !== 'string') return false
  if (!text.includes('\t')) return false

  const rawLines = text.replace(/\r\n?/g, '\n').split('\n')
  // 去掉尾部空行（Excel 复制经常多一行空行）
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop()
  if (rawLines.length < 2) return false

  const counts = rawLines.map(line => line.split('\t').length)
  if (counts.some(c => c < 2)) return false

  const first = counts[0]
  // 允许极少数行多一格（合并单元格场景），但整体应保持稳定
  const stable = counts.every(c => Math.abs(c - first) <= 1)
  return stable
}

/**
 * TSV → Markdown 表格。仅在 looksLikeTsvTable() 通过后调用。
 */
export const tsvToMarkdownTable = (text) => {
  const lines = String(text).split(TSV_LINE_BREAK_RE)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return ''
  const rows = lines.map(line => line.split('\t'))
  return buildMarkdownTable(rows)
}

const NODE_TYPE_ELEMENT = 1
const NODE_TYPE_TEXT = 3

const collapseWhitespace = (s) => String(s).replace(/[ \t]+/g, ' ')

const sanitizeUrl = (url) => {
  const trimmed = String(url || '').trim()
  if (!trimmed) return ''
  // 仅允许常见可见协议 + 站内/相对路径，避免 javascript: 等注入
  if (/^(?:javascript|vbscript):/i.test(trimmed)) return ''
  return trimmed
}

const renderInlineHtml = (node) => {
  if (!node) return ''
  if (node.nodeType === NODE_TYPE_TEXT) return collapseWhitespace(node.nodeValue || '')
  if (node.nodeType !== NODE_TYPE_ELEMENT) return ''

  const tag = node.tagName?.toLowerCase?.() || ''
  const inner = Array.from(node.childNodes).map(renderInlineHtml).join('')

  switch (tag) {
    case 'br':
      return '\n'
    case 'strong':
    case 'b':
      return inner ? `**${inner}**` : ''
    case 'em':
    case 'i':
      return inner ? `*${inner}*` : ''
    case 'code':
      return inner ? `\`${inner}\`` : ''
    case 'del':
    case 's':
    case 'strike':
      return inner ? `~~${inner}~~` : ''
    case 'a': {
      const href = sanitizeUrl(node.getAttribute?.('href'))
      if (!href) return inner
      return inner ? `[${inner}](${href})` : href
    }
    case 'img': {
      const src = sanitizeUrl(node.getAttribute?.('src'))
      if (!src) return ''
      const alt = String(node.getAttribute?.('alt') || '').replace(/[\[\]]/g, '')
      return `![${alt}](${src})`
    }
    case 'span':
    case 'font':
    case 'u':
    default:
      return inner
  }
}

const renderListItems = (listNode, ordered, depth = 0) => {
  if (!listNode) return ''
  const indent = '  '.repeat(depth)
  const lines = []
  let counter = 1

  Array.from(listNode.children).forEach((li) => {
    if (!li || li.nodeType !== NODE_TYPE_ELEMENT) return
    if (li.tagName.toLowerCase() !== 'li') return

    const childLists = []
    const inlineNodes = []
    Array.from(li.childNodes).forEach((child) => {
      if (child.nodeType === NODE_TYPE_ELEMENT &&
          /^(ul|ol)$/i.test(child.tagName)) {
        childLists.push(child)
      } else {
        inlineNodes.push(child)
      }
    })

    const inlineText = inlineNodes.map(renderInlineHtml).join('').trim()
    const bullet = ordered ? `${counter}.` : '-'
    counter += 1

    lines.push(`${indent}${bullet} ${inlineText}`.trimEnd())

    childLists.forEach((sub) => {
      const subOrdered = sub.tagName.toLowerCase() === 'ol'
      const subLines = renderListItems(sub, subOrdered, depth + 1)
      if (subLines) lines.push(subLines)
    })
  })

  return lines.join('\n')
}

const renderBlockHtml = (node) => {
  if (!node) return ''
  if (node.nodeType === NODE_TYPE_TEXT) {
    const t = collapseWhitespace(node.nodeValue || '')
    return t.trim() ? t : ''
  }
  if (node.nodeType !== NODE_TYPE_ELEMENT) return ''

  const tag = node.tagName.toLowerCase()

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    const text = Array.from(node.childNodes).map(renderInlineHtml).join('').trim()
    return text ? `${'#'.repeat(level)} ${text}` : ''
  }

  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
    const inline = Array.from(node.childNodes).map(child => {
      if (child.nodeType === NODE_TYPE_ELEMENT &&
          /^(ul|ol|table|pre|blockquote|h[1-6]|hr)$/i.test(child.tagName)) {
        return `\n${renderBlockHtml(child)}\n`
      }
      return renderInlineHtml(child)
    }).join('')
    return inline.trim() ? inline.trim() : ''
  }

  if (tag === 'ul' || tag === 'ol') {
    return renderListItems(node, tag === 'ol', 0)
  }

  if (tag === 'pre') {
    const codeNode = node.querySelector('code')
    const langClass = codeNode?.getAttribute?.('class') || ''
    const langMatch = langClass.match(/language-([\w-]+)/i)
    const lang = langMatch ? langMatch[1] : ''
    const text = (codeNode?.textContent ?? node.textContent ?? '')
    return `\`\`\`${lang}\n${text.replace(/\s+$/g, '')}\n\`\`\``
  }

  if (tag === 'blockquote') {
    const inner = Array.from(node.childNodes).map(renderBlockHtml).join('\n').trim()
    return inner.split('\n').map(line => `> ${line}`).join('\n')
  }

  if (tag === 'table') {
    return htmlTableToMarkdown(node.outerHTML)
  }

  if (tag === 'hr') return '---'

  // 其他容器：递归渲染子块
  const children = Array.from(node.childNodes).map(renderBlockHtml).filter(Boolean)
  return children.join('\n\n').trim()
}

/**
 * HTML → Markdown 的"轻量"转换。
 * 仅覆盖常见结构：标题、段落、列表、代码块、引用、表格、链接、图片、加粗/斜体/行内代码。
 * 其余标签会按子节点递归降级为纯文本。
 *
 * 返回值是 trim 过的 Markdown，如果输入为空或仅空白返回 ''。
 */
export const htmlFragmentToMarkdown = (html) => {
  if (!html || typeof html !== 'string') return ''
  let doc
  try {
    doc = new DOMParser().parseFromString(`<div id="__flota_root__">${html}</div>`, 'text/html')
  } catch (_) {
    return ''
  }
  const root = doc.getElementById('__flota_root__')
  if (!root) return ''

  // 移除脚本/样式，避免污染输出
  root.querySelectorAll('script, style, meta, link').forEach(n => n.remove())

  const blocks = []
  Array.from(root.childNodes).forEach((child) => {
    const block = renderBlockHtml(child)
    if (block && block.trim()) blocks.push(block.trim())
  })

  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 综合判定：从剪贴板的 html 与 plain 文本里挑出最合适的 Markdown 文本。
 * 决策顺序：
 *   1. HTML 中包含 <table> → 仅返回该表格的 Markdown 形式
 *   2. HTML 中包含其他结构化内容 → 用轻量 HTML→Markdown
 *   3. 纯文本看起来像 TSV → 转 Markdown 表格
 *   4. 否则返回 plain 原文
 */
export const pickClipboardMarkdown = ({ html = '', plain = '' } = {}) => {
  const safeHtml = String(html || '')
  const safePlain = String(plain || '')

  if (TABLE_HTML_RE.test(safeHtml)) {
    const md = htmlTableToMarkdown(safeHtml)
    if (md) return { text: md, kind: 'table-html' }
  }

  if (safeHtml && /<(h[1-6]|ul|ol|pre|blockquote|a|img|strong|em|code|p|li)\b/i.test(safeHtml)) {
    const md = htmlFragmentToMarkdown(safeHtml)
    if (md && md.length >= 2) return { text: md, kind: 'rich-html' }
  }

  if (looksLikeTsvTable(safePlain)) {
    const md = tsvToMarkdownTable(safePlain)
    if (md) return { text: md, kind: 'tsv-table' }
  }

  return { text: safePlain, kind: 'plain' }
}
