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
  constructor(root) { this.root = root }
  file(remotePath) { return path.join(this.root, remotePath) }
  async testConnection() { return true }
  async exists(remotePath) { return fs.existsSync(this.file(remotePath)) }
  async createDirectory(remotePath) { fs.mkdirSync(this.file(remotePath), { recursive: true }) }
  async uploadText(remotePath, content) {
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
      case 'sleep':
        await new Promise(resolve => setTimeout(resolve, op.ms))
        break
      case 'sync': {
        const result = await engine.performSync()
        outputs.push({ op: 'sync', uploaded: result.uploaded, downloaded: result.downloaded, deleted: result.deleted, errors: result.errors, errorDetails: result.errorDetails })
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
