import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { SKILLS, createSkillSession } = require('../../electron/services/aichat/skills')
const { TOOLS } = require('../../electron/services/aichat/tools/schema')
const { getSystemPrompt } = require('../../electron/services/aichat/systemPrompt')
const AIChatService = require('../../electron/services/aichat')
const PendingActionStore = require('../../electron/services/aichat/PendingActionStore')
const config = { enabled: true, provider: 'custom', model: 'test', apiUrl: 'https://test.invalid', apiKey: 'test-only' }
const names = session => session.getTools().map(tool => tool.function.name)
const service = () => Object.assign(Object.create(AIChatService.prototype), {
  aiService: { getConfig: async () => ({ success: true, data: config }), _checkRateLimit() {}, normalizeApiUrl: url => url, settingDAO: { get: () => undefined } },
  logger: { info() {}, warn() {}, error() {} }, _pendingActions: new PendingActionStore({}), _getLongDocPipeline: () => null,
})
const tool = (name, args) => ({ index: 0, id: `${name}-${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
async function mocked(replies, run) {
  const original = global.fetch, requests = []
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    const next = replies.shift()
    assert.ok(next, 'unexpected model round')
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: typeof next === 'string' ? { content: next } : { tool_calls: [next] }, finish_reason: typeof next === 'string' ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
  }
  try { await run(requests) } finally { global.fetch = original }
}

test('all business tools belong to exactly one discoverable skill', () => {
  const assigned = Object.values(SKILLS).flatMap(skill => skill.tools)
  assert.equal(new Set(assigned).size, assigned.length)
  assert.deepEqual([...assigned].sort(), TOOLS.map(tool => tool.function.name).sort())
  const session = createSkillSession({ webSearchEnabled: true })
  for (const id of Object.keys(SKILLS)) assert.ok(session.read(id).instructions.length > 30, id)
})

test('initial request only sees discovery; loading reveals instructions and the chosen tools', async () => {
  const session = createSkillSession()
  assert.deepEqual(names(session), ['read_skill'])
  assert.equal(session.canExecute('edit_note'), false)
  const result = session.read('notes')
  assert.match(result.instructions, /只替换需要改的片段/)
  assert.equal(session.canExecute('edit_note'), false, 'must wait for next request schema publication')
  assert.ok(names(session).includes('edit_note'))
  assert.ok(!names(session).includes('create_widget'))
  assert.ok(!names(session).includes('read_note_image') || session.canExecute('read_note_image'))
  const prompt = await getSystemPrompt({})
  assert.ok(prompt.includes('read_skill'))
  assert.ok(!prompt.includes('design_options') && !prompt.includes('repeat_days'))
})

test('sessions isolate loaded tools, filter disabled capabilities and reject unknown skill names', () => {
  const a = createSkillSession({ disabledTools: ['read_note_image'] }), b = createSkillSession()
  a.read('notes')
  assert.ok(!names(a).includes('read_note_image'))
  assert.deepEqual(names(b), ['read_skill'])
  assert.equal(a.read('web').success, false)
  assert.equal(a.canExecute('web_search'), false)
  assert.equal(a.read('../settings').success, false)
  a.read('notes')
  assert.equal(names(a).length, new Set(names(a)).size)
  const web = createSkillSession({ webSearchEnabled: true })
  web.read('web')
  assert.ok(names(web).includes('web_search'))
})

test('full stream progressively loads settings, reads values, and produces the existing confirmation card', async () => {
  const chat = service(), chunks = []
  await mocked([tool('read_skill', { skill: 'settings' }), tool('get_settings', {}), tool('update_settings', { changes: [{ key: 'theme', value: 'dark' }] }), '已准备好修改，请确认。'], async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '切换深色主题' }], chunk => chunks.push(chunk), { contextPackage: { appSettings: { theme: 'light' } } })
    assert.equal(result.success, true)
    assert.deepEqual(requests[0].tools.map(t => t.function.name), ['read_skill'])
    assert.deepEqual(requests[1].tools.map(t => t.function.name).sort(), ['get_settings', 'read_skill', 'update_settings'])
    const loaded = JSON.parse(requests[1].messages.find(m => m.role === 'tool').content)
    assert.match(loaded.instructions, /先调用 get_settings/)
    const card = chunks.filter(c => c.type === 'tool_end').map(c => JSON.parse(c.result)).find(c => c.requiresConfirmation)
    assert.match(card.summary, /主题 → 深色/)
    assert.equal(chat._pendingActions._pendingActions.size, 1)
  })
})

test('ordinary chat never loads business tools and unopened tool calls cannot create actions', async () => {
  await mocked(['你好。'], async requests => {
    assert.equal((await service().chatStream([{ role: 'user', content: '你好' }], () => {})).success, true)
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].tools.map(t => t.function.name), ['read_skill'])
  })
  const chat = service(), chunks = []
  await mocked([tool('update_settings', { changes: [{ key: 'theme', value: 'dark' }] }), '需要先加载相关能力。'], async () => {
    await chat.chatStream([{ role: 'user', content: '改设置' }], chunk => chunks.push(chunk))
    assert.equal(chat._pendingActions._pendingActions.size, 0)
    // 没开放的工具不在工具列表里，pi 直接返回「找不到工具」，不会执行，也不会生成确认卡
    assert.match(JSON.parse(chunks.find(c => c.type === 'tool_end').result).error, /not found/)
  })
})

test('discovery rounds leave the business budget available and tool-call result adjacency intact', async () => {
  await mocked([tool('read_skill', { skill: 'settings' }), tool('read_skill', { skill: 'notes' }), tool('read_skill', { skill: 'planning' }), tool('get_settings', {}), tool('update_settings', { changes: [{ key: 'theme', value: 'dark' }] }), '请确认。'], async requests => {
    const result = await service().chatStream([{ role: 'user', content: '修改主题' }], () => {})
    assert.equal(result.success, true)
    assert.equal(requests.length, 6)
    assert.ok(requests.at(-2).tools.some(t => t.function.name === 'update_settings'))
    for (const request of requests) for (let i = 0; i < request.messages.length; i++) {
      const calls = request.messages[i].tool_calls
      if (calls) assert.equal(request.messages[i + 1].tool_call_id, calls[0].id)
    }
  })
})


test('repeated discovery is bounded and disabled business tools remain unavailable', async () => {
  await mocked([...Array.from({ length: 4 }, () => tool('read_skill', { skill: 'notes' })), '本轮未执行修改。'], async requests => {
    const result = await service().chatStream([{ role: 'user', content: '查找笔记' }], () => {}, { disabledTools: ['edit_note'] })
    assert.equal(result.success, true)
    assert.equal(requests.length, 5)
    assert.ok(requests.every(request => !request.tools?.some(t => t.function.name === 'edit_note')))
    // 重复无进展后停止调用工具：最后一轮只允许写文字
    assert.equal(requests.at(-1).tool_choice, 'none')
    assert.equal(result.stopReason, 'no_progress')
  })
})


test('search then read a note by ID across more than four pages without a current note', async () => {
  const chat = service()
  const content = '一行长文🙂'.repeat(6000)
  chat.noteDAO = { findAll: () => ({ notes: [{ id: 7, title: '长文', content }] }), findById: () => ({ id: 7, title: '长文', content }) }
  const replies = [tool('read_skill', { skill: 'notes' }), tool('search_notes', { query: '长文' }), ...Array.from({ length: 6 }, (_, i) => tool('read_note', { id: 7, offset: i * 6000, limit: 6000 })), '已读取指定内容。']
  await mocked(replies, async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '读取那篇长文' }], () => {}, { contextPackage: {} })
    assert.equal(result.success, true)
    assert.equal(result.stopReason, undefined)
    assert.equal(requests.length, 9)
    assert.ok(requests.at(-1).tools.some(t => t.function.name === 'read_note'))
  })
})

test('a pending write ends the action phase instead of soliciting duplicate write plans', async () => {
  const chat = service()
  await mocked([tool('read_skill', { skill: 'settings' }), tool('update_settings', { changes: [{ key: 'theme', value: 'dark' }] }), '请确认。'], async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '改深色主题' }], () => {})
    assert.equal(result.taskStatus, 'awaiting_confirmation')
    // 收尾轮只写文字：工具声明保留（避免发空 tools 数组），但不允许再调用
    assert.equal(requests.at(-1).tool_choice, 'none')
    assert.ok(requests.slice(0, -1).every(request => request.tool_choice === undefined))
    assert.equal(chat._pendingActions._pendingActions.size, 1)
  })
})

test('unconfigured memory tools are not exposed after loading other skills', () => {
  const session = createSkillSession({ memoryEnabled: false })
  assert.equal(session.read('memory').success, false)
  session.read('notes')
  assert.ok(!names(session).some(name => SKILLS.memory.tools.includes(name)))
})

test('context budget stops continued retrieval with explicit incomplete state', async () => {
  const { MAX_CONTEXT_TOKENS } = require('../../electron/services/aichat/constants')
  const chat = service()
  // 单条工具结果就超过上下文预算：下一轮不再调用工具，追加说明，标记未完成
  chat._executeTool = async () => JSON.stringify({ content: '字'.repeat(MAX_CONTEXT_TOKENS * 2) })
  await mocked([tool('read_skill', { skill: 'notes' }), tool('read_note', { id: 1 }), '尚未读取完毕。'], async requests => {
    const result = await chat.chatStream([{ role: 'user', content: '读完这篇' }], () => {}, { contextPackage: {} })
    assert.equal(result.taskStatus, 'incomplete')
    assert.equal(result.stopReason, 'context_budget')
    assert.equal(requests.at(-1).tool_choice, 'none')
    assert.match(requests.at(-1).messages.at(-1).content, /达到上下文\/执行预算而停止/)
  })
})
