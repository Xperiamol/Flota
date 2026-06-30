/**
 * Flota Markdown 渲染引擎
 * 基于 markdown-it 构建，支持扩展插件系统
 */

import MarkdownIt from 'markdown-it'
import markdownItMark from 'markdown-it-mark'
import hljs from 'highlight.js'

// 导入自定义插件
import highlightPlugin from './plugins/highlight.js'
import colorTextPlugin from './plugins/colorText.js'
import calloutPlugin from './plugins/callout.js'
import wikiLinkPlugin from './plugins/wikiLink.js'
import tagPlugin from './plugins/tag.js'
import customContainerPlugin from './plugins/customContainer.js'

export const RICH_TEXT_EMPTY_LINE_SENTINEL = '\u200B'
const RICH_TEXT_SPACE_SENTINEL = '\u00A0'
const RICH_TEXT_SPACE_SENTINEL_RE = new RegExp(RICH_TEXT_SPACE_SENTINEL, 'g')

const LOCAL_APP_ASSET_RE = /^(?:images|audio|attachments)\//i
const LOCAL_RESOURCE_DEST_RE = '(?:file:\\/\\/[^)>\\n]+|(?:app:\\/\\/)?(?:images|audio|attachments)\\/[^)>\\n]+)'
const isLocalAppAsset = (url) => LOCAL_APP_ASSET_RE.test(String(url || '').trim().replace(/^\/+/, ''))

const formatMarkdownDestination = (href) => {
  const normalized = String(href || '').trim()
  if (!normalized) return ''
  return /^file:\/\//i.test(normalized) || /[\s()]/.test(normalized)
    ? `<${normalized}>`
    : normalized
}

const normalizeResourceHref = (href) => String(href || '').trim().replace(/^app:\/\/\/+/i, 'app://')

const normalizeLocalResourceMarkdown = (markdown) => String(markdown)
  .replace(new RegExp(`!\\[([^\\]\\n]*)]\\s*\\n\\s*\\((<)?(${LOCAL_RESOURCE_DEST_RE})(>)?\\)`, 'gi'), (_, label, _open, href) =>
    `![${label}](${formatMarkdownDestination(normalizeResourceHref(href))})`)
  .replace(new RegExp(`\\[([^\\]\\n]+)]\\s*\\n\\s*\\((<)?(${LOCAL_RESOURCE_DEST_RE})(>)?\\)`, 'gi'), (_, label, _open, href) =>
    `[${label}](${formatMarkdownDestination(normalizeResourceHref(href))})`)
  .replace(new RegExp(`!\\[([^\\]\\n]*)]\\((<)?(${LOCAL_RESOURCE_DEST_RE})(>)?\\)`, 'gi'), (_, label, _open, href) =>
    `![${label}](${formatMarkdownDestination(normalizeResourceHref(href))})`)
  .replace(new RegExp(`\\[([^\\]\\n]+)]\\((<)?(${LOCAL_RESOURCE_DEST_RE})(>)?\\)`, 'gi'), (_, label, _open, href) =>
    `[${label}](${formatMarkdownDestination(normalizeResourceHref(href))})`)

const preserveExtraBlankLines = (markdown) => {
  const lines = String(markdown).split('\n')
  const output = []

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== '') {
      output.push(lines[index])
      continue
    }

    let runEnd = index
    while (runEnd < lines.length && lines[runEnd] === '') runEnd += 1
    const emptyCount = runEnd - index
    const previousHasContent = output.length > 0 && output[output.length - 1] !== ''
    const nextHasContent = runEnd < lines.length && lines[runEnd] !== ''

    if (previousHasContent && nextHasContent && emptyCount > 1) {
      output.push('')
      for (let i = 1; i < emptyCount; i += 1) {
        output.push(RICH_TEXT_EMPTY_LINE_SENTINEL)
        output.push('')
      }
    } else if (!previousHasContent && nextHasContent) {
      for (let i = 0; i < emptyCount; i += 1) {
        output.push(RICH_TEXT_EMPTY_LINE_SENTINEL)
        output.push('')
      }
    } else if (previousHasContent && !nextHasContent) {
      for (let i = 0; i < emptyCount; i += 1) {
        output.push('')
        output.push(RICH_TEXT_EMPTY_LINE_SENTINEL)
      }
    } else if (!previousHasContent && !nextHasContent) {
      for (let i = 0; i < emptyCount; i += 1) {
        output.push(RICH_TEXT_EMPTY_LINE_SENTINEL)
        output.push('')
      }
    } else {
      for (let i = 0; i < emptyCount; i += 1) output.push('')
    }

    index = runEnd - 1
  }

  return output.join('\n')
}

const decodeRichTextBlankLines = (markdown) => String(markdown)
  .split('\n')
  .map(line => (line === RICH_TEXT_EMPTY_LINE_SENTINEL ? null : line.replaceAll(RICH_TEXT_EMPTY_LINE_SENTINEL, '')))
  .filter(line => line !== null)
  .join('\n')

// 在富文本/HTML 渲染层精确保留空格：将「会被折叠或丢弃的空格」转为不间断空格（NBSP）
// - 普通文本行的行首空格：全部转 NBSP；Markdown 结构行的缩进不动，避免破坏列表/引用/表格语义
// - 行内连续 2+ 个空格：首个保留为普通空格，其余转 NBSP（保留断词位的同时让浏览器渲染出多空格）
// - 行尾空格：全部转 NBSP（避免被 markdown 解析器 / 序列化器丢弃）
// - 跳过围栏代码块（``` ... ```）和缩进代码块行（行首 4 空格或 tab）
const encodeRichTextSpaces = (markdown) => {
  const lines = String(markdown).split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^(\t| {4})/.test(line)) continue
    if (/^[ \t]+$/.test(line)) {
      lines[i] = line.replace(/ /g, RICH_TEXT_SPACE_SENTINEL)
      continue
    }

    const match = line.match(/^([ \t]*)([\s\S]*?)([ \t]*)$/)
    if (!match) continue
    const [, leading, body, trailing] = match
    const isStructuralLine = /^(?:[-+*]|\d{1,9}[.)])(?:\s|$)|^>\s?|^#{1,6}(?:\s|$)|^\|/.test(body) ||
      /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(body) ||
      /^\[[^\]]+]:/.test(body)
    const encodedLeading = isStructuralLine ? leading : leading.replace(/ /g, RICH_TEXT_SPACE_SENTINEL)
    const encodedBody = body.replace(/ {2,}/g, (run) => ' ' + RICH_TEXT_SPACE_SENTINEL.repeat(run.length - 1))
    const encodedTrailing = trailing.replace(/ /g, RICH_TEXT_SPACE_SENTINEL)
    lines[i] = encodedLeading + encodedBody + encodedTrailing
  }
  return lines.join('\n')
}

const decodeRichTextSpaces = (markdown) => String(markdown).replace(RICH_TEXT_SPACE_SENTINEL_RE, ' ')

export const normalizeMarkdownForRender = (markdown) => {
  if (!markdown || typeof markdown !== 'string') return markdown || ''
  return normalizeLocalResourceMarkdown(markdown)
}

export const prepareMarkdownForDisplay = (markdown) => {
  if (!markdown || typeof markdown !== 'string') return markdown || ''
  return encodeRichTextSpaces(preserveExtraBlankLines(normalizeMarkdownForRender(markdown)))
}

export const finalizeMarkdownForStorage = (markdown) => {
  if (!markdown || typeof markdown !== 'string') return markdown || ''
  return normalizeMarkdownForRender(decodeRichTextSpaces(decodeRichTextBlankLines(markdown)))
}

/**
 * 创建 Markdown 渲染器实例
 * @param {Object} options - 配置选项
 * @param {Function} options.onWikiLinkClick - Wiki链接点击回调
 * @param {Function} options.onTagClick - 标签点击回调
 * @param {Object} options.pluginOptions - 插件配置选项
 * @returns {MarkdownIt} Markdown 渲染器实例
 */
export function createMarkdownRenderer(options = {}) {
  const {
    onWikiLinkClick,
    onTagClick,
    html = false,
    pluginOptions = {}
  } = options

  // 初始化 markdown-it
  const md = new MarkdownIt({
    html,                 // 默认禁止原始 HTML；导出场景开启后由调用方做白名单清洗
    linkify: true,        // 自动转换 URL 为链接
    typographer: true,    // 启用智能引号和其他排版替换
    breaks: true,         // 转换换行符为 <br>
    highlight: function (str, lang) {
      // 代码高亮
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang }).value
        } catch (err) {
          console.error('代码高亮失败:', err)
        }
      }
      return '' // 使用默认转义
    }
  })

  md.validateLink = (url) => {
    const normalized = String(url || '').trim()
    if (isLocalAppAsset(normalized)) return true
    return /^(https?:|mailto:|app:|file:|data:image\/)/i.test(normalized)
  }

  md.inline.ruler.before('emphasis', 'underline', (state, silent) => {
    const start = state.pos
    if (state.src.slice(start, start + 2) !== '++') return false

    let pos = start + 2
    while (pos < state.posMax) {
      if (state.src.slice(pos, pos + 2) === '++') {
        if (pos === start + 2) return false
        if (!silent) {
          state.push('underline_open', 'u', 1)
          const textToken = state.push('text', '', 0)
          textToken.content = state.src.slice(start + 2, pos)
          state.push('underline_close', 'u', -1)
        }
        state.pos = pos + 2
        return true
      }
      pos += 1
    }
    return false
  })

  // 注册标准插件
  md.use(markdownItMark) // ==高亮== 语法支持

  // 自定义图片渲染规则：自动将相对路径转换为 app:// 协议
  // 这样可以避免浏览器尝试加载 file:// 或 http:// 协议的本地图片导致 404
  const defaultImageRender = md.renderer.rules.image || function(tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.image = function(tokens, idx, options, env, self) {
    const token = tokens[idx]
    const srcIndex = token.attrIndex('src')
    
    if (srcIndex >= 0) {
      const src = token.attrs[srcIndex][1]
      // 如果是相对路径（不包含协议头），转换为 app:// 协议
      // 排除 http://, https://, file://, data:, app://
      if (src && !/^[a-zA-Z]+:/.test(src)) {
        token.attrs[srcIndex][1] = `app://${src}`
      }
    }
    
    return defaultImageRender(tokens, idx, options, env, self)
  }

  const defaultLinkOpenRender = md.renderer.rules.link_open || function(tokens, idx, opts, _env, self) {
    return self.renderToken(tokens, idx, opts)
  }

  md.renderer.rules.link_open = function(tokens, idx, opts, env, self) {
    const token = tokens[idx]
    const hrefIndex = token.attrIndex('href')

    if (hrefIndex >= 0) {
      const href = token.attrs[hrefIndex][1]
      const normalizedHref = String(href || '').replace(/^\/+/, '')
      if (normalizedHref && !/^[a-zA-Z]+:/.test(normalizedHref) && LOCAL_APP_ASSET_RE.test(normalizedHref)) {
        token.attrs[hrefIndex][1] = `app://${normalizedHref}`
      }
    }

    return defaultLinkOpenRender(tokens, idx, opts, env, self)
  }

  // 注册自定义插件
  md.use(highlightPlugin, pluginOptions.highlight)
  md.use(colorTextPlugin, pluginOptions.colorText)
  md.use(calloutPlugin, pluginOptions.callout)
  md.use(wikiLinkPlugin, { onClick: onWikiLinkClick, ...pluginOptions.wikiLink })
  md.use(tagPlugin, { onClick: onTagClick, ...pluginOptions.tag })
  md.use(customContainerPlugin, pluginOptions.customContainer)

  return md
}

/**
 * 渲染 Markdown 文本为 HTML
 * @param {string} markdown - Markdown 文本
 * @param {Object} options - 渲染选项
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(markdown, options = {}) {
  if (!markdown || typeof markdown !== 'string') {
    return ''
  }

  const md = createMarkdownRenderer(options)
  return md.render(prepareMarkdownForDisplay(markdown))
}

/**
 * 渲染 Markdown 为 Token 数组（用于高级处理）
 * @param {string} markdown - Markdown 文本
 * @param {Object} options - 渲染选项
 * @returns {Array} Token 数组
 */
export function parseMarkdown(markdown, options = {}) {
  if (!markdown || typeof markdown !== 'string') {
    return []
  }

  const md = createMarkdownRenderer(options)
  return md.parse(prepareMarkdownForDisplay(markdown), {})
}

/**
 * 注册自定义插件
 * @param {MarkdownIt} md - Markdown 实例
 * @param {Function} plugin - 插件函数
 * @param {Object} options - 插件选项
 */
export function registerPlugin(md, plugin, options = {}) {
  if (typeof plugin === 'function') {
    md.use(plugin, options)
  } else {
    console.warn('插件必须是一个函数')
  }
}

/**
 * 获取默认渲染器实例（单例模式）
 */
let defaultRenderer = null

export function getDefaultRenderer(options = {}) {
  if (!defaultRenderer) {
    defaultRenderer = createMarkdownRenderer(options)
  }
  return defaultRenderer
}

/**
 * 重置默认渲染器
 */
export function resetDefaultRenderer() {
  defaultRenderer = null
}

// 导出插件以供外部使用
export {
  highlightPlugin,
  colorTextPlugin,
  calloutPlugin,
  wikiLinkPlugin,
  tagPlugin,
  customContainerPlugin
}

export default {
  createMarkdownRenderer,
  finalizeMarkdownForStorage,
  normalizeMarkdownForRender,
  prepareMarkdownForDisplay,
  renderMarkdown,
  parseMarkdown,
  registerPlugin,
  getDefaultRenderer,
  resetDefaultRenderer
}
