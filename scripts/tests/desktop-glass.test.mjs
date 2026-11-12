import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const { createDesktopWidgetGlass } = require('../../electron/services/widgets/desktopWidgetGlass')
const appearance = { blur: true, blurSupported: true }

function setup(overrides = {}) {
  const calls = []
  const native = {
    isGlassSupported: () => true,
    addView: (...args) => { calls.push(args); return 0 },
  }
  let loads = 0
  const corners = []
  const material = createDesktopWidgetGlass({
    platform: 'darwin', release: '25.0.0',
    loadGlass: () => { loads++; return native },
    logger: { warn() {} },
    setCorners: (win, radius) => { corners.push(radius); return true },
    ...overrides,
  })
  const win = {
    getNativeWindowHandle: () => Buffer.from([1]),
    setVibrancy: (value) => calls.push(['vibrancy', value]),
  }
  return { material, calls, native, win, corners, loads: () => loads }
}

test('liquid glass replaces vibrancy and mounts a transparent native surface', () => {
  const { material, calls, win, corners, loads } = setup()
  const options = material.options(appearance)
  assert.equal(options.transparent, true)
  assert.equal(options.vibrancy, undefined, 'vibrancy must never cover native glass')
  assert.equal(material.attach(win, appearance), true)
  assert.deepEqual(calls, [[Buffer.from([1]), { cornerRadius: 14, opaque: false }]])
  assert.deepEqual(corners, [14], 'native material and WebContents use the same corner radius')
  material.options(appearance)
  assert.equal(loads(), 1, 'load the native addon only once for multiple cards')
})

test('older macOS and accessibility preferences keep system vibrancy without loading the addon', () => {
  for (const overrides of [
    { release: '24.6.0' },
    { nativeTheme: { prefersReducedTransparency: true } },
    { nativeTheme: { shouldUseHighContrastColors: true } },
  ]) {
    const { material, loads } = setup(overrides)
    const options = material.options(appearance)
    assert.equal(options.vibrancy, 'under-window')
    assert.equal(options.visualEffectState, 'active', 'unfocused desktop cards keep their material')
    assert.equal(loads(), 0)
  }
})

test('missing optional addon and unsupported native glass fall back to ordinary blur', () => {
  for (const loadGlass of [() => { throw new Error('missing binary') }, () => ({ isGlassSupported: () => false })]) {
    const { material } = setup({ loadGlass })
    assert.equal(material.options(appearance).vibrancy, 'under-window')
  }
})

test('failed native attachment falls back without breaking the card', () => {
  for (const addView of [() => -1, () => { throw new Error('native failure') }]) {
    const { material, calls, native, win } = setup()
    native.addView = addView
    assert.equal(material.attach(win, appearance), false)
    assert.deepEqual(calls, [['vibrancy', 'under-window']])
  }
})

test('turning glass off creates a plain transparent window and does not load native code', () => {
  const { material, win, calls, loads } = setup()
  const off = { ...appearance, blur: false }
  assert.equal(material.options(off).vibrancy, undefined)
  material.attach(win, off)
  assert.equal(loads(), 0)
  assert.deepEqual(calls, [])
})

test('Windows keeps Acrylic; Linux keeps transparency without importing a macOS-only dependency', () => {
  for (const platform of ['win32', 'linux']) {
    const { material, win, calls, loads } = setup({ platform })
    const options = material.options(appearance)
    assert.equal(options.backgroundMaterial, platform === 'win32' ? 'acrylic' : undefined)
    assert.equal(options.transparent, platform === 'win32' ? undefined : true)
    material.attach(win, appearance)
    assert.equal(loads(), 0)
    assert.deepEqual(calls, [])
  }
})

test('the glass surface reveals the native material while the opacity slider still reaches opaque', async () => {
  const source = (await readFile(new URL('../../src/hooks/useDesktopWidgetAppearance.js', import.meta.url), 'utf8'))
    .replace(/import .* from 'react'/, '').replace(/export default /g, '').replace(/export /g, '')
  const context = vm.createContext({})
  vm.runInContext(source, context)
  const surface = (blur, opacity) => vm.runInContext(`desktopCardSurfaceSx({ blur: ${blur}, opacity: ${opacity} })({ palette: { mode: 'light' } })`, context)
  assert.equal(surface(true, 0.72).bgcolor, 'rgba(252, 252, 253, 0.518)')
  assert.equal(surface(true, 1).bgcolor, 'rgba(252, 252, 253, 1.000)')
  assert.equal(surface(false, 0.72).bgcolor, 'rgba(252, 252, 253, 0.800)')
  assert.equal(surface(true, 0.72).boxSizing, 'border-box')
  assert.equal(surface(true, 0.72).border, 'none', 'native glass supplies its own edge')
  assert.equal(surface(true, 0.72).boxShadow, undefined, 'no second highlight around native glass')
  assert.notEqual(surface(false, 0.72).border, 'none')
})
