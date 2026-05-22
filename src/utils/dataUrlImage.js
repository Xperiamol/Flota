// 处理 HTML 粘贴中 <img src="data:image/...;base64,..."> 的工具：
// 把 base64 形式的图片预先保存为本地文件，避免超长 data URL 被写入 markdown 文本
// 后续在二次解析 / 序列化链路上被截断（出现 ERR_INVALID_URL）。
import { imageAPI } from '../api/imageAPI'

const DATA_URL_RE = /^data:([^;,]+)(?:;([^,]*))?,(.*)$/

export const dataUrlToBuffer = (dataUrl) => {
  const match = DATA_URL_RE.exec(String(dataUrl || ''))
  if (!match) return null
  const [, mime, paramsRaw, payload] = match
  const params = (paramsRaw || '').split(';').map(s => s.trim()).filter(Boolean)
  const isBase64 = params.includes('base64')

  try {
    if (isBase64) {
      const binary = atob(payload)
      const buf = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) buf[i] = binary.charCodeAt(i)
      return { buffer: buf, mime }
    }
    // 极少见：非 base64 的 data URL
    const decoded = decodeURIComponent(payload)
    const buf = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i += 1) buf[i] = decoded.charCodeAt(i)
    return { buffer: buf, mime }
  } catch (_) {
    return null
  }
}

const guessExtFromMime = (mime) => {
  const sub = String(mime || 'image/png').split('/')[1] || 'png'
  const cleaned = sub.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (cleaned === 'jpeg') return 'jpg'
  if (cleaned === 'svgxml' || cleaned === 'svg') return 'svg'
  return cleaned || 'png'
}

const buildFileName = (mime) => {
  const ext = guessExtFromMime(mime)
  const rand = Math.random().toString(36).slice(2, 8)
  return `paste_${Date.now()}_${rand}.${ext}`
}

/**
 * 解析 HTML 字符串，把所有 <img src="data:image/..."> 的 base64 数据写入本地图片文件，
 * 然后把 src 替换为对应的相对路径（如 images/paste_xxx.png）。
 * 返回处理后的 HTML 字符串。
 *
 * 若 HTML 中没有 data:image/，原样返回。
 */
export const replaceDataImagesInHtml = async (html) => {
  if (!html || typeof html !== 'string') return html || ''
  if (!/data:image\//i.test(html)) return html

  let doc
  try {
    doc = new DOMParser().parseFromString(`<div id="__flota_root__">${html}</div>`, 'text/html')
  } catch (_) {
    return html
  }
  const root = doc.getElementById('__flota_root__')
  if (!root) return html

  const imgs = Array.from(root.querySelectorAll('img'))
  for (const img of imgs) {
    const src = img.getAttribute('src') || ''
    if (!/^data:image\//i.test(src)) continue
    const parsed = dataUrlToBuffer(src)
    if (!parsed) continue
    try {
      const imagePath = await imageAPI.saveFromBuffer(parsed.buffer, buildFileName(parsed.mime))
      if (imagePath) img.setAttribute('src', imagePath)
    } catch (error) {
      console.warn('[dataUrlImage] 保存粘贴的内联图片失败:', error)
    }
  }

  return root.innerHTML
}

/**
 * 处理 markdown 文本中的 ![alt](data:image/...;base64,...) 形式，把 data URL 替换为本地相对路径。
 * 返回处理后的 markdown 字符串。
 */
export const replaceDataImagesInMarkdown = async (markdown) => {
  if (!markdown || typeof markdown !== 'string') return markdown || ''
  if (!/data:image\//i.test(markdown)) return markdown

  // 提取所有 data:image/... 形式的 markdown image 链接（兼容 ![alt](...) 与 ![alt](<...>)）
  const PATTERN = /(!\[[^\]\n]*])\((<)?(data:image\/[^)>\n]+)(>)?\)/gi
  const matches = []
  let m
  while ((m = PATTERN.exec(markdown)) !== null) {
    matches.push({ full: m[0], label: m[1], dataUrl: m[3], index: m.index })
  }
  if (matches.length === 0) return markdown

  // 缓存相同 data URL 复用结果
  const cache = new Map()
  const replacements = []
  for (const item of matches) {
    if (cache.has(item.dataUrl)) {
      replacements.push({ ...item, replacement: `${item.label}(${cache.get(item.dataUrl)})` })
      continue
    }
    const parsed = dataUrlToBuffer(item.dataUrl)
    if (!parsed) {
      replacements.push({ ...item, replacement: item.full })
      continue
    }
    try {
      const imagePath = await imageAPI.saveFromBuffer(parsed.buffer, buildFileName(parsed.mime))
      if (imagePath) {
        cache.set(item.dataUrl, imagePath)
        replacements.push({ ...item, replacement: `${item.label}(${imagePath})` })
      } else {
        replacements.push({ ...item, replacement: item.full })
      }
    } catch (error) {
      console.warn('[dataUrlImage] 保存粘贴的内联图片失败:', error)
      replacements.push({ ...item, replacement: item.full })
    }
  }

  // 从后往前替换，避免 index 偏移
  let result = markdown
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const r = replacements[i]
    result = result.slice(0, r.index) + r.replacement + result.slice(r.index + r.full.length)
  }
  return result
}
