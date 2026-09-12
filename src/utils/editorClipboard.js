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
  const nodes = []
  for (let line = 0; line < lines.length; line += 1) {
    const math = blocks.get(line)
    if (math && schema.nodes.blockMath) {
      nodes.push(schema.nodes.blockMath.create({ latex: math.content }))
      line = math.map[1] - 1
    } else {
      const content = codeLines.has(line) ? (lines[line] ? [schema.text(lines[line], marks)] : []) : inlineNodes(schema, lines[line], marks)
      nodes.push(schema.nodes.paragraph.create(null, content))
    }
  }
  const slice = new Slice(Fragment.fromArray(nodes), nodes[0].isTextblock ? 1 : 0, nodes.at(-1).isTextblock ? 1 : 0)
  view.dispatch(state.tr.replaceSelection(slice).setMeta('preventAutolink', true).scrollIntoView())
  return true
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
