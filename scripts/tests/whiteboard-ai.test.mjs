import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const AIService = require('../../electron/services/AIService.js')
const { ImageStorageService } = require('../../electron/services/ImageStorageService.js')

// 非流式生成（画布 / SVG 等）：空正文、只有推理、截断、审核拦截都不能当成功结果
const sseOf = (...choices) => new Response(choices.map(choice => `data: ${JSON.stringify({ choices: [choice] })}\n\n`).join('') + 'data: [DONE]\n\n')
const chatWith = async (reply, options = {}) => {
  const original = global.fetch
  global.fetch = async () => reply()
  try {
    const service = Object.assign(Object.create(AIService.prototype), {
      logger: { error() {}, warn() {} }, _checkRateLimit() {}, normalizeApiUrl: v => v,
      getConfig: async () => ({ success: true, data: { enabled: true, provider: 'custom', model: 'm', apiUrl: 'https://t.test/v1', apiKey: 'k' } }),
    })
    return await service.chat([{ role: 'user', content: '画一张图' }], options)
  } finally { global.fetch = original }
}
test('非流式生成识别空正文、只有推理、截断、审核拦截', async () => {
  assert.match((await chatWith(() => sseOf({ delta: {}, finish_reason: 'stop' }))).error, /空正文/)
  assert.match((await chatWith(() => sseOf({ delta: { reasoning_content: '思考中' } }, { delta: {}, finish_reason: 'stop' }))).error, /仅返回推理/)
  assert.match((await chatWith(() => sseOf({ delta: { content: '<svg>' }, finish_reason: 'length' }), { maxTokens: 10 })).error, /截断/)
  assert.match((await chatWith(() => sseOf({ delta: {}, finish_reason: 'content_filter' }))).error, /审核/)
})
test('非流式生成正常返回正文', async () => {
  const result = await chatWith(() => sseOf({ delta: { content: '<svg/>' }, finish_reason: 'stop' }))
  assert.equal(result.success, true)
  assert.equal(result.data.content, '<svg/>')
})
test('图片部分落盘失败必须报错，不能返回残缺索引冒充成功', async () => {
  const service = Object.create(ImageStorageService.prototype)
  service.initialize = async () => {}
  service.saveWhiteboardImage = async id => { if (id === 'bad') throw new Error('disk full'); return `${id}.svg` }
  const file = { dataURL: 'data:image/svg+xml;base64,AA==', mimeType: 'image/svg+xml' }
  await assert.rejects(service.saveWhiteboardImages({ good: file, bad: file }), /disk full/)
  assert.equal((await service.saveWhiteboardImages({ good: file })).good.fileName, 'good.svg')
})

// 只替换外部生成/IPC 依赖，执行生产代码中的动作解析、结果校验及保存事务。
let source = await readFile(new URL('../../src/utils/whiteboardAI.js', import.meta.url), 'utf8')
// 渲染模块换成桩：__whiteboardGenerate 决定「渲染结果」，其余保存、合并、回滚逻辑都是生产代码
source = source.replace("import logger from './logger'", 'const logger = { warn() {} }')
  .replaceAll("await import('./diagrams/agentCanvas')", "({ readCanvasSpec: (args) => (args.canvas ? { canvas: args.canvas } : null), renderCanvasSpec: (...a) => globalThis.__whiteboardGenerate(...a) })")
  .replaceAll("await import('./diagrams/canvasSvgPolicy')", "({ isAiCanvasSvgAllowed: async () => true })")
const board = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const note = { id: 1, title: 'NTU', note_type: 'whiteboard', content: board.buildWhiteboardContent({ elements: [{ id: 'old', type: 'text', text: '2026-10-23' }], fileMap: { old: { fileName: 'old.svg' } } }) }
const setup = () => {
  globalThis.window = { electronAPI: { whiteboard: { saveImages: async () => ({ success: true, data: { fresh: { fileName: 'fresh.svg' } } }) } }, dispatchEvent() {} }
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail } }
  globalThis.__whiteboardGenerate = async () => ({ elements: [{ id: 'fresh', type: 'image', fileId: 'fresh' }], files: { fresh: { dataURL: 'svg' } }, warnings: ['局部 SVG 未生成'] })
}
test('空生成不覆盖原画布、不写数据库', async () => {
  setup()
  globalThis.__whiteboardGenerate = async () => ({ elements: [] })
  let writes = 0
  await assert.rejects(board.applyWhiteboardGenerationToNote({ note, spec: { canvas: {} }, action: 'replace', updateNote: async () => { writes++ } }), /结果为空/)
  assert.equal(writes, 0)
})
test('追加合并旧图片索引；重画只保存新索引；图片保存失败不写笔记', async () => {
  setup()
  let saved
  const updateNote = async (id, changes) => { saved = JSON.parse(changes.content); return { success: true } }
  await board.applyWhiteboardGenerationToNote({ note, spec: { canvas: {} }, updateNote })
  assert.equal(saved.elements.length, 2)
  assert.deepEqual(Object.keys(saved.fileMap), ['old', 'fresh'])
  await board.applyWhiteboardGenerationToNote({ note, spec: { canvas: {} }, action: 'replace', updateNote })
  assert.deepEqual(Object.keys(saved.fileMap), ['fresh'])
  window.electronAPI.whiteboard.saveImages = async () => ({ success: false, error: 'disk full' })
  saved = null
  await assert.rejects(board.applyWhiteboardGenerationToNote({ note, spec: { canvas: {} }, updateNote }), /disk full/)
  assert.equal(saved, null)
})
test('创建结果保留局部失败警告；刷新失败仍是已保存成功', async () => {
  setup()
  const result = await board.executeCreateWhiteboardToolAction({
    args: { title: 'NTU 海报', canvas: {} }, createNote: async () => ({ success: true, data: note }),
    updateNote: async () => ({ success: true }), loadNotes: async () => { throw new Error('refresh failed') },
  })
  assert.equal(result.success, true)
  assert.equal(result.noteId, 1)
  assert.match(result.message, /局部 SVG 未生成/)
  assert.match(result.message, /列表刷新失败/)
})
test('创建生成失败会清理空白笔记', async () => {
  setup()
  globalThis.__whiteboardGenerate = async () => { throw new Error('模型返回空正文') }
  let deleted
  await assert.rejects(board.executeCreateWhiteboardToolAction({
    args: { title: '海报', canvas: {} }, createNote: async () => ({ success: true, data: note }),
    updateNote: async () => {}, deleteNote: async id => { deleted = id },
  }), /空正文/)
  assert.equal(deleted, 1)
})
test('快照画布删除后不能回退修改另一张当前画布', async () => {
  setup()
  await assert.rejects(board.executeUpdateWhiteboardToolAction({
    args: { canvas: {}, mode: 'replace' }, currentNote: note, notes: [note], actionContext: { selectedNoteId: 999 }, updateNote: async () => {},
  }), /未找到/)
})
test('保存及读取保留网格和视口，不保存临时编辑状态', () => {
  const data = board.parseWhiteboardContent(board.buildWhiteboardContent({ appState: { gridModeEnabled: true, scrollX: 123, scrollY: 456, zoom: { value: 0.5 }, selectedElementIds: { x: true } } }))
  assert.equal(data.appState.gridModeEnabled, true)
  assert.equal(data.appState.scrollX, 123)
  assert.equal(data.appState.zoom.value, 0.5)
  assert.equal(data.appState.selectedElementIds, undefined)
})

// 运行编辑器实际事件处理函数，注入 scene/保存/生成依赖来重现异步竞争。
const editorSource = await readFile(new URL('../../src/components/editor/WhiteboardEditor.jsx', import.meta.url), 'utf8')
const start = editorSource.indexOf('const handleExternalGenerate = async (event) => {')
const end = editorSource.indexOf('window.addEventListener(WHITEBOARD_AI_GENERATE_EVENT', start)
const handlerSource = editorSource.slice(start, end)
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const makeEditor = () => {
  let elements = [{ id: 'old', version: 1 }]
  const generating = deferred()
  const state = { writes: 0, error: null, result: null }
  const dependencies = {
    noteId: 1, excalidrawAPI: { getSceneElements: () => elements, getAppState: () => ({}), getFiles: () => ({}) },
    aiGenerationInFlightRef: { current: false }, editorMountedRef: { current: true }, activeNoteIdRef: { current: 1 },
    isApplyingRemoteDataRef: { current: false }, cancelSave() {}, saveNow: async () => {}, notes: [note],
    haveElementsChanged: (a, b) => JSON.stringify(a) !== JSON.stringify(b), haveFilesChanged: () => false,
    hasCanvasSettingsChanged: () => false, parseWhiteboardContent: board.parseWhiteboardContent,
    generateWhiteboardElementsByAction: () => generating.promise, getPersistedAppState: x => x,
    commitWhiteboardScene: async ({ validate }) => { validate(); state.writes++ }, setTimeout: callback => callback(),
  }
  const handler = Function(...Object.keys(dependencies), `${handlerSource}; return handleExternalGenerate`)(...Object.values(dependencies))
  const event = () => ({ detail: { noteId: 1, action: 'replace', spec: { canvas: {} }, resolve: value => { state.result = value }, reject: error => { state.error = error } } })
  return { dependencies, handler, event, state, generating, edit: () => { elements = [{ id: 'old', version: 2 }] } }
}
for (const scenario of ['编辑', '切换', '关闭']) {
  test(`生成等待期间${scenario}画布后，旧结果不落盘`, async () => {
    const h = makeEditor()
    const pending = h.handler(h.event())
    await Promise.resolve()
    if (scenario === '编辑') h.edit()
    if (scenario === '切换') h.dependencies.activeNoteIdRef.current = 2
    if (scenario === '关闭') h.dependencies.editorMountedRef.current = false
    h.generating.resolve({ action: 'replace', elements: [{ id: 'new' }], fileMap: {} })
    await pending
    assert.equal(h.state.writes, 0)
    assert.ok(h.state.error)
    assert.equal(h.dependencies.aiGenerationInFlightRef.current, false)
  })
}
test('同一编辑器拒绝并行生成；首个请求成功提交', async () => {
  const h = makeEditor()
  const pending = h.handler(h.event())
  await Promise.resolve()
  await h.handler(h.event())
  assert.match(h.state.error.message, /正在生成/)
  h.generating.resolve({ action: 'replace', elements: [{ id: 'new' }], fileMap: {} })
  await pending
  assert.equal(h.state.writes, 1)
  assert.ok(h.state.result)
})
test('已被另一个编辑器接管的事件不能重复处理', async () => {
  const h = makeEditor()
  const event = h.event()
  event.detail.handled = true
  await h.handler(event)
  assert.equal(h.dependencies.aiGenerationInFlightRef.current, false)
  assert.equal(h.state.writes, 0)
})

test('图片落盘期间停止生成，最终提交前仍检查取消，不写入画布', async () => {
  setup()
  const saving = deferred()
  const saveStarted = deferred()
  let cancelled = false, writes = 0
  window.electronAPI.whiteboard.saveImages = () => { saveStarted.resolve(); return saving.promise }
  const task = {
    throwIfCancelled() { if (cancelled) throw Object.assign(new Error('已停止生成'), { name: 'AbortError' }) },
    beginCommit() { this.throwIfCancelled() },
  }
  const pending = board.applyWhiteboardGenerationToNote({ note, spec: { canvas: {} }, action: 'replace', task, updateNote: async () => { writes++ } })
  await saveStarted.promise
  cancelled = true
  saving.resolve({ success: true, data: { fresh: { fileName: 'fresh.svg' } } })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(writes, 0)
})
test('后台修改完成不强制改变当前选中笔记', async () => {
  setup()
  let selected = 99
  const result = await board.executeUpdateWhiteboardToolAction({
    args: { target_note_id: 1, canvas: {} }, notes: [note],
    updateNote: async () => ({ success: true }), setSelectedNoteId: id => { selected = id },
  })
  assert.equal(result.success, true)
  assert.equal(selected, 99)
})

test('所有画布保存入口拒绝成功标记下的残缺图片索引', async () => {
  const previous = globalThis.window
  globalThis.window = { electronAPI: { whiteboard: { saveImages: async () => ({ success: true, data: { first: { fileName: 'a.png' } } }) } } }
  try {
    await assert.rejects(board.saveWhiteboardFiles({ first: {}, missing: {} }), /不完整/)
    assert.deepEqual(await board.saveWhiteboardFiles({}), {})
  } finally { globalThis.window = previous }
})


test('旧版只有描述（prompt）的确认卡给出明确说明，不再调用已移除的生成器', async () => {
  setup()
  await assert.rejects(board.executeCreateWhiteboardToolAction({ args: { prompt: '画个图' }, createNote: async () => ({ success: true, data: note }), updateNote: async () => ({}) }), /旧版画布生成，已不再支持/)
  await assert.rejects(board.applyWhiteboardGenerationToNote({ note, action: 'replace', updateNote: async () => ({}) }), /旧版画布生成，已不再支持/)
})
