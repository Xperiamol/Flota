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

// 一轮里同时发起多个工具调用
const tools = (...calls) => () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({ ...call, index })) }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
const card = (name, extra = {}) => JSON.stringify({ success: true, requiresConfirmation: true, actionId: `a-${Math.random().toString(36).slice(2)}`, name, args: {}, ...extra })

test('出了确认卡但同轮有调用失败：下一轮仍可调用工具修正，修好后才收尾', async () => {
  const chat = service()
  let attempts = 0
  chat._executeTool = async (name) => {
    if (name === 'edit_note') return card('edit_note')
    if (name === 'update_whiteboard') return ++attempts === 1 ? JSON.stringify({ success: false, error: '画布没有通过渲染检查：updates 和 remove 必须为数组' }) : card('update_whiteboard')
    return JSON.stringify({ success: true })
  }
  await mocked([
    tool('read_skill', { skill: 'canvas' }),
    tool('read_skill', { skill: 'notes' }),
    tools(tool('edit_note', { id: 1, title: 'x' }), tool('update_whiteboard', { patch: {} })),
    tool('update_whiteboard', { patch: { updates: [] } }),
    '改好了，请确认。',
  ], async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '改标题并把节点改红' }], () => {}, { contextPackage: {} })
    assert.equal(attempts, 2, 'the failed call was retried')
    assert.notEqual(requests[3].body.tool_choice, 'none', 'tools stay available after a failed call')
    assert.equal(requests[4].body.tool_choice, 'none', 'wraps up once nothing failed')
    assert.equal(result.taskStatus, 'awaiting_confirmation')
  })
})

test('画布确认卡附了渲染图：下一轮还能交修正版；普通确认卡之后直接收尾；修正轮数有上限', async () => {
  const chat = service()
  chat._executeTool = async (name) => (name === 'create_whiteboard' ? card(name, { rendered: { elements: 10 } }) : name === 'create_note' ? card(name) : JSON.stringify({ success: true }))
  await mocked([tool('read_skill', { skill: 'canvas' }), tool('create_whiteboard', { title: 'a', canvas: {} }), tool('create_whiteboard', { title: 'a', canvas: {} }), tool('create_whiteboard', { title: 'a', canvas: {} }), '好了。'], async requests => {
    await chat.chatStream([{ role: 'user', content: '画个图' }], () => {}, { contextPackage: {} })
    assert.notEqual(requests[2].body.tool_choice, 'none')
    assert.notEqual(requests[3].body.tool_choice, 'none')
    assert.equal(requests[4].body.tool_choice, 'none', 'at most two revision rounds after the first card')
  })
  await mocked([tool('read_skill', { skill: 'notes' }), tool('create_note', { title: 'n', content: 'c' }), '请确认。'], async requests => {
    await chat.chatStream([{ role: 'user', content: '记一下' }], () => {}, { contextPackage: {} })
    assert.equal(requests[2].body.tool_choice, 'none')
  })
})

test('同一轮里对同一目标再次提交的卡片只保留最后一张', () => {
  const { latestCardsOnly } = require('../../electron/services/aichat/sessions/messageModel')
  const a1 = { actionId: '1', name: 'create_whiteboard', args: { title: 'v1' } }
  const a2 = { actionId: '2', name: 'create_whiteboard', args: { title: 'v2' } }
  const n1 = { actionId: '3', name: 'edit_note', args: { id: 5 } }
  const u1 = { actionId: '4', name: 'update_whiteboard', args: { target_note_id: 5 } }
  const u2 = { actionId: '5', name: 'update_whiteboard', args: { target_note_id: 6 } }
  assert.deepEqual(latestCardsOnly([a1, n1, a2, u1, u2]).map((a) => a.actionId), ['3', '2', '4', '5'])
})

test('本对话前几轮读过的技能在追问时仍然开放', async () => {
  const chat = service()
  chat._executeTool = async () => JSON.stringify({ note_id: 1, elements: [] })
  const transcript = toAgentMessages([], buildModel(baseConfig, { normalizeApiUrl: AIService.prototype.normalizeApiUrl }))
  const history = [
    { role: 'user', content: [{ type: 'text', text: '画个图' }], timestamp: 1 },
    { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'read_skill', arguments: { skill: 'canvas' } }], api: 'openai-completions', provider: 'custom', model: 'test-model', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: 2 },
    { role: 'toolResult', toolCallId: 't1', toolName: 'read_skill', content: [{ type: 'text', text: '{"success":true}' }], isError: false, timestamp: 3 },
    { role: 'assistant', content: [{ type: 'text', text: '好了' }], api: 'openai-completions', provider: 'custom', model: 'test-model', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 4 },
  ]
  await mocked(['好的。'], async requests => {
    await chat.runTurn({ transcript: [...transcript, ...history], userContent: '改一下', onChunk: () => {}, options: { contextPackage: {} } })
    const names = requests[0].body.tools.map((t) => t.function.name)
    assert.ok(names.includes('read_whiteboard') && names.includes('update_whiteboard'))
  })
})

test('图片理解开着但模型不收图片：去掉图片重发同一请求，整轮不失败，之后也不再带图', async () => {
  const chat = service(), chunks = []
  chat._executeTool = async (name) => (name === 'read_note_image'
    ? JSON.stringify({ delivered_image: 'data:image/png;base64,iVBORw0KGgo=', path: 'images/cat.png' })
    : JSON.stringify({ success: true }))
  const reject = () => new Response(JSON.stringify({ error: { message: '当前模型 glm-5.3 不支持图片输入，请改用支持视觉的模型。' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  await mocked([tool('read_skill', { skill: 'notes' }), tool('read_note_image', { path: 'images/cat.png' }), reject, '我看不到图片，只知道它在 images/cat.png。'], async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '看看这张图' }], chunk => chunks.push(chunk), { contextPackage: {} })
    assert.equal(result.success, true)
    assert.equal(result.fullContent, '我看不到图片，只知道它在 images/cat.png。')
    const retried = JSON.stringify(requests.at(-1).body.messages)
    assert.ok(!retried.includes('image_url'), 'retry carries no image')
    assert.ok(retried.includes('图片未发送：当前模型不支持图片输入'), 'model is told the image was dropped')
  })
})
