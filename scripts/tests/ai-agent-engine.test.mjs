// AI 对话引擎（pi-agent-core + pi-ai）的端到端回归：从 chatStream 一直到发出去的 HTTP 请求。
// 模型由拦截全局 fetch 的脚本模拟，请求经过真实的 pi Agent 循环和 openai SDK。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const AIChatService = require('../../electron/services/aichat')
const PendingActionStore = require('../../electron/services/aichat/PendingActionStore')
const { buildModel, resolveBaseUrl } = require('../../electron/services/llm/model')
const { toAgentMessages } = require('../../electron/services/llm/messages')
const AIService = require('../../electron/services/AIService')

const baseConfig = { enabled: true, provider: 'custom', model: 'test-model', apiUrl: 'https://gateway.test/v1', apiKey: 'sk-test', visionEnabled: true }
const service = (config = baseConfig) => Object.assign(Object.create(AIChatService.prototype), {
  aiService: { getConfig: async () => ({ success: true, data: config }), _checkRateLimit() {}, normalizeApiUrl: AIService.prototype.normalizeApiUrl, settingDAO: { get: () => undefined } },
  logger: { info() {}, warn() {}, error() {} }, _pendingActions: new PendingActionStore({}), _getLongDocPipeline: () => null,
})
const tool = (name, args) => ({ index: 0, id: `${name}-${Math.random().toString(36).slice(2)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const sse = (reply) => {
  const delta = typeof reply === 'string' ? { content: reply } : { tool_calls: [reply] }
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: typeof reply === 'string' ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}
async function mocked(replies, run) {
  const original = global.fetch, requests = []
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body) })
    const next = replies.shift()
    assert.ok(next !== undefined, 'unexpected model round')
    if (typeof next === 'function') return next(options)
    return sse(next)
  }
  try { await run(requests) } finally { global.fetch = original }
}

test('请求格式：自定义接口用保守设置，地址去掉 /chat/completions，不带 pi 署名和 max_tokens', async () => {
  await mocked(['你好。'], async requests => {
    const result = await service().chatStream([{ role: 'user', content: '你好' }], () => {})
    assert.equal(result.success, true)
    assert.equal(result.fullContent, '你好。')
    const [request] = requests
    assert.equal(request.url, 'https://gateway.test/v1/chat/completions')
    assert.equal(request.headers.get('authorization'), 'Bearer sk-test')
    assert.ok(![...request.headers.keys()].some(key => /pi|attribution|x-title|referer/i.test(key)))
    assert.equal(request.body.messages[0].role, 'system')
    assert.ok(!('store' in request.body))
    assert.ok(!('max_tokens' in request.body) && !('max_completion_tokens' in request.body))
    assert.equal(request.body.stream, true)
  })
})

test('各服务商的地址与兼容设置', () => {
  const aiService = { normalizeApiUrl: AIService.prototype.normalizeApiUrl }
  assert.equal(resolveBaseUrl({ provider: 'openai' }, aiService), 'https://api.openai.com/v1')
  assert.equal(resolveBaseUrl({ provider: 'deepseek' }, aiService), 'https://api.deepseek.com/v1')
  assert.equal(resolveBaseUrl({ provider: 'custom', apiUrl: 'https://x.test/v1/chat/completions/' }, aiService), 'https://x.test/v1')
  assert.equal(resolveBaseUrl({ provider: 'custom', apiUrl: 'https://x.test/api/v3' }, aiService), 'https://x.test/api/v3')
  // OpenAI 官方与 DeepSeek 交给 pi-ai 按地址自动识别；通义千问和自定义接口用保守设置
  assert.equal(buildModel({ provider: 'openai', model: 'gpt' }, aiService).compat, undefined)
  assert.equal(buildModel({ provider: 'deepseek', model: 'ds' }, aiService).compat, undefined)
  const qwen = buildModel({ provider: 'qwen', model: 'qwen-plus' }, aiService)
  assert.equal(qwen.compat.supportsDeveloperRole, false)
  assert.equal(qwen.headers['X-DashScope-SSE'], 'enable')
  assert.deepEqual(buildModel({ provider: 'custom', model: 'm' }, aiService, { vision: true }).input, ['text', 'image'])
})

test('读图：图片直接放进工具结果并以附图消息发给模型，前端结果里不带 base64', async () => {
  const chat = service(), chunks = []
  chat._executeTool = async (name) => (name === 'read_note_image'
    ? JSON.stringify({ delivered_image: 'data:image/png;base64,iVBORw0KGgo=', path: 'images/cat.png' })
    : JSON.stringify({ success: true }))
  await mocked([tool('read_skill', { skill: 'notes' }), tool('read_note_image', { path: 'images/cat.png' }), '图里是一只猫。'], async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '看看这张图' }], chunk => chunks.push(chunk), { contextPackage: {} })
    assert.equal(result.fullContent, '图里是一只猫。')
    const imageMessage = requests.at(-1).body.messages.at(-1)
    assert.equal(imageMessage.role, 'user')
    assert.ok(imageMessage.content.some(part => part.type === 'image_url' && part.image_url.url === 'data:image/png;base64,iVBORw0KGgo='))
    const toolEnd = chunks.find(chunk => chunk.type === 'tool_end' && chunk.name === 'read_note_image')
    assert.deepEqual(JSON.parse(toolEnd.result), { ok: true, path: 'images/cat.png' })
  })
})

test('关闭图片理解时不开放读图工具', async () => {
  await mocked([tool('read_skill', { skill: 'notes' }), '好的。'], async requests => {
    await service({ ...baseConfig, visionEnabled: false }).chatStream([{ role: 'user', content: '看图' }], () => {})
    assert.ok(!requests[1].body.tools.some(t => t.function.name === 'read_note_image'))
  })
})

test('回复空口声称已生成确认卡：追加一轮纠正，新内容和原文之间空一行', async () => {
  const chat = service(), chunks = []
  await mocked(['已准备好，请点击确认卡执行。', tool('read_skill', { skill: 'settings' }), tool('update_settings', { changes: [{ key: 'theme', value: 'dark' }] }), '请确认。'], async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '改成深色' }], chunk => chunks.push(chunk))
    assert.equal(requests.length, 4)
    assert.match(requests[1].body.messages.at(-1).content, /本轮没有调用任何写入工具/)
    assert.equal(result.taskStatus, 'awaiting_confirmation')
    assert.equal(chat._pendingActions._pendingActions.size, 1)
    assert.equal(result.fullContent, '已准备好，请点击确认卡执行。\n\n请确认。')
    assert.equal(chunks.filter(c => c.type === 'content').map(c => c.content).join(''), result.fullContent)
  })
})

test('生成中途停止：返回已取消并保留已经流出的内容', async () => {
  const controller = new AbortController()
  const encoder = new TextEncoder()
  await mocked([() => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '写到一半' } }] })}\n\n`))
      controller.signal.addEventListener('abort', () => stream.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })], async () => {
    const chunks = []
    const result = await service().chatStream([{ role: 'user', content: '写长文' }], chunk => {
      chunks.push(chunk)
      if (chunk.type === 'content') controller.abort()
    }, { abortSignal: controller.signal })
    assert.equal(result.cancelled, true)
    assert.equal(result.fullContent, '写到一半')
  })
})

test('服务商报错：给前端发 error 事件，返回失败', async () => {
  await mocked([() => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })], async () => {
    const chunks = []
    const result = await service().chatStream([{ role: 'user', content: '你好' }], chunk => chunks.push(chunk))
    assert.equal(result.success, false)
    assert.match(result.error, /Invalid API key|401/)
    assert.equal(chunks.at(-1).type, 'error')
  })
})

test('历史消息转换：多模态用户消息的图片转成图片块，空的助手消息丢弃', () => {
  const model = buildModel(baseConfig, { normalizeApiUrl: value => value })
  const messages = toAgentMessages([
    { role: 'user', content: [{ type: 'text', text: '这是什么' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } }] },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: '一张照片' },
    { role: 'system', content: '[L3早期对话记忆摘要]' },
  ], model)
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user'])
  assert.deepEqual(messages[0].content[1], { type: 'image', mimeType: 'image/jpeg', data: '/9j/' })
  assert.equal(messages[1].content[0].text, '一张照片')
  assert.equal(messages[2].content, '[L3早期对话记忆摘要]')
})
