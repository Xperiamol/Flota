// Isolated acceptance host: actual Electron, SQLite and image storage services.
// No application startup, sync, credentials or personal database are loaded.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron')
const os = require('node:os')
const path = require('node:path')
const profile = process.argv.find(arg => arg.startsWith('--acceptance-profile='))?.split('=').slice(1).join('=')
if (!profile || path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('flota-editor-test-')) {
  throw new Error('An isolated acceptance profile is required')
}
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.setPath('userData', profile)
app.commandLine.appendSwitch('remote-debugging-port', '0')
app.whenReady().then(async () => {
  const database = require('../../electron/dao/DatabaseManager').getInstance()
  await database.initialize()
  const NoteService = require('../../electron/services/NoteService')
  const ImageService = require('../../electron/services/ImageService')
  const notes = new NoteService()
  const images = new ImageService()
  protocol.handle('app', request => {
    const url = new URL(request.url)
    const relative = `${url.host}${url.pathname}`
    if (!/^images\/[a-zA-Z0-9_.-]+$/.test(relative)) return new Response('Not found', { status: 404 })
    return net.fetch(require('node:url').pathToFileURL(images.getImagePath(relative)).href)
  })
  // 历史预览测试显式启用快照，产品默认保持关闭。
  if (process.env.EDITOR_SURFACE === 'features') new (require('../../electron/dao/SettingDAO'))().set('noteHistoryEnabled', true, 'boolean')
  const win = new BrowserWindow({ width: 1280, height: 850, useContentSize: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'editor-electron-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents) throw new Error('Unknown acceptance window')
    return fn(...args)
  })
  handle('acceptance:image-save', (bytes, name) => images.saveImage(Buffer.from(bytes), name))
  handle('acceptance:image-read', relative => {
    if (!/^images\/[a-zA-Z0-9_.-]+$/.test(relative)) throw new Error('Invalid test image path')
    return images.readImageAsBase64(relative)
  })
  handle('acceptance:note-create', content => notes.createNote({ title: 'Acceptance roundtrip', content }))
  handle('acceptance:note-read', id => notes.getNoteById(id))
  handle('acceptance:note-update', (id, content) => notes.updateNote(id, { content }))
  handle('acceptance:note-versions', id => notes.listVersions(id))
  handle('acceptance:note-version', (id, versionId) => notes.getVersion(id, versionId))
  handle('acceptance:note-restore-version', (id, versionId, revision) => notes.restoreVersion(id, versionId, revision))
  await win.loadURL('about:blank')
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
