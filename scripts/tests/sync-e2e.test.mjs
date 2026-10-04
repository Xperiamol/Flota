// 云同步端到端：两台"设备"各有独立的 SQLite 数据库和 sync-manifest，经同一个"云端"目录同步。
// 每台设备在单独的 Electron-as-Node 进程里跑 sync-device.cjs，走真实的 NoteService 保存路径和 SyncEngine。
// 运行：npm run test:sync
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const electron = path.join(root, 'node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
const deviceScript = path.join(root, 'scripts/tests/sync-device.cjs')

const createCloud = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flota-sync-e2e-'))
  fs.mkdirSync(path.join(dir, 'remote'))
  const run = (device, ops) => {
    const home = path.join(dir, device)
    fs.mkdirSync(home, { recursive: true })
    const result = spawnSync(electron, [deviceScript, path.join(dir, 'remote'), JSON.stringify(ops)], {
      env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60000,
    })
    const line = (result.stdout || '').split('\n').find(text => text.startsWith('RESULT '))
    if (!line) throw new Error(`设备 ${device} 运行失败:\n${result.stdout}\n${result.stderr}`)
    return JSON.parse(line.slice('RESULT '.length))
  }
  const notesOf = (device) => run(device, [{ op: 'dump' }])[0].notes
  const note = (device, title) => notesOf(device).find(item => item.title === title)
  const sync = (device) => {
    const [result] = run(device, [{ op: 'sync' }])
    assert.equal(result.errors, 0, `${device} 同步出错: ${JSON.stringify(result.errorDetails)}`)
    return result
  }
  return { run, notesOf, note, sync, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

// 笔记的 updated_at 精确到秒；需要"之后"发生的操作要隔开一秒以上
const laterSecond = { op: 'sleep', ms: 1100 }

// 两台设备都同步到同一篇笔记的起点
const startWithSharedNote = (cloud, title, content) => {
  cloud.run('A', [{ op: 'create', title, content }, { op: 'sync' }])
  cloud.sync('B')
  assert.equal(cloud.note('B', title)?.content, content)
}

test('新建、编辑在两台设备间往返，再次同步没有多余任务', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '往返', '第一版')
    cloud.run('B', [laterSecond, { op: 'edit', title: '往返', content: '第二版（B 改）' }, { op: 'sync' }])
    cloud.sync('A')
    assert.equal(cloud.note('A', '往返').content, '第二版（B 改）')
    // 收敛：两端再同步都不应再上传/下载
    for (const device of ['A', 'B', 'A']) {
      const result = cloud.sync(device)
      assert.equal(result.uploaded + result.downloaded, 0, `${device} 不该再有同步任务: ${JSON.stringify(result)}`)
    }
  } finally { cloud.cleanup() }
})

test('另一台设备改了正文，本机只是无改动的自动保存：拿到新内容，而不是把旧内容推回去', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '会议记录', '旧内容')
    cloud.run('B', [{ op: 'edit', title: '会议记录', content: '手机上补充的新内容' }, { op: 'sync' }])
    // A 晚一秒"碰"了一下这篇笔记（切换笔记、失焦时的保存），updated_at 比 B 的编辑新
    cloud.run('A', [laterSecond, { op: 'touch', title: '会议记录' }, { op: 'sync' }])
    assert.equal(cloud.note('A', '会议记录').content, '手机上补充的新内容')
    cloud.sync('B')
    assert.equal(cloud.note('B', '会议记录').content, '手机上补充的新内容')
  } finally { cloud.cleanup() }
})

test('本机时钟偏快：没改过的笔记照样接收另一台设备的新编辑', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '时钟', '原文')
    // A 上这篇笔记的修改时间被记在一小时后（时钟偏快时保存过）
    cloud.run('A', [{ op: 'shiftClock', title: '时钟', seconds: 3600 }])
    cloud.run('B', [{ op: 'edit', title: '时钟', content: 'B 的新编辑' }, { op: 'sync' }])
    cloud.sync('A')
    assert.equal(cloud.note('A', '时钟').content, 'B 的新编辑')
  } finally { cloud.cleanup() }
})

test('本机只改了置顶/标题，另一台改了正文：正文和置顶都保留', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '计划', '原计划')
    cloud.run('B', [{ op: 'edit', title: '计划', content: '新计划' }, { op: 'sync' }])
    cloud.run('A', [laterSecond, { op: 'pin', title: '计划' }, { op: 'sync' }, { op: 'sync' }])
    const onA = cloud.note('A', '计划')
    assert.equal(onA.content, '新计划')
    assert.equal(onA.is_pinned, 1)
    cloud.sync('B')
    const onB = cloud.note('B', '计划')
    assert.equal(onB.content, '新计划')
    assert.equal(onB.is_pinned, 1)
  } finally { cloud.cleanup() }
})

test('另一台只改了标题和置顶，本机改了正文：正文、新标题和置顶都保留', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '草稿', '旧正文')
    cloud.run('B', [{ op: 'rename', title: '草稿', to: '定稿' }, { op: 'pin', title: '定稿' }, { op: 'sync' }])
    cloud.run('A', [laterSecond, { op: 'edit', title: '草稿', content: '电脑上写的新正文' }, { op: 'sync' }, { op: 'sync' }])
    const onA = cloud.note('A', '定稿')
    assert.equal(onA?.content, '电脑上写的新正文')
    assert.equal(onA.is_pinned, 1)
    cloud.sync('B')
    const onB = cloud.note('B', '定稿')
    assert.equal(onB?.content, '电脑上写的新正文')
    assert.equal(onB.is_pinned, 1)
  } finally { cloud.cleanup() }
})

test('两台设备都改了正文：较晚的编辑胜出，两端收敛一致', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '冲突', '起点')
    cloud.run('A', [{ op: 'edit', title: '冲突', content: 'A 的版本' }])
    cloud.run('B', [laterSecond, { op: 'edit', title: '冲突', content: 'B 更晚的版本' }, { op: 'sync' }])
    cloud.sync('A')
    cloud.sync('B')
    assert.equal(cloud.note('A', '冲突').content, 'B 更晚的版本')
    assert.equal(cloud.note('B', '冲突').content, 'B 更晚的版本')
    for (const device of ['A', 'B']) {
      const result = cloud.sync(device)
      assert.equal(result.uploaded + result.downloaded, 0, `${device} 冲突后仍在来回同步: ${JSON.stringify(result)}`)
    }
  } finally { cloud.cleanup() }
})

test('删除同步到另一台；在另一台从回收站恢复后，恢复也同步回来', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '可恢复', '内容还在')
    cloud.run('A', [{ op: 'delete', title: '可恢复' }, { op: 'sync' }])
    cloud.sync('B')
    assert.equal(cloud.note('B', '可恢复').is_deleted, 1)
    cloud.run('B', [laterSecond, { op: 'restore', title: '可恢复' }, { op: 'sync' }, { op: 'sync' }])
    assert.equal(cloud.note('B', '可恢复').is_deleted, 0, '恢复后下一次同步又被删掉了')
    cloud.sync('A')
    const onA = cloud.note('A', '可恢复')
    assert.equal(onA.is_deleted, 0)
    assert.equal(onA.content, '内容还在')
  } finally { cloud.cleanup() }
})

test('删除后没等同步就清空回收站：笔记不会被同步复活，另一台也删掉', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '要彻底删的', '不要了')
    cloud.run('A', [{ op: 'delete', title: '要彻底删的' }, { op: 'purge', title: '要彻底删的' }, { op: 'sync' }, { op: 'sync' }])
    assert.equal(cloud.note('A', '要彻底删的'), undefined, '永久删除的笔记被同步下载回来了')
    cloud.sync('B')
    assert.notEqual(cloud.note('B', '要彻底删的')?.is_deleted, 0, '另一台设备上还在')
  } finally { cloud.cleanup() }
})

test('永久删除时另一台恰好改了它：保留另一台的新内容', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '有人在改', '旧')
    cloud.run('B', [{ op: 'edit', title: '有人在改', content: 'B 刚写的' }, { op: 'sync' }])
    cloud.run('A', [{ op: 'delete', title: '有人在改' }, { op: 'purge', title: '有人在改' }, { op: 'sync' }])
    assert.equal(cloud.note('A', '有人在改')?.content, 'B 刚写的')
  } finally { cloud.cleanup() }
})

test('某篇笔记下载失败：下次同步补下载，不会被当成删除推到其他设备', () => {
  const cloud = createCloud()
  try {
    cloud.run('A', [{ op: 'create', title: '下载会失败', content: '重要内容' }, { op: 'create', title: '正常', content: '普通' }, { op: 'sync' }])
    const [first] = cloud.run('B', [{ op: 'failDownloadOf', title: '下载会失败' }, { op: 'sync' }])
    assert.ok(first.errors >= 1, '应当有一篇下载失败')
    assert.equal(cloud.note('B', '下载会失败'), undefined)
    cloud.sync('B')
    assert.equal(cloud.note('B', '下载会失败')?.content, '重要内容', '网络恢复后没有补下载')
    cloud.sync('A')
    assert.equal(cloud.note('A', '下载会失败')?.is_deleted, 0, '另一台设备上的笔记被删掉了')
  } finally { cloud.cleanup() }
})

test('另一台的修改这次下载失败：下次补下载，不会把本机旧内容推回去', () => {
  const cloud = createCloud()
  try {
    startWithSharedNote(cloud, '更新会失败', '旧内容')
    cloud.run('A', [{ op: 'edit', title: '更新会失败', content: 'A 的新内容' }, { op: 'sync' }])
    const [first] = cloud.run('B', [{ op: 'failDownloadOf', title: '更新会失败' }, { op: 'sync' }])
    assert.ok(first.errors >= 1, '应当有一篇下载失败')
    assert.equal(cloud.note('B', '更新会失败').content, '旧内容')
    cloud.sync('B')
    assert.equal(cloud.note('B', '更新会失败').content, 'A 的新内容', '网络恢复后没有补下载')
    cloud.sync('A')
    assert.equal(cloud.note('A', '更新会失败').content, 'A 的新内容', 'A 的修改被 B 的旧内容覆盖了')
  } finally { cloud.cleanup() }
})

test('各种正文经同步逐字节保留（双链、HTML、公式、CRLF、行尾空格、emoji）', () => {
  const cloud = createCloud()
  try {
    const samples = {
      双链: '[[B]] 与 [[B|别名]]，![[图]] 和 [[B#章节]]\n- [ ] 待办 [[C]]',
      乱码样例: 'function () { [native code] } 是 JS 笔记里的正常文字',
      格式: '==高亮== ++下划线++ <span style="color:#ef4444">红</span> **粗** *斜* ~~删~~ `code`',
      公式: '$E=mc^2$\n\n$$\n\\frac{1}{2}\n$$',
      空白: 'CRLF 行\r\n行尾空格   \n\t制表符\n\n\n\n多个空行',
      转义: '\\[\\[不是双链\\]\\] \\* 星号 &lt;div&gt; a < b',
      表情: '😀👨‍👩‍👧 中文，標點；𠮷',
    }
    cloud.run('A', [...Object.entries(samples).map(([title, content]) => ({ op: 'create', title, content })), { op: 'sync' }])
    cloud.sync('B')
    for (const [title, content] of Object.entries(samples)) {
      assert.equal(cloud.note('B', title)?.content, content, `「${title}」同步后内容变了`)
    }
    // 回传一轮也不变
    cloud.run('B', [laterSecond, { op: 'edit', title: '双链', content: samples.双链 + '\n追加' }, { op: 'sync' }])
    cloud.sync('A')
    assert.equal(cloud.note('A', '双链').content, samples.双链 + '\n追加')
    assert.equal(cloud.note('A', '空白').content, samples.空白)
  } finally { cloud.cleanup() }
})

test('画布笔记和改标题同步过去', () => {
  const cloud = createCloud()
  try {
    const board = JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'r1', type: 'rectangle', x: 1, y: 2, width: 30, height: 40 }], appState: {} })
    cloud.run('A', [{ op: 'create', title: '画布', content: board, noteType: 'whiteboard' }, { op: 'create', title: '旧标题', content: '正文' }, { op: 'sync' }])
    cloud.sync('B')
    const onB = cloud.note('B', '画布')
    assert.equal(onB.note_type, 'whiteboard')
    assert.deepEqual(JSON.parse(onB.content), JSON.parse(board))
    cloud.run('A', [laterSecond, { op: 'rename', title: '旧标题', to: '新标题' }, { op: 'sync' }])
    cloud.sync('B')
    assert.equal(cloud.note('B', '新标题')?.content, '正文')
    assert.equal(cloud.note('B', '旧标题'), undefined)
  } finally { cloud.cleanup() }
})
