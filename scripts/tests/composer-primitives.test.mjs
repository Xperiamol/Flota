// Data & narrative primitives of the composer: stat / progress / chart / timeline / quote / steps.
// Checks geometry sanity (finite, inside the node box, text not overlapping), input validation,
// and the documented behaviour of each option. Run: node --test scripts/tests/composer-primitives.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const load = async file => {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { renderComposer } = await load('src/utils/diagrams/composer/index.js')

// Render a single primitive at a known width; returns elements and the node box.
const render = (node, w = 600) => {
  const tree = { type: 'stack.v', props: { w }, children: [node] }
  const { elements, height } = renderComposer(tree, { offsetX: 0, offsetY: 0 })
  return { elements, box: { x: 0, y: 0, w, h: height } }
}
const bounds = e => {
  if (Array.isArray(e.points)) {
    const xs = e.points.map(p => p[0] + e.x), ys = e.points.map(p => p[1] + e.y)
    const pad = (e.strokeWidth || 1) / 2
    return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad }
  }
  return { x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height }
}
const assertSane = (elements, box, label) => {
  assert.ok(elements.length > 0, `${label}: no elements`)
  for (const e of elements) {
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(e[k]), `${label}: ${e.type}.${k} not finite`)
    const b = bounds(e)
    assert.ok(b.x0 >= box.x - 2 && b.x1 <= box.x + box.w + 2, `${label}: ${e.type} '${e.text || ''}' overflows horizontally (${b.x0.toFixed(1)}..${b.x1.toFixed(1)} of ${box.w})`)
    assert.ok(b.y0 >= box.y - 2 && b.y1 <= box.y + box.h + 2, `${label}: ${e.type} '${e.text || ''}' overflows vertically (${b.y0.toFixed(1)}..${b.y1.toFixed(1)} of ${box.h})`)
  }
  const texts = elements.filter(e => e.type === 'text')
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = bounds(texts[i]), b = bounds(texts[j])
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
    assert.ok(!(ox > 2 && oy > 2), `${label}: text '${texts[i].text}' overlaps '${texts[j].text}'`)
  }
}

const CASES = {
  'stat basic': { type: 'stat', props: { value: '6', unit: '本', label: '读完的书', delta: '+2', trend: 'up', tone: 'primary' } },
  'stat plain centered big': { type: 'stat', props: { value: '99.9%', label: '可用性', plain: true, align: 'center', size: 64 } },
  'stat long label': { type: 'stat', props: { value: '1,284', label: '这是一段很长很长的说明文字，用来检查标签在窄卡片里能否正常换行而不溢出', delta: '持平', trend: 'flat' } },
  'progress percent': { type: 'progress', props: { label: '深度工作', value: 65 } },
  'progress over max clamps': { type: 'progress', props: { label: '超额完成', value: 130, max: 100 } },
  'progress zero, custom text': { type: 'progress', props: { label: '运动', value: 0, valueText: '还没开始', tone: 'warning' } },
  'bar single': { type: 'chart', props: { kind: 'bar', title: '每月', unit: '本', data: [{ label: '7月', value: 3 }, { label: '8月', value: 5 }, { label: '9月', value: 4, tone: 'success' }] } },
  'bar many long labels': { type: 'chart', props: { kind: 'bar', data: Array.from({ length: 12 }, (_, i) => ({ label: `第 ${i + 1} 个很长的分类名字`, value: (i * 7) % 11 })) } },
  'bar negative': { type: 'chart', props: { kind: 'bar', unit: 'k', data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: -4 }, { label: 'Q3', value: 8 }] } },
  'bar multi series': { type: 'chart', props: { kind: 'bar', labels: ['A', 'B', 'C'], series: [{ name: '去年', values: [3, 4, 5] }, { name: '今年', values: [4, 6, 2] }] } },
  'line single': { type: 'chart', props: { kind: 'line', data: [{ label: '一', value: 3 }, { label: '二', value: 9 }, { label: '三', value: 1 }] } },
  'line multi + smooth': { type: 'chart', props: { kind: 'line', smooth: true, labels: ['一', '二', '三', '四'], series: [{ name: 'a', values: [1, 2, 3, 4] }, { name: 'b', values: [4, 3, 2, 1] }] } },
  'donut': { type: 'chart', props: { kind: 'donut', unit: 'h', data: [{ label: '工作', value: 32 }, { label: '阅读', value: 8 }, { label: '杂事', value: 1 }] } },
  'donut single slice': { type: 'chart', props: { kind: 'donut', data: [{ label: '全部', value: 5 }] } },
  'timeline vertical': { type: 'timeline', props: { items: [{ time: '2026-11-07', title: '4.5.4', body: '窄窗口适配' }, { time: '2026-10-29', title: '4.5.0', body: 'AI 技能渐进加载、历史版本，还有一段比较长的描述用来测试换行' }] } },
  'timeline horizontal': { type: 'timeline', props: { direction: 'h', items: [{ time: 'Q1', title: '调研' }, { time: 'Q2', title: '开发', body: '核心功能' }, { time: 'Q3', title: '发布' }] } },
  'quote': { type: 'quote', props: { text: '先看清约束，再谈选择。', author: '《置身事内》' } },
  'quote long plain': { type: 'quote', props: { plain: true, text: '很长很长的一段引用，用来测试换行是否正常，以及标点符号会不会出现在行首，比如这里的逗号，还有句号。'.repeat(2) } },
  'steps horizontal': { type: 'steps', props: { items: ['设计', '开发', { title: '测试', body: '回归 + 验收' }, '发布'], current: 1 } },
  'steps vertical all done': { type: 'steps', props: { direction: 'v', items: [{ title: '下载', body: '四个平台' }, '导入', '开始写'], current: 3 } },
}

for (const [label, node] of Object.entries(CASES)) {
  for (const w of [320, 600, 900]) {
    test(`${label} @${w}px renders inside its box without overlapping text`, () => {
      const { elements, box } = render(JSON.parse(JSON.stringify(node)), w)
      assertSane(elements, box, `${label}@${w}`)
    })
  }
}

test('invalid input is rejected so the model can repair it', () => {
  for (const node of [
    { type: 'stat', props: {} },
    { type: 'progress', props: { value: 'abc' } },
    { type: 'progress', props: { value: 3, max: 0 } },
    { type: 'chart', props: { kind: 'pie', data: [{ label: 'a', value: 1 }] } },
    { type: 'chart', props: { kind: 'bar', data: [] } },
    { type: 'chart', props: { kind: 'bar' } },
    { type: 'chart', props: { kind: 'bar', data: [{ label: 'a', value: 'x' }] } },
    { type: 'chart', props: { kind: 'line', labels: ['a', 'b'], series: [{ name: 's', values: [1] }] } },
    { type: 'chart', props: { kind: 'donut', data: [{ label: 'a', value: -1 }, { label: 'b', value: 2 }] } },
    { type: 'chart', props: { kind: 'donut', data: [{ label: 'a', value: 0 }] } },
    { type: 'chart', props: { kind: 'donut', labels: ['a'], series: [{ values: [1] }, { values: [2] }] } },
    { type: 'timeline', props: { items: [] } },
    { type: 'quote', props: { text: '   ' } },
    { type: 'steps', props: { items: [] } },
    { type: 'steps', props: { items: ['a', 'b'], current: 5 } },
    { type: 'steps', props: { items: ['a', 'b'], current: 1.5 } },
  ]) assert.throws(() => render(node), undefined, JSON.stringify(node))
})

test('numeric strings from the model are accepted as numbers', () => {
  const { elements } = render({ type: 'chart', props: { kind: 'bar', data: [{ label: 'a', value: '3' }, { label: 'b', value: '4.5' }] } })
  assert.equal(elements.filter(e => e.type === 'rectangle' && e.height > 2).length, 2)
})

test('single-series bars share one colour; an item tone overrides it', () => {
  const { elements } = render({ type: 'chart', props: { kind: 'bar', showValues: false, data: [{ label: 'a', value: 3 }, { label: 'b', value: 5 }, { label: 'c', value: 4, tone: 'success' }] } })
  const bars = elements.filter(e => e.type === 'rectangle').map(e => e.backgroundColor)
  assert.equal(bars.length, 3)
  assert.equal(bars[0], bars[1])
  assert.notEqual(bars[2], bars[0])
})

test('multi-series bars and lines get one colour per series and a legend', () => {
  const { elements } = render({ type: 'chart', props: { kind: 'bar', showValues: false, labels: ['A', 'B'], series: [{ name: '去年', values: [3, 4] }, { name: '今年', values: [4, 6] }] } })
  const fills = elements.filter(e => e.type === 'rectangle' && e.height > 10).map(e => e.backgroundColor)
  assert.equal(new Set(fills).size, 2)
  assert.ok(elements.some(e => e.type === 'text' && e.text === '今年'))
})

test('line charts are straight polylines by default and curved only with smooth:true', () => {
  const series = (smooth) => render({ type: 'chart', props: { kind: 'line', smooth, data: [{ label: 'a', value: 1 }, { label: 'b', value: 5 }, { label: 'c', value: 2 }] } }).elements
    .filter(e => e.type === 'line' && e.points.length === 3)
  assert.equal(series(undefined)[0].roundness, null)
  assert.equal(series(true)[0].roundness?.type, 2)
})

test('donut slices are closed, filled polygons proportional to their values', () => {
  const { elements } = render({ type: 'chart', props: { kind: 'donut', data: [{ label: 'a', value: 3 }, { label: 'b', value: 1 }] } })
  const sectors = elements.filter(e => e.type === 'line' && e.backgroundColor && e.backgroundColor !== 'transparent')
  assert.equal(sectors.length, 2)
  for (const s of sectors) {
    const [first, last] = [s.points[0], s.points[s.points.length - 1]]
    assert.deepEqual(first, last, 'polygon must be closed')
    assert.equal(s.roundness, null)
  }
  const area = s => Math.abs(s.points.reduce((acc, p, i) => { const q = s.points[(i + 1) % s.points.length]; return acc + p[0] * q[1] - q[0] * p[1] }, 0) / 2)
  const ratio = area(sectors[0]) / area(sectors[1])
  assert.ok(ratio > 2.5 && ratio < 3.5, `areas should be ~3:1, got ${ratio.toFixed(2)}`)
  assert.ok(elements.some(e => e.type === 'text' && e.text === '4'), 'centre shows the total')
})

test('progress fill width matches the ratio and is clamped to the track', () => {
  const fill = (value, max) => {
    const rects = render({ type: 'progress', props: { value, max, showValue: false } }, 500).elements.filter(e => e.type === 'rectangle')
    return rects.length > 1 ? rects[1].width / rects[0].width : 0
  }
  assert.ok(Math.abs(fill(25, 100) - 0.25) < 0.01)
  assert.ok(Math.abs(fill(3, 4) - 0.75) < 0.01)
  assert.equal(fill(250, 100), 1)
  assert.equal(fill(0, 100), 0)
})

test('steps mark finished steps with a check and the current step with its number', () => {
  const { elements } = render({ type: 'steps', props: { items: ['a', 'b', 'c', 'd'], current: 2 } })
  const labels = elements.filter(e => e.type === 'text').map(e => e.text)
  assert.equal(labels.filter(t => t === '✓').length, 2)
  assert.ok(labels.includes('3') && labels.includes('4'))
  const dots = elements.filter(e => e.type === 'ellipse')
  assert.equal(dots.length, 4)
  assert.equal(dots[0].backgroundColor, dots[1].backgroundColor, 'done steps share the done colour')
  assert.notEqual(dots[2].backgroundColor, dots[0].backgroundColor, 'current step stands out')
  assert.equal(dots[3].backgroundColor, '#ffffff', 'future steps are hollow')
})

test('stats in a stretched row become equal-width cards', () => {
  const { elements } = renderComposer({ type: 'stack.h', props: { w: 900, gap: 16, justify: 'stretch' }, children: [
    { type: 'stat', props: { value: '6', label: 'a' } }, { type: 'stat', props: { value: '28', label: 'b' } }, { type: 'stat', props: { value: '1.2 万', label: 'c' } }] })
  const cards = elements.filter(e => e.type === 'rectangle')
  assert.equal(cards.length, 3)
  assert.ok(cards.every(c => Math.abs(c.width - cards[0].width) < 3))
})

test('a dashboard mixing every new primitive renders and passes the colour checks', () => {
  const tree = { title: '月报', layout: { type: 'stack.v', w: 860, gap: 20 }, children: [
    { type: 'stack.h', props: { justify: 'stretch', gap: 16 }, children: [{ type: 'stat', props: { value: '6', unit: '本', tone: 'primary' } }, { type: 'stat', props: { value: '28', unit: '天', delta: '-1', trend: 'down' } }] },
    { type: 'progress', props: { label: '年度', value: 42, max: 60, tone: 'success' } },
    { type: 'stack.h', props: { justify: 'stretch', gap: 16, align: 'start' }, children: [
      { type: 'chart', props: { kind: 'donut', data: [{ label: 'a', value: 2 }, { label: 'b', value: 1 }] } },
      { type: 'chart', props: { kind: 'line', data: [{ label: 'a', value: 2 }, { label: 'b', value: 5 }] } }] },
    { type: 'timeline', props: { direction: 'h', items: [{ time: '1', title: 'a' }, { time: '2', title: 'b' }] } },
    { type: 'steps', props: { items: ['a', 'b'], current: 1 } },
    { type: 'quote', props: { text: '记录不是为了记住，而是为了忘记。' } },
  ] }
  const { elements } = renderComposer(tree)
  assert.ok(elements.length > 40)
})

test('fuzz: 300 random canvases mixing old and new primitives never crash or produce invalid geometry', () => {
  let seed = 20261108
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const pick = a => a[Math.floor(rnd() * a.length)]
  const words = ['阅读', '工作', '一个非常非常长而且没有空格的中文标题用来测试换行', 'Flota', 'A very long English label that should wrap nicely', '', '6', '✓ 完成', '（括号）。']
  const tones = [undefined, 'primary', 'success', 'warning', 'danger', 'accent', 'info', 'neutral']
  const n = () => Math.round(rnd() * 1000) / 10
  const leaf = () => {
    const k = Math.floor(rnd() * 12)
    const items = (m) => Array.from({ length: 1 + Math.floor(rnd() * m) }, () => pick(words) || '空')
    switch (k) {
      case 0: return { type: 'stat', props: { value: String(n()), unit: pick(['', '本', '%', 'h']), label: pick(words), delta: rnd() > 0.5 ? '+1' : undefined, trend: pick(['up', 'down', 'flat']), tone: pick(tones), plain: rnd() > 0.7 } }
      case 1: return { type: 'progress', props: { label: pick(words), value: n(), max: rnd() > 0.5 ? 100 : 1 + n(), tone: pick(tones) } }
      case 2: { const m = 1 + Math.floor(rnd() * 14); return { type: 'chart', props: { kind: pick(['bar', 'line']), title: rnd() > 0.5 ? pick(words) : undefined, data: Array.from({ length: m }, () => ({ label: pick(words), value: n() - (rnd() > 0.8 ? 50 : 0) })) } } }
      case 3: { const m = 1 + Math.floor(rnd() * 7); return { type: 'chart', props: { kind: 'donut', data: Array.from({ length: m }, () => ({ label: pick(words), value: 0.1 + n() })) } } }
      case 4: return { type: 'timeline', props: { direction: pick(['v', 'h']), items: items(5).map(t => ({ time: pick(words), title: t, body: rnd() > 0.5 ? pick(words) : undefined })) } }
      case 5: return { type: 'quote', props: { text: pick(words) || '引用', author: rnd() > 0.5 ? pick(words) : undefined, plain: rnd() > 0.5 } }
      case 6: { const it = items(6); return { type: 'steps', props: { direction: pick(['h', 'v']), items: it, current: Math.floor(rnd() * (it.length + 1)) } } }
      case 7: return { type: 'card', props: { title: pick(words), body: pick(words), tone: pick(tones) } }
      case 8: return { type: 'list', props: { items: items(5) } }
      case 9: return { type: 'callout', props: { text: pick(words) || '提示', tone: pick(tones) } }
      case 10: return { type: 'badge', props: { text: pick(words) || 'tag', tone: pick(tones) } }
      default: return { type: 'text', props: { content: pick(words) || '文字' } }
    }
  }
  const container = (depth) => {
    const kids = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => (depth < 2 && rnd() > 0.6 ? container(depth + 1) : leaf()))
    const t = pick(['stack.v', 'stack.h', 'grid', 'group'])
    const props = { gap: Math.floor(rnd() * 30) }
    if (t === 'grid') props.cols = 1 + Math.floor(rnd() * 3)
    if (t === 'stack.h') props.justify = pick([undefined, 'start', 'center', 'between', 'stretch'])
    if (t === 'group') props.title = pick(words)
    if (rnd() > 0.6) props.w = 200 + Math.floor(rnd() * 800)
    return { type: t, props, children: kids }
  }
  for (let i = 0; i < 300; i++) {
    const tree = container(0)
    let result
    try { result = renderComposer(JSON.parse(JSON.stringify(tree))) } catch (e) { assert.fail(`case ${i} threw: ${e.message}\n${JSON.stringify(tree).slice(0, 400)}`) }
    for (const e of result.elements) for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(e[k]), `case ${i}: ${e.type}.${k}`)
    assert.ok(Number.isFinite(result.width) && Number.isFinite(result.height))
  }
})

test('corner radius: nested defaults go from large to small, props.radius overrides, 0 means square', () => {
  const tree = { type: 'group', props: { title: '面板' }, children: [{ type: 'card', props: { title: '卡片' } }, { type: 'badge', props: { text: '标签' } }, { type: 'card', props: { title: '直角', radius: 0 } }, { type: 'card', props: { title: '大圆角', radius: 30 } }] }
  const rects = renderComposer(tree).elements.filter(e => e.type === 'rectangle')
  const values = rects.map(r => r.roundness?.value ?? (r.roundness ? 'default' : 0))
  assert.deepEqual(values, [20, 14, 6, 0, 30])
  const capped = renderComposer({ type: 'card', props: { title: 'x', radius: 999 } }).elements.find(e => e.type === 'rectangle')
  assert.equal(capped.roundness.value, 64)
})

test('stretched children in an unconstrained stack re-wrap to the final width (no half-width text in a full-width box)', () => {
  const tree = { type: 'stack.v', props: { gap: 16 }, children: [
    { type: 'steps', props: { items: ['报到', '领设备', '熟悉代码', '结对', '第一个需求'], current: 2 } },
    { type: 'callout', props: { text: '当前进度：第 3 步「熟悉代码仓库」——重点是把本地环境跑通，遇到权限或依赖问题直接找技术负责人。' } },
    { type: 'list', props: { items: ['拆分工作时段：每 90 分钟设置一次 5 分钟休整，减少无效加班，把深度工作完成率从 65% 提到 80% 以上'] } },
  ] }
  const { elements } = renderComposer(tree)
  const rects = elements.filter(e => e.type === 'rectangle')
  for (const label of ['当前进度', '拆分工作时段']) {
    const t = elements.find(e => e.type === 'text' && e.text.replace(/\n/g, '').startsWith(label))
    const box = rects.filter(r => r.x <= t.x && r.x + r.width >= t.x + t.width && r.y <= t.y && r.y + r.height >= t.y + t.height).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    assert.ok(t.width > box.width * 0.75, `${label}: text ${Math.round(t.width)} in box ${Math.round(box.width)}`)
  }
})

test('stack.h / grid align:"stretch" makes boxed siblings in a row the same height; default keeps natural heights', () => {
  const kids = () => [{ type: 'stat', props: { value: '6', unit: '本', label: '读完', delta: '+2' } }, { type: 'stat', props: { value: '28', unit: '天' } }, { type: 'card', props: { title: '笔记' } }]
  const heights = (tree) => renderComposer(tree).elements.filter(e => e.type === 'rectangle' && e.width > 60).map(e => Math.round(e.height))
  const natural = heights({ type: 'stack.h', props: { gap: 12 }, children: kids() })
  assert.ok(new Set(natural).size > 1)
  for (const tree of [{ type: 'stack.h', props: { gap: 12, align: 'stretch' }, children: kids() }, { type: 'grid', props: { cols: 3, gap: 12, align: 'stretch', w: 720 }, children: kids() }]) {
    const hs = heights(tree)
    assert.equal(new Set(hs).size, 1, `${tree.type}: ${hs}`)
  }
})

test('decor shapes: thin stripes/dots allowed, circles and sized rects are not stretched, negative coords explain why', () => {
  const { elements } = renderComposer({ type: 'stack.v', props: { w: 600 }, children: [
    { type: 'rect', props: { w: 80, h: 3, fill: '#1B7FE3' } },
    { type: 'ellipse', props: { size: 8, fill: '#f59e0b' } },
    { type: 'rect', props: { h: 2, fill: '#ddd' } },
  ] })
  const [stripe, dot, rule] = elements
  assert.equal(Math.round(stripe.width), 80)
  assert.equal(Math.round(stripe.height), 3)
  assert.equal(Math.round(dot.width), 8)
  assert.equal(Math.round(rule.width), 600)
  assert.throws(() => renderComposer({ type: 'card', props: { title: 'x', w: 8 } }), /不能小于 16/)
  assert.throws(() => renderComposer({ type: 'canvas', props: { w: 400, h: 300 }, children: [{ type: 'ellipse', props: { x: -20, y: 0, size: 60 } }] }), /不能为负.*无法裁切/)
})

test('icon symbol must be an emoji or symbol, not an English name', () => {
  assert.throws(() => renderComposer({ type: 'icon', props: { symbol: 'bike' } }), /emoji/)
  assert.doesNotThrow(() => renderComposer({ type: 'icon', props: { symbol: '🚲' } }))
  assert.doesNotThrow(() => renderComposer({ type: 'icon', props: { symbol: 'A' } }))
})
