import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
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

const backendSource = await readFile(new URL('../../electron/services/AIService.js', import.meta.url), 'utf8')
const makeService = fetch => {
  const context = { module: { exports: {} }, AbortController, AbortSignal, setTimeout, clearTimeout, fetch, require: name => {
    if (name === 'events') return { EventEmitter }
    if (name === './LoggerService') return { getInstance: () => ({ error() {}, warn() {} }) }
    return {}
  } }
  vm.runInNewContext(backendSource, context)
  const service = new context.module.exports({})
  service._getLongRequestDispatcher = () => null
  return service
}
test('主进程取消可以中止真实传给 fetch 的 signal，且不被误报为超时', async () => {
  let seen
  const service = makeService((_url, options) => new Promise((_, reject) => {
    seen = options.signal
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const controller = new AbortController()
  const pending = service._fetchTextWithTimeout('https://example.test', { signal: controller.signal }, 10000)
  controller.abort()
  await assert.rejects(pending, /已停止生成/)
  assert.equal(seen.aborted, true)
})

const imageSource = await readFile(new URL('../../src/utils/editorImageSource.js', import.meta.url), 'utf8')
const { editorImageSource } = await import(`data:text/javascript;base64,${Buffer.from(imageSource).toString('base64')}`)
test('编辑器临时 DOM 使用 app 协议，不再相对安装目录解析图片', () => {
  assert.equal(editorImageSource('images/a.png'), 'app://images/a.png')
  assert.equal(editorImageSource('./images/a.png'), 'app://images/a.png')
  for (const url of ['app://images/a.png', 'https://example.test/a.png', 'data:image/png;base64,abc']) assert.equal(editorImageSource(url), url)
})

let streamSource = await readFile(new URL('../../src/hooks/useAIStream.js', import.meta.url), 'utf8')
streamSource = streamSource.replace(/^import .*$/gm, '')
streamSource = `const useRef = value => ({ current: value }); const useCallback = fn => fn; const useEffect = () => {}; const getAppSettingsSnapshot = () => ({}); const aiLog = { info() {}, warn() {}, error() {} };\n` + streamSource
const { useAIStream } = await import(`data:text/javascript;base64,${Buffer.from(streamSource).toString('base64')}`)
test('两个会话并行流式生成：结束旧请求不移除新监听器，取消只影响指定会话', async () => {
  const listeners = new Set(), requests = [], cancelled = []
  window.electronAPI.ai = {
    onChatChunk: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    chatStream: (_messages, options) => { const pending = deferred(); requests.push({ ...pending, ...options }); return pending.promise },
    cancelStream: id => { cancelled.push(id); return Promise.resolve() },
  }
  const stream = useAIStream()
  const chunksA = [], chunksB = []
  const a = stream.runStream({ conversationId: 'a', messages: [], onContent: value => chunksA.push(value) })
  const b = stream.runStream({ conversationId: 'b', messages: [], onContent: value => chunksB.push(value) })
  const emit = (request, content) => listeners.forEach(fn => fn({ type: 'content', requestId: request.requestId, content }))
  emit(requests[0], 'A')
  emit(requests[1], 'B')
  await stream.cancel('a')
  assert.deepEqual(cancelled, [requests[0].requestId])
  requests[0].resolve({ cancelled: true })
  assert.equal((await a).cancelledByUser, true)
  assert.equal(listeners.size, 1)
  emit(requests[1], '2')
  requests[1].resolve({ success: true })
  const resultB = await b
  assert.equal(resultB.content, 'B2')
  assert.equal(resultB.cancelledByUser, false)
  assert.deepEqual(chunksA, ['A'])
  assert.deepEqual(chunksB, ['B', 'B2'])
  assert.equal(listeners.size, 0)
})

test('上下文准备阶段也可以停止，不会在稍后偷偷发送模型请求', async () => {
  const preparing = deferred()
  let sent = 0
  window.electronAPI.ai = { onChatChunk: () => () => {}, chatStream: () => { sent++; return Promise.resolve({ success: true }) } }
  const stream = useAIStream()
  const pending = stream.runStream({ conversationId: 'slow-context', messages: [], prepareContext: () => preparing.promise })
  await stream.cancel('slow-context')
  assert.equal((await pending).result.cancelled, true)
  preparing.resolve({ source: 'late-context' })
  await Promise.resolve()
  assert.equal(sent, 0)
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

const stalledBody = (_url, { signal }) => Promise.resolve({
  ok: true, status: 200,
  text: () => new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }),
})

test('AI deadline covers a stalled body after successful response headers', async () => {
  const service = makeService(stalledBody)
  await assert.rejects(service._chatAPI('test', '', {}, data => data, 20), /超时/)
})

test('stopping AI during body consumption remains cancellation, not timeout', async () => {
  const service = makeService(stalledBody)
  const controller = new AbortController()
  const pending = service._chatAPI('test', '', {}, data => data, 1000, controller.signal)
  controller.abort()
  await assert.rejects(pending, /已停止生成/)
})

test('AI response body is read once and returned through the existing extractor', async () => {
  let reads = 0
  const service = makeService(async () => ({ ok: true, status: 200, text: async () => {
    reads++
    return '{"content":"完成"}'
  } }))
  const response = await service._chatAPI('test', '', {}, data => data, 1000)
  assert.equal(response.data.content, '完成')
  assert.equal(reads, 1)
})
