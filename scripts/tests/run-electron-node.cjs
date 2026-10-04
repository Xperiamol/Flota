// 在隔离的临时 HOME 里用 Electron 自带的 Node 跑一个测试脚本（better-sqlite3 按 Electron ABI 编译）
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const script = path.resolve(process.argv[2])
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flota-test-home-'))
const electron = path.join(__dirname, '../../node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
const result = spawnSync(electron, [script], {
  env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
fs.rmSync(home, { recursive: true, force: true })
const output = `${result.stdout || ''}${result.stderr || ''}`
const line = output.split('\n').find((text) => text.startsWith('RESULT ') || text.startsWith('ERROR '))
console.log(line ? output.slice(output.indexOf(line)) : output)
process.exitCode = line?.startsWith('RESULT ') ? 0 : 1
