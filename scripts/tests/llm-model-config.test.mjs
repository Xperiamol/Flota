import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildModel, buildRequestOptions } = require('../../electron/services/llm/model.js')
const AIService = require('../../electron/services/AIService.js')
const svc = { normalizeApiUrl: AIService.prototype.normalizeApiUrl }

test('temperature is not sent unless the user turns it on', () => {
  const base = { apiKey: 'k', temperature: 0.7 }
  assert.equal(buildRequestOptions(base, { temperature: 0.2 }).temperature, undefined)
  assert.equal(buildRequestOptions({ ...base, temperatureEnabled: false }).temperature, undefined)
  assert.equal(buildRequestOptions({ ...base, temperatureEnabled: true }).temperature, 0.7)
  assert.equal(buildRequestOptions({ ...base, temperatureEnabled: true }, { temperature: 0.2 }).temperature, 0.2)
  assert.equal(buildRequestOptions({ ...base, temperatureEnabled: true, temperature: 5 }).temperature, 2)
})

test('custom endpoints default to OpenAI format', () => {
  const m = buildModel({ provider: 'custom', apiUrl: 'https://relay.example.com/api/v1', model: 'x' }, svc)
  assert.equal(m.api, 'openai-completions')
  assert.equal(m.baseUrl, 'https://relay.example.com/api/v1')
  assert.equal(m.maxTokens, 0)
})

test('custom endpoints can use Anthropic format; base URL is reduced to the root the SDK expects', () => {
  for (const [input, root] of [
    ['https://relay.example.com/api/v1', 'https://relay.example.com/api'],
    ['https://relay.example.com/api/v1/', 'https://relay.example.com/api'],
    ['https://relay.example.com/v1/messages', 'https://relay.example.com'],
    ['https://relay.example.com', 'https://relay.example.com'],
  ]) {
    const m = buildModel({ provider: 'custom', apiFormat: 'anthropic', apiUrl: input, model: 'claude' }, svc)
    assert.equal(m.api, 'anthropic-messages')
    assert.equal(m.baseUrl, root, input)
    assert.ok(m.maxTokens > 0, 'Anthropic requires max_tokens')
    assert.equal(m.compat.supportsEagerToolInputStreaming, false)
  }
})

test('official Anthropic provider uses the official endpoint without relay compat', () => {
  const m = buildModel({ provider: 'anthropic', model: 'claude-sonnet-4-5' }, svc)
  assert.equal(m.api, 'anthropic-messages')
  assert.equal(m.baseUrl, 'https://api.anthropic.com')
  assert.equal(m.compat, undefined)
})

test('apiFormat is ignored for built-in OpenAI-format providers', () => {
  const m = buildModel({ provider: 'deepseek', apiFormat: 'anthropic', model: 'deepseek-chat' }, svc)
  assert.equal(m.api, 'openai-completions')
})

test('pi runtime loads both protocol implementations', async () => {
  const { loadPi } = require('../../electron/services/llm/piRuntime.js')
  const pi = await loadPi()
  assert.equal(typeof pi.streamOpenAI, 'function')
  assert.equal(typeof pi.streamAnthropic, 'function')
})
