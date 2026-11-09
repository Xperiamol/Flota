import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)
const DesktopWidgets = require('../../electron/services/widgets/DesktopWidgets.js')

const memoryDAO = () => { const store = new Map(); return { get: (k) => (store.has(k) ? { value: store.get(k) } : null), set: (k, v) => store.set(k, v) } }

class FakeWindow extends EventEmitter {
  constructor(bounds) { super(); this.bounds = { x: 0, y: 0, width: 340, height: 300, ...bounds }; this.destroyed = false; this.focused = 0 }
  isDestroyed() { return this.destroyed }
  getBounds() { return { ...this.bounds } }
  show() {}
  focus() { this.focused++ }
  // 和真实窗口一样，关闭是异步完成的
  close() { setImmediate(() => { this.destroyed = true; this.emit('closed') }) }
}

const setup = ({ instances = { i1: ['compact', 'medium', 'full'], i2: ['medium', 'full'] }, deleted = [] } = {}) => {
  const opened = []
  const windowManager = {
    widgetWindows: new Map(),
    async createWidgetWindow(id, options) {
      const win = new FakeWindow(options.bounds)
      this.widgetWindows.set(id, win)
      win.on('closed', () => { if (this.widgetWindows.get(id) === win) this.widgetWindows.delete(id) })
      opened.push({ id, ...options })
      return {}
    },
  }
  const widgetService = {
    getInstance(id) {
      if (!instances[id]) throw new Error('实例不存在')
      return { instance: { id, deletedAt: deleted.includes(id) ? 1 : null }, widget: { manifest: { sizes: instances[id] } } }
    },
  }
  const screen = { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) }
  const settingDAO = memoryDAO()
  const manager = new DesktopWidgets({ settingDAO, windowManager, widgetService, screen, logger: { warn() {} } })
  return { manager, windowManager, opened, settingDAO }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('pin opens a desktop window in card size, remembers it, and pinning again just focuses it', async () => {
  const { manager, opened, windowManager } = setup()
  const res = await manager.pin('i1', { size: 'compact' })
  assert.deepEqual(res, { pinned: true, size: 'compact' })
  assert.equal(opened[0].desktop, true)
  assert.equal(opened[0].size, 'compact')
  assert.equal(opened[0].alwaysOnTop, false)
  assert.ok(opened[0].bounds.x > 1000, 'new widgets start near the top-right of the screen')
  assert.equal(manager.list().length, 1)
  const again = await manager.pin('i1', { size: 'compact' })
  assert.deepEqual(again, { reused: true })
  assert.equal(windowManager.widgetWindows.get('i1').focused, 1)
  assert.equal(opened.length, 1)
})

test('falls back to a supported size; unknown or trashed instances cannot be pinned', async () => {
  const { manager, opened } = setup({ deleted: ['i3'], instances: { i1: ['compact', 'medium'], i2: ['medium', 'full'], i3: ['compact'] } })
  await manager.pin('i2', { size: 'compact' })
  assert.equal(opened[0].size, 'medium')
  await assert.rejects(manager.pin('nope'), /实例不存在/)
  await assert.rejects(manager.pin('i3'), /实例不存在/)
})

test('moving, resizing and toggling on-top are remembered', async () => {
  const { manager, windowManager } = setup()
  await manager.pin('i1', { size: 'compact' })
  const win = windowManager.widgetWindows.get('i1')
  win.bounds = { x: 200, y: 150, width: 360, height: 280 }
  win.emit('moved'); win.emit('resized')
  await wait(450)
  assert.deepEqual(manager.list()[0].bounds, { x: 200, y: 150, width: 360, height: 280 })
  win.emit('always-on-top-changed', {}, true)
  assert.equal(manager.list()[0].alwaysOnTop, true)
})

test('closing with × removes it from the desktop; quitting the app keeps it for next launch', async () => {
  let ctx = setup()
  await ctx.manager.pin('i1')
  ctx.windowManager.widgetWindows.get('i1').close()
  await wait(5)
  assert.equal(ctx.manager.list().length, 0)

  ctx = setup()
  await ctx.manager.pin('i1')
  await ctx.manager.pin('i2')
  ctx.manager.markQuitting()
  for (const win of [...ctx.windowManager.widgetWindows.values()]) win.close()
  await wait(5)
  assert.equal(ctx.manager.list().length, 2)
})

test('restore on launch: reopens at saved position with saved size and on-top, skips deleted ones, honours the setting', async () => {
  const first = setup()
  await first.manager.pin('i1', { size: 'compact' })
  const win = first.windowManager.widgetWindows.get('i1')
  win.bounds = { x: 300, y: 200, width: 360, height: 280 }
  win.emit('moved')
  win.emit('always-on-top-changed', {}, true)
  await wait(450)
  await first.manager.pin('i2')
  const saved = first.settingDAO

  // next launch, i2 has since been deleted
  const second = setup({ instances: { i1: ['compact', 'medium'] } })
  second.manager.settingDAO = saved
  assert.equal(await second.manager.restoreAll(), 1)
  assert.deepEqual(second.opened[0].bounds, { x: 300, y: 200, width: 360, height: 280 })
  assert.equal(second.opened[0].alwaysOnTop, true)
  assert.equal(second.opened[0].size, 'compact')
  assert.equal(second.manager.list().length, 1, 'deleted instance dropped from the list')

  const third = setup()
  third.manager.settingDAO = saved
  third.manager.setRestoreOnLaunch(false)
  assert.equal(await third.manager.restoreAll(), 0)
  assert.equal(third.opened.length, 0)
  assert.equal(third.manager.getRestoreOnLaunch(), false)
})

test('a saved position on a disconnected monitor is moved back on screen', async () => {
  const ctx = setup()
  ctx.settingDAO.set('desktop_widgets', JSON.stringify([{ instanceId: 'i1', size: 'compact', bounds: { x: 3000, y: 100, width: 340, height: 300 } }]))
  await ctx.manager.restoreAll()
  assert.ok(ctx.opened[0].bounds.x < 1440)
})

test('switching between card and expanded keeps it pinned and reopens at the new size', async () => {
  const { manager, opened, windowManager } = setup()
  await manager.pin('i1', { size: 'compact' })
  await manager.setSize('i1', 'medium')
  assert.equal(manager.list().length, 1)
  assert.equal(manager.list()[0].size, 'medium')
  assert.equal(opened.at(-1).size, 'medium')
  assert.equal(opened.at(-1).bounds.height, 520)
  assert.equal(opened.length, 2, 'a new window really opened instead of reusing the closing one')
  assert.equal(windowManager.widgetWindows.get('i1').destroyed, false)
})
