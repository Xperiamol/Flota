/**
 * Markdown 自定义容器插件
 * 支持 :::type 语法
 * 
 * 语法示例:
 * :::tip 提示标题
 * 这是提示内容
 * :::
 * 
 * :::warning
 * 警告内容
 * :::
 */

import markdownItContainer from 'markdown-it-container'
import { CALLOUT_TYPES } from '../calloutConfig.js'

/**
 * 自定义容器插件（:::type 语法）
 * 样式复用 markdown-callout CSS 类
 */
export default function customContainerPlugin(md, options = {}) {
  const { className = 'markdown-callout', customTypes, ...rest } = options
  const allTypes = { ...CALLOUT_TYPES, ...customTypes }

  // 为每种类型注册容器
  Object.keys(allTypes).forEach(type => {
    const typeConfig = allTypes[type]
    
    md.use(markdownItContainer, type, {
      validate: function(params) {
        return params.trim().match(new RegExp(`^${type}\\s*(.*)$`))
      },

      render: function(tokens, idx) {
        const token = tokens[idx]
        const info = token.info.trim()
        const match = info.match(new RegExp(`^${type}\\s*(.*)$`))
        
        if (token.nesting === 1) {
          const title = match && match[1] ? match[1] : typeConfig.label
          return `<div class="${className} ${className}-${type}">
  <div class="${className}-header">
    <span class="${className}-icon">${typeConfig.icon}</span>
    <span class="${className}-title">${md.utils.escapeHtml(title)}</span>
  </div>
  <div class="${className}-content">\n`
        } else {
          return `  </div>\n</div>\n`
        }
      }
    })
  })

  // 支持可折叠容器 :::details
  md.use(markdownItContainer, 'details', {
    validate: function(params) {
      return params.trim().match(/^details\s*(.*)$/)
    },

    render: function(tokens, idx) {
      const token = tokens[idx]
      const info = token.info.trim()
      const match = info.match(/^details\s*(.*)$/)
      
      if (token.nesting === 1) {
        const title = match && match[1] ? match[1] : '详情'
        const typeConfig = allTypes.details || { icon: '📋', color: '#6b7280' }
        return `<details class="${className} ${className}-details">
  <summary class="${className}-header">
    <span class="${className}-icon">${typeConfig.icon}</span>
    <span>${md.utils.escapeHtml(title)}</span>
  </summary>
  <div class="${className}-content">\n`
      } else {
        return `  </div>
</details>\n`
      }
    }
  })

  // 支持代码组容器 :::code-group
  md.use(markdownItContainer, 'code-group', {
    validate: function(params) {
      return params.trim().match(/^code-group/)
    },

    render: function(tokens, idx) {
      if (tokens[idx].nesting === 1) {
        return `<div class="${className} ${className}-code-group">
  <div class="${className}-code-tabs">
  </div>
  <div class="${className}-code-content">\n`
      } else {
        return `  </div>
</div>\n`
      }
    }
  })

  // 支持自定义样式容器 :::custom{style}
  md.use(markdownItContainer, 'custom', {
    validate: function(params) {
      return params.trim().match(/^custom/)
    },

    render: function(tokens, idx) {
      const token = tokens[idx]
      const info = token.info.trim()
      
      if (token.nesting === 1) {
        // 解析自定义样式
        const styleMatch = info.match(/\{([^}]+)\}/)
        const style = styleMatch ? styleMatch[1] : ''
        const titleMatch = info.match(/^custom(?:\{[^}]+\})?\s*(.*)$/)
        const title = titleMatch && titleMatch[1] ? titleMatch[1] : ''
        
        return `<div class="${className} ${className}-custom" style="${style}">
  ${title ? `<div class="${className}-title" style="font-weight: 600; margin-bottom: 0.5rem;">${md.utils.escapeHtml(title)}</div>` : ''}
  <div class="${className}-content">\n`
      } else {
        return `  </div>
</div>\n`
      }
    }
  })
}