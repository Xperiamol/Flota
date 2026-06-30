// 共享的 Markdown 渲染 HTML 清洗器
// - 白名单标签 / 属性 / style 属性，移除事件处理器与不安全 URL
// - 供笔记预览（MarkdownPreview）与导出（noteExport）复用，保证两处渲染结果一致

const ALLOWED_TAGS = new Set([
  'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2',
  'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'INPUT', 'LI', 'MARK', 'OL', 'P',
  'PRE', 'S', 'SPAN', 'STRONG', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD',
  'TR', 'U', 'UL', 'DETAILS'
])

const ALLOWED_ATTRS = new Set([
  'alt', 'checked', 'class', 'colspan', 'data-tag', 'data-wiki-section',
  'data-wiki-target', 'href', 'id', 'rel', 'rowspan', 'src', 'style', 'target',
  'title', 'type'
])

const isSafeUrl = (value) => {
  if (!value) return true
  return /^(https?:|mailto:|app:|file:|data:image\/|#|\/(?!\/))/i.test(value)
}

const sanitizeStyle = (style) => {
  const allowedProps = new Set(['background-color', 'border-left-color', 'color', 'font-weight', 'margin-bottom'])
  return style
    .split(';')
    .map(rule => rule.trim())
    .filter(Boolean)
    .filter((rule) => {
      const [rawProp, ...rawValueParts] = rule.split(':')
      const prop = rawProp?.trim().toLowerCase()
      const value = rawValueParts.join(':').trim().toLowerCase()
      return allowedProps.has(prop) && value && !/url\s*\(|expression\s*\(|javascript:/i.test(value)
    })
    .join('; ')
}

export const sanitizeMarkdownHtml = (html) => {
  const template = document.createElement('template')
  template.innerHTML = html

  const walk = (node) => {
    for (const child of [...node.children]) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes)
        continue
      }

      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase()
        const value = attr.value
        const allowed = ALLOWED_ATTRS.has(name) || name.startsWith('aria-') || name.startsWith('data-')
        const unsafeHandler = name.startsWith('on')
        const unsafeUrl = (name === 'href' || name === 'src') && !isSafeUrl(value)

        if (!allowed || unsafeHandler || unsafeUrl) {
          child.removeAttribute(attr.name)
        } else if (name === 'style') {
          const safeStyle = sanitizeStyle(value)
          if (safeStyle) child.setAttribute('style', safeStyle)
          else child.removeAttribute('style')
        }
      }

      if (child.tagName === 'A') {
        child.setAttribute('rel', 'noopener noreferrer')
      }

      walk(child)
    }
  }

  walk(template.content)
  return template.innerHTML
}

export default sanitizeMarkdownHtml
