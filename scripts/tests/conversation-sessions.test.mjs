// 主进程持有的 AI 会话：发送 → 流式草稿广播 → 保存展示消息与完整记录 → 下一轮用完整记录作上下文。
// 模型由拦截 fetch 的脚本模拟（经过真实的 pi Agent 和 openai SDK）；数据库用内存实现。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ConversationSessions = require('../../electron/services/aichat/sessions/ConversationSessions')
const AIChatService = require('../../electron/services/aichat')
const PendingActionStore = require('../../electron/services/aichat/PendingActionStore')
const { compactTranscript, toPersisted, dropLastTurn } = require('../../electron/services/aichat/sessions/transcript')
const { buildModel } = require('../../electron/services/llm/model')

const config = { enabled: true, provider: 'custom', model: 'test-model', apiUrl: 'https://t.test/v1', apiKey: 'k' }
const aiService = { getConfig: async () => ({ success: true, data: config }), _checkRateLimit() {}, normalizeApiUrl: v => v, settingDAO: { get: () => undefined } }

// 内存版 ConversationDAO（只实现会话服务用到的方法）
const memoryDao = (seed = {}) => {
  const rows = new Map(Object.entries(seed))
  return {
    rows,
    getById: (id, { withTranscript = false } = {}) => {
      const row = rows.get(id)
      if (!row) return null
      const { transcript, ...rest } = structuredClone(row)
      return withTranscript ? { ...rest, transcript: transcript ?? null } : rest
    },
    upsert: (c) => { rows.set(c.id, { id: c.id, title: c.title || '', noteId: c.noteId ?? null, source: c.source || 'general', messages: rows.get(c.id)?.messages || [], transcript: rows.get(c.id)?.transcript ?? null }); return rows.get(c.id) },
    saveSession: (id, { messages, transcript, title }) => {
      const row = rows.get(id)
      rows.set(id, { ...row, messages: structuredClone(messages), ...(transcript !== undefined ? { transcript: structuredClone(transcript) } : {}), ...(title != null ? { title } : {}) })
      return structuredClone(rows.get(id))
    },
  }
}

const setup = (seed) => {
  const chat = Object.assign(Object.create(AIChatService.prototype), {
    aiService, logger: { info() {}, warn() {}, error() {} }, _pendingActions: new PendingActionStore({}), _getLongDocPipeline: () => null,
    processTurnMemories: async () => [],
  })
  const dao = memoryDao(seed)
  const events = []
  const sessions = new ConversationSessions({ dao, aiChatService: chat, aiService, broadcast: (channel, payload) => events.push([channel, payload]) })
  return { sessions, dao, events, chat }
}

const tool = (name, args) => ({ index: 0, id: `${name}-${Math.random().toString(36).slice(2)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
async function mocked(replies, run) {
  const original = global.fetch, requests = []
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    const next = replies.shift()
    assert.ok(next !== undefined, 'unexpected model round')
    if (typeof next === 'function') return next(options)
    const delta = typeof next === 'string' ? { content: next } : { tool_calls: [next] }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: typeof next === 'string' ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
  }
  try { await run(requests) } finally { global.fetch = original }
}

test('一轮对话：保存展示消息与完整记录，广播会话与草稿，结束时草稿清空', async () => {
  const { sessions, dao, events } = setup()
  await mocked(['你好，我是 FlotaAI。'], async () => {
    const result = await sessions.send({ conversationId: 'c1', meta: { title: '新对话' }, content: '你好', text: '你好', options: { scene: 'chat_panel' } })
    assert.equal(result.success, true)
  })
  const row = dao.rows.get('c1')
  assert.deepEqual(row.messages.map(m => [m.role, m.content]), [['user', '你好'], ['assistant', '你好，我是 FlotaAI。']])
  assert.equal(row.title, '你好')
  assert.deepEqual(row.transcript.map(m => m.role), ['user', 'assistant'])
  assert.ok(row.messages[1].metadata.requestId)
  // 广播：会话内容（不含完整记录）+ 草稿，最后一条草稿事件是结束（draft: null）
  const conversations = events.filter(([channel]) => channel === 'ai:session-conversation')
  assert.ok(conversations.length >= 2)
  assert.ok(conversations.every(([, payload]) => !('transcript' in payload.conversation)))
  const drafts = events.filter(([channel]) => channel === 'ai:session-stream')
  assert.equal(drafts.at(-1)[1].draft, null)
})

test('第二轮的上下文带上第一轮的工具调用和结果（不再只有文字）', async () => {
  const { sessions, dao } = setup()
  await mocked([tool('read_skill', { skill: 'settings' }), tool('get_settings', {}), '当前是浅色主题。', '刚才查到的是浅色主题。'], async requests => {
    await sessions.send({ conversationId: 'c2', content: '现在是什么主题', text: '现在是什么主题', options: { contextPackage: { appSettings: { theme: 'light' } } } })
    const firstTurn = dao.rows.get('c2').transcript
    assert.deepEqual(firstTurn.map(m => m.role), ['user', 'assistant', 'toolResult', 'assistant', 'toolResult', 'assistant'])
    await sessions.send({ conversationId: 'c2', content: '刚才查的是什么', text: '刚才查的是什么', options: {} })
    const secondRequest = requests.at(-1).messages
    assert.ok(secondRequest.some(m => m.role === 'assistant' && m.tool_calls?.some(call => call.function.name === 'get_settings')))
    assert.ok(secondRequest.some(m => m.role === 'tool' && /theme/.test(m.content)))
  })
  // 展示消息里只有文字和工具标记，完整记录在 transcript 里
  assert.deepEqual(dao.rows.get('c2').messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.ok(dao.rows.get('c2').messages[1].toolCalls.some(call => call.name === 'get_settings'))
})

test('旧会话没有完整记录：用展示消息里的文字重建上下文', async () => {
  const { sessions } = setup({ old: { id: 'old', title: '旧', source: 'general', transcript: null, messages: [
    { role: 'user', content: '我叫小明' },
    { role: 'assistant', content: '你好小明', actions: [{ actionId: 'x', name: 'add_memory', status: 'done' }] },
    { role: 'assistant', content: '已保存记忆', actionResultFor: 'x' },
  ] } })
  await mocked(['你叫小明。'], async requests => {
    await sessions.send({ conversationId: 'old', content: '我叫什么', text: '我叫什么', options: {} })
    const sent = requests[0].messages.filter(m => m.role !== 'system').map(m => [m.role, typeof m.content === 'string' ? m.content : m.content.map(p => p.text).join('')])
    assert.deepEqual(sent, [['user', '我叫小明'], ['assistant', '你好小明'], ['user', '我叫什么']])
  })
})

test('确认卡：同一张卡只能开始一次；完成后结果写进展示消息和完整记录', async () => {
  const { sessions, dao } = setup()
  await mocked([tool('read_skill', { skill: 'settings' }), tool('update_settings', { changes: [{ key: 'theme', value: 'dark' }] }), '请确认。'], async () => {
    await sessions.send({ conversationId: 'c3', content: '改深色', text: '改深色', options: {} })
  })
  const card = dao.rows.get('c3').messages.at(-1).actions[0]
  assert.equal(card.name, 'update_settings')
  assert.equal(sessions.beginAction('c3', card.actionId).success, true)
  // 另一个窗口同时点确认：已经在执行，拒绝
  assert.equal(sessions.beginAction('c3', card.actionId).success, false)
  await sessions.finishAction('c3', card.actionId, { success: true, message: '已切换为深色主题' })
  const row = dao.rows.get('c3')
  assert.equal(row.messages.flatMap(m => m.actions || []).find(a => a.actionId === card.actionId).status, 'done')
  assert.equal(row.messages.at(-1).actionResultFor, card.actionId)
  assert.match(row.transcript.at(-1).content[0].text, /已执行.*深色主题/)
  // 忽略 / 恢复只对待确认的卡生效
  assert.equal(sessions.dismissAction('c3', card.actionId).success, false)
})

test('忽略与恢复：dismissed ⇄ pending', async () => {
  const { sessions, dao } = setup({ c4: { id: 'c4', title: '', source: 'general', transcript: [], messages: [{ role: 'assistant', content: '请确认', actions: [{ actionId: 'a', name: 'create_todo' }] }] } })
  assert.equal(sessions.dismissAction('c4', 'a').success, true)
  assert.equal(dao.rows.get('c4').messages[0].actions[0].status, 'dismissed')
  assert.equal(sessions.restoreAction('c4', 'a').success, true)
  assert.equal(dao.rows.get('c4').messages[0].actions[0].status, 'pending')
})

test('重新生成：展示消息和完整记录都回退到上一轮，再用同一条用户消息问一次', async () => {
  const { sessions, dao } = setup()
  await mocked(['第一版回答', '第二版回答'], async requests => {
    await sessions.send({ conversationId: 'c5', content: '写一句话', text: '写一句话', options: {} })
    await sessions.retry({ conversationId: 'c5', options: {} })
    assert.equal(requests.length, 2)
    assert.deepEqual(requests[1].messages.filter(m => m.role !== 'system').map(m => m.role), ['user'])
  })
  const row = dao.rows.get('c5')
  assert.deepEqual(row.messages.map(m => m.content), ['写一句话', '第二版回答'])
  assert.deepEqual(row.transcript.map(m => m.role), ['user', 'assistant'])
})

test('停止生成：保留已流出的内容并标记已停止；这一轮不写进完整记录；同一会话不能并发', async () => {
  const { sessions, dao } = setup()
  const encoder = new TextEncoder()
  let pending
  await mocked([(options) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '写到一半' } }] })}\n\n`))
      options.signal.addEventListener('abort', () => stream.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    },
  }))], async () => {
    pending = sessions.send({ conversationId: 'c6', content: '写长文', text: '写长文', options: {} })
    await new Promise(r => setTimeout(r, 60))
    assert.match((await sessions.send({ conversationId: 'c6', content: '再来', text: '再来', options: {} })).error, /正在生成/)
    assert.equal(sessions.cancel('c6').success, true)
    const result = await pending
    assert.equal(result.cancelled, true)
  })
  const row = dao.rows.get('c6')
  assert.equal(row.messages.at(-1).content, '写到一半')
  assert.equal(row.messages.at(-1).stopped, true)
  assert.equal(row.transcript, null)
})

test('两个会话并行生成：停止其中一个只影响它自己', async () => {
  const { sessions, dao } = setup()
  const encoder = new TextEncoder()
  const streamUntilAbort = (text) => (options) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
      options.signal.addEventListener('abort', () => stream.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      // b 稍后正常结束
      if (text === 'B') setTimeout(() => {
        stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`))
        stream.close()
      }, 80)
    },
  }))
  await mocked([streamUntilAbort('A'), streamUntilAbort('B')], async () => {
    const a = sessions.send({ conversationId: 'a', content: '问题 A', text: '问题 A', options: {} })
    await new Promise(r => setTimeout(r, 10))
    const b = sessions.send({ conversationId: 'b', content: '问题 B', text: '问题 B', options: {} })
    await new Promise(r => setTimeout(r, 30))
    assert.deepEqual(sessions.activeStreams().map(s => s.conversationId).sort(), ['a', 'b'])
    sessions.cancel('a')
    assert.equal((await a).cancelled, true)
    assert.equal((await b).success, true)
  })
  assert.equal(dao.rows.get('a').messages.at(-1).stopped, true)
  assert.equal(dao.rows.get('b').messages.at(-1).content, 'B完成')
  assert.deepEqual(sessions.activeStreams(), [])
})

test('完整记录持久化：去掉 system 与工具结果图片，过长工具输出截断；重新生成回退最后一轮', () => {
  const persisted = toPersisted([
    { role: 'system', content: '工具变化' },
    { role: 'toolResult', toolCallId: 't', toolName: 'read_note_image', content: [{ type: 'text', text: '{"ok":true}' }, { type: 'image', data: 'AAA', mimeType: 'image/png' }] },
    { role: 'toolResult', toolCallId: 'u', toolName: 'read_note', content: [{ type: 'text', text: 'x'.repeat(30000) }] },
  ])
  assert.equal(persisted.length, 2)
  assert.deepEqual(persisted[0].content.map(b => b.type), ['text'])
  assert.match(persisted[1].content[0].text, /已截断，原长 30000/)
  const [rest, last] = dropLastTurn([{ role: 'user', content: 'a' }, { role: 'assistant', content: [] }, { role: 'user', content: 'b' }, { role: 'assistant', content: [] }])
  assert.equal(rest.length, 2)
  assert.equal(last.content, 'b')
})

test('压缩完整记录：预算内原样返回同一批对象；超预算时只压缩更早轮次的工具输出，工具调用与结果不拆散', async () => {
  const model = buildModel(config, aiService)
  const assistant = (content, stopReason = 'stop') => ({ role: 'assistant', content, api: 'x', provider: 'x', model: 'm', usage: {}, stopReason, timestamp: 1 })
  const toolResult = (id, text) => ({ role: 'toolResult', toolCallId: id, toolName: 'read_note', content: [{ type: 'text', text }], isError: false, timestamp: 2 })
  const longText = JSON.stringify({ content: '长'.repeat(4000) })
  const transcript = [
    { role: 'user', content: '读第一篇', timestamp: 0 },
    assistant([{ type: 'toolCall', id: 'c1', name: 'read_note', arguments: { id: 1 } }], 'toolUse'),
    toolResult('c1', longText),
    assistant([{ type: 'text', text: '读完了第一篇' }]),
    { role: 'user', content: '再读第二篇', timestamp: 3 },
    assistant([{ type: 'toolCall', id: 'c2', name: 'read_note', arguments: { id: 2 } }], 'toolUse'),
    toolResult('c2', longText),
  ]
  const kept = await compactTranscript('系统', transcript, 100000, {}, model)
  assert.ok(kept.length === transcript.length && kept.every((message, i) => message === transcript[i]))

  const compacted = await compactTranscript('系统', transcript, 5000, {}, model)
  const [older, current] = compacted.filter(m => m.role === 'toolResult')
  assert.ok(older.content[0].text.length < longText.length, '更早一轮的工具输出被压缩')
  assert.equal(current, transcript[6], '当前一轮的工具输出原样保留')
  // 没改动的消息还是原对象（保留推理内容等字段）
  assert.equal(compacted[0], transcript[0])
  assert.equal(compacted[compacted.indexOf(older) - 1].content[0].type, 'toolCall')
})
