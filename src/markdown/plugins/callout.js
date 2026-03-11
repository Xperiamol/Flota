/**
 * Markdown Callout 插件
 * 支持 Obsidian 风格的 Callout 语法
 * 
 * 语法示例:
 * > [!note] 标题
 * > 内容
 * 
 * > [!warning] 警告
 * > 这是警告内容
 */

import { CALLOUT_TYPES } from '../calloutConfig.js'

/**
 * Callout 插件
 * @param {MarkdownIt} md - Markdown-it 实例
 * @param {Object} options - 插件选项
 */
export default function calloutPlugin(md, options = {}) {
  const { className = 'markdown-callout', customTypes, ...rest } = options
  const allTypes = { ...CALLOUT_TYPES, ...customTypes }

  // 覆盖 blockquote 的渲染规则
  const defaultBlockquoteOpen = md.renderer.rules.blockquote_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }

  const defaultBlockquoteClose = md.renderer.rules.blockquote_close || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.blockquote_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx]
    
    // 检查下一个 token 是否包含 callout 标记
    const nextToken = tokens[idx + 1]
    if (nextToken && nextToken.type === 'paragraph_open') {
      const contentToken = tokens[idx + 2]
      if (contentToken && contentToken.type === 'inline') {
        const match = contentToken.content.match(/^\[!(\w+)\](?:\s+(.+))?/)
        if (match) {
          const type = match[1].toLowerCase()
          const title = match[2] || ''
          const typeConfig = allTypes[type] || allTypes.note

          // 移除 callout 标记（只移除 [!type] 和可选的标题，保留同行剩余内容）
          contentToken.content = contentToken.content.replace(/^\[!\w+\](?:\s+\S[^\n]*)?/, '').trim()

          // 如果第一段被清空，将空 paragraph 标记为隐藏（不能 splice，会破坏渲染器索引）
          if (!contentToken.content) {
            tokens[idx + 1].hidden = true  // paragraph_open
            tokens[idx + 2].hidden = true  // inline (empty)
            tokens[idx + 3].hidden = true  // paragraph_close
          }

          // 标记这是一个 callout
          token.attrSet('data-callout-type', type)
          token.attrSet('data-callout-title', title)
          token.attrSet('class', `${className} ${className}-${type}`)
          token.attrSet('style', `border-left-color: ${typeConfig.color}`)

          // 生成 callout HTML（样式由 CSS 类控制，不用 inline style）
          return `<div class="${className} ${className}-${type}">
  <div class="${className}-header"${contentToken.content ? '' : ' style="margin-bottom:0"'}>
    <span class="${className}-icon">${typeConfig.icon}</span>
    <span class="${className}-title">${title || typeConfig.label}</span>
  </div>
  <div class="${className}-content">`
        }
      }
    }

    return defaultBlockquoteOpen(tokens, idx, options, env, self)
  }

  md.renderer.rules.blockquote_close = function(tokens, idx, options, env, self) {
    // 查找对应的 open token
    let openIdx = idx - 1
    while (openIdx >= 0 && tokens[openIdx].type !== 'blockquote_open') {
      openIdx--
    }

    if (openIdx >= 0) {
      const openToken = tokens[openIdx]
      if (openToken.attrGet('data-callout-type')) {
        return `</div></div>`
      }
    }

    return defaultBlockquoteClose(tokens, idx, options, env, self)
  }
}