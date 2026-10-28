// 隔离 HOME 下的真实 SQLite + HTTP WebDAV；不读取或写入用户网盘。
const fs = require('fs'), path = require('path'), http = require('http'), Module = require('module'), assert = require('assert/strict');
const { getUserDataPath } = require('../../electron/utils/userDataPath');
const home = getUserDataPath();
const saved = path.join(process.env.HOME, 'download.zip');
const original = Module._load;
Module._load = function(name, parent, ...rest) {
  if (name === 'electron' && /BackupService/.test(parent?.filename || '')) return {
    app: { getPath: () => home, getVersion: () => 'test' }, dialog: { showSaveDialog: async () => ({ filePath: saved }) },
  };
  return original.call(this, name, parent, ...rest);
};
const print = console.log.bind(console);
console.log = console.warn = () => {};
(async () => {
  const manager = require('../../electron/dao/DatabaseManager').getInstance();
  await manager.initialize();
  const dao = new (require('../../electron/dao/NoteDAO'))();
  const settings = new (require('../../electron/dao/SettingDAO'))();
  const defaultNote = dao.create({ title: '默认关闭', content: 'A' });
  dao.update(defaultNote.id, { content: 'B' });
  assert.equal(dao.listVersions(defaultNote.id).versions.length, 0, '默认不生成历史快照');
  assert.equal(dao.listVersions(defaultNote.id).policy.enabled, false);
  dao.hardDelete(defaultNote.id);
  settings.set('noteHistoryEnabled', true, 'boolean');
  const note = dao.create({ title: '历史测试', content: '原文 ![](images/old.png)' });
  dao.update(note.id, { content: '第二版' });
  dao.update(note.id, { content: '第三版' });
  let history = dao.listVersions(note.id);
  assert.equal(history.versions.length, 1, '连续编辑合并为快照');
  const old = history.versions[0].id;
  assert.equal(dao.getVersion(note.id, old).content, note.content);
  assert.throws(() => dao.restoreVersion(note.id, old, 'stale'), /笔记已更新/);
  dao.restoreVersion(note.id, old, history.revision);
  assert.equal(dao.findById(note.id).content, note.content);
  history = dao.listVersions(note.id);
  assert.equal(dao.getVersion(note.id, history.versions[0].id).content, '第三版', '恢复前保留当前正文');
  assert.throws(() => dao.getVersion(note.id + 1, old), /不存在/);
  for (let i = 0; i < 55; i++) manager.getDatabase().prepare('INSERT INTO note_versions(note_id,snapshot,created_at) VALUES(?,?,?)').run(note.id, JSON.stringify({ title: '标题', content: 'v' + i }), i);
  assert.equal(dao.listVersions(note.id).versions.length, 50);

  const configurable = dao.create({ title: '可配置历史', content: 'A' });
  settings.set('noteHistoryEnabled', false, 'boolean');
  dao.update(configurable.id, { content: 'B' });
  assert.equal(dao.listVersions(configurable.id).versions.length, 0, '关闭后不生成自动快照');
  settings.set('noteHistoryEnabled', true, 'boolean');
  settings.set('noteHistoryIntervalSeconds', 300, 'number');
  settings.set('noteHistoryLimit', 3, 'number');
  dao.update(configurable.id, { content: 'C' });
  manager.getDatabase().prepare('UPDATE note_versions SET created_at = ? WHERE note_id = ?').run(Date.now() - 61000, configurable.id);
  dao.update(configurable.id, { content: 'D' });
  assert.equal(dao.listVersions(configurable.id).versions.length, 1, '五分钟内合并编辑');
  settings.set('noteHistoryIntervalSeconds', 30, 'number');
  dao.update(configurable.id, { content: 'E' });
  assert.equal(dao.listVersions(configurable.id).versions.length, 2, '修改间隔即时生效');
  assert.deepEqual(dao.listVersions(configurable.id).policy, { enabled: true, intervalSeconds: 30, limit: 3 });
  settings.set('noteHistoryEnabled', false, 'boolean');
  for (let i = 0; i < 4; i++) {
    const listed = dao.listVersions(configurable.id);
    dao.restoreVersion(configurable.id, listed.versions[0].id, listed.revision);
  }
  assert.equal(dao.listVersions(configurable.id).versions.length, 3, '关闭自动快照后恢复仍保留当前内容，并遵守自定义数量');
  settings.set('noteHistoryEnabled', true, 'boolean');
  settings.set('noteHistoryIntervalSeconds', 60, 'number');
  settings.set('noteHistoryLimit', 50, 'number');
  dao.hardDelete(configurable.id);

  const remote = new Map(); let fail = false;
  const server = http.createServer(async (req, res) => {
    if (fail && req.url.startsWith('/failed')) { res.writeHead(503); res.end(); return; }
    if (req.method === 'MKCOL') { res.writeHead(201); res.end(); return; }
    if (req.method === 'PUT') { const parts = []; for await (const chunk of req) parts.push(chunk); remote.set(req.url, Buffer.concat(parts)); res.writeHead(201); res.end(); return; }
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); res.end('<D:multistatus xmlns:D="DAV:">' + [...remote.keys()].filter(key => key.startsWith(req.url)).map(key => `<D:response><D:href>${key}</D:href></D:response>`).join('') + '</D:multistatus>'); return; }
    if (req.method === 'DELETE') { remote.delete(req.url); res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && remote.has(req.url)) { res.end(remote.get(req.url)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const Backup = require('../../electron/services/BackupService');
    const Cloud = require('../../electron/services/CloudBackupService');
    const service = new Cloud(new Backup());
    manager.getDatabase().prepare("INSERT OR REPLACE INTO settings(key,value,type) VALUES('ai_api_key','test-private-api-key','string')").run();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    service.saveTarget({ name: '成功网盘', baseUrl, username: 'test', password: 'private-password', rootPath: '/good/nested' });
    service.saveTarget({ name: '失败网盘', baseUrl, username: 'test', password: 'private-password', rootPath: '/failed' });
    assert.ok(!JSON.stringify(service.getConfig()).includes('private-password'));
    assert.ok(!fs.readFileSync(service.filePath, 'utf8').includes('private-password'));
    fail = true;
    let result = await service.run();
    assert.equal(result.success, false);
    assert.equal(result.data[0].success, true, '单个网盘失败不影响其他备份');
    assert.equal(result.data[1].success, false);
    const target = service.targets[0];
    const archive = new (require('adm-zip'))(remote.get(target.rootPath + target.lastFile));
    assert.ok(archive.getEntry('flota.db'));
    const dbFile = path.join(process.env.HOME, 'snapshot.db');
    fs.writeFileSync(dbFile, archive.readFile('flota.db'));
    const db = new (require('better-sqlite3'))(dbFile);
    assert.equal(db.prepare('SELECT count(*) AS n FROM note_versions').get().n, 50);
    assert.equal(db.prepare('SELECT content FROM notes WHERE id=?').get(note.id).content, note.content);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='ai_api_key'").get(), undefined, '云端备份不包含本机密钥');
    db.close();
    await service.downloadLatest(target.id);
    assert.deepEqual(fs.readFileSync(saved), remote.get(target.rootPath + target.lastFile));
    for (let i = 0; i < 7; i++) remote.set(target.rootPath + service.prefix + `2000-01-0${i + 1}.zip`, Buffer.from('old'));
    const otherDevice = target.rootPath + 'Flota-other-device-2000.zip'; remote.set(otherDevice, Buffer.from('other'));
    result = await service.run([target.id]);
    assert.equal(result.success, true);
    assert.equal([...remote.keys()].filter(key => key.startsWith(target.rootPath + service.prefix)).length, 5);
    assert.ok(remote.has(otherDevice));
    service.saveTarget({ ...target, rootPath: '/new-location', password: undefined });
    assert.equal(service.targets.find(item => item.id === target.id).lastSuccess, undefined, '更换网盘位置不能沿用旧备份状态');
    service.removeTarget(target.id);
    assert.ok(remote.size > 0, '移除连接不删除备份');
    dao.hardDelete(note.id);
    assert.equal(manager.getDatabase().prepare('SELECT count(*) AS n FROM note_versions').get().n, 0);
    print('RESULT ok: note history coalescing, restore, concurrency, retention; independent WebDAV backups, archive integrity, secret storage, download and rotation');
  } finally { await new Promise(resolve => server.close(resolve)); manager.close(); }
})().catch(error => { console.error(error); process.exitCode = 1 });
