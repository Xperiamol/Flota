import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const handlersSource = readFileSync(new URL('../../electron/ipc/windowHandlers.js', import.meta.url), 'utf8')
const hookSource = readFileSync(new URL('../../src/hooks/useFitWindowHeight.js', import.meta.url), 'utf8')
  .replace("import { useEffect } from 'react'", '')
  .replace('export default function', 'function')

function setup(zoom) {
  const handlers = new Map()
  const bounds = { x: 100, y: 100, width: 320, height: 300 }
  const sizes = []
  const win = {
    webContents: { getZoomFactor: () => zoom },
    getSize: () => [bounds.width, bounds.height],
    setSize(width, height) { sizes.push([width, height]); Object.assign(bounds, { width, height }) },
  }
  const module = { exports: {} }
  vm.runInNewContext(handlersSource, {
    module, console,
    require(name) {
      if (name === 'electron') return {
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        BrowserWindow: { fromWebContents: () => win },
      }
      if (name === '../utils/saveWindows') return { saveWindow() {} }
      throw new Error(`Unexpected module: ${name}`)
    },
  })
  module.exports.registerWindowHandlers({})
  return { fitHeight: (height) => handlers.get('window:fit-height')({ sender: {} }, height), bounds, sizes }
}

for (const zoom of [0.8, 1, 1.2]) {
  test(`card auto-fit keeps native width stable during repeated movement at page zoom ${zoom}`, async () => {
    const { fitHeight, bounds, sizes } = setup(zoom)
    let observed
    let pending
    let cleanup
    let contentHeight = 180
    const element = { getBoundingClientRect: () => ({ height: contentHeight }) }
    vm.runInNewContext(`${hookSource}\nuseFitWindowHeight({ current: element }, 10, true, 0.9)`, {
      element,
      useEffect: (effect) => { cleanup = effect() },
      ResizeObserver: class {
        constructor(callback) { observed = callback }
        observe() {}
        disconnect() {}
      },
      setTimeout: (callback) => { pending = callback; return 1 },
      clearTimeout: () => { pending = null },
      window: {
        get innerWidth() { return Math.round(bounds.width / zoom) },
        get innerHeight() { return Math.round(bounds.height / zoom) },
        electronAPI: { window: { fitHeight } },
      },
    })
    pending()
    const expectedHeight = Math.round(190 * zoom)
    for (let i = 0; i < 30; i++) {
      bounds.x += 5
      bounds.y += 2
      observed()
      pending()
      assert.equal(bounds.width, 320)
      assert.equal(bounds.height, expectedHeight)
    }
    assert.equal(sizes.length, 1, 'unchanged content must settle after one resize')
    contentHeight = 240
    observed()
    pending()
    assert.equal(bounds.height, Math.round(250 * zoom), 'content can still grow')
    contentHeight = 100
    observed()
    pending()
    assert.equal(bounds.height, Math.round(110 * zoom), 'content can still shrink')
    cleanup()
    assert.equal(pending, null)
  })
}

test('auto-fit rejects invalid heights without changing bounds', async () => {
  const { fitHeight, sizes } = setup(1)
  for (const height of [NaN, Infinity, -10, 0, '200', undefined]) {
    assert.equal(await fitHeight(height), false)
  }
  assert.deepEqual(sizes, [])
})
