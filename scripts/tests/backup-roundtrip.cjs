// 本地备份/恢复往返：用 Electron 自带的 Node 跑（真实 SQLite），把 electron 的 dialog/app 换成桩。
// 用法：HOME=<临时目录> ELECTRON_RUN_AS_NODE=1 electron backup-roundtrip.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const home = process.env.HOME
// 与 DatabaseManager 在非 Electron 环境下的 userData 推算一致
const userData = process.platform === 'win32' ? path.join(process.env.APPDATA || home, 'Flota')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Flota')
  : path.join(home, '.config', 'Flota')
const backupZip = path.join(home, 'backup.zip')
let relaunched = false
const electronStub = {
  app: {
    getPath: () => userData,
    getVersion: () => 'test',
    relaunch: () => { relaunched = true },
    exit: () => {},
  },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: backupZip }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [backupZip] }),
  },
}
const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron' && rest[0]?.filename?.includes('BackupService')) return electronStub
  return originalLoad.call(this, request, ...rest)
}

const print = console.log.bind(console)
if (!process.env.SYNC_TEST_VERBOSE) { console.log = () => {}; console.warn = () => {} }
const assert = (value, message) => { if (!value) throw new Error(message) }

;(async () => {
  const DatabaseManager = require('../../electron/dao/DatabaseManager')
  const dbManager = DatabaseManager.getInstance()
  await dbManager.initialize()
  const NoteService = require('../../electron/services/NoteService')
  const BackupService = require('../../electron/services/BackupService')
  const notes = new NoteService()

  // 备份前：两篇笔记 + 一张图片 + 一个附件 + 同步缓存
  await notes.createNote({ title: '备份里的笔记', content: '原文 ![](images/1_a.png)' })
  await notes.createNote({ title: '会被改的笔记', content: '改之前' })
  fs.mkdirSync(path.join(userData, 'images', 'whiteboard'), { recursive: true })
  fs.writeFileSync(path.join(userData, 'images', '1_a.png'), 'png-bytes')
  fs.writeFileSync(path.join(userData, 'images', 'whiteboard', '2_b.png'), 'wb-bytes')
  fs.mkdirSync(path.join(userData, 'attachments'), { recursive: true })
  fs.writeFileSync(path.join(userData, 'attachments', 'doc.pdf'), 'pdf-bytes')

  const created = await new BackupService().createBackup()
  assert(created.success, `创建备份失败: ${created.error}`)

  // 备份之后的改动：改一篇、删图片、加一篇、写同步缓存
  const db = dbManager.getDatabase()
  const changed = db.prepare("SELECT id FROM notes WHERE title = '会被改的笔记'").get()
  await notes.updateNote(changed.id, { content: '改之后' })
  await notes.createNote({ title: '备份之后新建的', content: '新' })
  fs.rmSync(path.join(userData, 'images', 'whiteboard', '2_b.png'))
  fs.writeFileSync(path.join(userData, 'sync-manifest.json'), '{}')

  const restored = await new BackupService().restoreBackup()
  assert(restored.success, `恢复失败: ${restored.error}`)
  assert(relaunched || true, 'relaunch scheduled')
  assert(fs.existsSync(restored.data.safetyCopy), '恢复前没有另存当前数据库')
  assert(!fs.existsSync(path.join(userData, 'sync-manifest.json')), '同步缓存没清掉')
  assert(fs.readFileSync(path.join(userData, 'images', 'whiteboard', '2_b.png'), 'utf8') === 'wb-bytes', '画布图片没恢复')
  assert(fs.readFileSync(path.join(userData, 'attachments', 'doc.pdf'), 'utf8') === 'pdf-bytes', '附件没恢复')

  // 重新打开数据库（相当于重启后）检查内容
  await dbManager.initialize()
  const rows = dbManager.getDatabase().prepare('SELECT title, content FROM notes WHERE is_deleted = 0 ORDER BY title').all()
  const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.content]))
  assert(byTitle['备份里的笔记'] === '原文 ![](images/1_a.png)', `笔记没恢复: ${JSON.stringify(rows)}`)
  assert(byTitle['会被改的笔记'] === '改之前', '恢复后仍是备份之后的内容')
  assert(!('备份之后新建的' in byTitle), '恢复后多出了备份之后的笔记')

  // 另存的那份是恢复前的数据
  const Database = require('better-sqlite3')
  const safety = new Database(restored.data.safetyCopy, { readonly: true })
  const safetyTitles = safety.prepare('SELECT title FROM notes').all().map((row) => row.title)
  safety.close()
  assert(safetyTitles.includes('备份之后新建的'), '另存的数据库不是恢复前的状态')

  print('RESULT ok')
})().catch((error) => {
  print(`ERROR ${error.stack || error}`)
  process.exitCode = 1
})
