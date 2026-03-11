const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { dialog, app } = require('electron');

const getUserDataPath = () => app.getPath('userData');

class BackupService {
  /**
   * 创建完整备份（数据库 + 图片 + 音频）
   * @returns {{ success: boolean, data?: { filePath: string, size: number }, error?: string }}
   */
  async createBackup() {
    try {
      const userDataPath = getUserDataPath();
      const dbPath = path.join(userDataPath, 'flota.db');
      const imagesDir = path.join(userDataPath, 'images');
      const audioDir = path.join(userDataPath, 'audio');

      if (!fs.existsSync(dbPath)) {
        return { success: false, error: '数据库文件不存在' };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `Flota-backup-${timestamp}.zip`;

      const result = await dialog.showSaveDialog({
        title: '选择备份保存位置',
        defaultPath: defaultName,
        filters: [
          { name: 'ZIP 压缩文件', extensions: ['zip'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: '用户取消' };
      }

      const zip = new AdmZip();

      // Add database
      zip.addLocalFile(dbPath, '', 'flota.db');

      // Add WAL/SHM if exist (for consistency)
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(walPath)) zip.addLocalFile(walPath, '', 'flota.db-wal');
      if (fs.existsSync(shmPath)) zip.addLocalFile(shmPath, '', 'flota.db-shm');

      // Add images directory
      if (fs.existsSync(imagesDir)) {
        this._addDirectoryToZip(zip, imagesDir, 'images');
      }

      // Add audio directory
      if (fs.existsSync(audioDir)) {
        this._addDirectoryToZip(zip, audioDir, 'audio');
      }

      // Add metadata
      const meta = {
        version: app.getVersion(),
        createdAt: new Date().toISOString(),
        platform: process.platform
      };
      zip.addFile('backup-meta.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));

      zip.writeZip(result.filePath);

      const stat = await fsp.stat(result.filePath);
      return {
        success: true,
        data: {
          filePath: result.filePath,
          size: stat.size
        }
      };
    } catch (error) {
      console.error('创建备份失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 从备份恢复数据
   * @returns {{ success: boolean, data?: { restoredItems: string[] }, error?: string }}
   */
  async restoreBackup() {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择备份文件',
        filters: [
          { name: 'ZIP 压缩文件', extensions: ['zip'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消' };
      }

      const zipPath = result.filePaths[0];
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      // Validate: must contain flota.db
      const hasDb = entries.some(e => e.entryName === 'flota.db');
      if (!hasDb) {
        return { success: false, error: '无效的备份文件：缺少数据库' };
      }

      const userDataPath = getUserDataPath();
      const restoredItems = [];

      // Extract database
      zip.extractEntryTo('flota.db', userDataPath, false, true);
      restoredItems.push('数据库');

      // Extract WAL/SHM if present
      const walEntry = entries.find(e => e.entryName === 'flota.db-wal');
      if (walEntry) zip.extractEntryTo('flota.db-wal', userDataPath, false, true);
      const shmEntry = entries.find(e => e.entryName === 'flota.db-shm');
      if (shmEntry) zip.extractEntryTo('flota.db-shm', userDataPath, false, true);

      // Extract images
      const imageEntries = entries.filter(e => e.entryName.startsWith('images/') && !e.isDirectory);
      if (imageEntries.length > 0) {
        for (const entry of imageEntries) {
          const targetPath = path.join(userDataPath, entry.entryName);
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          zip.extractEntryTo(entry, userDataPath, true, true);
        }
        restoredItems.push(`图片(${imageEntries.length})`);
      }

      // Extract audio
      const audioEntries = entries.filter(e => e.entryName.startsWith('audio/') && !e.isDirectory);
      if (audioEntries.length > 0) {
        for (const entry of audioEntries) {
          const targetPath = path.join(userDataPath, entry.entryName);
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          zip.extractEntryTo(entry, userDataPath, true, true);
        }
        restoredItems.push(`音频(${audioEntries.length})`);
      }

      return {
        success: true,
        data: { restoredItems }
      };
    } catch (error) {
      console.error('恢复备份失败:', error);
      return { success: false, error: error.message };
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
        this._addDirectoryToZip(zip, fullPath, path.join(zipDir, item));
      } else {
        zip.addLocalFile(fullPath, zipDir);
      }
    }
  }
}

module.exports = BackupService;
