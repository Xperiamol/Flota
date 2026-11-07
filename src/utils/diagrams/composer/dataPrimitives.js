/**
 * Composer 数据与叙事原语：stat / progress / chart / timeline / quote / steps
 *
 * 只负责把模型给的结构画清楚，不替模型做构图决定：尺寸取父容器给的可用宽度或 props.w，
 * 颜色取 tone 语义色或模型给的显式颜色；不合法的数据直接抛错，让生成流程的反思轮修复。
 */
import {
  DIAGRAM_THEME,
  makeEllipse,
  makeLine,
  makeRect,
  makeText,
  measureTextBlock,
  wrapTextToWidth,
} from '../shared'

const SERIES = DIAGRAM_THEME.depthPalette
const toColor = (tone) => {
  if (!tone) return null
  if (typeof tone === 'object') return tone
  return DIAGRAM_THEME.semantics[tone] || null
}
const num = (v, what) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (!Number.isFinite(n)) throw new Error(`${what} 必须是数字`)
  return n
}
const fmt = (n) => {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  const s = abs >= 100 || Number.isInteger(n) ? String(Math.round(n * 100) / 100) : n.toFixed(1)
  return s.replace(/\.0$/, '')
}
const block = (str, size, maxW) => {
  const wrapped = maxW != null ? wrapTextToWidth(String(str ?? ''), maxW, size) : String(str ?? '')
  return { wrapped, m: measureTextBlock(wrapped, size) }
}


// 圆角：节点可用 props.radius 覆盖（0 为直角），否则用各原语的默认值；外层容器大、内层元素小，嵌套时视觉协调
const radiusOf = (p, fallback) => { const r = Number(p?.radius); return p?.radius != null && Number.isFinite(r) && r >= 0 ? Math.min(r, 64) : fallback }

export const registerDataPrimitives = (register) => {
  // ─── stat：关键数字 ───────────────────────────────
  // props: value, unit?, label?, delta?, trend?('up'|'down'|'flat'), tone?, size?, align?('left'|'center'), plain?, fill?, stroke?, w?
  register('stat', {
    measure(node, maxW) {
      const p = node.props || {}
      if (p.value == null || String(p.value) === '') throw new Error('stat.value 不能为空')
      const size = p.size ?? 36
      const pad = p.plain ? 0 : (p.padding ?? 18)
      const valueM = measureTextBlock(String(p.value), size)
      const unitSize = Math.round(size * 0.45)
      const unitM = p.unit ? measureTextBlock(String(p.unit), unitSize) : { width: 0, height: 0 }
      const natural = valueM.width + (p.unit ? unitM.width + 4 : 0)
      const w = maxW != null ? maxW : (p.w || Math.max(150, natural + pad * 2))
      const inner = w - pad * 2
      const label = p.label ? block(p.label, 13, inner) : null
      const delta = p.delta != null && String(p.delta) !== '' ? block(`${p.trend === 'down' ? '▼' : p.trend === 'flat' ? '■' : '▲'} ${p.delta}`, 12, inner) : null
      node._s = { size, pad, valueM, unitSize, unitM, label, delta }
      const h = pad + valueM.height + (label ? 6 + label.m.height : 0) + (delta ? 8 + delta.m.height + 6 : 0) + pad
      return { w, h }
    },
    place(node, x, y, w, out) {
      const p = node.props || {}
      const { size, pad, valueM, unitSize, unitM, label, delta } = node._s
      const c = toColor(p.tone)
      const bg = p.plain ? null : (p.fill || (c ? c.bg : '#ffffff'))
      if (!p.plain) out.push(makeRect({ x, y, width: w, height: node._h, bg, stroke: p.stroke || DIAGRAM_THEME.border, strokeWidth: 1, rounded: true, radius: radiusOf(node.props, 14) }))
      const center = p.align === 'center'
      const total = valueM.width + (p.unit ? unitM.width + 4 : 0)
      let cx = center ? x + (w - total) / 2 : x + pad
      let cy = y + pad
      out.push(makeText({ x: cx, y: cy, text: String(p.value), fontSize: size, color: p.color || (c ? c.stroke : DIAGRAM_THEME.text), align: 'left', metrics: valueM, bg }))
      if (p.unit) out.push(makeText({ x: cx + valueM.width + 4, y: cy + valueM.height - unitM.height - size * 0.08, text: String(p.unit), fontSize: unitSize, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: unitM, bg }))
      cy += valueM.height
      if (label) {
        cy += 6
        out.push(makeText({ x: center ? x + (w - label.m.width) / 2 : x + pad, y: cy, text: label.wrapped, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: center ? 'center' : 'left', metrics: label.m, bg }))
        cy += label.m.height
      }
      if (delta) {
        cy += 8
        const dc = p.trend === 'down' ? DIAGRAM_THEME.semantics.danger : p.trend === 'flat' ? DIAGRAM_THEME.semantics.neutral : DIAGRAM_THEME.semantics.success
        const bx = center ? x + (w - delta.m.width - 12) / 2 : x + pad
        out.push(makeRect({ x: bx, y: cy - 3, width: delta.m.width + 12, height: delta.m.height + 6, bg: dc.bg, stroke: 'transparent', strokeWidth: 0, rounded: true, radius: 6 }))
        out.push(makeText({ x: bx + 6, y: cy, text: delta.wrapped, fontSize: 12, color: dc.stroke, align: 'left', metrics: delta.m, bg: dc.bg }))
      }
    },
  })

  // ─── progress：进度条 ─────────────────────────────
  // props: value, max?(默认 100), label?, tone?, showValue?(默认 true), valueText?, barH?, w?
  register('progress', {
    measure(node, maxW) {
      const p = node.props || {}
      const max = p.max == null ? 100 : num(p.max, 'progress.max')
      const value = num(p.value, 'progress.value')
      if (max <= 0) throw new Error('progress.max 必须大于 0')
      const ratio = Math.max(0, Math.min(1, value / max))
      const w = maxW != null ? maxW : (p.w || 280)
      const showValue = p.showValue !== false
      const valueText = p.valueText != null ? String(p.valueText) : (p.max == null ? `${fmt(value)}%` : `${fmt(value)} / ${fmt(max)}`)
      const valueM = showValue ? measureTextBlock(valueText, 13) : { width: 0, height: 0 }
      const label = p.label ? block(p.label, 13, Math.max(40, w - (showValue ? valueM.width + 12 : 0))) : null
      const barH = p.barH ?? 10
      const headH = Math.max(label ? label.m.height : 0, showValue ? valueM.height : 0)
      node._p = { ratio, valueText, valueM, label, barH, headH, showValue }
      return { w, h: headH + (headH ? 8 : 0) + barH }
    },
    place(node, x, y, w, out) {
      const p = node.props || {}
      const { ratio, valueText, valueM, label, barH, headH, showValue } = node._p
      const c = toColor(p.tone) || DIAGRAM_THEME.semantics.primary
      if (label) out.push(makeText({ x, y, text: label.wrapped, fontSize: 13, color: DIAGRAM_THEME.text, align: 'left', metrics: label.m }))
      if (showValue) out.push(makeText({ x: x + w - valueM.width, y, text: valueText, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: 'right', metrics: valueM }))
      const by = y + headH + (headH ? 8 : 0)
      out.push(makeRect({ x, y: by, width: w, height: barH, bg: p.track || '#eef2f7', stroke: 'transparent', strokeWidth: 0, rounded: true, radius: radiusOf(node.props, 6) }))
      if (ratio > 0) out.push(makeRect({ x, y: by, width: Math.max(barH, w * ratio), height: barH, bg: p.color || c.stroke, stroke: 'transparent', strokeWidth: 0, rounded: true, radius: radiusOf(node.props, 6) }))
    },
  })

  // ─── chart：柱状 / 折线 / 环形 ─────────────────────
  // props: kind('bar'|'line'|'donut'), data:[{label,value,tone?,color?}] 或 labels:[...] + series:[{name,values,tone?,color?}],
  //        title?, unit?, showValues?(默认 true), max?, h?(绘图区高度), w?
  register('chart', {
    measure(node, maxW) {
      const p = node.props || {}
      const kind = p.kind || 'bar'
      if (!['bar', 'line', 'donut'].includes(kind)) throw new Error('chart.kind 只能是 bar、line 或 donut')
      let labels, series
      if (Array.isArray(p.data)) {
        if (!p.data.length) throw new Error('chart.data 不能为空')
        labels = p.data.map((d) => String(d?.label ?? ''))
        series = [{ name: p.name || '', values: p.data.map((d, i) => num(d?.value, `chart.data[${i}].value`)), colors: p.data.map((d) => d?.color || toColor(d?.tone)?.stroke || null) }]
      } else if (Array.isArray(p.series) && Array.isArray(p.labels)) {
        if (!p.labels.length || !p.series.length) throw new Error('chart.labels / chart.series 不能为空')
        labels = p.labels.map(String)
        series = p.series.map((s, si) => {
          const values = (s?.values || []).map((v, i) => num(v, `chart.series[${si}].values[${i}]`))
          if (values.length !== labels.length) throw new Error(`chart.series[${si}].values 数量必须与 labels 一致`)
          return { name: String(s?.name ?? ''), values, color: s?.color || toColor(s?.tone)?.stroke || null }
        })
      } else {
        throw new Error('chart 需要 data，或 labels + series')
      }
      if (kind === 'donut') {
        if (series.length !== 1) throw new Error('donut 只支持一组数据')
        if (series[0].values.some((v) => v < 0)) throw new Error('donut 的数值不能为负')
        if (!(series[0].values.reduce((s, v) => s + v, 0) > 0)) throw new Error('donut 的数值总和必须大于 0')
      }
      const w = maxW != null ? maxW : (p.w || (kind === 'donut' ? 360 : 420))
      const title = p.title ? block(p.title, 16, w) : null
      const legend = series.length > 1 && kind !== 'donut'
      node._c = { kind, labels, series, title, legend, w }
      if (kind === 'donut') {
        const d = Math.min(p.h ?? 160, Math.max(100, w * 0.45))
        const rows = labels.map((l, i) => block(`${l}  ${fmt(series[0].values[i])}${p.unit || ''}`, 13, w - d - 48))
        node._c.d = d; node._c.rows = rows
        const legendH = rows.reduce((s, r) => s + r.m.height + 8, 0)
        return { w, h: (title ? title.m.height + 14 : 0) + Math.max(d, legendH) }
      }
      const colW = (w - 8) / labels.length
      // 列太窄放不下分类名时隔几列显示一个（常见图表做法），避免标签互相挤压、越出图表。
      const every = Math.max(1, Math.ceil(72 / colW))
      // 首尾标签会被夹回图表边界内，宽度要给这段位移留余量，否则会和相邻标签相撞。
      const spacing = colW * every
      const labelW = Math.max(24, Math.min(spacing - 6, (spacing + colW / 2) / 1.5 - 4))
      const cats = labels.map((l, i) => (i % every === 0 ? block(l, 12, labelW) : null))
      const catH = Math.max(...cats.filter(Boolean).map((c) => c.m.height))
      node._c.cats = cats; node._c.catH = catH; node._c.plotH = p.h ?? 180
      const legendH = legend ? 22 : 0
      return { w, h: (title ? title.m.height + 14 : 0) + legendH + node._c.plotH + 10 + catH }
    },
    place(node, x, y, w, out) {
      const p = node.props || {}
      const c = node._c
      let cy = y
      if (c.title) { out.push(makeText({ x, y: cy, text: c.title.wrapped, fontSize: 16, color: DIAGRAM_THEME.text, align: 'left', metrics: c.title.m })); cy += c.title.m.height + 14 }
      // 单组柱/线默认同一种颜色（逐项 tone/color 可单独强调）；环形图按切片轮换；多组按系列轮换。
      const colorOf = (si, i) => c.series[si].colors?.[i] || c.series[si].color || SERIES[(c.kind === 'donut' ? i : si) % SERIES.length].stroke

      if (c.kind === 'donut') {
        const values = c.series[0].values
        const total = values.reduce((s, v) => s + v, 0)
        const d = c.d, r = d / 2, ring = Math.max(14, d * 0.18)
        const ox = x + r, oy = cy + r
        let a0 = -Math.PI / 2
        values.forEach((v, i) => {
          const sweep = (v / total) * Math.PI * 2
          if (sweep <= 0) return
          const gap = values.filter((x) => x > 0).length > 1 ? Math.min(0.04, sweep / 4) : 0
          const s = a0 + gap / 2, e = a0 + sweep - gap / 2
          // 扇环用封闭多边形填充（外弧 → 内弧），边缘清晰，小切片也不会被线帽撑成圆点。
          const n = Math.max(2, Math.ceil((e - s) / (Math.PI / 36)))
          const arc = (rad, from, to) => Array.from({ length: n + 1 }, (_, k) => { const a = from + (to - from) * (k / n); return [ox + rad * Math.cos(a), oy + rad * Math.sin(a)] })
          const pts = [...arc(r, s, e), ...arc(r - ring, e, s)]
          pts.push(pts[0])
          const col = colorOf(0, i)
          const sector = makeLine({ x: pts[0][0], y: pts[0][1], points: pts.map(([px, py]) => [px - pts[0][0], py - pts[0][1]]), stroke: col, strokeWidth: 1 })
          sector.backgroundColor = col
          sector.fillStyle = 'solid'
          sector.roundness = null
          sector.polygon = true
          out.push(sector)
          a0 += sweep
        })
        const centerTxt = p.centerText != null ? String(p.centerText) : `${fmt(total)}${p.unit || ''}`
        // 中心文字缩到内圈里：可用宽度取内圆直径的 80%，字号最小 12
        const hole = (r - ring) * 2 * 0.8
        let cfs = Math.round(d * 0.14)
        let cm = measureTextBlock(centerTxt, cfs)
        while (cm.width > hole && cfs > 12) { cfs -= 1; cm = measureTextBlock(centerTxt, cfs) }
        let centerWrapped = centerTxt
        if (cm.width > hole) { centerWrapped = wrapTextToWidth(centerTxt, hole, cfs); cm = measureTextBlock(centerWrapped, cfs) }
        out.push(makeText({ x: ox - cm.width / 2, y: oy - cm.height / 2, text: centerWrapped, fontSize: cfs, color: DIAGRAM_THEME.text, align: 'center', metrics: cm }))
        let ly = cy + Math.max(0, (d - c.rows.reduce((s, row) => s + row.m.height + 8, -8)) / 2)
        c.rows.forEach((row, i) => {
          const lx = x + d + 28
          out.push(makeRect({ x: lx, y: ly + row.m.height / 2 - 5, width: 10, height: 10, bg: colorOf(0, i), stroke: 'transparent', strokeWidth: 0, rounded: true, radius: 3 }))
          out.push(makeText({ x: lx + 18, y: ly, text: row.wrapped, fontSize: 13, color: DIAGRAM_THEME.text, align: 'left', metrics: row.m }))
          ly += row.m.height + 8
        })
        return
      }

      if (c.legend) {
        let lx = x
        c.series.forEach((s, si) => {
          const m = measureTextBlock(s.name, 12)
          out.push(makeRect({ x: lx, y: cy + 3, width: 10, height: 10, bg: colorOf(si), stroke: 'transparent', strokeWidth: 0, rounded: true, radius: 3 }))
          out.push(makeText({ x: lx + 16, y: cy, text: s.name, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: m }))
          lx += 16 + m.width + 18
        })
        cy += 22
      }
      const all = c.series.flatMap((s) => s.values)
      const hi = Math.max(p.max != null ? num(p.max, 'chart.max') : -Infinity, ...all, 0)
      const lo = Math.min(0, ...all)
      const span = hi - lo || 1
      const plotH = c.plotH, valueH = p.showValues === false ? 0 : 18
      const lowPad = lo < 0 && p.showValues !== false ? 18 : 0 // 负数柱的数值标签放在柱下方，预留空间避免压到分类名
      const yOf = (v) => cy + valueH + (plotH - valueH - lowPad) * (1 - (v - lo) / span)
      const base = yOf(0)
      const colW = (w - 8) / c.labels.length
      for (const t of [0.5, 1]) {
        const gy = yOf(lo + span * t)
        out.push(makeLine({ x, y: gy, points: [[0, 0], [w, 0]], stroke: '#e8edf3', strokeWidth: 1, dashed: true }))
      }
      out.push(makeLine({ x, y: base, points: [[0, 0], [w, 0]], stroke: DIAGRAM_THEME.lifeline, strokeWidth: 1.2 }))
      const showV = p.showValues !== false
      if (c.kind === 'bar') {
        const groupW = Math.min(colW * 0.7, 28 * c.series.length + 16)
        const barW = Math.max(6, (groupW - (c.series.length - 1) * 4) / c.series.length)
        c.labels.forEach((_, i) => {
          const gx = x + 4 + colW * i + (colW - groupW) / 2
          c.series.forEach((s, si) => {
            const v = s.values[i], top = Math.min(yOf(v), base), bh = Math.max(1, Math.abs(yOf(v) - base))
            const bx = gx + si * (barW + 4)
            out.push(makeRect({ x: bx, y: top, width: barW, height: bh, bg: colorOf(si, i), stroke: 'transparent', strokeWidth: 0, rounded: false }))
            if (showV) {
              const vt = `${fmt(v)}${c.series.length === 1 ? (p.unit || '') : ''}`
              const vm = measureTextBlock(vt, 11)
              out.push(makeText({ x: bx + barW / 2 - vm.width / 2, y: (v >= 0 ? top : top + bh) - (v >= 0 ? vm.height + 2 : -2), text: vt, fontSize: 11, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: vm }))
            }
          })
        })
      } else {
        c.series.forEach((s, si) => {
          const pts = s.values.map((v, i) => [x + 4 + colW * i + colW / 2, yOf(v)])
          if (pts.length > 1) {
            const line = makeLine({ x: pts[0][0], y: pts[0][1], points: pts.map(([px, py]) => [px - pts[0][0], py - pts[0][1]]), stroke: colorOf(si), strokeWidth: 2.4 })
            line.roundness = p.smooth === true ? { type: 2 } : null // 默认折线如实连接数据点；smooth:true 才画平滑曲线
            out.push(line)
          }
          pts.forEach(([px, py], i) => {
            out.push(makeEllipse({ x: px - 4, y: py - 4, width: 8, height: 8, bg: '#ffffff', stroke: colorOf(si), strokeWidth: 2 }))
            if (showV && c.series.length === 1) {
              const vt = `${fmt(s.values[i])}${p.unit || ''}`
              const vm = measureTextBlock(vt, 11)
              out.push(makeText({ x: px - vm.width / 2, y: py - vm.height - 6, text: vt, fontSize: 11, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: vm }))
            }
          })
        })
      }
      c.cats.forEach((cat, i) => {
        if (!cat) return
        const tx = Math.min(Math.max(x, x + 4 + colW * i + colW / 2 - cat.m.width / 2), x + w - cat.m.width)
        out.push(makeText({ x: tx, y: cy + plotH + 10, text: cat.wrapped, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: cat.m }))
      })
    },
  })

  // ─── timeline：时间线 ─────────────────────────────
  // props: items:[{time,title,body?,tone?}], direction?('v'|'h'), w?
  register('timeline', {
    measure(node, maxW) {
      const p = node.props || {}
      const items = Array.isArray(p.items) ? p.items : []
      if (!items.length) throw new Error('timeline.items 不能为空')
      const dir = p.direction === 'h' ? 'h' : 'v'
      const w = maxW != null ? maxW : (p.w || (dir === 'h' ? Math.max(480, items.length * 160) : 420))
      if (dir === 'h') {
        const colW = w / items.length
        const cols = items.map((it) => ({ time: block(it?.time, 12, colW - 12), title: block(it?.title, 15, colW - 12), body: it?.body ? block(it.body, 13, colW - 12) : null, tone: it?.tone }))
        const timeH = Math.max(...cols.map((c) => c.time.m.height))
        const textH = Math.max(...cols.map((c) => c.title.m.height + (c.body ? 4 + c.body.m.height : 0)))
        node._t = { dir, cols, colW, timeH }
        return { w, h: timeH + 10 + 14 + 12 + textH }
      }
      const timeW = Math.min(120, Math.max(...items.map((it) => measureTextBlock(String(it?.time ?? ''), 13).width)) + 4)
      const textW = Math.max(60, w - timeW - 40)
      const rows = items.map((it) => {
        const time = block(it?.time, 13, timeW)
        const title = block(it?.title, 15, textW)
        const body = it?.body ? block(it.body, 13, textW) : null
        const h = Math.max(time.m.height, title.m.height + (body ? 4 + body.m.height : 0))
        return { time, title, body, h, tone: it?.tone }
      })
      node._t = { dir, rows, timeW }
      return { w, h: rows.reduce((s, r) => s + r.h, 0) + (rows.length - 1) * 22 }
    },
    place(node, x, y, w, out) {
      const t = node._t
      const dotColor = (tone) => (toColor(tone) || DIAGRAM_THEME.semantics.primary).stroke
      if (t.dir === 'h') {
        const ay = y + t.timeH + 10 + 7
        out.push(makeLine({ x: x + t.colW / 2, y: ay, points: [[0, 0], [w - t.colW, 0]], stroke: DIAGRAM_THEME.lifeline, strokeWidth: 2 }))
        t.cols.forEach((c, i) => {
          const cx = x + t.colW * i + t.colW / 2
          out.push(makeText({ x: cx - c.time.m.width / 2, y, text: c.time.wrapped, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: c.time.m }))
          out.push(makeEllipse({ x: cx - 7, y: ay - 7, width: 14, height: 14, bg: '#ffffff', stroke: dotColor(c.tone), strokeWidth: 3 }))
          let ty = ay + 7 + 12
          out.push(makeText({ x: cx - c.title.m.width / 2, y: ty, text: c.title.wrapped, fontSize: 15, color: DIAGRAM_THEME.text, align: 'center', metrics: c.title.m }))
          ty += c.title.m.height + 4
          if (c.body) out.push(makeText({ x: cx - c.body.m.width / 2, y: ty, text: c.body.wrapped, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: c.body.m }))
        })
        return
      }
      const lineX = x + t.timeW + 20
      const total = t.rows.reduce((s, r) => s + r.h, 0) + (t.rows.length - 1) * 22
      out.push(makeLine({ x: lineX, y: y + 8, points: [[0, 0], [0, Math.max(0, total - 16)]], stroke: DIAGRAM_THEME.lifeline, strokeWidth: 2 }))
      let ry = y
      t.rows.forEach((r) => {
        out.push(makeText({ x: x + t.timeW - r.time.m.width, y: ry + 1, text: r.time.wrapped, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: 'right', metrics: r.time.m }))
        out.push(makeEllipse({ x: lineX - 7, y: ry + 3, width: 14, height: 14, bg: '#ffffff', stroke: dotColor(r.tone), strokeWidth: 3 }))
        out.push(makeText({ x: lineX + 20, y: ry, text: r.title.wrapped, fontSize: 15, color: DIAGRAM_THEME.text, align: 'left', metrics: r.title.m }))
        if (r.body) out.push(makeText({ x: lineX + 20, y: ry + r.title.m.height + 4, text: r.body.wrapped, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: r.body.m }))
        ry += r.h + 22
      })
    },
  })

  // ─── quote：引用 ──────────────────────────────────
  // props: text, author?, tone?, size?(正文字号，默认 18), plain?, w?
  register('quote', {
    measure(node, maxW) {
      const p = node.props || {}
      if (!String(p.text ?? '').trim()) throw new Error('quote.text 不能为空')
      const size = p.size ?? 18
      const w = maxW != null ? maxW : (p.w || 420)
      const pad = p.plain ? 0 : 20
      const inner = w - pad * 2 - 22
      const body = block(p.text, size, inner)
      const author = p.author ? block(`— ${p.author}`, 13, inner) : null
      node._q = { size, pad, body, author }
      return { w, h: pad * 2 + body.m.height + (author ? 10 + author.m.height : 0) }
    },
    place(node, x, y, w, out) {
      const p = node.props || {}
      const { size, pad, body, author } = node._q
      const c = toColor(p.tone) || DIAGRAM_THEME.semantics.primary
      const bg = p.plain ? null : (p.fill || c.bg)
      if (!p.plain) out.push(makeRect({ x, y, width: w, height: node._h, bg, stroke: 'transparent', strokeWidth: 0, rounded: true, radius: radiusOf(node.props, 12) }))
      out.push(makeRect({ x: x + pad, y: y + pad, width: 4, height: node._h - pad * 2, bg: c.stroke, stroke: 'transparent', strokeWidth: 0, rounded: true, radius: 2 }))
      out.push(makeText({ x: x + pad + 22, y: y + pad, text: body.wrapped, fontSize: size, color: DIAGRAM_THEME.text, align: 'left', metrics: body.m, bg }))
      if (author) out.push(makeText({ x: x + pad + 22, y: y + pad + body.m.height + 10, text: author.wrapped, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: author.m, bg }))
    },
  })

  // ─── steps：步骤条 ────────────────────────────────
  // props: items:[string|{title,body?}], current?(当前步骤，0 起；之前的视为完成), direction?('h'|'v'), tone?, w?
  register('steps', {
    measure(node, maxW) {
      const p = node.props || {}
      const items = (Array.isArray(p.items) ? p.items : []).map((it) => (typeof it === 'string' ? { title: it } : (it || {})))
      if (!items.length) throw new Error('steps.items 不能为空')
      if (p.current != null && (!Number.isInteger(p.current) || p.current < 0 || p.current > items.length)) throw new Error('steps.current 必须是 0 到步骤数之间的整数')
      const dir = p.direction === 'v' ? 'v' : 'h'
      const w = maxW != null ? maxW : (p.w || (dir === 'h' ? Math.max(420, items.length * 150) : 360))
      const D = 30
      if (dir === 'h') {
        const colW = w / items.length
        const cols = items.map((it) => ({ title: block(it.title, 14, colW - 12), body: it.body ? block(it.body, 12, colW - 12) : null }))
        const textH = Math.max(...cols.map((c) => c.title.m.height + (c.body ? 4 + c.body.m.height : 0)))
        node._st = { dir, cols, colW, D }
        return { w, h: D + 12 + textH }
      }
      const rows = items.map((it) => {
        const title = block(it.title, 15, w - D - 16)
        const body = it.body ? block(it.body, 13, w - D - 16) : null
        return { title, body, h: Math.max(D, title.m.height + (body ? 4 + body.m.height : 0)) }
      })
      node._st = { dir, rows, D }
      return { w, h: rows.reduce((s, r) => s + r.h, 0) + (rows.length - 1) * 20 }
    },
    place(node, x, y, w, out) {
      const p = node.props || {}
      const s = node._st
      const c = toColor(p.tone) || DIAGRAM_THEME.semantics.primary
      const done = DIAGRAM_THEME.semantics.success
      const current = p.current
      const state = (i) => (current == null ? 'todo' : i < current ? 'done' : i === current ? 'now' : 'todo')
      const dot = (cx, cy, i) => {
        const st = state(i)
        const bg = st === 'done' ? done.stroke : st === 'now' ? c.stroke : '#ffffff'
        const stroke = st === 'done' ? done.stroke : st === 'now' ? c.stroke : DIAGRAM_THEME.lifeline
        out.push(makeEllipse({ x: cx - s.D / 2, y: cy - s.D / 2, width: s.D, height: s.D, bg, stroke, strokeWidth: 2 }))
        const label = st === 'done' ? '✓' : String(i + 1)
        const m = measureTextBlock(label, 13)
        out.push(makeText({ x: cx - m.width / 2, y: cy - m.height / 2, text: label, fontSize: 13, color: st === 'todo' ? DIAGRAM_THEME.textSecondary : '#ffffff', align: 'center', metrics: m, bg }))
      }
      const linkColor = (i) => (state(i + 1) === 'done' || state(i + 1) === 'now' ? done.stroke : DIAGRAM_THEME.lifeline)
      if (s.dir === 'h') {
        const cy = y + s.D / 2
        s.cols.forEach((col, i) => {
          const cx = x + s.colW * i + s.colW / 2
          if (i < s.cols.length - 1) out.push(makeLine({ x: cx + s.D / 2 + 6, y: cy, points: [[0, 0], [s.colW - s.D - 12, 0]], stroke: linkColor(i), strokeWidth: 2 }))
          dot(cx, cy, i)
          let ty = y + s.D + 12
          out.push(makeText({ x: cx - col.title.m.width / 2, y: ty, text: col.title.wrapped, fontSize: 14, color: state(i) === 'todo' ? DIAGRAM_THEME.textSecondary : DIAGRAM_THEME.text, align: 'center', metrics: col.title.m }))
          ty += col.title.m.height + 4
          if (col.body) out.push(makeText({ x: cx - col.body.m.width / 2, y: ty, text: col.body.wrapped, fontSize: 12, color: DIAGRAM_THEME.textSecondary, align: 'center', metrics: col.body.m }))
        })
        return
      }
      let ry = y
      s.rows.forEach((r, i) => {
        const cx = x + s.D / 2, cy = ry + s.D / 2
        if (i < s.rows.length - 1) out.push(makeLine({ x: cx, y: cy + s.D / 2 + 4, points: [[0, 0], [0, r.h + 20 - s.D - 8]], stroke: linkColor(i), strokeWidth: 2 }))
        dot(cx, cy, i)
        const tx = x + s.D + 16
        out.push(makeText({ x: tx, y: ry + Math.max(0, (s.D - r.title.m.height) / 2), text: r.title.wrapped, fontSize: 15, color: state(i) === 'todo' ? DIAGRAM_THEME.textSecondary : DIAGRAM_THEME.text, align: 'left', metrics: r.title.m }))
        if (r.body) out.push(makeText({ x: tx, y: ry + Math.max(0, (s.D - r.title.m.height) / 2) + r.title.m.height + 4, text: r.body.wrapped, fontSize: 13, color: DIAGRAM_THEME.textSecondary, align: 'left', metrics: r.body.m }))
        ry += r.h + 20
      })
    },
  })
}
