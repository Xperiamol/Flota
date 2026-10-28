import { parseStructuredOutput } from './structuredOutput'
import { createSvgAsset } from './svgAsset'
import { measureTextBlock, wrapTextToWidth, randomSeed, makeRect, makeText, makeArrow } from './shared'
import { routeConnector, placeEdgeLabel } from './composer'

const NUMERIC = new Set(['x', 'y', 'width', 'height', 'fontSize', 'opacity', 'strokeWidth', 'angle'])
const COLORS = new Set(['strokeColor', 'backgroundColor'])
const SHAPES = new Set(['rectangle', 'diamond', 'ellipse'])
const box = el => ({ x: el.x, y: el.y, w: el.width, h: el.height })
const validColor = value => typeof value === 'string' && /^(#[0-9a-f]{3}|#[0-9a-f]{6}|transparent)$/i.test(value)
const FIELDS = new Set([...NUMERIC, ...COLORS, 'text', 'type'])

// Patch existing identities; never turn a small edit into whole-scene regeneration.
export const applyScenePatch = (elements, patch, selectedIds = []) => {
  if (!Array.isArray(patch?.updates) || !Array.isArray(patch?.remove)) throw new Error('修改必须包含 updates 和 remove 数组')
  if (patch.add != null && !Array.isArray(patch.add) || patch.reroute != null && !Array.isArray(patch.reroute)) throw new Error('add 和 reroute 必须为数组')
  const byId = new Map(elements.map(element => [element.id, element]))
  const allowed = new Set(selectedIds.length ? selectedIds : byId.keys())
  const touched = new Set()
  const claim = id => {
    if (!byId.has(id) || !allowed.has(id)) throw new Error(`不能修改未知或未选中的元素：${id}`)
    if (touched.has(id)) throw new Error(`元素修改重复：${id}`)
    touched.add(id)
    return byId.get(id)
  }
  const replacements = new Map(), files = {}
  for (const update of patch.updates) {
    const old = claim(update.id)
    const next = { ...old }
    const changes = update.changes || {}
    for (const [key, value] of Object.entries(changes)) {
      if (!FIELDS.has(key)) throw new Error(`不支持修改字段：${key}`)
      if (NUMERIC.has(key) && (!Number.isFinite(value) || Math.abs(value) > 100000)) throw new Error(`无效数值：${key}`)
      if (['width', 'height'].includes(key) && value <= 0) throw new Error('尺寸必须为正数')
      if (key === 'fontSize' && (old.type !== 'text' || value < 12 || value > 160)) throw new Error('字号必须为 12–160')
      if (key === 'opacity' && (value < 0 || value > 100)) throw new Error('透明度必须为 0–100')
      if (key === 'strokeWidth' && (value < 0 || value > 12)) throw new Error('线宽必须为 0–12')
      if (COLORS.has(key) && !validColor(value)) throw new Error('颜色须为十六进制或 transparent')
      if (key === 'text' && (old.type !== 'text' || typeof value !== 'string' || value.length > 10000)) throw new Error('只能修改文本元素的文字')
      if (['width', 'height'].includes(key) && ['arrow', 'line'].includes(old.type)) throw new Error('连线尺寸不能直接修改，请移动节点或使用画布连线工具')
      if (['x', 'y', 'angle'].includes(key) && old.type === 'arrow' && (old.startBinding || old.endBinding)) throw new Error('请移动连线关联的节点，不直接移动绑定连线')
      if (key === 'type' && (!SHAPES.has(old.type) || !SHAPES.has(value))) throw new Error('只支持矩形、菱形、椭圆之间转换')
      next[key] = value
      if (key === 'type') next.roundness = null
    }
    if (update.svgSource != null) {
      if (!old.customData?.svgSource || typeof update.svgSource !== 'string') throw new Error('只能对已有 SVG 元素修改源码')
      const asset = createSvgAsset(update.svgSource, { source: 'ai-edit' })
      next.fileId = asset.elements[0].fileId
      next.customData = { ...old.customData, ...asset.elements[0].customData }
      Object.assign(files, asset.files)
    }
    if (old.type === 'text' && ['text', 'fontSize', 'width'].some(key => key in changes)) {
      const text = String(changes.text ?? old.originalText ?? old.text ?? '')
      next.originalText = text
      next.text = wrapTextToWidth(text, next.width, next.fontSize || 16)
      const metrics = measureTextBlock(next.text, next.fontSize || 16)
      next.width = metrics.width
      next.height = metrics.height
      const container = byId.get(old.containerId)
      if (container && next.y + next.height > container.y + container.height - 4) throw new Error('修改后的文字超出原容器，请缩短文字或先扩大容器')
    }
    next.version = (old.version || 0) + 1
    next.versionNonce = randomSeed()
    next.updated = Date.now()
    replacements.set(old.id, next)
  }
  const removed = new Set(patch.remove)
  for (const id of removed) claim(id)
  if (!touched.size && !patch.add?.length && !patch.reroute?.length) throw new Error('没有可应用的修改')
  const changedGeometry = id => {
    const before = byId.get(id), after = replacements.get(id)
    return before && after && ['x', 'y', 'width', 'height'].some(key => before[key] !== after[key]) ? { before, after } : null
  }
  let result = elements.filter(element => !removed.has(element.id)).map(element => {
    let next = replacements.get(element.id) || element
    const movedContainer = changedGeometry(element.containerId)
    if (movedContainer && !replacements.has(element.id)) {
      const { before, after } = movedContainer
      next = { ...next, x: next.x + after.x - before.x, y: next.y + after.y - before.y }
    }
    if (element.type === 'arrow' && element.points?.length >= 2) {
      const points = element.points.map(([x, y]) => [element.x + x, element.y + y])
      for (const [binding, index] of [[element.startBinding, 0], [element.endBinding, points.length - 1]]) {
        const moved = changedGeometry(binding?.elementId)
        if (!moved) continue
        const { before, after } = moved
        points[index] = [after.x + (points[index][0] - before.x) / (before.width || 1) * after.width, after.y + (points[index][1] - before.y) / (before.height || 1) * after.height]
      }
      if (points.some(([x, y], i) => x !== element.x + element.points[i][0] || y !== element.y + element.points[i][1])) {
        const [x, y] = points[0]
        next = { ...next, x, y, points: points.map(([px, py]) => [px - x, py - y]), width: Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])), height: Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) }
      }
    }
    // Deletion must not leave dangling arrow / text bindings.
    if (removed.size) {
      const boundElements = next.boundElements?.filter(binding => !removed.has(binding.id))
      const startBinding = removed.has(next.startBinding?.elementId) ? null : next.startBinding
      const endBinding = removed.has(next.endBinding?.elementId) ? null : next.endBinding
      const containerId = removed.has(next.containerId) ? null : next.containerId
      if (boundElements?.length !== next.boundElements?.length || startBinding !== next.startBinding || endBinding !== next.endBinding || containerId !== next.containerId) {
        next = { ...next, boundElements, startBinding, endBinding, containerId, version: (next.version || 0) + 1, versionNonce: randomSeed(), updated: Date.now() }
      }
    }
    if (next !== element && !replacements.has(element.id)) next = { ...next, version: (element.version || 0) + 1, versionNonce: randomSeed(), updated: Date.now() }
    return next
  })
  const reserved = new Set(byId.keys())
  const reserve = id => {
    if (typeof id !== 'string' || !id || id.length > 128 || reserved.has(id)) throw new Error(`新增元素 ID 无效或重复：${id}`)
    reserved.add(id)
  }
  const additions = patch.add || []
  for (const spec of additions) reserve(spec.id)
  for (const spec of additions.filter(item => item.type !== 'arrow')) {
    if (!SHAPES.has(spec.type) && spec.type !== 'text') throw new Error('新增仅支持矩形、菱形、椭圆、文字或箭头')
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(spec[key]) || Math.abs(spec[key]) > 100000 || (['width', 'height'].includes(key) && spec[key] <= 0)) throw new Error(`新增元素几何无效：${key}`)
    }
    for (const key of COLORS) if (spec[key] != null && !validColor(spec[key])) throw new Error('颜色须为十六进制或 transparent')
    const shape = { ...makeRect({ ...spec, bg: spec.backgroundColor, stroke: spec.strokeColor }), id: spec.id, type: spec.type, roundness: null }
    if (spec.type !== 'text') result.push(shape)
    const label = spec.type === 'text' ? spec.text : spec.label
    if (label != null) {
      if (typeof label !== 'string' || label.length > 10000) throw new Error('新增文字无效')
      const fontSize = spec.fontSize ?? 16
      if (!Number.isFinite(fontSize) || fontSize < 12 || fontSize > 160) throw new Error('字号必须为 12–160')
      const text = wrapTextToWidth(label, spec.width - 20, fontSize)
      const metrics = measureTextBlock(text, fontSize)
      if (metrics.height > spec.height - 16) throw new Error('新增文字超出容器，请扩大尺寸')
      const id = spec.type === 'text' ? spec.id : `${spec.id}-label`
      if (spec.type !== 'text') reserve(id)
      result.push({ ...makeText({ x: spec.x + (spec.width - metrics.width) / 2, y: spec.y + (spec.height - metrics.height) / 2, text, fontSize, bg: spec.backgroundColor, containerId: spec.type === 'text' ? null : spec.id }), id })
      if (spec.type !== 'text') shape.boundElements = [{ id, type: 'text' }]
    } else if (spec.type === 'text') throw new Error('新增文字需要 text')
  }
  const reroute = new Set(patch.reroute || [])
  const current = new Map(result.map(el => [el.id, el]))
  for (const spec of additions.filter(item => item.type === 'arrow')) {
    const from = current.get(spec.from), to = current.get(spec.to)
    if (!from || !to || !SHAPES.has(from.type) || !SHAPES.has(to.type) || from.id === to.id) throw new Error('新增箭头需要两个不同的有效节点')
    if (selectedIds.length && [from, to].some(el => byId.has(el.id) && !allowed.has(el.id))) throw new Error('新增箭头不能连接未选中的节点')
    const arrow = { ...makeArrow({ x: 0, y: 0, points: [[0, 0], [1, 1]], startBinding: { elementId: from.id, focus: 0, gap: 1 }, endBinding: { elementId: to.id, focus: 0, gap: 1 } }), id: spec.id }
    result.push(arrow)
    current.set(arrow.id, arrow)
    for (const node of [from, to]) current.set(node.id, { ...current.get(node.id), boundElements: [...(current.get(node.id).boundElements || []), { id: arrow.id, type: 'arrow' }], version: (current.get(node.id).version || 0) + 1, versionNonce: randomSeed(), updated: Date.now() })
    reroute.add(arrow.id)
  }
  const obstacles = [...current.values()].filter(el => SHAPES.has(el.type)).map(box)
  for (const id of reroute) {
    const arrow = current.get(id)
    if (!arrow || arrow.type !== 'arrow') throw new Error(`不能重排未知连线：${id}`)
    if (selectedIds.length && byId.has(id) && !allowed.has(id) && !allowed.has(arrow.startBinding?.elementId) && !allowed.has(arrow.endBinding?.elementId)) throw new Error('不能重排未选中区域的连线')
    const from = current.get(arrow.startBinding?.elementId), to = current.get(arrow.endBinding?.elementId)
    if (!from || !to || !SHAPES.has(from.type) || !SHAPES.has(to.type)) throw new Error('重排连线需要有效的起止节点绑定')
    const route = routeConnector(box(from), box(to), { obstacles })
    const next = { ...arrow, x: route.start.x, y: route.start.y, points: route.points, width: Math.max(...route.points.map(p => p[0])) - Math.min(...route.points.map(p => p[0])), height: Math.max(...route.points.map(p => p[1])) - Math.min(...route.points.map(p => p[1])), version: (arrow.version || 0) + 1, versionNonce: randomSeed(), updated: Date.now() }
    current.set(id, next)
    for (const label of current.values()) if (label.type === 'text' && label.containerId === id) {
      const pos = placeEdgeLabel(next.x, next.y, next.points, label.width, label.height, obstacles)
      current.set(label.id, { ...label, x: pos.lx, y: pos.ly, version: (label.version || 0) + 1, versionNonce: randomSeed(), updated: Date.now() })
    }
  }
  result = result.map(el => current.get(el.id))
  if (!result.length) throw new Error('不能通过局部修改删除整张画布')
  return { elements: result, files, warnings: [] }
}

export const editScene = async ({ elements, prompt, appState = {}, task }) => {
  const selected = new Set(elements.filter(element => appState.selectedElementIds?.[element.id]).map(element => element.id))
  // Excalidraw selects a container, but its bound label is part of the same editing target.
  for (const element of elements) if (selected.has(element.containerId)) selected.add(element.id)
  const selectedIds = [...selected]
  const scene = elements.filter(element => !selected.size || selected.has(element.id) || selected.has(element.startBinding?.elementId) || selected.has(element.endBinding?.elementId)).map(({ id, type, x, y, width, height, text, fontSize, strokeColor, backgroundColor, containerId, startBinding, endBinding, points, customData }) => ({
    id, type, x, y, width, height, text, fontSize, strokeColor, backgroundColor, containerId, startBinding, endBinding, points,
    svgSource: customData?.svgSource,
  }))
  const context = JSON.stringify({ selectedIds, elements: scene })
  if (context.length > 160000) throw new Error('画布内容过大，请将需要修改的区域拆到单独画布后重试')
  const messages = [
    { role: 'system', content: `你是画布局部编辑器。只修改用户明确要求的对象，保留其余内容、布局和元素 id。selectedIds 非空时只能修改选中的元素。
返回严格 JSON：{"updates":[{"id":"已有id","changes":{"text":"新文字"},"svgSource":"可选的完整SVG源码"}],"remove":[],"add":[],"reroute":[]}。
changes 仅支持 x,y,width,height,fontSize(12–160),opacity(0–100),angle,strokeWidth(0–12),strokeColor,backgroundColor,text,type（rectangle/diamond/ellipse 之间转换）。颜色为十六进制。不要返回未改变的字段。
SVG 必须根据已有完整源码修改，保持原构图；禁止脚本、外链、foreignObject、style 标签。不要对 SVG 使用 text 字段。
只在明确要求删除时使用 remove。不要用删除/重建代替局部修改。add 可新增节点 {id,type,x,y,width,height,label?,fontSize?}、文字 {id,type:"text",x,y,width,height,text} 或箭头 {id,type:"arrow",from:节点id,to:节点id}。reroute 为需要重新避障走线的绑定箭头 id 数组。已有元素保持 id；不直接修改连线尺寸或绑定。文本要适合原容器，无法实现时返回 {"error":"具体原因"}。` },
    { role: 'user', content: `需求：${prompt}\n当前场景：${context}` },
  ]
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    task?.throwIfCancelled()
    const response = await (task ? task.chat : window.electronAPI.ai.chat)(messages, { temperature: 0.2, bypassTokenLimit: true, timeoutMs: 180000 })
    if (!response?.success) throw new Error(response?.error || '画布修改请求失败')
    const content = String(response.data?.content || '')
    try {
      const patch = parseStructuredOutput(content)
      if (patch.error) throw new Error(patch.error)
      return applyScenePatch(elements, patch, selectedIds)
    } catch (error) {
      lastError = error
      messages.push({ role: 'assistant', content }, { role: 'user', content: `修改未应用：${error.message}。请修正，仍只输出 JSON。` })
    }
  }
  throw new Error(`局部修改未通过校验，原画布未改变：${lastError.message}`)
}
