import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const load = async file => {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { renderComposer } = await load('src/utils/diagrams/composer/index.js')
const { applyScenePatch } = await load('src/utils/diagrams/editScene.js')
const { createGenerationTask } = await load('src/utils/aiCore/generationTask.js')

test('Composer rejects invalid dimensions, node types and dangling connections', () => {
  for (const tree of [
    { type: 'card', props: { w: 'auto' } },
    { type: 'not-supported' },
    { children: [{ type: 'card', props: { id: 'a' } }], connectors: [{ from: 'a', to: 'missing' }] },
    { children: [{ type: 'card', props: { id: 'a' } }, { type: 'card', props: { id: 'a' } }] },
    { type: 'grid', props: { cols: 2.5 } },
  ]) assert.throws(() => renderComposer(tree))
})

test('long Chinese table cells wrap within their measured columns and increase row height', () => {
  const result = renderComposer({ type: 'table', props: { w: 480, headers: ['标题', '内容'], rows: [['项目计划', '这是需要在狭窄列宽中完整显示并且不能覆盖下一行的中文内容。'.repeat(4)], ['进度', '完成']] } })
  const texts = result.elements.filter(element => element.type === 'text')
  assert.ok(texts.some(element => element.text.includes('\n')))
  const last = texts.find(element => element.text === '完成')
  const long = texts.find(element => element.text.includes('狭窄'))
  assert.ok(last.y > long.y + long.height)
  for (const element of result.elements) {
    assert.ok(Number.isFinite(element.x) && Number.isFinite(element.height))
    assert.ok(element.x + element.width <= 582, 'table does not overflow its 480px width')
  }
})

test('free layout honors coordinates and typography and reports unintended overlaps', () => {
  const tree = { type: 'canvas', props: { w: 900 }, children: [
    { type: 'text', props: { x: 0, y: 0, w: 400, fontSize: 60, content: '清晰的层级' } },
    { type: 'card', props: { x: 500, y: 120, w: 300, title: '重点', body: '可编辑内容' } },
  ] }
  const result = renderComposer(tree)
  assert.ok(result.elements.some(element => element.fontSize === 60))
  assert.ok(result.elements.some(element => element.x === 600 && element.y === 220))
  tree.children[1].props.x = 0
  tree.children[1].props.y = 0
  assert.throws(() => renderComposer(tree), /重叠/)
})

test('local edits preserve unrelated element identity, file references and source objects', () => {
  const target = { id: 'a', type: 'text', text: '原文', originalText: '原文', x: 10, y: 10, width: 200, height: 20, fontSize: 16, version: 2 }
  const untouched = { id: 'b', type: 'image', fileId: 'existing-image', x: 400, y: 10, width: 200, height: 200 }
  const result = applyScenePatch([target, untouched], { updates: [{ id: 'a', changes: { text: '新的中文标题' } }], remove: [] })
  assert.equal(target.text, '原文')
  assert.equal(result.elements[0].id, target.id)
  assert.equal(result.elements[0].version, 3)
  assert.equal(result.elements[1], untouched)
  assert.deepEqual(result.files, {})
  assert.throws(() => applyScenePatch([target, untouched], { updates: [{ id: 'b', changes: { x: 20 } }], remove: [] }, ['a']), /未选中/)
  assert.throws(() => applyScenePatch([target], { updates: [{ id: 'a', changes: { id: 'evil' } }], remove: [] }), /字段/)
})

let widgetSource = await readFile(new URL('../../src/utils/widgets/widgetGeneration.js', import.meta.url), 'utf8')
widgetSource = widgetSource.replace(/^import .*$/m, 'const probeWidget = (...args) => globalThis.__probeWidget(...args); const collectProblems = result => result.problems')
const { runWidgetGeneration } = await import(`data:text/javascript;base64,${Buffer.from(widgetSource).toString('base64')}`)
const setupWidget = () => {
  const requests = [], saved = [], discarded = [], cancelled = []
  globalThis.window = { electronAPI: { widgets: {
    onGenerateProgress: () => () => {},
    generate: async (id, payload) => { requests.push(payload); return { success: true, data: { draftId: 'draft', sizes: ['full', 'compact'] } } },
    saveDraft: async id => { saved.push(id); return { success: true, data: { widget: { id: 'widget' } } } },
    discardDraft: async id => { discarded.push(id) },
    cancelGenerate: async id => { cancelled.push(id) },
  } } }
  globalThis.__probeWidget = async () => ({ problems: [] })
  return { requests, saved, discarded, cancelled }
}

test('widget repair keeps original instruction and never publishes a known-broken draft', async () => {
  const state = setupWidget()
  globalThis.__probeWidget = async () => ({ problems: [{ message: '页面溢出' }] })
  await assert.rejects(runWidgetGeneration({ instruction: '做一个编辑风格看板' }), error => /未通过/.test(error.message) && error.draftId === 'draft')
  assert.equal(state.requests.length, 4)
  assert.ok(state.requests.every(request => request.instruction === '做一个编辑风格看板'))
  assert.equal(state.saved.length, 0)
  assert.equal(state.discarded.length, 0, 'failed draft is retained for diagnosis')
})

test('widget repair saves once after every size passes', async () => {
  const state = setupWidget()
  let calls = 0
  globalThis.__probeWidget = async () => ({ problems: ++calls === 1 ? [{ message: 'fix' }] : [] })
  const result = await runWidgetGeneration({ instruction: '看板' })
  assert.equal(result.fixedRounds, 1)
  assert.equal(calls, 8)
  assert.deepEqual(state.saved, ['draft'])
})

test('stopping widget generation exits immediately and discards late IPC draft', async () => {
  const state = setupWidget()
  let finish
  window.electronAPI.widgets.generate = () => new Promise(resolve => { finish = resolve })
  const task = createGenerationTask('widget-stop')
  const pending = runWidgetGeneration({ instruction: '看板', task })
  task.cancel()
  await assert.rejects(pending, { name: 'AbortError' })
  finish({ success: true, data: { draftId: 'late-draft' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.cancelled.length, 1)
  assert.deepEqual(state.discarded, ['late-draft'])
  assert.equal(state.saved.length, 0)
  task.dispose()
})

const serviceSource = await readFile(new URL('../../electron/services/widgets/WidgetService.js', import.meta.url), 'utf8')
const require = createRequire(new URL('../../electron/services/widgets/WidgetService.js', import.meta.url))
const context = { module: { exports: {} }, require: name => name.includes('WidgetDAO') ? class {} : require(name) }
vm.runInNewContext(serviceSource, context)
const WidgetService = context.module.exports

test('stale component drafts cannot overwrite a newer version', () => {
  const service = Object.create(WidgetService.prototype)
  service.getDraft = () => ({ widgetId: 'w', code: 'old', baseVersion: 2 })
  service.dao = { latestVersion: () => 3 }
  service.updateWidgetCode = () => { throw new Error('must not write') }
  assert.throws(() => service.saveDraft('draft'), /新版本/)
})

test('preflight cannot write real notes/todos or start paid AI requests', async () => {
  const service = Object.create(WidgetService.prototype)
  service.resolveContext = () => ({ draft: true })
  for (const method of ['notes.create', 'notes.update', 'todos.create', 'todos.update', 'ai.complete']) {
    await assert.rejects(service.handleRpc('draft', method), /预览期间/)
  }
})

test('moving a bound shape keeps attached text and arrow endpoint connected', () => {
  const shape = { id: 'shape', type: 'rectangle', x: 100, y: 100, width: 100, height: 80 }
  const text = { id: 'text', type: 'text', containerId: 'shape', x: 120, y: 120, width: 60, height: 20, text: '标题' }
  const arrow = { id: 'arrow', type: 'arrow', x: 200, y: 140, width: 100, height: 0, points: [[0, 0], [100, 0]], startBinding: { elementId: 'shape' } }
  const result = applyScenePatch([shape, text, arrow], { updates: [{ id: 'shape', changes: { y: 200 } }], remove: [] })
  assert.equal(result.elements[1].y, 220)
  assert.equal(result.elements[2].y, 240)
  assert.deepEqual(result.elements[2].points.at(-1), [100, -100])
  assert.equal(text.y, 120)
})

const WidgetGenerator = require('./WidgetGenerator')
test('widget format repair is bounded and preserves the design request', async () => {
  const generator = new WidgetGenerator({ widgetService: { listWidgets: () => [] } })
  const calls = []
  generator.complete = async messages => {
    calls.push(structuredClone(messages))
    return calls.length === 1 ? '<html>incomplete' : '<!doctype html><html><head><script type="application/flota-widget">{"name":"阅读计划","sizes":["compact"],"libs":[]}</script></head><body>阅读计划</body></html>'
  }
  const result = await generator.generate({ instruction: '做一张编辑排版的阅读计划', referenceImages: ['data:image/png;base64,aGVsbG8='], requestId: 'format' })
  assert.equal(calls.length, 2)
  assert.ok(calls[1].some(message => Array.isArray(message.content) && message.content[0].text.includes('编辑排版的阅读计划')))
  assert.ok(calls.every(messages => messages.some(message => Array.isArray(message.content) && message.content[1]?.image_url?.url === 'data:image/png;base64,aGVsbG8=')))
  assert.match(result.code, /阅读计划/)
  assert.equal(generator.running.size, 0)
})

test('widget fallback provider receives the same cancellation signal', async () => {
  const controller = new AbortController()
  const generator = new WidgetGenerator({ aiService: { chat: async (messages, options) => {
    assert.equal(options.signal, controller.signal)
    return { success: true, data: { content: 'ok' } }
  } } })
  assert.equal(await generator.complete([], { abortSignal: controller.signal }), 'ok')
})

const { normalizeDiagramColor, ensureReadableTextColor } = await load('src/utils/diagrams/shared.js')
test('native colors normalize RGB and reject unsupported fills instead of silently rendering black', () => {
  assert.equal(normalizeDiagramColor('rgb(15, 23, 42)'), '#0f172a')
  assert.equal(normalizeDiagramColor('rgb(100% 100% 100%)'), '#ffffff')
  assert.equal(normalizeDiagramColor('#abc'), '#aabbcc')
  for (const fill of ['linear-gradient(black, white)', 'var(--surface)', 'rgb(999, 0, 0)', { color: 'black' }]) {
    assert.throws(() => renderComposer({ type: 'card', props: { fill, title: '标题' } }), /颜色/)
  }
  const result = renderComposer({ type: 'card', props: { fill: 'rgb(15, 23, 42)', title: '奖金池', body: '$11,000' } })
  assert.equal(result.elements.find(el => el.type === 'rectangle').backgroundColor, '#0f172a')
  assert.ok(result.elements.filter(el => el.type === 'text').every(el => el.strokeColor === '#ffffff'))
})
test('contrast fallback stays readable even on intermediate luminance backgrounds', () => {
  const luminance = color => {
    const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  for (const bg of ['#0f172a', '#777777', '#999999', '#ffffff', '#008888']) {
    const fg = ensureReadableTextColor(bg, bg)
    const a = luminance(bg), b = luminance(fg)
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${fg} on ${bg}`)
  }
})

const { prepareSceneStyle } = await load('src/utils/diagrams/sceneStyle.js')
test('legacy gradients repair in both styles without moving geometry or recoloring valid scenes', () => {
  const scene = [
    { id: 'banner', type: 'rectangle', x: 3.5, y: 7.2, width: 300, height: 100, backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', roughness: 1 },
    { id: 'title', type: 'text', x: 12.4, y: 23.7, width: 100, height: 20, strokeColor: '#172033', fontFamily: 1 },
    { id: 'valid', type: 'text', x: 500, y: 30, width: 100, height: 20, strokeColor: '#ffffff' },
    { id: 'arrow', type: 'arrow', x: 6.4, y: 8.2, points: [[0, 0], [37.2, 45.3]] },
  ]
  const original = structuredClone(scene)
  for (const mode of ['neat', 'sketchy']) {
    const output = prepareSceneStyle(scene, mode)
    assert.equal(output[0].backgroundColor, '#667eea')
    assert.equal(output[1].strokeColor, ensureReadableTextColor('#172033', '#667eea'))
    assert.equal(output[2].strokeColor, '#ffffff')
    output.forEach((el, i) => { assert.equal(el.x, scene[i].x); assert.equal(el.y, scene[i].y) })
    assert.deepEqual(output[3].points, scene[3].points)
    assert.equal(output[1].fontFamily, mode === 'neat' ? 2 : 1)
    assert.deepEqual(prepareSceneStyle(output, mode), output)
  }
  assert.deepEqual(scene, original)
})

test('generation references stay with the originating user message and reject external URLs', async () => {
  const require = createRequire(import.meta.url)
  const { referencesFromMessages, contentWithReferences } = require('../../electron/services/aiReferences')
  const image = 'data:image/png;base64,aGVsbG8='
  const content = [{ type: 'text', text: '参考这个设计' }, { type: 'image_url', image_url: { url: image } }]
  assert.deepEqual(referencesFromMessages([{ role: 'user', content }]), [image])
  assert.deepEqual(referencesFromMessages([{ role: 'user', content }, { role: 'user', content: '另一个任务' }]), [])
  assert.equal(contentWithReferences('任务', ['https://example.com/image.png', 'file:///private.png']), '任务')
  const oldWindow = globalThis.window
  const calls = []
  globalThis.window = { electronAPI: { ai: { chat: async messages => { calls.push(messages); return { success: true } } } } }
  const task = createGenerationTask('image-reference-test')
  try {
    task.referenceImages = [image]
    const original = [{ role: 'user', content: '生成画布' }]
    await task.chat(original)
    await task.chat([{ role: 'user', content: '修复上一稿' }])
    assert.equal(original.length, 1)
    assert.ok(calls.every(messages => messages.at(-1).content[1].image_url.url === image))
  } finally { task.dispose(); globalThis.window = oldWindow }
})

test('tool summaries omit reference base64 while keeping the persisted action intact', () => {
  const require = createRequire(import.meta.url)
  const { withoutReferencePayload } = require('../../electron/services/aiReferences')
  const original = { actionId: 'a', context: { selectedNoteId: '328', referenceImages: ['data:image/png;base64,aGVsbG8='] } }
  const summary = withoutReferencePayload(original)
  assert.equal(summary.referenceImageCount, 1)
  assert.equal(summary.context.selectedNoteId, '328')
  assert.ok(!JSON.stringify(summary).includes('base64'))
  assert.equal(original.context.referenceImages.length, 1)
})

test('local patch adds a bound node and connector and reroutes without replacing unrelated identities', () => {
  const a = { id: 'a', type: 'rectangle', x: 0, y: 0, width: 120, height: 80 }
  const unrelated = { id: 'elsewhere', type: 'rectangle', x: 900, y: 900, width: 100, height: 60 }
  const original = structuredClone(a)
  const result = applyScenePatch([a, unrelated], {
    updates: [{ id: 'a', changes: { type: 'diamond' } }], remove: [],
    add: [{ id: 'new', type: 'rectangle', x: 300, y: 200, width: 160, height: 80, label: '下一步' }, { id: 'edge', type: 'arrow', from: 'a', to: 'new' }],
  }, ['a']).elements
  assert.equal(result.find(el => el.id === 'elsewhere'), unrelated)
  assert.equal(result.find(el => el.id === 'a').type, 'diamond')
  assert.deepEqual(a, original)
  assert.equal(result.find(el => el.id === 'new-label').containerId, 'new')
  const arrow = result.find(el => el.id === 'edge')
  assert.equal(arrow.startBinding.elementId, 'a')
  assert.equal(arrow.endBinding.elementId, 'new')
  assert.ok(arrow.points.length >= 2)
  assert.ok(arrow.points.flat().every(Number.isFinite))
  assert.ok(result.find(el => el.id === 'a').boundElements.some(ref => ref.id === 'edge'))
  for (let i = 1; i < arrow.points.length; i++) assert.ok(arrow.points[i][0] === arrow.points[i-1][0] || arrow.points[i][1] === arrow.points[i-1][1])
})

test('rerouting preserves arrow and bound label IDs and validates local scope atomically', () => {
  const scene = [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 120, height: 80 },
    { id: 'b', type: 'rectangle', x: 400, y: 200, width: 120, height: 80 },
    { id: 'e', type: 'arrow', x: 120, y: 40, points: [[0, 0], [280, 200]], startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } },
    { id: 'label', type: 'text', containerId: 'e', x: 600, y: 600, width: 40, height: 20 },
  ]
  const original = structuredClone(scene)
  const next = applyScenePatch(scene, { updates: [], remove: [], reroute: ['e'] }, ['a']).elements
  assert.deepEqual(next.map(el => el.id), scene.map(el => el.id))
  assert.notEqual(next[3].x, scene[3].x)
  assert.deepEqual(scene, original)
  assert.throws(() => applyScenePatch(scene, { updates: [], remove: [], reroute: ['e'] }, ['label']))
  assert.throws(() => applyScenePatch(scene, { updates: [], remove: [], add: [{ id: 'e', type: 'arrow', from: 'a', to: 'b' }] }))
  assert.throws(() => applyScenePatch(scene, { updates: [], remove: [], add: [{ id: 'newedge', type: 'arrow', from: 'a', to: 'b' }] }, ['a']))
  assert.throws(() => applyScenePatch(scene, { updates: [{ id: 'e', changes: { type: 'diamond' } }], remove: [] }))
  assert.deepEqual(scene, original)
})
