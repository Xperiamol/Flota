import MarkdownIt from 'markdown-it'
import { Fragment, Slice } from '@tiptap/pm/model'
import { normalizeLinkUrl } from './linkUtils.js'
import mathPlugin, { mathMarkup, readInlineMath } from '../markdown/plugins/math.js'

const md = new MarkdownIt().use(mathPlugin, { render: false })
const linkify = md.linkify

export const getClipboardLink = (text) => {
  const value = String(text || '').trim()
  if (!value || /\n/.test(value)) return null
  // Markdown links copied from source mode retain their label.
  if (value.startsWith('[')) {
    const tokens = md.parseInline(value, {})[0]?.children || []
    if (tokens[0]?.type === 'link_open' && tokens.at(-1)?.type === 'link_close' && tokens.slice(1, -1).every(token => token.type === 'text')) {
      const href = normalizeLinkUrl(tokens[0].attrGet('href'))
      if (href) return { href, label: tokens.slice(1, -1).map(token => token.content).join('') }
    }
    return null
  }
  if (/\s/.test(value)) return null
  const href = normalizeLinkUrl(value)
  return href ? { href, label: value.replace(/^[<“]|[>”]$/g, '') } : null
}

const inlineNodes = (schema, text, marks) => {
  const nodes = []
  const pushText = (value) => {
    if (!value) return
    const matches = linkify.match(value) || []
    let offset = 0
    for (const match of matches) {
      const href = normalizeLinkUrl(match.url)
      if (!href || !schema.marks.link) continue
      if (match.index > offset) nodes.push(schema.text(value.slice(offset, match.index), marks))
      nodes.push(schema.text(match.raw, schema.marks.link.create({ href }).addToSet(marks)))
      offset = match.lastIndex
    }
    if (offset < value.length) nodes.push(schema.text(value.slice(offset), marks))
  }
  let offset = 0
  for (let pos = 0; pos < text.length; pos += 1) {
    // Backtick-delimited source snippets stay literal during plain text paste.
    if (text[pos] === '`') {
      const ticks = text.slice(pos).match(/^`+/)[0]
      const end = text.indexOf(ticks, pos + ticks.length)
      if (end !== -1) {
        pushText(text.slice(offset, pos))
        nodes.push(schema.text(text.slice(pos, end + ticks.length), marks))
        pos = end + ticks.length - 1
        offset = pos + 1
        continue
      }
    }
    const math = schema.nodes.inlineMath && readInlineMath(text, pos)
    if (!math) continue
    pushText(text.slice(offset, pos))
    nodes.push(schema.nodes.inlineMath.create({ latex: math.latex }, null, marks))
    pos = math.end - 1
    offset = math.end
  }
  pushText(text.slice(offset))
  return nodes
}

// Use the same transaction for keyboard and context-menu paste, preserving undo
// and selected text. Ordinary Markdown punctuation is kept literally.
export const pasteEditorText = (view, text, { plain = false } = {}) => {
  if (!text) return false
  const { state } = view
  const { schema, selection } = state
  const marks = state.storedMarks || selection.$from.marks()
  const code = selection.$from.parent.type.spec.code || marks.some(mark => mark.type.name === 'code')
  const normalized = String(text).replace(/\r\n?/g, '\n')
  if (code || plain) {
    view.dispatch(state.tr.insertText(normalized).setMeta('preventAutolink', true).scrollIntoView())
    return true
  }
  const link = getClipboardLink(normalized)
  if (link && schema.marks.link) {
    const mark = schema.marks.link.create({ href: link.href })
    const tr = state.tr
    if (!selection.empty && selection.$from.sameParent(selection.$to) && selection.$from.parent.inlineContent) {
      tr.addMark(selection.from, selection.to, mark)
    } else {
      tr.replaceSelectionWith(schema.text(link.label, mark.addToSet(marks)), false)
    }
    tr.removeStoredMark(schema.marks.link)
    view.dispatch(tr.setMeta('preventAutolink', true).scrollIntoView())
    return true
  }
  const tokens = md.parse(normalized, {})
  if (tokens.length === 1 && tokens[0].type === 'flota_math_block' && schema.nodes.blockMath) {
    view.dispatch(state.tr.replaceSelectionWith(schema.nodes.blockMath.create({ latex: tokens[0].content })).scrollIntoView())
    return true
  }
  const lines = normalized.split('\n')
  const blocks = new Map(tokens.filter(token => token.type === 'flota_math_block').map(token => [token.map[0], token]))
  const codeLines = new Set(tokens.filter(token => ['fence', 'code_block'].includes(token.type)).flatMap(token => Array.from({ length: token.map[1] - token.map[0] }, (_, i) => token.map[0] + i)))
  // 与笔记存储一致：相邻的行是同一段里的换行，空行分段，多出来的空行保留为空段落。
  // 以前每一行都单独成段，粘贴后行距变大，保存出来也和原文不一样。
  const hardBreak = schema.nodes.hardBreak
  const nodes = []
  let current = null
  let blankLines = 0
  const closeParagraph = () => {
    if (current) nodes.push(schema.nodes.paragraph.create(null, current))
    current = null
  }
  const startBlock = () => {
    if (nodes.length) for (let i = 1; i < blankLines; i += 1) nodes.push(schema.nodes.paragraph.create())
    blankLines = 0
  }
  for (let line = 0; line < lines.length; line += 1) {
    const math = blocks.get(line)
    const isCode = codeLines.has(line)
    if (math && schema.nodes.blockMath) {
      closeParagraph()
      startBlock()
      nodes.push(schema.nodes.blockMath.create({ latex: math.content }))
      line = math.map[1] - 1
    } else if (!isCode && !lines[line].trim()) {
      if (current) closeParagraph()
      blankLines += 1
    } else {
      const content = isCode ? (lines[line] ? [schema.text(lines[line], marks)] : []) : inlineNodes(schema, lines[line], marks)
      if (current && hardBreak) {
        current.push(hardBreak.create(), ...content)
      } else {
        closeParagraph()
        startBlock()
        current = content
      }
    }
  }
  closeParagraph()
  if (!nodes.length) nodes.push(schema.nodes.paragraph.create())
  const slice = new Slice(Fragment.fromArray(nodes), nodes[0].isTextblock ? 1 : 0, nodes.at(-1).isTextblock ? 1 : 0)
  view.dispatch(state.tr.replaceSelection(slice).setMeta('preventAutolink', true).scrollIntoView())
  return true
}

/**
 * 纯文本是不是一段 Markdown（AI 对话的「复制」按钮、README、别的笔记软件的源码）。
 * 只看明显的结构，至少两处信号才算：日志、代码、带 # 注释的脚本不会被误判。
 */
export const looksLikeMarkdown = (text) => {
  const value = String(text || '').replace(/\r\n?/g, '\n')
  if (!value.includes('\n')) return false
  const lines = value.split('\n')
  const has = (re) => lines.some(line => re.test(line))
  let score = 0
  if (has(/^\s{0,3}(?:```|~~~)/)) score += 2
  if (has(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/)) score += 2
  if (has(/^#{1,6}\s+\S/)) score += 1
  if (lines.filter(line => /^\s*(?:[-*+]|\d{1,3}[.)])\s+\S/.test(line)).length >= 2) score += 1
  if (has(/^>\s?\S/)) score += 1
  if (/\*\*[^*\n]+\*\*/.test(value)) score += 1
  if (/\[[^\]\n]+\]\((?:https?:\/\/|\.{0,2}\/)[^)\s]*\)/.test(value)) score += 1
  if (/(?:^|[^`])`[^`\n]+`(?!`)/.test(value)) score += 1
  return score >= 2
}

/**
 * VS Code、Cursor 等编辑器复制出来的代码：外层是 white-space: pre 的等宽字体 div，
 * 每行一个 div、关键字各自带颜色。按 HTML 粘贴会变成一堆带颜色的段落。
 */
export const isCodeEditorHtml = (html) => {
  if (!html || !/white-space:\s*pre/i.test(html)) return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = [...doc.body.children].find(element => element.tagName !== 'META')
  if (!root || root.tagName === 'PRE') return false
  const style = root.getAttribute('style') || ''
  return /white-space:\s*pre/i.test(style)
    && /font-family:[^;]*(?:consolas|menlo|monaco|courier|mono|code|fira|cascadia)/i.test(style)
}

export const normalizePastedHtml = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('a[href]').forEach(anchor => {
    const href = normalizeLinkUrl(anchor.getAttribute('href'), { allowRelative: true })
    if (href) anchor.setAttribute('href', href)
    else anchor.removeAttribute('href')
  })
  // Support copying formulas out of web pages that expose their TeX annotation.
  doc.querySelectorAll('.katex-display, .katex, math').forEach(element => {
    if (!element.isConnected) return
    const source = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (!source) return
    element.outerHTML = mathMarkup(source, element.matches('.katex-display, math[display="block"]'), false)
  })
  // Rich clipboard payloads often wrap Markdown source in styled spans.
  // Parse whole formula-only blocks first, then inline text; leave code literal.
  doc.querySelectorAll('p, div').forEach(element => {
    if (!element.isConnected || element.closest('pre, code, [data-latex]') || element.querySelector('p, div, img, [data-latex]')) return
    const source = element.innerHTML.replace(/<br\s*\/?\s*>/gi, '\n')
    const holder = doc.createElement('div')
    holder.innerHTML = source
    const tokens = md.parse(holder.textContent.trim(), {})
    if (tokens.length === 1 && tokens[0].type === 'flota_math_block') {
      element.outerHTML = mathMarkup(tokens[0].content, true, false)
    }
  })
  const walker = doc.createTreeWalker(doc.body, 4)
  const texts = []
  while (walker.nextNode()) texts.push(walker.currentNode)
  for (const node of texts) {
    if (node.parentElement?.closest('pre, code, math, [data-latex], .katex')) continue
    const text = node.textContent
    const fragment = doc.createDocumentFragment()
    let offset = 0
    for (let pos = 0; pos < text.length; pos++) {
      if (text[pos] === '`') {
        const ticks = text.slice(pos).match(/^`+/)[0]
        const end = text.indexOf(ticks, pos + ticks.length)
        if (end >= 0) { pos = end + ticks.length - 1; continue }
      }
      const match = readInlineMath(text, pos)
      if (!match) continue
      fragment.append(doc.createTextNode(text.slice(offset, pos)))
      const holder = doc.createElement('span')
      holder.innerHTML = mathMarkup(match.latex, false, false)
      fragment.append(holder.firstChild)
      offset = match.end
      pos = offset - 1
    }
    if (offset) {
      fragment.append(doc.createTextNode(text.slice(offset)))
      node.replaceWith(fragment)
    }
  }
  return doc.body.innerHTML
}
