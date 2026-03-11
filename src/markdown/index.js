/**
 * Flota Markdown 渲染引擎
 * 基于 markdown-it 构建，支持扩展插件系统
 */

import MarkdownIt from 'markdown-it'
import markdownItMark from 'markdown-it-mark'
import markdownItContainer from 'markdown-it-container'
import hljs from 'highlight.js'

// 导入自定义插件
import highlightPlugin from './plugins/highlight.js'
import colorTextPlugin from './plugins/colorText.js'
import calloutPlugin from './plugins/callout.js'
import wikiLinkPlugin from './plugins/wikiLink.js'
import tagPlugin from './plugins/tag.js'
import customContainerPlugin from './plugins/customContainer.js'

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
    pluginOptions = {}
  } = options

  // 初始化 markdown-it
  const md = new MarkdownIt({
    html: true,           // 允许 HTML 标签
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

  // 注册标准插件
  md.use(markdownItMark) // ==高亮== 语法支持

  // 自定义图片渲染规则：自动将相对路径转换为 app:// 协议
  // 这样可以避免浏览器尝试加载 file:// 或 http:// 协议的本地图片导致 404
  const defaultImageRender = md.renderer.rules.image || function(tokens, idx, options, env, self) {
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
  return md.render(markdown)
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
  return md.parse(markdown, {})
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
  renderMarkdown,
  parseMarkdown,
  registerPlugin,
  getDefaultRenderer,
  resetDefaultRenderer
}
