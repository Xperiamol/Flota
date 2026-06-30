import { createMarkdownRenderer, prepareMarkdownForDisplay } from '../markdown/index.js'
import { sanitizeMarkdownHtml } from '../markdown/sanitizeHtml.js'
import markdownCss from '../markdown/markdown.css?raw'
import { imageAPI } from '../api/imageAPI'

// 把笔记 markdown 渲染为「自包含」HTML 文档：内联图片为 base64 + 内嵌样式。
// 供 PDF / PNG / HTML 导出共用，确保离屏窗口或外部浏览器都能正确显示。

const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// 把 markdown 里的相对 / app:// 图片解析为 base64 data URL
const inlineImages = async (rootEl) => {
  const imgs = Array.from(rootEl.querySelectorAll('img'))
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src') || img.getAttribute('data-original-src') || ''
    if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
      if (src) img.setAttribute('src', src)
      return
    }
    try {
      let relative = src
      if (relative.startsWith('app://')) relative = relative.replace('app://', '').split('?')[0]
      if (relative.startsWith('file://')) {
        // file:// 走原样，离屏窗口本地可读
        img.setAttribute('src', relative)
        return
      }
      const base64 = await imageAPI.getBase64(relative)
      if (base64) img.setAttribute('src', base64)
    } catch {
      // 解析失败则移除 src，避免坏图标
      img.removeAttribute('src')
    }
  }))
}

// 生成渲染用 HTML 片段（开启原始 HTML 透传以还原内联 <span style> 等富文本，
// 再用与预览一致的白名单清洗器 sanitize，避免格式以纯文本泄露）
const renderMarkdownToFragment = (markdown) => {
  const md = createMarkdownRenderer({
    html: true,
    pluginOptions: {
      highlight: { className: 'markdown-highlight' },
      colorText: { className: 'markdown-color-text' },
      callout: { className: 'markdown-callout' },
      tag: { className: 'markdown-tag' },
      customContainer: { className: 'markdown-container' },
    },
  })
  return sanitizeMarkdownHtml(md.render(prepareMarkdownForDisplay(markdown || '')))
}

/**
 * 构建自包含 HTML 文档字符串
 * @param {{ title?: string, content?: string, tags?: string, theme?: 'light'|'dark' }} note
 */
export const buildExportHtml = async ({ title = '', content = '', tags = '', theme = 'light' } = {}) => {
  const bodyHtml = renderMarkdownToFragment(content)

  // 在临时容器里内联图片
  const holder = document.createElement('div')
  holder.innerHTML = bodyHtml
  await inlineImages(holder)
  const inlinedBody = holder.innerHTML

  const tagList = String(tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const tagsHtml = tagList.length
    ? `<div class="export-tags">${tagList.map((t) => `<span class="export-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : ''

  const isDark = theme === 'dark'
  const pageBg = isDark ? '#0f172a' : '#ffffff'
  const pageColor = isDark ? '#e2e8f0' : '#1f2937'
  const titleColor = isDark ? '#f8fafc' : '#111827'
  const tagColor = isDark ? '#93c5fd' : '#2563eb'

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${isDark ? 'dark' : 'light'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title || '未命名笔记')}</title>
<style>
${markdownCss}
html, body { margin: 0; padding: 0; background: ${pageBg}; }
body {
  color: ${pageColor};
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.7;
}
.export-root { max-width: 760px; margin: 0 auto; padding: 40px 32px 56px; box-sizing: border-box; }
.export-title { font-size: 26px; font-weight: 700; color: ${titleColor}; margin: 0 0 8px; word-break: break-word; }
.export-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 20px; }
.export-tag { font-size: 12px; color: ${tagColor}; }
.export-body img { max-width: 100%; height: auto; }
.markdown-preview, .export-body { color: ${pageColor}; }
</style>
</head>
<body>
<div class="export-root">
  <h1 class="export-title">${escapeHtml(title || '未命名笔记')}</h1>
  ${tagsHtml}
  <div class="export-body markdown-preview">${inlinedBody}</div>
</div>
</body>
</html>`
}

/**
 * 导出笔记到本地文件
 * @param {'md'|'html'|'pdf'|'png'} format
 * @param {{ title?: string, content?: string, tags?: string, theme?: 'light'|'dark' }} note
 */
export const exportNoteAs = async (format, note = {}) => {
  if (!window.electronAPI?.notes?.exportDocument) {
    throw new Error('导出功能不可用')
  }
  const payload = { format, title: note.title || '未命名笔记' }
  if (format === 'md') {
    payload.markdown = note.content || ''
  } else {
    payload.html = await buildExportHtml(note)
  }
  return window.electronAPI.notes.exportDocument(payload)
}

export default exportNoteAs
