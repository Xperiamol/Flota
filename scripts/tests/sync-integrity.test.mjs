import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const source = fs.readFileSync('electron/services/sync/SyncEngine.js', 'utf8')
const context = { module: { exports: {} }, Buffer, console, process, setTimeout, setImmediate: () => {},
  require(name) {
    if (name === '../../utils/atomicFile') return require('../../electron/utils/atomicFile')
    if (name === './payloadValidation') return require('../../electron/services/sync/payloadValidation')
    if (name.endsWith('userDataPath')) return { getUserDataPath: () => os.tmpdir() }
    if (name.startsWith('.')) return {}
    return require(name)
  },
}
vm.runInNewContext(source, context)
const SyncEngine = context.module.exports
const engine = () => Object.assign(Object.create(SyncEngine.prototype), {
  log() {}, logError() {}, emit() {}, config: { syncCategories: [] },
})

test('索引修复只接受已同步且逐字相同的正文，提交前云端变化仍拒绝', async () => {
  const hash = require('../../electron/services/sync/utils/hash')
  const local = { id: 'note', content: 'known synced body', title: '原有标题', note_type: 'markdown', is_deleted: 0 }
  const entry = { h: hash.calculateMarkdownHash(local.content), t: 1000, d: 0, ext: '.md', meta: { title: local.title } }
  const remote = { ...entry, h: hash.calculateMarkdownHash(''), t: 1, meta: { title: '' } }
  const setup = () => {
    const e = engine()
    let body = local.content
    e.client = { downloadText: async () => body }
    e.storage = {
      calculateNoteHash: note => hash.calculateMarkdownHash(note.content),
      getNoteById: async () => local,
      upsertNote: async () => { throw new Error('修复索引不应改写本地笔记') },
    }
    const task = { fileId: 'note', operation: 'download', remotePath: 'note.md', remoteEntry: remote,
      expectedLocal: local, localEntry: entry, cachedEntry: entry }
    return { e, task, setBody: value => { body = value } }
  }
  const { e, task, setBody } = setup()
  await e.executeDownload(task)
  assert.equal(task.repairedEntry.h, entry.h)
  let saved
  e.loadLocalManifest = () => ({ files: { note: entry } })
  e.saveLocalManifest = value => { saved = value }
  e.config.rootPath = '/Flota/'
  let uploads = 0
  e.client.uploadJson = async (_, manifest) => { uploads++; assert.equal(manifest.files.note.h, entry.h) }
  await e.commit({ files: { note: entry } }, { files: { note: remote } }, [task], { successfulTaskKeys: ['note:download'] })
  assert.equal(saved.files.note.h, entry.h)
  assert.equal(uploads, 1)
  setBody('new edit by another device')
  await assert.rejects(e.commit({ files: { note: entry } }, { files: { note: remote } }, [task],
    { successfulTaskKeys: ['note:download'] }), /云端正文发生变化/)
  assert.equal(uploads, 1)

  for (const scenario of ['different body', 'no baseline', 'local edits', 'edit during download', 'deleted', 'newer index', 'same-time index', 'changed metadata', 'wrong extension']) {
    const { e, task, setBody } = setup()
    if (scenario === 'different body') setBody('unknown cloud body')
    if (scenario === 'no baseline') task.cachedEntry = undefined
    if (scenario === 'local edits') task.cachedEntry = { ...entry, h: hash.calculateMarkdownHash('old') }
    if (scenario === 'edit during download') e.storage.getNoteById = async () => ({ ...local, content: 'new local edit' })
    if (scenario === 'deleted') task.cachedEntry = { ...entry, d: 1 }
    if (scenario === 'newer index') task.remoteEntry = { ...remote, t: entry.t + 1 }
    if (scenario === 'same-time index') task.remoteEntry = { ...remote, t: entry.t }
    if (scenario === 'changed metadata') task.localEntry = { ...entry, meta: { ...entry.meta, extra: 'new source' } }
    if (scenario === 'wrong extension') task.remoteEntry = { ...remote, ext: '.wb', meta: { ...remote.meta, note_type: 'markdown' } }
    await assert.rejects(e.executeDownload(task), /云端正文与同步索引不一致/, scenario)
    assert.equal(task.repairedEntry, undefined)
  }
})

test('索引第 11 项损坏也必须拒绝', () => {
  const manifest = { version: 3, files: {} }
  for (let n = 0; n < 11; n++) manifest.files[n] = { h: 'hash', t: 1, d: 0 }
  assert.equal(engine().isValidManifest(manifest), true)
  manifest.files[10].t = NaN
  assert.equal(engine().isValidManifest(manifest), false)
})

test('中断恢复先验证正文；已提交的索引不重复上传，正文变化时放弃重放', async () => {
  const hash = require('../../electron/services/sync/utils/hash')
  const base = { version: 3, files: { note: { h: hash.calculateMarkdownHash('old'), t: 1, d: 0, ext: '.md' } } }
  const recovery = { version: 3, files: { note: { ...base.files.note, h: hash.calculateMarkdownHash('new'), t: 2 } } }
  for (const scenario of ['unchanged body', 'changed body', 'already committed', 'network failure']) {
    const e = engine()
    let cache = { ...recovery, _pendingCommit: true, _pendingBase: base, _pendingLocalCache: recovery, _pendingPreviousCache: base }
    let uploads = 0, reads = 0
    e.config.rootPath = '/Flota/'
    e._bootstrapManifest = scenario === 'already committed' ? recovery : base
    e.loadLocalManifest = () => cache
    e.saveLocalManifest = value => { cache = value }
    e.storage = { calculateNoteHash: note => hash.calculateMarkdownHash(note.content) }
    e.generateManifest = async () => recovery
    e.computeSyncTasks = async () => []
    e.client = {
      downloadText: async () => {
        reads++
        if (scenario === 'network failure') throw new Error('offline')
        return scenario === 'changed body' ? 'another device body' : 'new'
      },
      uploadJson: async () => { uploads++ },
    }
    if (scenario === 'network failure') {
      await assert.rejects(e.scanAndDiff(), /offline/)
      assert.equal(cache._pendingCommit, true)
    } else {
      const result = await e.scanAndDiff()
      assert.deepEqual(JSON.parse(JSON.stringify(result.remoteManifest)), scenario === 'changed body' ? base : recovery)
      assert.deepEqual(JSON.parse(JSON.stringify(cache)), scenario === 'changed body' ? base : recovery)
    }
    assert.equal(uploads, scenario === 'unchanged body' ? 1 : 0)
    assert.equal(reads, scenario === 'already committed' ? 0 : 1)
  }
})

test('本地索引写失败不能吞掉；保留旧索引', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flota-manifest-test-'))
  try {
    const e = engine()
    e.localManifestPath = path.join(dir, 'manifest.json')
    e.saveLocalManifest({ version: 3, files: {} })
    const before = fs.readFileSync(e.localManifestPath, 'utf8')
    const invalid = { version: 3, files: {} }; invalid.files.self = invalid
    assert.throws(() => e.saveLocalManifest(invalid), /circular/i)
    assert.equal(fs.readFileSync(e.localManifestPath, 'utf8'), before)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('类型转换上传失败仍保留旧文件', async () => {
  const e = engine()
  let deleted = false
  e.client = { delete: async () => { deleted = true }, uploadText: async () => { throw new Error('offline') } }
  await assert.rejects(e.executeUpload({ fileId: 'note', oldRemotePath: 'note.md', remotePath: 'note.wb', data: { content: '{}' } }), /offline/)
  assert.equal(deleted, false)
})

test('资源失败时先持久化补传义务再更新正文，资源与正文分别推进', async () => {
  const e = engine()
  const events = []
  e.config.syncCategories = ['images']
  e.client = { downloadText: async () => 'new text' }
  e.storage = { upsertNote: async () => events.push('body') }
  e.downloadNoteImages = async () => { throw new Error('image missing') }
  e.loadPendingAssets = () => ({})
  e.savePendingAssets = pending => { assert.equal(JSON.stringify(pending.note), '["images"]'); events.push('retry-record') }
  const task = { fileId: 'note', operation: 'download', remotePath: 'note.md', remoteEntry: { ext: '.md' } }
  const result = await e.executeTasks([task])
  assert.deepEqual(events, ['retry-record', 'body'])
  assert.equal(result.success, false)
  assert.equal(result.downloaded, 1)
  assert.equal(result.successfulTaskKeys.length, 1)
  assert.match(task.assetError, /image missing/)
  e.savePendingAssets = () => { throw new Error('disk full') }
  events.length = 0
  await assert.rejects(e.executeDownload(task), /disk full/)
  assert.deepEqual(events, [])
})

const daoContext = { module: { exports: {} }, require: context.require }
vm.runInNewContext(fs.readFileSync('electron/dao/NoteDAO.js', 'utf8'), daoContext)
test('元数据循环引用序列化失败不能清空旧值或插入半条记录', () => {
  const dao = Object.create(daoContext.module.exports.prototype)
  let writes = 0
  dao.getDB = () => ({ transaction: fn => fn, prepare() { writes++; throw new Error('不应执行 SQL') } })
  const circular = {}; circular.self = circular
  assert.throws(() => dao.create({ title: 'test', meta: circular }), /circular/i)
  assert.throws(() => dao.update(1, { content: 'new', meta: circular }), /circular/i)
  assert.equal(writes, 0)
})

test('完整下载失败必须返回失败状态而非成功', async () => {
  const e = engine()
  e.executeDownload = async () => { throw new Error('asset missing') }
  const result = await e.executeTasks([{ operation: 'download', fileId: 'note' }])
  assert.equal(result.errors, 1)
  assert.equal(result.success, false)
  assert.equal(result.successfulTaskKeys.length, 0)
})


test('图片响应为空以及附件网络失败都必须保留重试机会', async () => {
  const e = engine()
  e.config.rootPath = '/Flota/'
  e.extractImageReferences = () => ['flota-test-nonexistent-image.png']
  e.extractAttachmentReferences = () => ['flota-test-nonexistent-attachment.pdf']
  e.client = { downloadBinary: async () => null }
  await assert.rejects(e.downloadNoteImages('content', 'markdown'), /图片下载不完整/)
  e.client.downloadBinary = async () => { throw new Error('offline') }
  await assert.rejects(e.downloadNoteAttachments('content', 'markdown'), /offline/)
})

test('上传依赖图片失败时不能先覆盖云端正文', async () => {
  const e = engine()
  e.config.syncCategories = ['images']
  let wroteBody = false
  e.client = { uploadText: async () => { wroteBody = true } }
  e.uploadNoteImages = async () => { throw new Error('image failed') }
  await assert.rejects(e.executeUpload({ fileId: 'note', remotePath: 'note.md', data: { content: 'new' } }), /image failed/)
  assert.equal(wroteBody, false)
})


test('启动检查的网络或权限错误不触发云端初始化', async () => {
  for (const message of ['WebDAV 服务器错误 (503)', 'WebDAV 权限不足', '解析 JSON 失败']) {
    const e = engine()
    let initialized = false
    e.config.rootPath = '/Flota/'
    e.client = { downloadJson: async () => { throw new Error(message) } }
    e.initializeCleanSlate = async () => { initialized = true }
    await assert.rejects(e.bootstrap(), new RegExp(message.replace(/[()]/g, '.')))
    assert.equal(initialized, false)
  }
})

test('真实客户端的 404 文案触发初始化且正常快照只读一次', async () => {
  const e = engine()
  e.config.rootPath = '/Flota/'
  e.client = { downloadJson: async () => { throw new Error('WebDAV 资源不存在 /Flota/manifest.json') } }
  e.initializeCleanSlate = async () => 'initialized'
  assert.equal(await e.bootstrap(), 'initialized')
  const manifest = { version: 3, files: {} }
  e.client.downloadJson = async () => manifest
  assert.equal(await e.bootstrap(), true)
  assert.equal(e._bootstrapManifest, manifest)
})


test('待办合并下载失败不得上传本地列表', async () => {
  const e = engine()
  let uploaded = false
  e.client = { downloadJson: async () => { throw new Error('offline') }, uploadJson: async () => { uploaded = true } }
  e.storage = { getAllTodos: async () => ({}) }
  await assert.rejects(e.executeMergeTodos({ remotePath: 'todos.json' }), /offline/)
  assert.equal(uploaded, false)
})

test('远端集合缺少本地待办不是删除凭证', async () => {
  const e = engine()
  let deleted = false
  e.client = { downloadJson: async () => [{ id: 'remote', content: 'remote', updated_at: 1 }] }
  e.storage = {
    applyTodos: () => {},
    getAllTodos: async () => ({ local: { id: 'local' } }),
    softDeleteTodo: async () => { deleted = true },
  }
  await e.executeDownload({ fileId: 'global_todos', remotePath: 'todos.json' })
  assert.equal(deleted, false)
})

test('待办后部含无效记录时整批不写入，设置 null 不能当空对象', async () => {
  const e = engine()
  let writes = 0
  e.storage = { applyTodos() { writes++ }, updateSettings() { writes++ } }
  e.client = { downloadJson: async () => [{ id: 'good', content: 'ok' }, null] }
  await assert.rejects(e.executeDownload({ fileId: 'global_todos' }), /ID/)
  e.client.downloadJson = async () => null
  await assert.rejects(e.executeDownload({ fileId: 'global_settings' }), /对象/)
  assert.equal(writes, 0)
})

const widgetContext = { module: { exports: {} }, require: context.require }
vm.runInNewContext(fs.readFileSync('electron/services/sync/WidgetSync.js', 'utf8'), widgetContext)
test('损坏组件索引不能按空云端处理', async () => {
  const e = Object.create(widgetContext.module.exports.prototype)
  e.client = { downloadJson: async () => ({}) }
  await assert.rejects(e.loadRemoteManifest(), /索引格式异常/)
})


test('待办合并索引使用实际上传快照，不读取上传后的新编辑', async () => {
  const e = engine()
  const uploaded = [{ id: 'todo', content: 'uploaded', updated_at: 1000 }]
  const remote = { version: 3, files: {} }
  const task = { fileId: 'global_todos', operation: 'merge-todos', uploadedTodos: uploaded }
  let manifest
  e.config.rootPath = '/Flota/'
  e.loadLocalManifest = () => remote
  e.saveLocalManifest = () => {}
  e.client = { uploadJson: async (_, value) => { manifest = value } }
  e.storage = {
    getAllTodos: async () => { throw new Error('不能用实时数据库代替上传快照') },
    parseTimestamp: value => value,
    calculateTodosHash: value => JSON.stringify(value),
  }
  await e.commit(remote, remote, [task], { successfulTaskKeys: ['global_todos:merge-todos'] })
  assert.equal(manifest.files.global_todos.h, JSON.stringify(uploaded))
})


test('活跃进程的锁超过十分钟仍不可抢占，旧 owner 不可释放新锁', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flota-lock-'))
  try {
    const a = engine(), b = engine()
    a.storage = b.storage = { withSyncLockTransaction: callback => callback() }
    a.lockFilePath = b.lockFilePath = path.join(dir, 'sync.lock')
    a.acquireSyncLock()
    const owner = JSON.parse(fs.readFileSync(a.lockFilePath, 'utf8'))
    owner.startedAt = 1
    fs.writeFileSync(a.lockFilePath, JSON.stringify(owner))
    assert.throws(() => b.acquireSyncLock(), /进行中/)
    fs.writeFileSync(a.lockFilePath, JSON.stringify({ ...owner, token: 'replacement' }))
    a.releaseSyncLock()
    assert.equal(JSON.parse(fs.readFileSync(a.lockFilePath, 'utf8')).token, 'replacement')
    a.isSyncing = true; a._syncStartedAt = 1
    await assert.rejects(a.performSync(), /进行中/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('全量检查只失效本地正文缓存，不能删除云端索引或三向基线', async () => {
  const e = engine()
  let invalidated = false, full = false
  e.storage = { invalidateNoteCache() { invalidated = true } }
  e.client = { delete() { throw new Error('不能删除云端数据') } }
  e.performSync = async force => { full = force; return { success: true } }
  assert.equal((await e.forceFullSync()).success, true)
  assert.equal(invalidated && full, true)
})

test('资源补传仅重试尚未完成的启用类别，完成后不再扫描', async () => {
  const e = engine()
  let pending = { board: ['images', 'attachments'] }, imageCalls = 0, attachmentCalls = 0
  e.config.syncCategories = ['notes', 'images']
  e.storage = { getNoteById: async () => ({ content: '{}', note_type: 'whiteboard' }) }
  e.loadPendingAssets = () => pending
  e.savePendingAssets = value => { pending = value }
  e.getPendingAssetsPath = () => '/not-present-flota-test'
  e.downloadNoteImages = async () => { imageCalls++ }
  e.downloadNoteAttachments = async () => { attachmentCalls++ }
  await e.retryPendingAssets()
  assert.equal(JSON.stringify(pending.board), '["attachments"]')
  await e.retryPendingAssets()
  assert.equal(imageCalls, 1)
  e.config.syncCategories.push('attachments')
  await e.retryPendingAssets()
  assert.equal(attachmentCalls, 1)
  assert.equal(Object.keys(pending).length, 0)
})

test('正文已上传而索引未提交时可幂等重试，其他正文仍拒绝覆盖', async () => {
  const e = engine()
  e._lastRemoteManifest = { files: { note: { ext: '.md', h: 'a'.repeat(32) } } }
  e.storage = { calculateNoteHash: () => 'b'.repeat(32) }
  let current = 'my new body', uploads = 0
  e.client = {
    prepareWrite: async (_path, validate) => { if (!validate(current)) throw new Error('body conflict') },
    uploadText: async () => { uploads++ },
  }
  const task = { fileId: 'note', remotePath: 'note.md', data: { content: 'my new body' } }
  await e.executeUpload(task)
  assert.equal(uploads, 1)
  current = 'another device body'
  await assert.rejects(e.executeUpload(task), /body conflict/)
  assert.equal(uploads, 1)
})

test('释放同步锁临时失败后保留 owner 凭据，下一次可重试', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flota-lock-retry-'))
  try {
    const e = engine(); let busy = false
    e.storage = { withSyncLockTransaction(callback) { if (busy) throw new Error('SQLITE_BUSY'); return callback() } }
    e.lockFilePath = path.join(dir, 'sync.lock')
    e.acquireSyncLock(); const token = e._syncLockToken
    busy = true; e.releaseSyncLock()
    assert.equal(e._syncLockToken, token)
    busy = false; e.acquireSyncLock()
    assert.notEqual(e._syncLockToken, token)
    e.releaseSyncLock(); assert.equal(fs.existsSync(e.lockFilePath), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
