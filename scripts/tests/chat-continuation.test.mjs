import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { streamRequest } = require('../../electron/services/aichat/stream/streamRequest')
const AIChatService = require('../../electron/services/aichat')
const AIService = require('../../electron/services/AIService')
const config = { provider: 'custom', model: 'test-model', apiUrl: 'https://test.invalid/chat/completions', apiKey: 'test-only' }
const aiService = { normalizeApiUrl: value => value }
const response = ({ text = '', finish = 'stop', toolCalls, usage }) => new Response([
  `data: ${JSON.stringify({ choices: [{ delta: { content: text, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }], usage })}\n\n`,
  'data: [DONE]\n\n',
].join(''), { headers: { 'Content-Type': 'text/event-stream' } })
const mockRequests = async (replies, run) => {
  const original = globalThis.fetch, seen = []
  globalThis.fetch = async (_url, options) => {
    seen.push(JSON.parse(options.body))
    const reply = replies.shift()
    assert.ok(reply, 'unexpected extra API request')
    if (reply instanceof Error) throw reply
    if (typeof reply === 'function') return reply(options)
    return response(reply)
  }
  try { await run(seen) } finally { globalThis.fetch = original }
}
const messages = [{ role: 'user', content: '翻译全文，保留 Markdown' }]

test('未限长聊天遇到 length 自动续写，流与最终正文一致、usage 累计、原历史不变', async () => {
  await mockRequests([
    { text: '# 中文\n\n第一', finish: 'length', usage: { completion_tokens: 3 } },
    { text: '# 中文\n\n第一章\n\n第二', finish: 'length', usage: { completion_tokens: 4 } },
    { text: '# 中文\n\n第一章\n\n第二章。', usage: { completion_tokens: 2 } },
  ], async seen => {
    const chunks = []
    const result = await streamRequest(config, messages, 0.5, undefined, chunk => chunks.push(chunk), null, { autoContinue: true }, aiService)
    assert.equal(result.content, '# 中文\n\n第一章\n\n第二章。')
    assert.equal(chunks.filter(c => c.type === 'content').map(c => c.content).join(''), result.content)
    assert.equal(chunks.filter(c => c.type === 'done').length, 1)
    assert.equal(result.finishReason, 'stop')
    assert.equal(result.usage.completion_tokens, 9)
    assert.equal(seen.length, 3)
    assert.ok(seen.every(body => !Object.hasOwn(body, 'max_tokens')))
    assert.ok(seen[0].tools.length > 0)
    assert.equal(seen[1].tools, undefined)
    assert.equal(seen[1].messages.at(-2).content, '# 中文\n\n第一')
    assert.equal(messages.length, 1)
  })
})

test('显式输出限制与结构化生成维持单次请求，不偷偷续写', async () => {
  for (const [maxTokens, options] of [[20, { autoContinue: true }], [undefined, {}]]) {
    await mockRequests([{ text: 'partial', finish: 'length' }], async seen => {
      const result = await streamRequest(config, messages, 0, maxTokens, () => {}, null, options, aiService)
      assert.equal(result.finishReason, 'length')
      assert.equal(seen.length, 1)
      assert.equal(seen[0].max_tokens, maxTokens)
    })
  }
})

test('不续写被截断的工具参数；空续写仍标记不完整', async () => {
  await mockRequests([{ finish: 'length', toolCalls: [{ index: 0, id: 'call', function: { name: 'read_current_note', arguments: '{' } }] }], async seen => {
    const result = await streamRequest(config, messages, 0, undefined, () => {}, null, { autoContinue: true }, aiService)
    assert.equal(result.toolCalls.length, 1)
    assert.equal(seen.length, 1)
  })
  await mockRequests([{ text: 'partial', finish: 'length' }, { text: 'partial' }], async () => {
    const result = await streamRequest(config, messages, 0, undefined, () => {}, null, { autoContinue: true }, aiService)
    assert.equal(result.content, 'partial')
    assert.equal(result.finishReason, 'length')
  })
})

test('续写可取消；后续网络失败不丢失已流出的正文', async () => {
  const controller = new AbortController()
  await mockRequests([{ text: 'partial', finish: 'length' }], async seen => {
    await assert.rejects(streamRequest(config, messages, 0, undefined, chunk => {
      if (chunk.type === 'content') controller.abort()
    }, controller.signal, { autoContinue: true }, aiService), { name: 'AbortError' })
    assert.equal(seen.length, 1)
  })
  await mockRequests([{ text: 'partial', finish: 'length' }, new Error('offline')], async () => {
    let delivered = ''
    await assert.rejects(streamRequest(config, messages, 0, undefined, chunk => {
      if (chunk.type === 'content') delivered += chunk.content
    }, null, { autoContinue: true }, aiService), /offline/)
    assert.equal(delivered, 'partial')
  })
})

test('长文档内部关闭限长时也不发送默认 320000；开启限长时尊重配置', async () => {
  for (const enabled of [false, true]) {
    await mockRequests([{ text: 'generated' }], async seen => {
      const fake = { aiService: { ...aiService, getConfig: async () => ({ success: true, data: { ...config, enabled: true, limitMaxTokens: enabled, maxTokens: 2000 } }) } }
      const result = await AIChatService.prototype._generatePlainText.call(fake, messages)
      assert.equal(result.content, 'generated')
      assert.equal(seen[0].max_tokens, enabled ? 2000 : undefined)
    })
  }
})

test('续写断点跨多个 SSE 分片时保留空格，断点不匹配时不插入错误续文', async () => {
  const first = 'The old stone'
  for (const aligned of [true, false]) {
    await mockRequests([{ text: first, finish: 'length' }, () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: aligned ? 'The old ' : 'Wrong ' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'stone bridge' }, finish_reason: 'stop' }] })}\n\n`,
    ].join(''))], async () => {
      let delivered = ''
      const call = streamRequest(config, messages, 0, undefined, chunk => {
        if (chunk.type === 'content') delivered += chunk.content
      }, null, { autoContinue: true }, aiService)
      if (aligned) {
        const result = await call
        assert.equal(result.content, 'The old stone bridge')
        assert.equal(delivered, result.content)
      } else {
        await assert.rejects(call, /未能对齐断点/)
        assert.equal(delivered, first)
      }
    })
  }
})

test('AIService.chat（画布/SVG 等非流式生成）在未限长时遇到 finish_reason=length 自动续写拼接', async () => {
  const replies = [
    { choices: [{ message: { content: '<svg viewBox="0 0 800 600"><rect width="800"' }, finish_reason: 'length' }], usage: { completion_tokens: 10 } },
    { choices: [{ message: { content: '```svg\nwidth="800" height="600"/></svg>' }, finish_reason: 'stop' }], usage: { completion_tokens: 8 } },
  ]
  const seenBodies = []
  const fakeService = Object.assign(Object.create(AIService.prototype), {
    logger: { warn() {}, error() {} },
    _checkRateLimit() {},
    normalizeApiUrl: value => value,
    getConfig: async () => ({
      success: true,
      data: { ...config, enabled: true, limitMaxTokens: 'false', maxTokens: 2000, temperature: 0.6 },
    }),
    _fetchTextWithTimeout: async (_url, options) => {
      seenBodies.push(JSON.parse(options.body))
      const next = replies.shift()
      return { ok: true, status: 200, text: JSON.stringify(next) }
    },
  })

  const res = await fakeService.chat([{ role: 'user', content: '生成赛博朋克画布' }], { bypassTokenLimit: true })
  assert.equal(res.success, true)
  assert.equal(res.data.content, '<svg viewBox="0 0 800 600"><rect width="800" height="600"/></svg>')
  assert.equal(res.data.finishReason, 'stop')
  assert.equal(res.data.usage.completion_tokens, 18)
  assert.equal(seenBodies.length, 2)
  assert.ok(seenBodies.every(body => !Object.hasOwn(body, 'max_tokens')))
})

test('Claude/推理模型在未限长时避免网关 8192 默认额度耗尽：显式高额度请求与空截断自动升档', async () => {
  // 1) Claude 模型默认带 64000，若上游 400 拒绝则自动降档 32000
  const claudeBodies = []
  const claudeService = Object.assign(Object.create(AIService.prototype), {
    logger: { warn() {}, error() {} },
    _checkRateLimit() {},
    normalizeApiUrl: value => value,
    getConfig: async () => ({
      success: true,
      data: { ...config, model: 'claude-sonnet-5', enabled: true, limitMaxTokens: false, maxTokens: 2000, temperature: 0.7 },
    }),
    _fetchTextWithTimeout: async (_url, options) => {
      const body = JSON.parse(options.body)
      claudeBodies.push(body)
      if (body.max_tokens === 64000) {
        return { ok: false, status: 400, text: JSON.stringify({ error: { message: 'max_tokens too large' } }) }
      }
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: '<svg viewBox="0 0 1200 800"></svg>' }, finish_reason: 'stop' }],
          usage: { completion_tokens: 6000 },
        }),
      }
    },
  })
  const claudeRes = await claudeService.chat([{ role: 'user', content: '创建科幻风格视觉画布' }], { bypassTokenLimit: true })
  assert.equal(claudeRes.success, true)
  assert.equal(claudeRes.data.content, '<svg viewBox="0 0 1200 800"></svg>')
  assert.deepEqual(claudeBodies.map(b => b.max_tokens), [64000, 32000])

  // 2) 非 Claude 命名的推理模型若无 max_tokens 被网关默认额度在 thinking 阶段截断（content=""），自动升档到 64000 重试
  const thinkingBodies = []
  const thinkingService = Object.assign(Object.create(AIService.prototype), {
    logger: { warn() {}, error() {} },
    _checkRateLimit() {},
    normalizeApiUrl: value => value,
    getConfig: async () => ({
      success: true,
      data: { ...config, model: 'custom-reasoner', enabled: true, limitMaxTokens: false, maxTokens: 2000, temperature: 0.7 },
    }),
    _fetchTextWithTimeout: async (_url, options) => {
      const body = JSON.parse(options.body)
      thinkingBodies.push(body)
      if (!body.max_tokens) {
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            choices: [{ message: { content: '' }, finish_reason: 'length' }],
            usage: { completion_tokens: 8192 },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: '<svg>ok</svg>' }, finish_reason: 'stop' }],
          usage: { completion_tokens: 4500 },
        }),
      }
    },
  })
  const thinkingRes = await thinkingService.chat([{ role: 'user', content: '创建画布' }])
  assert.equal(thinkingRes.success, true)
  assert.equal(thinkingRes.data.content, '<svg>ok</svg>')
  assert.deepEqual(thinkingBodies.map(b => b.max_tokens), [undefined, 64000])
})

test('四级渐进式上下文压缩：优先压缩旧工具输出与旧轮次长文本，L3 滑窗不拆散 tool_calls 配对', () => {
  const { trimMessagesToBudget } = require('../../electron/services/aichat/utils')
  const history = [
    { role: 'user', content: '帮我查一下笔记并整理' + 'A'.repeat(1200) },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc_skill', type: 'function', function: { name: 'read_skill', arguments: '{"skill":"notes"}' } }],
    },
    {
      role: 'tool',
      tool_call_id: 'tc_skill',
      content: JSON.stringify({
        success: true,
        skill: 'notes',
        title: '笔记',
        tools: ['read_note'],
        instructions: '# 详细说明\n' + '规则内容\n'.repeat(200),
      }),
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc_read', type: 'function', function: { name: 'read_note', arguments: '{"id":1}' } }],
    },
    {
      role: 'tool',
      tool_call_id: 'tc_read',
      content: JSON.stringify({ id: 1, title: '长笔记', content: '正文段落'.repeat(300) }),
    },
    { role: 'user', content: '继续分析最新一段' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc_latest', type: 'function', function: { name: 'read_note', arguments: '{"id":2}' } }],
    },
    {
      role: 'tool',
      tool_call_id: 'tc_latest',
      content: JSON.stringify({ id: 2, title: '最新笔记', content: '最新正文'.repeat(200) }),
    },
  ]

  // 触发 L1/L2 但不触发 L3 丢弃时，全部消息条数保留，旧 tool 消息被压缩，最新一轮 tool 消息保持原样
  const compacted = trimMessagesToBudget('sys', history, 2600)
  assert.equal(compacted.length, history.length)
  assert.match(compacted[2].content, /L1已压缩 notes 技能说明/)
  assert.match(compacted[4].content, /L1字段 content 已压缩/)
  assert.equal(compacted[7].content, history[7].content)

  // 触发 L3 极小预算时，assistant(tool_calls) 与其紧随的 tool 消息成组保留或淘汰，绝不留下孤立的 role='tool'
  const tight = trimMessagesToBudget('sys', history, 700)
  for (let i = 0; i < tight.length; i++) {
    if (tight[i].role === 'tool') {
      assert.ok(i > 0 && (tight[i - 1].role === 'assistant' || tight[i - 1].role === 'tool'))
    }
  }
})

test('L3 大模型参与压缩：将被挤出的早期轮次归纳为结构化记忆摘要，并支持指纹缓存复用与失败兜底', async () => {
  const { compactHistoryWithLLM } = require('../../electron/services/aichat/utils')
  const cache = new Map()
  let llmCalls = 0
  const longHistory = [
    { role: 'user', content: '第一轮：请围绕 #42《量子计算笔记》帮我制定学习计划。' + '背景细节'.repeat(200) },
    { role: 'assistant', content: '已为你读取 #42 笔记并列出三阶段大纲。' + '阶段说明'.repeat(200) },
    { role: 'user', content: '第二轮：把第一阶段拆成待办事项。' + '补充要求'.repeat(180) },
    { role: 'assistant', content: '已生成 3 条待办确认卡。' + '待办详情'.repeat(180) },
    { role: 'user', content: '第三轮：现在继续整理第二阶段的阅读清单。' },
  ]

  // 首次触发 L3：调用 summarize 生成早期轮次摘要，并注入到保留的近期消息前
  const firstCompacted = await compactHistoryWithLLM('sys', longHistory, 900, {
    cache,
    cacheKey: 'conv_1',
    summarize: async (msgs) => {
      llmCalls += 1
      assert.match(msgs[1].content, /#42《量子计算笔记》/)
      return '用户围绕笔记 #42《量子计算笔记》制定三阶段计划，第一阶段已生成 3 条待办确认卡。'
    },
  })
  assert.equal(llmCalls, 1)
  assert.match(firstCompacted[0].content, /^\[L3早期对话记忆摘要\]/)
  assert.match(firstCompacted[0].content, /#42《量子计算笔记》/)
  assert.equal(firstCompacted.at(-1).content, '第三轮：现在继续整理第二阶段的阅读清单。')

  // 相同被挤出前缀再次请求时直接命中缓存，不重复调用大模型（0 额外延迟）
  const secondCompacted = await compactHistoryWithLLM('sys', longHistory, 900, {
    cache,
    cacheKey: 'conv_1',
    summarize: async () => {
      llmCalls += 1
      return '不应被调用'
    },
  })
  assert.equal(llmCalls, 1)
  assert.equal(secondCompacted[0].content, firstCompacted[0].content)

  // 若大模型摘要失败且无缓存，自动降级至 L4 原子滑窗，不阻断主对话
  const fallbackCompacted = await compactHistoryWithLLM('sys', longHistory, 900, {
    cache: new Map(),
    cacheKey: 'conv_fail',
    summarize: async () => {
      throw new Error('network error')
    },
  })
  assert.equal(fallbackCompacted.at(-1).content, '第三轮：现在继续整理第二阶段的阅读清单。')
})
