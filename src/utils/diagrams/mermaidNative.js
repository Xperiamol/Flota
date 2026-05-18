/**
 * 通用 Mermaid 图表 → Excalidraw 元素
 * 复用官方 @excalidraw/mermaid-to-excalidraw（业界基准）
 *
 * 官方原生矢量分支（Tier 1，可拆图元编辑）：
 *   flowchart / sequence / class / state / er
 *
 * 官方非原生分支（Tier 3，回退 SVG → PNG 图片快照，不可拆图元编辑）：
 *   architecture-beta / block-beta / gantt / pie / timeline / mindmap / quadrantChart / xychart-beta 等
 *
 * 本模块对 Tier 3 路径做了两件关键事：
 *   1) SVG → 高分辨率 PNG，避免 Excalidraw `normalizeSVG` 严格校验失败 + 解决低清糊化
 *   2) 给每个 image 元素附 customData = { tier:3, kind:'mermaid-image', mermaidSource }，
 *      以后可双击编辑 DSL 重新生成
 */
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import logger from '../logger'

const SVG_MIME = 'image/svg+xml'

// 高分辨率渲染倍率：Retina 屏取 DPR，封顶 4，避免极端机型生成超大图导致内存爆炸
const computeRenderScale = () => {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return Math.min(4, Math.max(2, Math.round(dpr * 1.5)))
}

const offsetElements = (elements, offsetX, offsetY) => elements.map((el) => {
  if (el == null) return el
  const next = { ...el }
  if (typeof next.x === 'number') next.x += offsetX
  if (typeof next.y === 'number') next.y += offsetY
  return next
})

const decodeDataURL = (dataURL = '') => {
  const [, meta = '', data = ''] = String(dataURL).match(/^data:([^,]*),(.*)$/) || []
  if (!data) return ''
  if (meta.includes(';base64')) {
    const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  }
  return decodeURIComponent(data)
}

const encodeSvgDataURL = (svgText) => {
  const bytes = new TextEncoder().encode(svgText)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return `data:${SVG_MIME};base64,${btoa(binary)}`
}

const sanitizeSvgText = (svgText = '') => String(svgText)
  .replace(/<br>/gi, '<br/>')
  .replace(/<hr>/gi, '<hr/>')
  .replace(/&nbsp;/gi, '&#160;')

/**
 * SVG dataURL → 高分辨率 PNG dataURL
 * 关键：canvas 像素缓冲 = 逻辑显示尺寸 × scale，最终图片在白板里仍然按逻辑尺寸显示，
 * 但因为像素密度更高，缩放后依然清晰。
 */
const svgDataURLToPng = ({ dataURL, width = 1200, height = 800 }) => new Promise((resolve, reject) => {
  const svgText = sanitizeSvgText(decodeDataURL(dataURL))
  const img = new Image()
  img.onload = () => {
    const logicalW = Math.max(1, Math.ceil(width || img.naturalWidth || 1200))
    const logicalH = Math.max(1, Math.ceil(height || img.naturalHeight || 800))
    const scale = computeRenderScale()
    const canvas = document.createElement('canvas')
    canvas.width = logicalW * scale
    canvas.height = logicalH * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('无法创建 Canvas 上下文'))
      return
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    resolve({
      dataURL: canvas.toDataURL('image/png'),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      logicalWidth: logicalW,
      logicalHeight: logicalH,
    })
  }
  img.onerror = () => reject(new Error('SVG 转 PNG 失败'))
  img.src = encodeSvgDataURL(svgText)
})

const createFallbackPng = ({ width = 1200, height = 800, message = 'Mermaid image render failed' } = {}) => {
  const scale = computeRenderScale()
  const logicalW = Math.max(1, Math.ceil(width || 1200))
  const logicalH = Math.max(1, Math.ceil(height || 800))
  const canvas = document.createElement('canvas')
  canvas.width = logicalW * scale
  canvas.height = logicalH * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, logicalW, logicalH)
  ctx.strokeStyle = '#e03131'
  ctx.lineWidth = 3
  ctx.strokeRect(12, 12, logicalW - 24, logicalH - 24)
  ctx.fillStyle = '#e03131'
  ctx.font = '24px sans-serif'
  ctx.fillText(message, 32, 56)
  return canvas.toDataURL('image/png')
}

const normalizeMermaidFiles = async (files = {}, elements = []) => {
  const now = Date.now()
  const elementByFileId = new Map(
    elements
      .filter(el => el?.type === 'image' && el.fileId)
      .map(el => [el.fileId, el]),
  )

  const entries = await Promise.all(Object.entries(files || {}).map(async ([id, file]) => {
    if (!file) return [id, file]
    const base = {
      ...file,
      id: file.id || id,
      created: file.created || now,
      lastRetrieved: file.lastRetrieved || now,
    }
    if (base.mimeType !== SVG_MIME) return [id, base]

    const imageElement = elementByFileId.get(base.id)
    try {
      const png = await svgDataURLToPng({
        dataURL: base.dataURL,
        width: imageElement?.width || base.width,
        height: imageElement?.height || base.height,
      })
      return [id, {
        ...base,
        mimeType: 'image/png',
        dataURL: png.dataURL,
      }]
    } catch (error) {
      logger.warn('[mermaidNative] SVG 转 PNG 失败，使用 PNG 占位图:', error.message)
      const fallback = createFallbackPng({
        width: imageElement?.width || base.width,
        height: imageElement?.height || base.height,
      })
      return [id, {
        ...base,
        mimeType: 'image/png',
        dataURL: fallback,
      }]
    }
  }))

  return Object.fromEntries(entries)
}

/**
 * 给元素打 tier / customData，让前端能识别"图片快照"和反查 DSL
 */
const annotateElements = (elements, { tier, mermaidSource }) => elements.map((el) => {
  if (el == null) return el
  const next = { ...el }
  if (next.type === 'image') {
    next.customData = {
      ...(next.customData || {}),
      tier: 3,
      kind: 'mermaid-image',
      mermaidSource: mermaidSource || '',
    }
  } else {
    next.customData = {
      ...(next.customData || {}),
      tier,
      kind: 'mermaid-native',
    }
  }
  return next
})

export const renderMermaidNative = async (mermaidCode, { offsetX = 100, offsetY = 100 } = {}) => {
  const { elements: skeletons, files } = await parseMermaidToExcalidraw(mermaidCode, {
    themeVariables: { fontSize: '16px' },
  })
  if (!skeletons?.length) {
    throw new Error('Mermaid 解析未生成任何元素')
  }
  const concrete = convertToExcalidrawElements(skeletons, { regenerateIds: true })
  const normalizedFiles = await normalizeMermaidFiles(files, concrete)
  const hasImage = concrete.some(el => el?.type === 'image')
  const annotated = annotateElements(concrete, {
    tier: hasImage ? 3 : 1,
    mermaidSource: mermaidCode,
  })
  logger.log(`[mermaidNative] 元素数=${concrete.length} tier=${hasImage ? 3 : 1}`)
  return {
    elements: offsetElements(annotated, offsetX, offsetY),
    files: normalizedFiles,
    tier: hasImage ? 3 : 1,
  }
}
