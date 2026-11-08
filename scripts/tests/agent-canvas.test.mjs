import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

// agentCanvas 在渲染进程运行；这里把依赖 DOM 的 Mermaid / SVG 解析换成桩，其余（原语引擎、局部修改）用真实代码
const stubs = { name: 'stubs', setup(b) {
  b.onResolve({ filter: /\/mermaidNative$/ }, () => ({ path: 'mermaid', namespace: 'stub' }))
  b.onResolve({ filter: /\/svgAsset$/ }, () => ({ path: 'svg', namespace: 'stub' }))
  b.onLoad({ filter: /^mermaid$/, namespace: 'stub' }, () => ({ contents: `export const renderMermaidNative = async (code) => { if (!/^sequenceDiagram/.test(code)) throw new Error('Parse error on line 1'); return { elements: [{ id: 'm1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }], files: {} } }` }))
  b.onLoad({ filter: /^svg$/, namespace: 'stub' }, () => ({ contents: `
    export const createSvgAsset = (src, o = {}) => { if (!/<svg[\\s\\S]*<\\/svg>\\s*$/.test(src)) throw new Error('SVG 标签未闭合'); return { elements: [{ id: 'img', type: 'image', x: 0, y: 0, width: 200, height: 100, fileId: 'f1', customData: { kind: 'svg-image', svgSource: src } }], files: { f1: { id: 'f1' } } } }
    export const createSvgDataURL = () => ''` }))
} }
const out = await build({ entryPoints: ['src/utils/diagrams/agentCanvas.js'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [stubs], external: ['@excalidraw/excalidraw'] })
const { readCanvasSpec, renderCanvasSpec, summarizeRendered } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)

const tree = { title: '月报', layout: { type: 'stack.v', gap: 24 }, children: [{ type: 'stat', props: { value: '6', unit: '本', label: '读完' } }, { type: 'chart', props: { kind: 'bar', data: [{ label: '7月', value: 3 }, { label: '8月', value: 5 }] } }] }

test('readCanvasSpec accepts objects or JSON strings, rejects mixed or broken input, and is null for old prompt-only cards', () => {
  assert.equal(readCanvasSpec({ prompt: '画个图' }), null)
  assert.deepEqual(readCanvasSpec({ canvas: tree }).canvas, tree)
  assert.deepEqual(readCanvasSpec({ canvas: JSON.stringify(tree) }).canvas, tree)
  assert.throws(() => readCanvasSpec({ canvas: '{"children":[' }), /canvas 不是合法 JSON/)
  assert.throws(() => readCanvasSpec({ canvas: tree, mermaid: 'sequenceDiagram' }), /一次只能给一种/)
})

test('canvas trees render directly with no model call; the same args can be rendered twice (check, then commit)', async () => {
  const args = { canvas: tree }
  const first = await renderCanvasSpec(readCanvasSpec(args))
  const second = await renderCanvasSpec(readCanvasSpec(args))
  assert.ok(first.elements.length > 5)
  assert.equal(first.elements.length, second.elements.length)
  assert.equal(JSON.stringify(args.canvas), JSON.stringify(tree), 'input is not mutated')
  const s = summarizeRendered(first.elements)
  assert.ok(s.width > 0 && s.height > 0 && s.types.text > 0)
})

test('engine errors come back verbatim so the agent can fix them', async () => {
  await assert.rejects(renderCanvasSpec(readCanvasSpec({ canvas: { children: [{ type: 'sparkline', props: {} }] } })), /不支持的画布节点：sparkline/)
  await assert.rejects(renderCanvasSpec(readCanvasSpec({ canvas: { children: [{ type: 'stat', props: { value: '1', size: 'lg' } }] } })), /stat\.size .*收到 "lg"/)
  await assert.rejects(renderCanvasSpec(readCanvasSpec({ mermaid: 'graph oops' })), /Mermaid 渲染失败：Parse error/)
})

test('svg nodes use the agent-written source; missing source, broken svg, or SVG turned off are rejected', async () => {
  const svgTree = (props) => ({ children: [{ type: 'svg', props }, { type: 'card', props: { title: 'x' } }] })
  const ok = await renderCanvasSpec(readCanvasSpec({ canvas: svgTree({ source: '<svg viewBox="0 0 10 10"></svg>' }) }))
  assert.ok(ok.elements.some((e) => e.type === 'image'))
  assert.ok(ok.files.f1)
  await assert.rejects(renderCanvasSpec(readCanvasSpec({ canvas: svgTree({ prompt: '插画' }) })), /缺少 props\.source/)
  await assert.rejects(renderCanvasSpec(readCanvasSpec({ canvas: svgTree({ source: '<svg>' }) })), /SVG 标签未闭合/)
  await assert.rejects(renderCanvasSpec(readCanvasSpec({ canvas: svgTree({ source: '<svg></svg>' }) }), { allowSvg: false }), /关闭 AI 绘制 SVG/)
})

test('append places new content to the right of existing elements; patch edits by id and returns the whole scene', async () => {
  const existing = [{ id: 'a', type: 'text', x: 100, y: 100, width: 300, height: 40, text: '旧标题', originalText: '旧标题', fontSize: 20, version: 1 }]
  const appended = await renderCanvasSpec(readCanvasSpec({ canvas: tree }), { existingElements: existing, append: true })
  assert.ok(Math.min(...appended.elements.map((e) => e.x)) >= 400)
  assert.equal(appended.replacesAll, false)
  const patched = await renderCanvasSpec(readCanvasSpec({ patch: { updates: [{ id: 'a', changes: { text: '新标题' } }], remove: [] } }), { existingElements: existing })
  assert.equal(patched.replacesAll, true)
  assert.equal(patched.elements[0].text, '新标题')
  await assert.rejects(renderCanvasSpec(readCanvasSpec({ patch: { updates: [{ id: 'nope', changes: { text: 'x' } }], remove: [] } }), { existingElements: existing }), /未知或未选中的元素：nope/)
})

test('canvas proposals: a failed render returns the error and creates no card; a passing render creates the card with size info and a preview image for the model only', async () => {
  const AIChatService = require('../../electron/services/aichat/index.js')
  const Svc = AIChatService.AIChatService || AIChatService
  const svc = Object.create(Svc.prototype)
  svc.logger = { warn() {} }
  svc.aiService = { getConfig: async () => ({ data: { visionEnabled: true } }) }
  const created = []
  svc._pendingActions = { create: async (name, args, context) => { created.push(name); return { success: true, requiresConfirmation: true, actionId: 'x1', name, args } } }
  let reply = { ok: false, error: '不支持的画布节点：sparkline' }
  let seen
  svc._canvasChecker = async (payload) => { seen = payload; return reply }
  const bad = await svc._proposeCanvas('create_whiteboard', { title: 't', canvas: {} }, null)
  assert.equal(bad.success, false)
  assert.match(bad.error, /没有通过渲染检查：不支持的画布节点：sparkline。请修正后重新调用/)
  assert.equal(created.length, 0)
  assert.equal(seen.wantImage, true)

  reply = { ok: true, summary: { mode: 'replace', elements: 12, width: 900, height: 600 }, image: 'data:image/png;base64,iVBORw0KGgo=' }
  const good = await svc._proposeCanvas('create_whiteboard', { title: 't', canvas: {} }, null)
  assert.equal(created.length, 1)
  assert.equal(good.rendered.elements, 12)
  assert.ok(good.preview_image)

  const { toToolOutput } = require('../../electron/services/aichat/agent/runChat.js')
  const output = toToolOutput(JSON.stringify(good))
  assert.ok(!output.publicResult.includes('base64'), 'image is not stored in the conversation')
  assert.equal(output.content.filter((part) => part.type === 'image').length, 1, 'model receives the image')
})

test('read_whiteboard lists element ids, text and bounds; rejects non-canvas notes', async () => {
  const { read_whiteboard } = require('../../electron/services/aichat/tools/handlers/canvas.js')
  const notes = {
    5: { id: 5, title: '图', note_type: 'whiteboard', content: JSON.stringify({ elements: [{ id: 'r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, backgroundColor: '#fff' }, { id: 't', type: 'text', x: 20, y: 30, width: 40, height: 20, text: '你好', containerId: 'r' }, { id: 'gone', type: 'text', isDeleted: true }] }) },
    6: { id: 6, title: '文', note_type: 'markdown', content: '# hi' },
  }
  const services = { noteDAO: { findById: (id) => notes[id] || null } }
  const r = JSON.parse(await read_whiteboard({ note_id: 5 }, {}, services))
  assert.equal(r.element_count, 2)
  assert.deepEqual(r.bounds, { x: 10, y: 20, right: 110, bottom: 70 })
  assert.equal(r.elements[1].text, '你好')
  assert.equal(r.elements[1].containerId, 'r')
  assert.match(JSON.parse(await read_whiteboard({ note_id: 6 }, {}, services)).error, /不是画布/)
})

test('the canvas skill hands the model the primitive manual and the read/create/update tools', () => {
  const { createSkillSession } = require('../../electron/services/aichat/skills.js')
  const session = createSkillSession()
  const res = session.read('canvas')
  assert.ok(res.success)
  assert.match(res.instructions, /画布原语手册/)
  assert.match(res.instructions, /svg \{source/)
  assert.deepEqual(res.tools.sort(), ['create_whiteboard', 'read_whiteboard', 'update_whiteboard'])
})
