// Never decode an entire URL: encoded &, # and / can be part of signed links.
export const normalizeLinkUrl = (value, { allowRelative = false } = {}) => {
  let text = String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  if ((text.startsWith('<') && text.endsWith('>')) || (text.startsWith('“') && text.endsWith('”'))) text = text.slice(1, -1).trim()
  if (!text || /[\u0000-\u001F\u007F]/.test(text)) return ''
  if (/^(?:images|audio|attachments)\//i.test(text)) return `app://${text}`
  if (text.startsWith('#')) return allowRelative ? text : ''
  if (text.startsWith('//')) text = `https:${text}`
  if (/^[^\s@/:?#]+@[^\s@/:?#]+\.[^\s@/:?#]+$/.test(text)) text = `mailto:${text}`
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text) && /^(?:localhost|(?:[^\s/.:?#]+\.)+[\p{L}][\p{L}\d-]+)(?::\d+)?(?:[/?#]|$)/iu.test(text)) text = `https://${text}`
  if (!/^[a-z][a-z\d+.-]*:/i.test(text)) {
    return allowRelative && !/[<>\s]/.test(text) ? text : ''
  }
  if (!/^(?:https?:|mailto:|tel:|file:|app:)/i.test(text)) return ''
  try {
    const url = new URL(text)
    if (/^https?:$/.test(url.protocol) && !url.hostname) return ''
    if (url.protocol === 'mailto:' && !url.pathname) return ''
    return url.href
  } catch { return '' }
}

export const markdownLinkDestination = (href) => `<${String(href || '')
  .replace(/\\/g, '%5C').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/[\r\n]/g, '')}>`

export const openNoteLink = async (href) => {
  const url = normalizeLinkUrl(href)
  if (!url) return false
  if (/^file:/i.test(url)) {
    const parsed = new URL(url)
    let path = decodeURIComponent(parsed.pathname)
    if (parsed.hostname) path = `//${parsed.hostname}${path}`
    else if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
    await window.electronAPI?.system?.openPath?.(path)
  } else if (/^app:/i.test(url)) {
    await window.electronAPI?.attachments?.open?.(url.replace(/^app:\/\//i, ''))
  } else if (window.electronAPI?.system?.openExternal) {
    await window.electronAPI.system.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return true
}
