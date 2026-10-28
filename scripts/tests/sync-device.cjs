// 同步端到端测试里的"一台设备"：用 Electron 自带的 Node 跑（better-sqlite3 是按 Electron ABI 编译的），
// 真实的 SQLite 数据库 + NoteService 保存路径 + SyncEngine，只把 WebDAV 换成本地目录。
// 用法：ELECTRON_RUN_AS_NODE=1 electron sync-device.cjs <云端目录> '<操作 JSON 数组>'
// 设备身份由环境变量 HOME 决定（userData、数据库、sync-manifest.json、device-id 都在 HOME 下）。
const fs = require('node:fs')
const path = require('node:path')

const [remoteDir, opsJson] = process.argv.slice(2)
const ops = JSON.parse(opsJson)

// 同步与数据库模块日志很多，测试只要结果
const print = console.log.bind(console)
if (!process.env.SYNC_TEST_VERBOSE) {
  console.log = () => {}
  console.info = () => {}
  console.warn = () => {}
}

class FolderDav {
  constructor(root) {
    this.root = root
    this.calls = []
    for (const name of ['exists', 'createDirectory', 'uploadText', 'uploadBinary', 'downloadText', 'downloadBinary', 'delete', 'list']) {
      const method = this[name].bind(this)
      this[name] = async (...args) => {
        this.calls.push({ method: name, path: args[0] })
        return method(...args)
      }
    }
  }
  file(remotePath) { return path.join(this.root, remotePath) }
  async testConnection() { return true }
  async exists(remotePath) { return fs.existsSync(this.file(remotePath)) }
  async createDirectory(remotePath) { fs.mkdirSync(this.file(remotePath), { recursive: true }) }
  async uploadText(remotePath, content) {
    if (this.failUpload && remotePath.includes(this.failUpload)) throw new Error('模拟上传中断');
    fs.mkdirSync(path.dirname(this.file(remotePath)), { recursive: true })
    fs.writeFileSync(this.file(remotePath), content, 'utf8')
  }
  async uploadJson(remotePath, data) { await this.uploadText(remotePath, JSON.stringify(data, null, 2)) }
  async uploadBinary(remotePath, buffer) {
    fs.mkdirSync(path.dirname(this.file(remotePath)), { recursive: true })
    fs.writeFileSync(this.file(remotePath), buffer)
  }
  async downloadText(remotePath) {
    // 模拟网络错误：路径里含 failPattern 的文件下载失败（坚果云 503 之类）
    if (this.failPattern && remotePath.includes(this.failPattern)) throw new Error(`服务器错误 503: ${remotePath}`)
    // 与 webdavClient 一致：404 抛出含"不存在"的错误，SyncEngine 靠它识别
    if (!fs.existsSync(this.file(remotePath))) throw new Error(`文件不存在: ${remotePath}`)
    return fs.readFileSync(this.file(remotePath), 'utf8')
  }
  async downloadJson(remotePath) { return JSON.parse(await this.downloadText(remotePath)) }
  async downloadBinary(remotePath) {
    if (!fs.existsSync(this.file(remotePath))) throw new Error(`文件不存在: ${remotePath}`)
    return fs.readFileSync(this.file(remotePath))
  }
  async delete(remotePath) { fs.rmSync(this.file(remotePath), { recursive: true, force: true }) }
  async list(remotePath) {
    const dir = this.file(remotePath)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).map(entry => ({
      href: path.posix.join(remotePath, entry.name) + (entry.isDirectory() ? '/' : ''),
      isDirectory: entry.isDirectory(),
    }))
  }
}

;(async () => {
  const DatabaseManager = require('../../electron/dao/DatabaseManager')
  await DatabaseManager.getInstance().initialize()
  const NoteService = require('../../electron/services/NoteService')
  const SyncEngine = require('../../electron/services/sync/SyncEngine')
  const notes = new NoteService()
  const db = DatabaseManager.getInstance().getDatabase()
  const byTitle = (title) => {
    const row = db.prepare('SELECT * FROM notes WHERE title = ? ORDER BY id DESC').get(title)
    if (!row) throw new Error(`没有标题为「${title}」的笔记`)
    return row
  }
  const expectOk = (result, label) => { if (!result?.success) throw new Error(`${label} 失败: ${result?.error}`) ; return result }

  const engine = new SyncEngine({ username: 'test', password: 'test', rootPath: '/Flota/', syncCategories: ['notes', 'todos', 'settings'] })
  engine.client = new FolderDav(remoteDir)

  const outputs = []
  for (const op of ops) {
    switch (op.op) {
      case 'rollbackRemoteEntry': {
        const file = path.join(remoteDir, 'Flota', 'manifest.json')
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
        const entry = manifest.files[byTitle(op.title).sync_id]
        entry.h = require('../../electron/services/sync/utils/hash').calculateMarkdownHash('')
        entry.t = entry.c
        entry.meta.title = ''
        fs.writeFileSync(file, JSON.stringify(manifest))
        outputs.push({ rolledBack: true })
        break
      }
      case 'draftChecks': {
        const Drafts = require('../../electron/services/EditorDraftService')
        const drafts = new Drafts(DatabaseManager.getInstance())
        const note = byTitle(op.title)
        drafts.stage({ key: 'crash', noteId: note.id, revision: 1, updates: { content: '未保存输入', note_type: 'markdown' } })
        drafts.stage({ key: 'crash', noteId: note.id, revision: 2, updates: { content: '更新的未保存输入', note_type: 'markdown' } })
        drafts.clear({ key: 'crash', revision: 1 })
        const before = db.prepare('SELECT count(*) AS n FROM editor_drafts').get().n
        const recovered = drafts.recover()
        outputs.push({ before, recovered, second: drafts.recover(), original: byTitle(op.title).content,
          restored: byTitle(op.title + '（恢复草稿）').content })
        break
      }
      case 'revisionChecks': {
        const row = byTitle(op.title)
        const key = row.sync_id || String(row.id)
        const first = await engine.storage.getAllNotes()
        const oldHash = engine.storage.calculateNoteHash(first[key])
        db.prepare('UPDATE notes SET content = ? WHERE id = ?').run('same timestamp changed body', row.id)
        const second = await engine.storage.getAllNotes()
        const newHash = engine.storage.calculateNoteHash(second[key])
        db.prepare('DELETE FROM notes WHERE id = ?').run(row.id)
        const third = await engine.storage.getAllNotes()
        outputs.push({ oldHash, newHash, content: second[key].content, oldContent: first[key].content, deleted: !third[key] })
        break
      }
      case 'create':
        expectOk(await notes.createNote({ title: op.title, content: op.content, note_type: op.noteType }), 'create')
        break
      case 'edit': // 编辑器自动保存：标题、正文、标签一起提交
        expectOk(await notes.updateNote(byTitle(op.title).id, { title: op.title, content: op.content, tags: '' }), 'edit')
        break
      case 'touch': { // 没有改动的保存（切换笔记、失焦时的自动保存也会走这里）
        const row = byTitle(op.title)
        expectOk(await notes.updateNote(row.id, { title: row.title, content: row.content, tags: row.tags || '' }), 'touch')
        break
      }
      case 'rename':
        expectOk(await notes.updateNote(byTitle(op.title).id, { title: op.to }), 'rename')
        break
      case 'pin':
        expectOk(await notes.togglePinNote(byTitle(op.title).id), 'pin')
        break
      case 'delete':
        expectOk(await notes.deleteNote(byTitle(op.title).id), 'delete')
        break
      case 'purge': // 回收站里永久删除（清空回收站 / 自动清理）
        expectOk(await notes.permanentDeleteNote(byTitle(op.title).id), 'purge')
        break
      case 'restore':
        expectOk(await notes.restoreNote(byTitle(op.title).id), 'restore')
        break
      case 'shiftClock': // 模拟本机时钟偏差：把这篇笔记的修改时间整体挪动若干秒
        db.prepare("UPDATE notes SET updated_at = datetime(updated_at, ?) WHERE id = ?").run(`${op.seconds >= 0 ? '+' : ''}${op.seconds} seconds`, byTitle(op.title).id)
        break
      case 'failDownloadOf': { // 让这篇笔记的正文下载失败（按标题找云端 manifest 里的 id）
        const manifest = JSON.parse(fs.readFileSync(path.join(remoteDir, 'Flota', 'manifest.json'), 'utf8'))
        const id = Object.keys(manifest.files).find((key) => manifest.files[key]?.meta?.title === op.title)
        if (!id) throw new Error(`云端没有「${op.title}」`)
        engine.client.failPattern = id
        break
      }
      case 'editDuringDownload': {
        const original = engine.client.downloadText.bind(engine.client)
        let edited = false
        engine.client.downloadText = async (remotePath) => {
          const content = await original(remotePath)
          if (!edited && remotePath.includes('/notes/')) {
            edited = true
            expectOk(await notes.updateNote(byTitle(op.title).id, { content: op.content }), 'concurrent edit')
          }
          return content
        }
        break
      }
      case 'widget': {
        const WidgetDAO = require('../../electron/dao/WidgetDAO')
        const dao = new WidgetDAO()
        dao.insertWidget({ id: 'perf-widget', name: '同步测试', code: '<p>hello</p>' })
        dao.insertInstance({ id: 'perf-instance', widgetId: 'perf-widget', name: '默认' })
        dao.insertRecords('perf-instance', 'items', [{ id: 'item-1', title: '保留数据' }])
        break
      }
      case 'seedNotes': {
        const padding = 'x'.repeat(op.bodyBytes)
        db.transaction(() => {
          for (let i = 0; i < op.count; i++) notes.noteDAO.create({ title: `bench-${i}`, content: `${i}\n${padding}` }, { skipChangeLog: true })
        })()
        break
      }
      case 'measureSync': {
        const { performance } = require('node:perf_hooks')
        const phases = {}
        const originals = {}
        for (const name of ['bootstrap', 'scanAndDiff', 'executeTasks', 'commit']) {
          originals[name] = engine[name]
          engine[name] = async function (...args) {
            const start = performance.now()
            try { return await originals[name].apply(this, args) }
            finally { phases[name] = performance.now() - start }
          }
        }
        let heartbeat = performance.now(), maxGap = 0
        const timer = setInterval(() => {
          const now = performance.now()
          maxGap = Math.max(maxGap, now - heartbeat)
          heartbeat = now
        }, 5)
        engine.client.calls = []
        const start = performance.now()
        try {
          const result = await engine.performSync()
          const duration = performance.now() - start
          await new Promise(resolve => setTimeout(resolve, 10))
          outputs.push({ op: 'measureSync', durationMs: duration, maxTimerGapMs: maxGap, phases,
            requests: engine.client.calls.length, writes: engine.client.calls.filter(call => call.method.startsWith('upload')).length,
            uploaded: result.uploaded, downloaded: result.downloaded, errors: result.errors })
        } finally {
          clearInterval(timer)
          for (const [name, original] of Object.entries(originals)) engine[name] = original
        }
        break
      }
      case 'measureSave': {
        const { performance } = require('node:perf_hooks')
        const samples = []
        const note = byTitle('bench-0')
        for (let i = 0; i < 20; i++) {
          const start = performance.now()
          expectOk(await notes.updateNote(note.id, { content: `${note.content}\nedit-${i}` }), 'save')
          samples.push(performance.now() - start)
        }
        samples.sort((a, b) => a - b)
        outputs.push({ op: 'measureSave', medianMs: samples[10], p95Ms: samples[18], maxMs: samples[19] })
        break
      }
      case 'createTodo':
        engine.storage.todoDAO.create({ content: op.content })
        break
      case 'deleteTodo': {
        const row = db.prepare('SELECT id FROM todos WHERE content = ?').get(op.content)
        engine.storage.todoDAO.softDelete(row.id)
        break
      }
      case 'dumpTodos':
        outputs.push({ todos: db.prepare('SELECT content, is_deleted FROM todos ORDER BY content').all() })
        break
      case 'transactionChecks': {
        const dao = notes.noteDAO
        const beforeCount = db.prepare('SELECT count(*) AS n FROM notes').get().n
        const original = dao.syncTagUsage
        const errors = []
        dao.syncTagUsage = () => { throw new Error('模拟标签更新失败') }
        try {
          try { dao.create({ title: 'partial', content: 'partial', tags: 'new-tag' }) } catch (e) { errors.push(e.message) }
          try { dao.update(byTitle(op.title).id, { content: 'partial', tags: 'new-tag' }) } catch (e) { errors.push(e.message) }
        } finally { dao.syncTagUsage = original }
        const todoCount = db.prepare('SELECT count(*) AS n FROM todos').get().n
        try {
          engine.storage.applyTodos([
            { id: 'transaction-good', content: 'good', updated_at: Date.now() },
            { id: 'transaction-bad', content: 'bad', description: {}, updated_at: Date.now() },
          ])
        } catch (e) { errors.push(e.message) }
        outputs.push({ op: 'transactionChecks', errors: errors.length,
          created: db.prepare('SELECT count(*) AS n FROM notes').get().n - beforeCount,
          content: byTitle(op.title).content,
          todosCreated: db.prepare('SELECT count(*) AS n FROM todos').get().n - todoCount })
        break
      }
      case 'dropManifest':
        fs.unlinkSync(path.join(remoteDir, 'Flota', 'manifest.json'))
        break
      case 'readRemoteNote': {
        const note = byTitle(op.title)
        outputs.push({ content: fs.readFileSync(path.join(remoteDir, 'Flota', 'notes', note.sync_id + (note.note_type === 'whiteboard' ? '.wb' : '.md')), 'utf8') })
        break
      }
      case 'editWidget': {
        const WidgetDAO = require('../../electron/dao/WidgetDAO')
        new WidgetDAO().updateWidget('perf-widget', { code: op.code })
        break
      }
      case 'failPath':
        engine.client.failPattern = op.path
        break
      case 'dumpWidgets': {
        const WidgetDAO = require('../../electron/dao/WidgetDAO')
        const dao = new WidgetDAO()
        outputs.push({ op: 'dumpWidgets', widgets: dao.listWidgets(), records: dao.exportForSync('perf-instance') })
        break
      }
      case 'categories':
        engine.config.syncCategories = op.value
        break
      case 'failUpload':
        engine.client.failUpload = op.path
        break
      case 'trySync':
        try { outputs.push({ op: 'trySync', result: await engine.performSync() }) }
        catch (error) { outputs.push({ op: 'trySync', error: error.message }) }
        break
      case 'corruptRemote': {
        const manifest = JSON.parse(fs.readFileSync(path.join(remoteDir, 'Flota', 'manifest.json'), 'utf8'))
        const [id, entry] = Object.entries(manifest.files).find(([, entry]) => entry.meta?.title === op.title)
        fs.writeFileSync(path.join(remoteDir, 'Flota', 'notes', id + entry.ext), op.content)
        break
      }
      case 'sleep':
        await new Promise(resolve => setTimeout(resolve, op.ms))
        break
      case 'sync': {
        engine.client.calls = []
        const result = await engine.performSync()
        outputs.push({ op: 'sync', success: result.success, calls: engine.client.calls, uploaded: result.uploaded, downloaded: result.downloaded, deleted: result.deleted, errors: result.errors, errorDetails: result.errorDetails })
        break
      }
      case 'dump':
        outputs.push({
          op: 'dump',
          notes: db.prepare('SELECT title, content, note_type, is_deleted, is_pinned, tags FROM notes ORDER BY title').all(),
        })
        break
      default:
        throw new Error(`未知操作 ${op.op}`)
    }
  }
  print(`RESULT ${JSON.stringify(outputs)}`)
})().catch((error) => {
  print(`ERROR ${error.stack || error}`)
  process.exitCode = 1
})
