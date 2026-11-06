import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
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

const { generateText } = require('../../electron/services/llm/generateText')
const { buildModel, buildRequestOptions } = require('../../electron/services/llm/model')
const textModel = () => buildModel(config, aiService)
const chatService = (overrides = {}) => Object.assign(Object.create(AIChatService.prototype), {
  aiService: { ...aiService, getConfig: async () => ({ success: true, data: { ...config, enabled: true, ...overrides } }), _checkRateLimit() {}, settingDAO: { get: () => undefined } },
  logger: { info() {}, warn() {}, error() {} }, _getLongDocPipeline: () => null,
})

test('长文档等内部生成：截断后自动续写，去掉续写开头的重复，usage 累计，不发 max_tokens 和工具', async () => {
  await mockRequests([
    { text: '# 中文\n\n第一章内容很长', finish: 'length', usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
    // 续写把前文结尾重复了一遍：拼接时去掉
    { text: '第一章内容很长，接着写', finish: 'length', usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 } },
    { text: '第二章。', usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } },
  ], async seen => {
    let streamed = ''
    const result = await generateText({ model: textModel(), messages, requestOptions: buildRequestOptions(config, {}), onToken: t => { streamed += t }, autoContinue: true })
    assert.equal(result.content, '# 中文\n\n第一章内容很长，接着写第二章。')
    assert.equal(streamed, result.content)
    assert.equal(result.finishReason, 'stop')
    assert.equal(result.usage.completion_tokens, 9)
    assert.equal(seen.length, 3)
    assert.ok(seen.every(body => !Object.hasOwn(body, 'max_tokens') && !Object.hasOwn(body, 'tools')))
    // 续写请求带上已写的部分和「从断点接着写」
    assert.equal(seen[1].messages.at(-2).content, '# 中文\n\n第一章内容很长')
    assert.match(seen[1].messages.at(-1).content, /从断点处直接接着写/)
    assert.equal(messages.length, 1)
  })
})

test('显式输出限制或未要求续写：只请求一次，保留截断状态', async () => {
  for (const [maxTokens, autoContinue] of [[20, true], [undefined, false]]) {
    await mockRequests([{ text: 'partial', finish: 'length' }], async seen => {
      const result = await generateText({ model: textModel(), messages, requestOptions: buildRequestOptions(config, { maxTokens }), autoContinue: autoContinue && !maxTokens })
      assert.equal(result.finishReason, 'length')
      assert.equal(result.truncated, true)
      assert.equal(seen.length, 1)
      assert.equal(seen[0].max_tokens, maxTokens)
    })
  }
})

test('主对话不偷偷续写：截断时标记 truncated，由界面提示用户发送「继续」', async () => {
  await mockRequests([{ text: '很长的回答写到一半', finish: 'length' }], async seen => {
    const result = await chatService().chatStream([{ role: 'user', content: '写一篇长文' }], () => {})
    assert.equal(seen.length, 1)
    assert.equal(result.success, true)
    assert.equal(result.truncated, true)
    assert.equal(result.fullContent, '很长的回答写到一半')
  })
})

test('生成可取消；网络失败不丢失已流出的正文', async () => {
  const controller = new AbortController()
  await mockRequests([{ text: 'partial', finish: 'length' }], async () => {
    await assert.rejects(generateText({
      model: textModel(), messages, autoContinue: true,
      requestOptions: buildRequestOptions(config, { signal: controller.signal }),
      onToken: () => controller.abort(),
    }), { name: 'AbortError' })
  })
  await mockRequests([{ text: 'partial', finish: 'length' }, new Error('offline')], async () => {
    let delivered = ''
    await assert.rejects(generateText({
      model: textModel(), messages, autoContinue: true, requestOptions: { ...buildRequestOptions(config, {}), maxRetries: 0 },
      onToken: t => { delivered += t },
    }), /offline|Connection error|fetch/i)
    assert.equal(delivered, 'partial')
  })
})

test('长文档内部关闭限长时不发送 max_tokens；开启限长时尊重配置', async () => {
  for (const enabled of [false, true]) {
    await mockRequests([{ text: 'generated' }], async seen => {
      const fake = { aiService: { ...aiService, getConfig: async () => ({ success: true, data: { ...config, enabled: true, limitMaxTokens: enabled, maxTokens: 2000 } }) } }
      const result = await AIChatService.prototype._generatePlainText.call(fake, messages)
      assert.equal(result.content, 'generated')
      assert.equal(seen[0].max_tokens, enabled ? 2000 : undefined)
    })
  }
})

test('AIService.chat（画布/SVG 等非流式生成）未限长时截断会自动续写拼接，去掉续写开头的代码块标记', async () => {
  const fakeService = Object.assign(Object.create(AIService.prototype), {
    logger: { warn() {}, error() {} },
    _checkRateLimit() {},
    normalizeApiUrl: value => value,
    getConfig: async () => ({ success: true, data: { ...config, enabled: true, limitMaxTokens: 'false', maxTokens: 2000, temperature: 0.6 } }),
  })
  await mockRequests([
    { text: '<svg viewBox="0 0 800 600"><rect width="800"', finish: 'length', usage: { prompt_tokens: 1, completion_tokens: 10, total_tokens: 11 } },
    { text: '```svg\n height="600"/></svg>', usage: { prompt_tokens: 1, completion_tokens: 8, total_tokens: 9 } },
  ], async seen => {
    const res = await fakeService.chat([{ role: 'user', content: '生成赛博朋克画布' }], { bypassTokenLimit: true })
    assert.equal(res.success, true)
    assert.equal(res.data.content, '<svg viewBox="0 0 800 600"><rect width="800" height="600"/></svg>')
    assert.equal(res.data.finishReason, 'stop')
    assert.equal(res.data.usage.completion_tokens, 18)
    assert.equal(seen.length, 2)
    assert.ok(seen.every(body => !Object.hasOwn(body, 'max_tokens')))
  })
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
