// PDF → Markdown：按坐标把文字片段拼回行和段落，字号明显大于正文的短行作为标题。
const path = require('path')
const { pathToFileURL } = require('url')
const { escapeLine, escapeInline } = require('./textUtils')

const MAX_PAGES = 500
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/
// 不少 PDF 的字体把“工”“心”等映射成外形相同的康熙部首，搜索时对不上；只规范部首区段，不动全角、半角字符
const normalizeRadicals = (text) => text.replace(/[\u2e80-\u2fdf]/g, (char) => char.normalize('NFKC'))

// pdf.js 要求 cMapUrl / standardFontDataUrl 以「/」结尾，Windows 的路径是反斜杠，直接拼会报
// "Invalid factory url ... must include trailing slash"。传给它统一用正斜杠的目录地址，
// 真正读文件时再换回本机路径（app.asar 里的文件也要用本机路径才能读到）。
const toDirUrl = (dir) => `${dir.split(path.sep).join('/')}/`
class NativeBinaryDataFactory {
  constructor({ cMapUrl = null, standardFontDataUrl = null, wasmUrl = null } = {}) {
    this.urls = { cMapUrl, standardFontDataUrl, wasmUrl }
  }

  async fetch({ kind, filename }) {
    const base = this.urls[kind]
    if (!base) throw new Error(`Ensure that the \`${kind}\` API parameter is provided.`)
    const file = path.normalize(`${base}${filename}`)
    try {
      return new Uint8Array(await require('fs').promises.readFile(file))
    } catch (error) {
      throw new Error(`Unable to load ${kind === 'cMapUrl' ? 'CMap' : 'font'} data at: ${file}`)
    }
  }
}

let pdfjsPromise = null
const loadPdfjs = () => {
  pdfjsPromise ||= (async () => {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
    const pdfjs = await import(pathToFileURL(path.join(root, 'legacy/build/pdf.min.mjs')).href)
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'legacy/build/pdf.worker.min.mjs')).href
    return { pdfjs, root }
  })()
  return pdfjsPromise
}

const joinLines = (previous, next) => {
  if (!previous) return next
  if (previous.endsWith('-') && /^[a-z]/.test(next)) return previous.slice(0, -1) + next
  return CJK.test(previous.slice(-1)) || CJK.test(next[0]) ? previous + next : `${previous} ${next}`
}

const pageLines = (items) => {
  const lines = []
  let current = null
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    const [, , , scaleY, x, y] = item.transform
    const height = Math.abs(item.height || scaleY) || 1
    // 同一基线（容差半个字高）的片段属于同一行
    if (!current || Math.abs(current.y - y) > height * 0.5) {
      current = { y, x, height, text: '' }
      lines.push(current)
    }
    if (current.text && item.str && x - current.endX > height * 0.25 && !/\s$/.test(current.text)) current.text += ' '
    current.text += normalizeRadicals(item.str)
    current.endX = x + (item.width || 0)
    current.height = Math.max(current.height, height)
    if (item.hasEOL) current = null
  }
  return lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() })).filter((line) => line.text)
}

const pdfToMarkdown = async (buffer) => {
  const { pdfjs, root } = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: toDirUrl(path.join(root, 'cmaps')),
    cMapPacked: true,
    standardFontDataUrl: toDirUrl(path.join(root, 'standard_fonts')),
    BinaryDataFactory: NativeBinaryDataFactory,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  let document
  try {
    document = await task.promise
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('PDF 有密码保护，无法读取')
    throw new Error(`PDF 解析失败：${error.message}`)
  }
  try {
    const metadata = await document.getMetadata().catch(() => null)
    const pages = []
    const pageCount = Math.min(document.numPages, MAX_PAGES)
    for (let number = 1; number <= pageCount; number++) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      pages.push(pageLines(content.items))
      page.cleanup()
    }
    const all = pages.flat()
    if (all.map((line) => line.text).join('').replace(/\s/g, '').length < 20) {
      throw new Error('这个 PDF 没有可提取的文字（可能是扫描件或图片）')
    }
    const heights = all.map((line) => line.height).sort((a, b) => a - b)
    const body = heights[Math.floor(heights.length / 2)]

    const blocks = []
    for (const lines of pages) {
      let paragraph = ''
      let previous = null
      const flush = () => { if (paragraph) blocks.push(escapeLine(paragraph)); paragraph = '' }
      for (const line of lines) {
        const isHeading = line.height >= body * 1.35 && line.text.length <= 80
        const gap = previous ? Math.abs(previous.y - line.y) : 0
        if (isHeading) {
          flush()
          blocks.push(`${line.height >= body * 1.8 ? '#' : '##'} ${escapeInline(line.text)}`)
        } else {
          // 行距明显变大或缩进变化时另起一段
          if (previous && (gap > previous.height * 1.8 || line.x - previous.x > body * 1.5)) flush()
          paragraph = joinLines(paragraph, line.text)
        }
        previous = isHeading ? null : line
      }
      flush()
    }
    const note = document.numPages > MAX_PAGES ? `\n\n> 共 ${document.numPages} 页，只转换了前 ${MAX_PAGES} 页` : ''
    return { title: metadata?.info?.Title?.trim() || '', markdown: blocks.join('\n\n') + note }
  } finally {
    await task.destroy()
  }
}

module.exports = { pdfToMarkdown }
