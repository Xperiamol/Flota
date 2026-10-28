const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { dialog } = require('electron');
const { getUserDataPath } = require('../utils/userDataPath');
const { writeFileAtomicSync } = require('../utils/atomicFile');
const { encryptValue, decryptValue } = require('../utils/secureValue');
const { getInstance } = require('../utils/DeviceIdManager');
const WebDAVClient = require('./sync/webdavClient');

// 主网盘仍负责双向同步；额外网盘只接收独立的完整备份，不参与冲突仲裁。
class CloudBackupService {
  constructor(backupService) {
    this.backupService = backupService;
    this.filePath = path.join(getUserDataPath(), 'cloud-backups.json');
    this.targets = fs.existsSync(this.filePath) ? JSON.parse(fs.readFileSync(this.filePath, 'utf8')) : [];
    this.busy = false;
    this.prefix = `Flota-${getInstance().getDeviceId()}-`;
  }
  start() {
    this.timer = setInterval(() => this.runDue().catch(console.error), 60 * 60 * 1000);
    this.timer.unref();
    this.runDue().catch(console.error);
  }
  persist() { writeFileAtomicSync(this.filePath, JSON.stringify(this.targets, null, 2), { mode: 0o600 }); }
  getConfig() {
    return { success: true, data: { busy: this.busy, targets: this.targets.map(({ password, ...target }) => ({ ...target, hasPassword: Boolean(password) })) } };
  }
  saveTarget(input) {
    if (this.busy) throw new Error('正在备份，请完成后再修改网盘');
    const previous = this.targets.find(target => target.id === input.id);
    const password = input.password === undefined ? previous?.password : encryptValue(input.password);
    if (!/^https?:\/\//i.test(input.baseUrl || '') || !input.username?.trim() || !password) throw new Error('请填写完整的 WebDAV 地址、用户名和应用密码');
    const rootPath = '/' + (input.rootPath || 'Flota-backups').split('/').filter(Boolean).join('/') + '/';
    if (rootPath.split('/').includes('..')) throw new Error('备份文件夹不能包含 ..');
    const target = { ...previous, id: previous?.id || crypto.randomUUID(), name: input.name?.trim() || '备份网盘',
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ''), rootPath, username: input.username.trim(), password, auto: Boolean(input.auto) };
    if (previous && ['baseUrl', 'rootPath', 'username'].some(key => target[key] !== previous[key])) {
      delete target.lastSuccess; delete target.lastFile; delete target.error; delete target.warning;
    }
    this.targets = this.targets.filter(item => item.id !== target.id).concat(target);
    this.persist();
    return this.getConfig();
  }
  removeTarget(id) {
    if (this.busy) throw new Error('正在备份，请完成后再移除网盘');
    this.targets = this.targets.filter(item => item.id !== id); this.persist();
    return this.getConfig();
  }
  client(target) {
    return new WebDAVClient({ baseUrl: target.baseUrl, username: target.username, password: decryptValue(target.password), retryAttempts: 2 });
  }
  async runDue() {
    const due = this.targets.filter(target => target.auto && Date.now() - (target.lastSuccess || 0) >= 24 * 60 * 60 * 1000);
    if (due.length && !this.busy) await this.run(due.map(target => target.id));
  }
  async run(ids = this.targets.map(target => target.id)) {
    if (this.busy) throw new Error('正在备份，请稍候');
    const targets = this.targets.filter(target => ids.includes(target.id));
    if (!targets.length) throw new Error('请先添加备份网盘');
    this.busy = true;
    let dir;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flota-cloud-backup-'));
      const name = `${this.prefix}${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.zip`;
      const file = path.join(dir, name);
      await this.backupService.writeArchive(file, { portable: true });
      const data = fs.readFileSync(file), results = [];
      for (const target of targets) {
        try {
          const client = this.client(target);
          let directory = '';
          for (const part of target.rootPath.split('/').filter(Boolean)) {
            directory += '/' + part;
            await client.createDirectory(directory + '/');
          }
          await client.uploadBinary(target.rootPath + name, data);
          target.lastSuccess = Date.now(); target.lastFile = name; target.error = '';
          // 仅轮换当前设备创建的备份，其他设备的备份不动。
          try {
            const files = (await client.list(target.rootPath)).filter(entry => !entry.isDirectory)
              .map(entry => decodeURIComponent(entry.href.split('/').pop()))
              .filter(fileName => fileName.startsWith(this.prefix) && fileName.endsWith('.zip')).sort().reverse();
            for (const old of files.slice(5)) await client.delete(target.rootPath + old);
            target.warning = '';
          } catch (error) { target.warning = '备份已完成，旧备份轮换暂未完成：' + error.message; }
          results.push({ id: target.id, success: true });
        } catch (error) {
          target.error = error.message;
          results.push({ id: target.id, success: false, error: error.message });
        }
        this.persist();
      }
      return { success: results.every(item => item.success), data: results, error: results.some(item => !item.success) ? '部分网盘备份未完成，已保留其他网盘的成功备份' : undefined };
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      this.busy = false;
    }
  }
  async downloadLatest(id) {
    const target = this.targets.find(item => item.id === id);
    if (!target?.lastFile) throw new Error('这个网盘还没有成功备份');
    const result = await dialog.showSaveDialog({ title: '保存备份', defaultPath: target.lastFile, filters: [{ name: 'Flota 备份', extensions: ['zip'] }] });
    if (result.canceled) return { success: true, cancelled: true };
    const data = await this.client(target).downloadBinary(target.rootPath + target.lastFile);
    writeFileAtomicSync(result.filePath, data);
    return { success: true, data: { filePath: result.filePath } };
  }
}
module.exports = CloudBackupService;
