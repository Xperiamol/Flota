// Layout primitives of the composer canvas engine: explicit container widths, opt-in row
// stretch, connector corner style, CJK line breaking. The model decides layout; these only
// check that each primitive does what it says. Run: node --test scripts/tests/composer-layout.test.mjs
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

test('justify:stretch makes a row of cards fill the width with equal columns', () => {
  const { elements } = renderComposer({ type: 'stack.v', props: { w: 900 }, children: [{ type: 'stack.h', props: { gap: 20, justify: 'stretch' }, children: [
    { type: 'card', props: { title: '坚果云', body: '国内速度快' } }, { type: 'card', props: { title: '自建 WebDAV' } }, { type: 'card', props: { title: '只用本地' } }] }] })
  const cards = rects(elements)
  assert.equal(cards.length, 3)
  for (const c of cards) assert.ok(Math.abs(c.width - cards[0].width) < 3, 'columns should be equal')
  assert.ok(Math.abs(widest(elements) - 900) < 2, `row should fill 900, got ${widest(elements)}`)
})

test('without justify:stretch a row keeps the widths the model chose', () => {
  for (const justify of [undefined, 'start', 'center', 'between']) {
    const { elements } = renderComposer({ type: 'stack.v', props: { w: 900 }, children: [{ type: 'stack.h', props: { justify }, children: [{ type: 'card', props: { title: 'a' } }, { type: 'card', props: { title: 'b', w: 200 } }] }] })
    const cards = rects(elements)
    assert.ok(cards.every(c => c.width <= 260), `justify:${justify} must not stretch children`)
  }
})

test('connectors are right-angle polylines unless the model asks for curve:true', () => {
  const tree = curve => ({ type: 'graph', props: { direction: 'TB', edges: [{ from: 'a', to: 'b', curve }, { from: 'a', to: 'c', curve }, { from: 'b', to: 'd', curve }, { from: 'c', to: 'd', curve }] }, children: ['a', 'b', 'c', 'd'].map(id => ({ type: 'card', props: { id, title: id } })) })
  const sharp = renderComposer(tree(undefined)).elements.filter(e => e.type === 'arrow')
  assert.ok(sharp.length >= 4 && sharp.every(a => a.roundness === null))
  const curved = renderComposer(tree(true)).elements.filter(e => e.type === 'arrow')
  assert.ok(curved.every(a => a.roundness?.type === 2))
  const top = renderComposer({ children: [{ type: 'card', props: { id: 'x', title: 'x' } }, { type: 'card', props: { id: 'y', title: 'y' } }], connectors: [{ from: 'x', to: 'y', curve: true }] }).elements.filter(e => e.type === 'arrow')
  assert.equal(top[0].roundness?.type, 2)
})

test('Chinese wrapping never starts a line with closing punctuation', () => {
  for (const width of [90, 120, 150, 180, 210]) {
    const lines = wrapTextToWidth('国内速度快，免费额度够个人用，设置最简单。数据完全在自己手里（需要一台服务器）。', width, 14).split('\n')
    for (const line of lines.slice(1)) assert.ok(!/^[，。、；：！？）】》」』]/.test(line), `line starts with punctuation at width ${width}: ${line}`)
    for (const line of lines.slice(0, -1)) assert.ok(!/[（【《「『]$/.test(line), `line ends with an opening bracket at width ${width}: ${line}`)
  }
})
