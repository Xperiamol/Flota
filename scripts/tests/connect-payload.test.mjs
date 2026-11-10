import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildConnectLink, parseConnectLink } = require('../../electron/services/sync/connectPayload.js')

const sync = { baseUrl: 'https://dav.jianguoyun.com/dav', rootPath: '/Flota/', username: 'me@example.com', password: 'abcd efgh 中文' }

test('the connect link carries the sync account and round-trips', () => {
  const { link, aiIncluded } = buildConnectLink(sync)
  assert.match(link, /^flota:\/\/connect\?d=[A-Za-z0-9_-]+$/)
  assert.equal(aiIncluded, false)
  assert.deepEqual(parseConnectLink(link), { v: 1, s: { u: sync.baseUrl, r: '/Flota/', n: 'me@example.com', p: 'abcd efgh 中文' } })
})

test('AI settings are included only when the phone can use them', () => {
  const custom = buildConnectLink(sync, { provider: 'custom', apiUrl: 'https://x.com/api/v3', apiKey: 'sk-1', model: 'm', apiFormat: 'openai' }, (u) => `${u}/chat/completions`)
  assert.equal(custom.aiIncluded, true)
  assert.deepEqual(parseConnectLink(custom.link).a, { p: 'custom', u: 'https://x.com/api/v3/chat/completions', k: 'sk-1', m: 'm' })
  assert.equal(buildConnectLink(sync, { provider: 'deepseek', apiKey: 'k', model: 'deepseek-chat' }).aiIncluded, true)
  assert.match(buildConnectLink(sync, { provider: 'anthropic', apiKey: 'k' }).aiSkippedReason, /Anthropic/)
  assert.match(buildConnectLink(sync, { provider: 'custom', apiFormat: 'anthropic', apiKey: 'k' }).aiSkippedReason, /Anthropic/)
  assert.match(buildConnectLink(sync, { provider: 'openai', apiKey: '' }).aiSkippedReason, /API Key/)
})

test('garbage is rejected', () => {
  assert.equal(parseConnectLink('https://example.com'), null)
  assert.equal(parseConnectLink('flota://connect?d=bm90IGpzb24'), null)
})
