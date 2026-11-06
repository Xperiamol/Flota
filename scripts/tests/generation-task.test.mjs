import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../../src/utils/aiCore/generationTask.js', import.meta.url), 'utf8')
const { createGenerationTask, cancelGenerationTask, getGenerationTaskPhase } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('停止只取消对应生成请求，即使供应商不回应也立即退出', async () => {
  const requests = [], cancelled = []
  globalThis.window = { electronAPI: { ai: {
    chat: (_messages, options) => { const pending = deferred(); requests.push({ ...pending, id: options.requestId }); return pending.promise },
    cancelChat: id => { cancelled.push(id); return Promise.resolve() },
  } } }
  const a = createGenerationTask('a'), b = createGenerationTask('b')
  const first = a.chat([], {}), second = b.chat([], {})
  assert.equal(cancelGenerationTask('a'), true)
  assert.equal(cancelGenerationTask('a'), false)
  await assert.rejects(first, { name: 'AbortError' })
  assert.deepEqual(cancelled, [requests[0].id])
  assert.equal(getGenerationTaskPhase('b'), 'generating')
  requests[1].resolve({ success: true })
  assert.deepEqual(await second, { success: true })
  requests[0].resolve({ success: true, data: 'late result' })
  assert.throws(() => a.beginCommit(), { name: 'AbortError' })
  a.dispose(); b.dispose()
  assert.equal(getGenerationTaskPhase('a'), null)
})
test('保存开始后不再接受取消；任务结束后同一张卡片可以重新开始', () => {
  const task = createGenerationTask('save')
  task.beginCommit()
  assert.equal(cancelGenerationTask('save'), false)
  assert.equal(task.signal.aborted, false)
  task.dispose()
  const retry = createGenerationTask('save')
  assert.equal(cancelGenerationTask('save'), true)
  retry.dispose()
})
test('生成前取消不发送任何模型请求', async () => {
  window.electronAPI.ai.chat = () => { throw new Error('不该发送请求') }
  const task = createGenerationTask('before')
  task.cancel()
  await assert.rejects(task.chat([], {}), { name: 'AbortError' })
  task.dispose()
})

// 主进程的模型请求：用户停止与超时分开提示；响应头到了但正文卡住也按超时处理
const { createRequire } = await import('node:module')
const requireCjs = createRequire(import.meta.url)
const { generateText } = requireCjs('../../electron/services/llm/generateText.js')
const { buildModel, buildRequestOptions } = requireCjs('../../electron/services/llm/model.js')
const AIServiceClass = requireCjs('../../electron/services/AIService.js')
const llmConfig = { provider: 'custom', model: 'm', apiUrl: 'https://t.test/v1', apiKey: 'k' }
// 响应头立即返回，正文先吐一段再卡住，直到请求被中止
const stalledStream = (_url, { signal }) => Promise.resolve(new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '开头' } }] })}\n\n`))
    signal?.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
  },
}), { headers: { 'Content-Type': 'text/event-stream' } }))
const withFetch = async (fetchImpl, run) => {
  const original = global.fetch
  global.fetch = fetchImpl
  try { return await run() } finally { global.fetch = original }
}
const generate = (options) => generateText({
  model: buildModel(llmConfig, { normalizeApiUrl: v => v }),
  messages: [{ role: 'user', content: '写点东西' }],
  requestOptions: buildRequestOptions(llmConfig, options),
})

test('响应头到了但正文卡住：按空闲超时报错，不会一直等下去', async () => {
  await withFetch(stalledStream, async () => {
    await assert.rejects(generate({ timeoutMs: 60 }), /超时/)
  })
})

test('正文读取中用户停止：报已停止，不误报为超时', async () => {
  const controller = new AbortController()
  await withFetch(stalledStream, async () => {
    const pending = generate({ timeoutMs: 10000, signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(pending, { name: 'AbortError' })
  })
  const service = Object.assign(Object.create(AIServiceClass.prototype), {
    logger: { error() {}, warn() {} }, _checkRateLimit() {}, normalizeApiUrl: v => v,
    getConfig: async () => ({ success: true, data: { ...llmConfig, enabled: true } }),
  })
  const stop = new AbortController()
  await withFetch(stalledStream, async () => {
    const pending = service.chat([{ role: 'user', content: 'x' }], { signal: stop.signal })
    setTimeout(() => stop.abort(), 20)
    assert.equal((await pending).error, '已停止生成')
  })
})

const imageSource = await readFile(new URL('../../src/utils/editorImageSource.js', import.meta.url), 'utf8')
const { editorImageSource } = await import(`data:text/javascript;base64,${Buffer.from(imageSource).toString('base64')}`)
test('编辑器临时 DOM 使用 app 协议，不再相对安装目录解析图片', () => {
  assert.equal(editorImageSource('images/a.png'), 'app://images/a.png')
  assert.equal(editorImageSource('./images/a.png'), 'app://images/a.png')
  for (const url of ['app://images/a.png', 'https://example.test/a.png', 'data:image/png;base64,abc']) assert.equal(editorImageSource(url), url)
})

const ipcSource = await readFile(new URL('../../electron/ipc/aiHandlers.js', import.meta.url), 'utf8')
test('非流式 IPC 取消按窗口与请求 ID 定位，结束后清理记录', async () => {
  const handlers = new Map(), requests = []
  const context = { module: { exports: {} }, AbortController, require: name => {
    if (name === './helpers') return {
      registerIpcHandlers: entries => entries.forEach(entry => handlers.set(entry.channel, entry.handler)),
      createTryCatchHandler: () => () => {},
    }
    if (name.includes('LoggerService')) return { getInstance: () => ({}) }
    return {}
  } }
  vm.runInNewContext(ipcSource, context)
  context.module.exports.registerAIHandlers({ aiService: { chat: async (_messages, options) => {
    const pending = deferred(); requests.push({ ...pending, signal: options.signal }); return pending.promise
  } } }, new Map())
  const first = handlers.get('ai:chat')({ sender: { id: 1 } }, [], { requestId: 'same' })
  const second = handlers.get('ai:chat')({ sender: { id: 2 } }, [], { requestId: 'same' })
  await handlers.get('ai:cancel-chat')({ sender: { id: 1 } }, 'same')
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].signal.aborted, false)
  requests[0].resolve({ success: false }); requests[1].resolve({ success: true })
  await Promise.all([first, second])
  const next = handlers.get('ai:chat')({ sender: { id: 1 } }, [], { requestId: 'same' })
  assert.equal(requests[2].signal.aborted, false)
  requests[2].resolve({ success: true })
  assert.equal((await next).success, true)
})
