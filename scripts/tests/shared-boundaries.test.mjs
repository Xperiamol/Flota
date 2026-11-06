import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { build } from 'esbuild'

// Bundle real frontend modules, retaining their actual imports and implementation.
const loadFrontend = async (file) => {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { default: ImageResolver } = await loadFrontend('src/utils/ImageProtocolResolver.js')
const { imageAPI } = await loadFrontend('src/api/imageAPI.js')
const { messageText } = await loadFrontend('src/utils/aiCore/messageModel.js')
const pathSource = await readFile(new URL('../../electron/utils/userDataPath.js', import.meta.url), 'utf8')
const loadPathResolver = (platform, env, electron) => {
  const context = {
    module: { exports: {} }, process: { platform, env },
    require: (name) => {
      if (name === 'path') return platform === 'win32' ? path.win32 : path.posix
      if (electron instanceof Error) throw electron
      return electron
    },
  }
  vm.runInNewContext(pathSource, context)
  return context.module.exports.getUserDataPath
}

test('data directory preserves standalone platform paths and missing Electron fallback', () => {
  for (const electron of [{}, new Error('not installed')]) {
    assert.equal(loadPathResolver('darwin', { HOME: '/home/test' }, electron)(), '/home/test/Library/Application Support/Flota')
    assert.equal(loadPathResolver('linux', { HOME: '/home/test' }, electron)(), '/home/test/.config/Flota')
    assert.equal(loadPathResolver('win32', { USERPROFILE: 'C:\\Users\\test', APPDATA: 'D:\\AppData' }, electron)(), 'D:\\AppData\\Flota')
    assert.equal(loadPathResolver('win32', { USERPROFILE: 'C:\\Users\\test' }, electron)(), 'C:\\Users\\test\\Flota')
  }
})

test('Electron path overrides are read on every call', () => {
  let directory = '/isolated/first'
  const resolve = loadPathResolver('darwin', {}, { app: { getPath: key => { assert.equal(key, 'userData'); return directory } } })
  assert.equal(resolve(), directory)
  directory = '/isolated/second'
  assert.equal(resolve(), directory)
})

test('app and relative image paths share in-flight fetches and successful cache entries', async () => {
  const resolver = new ImageResolver()
  let finish, calls = 0
  resolver.fetchImage = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  const first = resolver.resolve('app://images/a.png?t=1')
  const second = resolver.resolve('images/a.png')
  assert.equal(calls, 1)
  finish('app://images/a.png')
  assert.deepEqual(await Promise.all([first, second]), ['app://images/a.png', 'app://images/a.png'])
  assert.equal(await resolver.resolve('app://images/a.png?t=2'), 'app://images/a.png')
  assert.equal(calls, 1)
  assert.equal(resolver.pendingRequests.size, 0)
  resolver.clearCache()
  assert.equal(resolver.cache.size, 0)
})

test('failed and placeholder image requests remain retryable', async () => {
  const resolver = new ImageResolver()
  resolver.fetchImage = async () => { throw new Error('offline') }
  await assert.rejects(resolver.resolve('app://images/a.png'), /offline/)
  assert.equal(resolver.pendingRequests.size, 0)
  resolver.fetchImage = async () => resolver.getPlaceholderImage()
  await resolver.resolve('images/a.png')
  assert.equal(resolver.cache.size, 0)
  resolver.fetchImage = async () => 'app://images/a.png'
  assert.equal(await resolver.resolve('images/a.png'), 'app://images/a.png')
})

test('external image URLs bypass storage lookup', async () => {
  const resolver = new ImageResolver()
  resolver.fetchImage = () => { throw new Error('unexpected lookup') }
  for (const src of ['https://example.com/a.png', 'http://example.com/a.png', 'data:image/png;base64,abc', 'file:///tmp/a.png']) {
    assert.equal(await resolver.resolve(src), src)
  }
  assert.equal(await resolver.resolve(''), null)
})

test('image API wrappers preserve arguments, results and both failure modes', async (t) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  t.mock.method(console, 'error', () => {})
  for (const [method, args] of Object.entries({ saveFromBuffer: [new Uint8Array([1, 2]), 'a.jpg'], saveFromPath: ['/tmp/a.png', 'a.png'], selectFile: [], getPath: ['images/a.png'], getBase64: ['images/a.png'], delete: ['images/a.png'] })) {
    const images = { [method]: async (...actual) => { assert.deepEqual(actual, args); return { success: true, data: 'saved' } } }
    globalThis.window = { electronAPI: { images } }
    assert.equal(await imageAPI[method](...args), 'saved')
    images[method] = async () => ({ success: false, error: 'disk full' })
    await assert.rejects(imageAPI[method](...args), /disk full/)
    const failure = new Error('IPC closed')
    images[method] = async () => { throw failure }
    await assert.rejects(imageAPI[method](...args), error => error === failure)
  }
})

test('message text preserves multimodal text order', () => {
  assert.equal(messageText('hello'), 'hello')
  assert.equal(messageText(null), '')
  assert.equal(messageText([null, { type: 'text', text: 'first' }, { type: 'image_url', image_url: { url: 'image' } }, { type: 'text', text: 'second' }]), 'first\nsecond')
})


test('独立窗口保存失败不得把未落盘内容写成已保存的 store 快照', async () => {
  const { useStandaloneStore } = await loadFrontend('src/store/useStandaloneStore.js')
  const previousWindow = globalThis.window
  try {
    globalThis.window = { electronAPI: { notes: { update: async () => ({ success: false, error: 'disk full' }) } } }
    useStandaloneStore.setState({ notes: [{ id: 1, content: 'persisted' }] })
    const result = await useStandaloneStore.getState().updateNote(1, { content: 'not persisted' })
    assert.equal(result.success, false)
    assert.equal(useStandaloneStore.getState().notes[0].content, 'persisted')
  } finally { globalThis.window = previousWindow }
})

const { preserveWhiteboardFileMap } = await loadFrontend('src/utils/whiteboardFileMap.js')
test('缺图画布保存仍保留图片路径，已删除元素的引用才移除', () => {
  const map = preserveWhiteboardFileMap([
    { type: 'image', fileId: 'missing' }, { type: 'image', fileId: 'new' },
    { type: 'image', fileId: 'deleted', isDeleted: true },
  ], { new: { fileName: 'new.png' } }, JSON.stringify({ fileMap: {
    missing: { fileName: 'pending.png' }, deleted: { fileName: 'old.png' },
  } }))
  assert.deepEqual(map, { missing: { fileName: 'pending.png' }, new: { fileName: 'new.png' } })
})

const { default: SaveQueue } = await loadFrontend('src/utils/SaveQueue.js')
test('保存队列不提前完成同一笔记后续请求，失败必须经成功重试才解除屏障', async () => {
  const queue = new SaveQueue()
  let release, secondFinished = false
  const first = queue.add('note', () => new Promise(resolve => { release = resolve }))
  const second = queue.add('note', async () => { secondFinished = true })
  await Promise.resolve()
  assert.equal(secondFinished, false)
  release()
  await Promise.all([first, second, queue.flush()])
  assert.equal(secondFinished, true)
  await assert.rejects(queue.add('note', async () => ({ success: false, error: 'disk full' })), /disk full/)
  await assert.rejects(queue.flush(), /保存失败/)
  await queue.add('note', async () => ({ success: true }))
  await queue.flush()
})
