const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const { dialog, app } = require('electron');
const DatabaseManager = require('../dao/DatabaseManager');

const getUserDataPath = () => app.getPath('userData');

// 跟数据库一起打包的用户文件目录（相对 userData）
const DATA_DIRS = ['images', 'audio', 'attachments', 'wallpaper'];
// 本地同步缓存：恢复后必须清掉，否则同步会把"备份之后新建的笔记"当成本机删掉的，去删其他设备上的
const SYNC_CACHE_FILES = ['sync-manifest.json', 'sync-widgets-v2-manifest.json'];

class BackupService {
  /**
   * 创建完整备份（数据库 + 图片 + 音频 + 附件 + 壁纸）
   * @returns {{ success: boolean, data?: { filePath: string, size: number }, error?: string }}
   */
  async createBackup() {
    let snapshotDir = null;
    try {
      const userDataPath = getUserDataPath();
      const dbManager = DatabaseManager.getInstance();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const result = await dialog.showSaveDialog({
        title: '选择备份保存位置',
        defaultPath: `Flota-backup-${timestamp}.zip`,
        filters: [{ name: 'ZIP 压缩文件', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: '用户取消' };
      }

      // 数据库在 userData/database/flota.db（以前误读 userData/flota.db，备份永远失败）。
      // 用 SQLite 在线备份拿一致快照，不直接复制正在写的库文件和 WAL
      snapshotDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'flota-backup-'));
      const snapshotPath = path.join(snapshotDir, 'flota.db');
      await dbManager.backup(snapshotPath);

      const zip = new AdmZip();
      zip.addLocalFile(snapshotPath, '', 'flota.db');
      for (const dir of DATA_DIRS) {
        const fullDir = path.join(userDataPath, dir);
        if (fs.existsSync(fullDir)) this._addDirectoryToZip(zip, fullDir, dir);
      }
      zip.addFile('backup-meta.json', Buffer.from(JSON.stringify({
        version: app.getVersion(),
        createdAt: new Date().toISOString(),
        platform: process.platform,
      }, null, 2), 'utf8'));
      zip.writeZip(result.filePath);

      const stat = await fsp.stat(result.filePath);
      return { success: true, data: { filePath: result.filePath, size: stat.size } };
    } catch (error) {
      console.error('创建备份失败:', error);
      return { success: false, error: error.message };
    } finally {
      if (snapshotDir) fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  }

  /**
   * 从备份恢复数据：校验 → 当前数据库另存一份 → 替换 → 清同步缓存 → 重启
   * @returns {{ success: boolean, data?: { restoredItems: string[], safetyCopy: string }, error?: string }}
   */
  async restoreBackup() {
    let stagingDir = null;
    try {
      const result = await dialog.showOpenDialog({
        title: '选择备份文件',
        filters: [{ name: 'ZIP 压缩文件', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消' };
      }

      const zip = new AdmZip(result.filePaths[0]);
      const entries = zip.getEntries();
      if (!entries.some((entry) => entry.entryName === 'flota.db')) {
        return { success: false, error: '无效的备份文件：缺少数据库' };
      }

      // 1. 先解到临时目录并校验，坏的备份不能把现有数据换掉
      stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'flota-restore-'));
      zip.extractEntryTo('flota.db', stagingDir, false, true);
      for (const extra of ['flota.db-wal', 'flota.db-shm']) {
        if (entries.some((entry) => entry.entryName === extra)) zip.extractEntryTo(extra, stagingDir, false, true);
      }
      const stagedDb = path.join(stagingDir, 'flota.db');
      const check = new Database(stagedDb);
      try {
        const ok = check.pragma('quick_check', { simple: true });
        if (ok !== 'ok') throw new Error(`备份里的数据库已损坏（${ok}）`);
        const hasNotes = check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get();
        if (!hasNotes) throw new Error('备份里的数据库不是 Flota 的数据');
        // 把旧备份里的 WAL 合进主文件，替换后只需一个文件
        check.pragma('wal_checkpoint(TRUNCATE)');
        check.pragma('journal_mode = DELETE');
      } finally {
        check.close();
      }

      // 2. 当前数据库另存一份，恢复错了还能找回
      const userDataPath = getUserDataPath();
      const dbManager = DatabaseManager.getInstance();
      const livePath = dbManager.getDatabasePath();
      const safetyDir = path.join(path.dirname(livePath), 'backups');
      fs.mkdirSync(safetyDir, { recursive: true });
      const safetyCopy = path.join(safetyDir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);
      await dbManager.backup(safetyCopy);

      // 3. 关闭连接后替换数据库（正在使用的库文件不能直接覆盖）
      dbManager.close();
      for (const suffix of ['-wal', '-shm']) fs.rmSync(livePath + suffix, { force: true });
      fs.copyFileSync(stagedDb, livePath);

      const restoredItems = ['数据库'];
      for (const dir of DATA_DIRS) {
        const dirEntries = entries.filter((entry) => entry.entryName.startsWith(`${dir}/`) && !entry.isDirectory);
        for (const entry of dirEntries) zip.extractEntryTo(entry, userDataPath, true, true);
        if (dirEntries.length) restoredItems.push(`${{ images: '图片', audio: '音频', attachments: '附件', wallpaper: '壁纸' }[dir]}(${dirEntries.length})`);
      }

      // 4. 清掉同步缓存：下次同步按首次同步处理，两边按修改时间取较新的版本
      for (const file of SYNC_CACHE_FILES) fs.rmSync(path.join(userDataPath, file), { force: true });

      // 5. 数据库已关闭，所有服务都要重新加载 → 直接重启
      setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);

      return { success: true, data: { restoredItems, safetyCopy } };
    } catch (error) {
      console.error('恢复备份失败:', error);
      return { success: false, error: error.message };
    } finally {
      if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /**
   * Recursively add directory contents to zip
   */
  _addDirectoryToZip(zip, dirPath, zipDir) {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // zip 内一律用 /：Windows 上 path.join 会写成 images\\whiteboard，恢复时认不出目录
        this._addDirectoryToZip(zip, fullPath, path.posix.join(zipDir, item));
      } else {
        zip.addLocalFile(fullPath, zipDir);
      }
    }
  }
}

module.exports = BackupService;
