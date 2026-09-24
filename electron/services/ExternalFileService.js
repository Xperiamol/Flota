const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

// 从系统（双击 / 打开方式 / 拖到 Dock）或「打开文件…」打开的外部文件。
//
// 设计要点：
// - 只读：外部文件在查看器中只读展示，不会被改写；需要编辑时「导入为笔记」生成副本。
// - 白名单：渲染层只能读取由系统或打开对话框交给主进程的路径，不能借 IPC 读任意文件。
// - 兼容：自动识别 UTF-8 / UTF-8 BOM / UTF-16 / GB18030 编码，统一换行符；
//   Markdown 中引用的本地图片内联为 data URL（CSP 不允许 file://），导入时再落盘。

const FORMAT_BY_EXT = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdown': 'markdown',
  '.mkd': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.excalidraw': 'whiteboard'
}

const MAX_TEXT_BYTES = 20 * 1024 * 1024
const MAX_WHITEBOARD_BYTES = 60 * 1024 * 1024
const MAX_INLINE_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_INLINE_IMAGES_TOTAL = 60 * 1024 * 1024

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
}

const getFormat = (filePath) => FORMAT_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || null

const isSupportedFile = (filePath) => {
  if (!filePath || !getFormat(filePath)) return false
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

// 从命令行参数中挑出可打开的文件（Windows / Linux 双击文件时通过 argv 传入）
const extractFilesFromArgv = (argv = []) => argv
  .slice(1)
  .filter((arg) => typeof arg === 'string' && !arg.startsWith('-'))
  .map((arg) => path.resolve(arg))
  .filter(isSupportedFile)

const decodeText = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'UTF-8 (BOM)' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'UTF-16 LE' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'UTF-16 BE' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' }
  } catch {
    // 常见于 Windows 记事本保存的中文文本
    try {
      return { text: new TextDecoder('gb18030').decode(buffer), encoding: 'GB18030' }
    } catch {
      return { text: buffer.toString('utf8'), encoding: 'UTF-8 (有损)' }
    }
  }
}

// 简单 YAML front-matter：只取 title / tags，其他字段原样保留在正文中不处理
const parseFrontMatter = (text) => {
  const match = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!match) return { frontMatter: null, body: text }
  const meta = {}
  const lines = match[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    let value = kv[2].trim()
    if (key === 'tags' || key === 'tag') {
      let tags = []
      if (value.startsWith('[') && value.endsWith(']')) {
        tags = value.slice(1, -1).split(',')
      } else if (value) {
        tags = value.split(/[,，\s]+/)
      } else {
        // YAML 列表写法
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          tags.push(lines[++i].replace(/^\s*-\s+/, ''))
        }
      }
      meta.tags = tags.map((t) => t.trim().replace(/^['"#]|['"]$/g, '')).filter(Boolean)
    } else if (key === 'title') {
      meta.title = value.replace(/^['"]|['"]$/g, '')
    }
  }
  return { frontMatter: meta, body: text.slice(match[0].length) }
}

const isExternalRef = (target) => /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)

// 把 Markdown 里引用的本地图片（相对路径 / 绝对路径 / file://）内联为 data URL
const inlineLocalImages = (markdown, baseDir) => {
  let total = 0
  let missing = 0
  const cache = new Map()
  const toDataUrl = (rawTarget) => {
    let target = rawTarget.trim().replace(/^<|>$/g, '')
    try { target = decodeURI(target) } catch {}
    let absolute
    if (/^file:\/\//i.test(target)) {
      try { absolute = new URL(target).pathname } catch { return null }
      if (process.platform === 'win32') absolute = absolute.replace(/^\/([A-Za-z]:)/, '$1')
    } else if (isExternalRef(target)) {
      return null
    } else {
      absolute = path.isAbsolute(target) ? target : path.resolve(baseDir, target)
    }
    const mime = IMAGE_MIME[path.extname(absolute).toLowerCase()]
    if (!mime) return null
    if (cache.has(absolute)) return cache.get(absolute)
    let result = null
    try {
      const stat = fs.statSync(absolute)
      if (stat.isFile() && stat.size <= MAX_INLINE_IMAGE_BYTES && total + stat.size <= MAX_INLINE_IMAGES_TOTAL) {
        total += stat.size
        result = `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`
      }
    } catch {
      missing += 1
    }
    cache.set(absolute, result)
    return result
  }

  const content = markdown
    // ![alt](path "title")
    .replace(/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?\s*\))/g, (all, head, target, tail) => {
      const dataUrl = toDataUrl(target)
      // 去掉可选的 "title"：导入时按 ![alt](data:...) 形式把图片落盘
      return dataUrl ? `${head}${dataUrl})` : all
    })
    // <img src="path">
    .replace(/(<img\b[^>]*?\ssrc=)(["'])([^"']+)\2/gi, (all, head, quote, target) => {
      const dataUrl = toDataUrl(target)
      return dataUrl ? `${head}${quote}${dataUrl}${quote}` : all
    })
  return { content, missingImages: missing }
}

const parseWhiteboard = (text) => {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 Excalidraw 文件（JSON 解析失败）')
  }
  if (!data || !Array.isArray(data.elements)) {
    throw new Error('不是有效的 Excalidraw 文件（缺少 elements）')
  }
  return {
    elements: data.elements.filter((el) => el && !el.isDeleted),
    appState: { viewBackgroundColor: data.appState?.viewBackgroundColor || '#ffffff' },
    files: data.files && typeof data.files === 'object' ? data.files : {}
  }
}

class ExternalFileService {
  constructor() {
    this.allowedPaths = new Set()
    this.pendingPaths = []
    this.deliver = null
    this.ready = false
  }

  // deliver(path) 负责把文件交给窗口；渲染层第一次取积压列表后才视为就绪
  attach(deliver) {
    this.deliver = deliver
  }

  // 只登记白名单（打开对话框的结果由渲染层自己打开）
  allow(filePath) {
    const resolved = path.resolve(String(filePath || ''))
    if (!isSupportedFile(resolved)) return null
    this.allowedPaths.add(resolved)
    return resolved
  }

  // 系统交来的文件：登记白名单，渲染层就绪则直接投递，否则排队
  open(filePath) {
    const resolved = this.allow(filePath)
    if (!resolved) return false
    if (this.ready && this.deliver?.(resolved)) return true
    if (!this.pendingPaths.includes(resolved)) this.pendingPaths.push(resolved)
    return true
  }

  consumePending() {
    this.ready = true
    const list = this.pendingPaths
    this.pendingPaths = []
    return list
  }

  isAllowed(filePath) {
    return this.allowedPaths.has(path.resolve(String(filePath || '')))
  }

  read(filePath) {
    const resolved = path.resolve(String(filePath || ''))
    if (!this.isAllowed(resolved)) throw new Error('无权读取该文件')
    const format = getFormat(resolved)
    if (!format) throw new Error('不支持的文件格式')

    const stat = fs.statSync(resolved)
    const limit = format === 'whiteboard' ? MAX_WHITEBOARD_BYTES : MAX_TEXT_BYTES
    if (stat.size > limit) {
      throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），最多支持 ${limit / 1024 / 1024} MB`)
    }

    const { text: rawText, encoding } = decodeText(fs.readFileSync(resolved))
    const text = rawText.replace(/\r\n?/g, '\n')
    let writable = false
    try {
      fs.accessSync(resolved, fs.constants.W_OK)
      writable = true
    } catch {}

    const base = {
      path: resolved,
      name: path.basename(resolved),
      title: path.basename(resolved, path.extname(resolved)),
      ext: path.extname(resolved).toLowerCase(),
      format,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      encoding,
      writable,
      fileUrl: pathToFileURL(resolved).href
    }

    if (format === 'whiteboard') {
      return { ...base, whiteboard: parseWhiteboard(text) }
    }
    if (format === 'text') {
      return { ...base, content: text }
    }
    const { frontMatter, body } = parseFrontMatter(text)
    const { content, missingImages } = inlineLocalImages(body, path.dirname(resolved))
    return {
      ...base,
      title: frontMatter?.title || base.title,
      tags: frontMatter?.tags || [],
      content,
      missingImages
    }
  }
}

module.exports = {
  ExternalFileService,
  SUPPORTED_EXTENSIONS: Object.keys(FORMAT_BY_EXT).map((ext) => ext.slice(1)),
  extractFilesFromArgv,
  isSupportedFile
}
