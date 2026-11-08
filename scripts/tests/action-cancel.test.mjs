import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
test('ai:cancel-pending-action aborts the running confirmation card for the same window only', async () => {
  const handlers = new Map()
  const origLoad = Module._load
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) } }
    return origLoad.call(this, request, ...rest)
  }
  try {
    delete require.cache[require.resolve('../../electron/ipc/aiHandlers.js')]
    delete require.cache[require.resolve('../../electron/ipc/helpers.js')]
    const reg = require('../../electron/ipc/aiHandlers.js')
    let seenSignal
    const services = { aiChatService: { executePendingAction: (_id, _o, _f, runtime) => new Promise((resolve) => {
      seenSignal = runtime.abortSignal
      runtime.abortSignal.addEventListener('abort', () => resolve({ success: false, error: '已停止' }))
    }) } }
    ;(reg.registerAIHandlers || reg)(services)
    const sender = { id: 7, isDestroyed: () => false, send() {} }
    const running = handlers.get('ai:execute-pending-action')({ sender }, 'act1')
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(await handlers.get('ai:cancel-pending-action')({ sender: { id: 8 } }, 'act1'), { success: false })
    assert.equal(seenSignal.aborted, false)
    assert.deepEqual(await handlers.get('ai:cancel-pending-action')({ sender }, 'act1'), { success: true })
    assert.equal((await running).error, '已停止')
    assert.deepEqual(await handlers.get('ai:cancel-pending-action')({ sender }, 'act1'), { success: false })
  } finally {
    Module._load = origLoad
  }
})
