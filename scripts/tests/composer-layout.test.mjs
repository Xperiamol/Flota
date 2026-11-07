// Layout regressions for the composer canvas engine (container widths, row fill,
// connector style, CJK line breaking, graph fitting). Run: node --test scripts/tests/composer-layout.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const load = async file => {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { renderComposer } = await load('src/utils/diagrams/composer/index.js')
const { wrapTextToWidth } = await load('src/utils/diagrams/shared.js')

const rects = els => els.filter(e => e.type === 'rectangle')
const widest = els => Math.max(...rects(els).map(r => r.x + r.width)) - Math.min(...rects(els).map(r => r.x))

test('group honors an explicit width instead of shrinking to its content', () => {
  const { elements } = renderComposer({ type: 'group', props: { w: 410, title: '出发前准备' }, children: [{ type: 'card', props: { title: '车票' } }] })
  assert.equal(Math.round(rects(elements)[0].width), 410)
})

test('explicit-width group is not stretched by a parent stack', () => {
  const { elements } = renderComposer({ type: 'stack.v', props: { w: 900 }, children: [{ type: 'group', props: { w: 300, title: 'A' }, children: [{ type: 'card', props: { title: 'x' } }] }] })
  assert.equal(Math.round(rects(elements)[0].width), 300)
})

test('a row of cards fills the available width with equal columns', () => {
  const { elements } = renderComposer({ type: 'stack.v', props: { w: 900 }, children: [{ type: 'stack.h', props: { gap: 20 }, children: [
    { type: 'card', props: { title: '坚果云', body: '国内速度快' } }, { type: 'card', props: { title: '自建 WebDAV' } }, { type: 'card', props: { title: '只用本地' } }] }] })
  const cards = rects(elements)
  assert.equal(cards.length, 3)
  for (const c of cards) assert.ok(Math.abs(c.width - cards[0].width) < 3, 'columns should be equal')
  assert.ok(Math.abs(widest(elements) - 900) < 2, `row should fill 900, got ${widest(elements)}`)
})

test('row fill leaves inline elements and explicit widths alone; justify keeps intrinsic widths', () => {
  const { elements } = renderComposer({ type: 'stack.v', props: { w: 900 }, children: [{ type: 'stack.h', props: { justify: 'center' }, children: [{ type: 'card', props: { title: 'a' } }, { type: 'card', props: { title: 'b' } }] }] })
  assert.ok(widest(elements) < 900, 'justify:center must not stretch children')
})

test('multi-segment connectors are sharp polylines, not smoothed curves', () => {
  const { elements } = renderComposer({ type: 'graph', props: { direction: 'TB', edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }] }, children: ['a', 'b', 'c', 'd'].map(id => ({ type: 'card', props: { id, title: id } })) })
  const arrows = elements.filter(e => e.type === 'arrow')
  assert.ok(arrows.length >= 4)
  for (const a of arrows) if (a.points.length > 2) assert.equal(a.roundness, null)
})

test('Chinese wrapping never starts a line with closing punctuation', () => {
  for (const width of [90, 120, 150, 180, 210]) {
    const lines = wrapTextToWidth('国内速度快，免费额度够个人用，设置最简单。数据完全在自己手里（需要一台服务器）。', width, 14).split('\n')
    for (const line of lines.slice(1)) assert.ok(!/^[，。、；：！？）】》」』]/.test(line), `line starts with punctuation at width ${width}: ${line}`)
    for (const line of lines.slice(0, -1)) assert.ok(!/[（【《「『]$/.test(line), `line ends with an opening bracket at width ${width}: ${line}`)
  }
})

test('an LR graph shrinks its nodes to fit the parent width', () => {
  const { elements } = renderComposer({ type: 'stack.v', props: { w: 840 }, children: [{ type: 'graph', props: { direction: 'LR', edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }] },
    children: ['a', 'b', 'c', 'd'].map(id => ({ type: 'card', props: { id, title: '周六上午 ' + id, body: '西湖环湖骑行 北山街 → 苏堤' } })) }] })
  assert.ok(widest(elements) <= 842, `graph should fit 840, got ${widest(elements)}`)
})
