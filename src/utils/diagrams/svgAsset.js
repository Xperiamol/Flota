import { makeBase } from './shared'

const SVG_MIME = 'image/svg+xml'
const MAX_SVG_LENGTH = 500_000
const MAX_SVG_ELEMENTS = 2_500
const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 800

const FORBIDDEN_TAGS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'link',
  'meta',
  'style',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
])

const clampDimension = (value, fallback) => {
  const number = Number.parseFloat(String(value || '').replace(/[^\d.+-]/g, ''))
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(100_000, number)
}

const extractSvgMarkup = (input = '') => {
  const text = String(input || '').trim()
  const start = text.search(/<svg\b/i)
  const end = text.toLowerCase().lastIndexOf('</svg>')
  if (start < 0 || end < start) return text
  return text.slice(start, end + 6)
}

const hasOnlyLocalUrlReferences = (value = '') => {
  const matches = [...String(value).matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
  return matches.every((match) => String(match[2] || '').trim().startsWith('#'))
}

const sanitizeInlineStyle = (style = '') => String(style)
  .split(';')
  .map((declaration) => declaration.trim())
  .filter(Boolean)
  .filter((declaration) => !/(?:javascript\s*:|expression\s*\(|@import|behavior\s*:|-moz-binding)/i.test(declaration))
  .filter((declaration) => hasOnlyLocalUrlReferences(declaration))
  .join('; ')

const createFileId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `svg_${crypto.randomUUID().replace(/-/g, '')}`
  }
  return `svg_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

const encodeSvgDataURL = (svgText) => {
  const bytes = new TextEncoder().encode(svgText)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return `data:${SVG_MIME};base64,${btoa(binary)}`
}

/**
 * 清洗用户或模型生成的 SVG。
 * 保留渐变、滤镜、裁剪等视觉能力，但移除脚本、动画、foreignObject 与外链资源。
 */
const sanitizeSvg = (input = '') => {
  const markup = extractSvgMarkup(input)
  if (!markup || markup.length > MAX_SVG_LENGTH) {
    throw new Error(markup ? 'SVG 代码过大，请控制在 500 KB 以内' : '请输入完整的 SVG 代码')
  }
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    throw new Error('当前环境不支持 SVG 解析')
  }
  if (/<!doctype|<!entity/i.test(markup)) {
    throw new Error('SVG 不允许包含 DOCTYPE 或实体声明')
  }

  const document = new DOMParser().parseFromString(markup, SVG_MIME)
  if (document.querySelector('parsererror')) {
    throw new Error('SVG 语法无效，请检查标签是否完整闭合')
  }
  const root = document.documentElement
  if (!root || root.localName?.toLowerCase() !== 'svg') {
    throw new Error('代码必须以 <svg> 为根元素')
  }

  const allElements = [root, ...root.querySelectorAll('*')]
  if (allElements.length > MAX_SVG_ELEMENTS) {
    throw new Error(`SVG 元素过多，请控制在 ${MAX_SVG_ELEMENTS} 个以内`)
  }

  allElements.forEach((element) => {
    if (element !== root && FORBIDDEN_TAGS.has(element.localName?.toLowerCase())) {
      element.remove()
      return
    }

    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = String(attribute.value || '').trim()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'href' || name === 'xlink:href') {
        if (!value.startsWith('#')) element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'style') {
        const cleanStyle = sanitizeInlineStyle(value)
        if (cleanStyle) element.setAttribute(attribute.name, cleanStyle)
        else element.removeAttribute(attribute.name)
        continue
      }
      if (/(?:javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|expression\s*\(|@import)/i.test(value) || !hasOnlyLocalUrlReferences(value)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const viewBoxParts = String(root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const validViewBox = viewBoxParts.length === 4
    && viewBoxParts.every(Number.isFinite)
    && viewBoxParts[2] > 0
    && viewBoxParts[3] > 0

  const width = clampDimension(validViewBox ? viewBoxParts[2] : root.getAttribute('width'), DEFAULT_WIDTH)
  const height = clampDimension(validViewBox ? viewBoxParts[3] : root.getAttribute('height'), DEFAULT_HEIGHT)
  if (!validViewBox) root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  if (!root.getAttribute('preserveAspectRatio')) root.setAttribute('preserveAspectRatio', 'xMidYMid meet')

  const svgText = new XMLSerializer().serializeToString(root)
  return { svgText, width, height }
}

export const createSvgDataURL = (input) => encodeSvgDataURL(sanitizeSvg(input).svgText)

const fitDisplaySize = (width, height, maxWidth = 960, maxHeight = 720) => {
  let scale = Math.min(1, maxWidth / width, maxHeight / height)
  const longestSide = Math.max(width * scale, height * scale)
  if (longestSide < 320) scale *= Math.min(2, 320 / Math.max(1, longestSide))
  return {
    width: Math.max(24, Math.round(width * scale)),
    height: Math.max(24, Math.round(height * scale)),
  }
}

/** 将 SVG 源码包装成 Excalidraw 原生图片元素与 BinaryFileData。 */
export const createSvgAsset = (input, {
  offsetX = 100,
  offsetY = 100,
  source = 'manual',
  maxWidth = 960,
  maxHeight = 720,
} = {}) => {
  const { svgText, width: naturalWidth, height: naturalHeight } = sanitizeSvg(input)
  const fileId = createFileId()
  const size = fitDisplaySize(naturalWidth, naturalHeight, maxWidth, maxHeight)
  const created = Date.now()
  const element = {
    ...makeBase('image'),
    x: offsetX,
    y: offsetY,
    width: size.width,
    height: size.height,
    strokeColor: 'transparent',
    strokeWidth: 0,
    roughness: 0,
    roundness: null,
    status: 'saved',
    fileId,
    scale: [1, 1],
    crop: null,
    customData: {
      kind: 'svg-image',
      svgSource: svgText,
      generatedBy: source,
    },
  }
  const file = {
    id: fileId,
    mimeType: SVG_MIME,
    dataURL: encodeSvgDataURL(svgText),
    created,
    lastRetrieved: created,
  }
  return { elements: [element], files: { [fileId]: file } }
}
