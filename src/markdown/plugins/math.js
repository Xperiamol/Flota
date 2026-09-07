import katex from 'katex'
import MarkdownIt from 'markdown-it'

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))

const isEscaped = (text, pos) => {
  let count = 0
  while (pos > 0 && text[--pos] === '\\') count += 1
  return count % 2 === 1
}

// Shared by Markdown parsing and literal-text paste. Do not consume currency,
// escaped delimiters, or an unfinished expression.
export const readInlineMath = (text, start = 0) => {
  if (isEscaped(text, start)) return null
  const slash = text.startsWith('\\(', start)
  if (!slash && (text[start] !== '$' || text[start + 1] === '$' || text[start - 1] === '$')) return null
  const open = slash ? 2 : 1
  const closing = slash ? '\\)' : '$'
  if (!slash && /\s/.test(text[start + open] || ' ')) return null
  let end = start + open
  while ((end = text.indexOf(closing, end)) !== -1) {
    if (!isEscaped(text, end)) {
      const latex = text.slice(start + open, end)
      if (!latex || /\n/.test(latex)) return null
      if (!slash && (latex.includes('`') || /\s$/.test(latex) || /\d/.test(text[end + 1] || '') || text[end + 1] === '$')) return null
      return { latex, end: end + closing.length }
    }
    end += closing.length
  }
  return null
}

// Native MathML keeps preview and exported HTML self-contained (no remote fonts).
export const renderMath = (latex, display = false) => {
  try {
    return katex.renderToString(String(latex), {
      displayMode: display, output: 'mathml', throwOnError: false,
      trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20,
    })
  } catch {
    return `<code class="math-error">${escapeHtml(latex)}</code>`
  }
}

export const mathMarkup = (latex, display = false, render = true) => {
  const tag = display ? 'div' : 'span'
  const type = display ? 'math-block' : 'math-inline'
  return `<${tag} data-type="${type}" data-latex="${escapeHtml(latex)}" class="${type}">${render ? renderMath(latex, display) : ''}</${tag}>`
}

export default function mathPlugin(md, { render = true } = {}) {
  if (md.__flotaMathInstalled) return
  md.__flotaMathInstalled = true
  md.inline.ruler.before('escape', 'flota_math_inline', (state, silent) => {
    const match = readInlineMath(state.src, state.pos)
    if (!match || match.end > state.posMax) return false
    if (!silent) state.push('flota_math_inline', 'math', 0).content = match.latex
    state.pos = match.end
    return true
  })
  md.block.ruler.before('fence', 'flota_math_block', (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false
    const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim()
    const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null
    if (!open) return false
    const close = open === '$$' ? '$$' : '\\]'
    const lines = [first.slice(2)]
    let next = startLine
    let found = false
    while (next < endLine) {
      const line = lines[lines.length - 1]
      if (line.endsWith(close) && !isEscaped(line, line.length - 2)) {
        lines[lines.length - 1] = line.slice(0, -2)
        found = true
        break
      }
      next += 1
      if (next >= endLine || (state.sCount[next] < state.blkIndent && !state.isEmpty(next))) break
      lines.push(state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]))
    }
    const latex = lines.join('\n').trim()
    if (!found || !latex) return false
    if (silent) return true
    const token = state.push('flota_math_block', 'math', 0)
    token.block = true
    token.content = latex
    token.map = [startLine, next + 1]
    state.line = next + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.renderer.rules.flota_math_inline = (tokens, index) => mathMarkup(tokens[index].content, false, render)
  md.renderer.rules.flota_math_block = (tokens, index) => `${mathMarkup(tokens[index].content, true, render)}\n`
}

let sourceParser
// Whitespace preservation and custom highlight syntax must not rewrite LaTeX.
// Protect whole block/code tokens first, then inline math and code spans.
export const transformOutsideMath = (source, transform) => {
  if (!source) return transform(source)
  sourceParser ||= new MarkdownIt().use(mathPlugin, { render: false })
  const saved = []
  let prefix = 'FLOTAPROTECTED'
  while (source.includes(prefix)) prefix += 'X'
  const hold = value => `${prefix}${saved.push(value) - 1}END`
  const lines = source.split('\n')
  const ranges = sourceParser.parse(source, {}).filter(token => ['flota_math_block', 'fence', 'code_block'].includes(token.type) && token.map)
  for (const token of ranges.reverse()) {
    const [from, to] = token.map
    lines.splice(from, to - from, hold(lines.slice(from, to).join('\n')))
  }
  let masked = lines.join('\n')
  let result = ''
  for (let pos = 0; pos < masked.length;) {
    if (masked[pos] === '`' && !isEscaped(masked, pos)) {
      const ticks = masked.slice(pos).match(/^`+/)[0]
      const end = masked.indexOf(ticks, pos + ticks.length)
      if (end !== -1) { result += hold(masked.slice(pos, end + ticks.length)); pos = end + ticks.length; continue }
    }
    const match = readInlineMath(masked, pos)
    if (match) { result += hold(masked.slice(pos, match.end)); pos = match.end }
    else { result += masked[pos]; pos += 1 }
  }
  return transform(result).replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (_, index) => saved[Number(index)])
}
