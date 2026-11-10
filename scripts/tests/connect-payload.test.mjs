import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildConnectLink, parseConnectLink } = require('../../electron/services/sync/connectPayload.js')

const sync = { baseUrl: 'https://dav.jianguoyun.com/dav', rootPath: '/Flota/', username: 'me@example.com', password: 'abcd efgh 中文' }
const stt = { volcAppId: '123', volcToken: 'tok', volcResourceId: 'volc.bigasr.sauc.duration' }

test('the connect link carries the sync account and round-trips', () => {
  const { link, included } = buildConnectLink({ sync })
  assert.match(link, /^flota:\/\/connect\?d=[A-Za-z0-9_-]+$/)
  assert.deepEqual(included, ['sync'])
  assert.deepEqual(parseConnectLink(link), { v: 1, s: { u: sync.baseUrl, r: '/Flota/', n: 'me@example.com', p: 'abcd efgh 中文' } })
})

test('AI and speech settings are included only when the phone can use them', () => {
  const custom = buildConnectLink({ sync, ai: { provider: 'custom', apiUrl: 'https://x.com/api/v3', apiKey: 'sk-1', model: 'm', apiFormat: 'openai' }, stt }, (u) => `${u}/chat/completions`)
  assert.deepEqual(custom.included, ['sync', 'ai', 'stt'])
  const parsed = parseConnectLink(custom.link)
  assert.deepEqual(parsed.a, { p: 'custom', u: 'https://x.com/api/v3/chat/completions', k: 'sk-1', m: 'm' })
  assert.deepEqual(parsed.t, { i: '123', k: 'tok', r: 'volc.bigasr.sauc.duration' })
  assert.match(buildConnectLink({ ai: { provider: 'anthropic', apiKey: 'k' } }).skipped.ai, /Anthropic/)
  assert.match(buildConnectLink({ ai: { provider: 'custom', apiFormat: 'anthropic', apiKey: 'k' } }).skipped.ai, /Anthropic/)
  assert.match(buildConnectLink({ ai: { provider: 'openai', apiKey: '' } }).skipped.ai, /API Key/)
  assert.match(buildConnectLink({ stt: { volcAppId: '', volcToken: '' } }).skipped.stt, /火山引擎/)
})

test('without a sync account, AI alone still makes a link; nothing chosen makes none', () => {
  const aiOnly = buildConnectLink({ ai: { provider: 'deepseek', apiKey: 'k', model: 'deepseek-chat' } })
  assert.deepEqual(parseConnectLink(aiOnly.link), { v: 1, a: { p: 'deepseek', u: '', k: 'k', m: 'deepseek-chat' } })
  assert.equal(buildConnectLink({}).link, null)
})

test('garbage is rejected', () => {
  assert.equal(parseConnectLink('https://example.com'), null)
  assert.equal(parseConnectLink('flota://connect?d=bm90IGpzb24'), null)
  assert.equal(parseConnectLink(`flota://connect?d=${Buffer.from('{"v":1}').toString('base64url')}`), null)
})
