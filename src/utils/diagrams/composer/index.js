/**
 * Composer —— 通用画布组件引擎
 *
 * 设计核心：用十几种「原语 + 布局容器」自由组合，画出原型/看板/海报/分层图等几乎任意 2D 信息图，
 * 不再被「一次只能选一种图型」束缚。
 *
 * 节点形状（来自 LLM 的 DSL，已解析为对象树）：
 *   { type: 'stack.v', props: { gap, padding, ... }, children: [ ... ] }
 *
 * 布局策略：两遍式
 *   1) measure(node, maxW) —— 自底向上：子节点先量尺寸，容器再据此算自身 w/h。
 *      maxW 由父容器下发（用于文字按可用宽度换行 / 子节点拉伸）。
 *   2) place(node, x, y, w) —— 自顶向下：容器把最终坐标和宽度下发给子节点。
 *
 * 每个原语实现 { measure(node, maxW)=>{w,h}, place(node, x, y, w, out) }。
 * LLM 永远不需要自己算坐标。
 */
import {
  DIAGRAM_THEME,
  beautifyElements,
  ensureReadableTextColor,
  normalizeDiagramColor,
  makeArrow,
  makeEllipse,
  makeLine,
  makeRect,
  makeText,
  measureTextBlock,
  wrapTextToWidth,
  palette,
} from '../shared'
import logger from '../../logger'
import { layoutGraph } from './graphLayout'

// ─── 基础常量 ──────────────────────────────────────

const PAD = 20
const GAP = 20

const LEVEL_FONT = { h1: 36, h2: 26, h3: 20, body: 16, caption: 13 }
const levelFont = (level) => LEVEL_FONT[level] || LEVEL_FONT.body

const DEVICE_W = { phone: 300, tablet: 480, desktop: 760, window: 560 }
const TITLEBAR_H = 40
const SCREEN_PAD = 12

const toColor = (tone) => {
  if (!tone) return null
  if (typeof tone === 'object') return tone
  return DIAGRAM_THEME.semantics[tone] || null
}

// ─── 原语注册表 ────────────────────────────────────

const REGISTRY = {}
const register = (type, def) => { REGISTRY[type] = def }

const getDef = (type) => REGISTRY[type] || REGISTRY.__fallback

// LLM 可能给 props 注入非数值（如 w:"auto"、h:NaN），measure 算出 NaN 尺寸后会一路污染
// 布局 / 连线坐标，最终生成 `<path d="MNaN NaN…">` 让 Excalidraw 渲染崩溃。这里在所有节点
// 必经的出口拒绝无效尺寸，让模型修复规划，避免 NaN 进入渲染器。
const finiteSize = (v) => {
  if (!Number.isFinite(v) || v < 0) throw new Error('画布布局尺寸无效，请检查容器宽度与内边距')
  return v
}

export const measureNode = (node, maxW = null) => {
  if (!node || typeof node !== 'object') return { w: 0, h: 0 }
  const def = getDef(node.type)
  const m = def.measure(node, maxW)
  node._w = finiteSize(m.w)
  node._h = finiteSize(m.h)
  return { w: node._w, h: node._h }
}

export const placeNode = (node, x, y, w, out) => {
  if (!node || typeof node !== 'object') return
  // 记录最终落位，供跨容器 connector 寻址
  node._x = x
  node._y = y
  node._wp = w ?? node._w
  const def = getDef(node.type)
  const startIdx = out.length
  def.place(node, x, y, w ?? node._w, out)
  // 记录该节点的主图形元素（首个矩形/椭圆/菱形），供 connector 做真实绑定
  if (node.props?.id != null && node._el == null) {
    for (let i = startIdx; i < out.length; i++) {
      const t = out[i].type
      if (t === 'rectangle' || t === 'ellipse' || t === 'diamond' || t === 'image') { node._el = out[i]; break }
    }
  }
}

const childList = (node) => Array.isArray(node.children) ? node.children.filter(Boolean) : []

// Reject malformed plans before measurement; silent fallback used to hide missing content.
export const validateComposerTree = (root, connectors = []) => {
  const ids = new Set(), edges = [...(connectors || [])]
  let count = 0
  const visit = (node, depth) => {
    if (++count > 300 || depth > 16) throw new Error('画布结构过于复杂，请减少节点或嵌套')
    if (!node || !REGISTRY[node.type] || node.type === '__fallback') throw new Error(`不支持的画布节点：${node?.type}`)
    const p = node.props || {}
    if (p.id != null) {
      if (typeof p.id !== 'string' || !p.id || ids.has(p.id)) throw new Error(`重复或无效的节点 id：${p.id}`)
      ids.add(p.id)
    }
    for (const key of ['x', 'y', 'w', 'h', 'size', 'gap', 'padding', 'cols', 'fontSize', 'titleSize', 'bodySize', 'nodeMaxW', 'nodeGap', 'layerGap']) {
      if (p[key] == null) continue
      if (!Number.isFinite(p[key]) || p[key] < 0 || p[key] > 10000) throw new Error(`${node.type}.${key} 必须是合理的非负数值`)
      if (['w', 'h', 'size'].includes(key) && p[key] < 16) throw new Error(`${key} 不能小于 16`)
      if (['fontSize', 'titleSize', 'bodySize'].includes(key) && (p[key] < 12 || p[key] > 120)) throw new Error('字号必须在 12–120 之间')
      if (key === 'cols' && (!Number.isInteger(p.cols) || p.cols < 1 || p.cols > 12)) throw new Error('网格列数必须为 1–12')
    }
    if (node.children != null && !Array.isArray(node.children)) throw new Error('children 必须为数组')
    if (p.edges != null && !Array.isArray(p.edges)) throw new Error('edges 必须为数组')
    edges.push(...(p.edges || []))
    childList(node).forEach(child => visit(child, depth + 1))
  }
  visit(root, 0)
  for (const edge of edges) {
    if (!ids.has(edge?.from) || !ids.has(edge?.to)) throw new Error(`连线引用不存在的节点：${edge?.from} → ${edge?.to}`)
  }
}

// Free composition is opt-in: children have local x/y coordinates, while their contents still auto-size.
register('canvas', {
  measure(node, maxW) {
    const p = node.props || {}
    const width = maxW ?? p.w ?? 1000
    let height = p.h ?? 0
    for (const child of childList(node)) {
      const { x = 0, y = 0, w } = child.props || {}
      if (x >= width) throw new Error('自由布局节点超出画布右边界')
      const measured = measureNode(child, Math.min(w ?? width - x, width - x))
      if (x + measured.w > width + 2) throw new Error('自由布局内容超出画布宽度')
      height = Math.max(height, y + measured.h)
    }
    const kids = childList(node)
    if (!p.allowOverlap) for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i], b = kids[j]
      const overlapX = Math.min((a.props?.x ?? 0) + a._w, (b.props?.x ?? 0) + b._w) - Math.max(a.props?.x ?? 0, b.props?.x ?? 0)
      const overlapY = Math.min((a.props?.y ?? 0) + a._h, (b.props?.y ?? 0) + b._h) - Math.max(a.props?.y ?? 0, b.props?.y ?? 0)
      if (overlapX > 2 && overlapY > 2) throw new Error(`自由布局第 ${i + 1} 和 ${j + 1} 个元素重叠，请增大间距；有意叠放需设置 allowOverlap:true`)
    }
    return { w: width, h: height }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    if (p.bg) out.push(makeRect({ x, y, width: w, height: node._h, bg: p.bg, stroke: 'transparent', strokeWidth: 0 }))
    for (const child of childList(node)) placeNode(child, x + (child.props?.x ?? 0), y + (child.props?.y ?? 0), child._w, out)
  },
})

// ─── 文字 ──────────────────────────────────────────

register('text', {
  measure(node, maxW) {
    const props = node.props || {}
    const content = String(props.content ?? props.text ?? '')
    const fs = props.fontSize ?? levelFont(props.level)
    const preferredW = Number.isFinite(Number(props.w)) && Number(props.w) > 0
      ? Number(props.w)
      : ({ h1: 720, h2: 640, h3: 560, body: 520, caption: 400 }[props.level] || 520)
    const availableW = maxW != null ? Math.max(fs * 4, maxW) : preferredW
    const wrap = wrapTextToWidth(content, availableW, fs)
    const m = measureTextBlock(wrap, fs)
    node._wrap = wrap
    node._m = m
    node._fs = fs
    return { w: m.width, h: m.height }
  },
  place(node, x, y, w, out) {
    const props = node.props || {}
    const align = props.align || 'left'
    const color = props.color || (props.level === 'caption' ? DIAGRAM_THEME.textSecondary : DIAGRAM_THEME.text)
    const tx = align === 'center' ? x + (w - node._m.width) / 2
      : align === 'right' ? x + w - node._m.width
        : x
    out.push(makeText({ x: tx, y, text: node._wrap, fontSize: node._fs, color, align, metrics: node._m }))
  },
})

// ─── 原始图元（LLM 出口）─────────────────────────

register('rect', {
  measure(node, maxW) {
    const p = node.props || {}
    const w = p.w || 120
    return { w: maxW != null ? Math.min(w, maxW) : w, h: p.h || 60 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    out.push(makeRect({
      x, y, width: w, height: node._h,
      bg: p.fill || 'transparent',
      stroke: p.stroke || DIAGRAM_THEME.line,
      strokeWidth: p.strokeWidth || 1.4,
      rounded: p.rounded !== false,
      dashed: !!p.dashed,
    }))
  },
})

register('ellipse', {
  measure(node, maxW) {
    const p = node.props || {}
    const d = p.size || 56
    const w = p.w || d
    return { w: maxW != null ? Math.min(w, maxW) : w, h: p.h || d }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    out.push(makeEllipse({
      x, y, width: w, height: node._h,
      bg: p.fill || 'transparent',
      stroke: p.stroke || DIAGRAM_THEME.line,
      strokeWidth: p.strokeWidth || 1.4,
    }))
  },
})

register('line', {
  measure(node, maxW) {
    const p = node.props || {}
    const w = p.w || 120
    return { w: maxW != null ? Math.min(w, maxW) : w, h: p.h || 1 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    out.push(makeLine({
      x, y, points: [[0, 0], [w, node._h]],
      stroke: p.stroke || DIAGRAM_THEME.line,
      strokeWidth: p.strokeWidth || 1.4,
      dashed: !!p.dashed,
    }))
  },
})

// ─── divider 分割线 ────────────────────────────────

register('divider', {
  measure() { return { w: 80, h: 12 } },
  place(node, x, y, w, out) {
    out.push(makeLine({
      x, y: y + 6, points: [[0, 0], [w, 0]],
      stroke: '#e6e6e8', strokeWidth: 1,
    }))
  },
})

// ─── 卡片 ──────────────────────────────────────────

const CARD_DEFAULT_W = 240

register('card', {
  measure(node, maxW) {
    const p = node.props || {}
    const w = maxW != null ? maxW : (p.w || CARD_DEFAULT_W)
    const pad = p.padding ?? PAD
    node._pad = pad
    node._titleFs = p.titleSize ?? 18
    node._bodyFs = p.bodySize ?? 14
    const innerW = w - pad * 2
    const title = String(p.title || '')
    const body = String(p.body ?? p.text ?? '')
    let h = pad
    if (title) {
      const tw = wrapTextToWidth(title, innerW, node._titleFs)
      const m = measureTextBlock(tw, node._titleFs)
      node._titleWrap = tw
      node._titleM = m
      h += m.height
    }
    if (body) {
      if (title) h += 10
      const bw = wrapTextToWidth(body, innerW, node._bodyFs)
      const m = measureTextBlock(bw, node._bodyFs)
      node._bodyWrap = bw
      node._bodyM = m
      h += m.height
    }
    h += pad
    return { w, h: Math.max(h, 56) }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    const toned = !!(p.accent || p.tone)
    const accent = toColor(p.accent || p.tone) || DIAGRAM_THEME.semantics.neutral
    const cardBg = p.fill || (toned ? accent.bg : '#ffffff')
    out.push(makeRect({
      x, y, width: w, height: node._h,
      bg: cardBg,
      stroke: p.stroke || DIAGRAM_THEME.border,
      strokeWidth: 1,
      rounded: true,
    }))
    const pad = node._pad
    let cy = y + pad
    if (node._titleWrap) {
      out.push(makeText({ x: x + pad, y: cy, text: node._titleWrap, fontSize: node._titleFs, color: p.titleColor || DIAGRAM_THEME.text, align: 'left', metrics: node._titleM, bg: cardBg }))
      cy += node._titleM.height + 10
    }
    if (node._bodyWrap) {
      out.push(makeText({ x: x + pad, y: cy, text: node._bodyWrap, fontSize: node._bodyFs, color: p.bodyColor || DIAGRAM_THEME.textSecondary, align: 'left', metrics: node._bodyM, bg: cardBg }))
    }
  },
})

// ─── 布局容器：stack.v ─────────────────────────────

register('stack.v', {
  measure(node, maxW) {
    const p = node.props || {}
    const pad = p.padding ?? 0
    const gap = p.gap ?? GAP
    const innerMaxW = maxW != null ? maxW - pad * 2 : null
    const kids = childList(node)
    let maxChildW = 0
    let totalH = 0
    kids.forEach((c, i) => {
      const m = measureNode(c, innerMaxW)
      maxChildW = Math.max(maxChildW, m.w)
      totalH += m.h
      if (i < kids.length - 1) totalH += gap
    })
    const contentW = innerMaxW != null ? innerMaxW : maxChildW
    node._pad = pad; node._gap = gap; node._contentW = contentW
    return { w: contentW + pad * 2, h: totalH + pad * 2 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    const pad = node._pad
    const align = p.align || 'stretch'
    const contentW = w - pad * 2
    if (p.bg || p.stroke) {
      out.push(makeRect({
        x, y, width: w, height: node._h,
        bg: p.bg || 'transparent',
        stroke: p.stroke || 'transparent',
        strokeWidth: p.stroke ? 1.4 : 0,
        rounded: p.rounded !== false,
      }))
    }
    let cy = y + pad
    for (const c of childList(node)) {
      const cw = align === 'stretch' ? contentW : c._w
      const cx = align === 'center' ? x + pad + (contentW - c._w) / 2
        : align === 'end' ? x + pad + contentW - c._w
          : x + pad
      placeNode(c, cx, cy, cw, out)
      cy += c._h + node._gap
    }
  },
})

// ─── 布局容器：stack.h ─────────────────────────────

register('stack.h', {
  measure(node, maxW) {
    const p = node.props || {}
    const pad = p.padding ?? 0
    const gap = p.gap ?? GAP
    const kids = childList(node)
    kids.forEach((c) => measureNode(c, null))
    let intrinsic = kids.reduce((s, c) => s + c._w, 0) + Math.max(0, kids.length - 1) * gap
    // 超出父级可用宽度时，按等分宽度重新量子节点，让卡片/文字等弹性子节点收缩换行，避免横向溢出。
    if (maxW != null && intrinsic + pad * 2 > maxW && kids.length) {
      const share = Math.max(40, Math.floor((maxW - pad * 2 - (kids.length - 1) * gap) / kids.length))
      kids.forEach((c) => measureNode(c, share))
      intrinsic = kids.reduce((s, c) => s + c._w, 0) + Math.max(0, kids.length - 1) * gap
    }
    const maxH = kids.reduce((m, c) => Math.max(m, c._h), 0)
    node._pad = pad; node._gap = gap; node._rowH = maxH
    return { w: intrinsic + pad * 2, h: maxH + pad * 2 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    const pad = node._pad
    const valign = p.align || 'center'
    const kids = childList(node)
    const intrinsicW = kids.reduce((s, c) => s + c._w, 0) + Math.max(0, kids.length - 1) * node._gap
    const justify = p.justify || 'start'
    const extra = Math.max(0, (w - pad * 2) - intrinsicW)
    let gap = node._gap
    let cx = x + pad
    if (justify === 'center') cx += extra / 2
    else if (justify === 'end') cx += extra
    else if (justify === 'between' && kids.length > 1) gap += extra / (kids.length - 1)
    for (const c of kids) {
      const cy = valign === 'start' ? y + pad
        : valign === 'end' ? y + pad + node._rowH - c._h
          : y + pad + (node._rowH - c._h) / 2
      placeNode(c, cx, cy, c._w, out)
      cx += c._w + gap
    }
  },
})

// ─── 布局容器：grid ────────────────────────────────

const GRID_DEFAULT_COL_W = 240
const GRID_MAX_COL_W = 320

register('grid', {
  measure(node, maxW) {
    const p = node.props || {}
    const cols = Math.max(1, p.cols || 2)
    const pad = p.padding ?? 0
    const gap = p.gap ?? GAP
    const kids = childList(node)
    // 第一遍：确定列宽。
    //   有外部约束 → 等分可用宽度；无约束（顶层）→ 取子节点自然宽度，但封顶避免长文字撑爆。
    let colW
    if (maxW != null) {
      colW = Math.max(40, Math.floor((maxW - pad * 2 - (cols - 1) * gap) / cols))
    } else {
      kids.forEach((c) => measureNode(c, null))
      const natural = Math.max(GRID_DEFAULT_COL_W, ...kids.map((c) => c._w))
      colW = Math.min(natural, GRID_MAX_COL_W)
    }
    // 第二遍：按最终列宽重新量子节点，保证依赖宽度的高度（卡片/标注/文字换行）正确。
    kids.forEach((c) => measureNode(c, colW))
    const rows = Math.ceil(kids.length / cols)
    const rowH = []
    for (let r = 0; r < rows; r++) {
      let h = 0
      for (let c = 0; c < cols; c++) {
        const k = kids[r * cols + c]
        if (k) h = Math.max(h, k._h)
      }
      rowH.push(h)
    }
    node._cols = cols; node._pad = pad; node._gap = gap; node._colW = colW; node._rowH = rowH
    const w = cols * colW + (cols - 1) * gap + pad * 2
    const h = rowH.reduce((s, v) => s + v, 0) + Math.max(0, rows - 1) * gap + pad * 2
    return { w, h }
  },
  place(node, x, y, w, out) {
    const { _cols: cols, _pad: pad, _gap: gap, _colW: colW, _rowH: rowH } = node
    const kids = childList(node)
    kids.forEach((c, i) => {
      const r = Math.floor(i / cols)
      const col = i % cols
      const cx = x + pad + col * (colW + gap)
      let cy = y + pad
      for (let rr = 0; rr < r; rr++) cy += rowH[rr] + gap
      placeNode(c, cx, cy, colW, out)
    })
  },
})

// ─── 设备外壳：screen ──────────────────────────────

register('screen', {
  measure(node, maxW) {
    const p = node.props || {}
    let W = DEVICE_W[p.device] || DEVICE_W.phone
    // 受外部宽度约束时收窄，避免在网格/窄容器里溢出相邻单元
    if (maxW != null && maxW < W) W = Math.max(180, maxW)
    const innerW = W - SCREEN_PAD * 2
    const titleH = TITLEBAR_H
    const kids = childList(node)
    const gap = p.gap ?? GAP
    let totalH = 0
    kids.forEach((c, i) => {
      const m = measureNode(c, innerW)
      totalH += m.h
      if (i < kids.length - 1) totalH += gap
    })
    node._innerW = innerW; node._titleH = titleH; node._gap = gap
    return { w: W, h: titleH + SCREEN_PAD + totalH + SCREEN_PAD }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    const accent = toColor(p.accent) || DIAGRAM_THEME.semantics.primary
    // 外壳
    out.push(makeRect({
      x, y, width: w, height: node._h,
      bg: DIAGRAM_THEME.surface, stroke: DIAGRAM_THEME.border, strokeWidth: 1, rounded: true,
    }))
    // 标题栏
    out.push(makeRect({
      x, y, width: w, height: node._titleH,
      bg: accent.bg, stroke: accent.stroke, strokeWidth: 0, rounded: true,
    }))
    const title = String(p.title || '')
    const tm = measureTextBlock(title, 14)
    out.push(makeText({ x: x + 12, y: y + (node._titleH - tm.height) / 2, text: title, fontSize: 14, color: accent.stroke, align: 'left', metrics: tm }))
    // 内容
    let cy = y + node._titleH + SCREEN_PAD
    for (const c of childList(node)) {
      placeNode(c, x + SCREEN_PAD, cy, node._innerW, out)
      cy += c._h + node._gap
    }
  },
})

// ─── nav.top 顶部导航栏 ───────────────────────────

register('nav.top', {
  measure(node, maxW) {
    node._w0 = maxW != null ? maxW : 280
    return { w: node._w0, h: 44 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    out.push(makeRect({ x, y, width: w, height: node._h, bg: '#f2f2f3', stroke: '#d1d1d5', strokeWidth: 1, rounded: true }))
    const cy = y + (node._h - 16) / 2
    if (p.back) {
      out.push(makeText({ x: x + 12, y: cy, text: '←', fontSize: 16, color: DIAGRAM_THEME.text, align: 'left', metrics: measureTextBlock('←', 16) }))
    }
    const title = String(p.title || '')
    const tm = measureTextBlock(title, 15)
    out.push(makeText({ x: x + (w - tm.width) / 2, y: y + (node._h - tm.height) / 2, text: title, fontSize: 15, color: DIAGRAM_THEME.text, align: 'center', metrics: tm }))
    const actions = Array.isArray(p.actions) ? p.actions : []
    if (actions.length) {
      const txt = actions.join('  ')
      const am = measureTextBlock(txt, 15)
      out.push(makeText({ x: x + w - am.width - 12, y: cy, text: txt, fontSize: 15, color: DIAGRAM_THEME.textSecondary, align: 'right', metrics: am }))
    }
  },
})

// ─── nav.bottom 底部 tab 栏 ───────────────────────

register('nav.bottom', {
  measure(node, maxW) {
    node._w0 = maxW != null ? maxW : 280
    return { w: node._w0, h: 48 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    const tabs = Array.isArray(p.tabs) ? p.tabs : []
    out.push(makeRect({ x, y, width: w, height: node._h, bg: '#fafafa', stroke: '#d1d1d5', strokeWidth: 1, rounded: true }))
    if (!tabs.length) return
    const cellW = w / tabs.length
    const active = p.active != null ? p.active : 0
    tabs.forEach((t, i) => {
      const tm = measureTextBlock(String(t), 13)
      const cx = x + cellW * i + (cellW - tm.width) / 2
      out.push(makeText({ x: cx, y: y + (node._h - tm.height) / 2, text: String(t), fontSize: 13, color: i === active ? DIAGRAM_THEME.semantics.primary.stroke : DIAGRAM_THEME.textSecondary, align: 'center', metrics: tm }))
    })
  },
})

// ─── input 输入框 ──────────────────────────────────

register('input', {
  measure(node, maxW) {
    node._w0 = maxW != null ? maxW : 240
    const label = String((node.props || {}).label || '')
    node._labelH = label ? measureTextBlock(label, 12).height + 4 : 0
    return { w: node._w0, h: node._labelH + 38 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    let cy = y
    if (p.label) {
      const lm = measureTextBlock(p.label, 12)
      out.push(makeText({ x, y: cy, text: p.label, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: lm }))
      cy += node._labelH
    }
    out.push(makeRect({ x, y: cy, width: w, height: 38, bg: '#ffffff', stroke: '#d1d1d5', strokeWidth: 1.2, rounded: true }))
    const ph = String(p.value || p.placeholder || '')
    if (ph) {
      const pm = measureTextBlock(ph, 13)
      out.push(makeText({ x: x + 12, y: cy + (38 - pm.height) / 2, text: ph, fontSize: 13, color: p.value ? DIAGRAM_THEME.text : '#9d9da5', align: 'left', metrics: pm }))
    }
  },
})

// ─── button 按钮 ───────────────────────────────────

register('button', {
  measure(node, maxW) {
    const p = node.props || {}
    const label = String(p.label || '按钮')
    const m = measureTextBlock(label, 14)
    node._label = label; node._m = m
    const intrinsic = m.width + 40
    const full = p.block !== false && maxW != null
    node._w0 = full ? maxW : intrinsic
    return { w: node._w0, h: 40 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    const variant = p.variant || (p.primary ? 'primary' : 'secondary')
    const c = variant === 'primary' ? DIAGRAM_THEME.semantics.primary : DIAGRAM_THEME.semantics.neutral
    const isText = variant === 'text'
    const btnBg = variant === 'primary' ? c.stroke : c.bg
    if (!isText) {
      out.push(makeRect({
        x, y, width: w, height: node._h,
        bg: btnBg,
        stroke: c.stroke, strokeWidth: 1.2, rounded: true,
      }))
    }
    const color = isText ? DIAGRAM_THEME.semantics.primary.stroke : (variant === 'primary' ? '#ffffff' : c.stroke)
    out.push(makeText({ x: x + (w - node._m.width) / 2, y: y + (node._h - node._m.height) / 2, text: node._label, fontSize: 14, color, align: 'center', metrics: node._m, bg: isText ? null : btnBg }))
  },
})

// ─── list 列表 ─────────────────────────────────────

const LIST_MIN_ROW_H = 48
const LIST_ROW_PAD_Y = 8

register('list', {
  measure(node, maxW) {
    const p = node.props || {}
    const items = Array.isArray(p.items) ? p.items : []
    const w = maxW != null ? maxW : 280
    node._w0 = w
    // 逐行预排：算出每行的换行文本与高度，避免固定行高导致的文字重叠
    const rows = items.map((it) => {
      const obj = typeof it === 'string' ? { title: it } : (it || {})
      const hasCheck = obj.checkbox != null || obj.done != null
      const leadX = hasCheck ? 40 : 14
      const trailing = String(obj.trailing || '')
      const trailM = trailing ? measureTextBlock(trailing, 12) : { width: 0, height: 0 }
      const textMaxW = Math.max(40, w - leadX - 14 - (trailM.width ? trailM.width + 12 : 0))
      const title = String(obj.title || '')
      const sub = String(obj.subtitle || '')
      const titleWrap = wrapTextToWidth(title, textMaxW, 14)
      const subWrap = sub ? wrapTextToWidth(sub, textMaxW, 12) : ''
      const titleM = measureTextBlock(titleWrap, 14)
      const subM = subWrap ? measureTextBlock(subWrap, 12) : { width: 0, height: 0 }
      const contentH = titleM.height + (subWrap ? subM.height : 0)
      const h = Math.max(LIST_MIN_ROW_H, contentH + LIST_ROW_PAD_Y * 2)
      return { obj, hasCheck, leadX, trailing, trailM, titleWrap, subWrap, titleM, subM, h }
    })
    node._rows = rows
    const total = rows.reduce((s, r) => s + r.h, 0)
    return { w, h: Math.max(LIST_MIN_ROW_H, total) }
  },
  place(node, x, y, w, out) {
    out.push(makeRect({ x, y, width: w, height: node._h, bg: '#ffffff', stroke: '#e6e6e8', strokeWidth: 1.2, rounded: true }))
    let ry = y
    node._rows.forEach((row, i) => {
      if (i > 0) out.push(makeLine({ x: x + 8, y: ry, points: [[0, 0], [w - 16, 0]], stroke: '#eef2f7', strokeWidth: 1 }))
      const { obj, hasCheck, leadX, trailing, trailM, titleWrap, subWrap, titleM, subM, h } = row
      if (hasCheck) {
        const checked = obj.checkbox === true || obj.done === true
        out.push(makeRect({ x: x + 12, y: ry + (h - 16) / 2, width: 16, height: 16, bg: checked ? DIAGRAM_THEME.semantics.success.bg : '#ffffff', stroke: checked ? DIAGRAM_THEME.semantics.success.stroke : '#9d9da5', strokeWidth: 1.2, rounded: true }))
      }
      const tx = x + leadX
      const contentH = titleM.height + (subWrap ? subM.height : 0)
      let ty = ry + (h - contentH) / 2
      out.push(makeText({ x: tx, y: ty, text: titleWrap, fontSize: 14, color: DIAGRAM_THEME.text, align: 'left', metrics: titleM }))
      ty += titleM.height
      if (subWrap) {
        out.push(makeText({ x: tx, y: ty, text: subWrap, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: subM }))
      }
      if (trailing) {
        out.push(makeText({ x: x + w - trailM.width - 14, y: ry + (h - trailM.height) / 2, text: trailing, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'right', metrics: trailM }))
      }
      ry += h
    })
  },
})

// ─── table 表格 ────────────────────────────────────

register('table', {
  measure(node, maxW) {
    const p = node.props || {}
    const headers = Array.isArray(p.headers) ? p.headers : []
    const rows = (Array.isArray(p.rows) ? p.rows : []).map(row => Array.isArray(row) ? row : [row])
    const cols = Math.max(headers.length, ...rows.map(row => row.length), 1)
    const widths = Array.from({ length: cols }, (_, i) => Math.min(320, Math.max(100, ...[headers, ...rows].map(row => measureTextBlock(String(row[i] ?? ''), 14).width + 32))))
    const natural = widths.reduce((sum, width) => sum + width, 0)
    const target = maxW ?? p.w ?? natural
    if (target / cols < 64) throw new Error('表格列数过多、列宽不足，请扩大表格或拆分内容')
    node._colW = widths.map(width => width / natural * target)
    node._tableRows = [...(headers.length ? [{ cells: headers, header: true }] : []), ...rows.map(cells => ({ cells, header: false }))].map(row => {
      const cells = Array.from({ length: cols }, (_, i) => {
        const text = wrapTextToWidth(String(row.cells[i] ?? ''), Math.max(20, node._colW[i] - 32), 14)
        return { text, metrics: measureTextBlock(text, 14) }
      })
      return { ...row, cells, height: Math.max(44, ...cells.map(cell => cell.metrics.height + 24)) }
    })
    return { w: target, h: node._tableRows.reduce((sum, row) => sum + row.height, 0) }
  },
  place(node, x, y, w, out) {
    out.push(makeRect({ x, y, width: w, height: node._h, bg: DIAGRAM_THEME.surface, stroke: DIAGRAM_THEME.border, strokeWidth: 1, rounded: true }))
    let ry = y
    for (const row of node._tableRows) {
      if (row.header) out.push(makeRect({ x, y: ry, width: w, height: row.height, bg: DIAGRAM_THEME.semantics.neutral.bg, stroke: 'transparent', strokeWidth: 0, rounded: true }))
      else if (ry > y) out.push(makeLine({ x: x + 12, y: ry, points: [[0, 0], [w - 24, 0]], stroke: DIAGRAM_THEME.border, strokeWidth: 1 }))
      let cx = x
      row.cells.forEach((cell, i) => {
        out.push(makeText({ x: cx + 16, y: ry + 12, text: cell.text, fontSize: 14, color: row.header ? DIAGRAM_THEME.text : DIAGRAM_THEME.textSecondary, align: 'left', metrics: cell.metrics }))
        cx += node._colW[i]
      })
      ry += row.height
    }
  },
})

// ─── image 占位图 ──────────────────────────────────

register('image', {
  measure(node, maxW) {
    const p = node.props || {}
    const w = p.w || (maxW != null ? maxW : 200)
    const ratio = p.ratio || 0.6
    node._w0 = w
    return { w, h: p.h || Math.round(w * ratio) }
  },
  place(node, x, y, w, out) {
    out.push(makeRect({ x, y, width: w, height: node._h, bg: '#f2f2f3', stroke: '#d1d1d5', strokeWidth: 1.2, rounded: true }))
    out.push(makeLine({ x, y, points: [[0, 0], [w, node._h]], stroke: '#d1d1d5', strokeWidth: 1 }))
    out.push(makeLine({ x, y, points: [[w, 0], [0, node._h]], stroke: '#d1d1d5', strokeWidth: 1 }))
    const label = String((node.props || {}).label || '图片')
    const m = measureTextBlock(label, 12)
    out.push(makeText({ x: x + (w - m.width) / 2, y: y + (node._h - m.height) / 2, text: label, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: m }))
  },
})

// ─── AI 生成的 SVG 资产 ───────────────────────────

register('svg', {
  measure(node, maxW) {
    const p = node.props || {}
    const asset = node._asset
    const naturalW = asset?.width || Number(p.w) || 480
    const naturalH = asset?.height || Number(p.h) || 360
    const width = maxW != null ? Math.min(naturalW, maxW) : naturalW
    const height = Math.max(24, Math.round(width * naturalH / Math.max(1, naturalW)))
    node._svgW = width
    const kids = childList(node)
    if (!p.allowOverlap) for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i], b = kids[j]
      const overlapX = Math.min((a.props?.x ?? 0) + a._w, (b.props?.x ?? 0) + b._w) - Math.max(a.props?.x ?? 0, b.props?.x ?? 0)
      const overlapY = Math.min((a.props?.y ?? 0) + a._h, (b.props?.y ?? 0) + b._h) - Math.max(a.props?.y ?? 0, b.props?.y ?? 0)
      if (overlapX > 2 && overlapY > 2) throw new Error(`自由布局第 ${i + 1} 和 ${j + 1} 个元素重叠，请增大间距；有意叠放需设置 allowOverlap:true`)
    }
    return { w: width, h: height }
  },
  place(node, x, y, w, out) {
    if (!node._asset) return
    const width = Math.min(w, node._svgW || w)
    out.push({
      ...node._asset,
      x,
      y,
      width,
      height: node._h,
    })
  },
})

// ─── avatar 头像 ───────────────────────────────────

register('avatar', {
  measure(node, maxW) {
    let d = (node.props || {}).size || 44
    if (maxW != null) d = Math.min(d, maxW)
    node._d = d
    return { w: d, h: d }
  },
  place(node, x, y, w, out) {
    const d = node._d
    out.push(makeEllipse({ x, y, width: d, height: d, bg: '#e6e6e8', stroke: '#9d9da5', strokeWidth: 1.2 }))
    const label = String((node.props || {}).label || '')
    if (label) {
      const txt = label.slice(0, 2)
      const m = measureTextBlock(txt, 13)
      out.push(makeText({ x: x + (d - m.width) / 2, y: y + (d - m.height) / 2, text: txt, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: m }))
    }
  },
})

// ─── badge 徽标 ────────────────────────────────────

register('badge', {
  measure(node, maxW) {
    const txt = wrapTextToWidth(String((node.props || {}).text ?? (node.props || {}).count ?? ''), maxW != null ? maxW - 20 : 300, 13)
    const m = measureTextBlock(txt, 13)
    node._txt = txt; node._m = m
    const w = m.width + 16
    return { w: maxW != null ? Math.min(w, maxW) : w, h: m.height + 6 }
  },
  place(node, x, y, w, out) {
    const c = toColor((node.props || {}).tone) || DIAGRAM_THEME.semantics.neutral
    out.push(makeRect({ x, y, width: w, height: node._h, bg: c.bg, stroke: c.stroke, strokeWidth: 1, rounded: true }))
    out.push(makeText({ x: x + (w - node._m.width) / 2, y: y + (node._h - node._m.height) / 2, text: node._txt, fontSize: 13, color: c.stroke, align: 'center', metrics: node._m, bg: c.bg }))
  },
})

// ─── icon 图标占位（用字符/emoji）──────────────────

register('icon', {
  measure(node, maxW) {
    const sym = String((node.props || {}).symbol || '◇')
    const fs = (node.props || {}).size || 18
    const m = measureTextBlock(sym, fs)
    node._sym = sym; node._m = m; node._fs = fs
    return { w: maxW != null ? Math.min(m.width, maxW) : m.width, h: m.height }
  },
  place(node, x, y, w, out) {
    out.push(makeText({ x, y, text: node._sym, fontSize: node._fs, color: (node.props || {}).color || DIAGRAM_THEME.text, align: 'left', metrics: node._m }))
  },
})

// ─── callout 标注气泡 ─────────────────────────────

register('callout', {
  measure(node, maxW) {
    const p = node.props || {}
    const txt = String(p.text || p.content || '')
    const w = maxW != null ? maxW : Math.min(300, measureTextBlock(txt, 14).width + 32)
    const wrap = wrapTextToWidth(txt, w - 28, 14)
    const m = measureTextBlock(wrap, 14)
    node._wrap = wrap; node._m = m; node._w0 = w
    return { w, h: m.height + 16 }
  },
  place(node, x, y, w, out) {
    const c = toColor((node.props || {}).tone) || DIAGRAM_THEME.semantics.accent
    out.push(makeRect({ x, y, width: w, height: node._h, bg: c.bg, stroke: c.stroke, strokeWidth: 1, rounded: true }))
    out.push(makeText({ x: x + 14, y: y + 8, text: node._wrap, fontSize: 14, color: c.stroke, align: 'left', metrics: node._m, bg: c.bg }))
  },
})

// ─── group 分组框（带标题虚线框）─────────────────

register('group', {
  measure(node, maxW) {
    const p = node.props || {}
    const pad = p.padding ?? 24
    const gap = p.gap ?? GAP
    const innerMaxW = maxW != null ? maxW - pad * 2 : null
    const kids = childList(node)
    let maxChildW = 0, totalH = 0
    kids.forEach((c, i) => {
      const m = measureNode(c, innerMaxW)
      maxChildW = Math.max(maxChildW, m.w)
      totalH += m.h
      if (i < kids.length - 1) totalH += gap
    })
    const contentW = innerMaxW != null ? innerMaxW : Math.max(maxChildW, Math.min(420, measureTextBlock(p.title || '', 18).width))
    node._title = wrapTextToWidth(p.title || '', contentW, 18)
    const titleH = p.title ? measureTextBlock(node._title, 18).height + 20 : 0
    node._pad = pad; node._gap = gap; node._titleH = titleH; node._contentW = contentW
    return { w: contentW + pad * 2, h: titleH + totalH + pad * 2 }
  },
  place(node, x, y, w, out) {
    const p = node.props || {}
    const c = toColor(p.tone) || DIAGRAM_THEME.semantics.neutral
    const groupBg = p.bg !== undefined ? p.bg : c.bg
    out.push(makeRect({
      x, y, width: w, height: node._h,
      bg: groupBg,
      stroke: p.stroke || DIAGRAM_THEME.border,
      strokeWidth: 1,
      rounded: true,
      dashed: p.dashed === true,
    }))
    let cy = y + node._pad
    if (p.title) {
      const m = measureTextBlock(node._title, 18)
      out.push(makeText({ x: x + node._pad, y: cy, text: node._title, fontSize: 18, color: DIAGRAM_THEME.text, align: 'left', metrics: m, bg: groupBg }))
      cy += node._titleH
    }
    const contentW = w - node._pad * 2
    for (const child of childList(node)) {
      placeNode(child, x + node._pad, cy, contentW, out)
      cy += child._h + node._gap
    }
  },
})

// ─── 布局容器：graph（分层图布局）──────────────────
//
// 关系图（流程图 / ER / 依赖图 / 拓扑）专用：子节点是图的节点（各带 props.id），
// props.edges = [{ from, to, label?, dashed?, tone? }] 描述连线。
// 子节点先各自量出固有尺寸，再交给 layoutGraph 按依赖关系分层排布（减少交叉），
// 最后用算出的坐标直接落位 —— 节点位置由"谁连谁"决定，而非容器树顺序。

register('graph', {
  measure(node, maxW) {
    const p = node.props || {}
    const kids = childList(node)
    kids.forEach((c) => measureNode(c, p.nodeMaxW || 200))
    const lnodes = kids.map((c, i) => ({ id: c.props?.id != null ? String(c.props.id) : `__g${i}`, w: c._w, h: c._h }))
    kids.forEach((c, i) => { c._gid = lnodes[i].id })
    const edges = (Array.isArray(p.edges) ? p.edges : []).map((e) => ({ from: String(e.from), to: String(e.to) }))
    const laid = layoutGraph(lnodes, edges, {
      direction: p.direction === 'LR' ? 'LR' : 'TB',
      layerGap: p.layerGap ?? 72,
      nodeGap: p.nodeGap ?? 40,
    })
    node._graph = laid
    return { w: Math.max(laid.width, maxW || 0), h: laid.height }
  },
  place(node, x, y, w, out) {
    const laid = node._graph
    for (const c of childList(node)) {
      const gp = laid.pos.get(c._gid) || { x: 0, y: 0 }
      placeNode(c, x + gp.x, y + gp.y, c._w, out)
    }
    // graph 自带连线，复用 connectors 渲染（label 避让 / 端口错峰 / 绑定）。
    // 跨多层的边由 layoutGraph 通过虚拟节点算出避让折线（routes，图局部坐标），
    // 这里平移成绝对坐标挂到 conn._route，renderConnectors 优先用它而非默认端口走线。
    const p = node.props || {}
    if (Array.isArray(p.edges) && p.edges.length) {
      const routes = laid.routes || []
      const conns = p.edges.map((e, i) => {
        const r = routes[i]
        return {
          from: String(e.from), to: String(e.to), label: e.label, dashed: e.dashed, tone: e.tone,
          _route: Array.isArray(r) && r.length >= 2 ? r.map((pt) => ({ x: x + pt.x, y: y + pt.y })) : null,
        }
      })
      renderConnectors(node, conns, out)
    }
  },
})

// ─── 兜底原语 ──────────────────────────────────────

register('__fallback', {
  measure(node) {
    logger.warn('[composer] 未知原语类型，降级为文字:', node.type)
    const content = String(node.props?.content || node.props?.title || node.props?.text || node.type || '')
    const wrap = wrapTextToWidth(content, 360, 14)
    const m = measureTextBlock(wrap, 14)
    node._wrap = wrap; node._m = m
    return { w: m.width, h: m.height }
  },
  place(node, x, y, w, out) {
    out.push(makeText({ x, y, text: node._wrap, fontSize: 14, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: node._m }))
  },
})

// ─── 跨容器连线（connectors）──────────────────────
//
// LLM 可在顶层给 connectors: [{ from: '<节点id>', to: '<节点id>', label?, dashed?, tone? }]
// 任何带 props.id 的节点都可被寻址。连线在所有节点落位后，按盒子边缘正交走线。

const collectById = (node, map) => {
  if (!node || typeof node !== 'object') return
  const id = node.props?.id
  if (id != null && !map.has(String(id))) map.set(String(id), node)
  for (const c of childList(node)) collectById(c, map)
}

const nodeBox = (node) => ({
  x: node._x,
  y: node._y,
  w: node._wp ?? node._w,
  h: node._h,
  el: node._el || null,
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const portSides = (a, b) => {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
  const dx = bcx - acx, dy = bcy - acy
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

const portPoint = (box, side) => {
  if (side === 'left') return { x: box.x, y: box.y + box.h / 2 }
  if (side === 'right') return { x: box.x + box.w, y: box.y + box.h / 2 }
  if (side === 'top') return { x: box.x + box.w / 2, y: box.y }
  return { x: box.x + box.w / 2, y: box.y + box.h }
}

const offsetPortPoint = (box, side, offset = 0) => {
  if (!offset) return portPoint(box, side)
  const margin = 12
  if (side === 'left' || side === 'right') {
    return {
      x: side === 'left' ? box.x : box.x + box.w,
      y: clamp(box.y + box.h / 2 + offset, box.y + margin, box.y + box.h - margin),
    }
  }
  return {
    x: clamp(box.x + box.w / 2 + offset, box.x + margin, box.x + box.w - margin),
    y: side === 'top' ? box.y : box.y + box.h,
  }
}

const routedFromAbs = (pts) => {
  const start = pts[0]
  return { start, points: pts.map((p) => [p.x - start.x, p.y - start.y]) }
}

const boxKey = (b) => `${Math.round(b.x)}|${Math.round(b.y)}|${Math.round(b.w)}|${Math.round(b.h)}`

const segmentBoxPenalty = (a, b, box) => {
  const pad = 6
  const bx1 = box.x - pad, by1 = box.y - pad
  const bx2 = box.x + box.w + pad, by2 = box.y + box.h + pad
  if (Math.abs(a.x - b.x) < 0.5) {
    const x = a.x
    if (x <= bx1 || x >= bx2) return 0
    const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y)
    const hit = Math.min(y2, by2) - Math.max(y1, by1)
    return hit > 0 ? hit : 0
  }
  if (Math.abs(a.y - b.y) < 0.5) {
    const y = a.y
    if (y <= by1 || y >= by2) return 0
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x)
    const hit = Math.min(x2, bx2) - Math.max(x1, bx1)
    return hit > 0 ? hit : 0
  }
  return 0
}

const scoreRoute = (pts, obstacles, ignoreKeys) => {
  let overlap = 0
  let len = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    len += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    for (const box of obstacles) {
      if (ignoreKeys.has(boxKey(box))) continue
      overlap += segmentBoxPenalty(a, b, box)
    }
  }
  const bends = Math.max(0, pts.length - 2)
  return overlap * 10000 + len + bends * 20
}

const routeConnector = (a, b, options = {}) => {
  const [fs, ts] = portSides(a, b)
  const s = offsetPortPoint(a, fs, options.fromOffset || 0)
  const e = offsetPortPoint(b, ts, options.toOffset || 0)
  const dx = e.x - s.x, dy = e.y - s.y
  const candidates = []
  const addAbs = (pts) => candidates.push(pts.filter((pt, idx, arr) => (
    idx === 0 || Math.abs(pt.x - arr[idx - 1].x) > 0.5 || Math.abs(pt.y - arr[idx - 1].y) > 0.5
  )))

  if (Math.abs(dx) < 6 || Math.abs(dy) < 6) {
    const dogleg = options.channelOffset || 24
    if (Math.abs(dx) < 6) {
      addAbs([s, { x: s.x + dogleg, y: s.y }, { x: s.x + dogleg, y: e.y }, e])
    } else {
      addAbs([s, { x: s.x, y: s.y + dogleg }, { x: e.x, y: s.y + dogleg }, e])
    }
  }
  // 拐弯点取两盒之间的真实 gap 中线，而非两点连线中点；
  // 否则盒子近距离/重叠时转角会穿过节点本体。
  if (fs === 'left' || fs === 'right') {
    const aRight = a.x + a.w, bRight = b.x + b.w
    let midX
    if (aRight <= b.x) midX = (aRight + b.x) / 2
    else if (bRight <= a.x) midX = (bRight + a.x) / 2
    else midX = s.x + dx / 2
    midX += options.channelOffset || 0
    addAbs([s, { x: midX, y: s.y }, { x: midX, y: e.y }, e])
  } else {
    const aBottom = a.y + a.h, bBottom = b.y + b.h
    let midY
    if (aBottom <= b.y) midY = (aBottom + b.y) / 2
    else if (bBottom <= a.y) midY = (bBottom + a.y) / 2
    else midY = s.y + dy / 2
    midY += options.channelOffset || 0
    addAbs([s, { x: s.x, y: midY }, { x: e.x, y: midY }, e])
  }

  const obstacles = Array.isArray(options.obstacles) ? options.obstacles : []
  if (obstacles.length) {
    const minX = Math.min(...obstacles.map((o) => o.x))
    const minY = Math.min(...obstacles.map((o) => o.y))
    const maxX = Math.max(...obstacles.map((o) => o.x + o.w))
    const maxY = Math.max(...obstacles.map((o) => o.y + o.h))
    const margin = 32 + Math.abs(options.channelOffset || 0)
    const topY = minY - margin
    const bottomY = maxY + margin
    const leftX = minX - margin
    const rightX = maxX + margin
    addAbs([s, { x: s.x, y: topY }, { x: e.x, y: topY }, e])
    addAbs([s, { x: s.x, y: bottomY }, { x: e.x, y: bottomY }, e])
    addAbs([s, { x: leftX, y: s.y }, { x: leftX, y: e.y }, e])
    addAbs([s, { x: rightX, y: s.y }, { x: rightX, y: e.y }, e])
  }

  const ignoreKeys = new Set([boxKey(a), boxKey(b)])
  let best = candidates[0] || [s, e]
  let bestScore = scoreRoute(best, obstacles, ignoreKeys)
  for (const pts of candidates.slice(1)) {
    const sc = scoreRoute(pts, obstacles, ignoreKeys)
    if (sc < bestScore) { best = pts; bestScore = sc }
  }
  return routedFromAbs(best)
}

const LAYOUT_CONTAINERS = new Set(['stack.v', 'stack.h', 'grid', 'group', 'screen', 'graph'])

const collectBoxes = (node, list) => {
  if (!node || typeof node !== 'object') return
  // 只收叶子内容块（card/list/table/...）用于标签避让；
  // 布局容器（stack/grid/group/screen）覆盖整片内容区，若纳入会把标签挤出画面。
  if (node._x != null && node._h != null && !LAYOUT_CONTAINERS.has(node.type)) {
    list.push({ x: node._x, y: node._y, w: node._wp ?? node._w, h: node._h })
  }
  for (const c of childList(node)) collectBoxes(c, list)
}

// 在连线自身的走线上为标签找一个落点：先在各段中点里选"压住节点最少"的那段，
// 再沿垂直于该段的方向做有界微移进一步避让。标签始终贴着连线，绝不被甩到画布空白处。
const overlapAreaAt = (lx, ly, lw, lh, nodes) => {
  let area = 0
  for (const b of nodes) {
    const ox = Math.min(lx + lw, b.x + b.w) - Math.max(lx, b.x)
    const oy = Math.min(ly + lh, b.y + b.h) - Math.max(ly, b.y)
    if (ox > 0 && oy > 0) area += ox * oy
  }
  return area
}

const placeEdgeLabel = (startX, startY, pts, lw, lh, nodes) => {
  // 候选：每一段的中点（绝对坐标）+ 该段是横向还是纵向
  let best = null
  for (let k = 0; k < pts.length - 1; k++) {
    const ax = startX + pts[k][0], ay = startY + pts[k][1]
    const bx = startX + pts[k + 1][0], by = startY + pts[k + 1][1]
    const len = Math.abs(bx - ax) + Math.abs(by - ay)
    if (len < 8) continue
    const vertical = Math.abs(by - ay) >= Math.abs(bx - ax)
    const mx = (ax + bx) / 2 - lw / 2
    const my = (ay + by) / 2 - lh / 2
    // 沿垂直于线段方向有界微移（纵向线→左右挪，横向线→上下挪）
    const step = 16
    const offs = [0, step, -step, step * 2, -step * 2]
    for (const o of offs) {
      const lx = vertical ? mx + o : mx
      const ly = vertical ? my : my + o
      const area = overlapAreaAt(lx, ly, lw, lh, nodes)
      const dist = Math.abs(o) + (best ? Math.abs(len - best.len) * 0.01 : 0)
      // 偏好：重叠更小 > 更长的段 > 离线更近
      if (!best || area < best.area - 1 ||
        (Math.abs(area - best.area) <= 1 && (len > best.len + 1 || (Math.abs(len - best.len) <= 1 && dist < best.dist)))) {
        best = { lx, ly, area, len, dist }
      }
      if (area === 0) break
    }
  }
  if (!best) {
    const ax = startX + pts[0][0], ay = startY + pts[0][1]
    return { lx: ax - lw / 2, ly: ay - lh / 2 }
  }
  return { lx: best.lx, ly: best.ly }
}


const renderConnectors = (root, connectors, out) => {
  if (!Array.isArray(connectors) || !connectors.length) return
  const map = new Map()
  collectById(root, map)
  const allBoxes = []
  collectBoxes(root, allBoxes)
  const prepared = []
  const portUsage = new Map()
  for (const conn of connectors) {
    if (!conn || conn.from == null || conn.to == null) continue
    if (String(conn.from) === String(conn.to)) continue
    const from = map.get(String(conn.from))
    const to = map.get(String(conn.to))
    if (!from || !to || from._x == null || to._x == null) continue
    const fromBox = nodeBox(from)
    const toBox = nodeBox(to)
    const [fromSide, toSide] = portSides(fromBox, toBox)
    const fromKey = `${conn.from}|${fromSide}`
    const toKey = `${conn.to}|${toSide}`
    if (!portUsage.has(fromKey)) portUsage.set(fromKey, [])
    if (!portUsage.has(toKey)) portUsage.set(toKey, [])
    portUsage.get(fromKey).push(conn)
    portUsage.get(toKey).push(conn)
    prepared.push({ conn, from, to, fromBox, toBox, fromSide, toSide })
  }
  const portOffset = (key, conn, sideAxisLength) => {
    const list = portUsage.get(key)
    if (!list || list.length <= 1) return 0
    const idx = list.indexOf(conn)
    const n = list.length
    const step = Math.min(18, Math.max(8, sideAxisLength / (n + 1)))
    return (idx - (n - 1) / 2) * step
  }
  for (let i = 0; i < prepared.length; i++) {
    const { conn, fromBox, toBox, fromSide, toSide } = prepared[i]
    const fromAxis = (fromSide === 'left' || fromSide === 'right') ? fromBox.h : fromBox.w
    const toAxis = (toSide === 'left' || toSide === 'right') ? toBox.h : toBox.w
    const fromOffset = portOffset(`${conn.from}|${fromSide}`, conn, fromAxis)
    const toOffset = portOffset(`${conn.to}|${toSide}`, conn, toAxis)
    const channelOffset = (i % 5 - 2) * 12
    // 跨多层的边优先用 layoutGraph 经虚拟节点算出的避让折线（绝对坐标），它保证不穿中间层
    // 节点；其余（同层 / 相邻层）退回端口默认走线。
    let routed
    if (Array.isArray(conn._route) && conn._route.length >= 2) {
      const start = conn._route[0]
      routed = { start, points: conn._route.map((pt) => [pt.x - start.x, pt.y - start.y]) }
    } else {
      routed = routeConnector(fromBox, toBox, {
        fromOffset,
        toOffset,
        channelOffset,
        obstacles: allBoxes,
      })
    }
    const tone = toColor(conn.tone)
    const arrow = makeArrow({
      x: routed.start.x,
      y: routed.start.y,
      points: routed.points,
      stroke: tone?.stroke || DIAGRAM_THEME.line,
      strokeWidth: 1.6,
      dashed: !!conn.dashed,
    })
    // 绑定箭头与两端图形：移动节点时连线跟随，避免"线与块脱节"
    if (fromBox.el?.id) {
      arrow.startBinding = { elementId: fromBox.el.id, focus: 0, gap: 8 }
      fromBox.el.boundElements = [...(fromBox.el.boundElements || []), { id: arrow.id, type: 'arrow' }]
    }
    if (toBox.el?.id) {
      arrow.endBinding = { elementId: toBox.el.id, focus: 0, gap: 8 }
      toBox.el.boundElements = [...(toBox.el.boundElements || []), { id: arrow.id, type: 'arrow' }]
    }
    out.push(arrow)
    if (conn.label) {
      // 连线标签很短（如 "1:N"/"提交"），不能套用 measureTextBlock 的卡片正文最小尺寸
      // （宽≥80/高≥40），否则一个 3 字标签会撑出一个大白块盖住相邻节点与连线。这里贴字紧排。
      const labelStr = String(conn.label)
      const lfs = 12
      let textW = 0
      for (const seg of labelStr.split('\n')) {
        let lw = 0
        for (const ch of [...seg]) lw += ch.charCodeAt(0) > 255 ? lfs : lfs * 0.58
        textW = Math.max(textW, lw)
      }
      const lineN = Math.max(1, labelStr.split('\n').length)
      const lm = { width: Math.ceil(textW) + 6, height: Math.ceil(lineN * lfs * 1.25) + 4, lines: lineN }
      const lw = lm.width + 8
      const lh = lm.height + 4
      // 标签贴在连线自身的走线上：在各段中点里选压住节点最少的那段并做有界微移，
      // 绝不在全画布找空位（那会把跨层长连线的标签甩到顶部空白带）。
      const { lx, ly } = placeEdgeLabel(routed.start.x, routed.start.y, routed.points, lw, lh, allBoxes)
      // 白底标签：避免文字被连线穿过、压住其它元素，提升可读性
      out.push(makeRect({
        x: lx, y: ly, width: lw, height: lh,
        bg: DIAGRAM_THEME.labelBg, stroke: 'transparent', strokeWidth: 0, rounded: true,
      }))
      out.push(makeText({
        x: lx + 4, y: ly + 2,
        text: labelStr,
        fontSize: lfs,
        color: DIAGRAM_THEME.textSecondary,
        align: 'center',
        metrics: lm,
      }))
    }
  }
}

// ─── 主入口 ────────────────────────────────────────

const normalizeRoot = (tree) => {
  // 接受两种形态：
  //   1) { title?, layout?, children: [...] }  → 顶层用 layout 指定的容器包住 children
  //   2) 直接一个节点 { type, props, children }
  if (tree && Array.isArray(tree.children) && !tree.type) {
    const layout = tree.layout || {}
    return {
      type: layout.type || 'stack.v',
      props: { ...layout, gap: layout.gap ?? 32, padding: layout.padding ?? 0 },
      children: tree.children,
    }
  }
  return tree
}

const collectEmbeddedFiles = (node, files) => {
  if (!node || typeof node !== 'object') return
  if (node._files) Object.assign(files, node._files)
  for (const child of childList(node)) collectEmbeddedFiles(child, files)
}

export const renderComposer = (tree, { offsetX = 100, offsetY = 100 } = {}) => {
  if (!tree) return { elements: [], files: {} }
  const out = []
  let oy = offsetY

  if (tree.title) {
    const wrappedTitle = wrapTextToWidth(tree.title, 900, 36)
    const m = measureTextBlock(wrappedTitle, 36)
    out.push(makeText({ x: offsetX, y: oy, text: wrappedTitle, fontSize: 36, color: DIAGRAM_THEME.text, align: 'left', metrics: m }))
    oy += m.height + 32
  }

  const root = normalizeRoot(tree)
  validateComposerTree(root, tree.connectors)
  measureNode(root, root.props?.w ?? null)
  placeNode(root, offsetX, oy, root._w, out)

  renderConnectors(root, tree.connectors, out)

  // Invalid Canvas fill styles can silently render black. Reject them before saving so
  // the generator's repair round can use a portable solid color or an SVG gradient.
  for (const element of out) {
    for (const field of ['backgroundColor', 'strokeColor']) {
      if (element[field] == null) continue
      const color = normalizeDiagramColor(element[field])
      if (!color) throw new Error(`不支持的原生画布颜色 ${element[field]}：请使用 #RGB、#RRGGBB、rgb() 或 transparent；渐变请用 SVG`)
      element[field] = color
    }
  }

  // 文字可读性兜底（关键）：
  // 单个原语的 makeText 只知道自己传入的 bg，但文字常常落在「父容器/外层块」的填充色上
  // （例如深色 header、上色的 stack.v、group 背景）。这里在所有元素落位后统一回算：
  // 为每个文字找到它真正压着的那个填充块（绘制顺序在它之前、且包含其中心的最上层实心形状），
  // 用该块的真实底色重判对比度，必要时翻色，避免「深底深字 / 浅底浅字」不可见。
  const isFilled = (el) => (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond')
    && el.backgroundColor && el.backgroundColor !== 'transparent'
  const contains = (el, cx, cy) => cx >= el.x && cx <= el.x + el.width && cy >= el.y && cy <= el.y + el.height
  for (let i = 0; i < out.length; i++) {
    const t = out[i]
    if (t.type !== 'text') continue
    const cx = t.x + (t.width || 0) / 2
    const cy = t.y + (t.height || 0) / 2
    let bg = DIAGRAM_THEME.canvas
    for (let j = i - 1; j >= 0; j--) {
      const s = out[j]
      if (isFilled(s) && contains(s, cx, cy)) { bg = s.backgroundColor; break }
    }
    t.strokeColor = ensureReadableTextColor(t.strokeColor, bg)
  }

  // 视觉打磨：统一用清爽无衬线字体（fontFamily 2），替代默认手绘体，
  // 让原型/看板/信息图更精致规整。
  for (const el of out) {
    if (el.type === 'text') el.fontFamily = 2
  }

  const files = {}
  collectEmbeddedFiles(root, files)
  return { elements: beautifyElements(out), files, width: root._w, height: root._h }
}

export { REGISTRY, register, palette, routeConnector, placeEdgeLabel }
