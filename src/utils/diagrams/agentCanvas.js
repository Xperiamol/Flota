// 对话智能体直接给出的画布内容 → Excalidraw 元素。不再调用第二个模型：
//   canvas  原语树（见 electron/services/aichat/skills/canvas/PRIMITIVES.md）
//   mermaid Mermaid 源码（时序图、类图、状态图、ER 图等）
//   patch   按元素 id 局部修改已有画布 { updates, remove, add?, reroute? }
// 出错直接抛出，错误信息原样交还给智能体，由它自己改了再提交。
import { renderComposer } from './composer'
import { renderMermaidNative } from './mermaidNative'
import { createSvgAsset } from './svgAsset'
import { applyScenePatch } from './editScene'
import { computeOffset } from './shared'

const parseMaybeJson = (value, field) => {
  if (value == null || value === '') return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch (error) {
    throw new Error(`${field} 不是合法 JSON：${error.message}`)
  }
}

/** 从工具参数里取出画布内容；没有任何内容时返回 null（旧版只有 prompt 的确认卡） */
export const readCanvasSpec = (args = {}) => {
  const canvas = parseMaybeJson(args.canvas, 'canvas')
  const patch = parseMaybeJson(args.patch, 'patch')
  const mermaid = typeof args.mermaid === 'string' && args.mermaid.trim() ? args.mermaid.trim() : null
  const given = [canvas && 'canvas', mermaid && 'mermaid', patch && 'patch'].filter(Boolean)
  if (!given.length) return null
  if (given.length > 1) throw new Error(`canvas、mermaid、patch 一次只能给一种，收到了 ${given.join('、')}`)
  return { canvas, mermaid, patch }
}

const collectSvgNodes = (node, list = []) => {
  if (!node || typeof node !== 'object') return list
  if (node.type === 'svg') list.push(node)
  for (const child of Array.isArray(node.children) ? node.children : []) collectSvgNodes(child, list)
  return list
}

// svg 原语：智能体自己写完整 <svg> 源码放在 props.source；这里只做安全校验与转成图片元素
const hydrateSvgNodes = (tree, allowSvg) => {
  const nodes = collectSvgNodes(tree)
  if (nodes.length && !allowSvg) throw new Error('用户已在设置中关闭 AI 绘制 SVG，不能使用 svg 节点；请改用 rect、ellipse、icon 等原生图元')
  nodes.forEach((node, index) => {
    const p = node.props || {}
    if (typeof p.source !== 'string' || !p.source.trim()) {
      throw new Error(`第 ${index + 1} 个 svg 节点缺少 props.source（完整的 <svg>…</svg> 源码）`)
    }
    let asset
    try {
      asset = createSvgAsset(p.source, {
        offsetX: 0,
        offsetY: 0,
        source: 'ai',
        maxWidth: Math.max(120, Math.min(1200, Number(p.w) || 520)),
        maxHeight: Math.max(80, Math.min(1200, Number(p.h) || 420)),
      })
    } catch (error) {
      throw new Error(`第 ${index + 1} 个 svg 节点无法使用：${error.message}`)
    }
    Object.defineProperty(node, '_asset', { value: asset.elements[0], configurable: true })
    Object.defineProperty(node, '_files', { value: asset.files, configurable: true })
  })
}

/**
 * @param {{canvas?, mermaid?, patch?}} spec  readCanvasSpec 的结果
 * @param {object} opts
 * @param {Array}  opts.existingElements  目标画布当前元素（append / patch 用）
 * @param {boolean} opts.append           追加到已有内容右侧
 * @param {boolean} opts.allowSvg
 * @returns {Promise<{ elements, files, warnings, replacesAll }>}
 *   replacesAll：patch 返回的是整张画布的新元素；canvas / mermaid 返回的是新增元素
 */
export const renderCanvasSpec = async (spec, { existingElements = [], append = false, allowSvg = true } = {}) => {
  const active = existingElements.filter(element => element && !element.isDeleted)
  if (spec.patch) {
    if (!active.length) throw new Error('目标画布是空的，没有可局部修改的元素；请改用 canvas 或 mermaid 生成内容')
    const result = applyScenePatch(active, spec.patch, [], { allowSvg })
    return { elements: result.elements, files: result.files || {}, warnings: result.warnings || [], replacesAll: true }
  }
  const offsets = append ? computeOffset(active) : { offsetX: 100, offsetY: 100 }
  let result
  if (spec.mermaid) {
    try {
      result = await renderMermaidNative(spec.mermaid, offsets)
    } catch (error) {
      throw new Error(`Mermaid 渲染失败：${error.message}`)
    }
  } else {
    // 引擎会给节点挂测量缓存，先复制一份，保证同一份参数可以重复渲染（提交时检查一次、确认后再渲染一次）
    const tree = JSON.parse(JSON.stringify(spec.canvas))
    hydrateSvgNodes(tree, allowSvg)
    result = renderComposer(tree, offsets)
  }
  const elements = result?.elements || []
  if (!elements.length) throw new Error('画布渲染结果为空，请检查内容')
  return { elements, files: result.files || {}, warnings: result.warnings || [], replacesAll: false }
}

/** 渲染结果的尺寸摘要，交给智能体判断版面 */
export const summarizeRendered = (elements = []) => {
  const live = elements.filter(element => element && !element.isDeleted)
  if (!live.length) return { elements: 0 }
  const minX = Math.min(...live.map(e => e.x)), minY = Math.min(...live.map(e => e.y))
  const maxX = Math.max(...live.map(e => e.x + (e.width || 0))), maxY = Math.max(...live.map(e => e.y + (e.height || 0)))
  const types = {}
  for (const element of live) types[element.type] = (types[element.type] || 0) + 1
  return { elements: live.length, width: Math.round(maxX - minX), height: Math.round(maxY - minY), types }
}

/** 渲染成 PNG（dataURL），开启图片理解时交给智能体自己看效果 */
export const renderCanvasPreview = async (elements, files = {}, { dark = false, maxSize = 1400 } = {}) => {
  const { exportToBlob } = await import('@excalidraw/excalidraw')
  const blob = await exportToBlob({
    elements,
    files,
    appState: { viewBackgroundColor: dark ? '#121212' : '#ffffff', exportBackground: true, exportWithDarkMode: dark },
    mimeType: 'image/png',
    maxWidthOrHeight: maxSize,
  })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('画布预览读取失败'))
    reader.readAsDataURL(blob)
  })
}
