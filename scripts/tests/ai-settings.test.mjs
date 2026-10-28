import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const handlers = require('../../electron/services/aichat/tools/handlers/settings')
const AIChatService = require('../../electron/services/aichat')
const PendingActionStore = require('../../electron/services/aichat/PendingActionStore')
const definitions = require('../../electron/services/aichat/settingsCatalog.json')

const service = () => Object.assign(Object.create(AIChatService.prototype), {
  _pendingActions: new PendingActionStore({}), aiService: { settingDAO: { get: () => undefined } },
  _getLongDocPipeline: () => null,
})

test('settings modification produces a readable confirmation before any application', async () => {
  const chat = service()
  const changes = [{ key: 'theme', value: 'dark' }, { key: 'editorShowWordCount', value: false }]
  const pending = JSON.parse(await chat._executeTool('update_settings', { changes }))
  assert.equal(pending.requiresConfirmation, true)
  assert.match(pending.summary, /主题 → 深色/)
  assert.match(pending.summary, /显示字数 → 关闭/)
  assert.equal(pending.settingsChanges, undefined)
  const executed = await chat.executePendingAction(pending.actionId)
  assert.equal(executed.success, true)
  assert.deepEqual(executed.result.settingsChanges, changes)
  assert.equal((await chat.executePendingAction(pending.actionId)).success, false)
})

test('unknown, sensitive, duplicate and invalid settings never produce confirmation cards', async () => {
  const chat = service()
  for (const changes of [[], [{ key: 'ai_api_key', value: 'secret' }], [{ key: 'theme', value: 'purple' }], [{ key: 'editorShowWordCount', value: 'false' }], [{ key: 'noteHistoryLimit', value: 501 }], [{ key: 'noteHistoryIntervalSeconds', value: 1 }], [{ key: 'theme', value: 'dark' }, { key: 'theme', value: 'light' }]]) {
    const result = JSON.parse(await chat._executeTool('update_settings', { changes }))
    assert.equal(result.success, false)
    assert.equal(result.requiresConfirmation, undefined)
  }
  assert.equal(chat._pendingActions._pendingActions.size, 0)
})

test('read tool only exposes the supported catalog and current values, never arbitrary settings', async () => {
  const result = JSON.parse(await handlers.get_settings({}, {}, { appSettings: { theme: 'dark', ai_api_key: 'secret' }, settingDAO: { get: key => key === 'noteHistoryLimit' ? { value: 20 } : undefined } }))
  assert.equal(result.settings.find(item => item.key === 'theme').value, 'dark')
  assert.equal(result.settings.find(item => item.key === 'noteHistoryLimit').value, 20)
  assert.equal(result.settings.find(item => item.key === 'noteHistoryEnabled').value, false)
  assert.ok(!JSON.stringify(result).includes('secret'))
})

const bundled = await build({ entryPoints: ['src/utils/aiCore/appSettings.js'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', plugins: [{ name: 'test-stores', setup(build) {
  build.onResolve({ filter: /store\/use(?:PrefsStore|Store)$/ }, args => ({ path: args.path.includes('Prefs') ? 'prefs' : 'app', namespace: 'test-store' }))
  build.onLoad({ filter: /.*/, namespace: 'test-store' }, args => ({ contents: `export const ${args.path === 'prefs' ? 'usePrefsStore' : 'useStore'} = { getState: () => globalThis.${args.path} }` }))
} }] })
function client(fail = false) {
  const app = { theme: 'light', ai_api_key: 'private' }, prefs = { editorShowWordCount: true }, writes = [], events = []
  for (const setting of definitions.filter(item => item.store === 'app')) app[`set${setting.key[0].toUpperCase()}${setting.key.slice(1)}`] = value => { app[setting.key] = value }
  prefs.setPref = (key, value) => { prefs[key] = value }
  const sandbox = { module: { exports: {} }, app, prefs, Event, window: { electronAPI: { settings: { setMultiple: async values => { writes.push(values); return fail ? { success: false, error: 'disk full' } : { success: true } } } }, dispatchEvent: event => events.push(event.type) } }
  vm.runInNewContext(bundled.outputFiles[0].text, sandbox)
  return { ...sandbox.module.exports, app, prefs, writes, events }
}

test('confirmed changes persist app/database settings and immediately update UI preferences', async () => {
  const c = client()
  await c.applyAISettings([{ key: 'theme', value: 'dark' }, { key: 'noteHistoryEnabled', value: true }, { key: 'editorShowWordCount', value: false }])
  assert.equal(c.writes[0].theme, 'dark')
  assert.equal(c.writes[0].noteHistoryEnabled, true)
  assert.equal(c.writes[0].editorShowWordCount, undefined)
  assert.equal(c.app.theme, 'dark')
  assert.equal(c.prefs.editorShowWordCount, false)
  assert.deepEqual(c.events, ['flota:settings-updated'])
  assert.ok(!JSON.stringify(c.getAppSettingsSnapshot()).includes('private'))
})

test('persistence failure does not report success or apply remaining UI changes', async () => {
  const c = client(true)
  await assert.rejects(c.applyAISettings([{ key: 'theme', value: 'dark' }, { key: 'editorShowWordCount', value: false }]), /disk full/)
  assert.equal(c.app.theme, 'light')
  assert.equal(c.prefs.editorShowWordCount, true)
  assert.equal(c.events.length, 0)
})
