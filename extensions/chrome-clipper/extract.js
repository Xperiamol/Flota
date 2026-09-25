// 注入到页面（扩展的隔离环境）中执行：提取正文并转换为 Markdown。
// 依赖先注入的 vendor/Readability.js、vendor/turndown.js、vendor/turndown-plugin-gfm.js。
(() => {
  if (window.__flotaExtract) return

  const SITE_RULES = [
    { host: /(^|\.)mp\.weixin\.qq\.com$/, content: '#js_content', title: '#activity-name', byline: '#js_name' },
    { host: /(^|\.)zhihu\.com$/, content: '.Post-RichText, .RichContent-inner, .RichText', title: '.Post-Title, .QuestionHeader-title' },
    { host: /(^|\.)xiaohongshu\.com$/, content: '#detail-desc, .note-content', title: '#detail-title, .title' },
    { host: /(^|\.)juejin\.cn$/, content: '.article-content', title: '.article-title' },
    { host: /(^|\.)sspai\.com$/, content: '.article-body, .content', title: '.title' },
  ]

  const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() || ''

  const prepare = (root, pageUrl) => {
    root.querySelectorAll('img').forEach((img) => {
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-actualsrc') || img.getAttribute('data-lazy-src')
      const src = img.getAttribute('src') || ''
      if (lazy && (!src || src.startsWith('data:'))) img.setAttribute('src', lazy)
      try { if (img.getAttribute('src')) img.setAttribute('src', new URL(img.getAttribute('src'), pageUrl).href) } catch {}
    })
    root.querySelectorAll('a[href]').forEach((a) => {
      try { a.setAttribute('href', new URL(a.getAttribute('href'), pageUrl).href) } catch {}
    })
    root.querySelectorAll('script, style, noscript, iframe, form, button').forEach((node) => node.remove())
    return root
  }

  const toMarkdown = (html) => {
    const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
    service.use(turndownPluginGfm.gfm)
    return service.turndown(html).replace(/\n{3,}/g, '\n\n').trim()
  }

  window.__flotaExtract = (mode) => {
    const url = location.href
    const base = {
      url,
      title: meta('meta[property="og:title"]') || document.title || url,
      siteName: meta('meta[property="og:site_name"]') || location.hostname,
      excerpt: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
      cover: meta('meta[property="og:image"]'),
      byline: meta('meta[name="author"]'),
    }

    if (mode === 'bookmark') return { ...base, kind: 'bookmark' }

    if (mode === 'selection') {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return { error: '请先在页面中选中要剪藏的内容' }
      const container = document.createElement('div')
      for (let i = 0; i < selection.rangeCount; i++) container.appendChild(selection.getRangeAt(i).cloneContents())
      return { ...base, kind: 'selection', markdown: toMarkdown(prepare(container, url).innerHTML) }
    }

    const rule = SITE_RULES.find((item) => item.host.test(location.hostname))
    if (rule) {
      const node = document.querySelector(rule.content)
      if (node && node.innerText.trim().length > 30) {
        return {
          ...base,
          kind: 'article',
          title: (rule.title && document.querySelector(rule.title)?.innerText?.trim()) || base.title,
          byline: (rule.byline && document.querySelector(rule.byline)?.innerText?.trim()) || base.byline,
          markdown: toMarkdown(prepare(node.cloneNode(true), url).innerHTML),
        }
      }
    }

    const clone = prepare(document.cloneNode(true), url)
    const article = new Readability(clone, { charThreshold: 200 }).parse()
    if (!article || (article.textContent || '').trim().length < 50) {
      return { error: '没有识别到正文，可以改为“剪藏选中内容”或“保存为书签”' }
    }
    return {
      ...base,
      kind: 'article',
      title: article.title || base.title,
      byline: article.byline || base.byline,
      siteName: article.siteName || base.siteName,
      markdown: toMarkdown(article.content),
    }
  }
})()
