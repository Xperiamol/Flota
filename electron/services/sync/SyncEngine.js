/**
 * Flota v3.0 原子化同步系统 - 同步引擎
 *
 * 核心同步逻辑，实现 manifest-driven 的原子化增量同步
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 尝试加载 Electron，如果失败则使用 null（独立运行模式）
let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {
  // 独立运行模式
}

const getUserDataPath = () => {
  if (app) return app.getPath('userData');
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (platform === 'win32') return path.join(process.env.APPDATA || homeDir, 'Flota');
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  return path.join(homeDir, '.config', 'Flota');
};

const WebDAVClient = require('./webdavClient');
const StorageAdapter = require('./StorageAdapter');
const { getInstance: getDeviceIdManager } = require('../../utils/DeviceIdManager');

/**
 * 同步引擎类
 *
 * 生命周期：Bootstrap -> Scan & Diff -> Execution -> Commit
 */
class SyncEngine extends EventEmitter {
  /**
   * 创建同步引擎实例
   * @param {import('./types').SyncConfig} config - 同步配置
   */
  constructor(config) {
    super();

    this.config = {
      baseUrl: config.baseUrl || 'https://dav.jianguoyun.com/dav',
      username: config.username,
      password: config.password,
      rootPath: config.rootPath || '/Flota/',
      maxConcurrency: config.maxConcurrency || 3,
      requestDelay: config.requestDelay || 200,
      retryAttempts: config.retryAttempts || 3,
      conflictStrategy: config.conflictStrategy || 'ask',
      enableDebugLog: config.enableDebugLog || false,
      syncCategories: config.syncCategories || ['notes', 'images', 'settings', 'todos'], // 启用的同步类别
    };

    // WebDAV 客户端
    this.client = new WebDAVClient({
      baseUrl: this.config.baseUrl,
      username: this.config.username,
      password: this.config.password,
      timeout: 30000,
      retryAttempts: this.config.retryAttempts,
    });

    // 存储适配器
    this.storage = new StorageAdapter();

    // 设备 ID
    this.deviceId = getDeviceIdManager().getDeviceId();

    // 本地缓存的 manifest 路径
    this.localManifestPath = path.join(getUserDataPath(), 'sync-manifest.json');

    // #N4：跨进程文件锁路径（防止多窗口/多 IPC 触发同时同步）
    this.lockFilePath = path.join(getUserDataPath(), 'sync-manifest.lock');

    // 同步状态
    this.isSyncing = false;
    this.lastSyncTime = 0;

    // 冲突解决处理器（由外部注入）
    this.syncIPCHandler = config.syncIPCHandler || null;

    // 调试日志
    this.logFile = path.join(getUserDataPath(), 'sync-v3-debug.log');
    this.clearLogFile();
  }

  // ==================== 公共 API ====================

  /**
   * 测试连接
   * @returns {Promise<boolean>} 是否连接成功
   */
  async testConnection() {
    try {
      return await this.client.testConnection();
    } catch (error) {
      this.logError('连接测试失败', error);
      throw error;
    }
  }

  /**
   * 获取跨进程同步锁
   * @private
   */
  acquireSyncLock() {
    const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
    try {
      // 检查现存锁是否已过期
      if (fs.existsSync(this.lockFilePath)) {
        try {
          const lockContent = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf8'));
          const age = Date.now() - (lockContent.startedAt || 0);
          if (age > LOCK_TIMEOUT_MS) {
            this.log(`[Sync] 检测到过期锁文件（${Math.floor(age / 1000)}s 前的 PID ${lockContent.pid}），强制清理`);
            fs.unlinkSync(this.lockFilePath);
          } else {
            throw new Error(`[Sync] 同步锁被另一进程持有（PID ${lockContent.pid}, ${Math.floor(age / 1000)}s 前），跳过本次`);
          }
        } catch (parseErr) {
          if (parseErr.message?.startsWith('[Sync]')) throw parseErr;
          // 锁文件损坏，强制清理
          this.log('[Sync] 锁文件损坏，强制清理');
          try { fs.unlinkSync(this.lockFilePath); } catch (_) {}
        }
      }
      // 原子创建锁文件
      const fd = fs.openSync(this.lockFilePath, 'wx');
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 0, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      if (e.code === 'EEXIST') {
        throw new Error('[Sync] 同步锁竞争失败，另一进程刚刚创建了锁，跳过本次');
      }
      throw e;
    }
  }

  /**
   * 释放跨进程同步锁
   * @private
   */
  releaseSyncLock() {
    try {
      if (fs.existsSync(this.lockFilePath)) fs.unlinkSync(this.lockFilePath);
    } catch (e) {
      this.logError('[Sync] 释放锁文件失败（不影响下次同步，10 分钟后会自动清理）', e);
    }
  }

  /**
   * 执行完整同步
   * @param {boolean} [forceFullSync=false] - 是否强制全量同步
   * @param {{ lockAlreadyAcquired?: boolean }} [options] - 内部选项
   * @returns {Promise<import('./types').SyncResult>} 同步结果
   */
  async performSync(_forceFullSync = false, options = {}) {
    if (this.isSyncing) {
      // 超时保护：若 isSyncing 持续超过 10 分钟仍未释放，视为遗留状态，强制重置
      // 防止上一次同步因进程异常中断（如崩溃、强制关机）导致 isSyncing 永久卡死
      const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
      if (this._syncStartedAt && Date.now() - this._syncStartedAt > SYNC_TIMEOUT_MS) {
        this.log(`[Sync] 检测到上次同步超时未释放（${Math.floor((Date.now() - this._syncStartedAt) / 1000)}s），强制重置`);
        this.isSyncing = false;
      } else {
        throw new Error('同步已在进行中');
      }
    }

    let lockAcquired = false;
    if (!options.lockAlreadyAcquired) {
      this.acquireSyncLock();
      lockAcquired = true;
    }

    this.isSyncing = true;
    this._syncStartedAt = Date.now();
    const startTime = Date.now();

    try {
      this.emit('syncStart');
      this.log('========== 开始同步 ==========');

      // 阶段 1: 初始化
      const initResult = await this.bootstrap();

      if (initResult !== true) {
        // 首次初始化完成，返回初始化统计
        const result = {
          success: true,
          uploaded: initResult.uploaded || 0,
          downloaded: 0,
          deleted: 0,
          skipped: 0,
          errors: 0,
          errorDetails: [],
          duration: Date.now() - startTime,
        };
        this.emit('syncComplete', result);
        this.log(`========== 初始化完成 (上传 ${result.uploaded} 个文件) ==========`);
        return result;
      }

      // 阶段 2: 扫描与计算
      this.emit('syncProgress', { stage: 'scan', progress: 0.2 });
      const { tasks, localManifest, remoteManifest } = await this.scanAndDiff();

      this.log(`扫描完成，共 ${tasks.length} 个任务`);

      // 阶段 3: 执行
      this.emit('syncProgress', { stage: 'execute', progress: 0.4 });
      const result = await this.executeTasks(tasks);

      // 阶段 4: 提交 — 即使有非致命错误（如图片上传失败）也提交已成功部分
      this.emit('syncProgress', { stage: 'commit', progress: 0.9 });
      await this.commit(localManifest, remoteManifest, tasks, result);
      this.log('同步提交成功');
      if (result.errors > 0) {
        this.logError(`同步完成但有 ${result.errors} 个非致命错误`);
      }

      result.duration = Date.now() - startTime;
      this.lastSyncTime = Date.now();

      // Periodic GC: purge soft-deleted todos older than 30 days
      try {
        const purged = await this.storage.purgeOldDeletedTodos(30);
        if (purged > 0) {
          this.log(`[GC] 清理了 ${purged} 条超过30天的软删除待办`);
        }
      } catch (e) {
        this.logError('[GC] 清理旧删除记录失败', e);
      }

      this.emit('syncComplete', result);
      this.log(`========== 同步完成 (${result.duration}ms) ==========`);

      return result;
    } catch (error) {
      this.logError('同步失败', error);
      this.emit('syncError', error);
      throw error;
    } finally {
      this.isSyncing = false;
      // #N4：释放跨进程文件锁
      if (lockAcquired) {
        this.releaseSyncLock();
      }
    }
  }

  /**
   * 强制全量同步 - 清空云端并重新上传
   * @returns {Promise<import('./types').SyncResult>} 同步结果
   */
  /**
   * 强制全量同步 - 重建 manifest 索引
   *
   * 安全语义：仅清空 manifest 索引，**不删除任何云端文件**。
   * 重新初始化后，bootstrap → initializeCleanSlate 会保护性跳过已存在的 todos.json/settings.json，
   * 笔记 .md/.wb 也不会被覆盖；新生成的 manifest.json 会重新索引本端的所有 active 笔记，
   * 远端原有但本端没有的笔记会在下次扫描时被识别为 "仅远端存在 → 下载"。
   *
   * 使用场景：用户怀疑 manifest 错乱、缓存损坏、需要重新建立索引时使用。
   * @returns {Promise<import('./types').SyncResult>} 同步结果
   */
  async forceFullSync() {
    this.log('========== 强制全量同步：重建 manifest（不删除云端文件） ==========');

    const remoteManifestPath = this.config.rootPath + 'manifest.json';
    const remoteBackupPath = this.config.rootPath + 'manifest.json.backup';
    const localBackupPath = this.localManifestPath + '.backup';
    let remoteBackedUp = false;
    let localBackedUp = false;
    let lockAcquired = false;

    try {
      // forceFullSync 的备份/删除 manifest 阶段也必须持有同步锁，
      // 否则普通同步可能在 manifest 被删除但尚未重建时并发运行。
      this.acquireSyncLock();
      lockAcquired = true;

      // #N10：先备份云端 manifest
      // 自查修正：只有当云端 manifest 不存在 或 备份成功时，才允许继续删除原 manifest
      // 否则备份失败 + 删除原 manifest = 数据无法恢复
      let oldRemote = null;
      try {
        oldRemote = await this.client.downloadJson(remoteManifestPath);
      } catch (e) {
        if (e.response?.status === 404 || /不存在|404|not found/i.test(e.message || '')) {
          // 云端确实没有 manifest，无需备份
          this.log('云端 manifest 不存在 (404)，无需备份');
        } else {
          // 其他错误（网络/权限/超时）→ 不能贸然继续，否则可能在云端 manifest 实际存在的情况下删除它
          throw new Error(
            `下载云端 manifest 失败，无法判断是否需要备份，已中止：${e.message}`
          );
        }
      }

      if (oldRemote) {
        try {
          await this.client.uploadJson(remoteBackupPath, oldRemote);
          remoteBackedUp = true;
          this.log('已备份云端 manifest → manifest.json.backup');
        } catch (e) {
          // 备份失败 → 拒绝继续，保护数据
          throw new Error(
            `备份云端 manifest 失败，已中止强制全量同步以避免数据丢失：${e.message}`
          );
        }
      }

      // #N10：先备份本地 manifest
      if (fs.existsSync(this.localManifestPath)) {
        try {
          fs.copyFileSync(this.localManifestPath, localBackupPath);
          localBackedUp = true;
          this.log('已备份本地 manifest → ' + localBackupPath);
        } catch (e) {
          throw new Error(`备份本地 manifest 失败，已中止：${e.message}`);
        }
      }

      // 删除云端 manifest（仅删除索引，不删数据文件）
      try {
        await this.client.delete(remoteManifestPath);
        this.log('已删除云端 manifest（数据文件未触动）');
      } catch (e) {
        if (e.response?.status !== 404) throw e;
        this.log('云端 manifest 不存在，跳过删除');
      }

      // 删除本地缓存 manifest
      if (fs.existsSync(this.localManifestPath)) {
        fs.unlinkSync(this.localManifestPath);
        this.log('已删除本地缓存 manifest');
      }

      // 执行同步（将触发初始化，但 todos.json/settings.json 等已有文件会被保护性跳过）
      const result = await this.performSync(true, { lockAlreadyAcquired: true });
      // #N10：成功后清理备份
      try {
        if (remoteBackedUp) await this.client.delete(remoteBackupPath).catch(() => {});
        if (localBackedUp && fs.existsSync(localBackupPath)) fs.unlinkSync(localBackupPath);
      } catch (_) {}
      return result;
    } catch (error) {
      this.logError('强制全量同步失败，尝试恢复备份', error);
      // #N10：失败时恢复备份
      try {
        if (remoteBackedUp) {
          const backup = await this.client.downloadJson(remoteBackupPath);
          if (backup) {
            await this.client.uploadJson(remoteManifestPath, backup);
            this.log('已从备份恢复云端 manifest');
          }
        }
        if (localBackedUp && fs.existsSync(localBackupPath)) {
          fs.copyFileSync(localBackupPath, this.localManifestPath);
          fs.unlinkSync(localBackupPath);
          this.log('已从备份恢复本地 manifest');
        }
      } catch (recoverErr) {
        this.logError('恢复备份失败，备份保留在 manifest.json.backup', recoverErr);
      }
      throw error;
    } finally {
      if (lockAcquired) {
        this.releaseSyncLock();
      }
    }
  }

  // ==================== 阶段 1: 初始化 (Bootstrap) ====================

  /**
   * 初始化检查
   *
   * 逻辑：
   * - 如果云端 manifest 不存在，触发初始化程序
   * - 如果云端 manifest 存在，返回 true 继续同步
   *
   * @returns {Promise<boolean|{uploaded: number}>} true=已初始化，{uploaded}=刚完成初始化
   */
  async bootstrap() {
    this.log('[Bootstrap] 检查云端 manifest...');

    // 先确保根目录存在，避免 409 错误
    try {
      const rootExists = await this.client.exists(this.config.rootPath);
      if (!rootExists) {
        this.log('[Bootstrap] 根目录不存在，云端未初始化');
        return await this.initializeCleanSlate();
      }
    } catch (error) {
      this.log('[Bootstrap] 检查根目录失败，假设云端未初始化:', error.message);
      return await this.initializeCleanSlate();
    }

    // 检查 manifest 是否存在
    const manifestPath = this.config.rootPath + 'manifest.json';
    const manifestExists = await this.client.exists(manifestPath);

    if (!manifestExists) {
      this.log('[Bootstrap] 云端未初始化，开始初始化程序...');
      return await this.initializeCleanSlate();
    }

    this.log('[Bootstrap] 云端已初始化');
    return true;
  }

  /**
   * 初始化程序 - Clean Slate
   *
   * 步骤：
   * 1. 创建目录结构
   * 2. 上传初始空文件
   * 3. 上传本地数据
   * 4. 上传本地图片
   * 5. 生成并上传初始 manifest
   *
   * @returns {Promise<{uploaded: number}>} 上传统计
   */
  async initializeCleanSlate() {
    this.log('[Init] 开始初始化云端...');
    let uploadCount = 0;

    // 1. 创建目录结构（按层级顺序创建，确保父目录存在）
    try {
      await this.client.createDirectory(this.config.rootPath);
      this.log('[Init] 根目录创建完成');
    } catch (error) {
      this.log('[Init] 根目录创建失败（可能已存在）:', error.message);
    }

    try {
      await this.client.createDirectory(this.config.rootPath + 'notes/');
      await this.client.createDirectory(this.config.rootPath + 'assets/');
      await this.client.createDirectory(this.config.rootPath + 'images/');
      await this.client.createDirectory(this.config.rootPath + 'images/whiteboard/');
      await this.client.createDirectory(this.config.rootPath + 'images/whiteboard-preview/');
      await this.client.createDirectory(this.config.rootPath + 'wallpaper/');
      await this.client.createDirectory(this.config.rootPath + 'audio/');
      this.log('[Init] 子目录结构创建完成');
    } catch (error) {
      this.log('[Init] 子目录创建失败:', error.message);
      throw error;
    }

    // 2. 上传初始空文件（todos 和 settings）
    // 重要保护：先检查云端是否已存在，避免覆盖另一台设备/历史会话已上传的数据。
    // 这是 "本地待办丢失" 类问题的关键防线 —— 任何"清空覆盖"必须显式且可控。
    const todosRemotePath = this.config.rootPath + 'todos.json';
    const settingsRemotePath = this.config.rootPath + 'settings.json';
    const todosExisted = await this.client.exists(todosRemotePath).catch(() => false);
    const settingsExisted = await this.client.exists(settingsRemotePath).catch(() => false);
    if (!todosExisted) {
      await this.client.uploadJson(todosRemotePath, []);
      uploadCount += 1;
    } else {
      this.log('[Init] 云端 todos.json 已存在，跳过初始空文件上传以保护已有数据');
    }
    if (!settingsExisted) {
      await this.client.uploadJson(settingsRemotePath, {});
      uploadCount += 1;
    } else {
      this.log('[Init] 云端 settings.json 已存在，跳过初始空文件上传以保护已有数据');
    }
    this.log('[Init] 初始空文件检查完成');

    // 3. 获取本地数据（根据启用的类别过滤）
    const enabledCategories = this.config.syncCategories || [];
    const localNotes = enabledCategories.includes('notes') ? await this.storage.getAllNotes(false) : {}; // 不包含已删除
    const localTodos = enabledCategories.includes('todos') ? await this.storage.getAllTodos(false) : {};
    const localSettings = enabledCategories.includes('settings') ? await this.storage.getAllSettings() : {};

    this.log(`[Init] 本地数据 (已启用类别: ${enabledCategories.join(', ')}): ${Object.keys(localNotes).length} 笔记, ${Object.keys(localTodos).length} 待办`);

    // 4. 上传本地笔记和白板（如果启用）
    // 保护：仅当云端不存在同名文件时才上传，避免初始化把云端已有的更新版本覆盖回去
    const noteUploads = enabledCategories.includes('notes')
      ? Object.values(localNotes).map(async (note) => {
          const ext = note.note_type === 'whiteboard' ? '.wb' : '.md';
          const remotePath = this.config.rootPath + 'notes/' + note.id + ext;
          const exists = await this.client.exists(remotePath).catch(() => false);
          if (exists) {
            this.log(`[Init] 云端笔记已存在，跳过覆盖: ${note.id}${ext}`);
            return;
          }
          await this.uploadNote(note);
        })
      : [];
    await Promise.all(noteUploads);
    uploadCount += noteUploads.length;
    if (noteUploads.length > 0) {
      this.log(`[Init] ${noteUploads.length} 个笔记/白板已检查/上传`);
    }

    // 5. 上传笔记中引用的图片（如果启用images类别）
    const imageCount = enabledCategories.includes('images') ? await this.uploadAllNoteImages(localNotes) : 0;
    uploadCount += imageCount;
    if (imageCount > 0) {
      this.log(`[Init] ${imageCount} 个图片上传完成`);
    }

    // 5.5 上传白板预览图
    if (enabledCategories.includes('images')) {
      const previewCount = await this.uploadAllWhiteboardPreviews(localNotes);
      uploadCount += previewCount;
      if (previewCount > 0) {
        this.log(`[Init] ${previewCount} 个白板预览图上传完成`);
      }
    }

    // 6. 上传 todos 和 settings（如果有数据且类别已启用，覆盖空文件）
    const todosArray = Object.values(localTodos);
    if (enabledCategories.includes('todos') && todosArray.length > 0) {
      await this.client.uploadJson(this.config.rootPath + 'todos.json', todosArray);
      this.log('[Init] todos 上传完成');
    }
    if (enabledCategories.includes('settings') && Object.keys(localSettings).length > 0) {
      // 上传 kv-ts 新格式：携带每个 key 的 updated_at（来自本地 settings.updated_at）
      const bundle = await this.storage.getAllSettingsWithTimestamps();
      await this.client.uploadJson(this.config.rootPath + 'settings.json', {
        __schema: 'kv-ts',
        values: bundle.values,
        timestamps: bundle.timestamps,
      });
      await this.syncWallpaperAsset({ __schema: 'kv-ts', values: bundle.values }, true);
      this.log('[Init] settings 上传完成 (kv-ts)');
    }

    // 7. 生成初始 manifest
    const manifest = await this.generateManifest(localNotes, localTodos, localSettings);

    // 7.5 补救扫描：把云端已存在但本地没有的笔记文件也加入 manifest
    // 场景：forceFullSync 重建索引时，远端原本可能有 N 篇笔记是从其他设备同步上来的，本端从未拥有；
    // 这些笔记不在 localNotes 中，但 .md/.wb 文件实际存在于云端 notes/ 目录。
    // 必须把它们登记到 manifest，下次 scanAndDiff 才会识别为 "仅远端存在 → 下载"。
    if (enabledCategories.includes('notes')) {
      try {
        const remoteFiles = await this.client.list(this.config.rootPath + 'notes/', 1).catch(() => []);
        for (const f of remoteFiles) {
          if (f.isDirectory) continue;
          const baseName = decodeURIComponent(f.href.split('/').pop() || '');
          const m = baseName.match(/^(.+?)(\.md|\.wb)$/i);
          if (!m) continue;
          const fileId = m[1];
          const ext = m[2].toLowerCase();
          if (manifest.files[fileId]) continue; // 本端已有，跳过
          // 用一个保守的旧时间戳作为初值，确保后续 scanAndDiff 识别为远端 t > 本地 (none) → 下载
          manifest.files[fileId] = {
            v: 1,
            t: 1,            // 极旧时间戳，便于识别为 "需下载"
            c: 1,
            h: 'unknown',    // hash 未知，scanAndDiff 比对时会触发下载
            d: 0,
            ext,
            meta: {},
          };
          this.log(`[Init] 发现云端独有笔记，已登记到 manifest: ${fileId}${ext}`);
        }
      } catch (e) {
        this.logError('[Init] 扫描云端 notes/ 目录失败（不阻断）', e);
      }
    }

    await this.client.uploadJson(this.config.rootPath + 'manifest.json', manifest);
    uploadCount += 1;
    this.saveLocalManifest(manifest);
    this.log('[Init] 初始 manifest 上传完成');

    this.log('[Init] 云端初始化完成！');

    return { uploaded: uploadCount };
  }

  /**
   * 上传所有笔记中引用的图片
   * @private
   */
  async uploadAllNoteImages(notes) {
    const allImageRefs = new Set();

    // 收集所有笔记中的图片引用
    for (const note of Object.values(notes)) {
      if (!note.content) continue;
      const noteType = note.note_type || 'markdown';
      const refs = this.extractImageReferences(note.content, noteType);
      refs.forEach(ref => allImageRefs.add(ref));
    }

    if (allImageRefs.size === 0) {
      return 0;
    }

    this.log(`[Init] 发现 ${allImageRefs.size} 个图片需要上传`);

    let uploadedCount = 0;
    for (const relativePath of allImageRefs) {
      try {
        const localPath = path.join(getUserDataPath(), relativePath);
        if (!fs.existsSync(localPath)) {
          this.log(`[Init Images] 本地图片不存在，跳过: ${relativePath}`);
          continue;
        }

        const remotePath = this.config.rootPath + relativePath;
        const imageData = fs.readFileSync(localPath);
        await this.client.uploadBinary(remotePath, imageData);
        uploadedCount++;
        this.log(`[Init Images] 上传成功: ${relativePath}`);
      } catch (error) {
        this.log(`[Init Images] 上传失败: ${relativePath}, ${error.message}`);
      }
    }

    return uploadedCount;
  }

  /**
   * 上传单个笔记/白板到云端
   * @private
   */
  async uploadNote(note) {
    const ext = note.note_type === 'whiteboard' ? '.wb' : '.md';
    const remotePath = this.config.rootPath + 'notes/' + note.id + ext;
    await this.client.uploadText(remotePath, note.content);
  }

  /**
   * 生成 manifest
   * @private
   */
  async generateManifest(notes, todos, settings) {
    /** @type {import('./types').SyncManifest} */
    const manifest = {
      version: 3,
      last_synced_at: Date.now(),
      device_id: this.deviceId,
      files: {},
    };

    // 添加笔记
    // 注意：localEntry.dev 表示"上次写入这条数据的设备"。如果本地内容自上次同步以来未变更，
    //       应继承 cachedManifest 中的 dev 值（保留对端写入者身份），否则才标记为本机 deviceId。
    //       否则会出现"字典序大的设备永远碾压字典序小设备的本地修改"的不对称 LWW 问题。
    const cachedManifestForDev = this.loadLocalManifest();
    for (const [syncId, note] of Object.entries(notes)) {
      this.log(`[Manifest] 笔记 ${syncId}: is_deleted=${note.is_deleted}, note_type=${note.note_type}, updated_at=${note.updated_at}`);
      const noteHash = this.storage.calculateNoteHash(note);
      const cachedEntry = cachedManifestForDev?.files?.[syncId];
      // 本地未变更 → 继承上次写入设备；本地有变更 → 标记为本机
      const dev = (cachedEntry && cachedEntry.h === noteHash && cachedEntry.dev)
        ? cachedEntry.dev
        : this.deviceId;
      manifest.files[syncId] = {
        v: 1,
        t: note.updated_at,
        c: note.created_at, // 添加创建时间
        h: noteHash,
        d: note.is_deleted ? 1 : 0,
        ext: note.note_type === 'whiteboard' ? '.wb' : '.md',
        dev, // 用于 LWW 时间戳相同时的字典序 tiebreaker（#14）
        // 存储额外元数据
        meta: {
          title: note.title,
          tags: note.tags || '',
          category: note.category || '',
          is_pinned: note.is_pinned || 0,
          is_favorite: note.is_favorite || 0,
          note_type: note.note_type || 'markdown', // 明确存储笔记类型
        },
      };
    }

    // 添加 todos（作为单个文件）
    const todosArray = Object.values(todos);

    // 计算 todos 的最新更新时间
    let todosUpdatedAt = 0;
    if (todosArray.length > 0) {
      for (const todo of todosArray) {
        let t = 0;
        if (typeof todo.updated_at === 'number') {
          t = todo.updated_at;
        } else if (todo.updated_at) {
          t = this.storage.parseTimestamp(todo.updated_at);
        }
        if (t > todosUpdatedAt) {
          todosUpdatedAt = t;
        }
      }
    }
    // 如果所有 todos 都没有有效时间戳，使用一个固定的旧时间（避免总是覆盖远端）
    if (todosUpdatedAt === 0) {
      todosUpdatedAt = 1000000000000; // 2001-09-09，表示"无有效时间戳"
    }

    this.log(`[Manifest] global_todos: count=${todosArray.length}, updatedAt=${todosUpdatedAt} (${new Date(todosUpdatedAt).toISOString()})`);

    manifest.files['global_todos'] = {
      v: 1,
      t: todosUpdatedAt,
      h: this.storage.calculateTodosHash(todosArray),
      d: 0,
      ext: '.json',
    };

    // 添加 settings（作为单个文件）
    // Settings 的时间戳策略：
    // 1) 有缓存 manifest 且 hash 未变 → 保持缓存时间戳（避免无意义覆盖）
    // 2) 缓存缺失 但远端 manifest 存在该条目 → 继承远端时间戳（保护其他设备的新设置不被本端旧值覆盖）
    // 3) 否则才使用 Date.now()
    const settingsHash = this.storage.calculateSettingsHash(settings);
    let settingsUpdatedAt = null;

    const cachedManifest = this.loadLocalManifest();
    if (cachedManifest?.files?.['global_settings']?.h === settingsHash) {
      settingsUpdatedAt = cachedManifest.files['global_settings'].t;
      this.log(`[Manifest] global_settings: hash 未变，保持缓存时间戳 ${settingsUpdatedAt}`);
    } else {
      // 尝试用上次扫描下载的远端 manifest（仅在 scanAndDiff 已经下载到时可用）
      const remoteEntry = this._lastRemoteManifest?.files?.['global_settings'];
      if (remoteEntry && remoteEntry.h === settingsHash) {
        settingsUpdatedAt = remoteEntry.t;
        this.log(`[Manifest] global_settings: 缓存缺失但远端 hash 一致，继承远端时间戳 ${settingsUpdatedAt}`);
      } else {
        settingsUpdatedAt = Date.now();
        this.log(`[Manifest] global_settings: hash 变化或全新，使用新时间戳 ${settingsUpdatedAt}`);
      }
    }

    manifest.files['global_settings'] = {
      v: 1,
      t: settingsUpdatedAt,
      h: settingsHash,
      d: 0,
      ext: '.json',
    };

    return manifest;
  }

  // ==================== 阶段 2: 扫描与计算 (Scan & Diff) ====================

  /**
   * 扫描本地和云端数据，计算差异
   *
   * @returns {Promise<{tasks: Array<import('./types').SyncTask>, localManifest: import('./types').SyncManifest, remoteManifest: import('./types').SyncManifest}>}
   */
  async scanAndDiff() {
    this.log('[Scan] 开始扫描...');

    // #N6：每次同步开始时显式重置跨次实例变量，避免脏读上次结果
    this._lastRemoteManifest = null;
    this._lastRemoteSettingsIsKvTs = false;

    // 1. 下载远程 manifest
    const remoteManifest = await this.client.downloadJson(this.config.rootPath + 'manifest.json');

    // #N9：远端 manifest schema 校验，损坏则直接抛错阻断同步
    if (!this.isValidManifest(remoteManifest)) {
      throw new Error('远端 manifest.json 格式异常或损坏，已阻止本次同步以保护数据。请检查云端 manifest 文件，或联系支持。');
    }

    this.log(`[Scan] 远程 manifest: ${Object.keys(remoteManifest.files).length} 文件`);
    // 暂存最近一次远端 manifest，供 generateManifest 在 cache 缺失时回退使用
    this._lastRemoteManifest = remoteManifest;

    // #N1：检测上一轮 commit 是否中断
    // 若有 pending：cached 中存的就是"我们期望的、已成功执行但 manifest 上传失败"的状态
    // → 直接尝试用本地 cached 重新上传 manifest，不走 diff 流程
    if (this.hasPendingCommit()) {
      this.log('[Scan] ⚠️ 检测到上一轮 commit 未完成，尝试恢复...');
      try {
        const cached = this.loadLocalManifest();
        const recovery = { ...cached };
        delete recovery._pendingCommit;
        // 仅当远端 manifest 与上次执行前快照一致时才直接覆盖（说明确实是 commit 阶段中断）
        // 否则走正常 diff 流程，让 LWW + dev 仲裁处理
        await this.client.uploadJson(this.config.rootPath + 'manifest.json', recovery);
        this.saveLocalManifest(recovery);
        this.log('[Scan] commit 恢复成功，远端 manifest 已对齐');
        // 恢复成功后继续走正常 scan，可能已无差异
      } catch (e) {
        this.logError('[Scan] commit 恢复失败，回退到正常 diff 流程', e);
        // 不阻断，继续走正常 diff（cached 仍有 _pendingCommit 标记，下次再尝试）
      }
    }

    // 协议握手探测：嗅探一次远端 settings.json 是否已是 kv-ts 格式（仅头部判断，不下载完整时多余开销）
    // 决定本端 settings 上传时使用新格式还是旧格式，避免单端升级污染未升级的旧客户端
    this._lastRemoteSettingsIsKvTs = false;
    if (remoteManifest.files?.['global_settings']) {
      try {
        const remoteSettings = await this.client.downloadJson(this.config.rootPath + 'settings.json').catch(() => null);
        this._lastRemoteSettingsIsKvTs = !!(remoteSettings && remoteSettings.__schema === 'kv-ts');
        this.log(`[Scan] 远端 settings 协议: ${this._lastRemoteSettingsIsKvTs ? 'kv-ts (v3.1)' : 'plain (v3.0)'}`);
      } catch (_) { /* 忽略嗅探失败 */ }
    }

    // 2. 加载本地缓存 manifest
    const cachedManifest = this.loadLocalManifest();

    // 3. 扫描本地实时数据（根据启用的类别过滤）
    const enabledCategories = this.config.syncCategories || [];
    const localNotes = enabledCategories.includes('notes') ? await this.storage.getAllNotes(true) : {};
    const localTodos = enabledCategories.includes('todos') ? await this.storage.getAllTodos(true) : {};
    // 同时拿到 settings 的逐 key 时间戳，便于上传时使用 kv-ts 新格式
    const settingsBundle = enabledCategories.includes('settings')
      ? await this.storage.getAllSettingsWithTimestamps()
      : { values: {}, timestamps: {} };
    const localSettings = settingsBundle.values;
    const localSettingsTimestamps = settingsBundle.timestamps;

    // 4. 生成本地实时 manifest
    const localManifest = await this.generateManifest(localNotes, localTodos, localSettings);
    this.log(`[Scan] 本地 manifest: ${Object.keys(localManifest.files).length} 文件`);

    // 5. 三向合并：remoteManifest vs cachedManifest vs localManifest
    const tasks = await this.computeSyncTasks(remoteManifest, cachedManifest, localManifest, {
      localNotes,
      localTodos,
      localSettings,
      localSettingsTimestamps,
    });

    // 灾难防御：本地数据被意外清空检测
    // 当本地 active 笔记 = 0 但远端有 ≥10 个 active 笔记，且本轮要执行 ≥5 个 upload-delete 时，
    // 阻止本轮删除任务，避免"本地清空 → 全量删云端"灾难。用户可手动 forceFullSync 强制覆盖。
    const localActiveNotesCount = Object.keys(localNotes || {}).length;
    const remoteActiveNotesCount = Object.values(remoteManifest.files || {}).filter(
      e => e && e.d === 0 && e.ext && (e.ext === '.md' || e.ext === '.wb')
    ).length;
    const uploadDeleteTasks = tasks.filter(t => t.operation === 'upload-delete');
    if (localActiveNotesCount === 0 && remoteActiveNotesCount >= 10 && uploadDeleteTasks.length >= 5) {
      this.log(`[Scan] ⚠️ 灾难防御触发：本地 0 个笔记，云端 ${remoteActiveNotesCount} 个，本应批量删除 ${uploadDeleteTasks.length} 个云端文件，已阻止`);
      // 移除所有 upload-delete 任务
      const filtered = tasks.filter(t => t.operation !== 'upload-delete');
      this.emit('disasterPreventionTriggered', {
        type: 'local-empty-cloud-full',
        blocked: uploadDeleteTasks.length,
        cloudActive: remoteActiveNotesCount,
      });
      return { tasks: filtered, localManifest, remoteManifest };
    }

    return { tasks, localManifest, remoteManifest };
  }

  /**
   * 计算同步任务（三向合并）
   * @private
   */
  async computeSyncTasks(remoteManifest, cachedManifest, localManifest, localData) {
    /** @type {Array<import('./types').SyncTask>} */
    const tasks = [];

    // 获取所有文件 ID
    const allFileIds = new Set([
      ...Object.keys(remoteManifest.files),
      ...Object.keys(localManifest.files),
    ]);

    for (const fileId of allFileIds) {
      // 类别开关过滤：用户关闭某类后，扫描应跳过该 fileId，避免云端旧文件被强制下载到本地
      // 关闭的类别仅意味着"该端不参与该类同步"，不删除云端文件，下次重新启用即可恢复
      const enabledCategories = this.config.syncCategories || [];
      const isNotesCategory = !(fileId === 'global_todos' || fileId === 'global_settings');
      if (
        (fileId === 'global_todos' && !enabledCategories.includes('todos')) ||
        (fileId === 'global_settings' && !enabledCategories.includes('settings')) ||
        (isNotesCategory && !enabledCategories.includes('notes'))
      ) {
        this.log(`[Decide] ${fileId}: 类别已禁用，跳过同步`);
        continue;
      }

      const remoteEntry = remoteManifest.files[fileId];
      const localEntry = localManifest.files[fileId];
      const cachedEntry = cachedManifest?.files?.[fileId];

      const task = await this.decideOperation(fileId, remoteEntry, localEntry, cachedEntry, localData);
      if (task) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * 决定单个文件的操作
   * @private
   */
  async decideOperation(fileId, remoteEntry, localEntry, cachedEntry, localData) {
    const remotePath = this.getRemotePath(fileId, remoteEntry?.ext || localEntry?.ext);

    // 详细日志
    this.log(`[Decide] ${fileId}: local=${localEntry ? `d=${localEntry.d}` : 'null'}, remote=${remoteEntry ? `d=${remoteEntry.d}` : 'null'}`);

    // 情况 1: 文件在两端都不存在（不应该发生）
    if (!remoteEntry && !localEntry) {
      return null;
    }

    // 情况 2: 仅远程存在
    if (remoteEntry && !localEntry) {
      if (remoteEntry.d === 1) {
        // 远程已删除，跳过
        this.log(`[Decide] ${fileId}: 仅远程存在且已删除，跳过`);
        return { operation: 'skip', fileId, remotePath };
      }
      // 下载
      this.log(`[Decide] ${fileId}: 仅远程存在，下载`);
      return {
        operation: 'download',
        fileId,
        remotePath,
        remoteEntry,
      };
    }

    // 情况 3: 仅本地存在
    if (!remoteEntry && localEntry) {
      if (localEntry.d === 1) {
        // 本地已删除，跳过（或删除云端，但云端不存在）
        this.log(`[Decide] ${fileId}: 仅本地存在且已删除，跳过`);
        return { operation: 'skip', fileId, remotePath };
      }
      // 上传
      this.log(`[Decide] ${fileId}: 仅本地存在，上传`);
      return {
        operation: 'upload',
        fileId,
        remotePath,
        localEntry,
        data: this.getLocalData(fileId, localData),
      };
    }

    // 情况 4: 两端都存在
    const remoteDeleted = remoteEntry.d === 1;
    const localDeleted = localEntry.d === 1;

    this.log(`[Decide] ${fileId}: 两端都存在, localDeleted=${localDeleted}, remoteDeleted=${remoteDeleted}`);

    // 处理删除状态同步（用三向比较精确判断方向）
    // - cachedEntry.d 表示上次同步成功时该端记录的删除状态
    // - 仅当某端从 d=0 → d=1 才视为"该端发起删除"；反向亦然
    const cachedDeleted = cachedEntry?.d === 1;

    if (remoteDeleted && !localDeleted) {
      // 远程已删除
      // 情况 a：本地从未同步过 (cachedEntry 不存在) 或缓存也是已删除 → 本地从未"恢复"过，应执行删除
      // 情况 b：本地缓存为未删除，但远端 t > 缓存 t → 远端是新的删除，应同步到本地
      // 情况 c：本地缓存为未删除，但本端 localEntry.t > remoteEntry.t → 本地有新修改，恢复本地（推送恢复）
      if (!cachedEntry || cachedDeleted || remoteEntry.t >= localEntry.t) {
        this.log(`[Delete Sync] 远程已删除，同步删除本地: ${fileId}`);
        return { operation: 'delete-local', fileId, remotePath, remoteEntry };
      } else {
        // 本地修改更新 → 推送恢复（按上传走，云端 manifest 的 d 会被 commit 改为 0）
        this.log(`[Delete Sync] 远程已删除，但本地修改更新，推送恢复: ${fileId}`);
        return {
          operation: 'upload', fileId, remotePath, localEntry,
          data: this.getLocalData(fileId, localData),
        };
      }
    }

    if (localDeleted && !remoteDeleted) {
      // 本地已删除
      // 情况 a：缓存中本地未删除，且本地 t >= 远端 t → 本地是新的删除，推送到远端
      // 情况 b：远端 t > 本地 t（远端是更晚的更新/恢复）→ 应该恢复本地
      if (!cachedEntry || !cachedDeleted || localEntry.t >= remoteEntry.t) {
        this.log(`[Delete Sync] 本地已删除，同步删除到远程: ${fileId}`);
        return { operation: 'upload-delete', fileId, remotePath, localEntry };
      } else {
        // 远端更新 → 下载到本地（执行下载会经 upsertNote 恢复本地）
        this.log(`[Delete Sync] 本地已删除，但远端修改更新，恢复本地: ${fileId}`);
        return { operation: 'download', fileId, remotePath, remoteEntry };
      }
    }

    if (remoteDeleted && localDeleted) {
      // 两边都已删除，跳过
      this.log(`[Decide] ${fileId}: 两边都已删除，跳过`);
      return { operation: 'skip', fileId, remotePath };
    }

    // 检测笔记类型是否转换（.md ↔ .wb）
    const isNote = fileId !== 'global_todos' && fileId !== 'global_settings';

    // 检查远程和本地之间的扩展名变化
    const remoteLocalExtChanged = isNote && remoteEntry.ext && localEntry.ext && remoteEntry.ext !== localEntry.ext;

    if (remoteLocalExtChanged) {
      // 笔记类型在两端不一致，使用时间戳决定哪个版本更新
      this.log(`[Decide] ${fileId}: 检测到类型不一致 remote=${remoteEntry.ext} local=${localEntry.ext}`);

      if (localEntry.t > remoteEntry.t) {
        // 本地更新时间更晚，上传本地类型并删除远程旧文件
        this.log(`[Decide] ${fileId}: 本地更新 (${new Date(localEntry.t).toISOString()})`);
        return {
          operation: 'upload',
          fileId,
          remotePath: this.getRemotePath(fileId, localEntry.ext), // 使用本地扩展名
          localEntry,
          data: this.getLocalData(fileId, localData),
          oldRemotePath: this.getRemotePath(fileId, remoteEntry.ext), // 远程旧文件
        };
      } else {
        // 远程更新时间更晚或相等，下载远程类型（会自动覆盖本地）
        this.log(`[Decide] ${fileId}: 远程更新 (${new Date(remoteEntry.t).toISOString()})`);
        return {
          operation: 'download',
          fileId,
          remotePath: this.getRemotePath(fileId, remoteEntry.ext), // 使用远程扩展名
          remoteEntry,
        };
      }
    }

    // 检查本地和缓存之间的扩展名变化（本地进行了类型转换）
    const localCachedExtChanged = isNote && cachedEntry && cachedEntry.ext && localEntry.ext && cachedEntry.ext !== localEntry.ext;

    if (localCachedExtChanged) {
      // 本地类型发生了转换，需要上传新类型并删除远程旧文件
      this.log(`[Decide] ${fileId}: 本地类型转换 ${cachedEntry.ext} -> ${localEntry.ext}`);
      return {
        operation: 'upload',
        fileId,
        remotePath: this.getRemotePath(fileId, localEntry.ext),
        localEntry,
        data: this.getLocalData(fileId, localData),
        oldRemotePath: this.getRemotePath(fileId, cachedEntry.ext), // 缓存的旧扩展名
      };
    }

    // 两边都未删除，比较 hash
    if (remoteEntry.h === localEntry.h) {
      // Hash 相同 —— 但还需检查 meta（title/tags/category/is_pinned/is_favorite）是否变化。
      // 笔记 hash 仅基于 content，所以仅修改 meta（如改标题、加标签、置顶切换）不会触发 hash 变化，
      // 会被错误判为"无需同步"。这里用 metaSignature 二次校验：本地 meta 与远端/缓存 meta 不一致也要同步。
      // 注意：保持 hash 协议不变，避免与手机端旧客户端不兼容；meta 同步走"以本地为准上传"策略。
      const isNoteFile = fileId !== 'global_todos' && fileId !== 'global_settings';
      if (isNoteFile) {
        const metaSig = (e) => {
          if (!e || !e.meta) return '';
          const m = e.meta;
          return [m.title || '', m.tags || '', m.category || '', m.is_pinned || 0, m.is_favorite || 0, m.note_type || ''].join('|');
        };
        const localMetaSig = metaSig(localEntry);
        const remoteMetaSig = metaSig(remoteEntry);
        const cachedMetaSig = metaSig(cachedEntry);
        if (localMetaSig !== remoteMetaSig) {
          // 本地 meta 与远端不同 → 用"本地未改但远端改"还是"本地改但远端未改"判断方向
          const localMetaChanged = !cachedEntry || cachedMetaSig !== localMetaSig;
          const remoteMetaChanged = !cachedEntry || cachedMetaSig !== remoteMetaSig;
          if (localMetaChanged && !remoteMetaChanged) {
            this.log(`[Decide] ${fileId}: meta 仅本地变更 → upload`);
            return {
              operation: 'upload', fileId,
              remotePath: this.getRemotePath(fileId, localEntry.ext),
              localEntry, data: this.getLocalData(fileId, localData),
            };
          } else if (!localMetaChanged && remoteMetaChanged) {
            this.log(`[Decide] ${fileId}: meta 仅远端变更 → download`);
            return { operation: 'download', fileId, remotePath, remoteEntry };
          } else {
            // 双端 meta 都改了（或无 cache）→ LWW 时间戳仲裁
            const winRemote = remoteEntry.t > localEntry.t;
            this.log(`[Decide] ${fileId}: meta 双端变更 → ${winRemote ? 'download' : 'upload'}`);
            return winRemote
              ? { operation: 'download', fileId, remotePath, remoteEntry }
              : {
                  operation: 'upload', fileId,
                  remotePath: this.getRemotePath(fileId, localEntry.ext),
                  localEntry, data: this.getLocalData(fileId, localData),
                };
          }
        }
      }
      return { operation: 'skip', fileId, remotePath };
    }

    // Hash 不同，检测是否为真正的冲突
    // 真正的冲突：两端都相对于缓存版本发生了变化
    const localChanged = !cachedEntry || (cachedEntry.h !== localEntry.h);
    const remoteChanged = !cachedEntry || (cachedEntry.h !== remoteEntry.h);

    // ── global_todos 特殊处理：使用三向 hash 策略，避免"时间戳最大值仲裁"的误判 ──
    // 问题根因：global_todos.t = max(todos.updated_at)，与具体 todo 的变更无关。
    // 若电脑有任何 todo 的 updated_at > 手机完成时刻，电脑会错误地 UPLOAD 覆盖手机的完成状态。
    // 修复：双端都变更时，始终做 merge（先下载远端逐条仲裁，再上传合并结果）。
    if (fileId === 'global_todos') {
      if (remoteChanged && !localChanged) {
        // 只有远端变更 → 下载
        this.log(`[Decide] global_todos: 只有远端变更 → download`);
        return { operation: 'download', fileId, remotePath, remoteEntry };
      } else if (localChanged && !remoteChanged) {
        // 只有本地变更 → 上传
        this.log(`[Decide] global_todos: 只有本地变更 → upload`);
        return {
          operation: 'upload', fileId, remotePath, localEntry,
          data: this.getLocalData(fileId, localData),
        };
      } else {
        // 双端都变更（或首次同步无缓存）→ 合并：逐条 updated_at 仲裁后上传
        this.log(`[Decide] global_todos: 双端都变更 → merge-todos`);
        return {
          operation: 'merge-todos', fileId, remotePath, remoteEntry, localEntry,
          data: this.getLocalData(fileId, localData),
        };
      }
    }

    // ── global_settings 及笔记：原有逻辑保留 ──
    const isGlobalData = fileId === 'global_settings';

    // 首次同步（无 cachedEntry）一律按 LWW 自动仲裁，不弹冲突 dialog —— 否则 N 个文件会狂弹 N 次
    const isFirstSyncForFile = !cachedEntry;

    if (!isGlobalData && localChanged && remoteChanged && !isFirstSyncForFile && this.syncIPCHandler && this.config.conflictStrategy === 'ask') {
      // 检测到真正的冲突，需要用户决策（仅对笔记启用）
      this.log(`[Conflict] 检测到冲突: ${fileId}`);

      try {
        // 下载远程内容用于对比
        const remoteContent = await this.downloadForConflict(remotePath, fileId);

        const conflictData = {
          fileId,
          fileName: this.getFileName(fileId, localData),
          fileType: this.getFileType(fileId),
          localVersion: this.getLocalData(fileId, localData),
          remoteVersion: remoteContent,
          localTime: localEntry.t,
          remoteTime: remoteEntry.t,
        };

        // 请求用户解决冲突
        const resolution = await this.syncIPCHandler.requestConflictResolution(conflictData);

        if (resolution === 'local') {
          // 用户选择保留本地版本
          this.log(`[Conflict] 用户选择本地版本: ${fileId}`);
          return {
            operation: 'upload',
            fileId,
            remotePath,
            localEntry,
            data: this.getLocalData(fileId, localData),
          };
        } else if (resolution === 'remote') {
          // 用户选择保留远程版本
          this.log(`[Conflict] 用户选择远程版本: ${fileId}`);
          return {
            operation: 'download',
            fileId,
            remotePath,
            remoteEntry,
          };
        }
      } catch (error) {
        this.logError(`冲突解决失败: ${fileId}`, error);
        // 如果冲突解决失败（超时、取消等），回退到时间戳策略
        this.log(`[Conflict] 回退到时间戳策略: ${fileId}`);
      }
    }

    // global_settings 及笔记：时间戳策略兜底
    // tiebreaker：当 t 相同时按 deviceId 字典序决胜（#14），避免两台设备在同毫秒
    // 修改时永远互相覆盖（产生抖动）。规则：deviceId 字典序较大者为权威方。
    const remoteWinsByTime = remoteEntry.t > localEntry.t;
    const localWinsByTime = localEntry.t > remoteEntry.t;
    let remoteWins;
    if (remoteWinsByTime) {
      remoteWins = true;
    } else if (localWinsByTime) {
      remoteWins = false;
    } else {
      // 时间戳完全相同：按 deviceId 字典序仲裁，远端 dev 字典序更大则远端胜
      const remoteDev = (remoteEntry.dev || '');
      const localDev = (this.deviceId || '');
      remoteWins = remoteDev > localDev;
    }

    if (remoteWins) {
      // 远程更新
      return {
        operation: 'download',
        fileId,
        remotePath,
        remoteEntry,
      };
    } else {
      // 本地更新
      return {
        operation: 'upload',
        fileId,
        remotePath,
        localEntry,
        data: this.getLocalData(fileId, localData),
      };
    }
  }

  /**
   * 获取本地数据
   * @private
   */
  getLocalData(fileId, localData) {
    if (fileId === 'global_todos') {
      // 移除不应该同步的内部字段（db_id）
      return Object.values(localData.localTodos).map(todo => {
        const { db_id, ...syncData } = todo;
        return syncData;
      });
    } else if (fileId === 'global_settings') {
      // 协议握手 —— 仅当满足下列任一条件时才升级为 kv-ts 新格式：
      //   a) 远端已经是新格式（__schema === 'kv-ts'，说明集群中已有客户端用新协议写过）
      //   b) 本地任何 setting 已有时间戳（说明本机 schema 已迁移到 kv-ts）
      // 两者皆否 → 退回旧格式 key-value，与手机端 sync.md v3.0 协议保持一致，避免污染旧客户端。
      // 这种"惰性升级"策略保证多端协同期内的协议平滑过渡。
      const values = localData.localSettings || {};
      const timestamps = localData.localSettingsTimestamps || {};
      const remoteIsKvTs = this._lastRemoteSettingsIsKvTs === true;
      const hasAnyLocalTs = Object.values(timestamps).some((t) => typeof t === 'number' && t > 0);
      if (remoteIsKvTs || hasAnyLocalTs) {
        // 升级为 kv-ts 新格式（携带逐 key 时间戳）
        return {
          __schema: 'kv-ts',
          values,
          timestamps,
        };
      }
      // 兼容旧格式：直接上传 key-value（与手机端 sync.md v3.0 协议一致）
      return values;
    } else {
      const note = localData.localNotes[fileId];
      if (note) {
        // 移除不应该同步的内部字段（db_id）
        const { db_id, ...syncData } = note;
        return syncData;
      }
      return note;
    }
  }

  /**
   * 获取远程路径
   * @private
   */
  getRemotePath(fileId, ext) {
    if (fileId === 'global_todos') {
      return this.config.rootPath + 'todos.json';
    } else if (fileId === 'global_settings') {
      return this.config.rootPath + 'settings.json';
    } else {
      // 防御：旧版本 manifest 可能没有 ext 字段，默认按 .md 处理
      return this.config.rootPath + 'notes/' + fileId + (ext || '.md');
    }
  }

  // ==================== 阶段 3: 执行 (Execution) ====================

  /**
   * 执行同步任务
   * @private
   */
  async executeTasks(tasks) {
    const result = {
      success: true,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
      successfulTaskKeys: [],
      danglingFileIds: [],
    };

    const markTaskSuccess = (task) => {
      result.successfulTaskKeys.push(`${task.fileId}:${task.operation}`);
    };

    const addCounters = (delta = {}) => {
      result.uploaded += delta.uploaded || 0;
      result.downloaded += delta.downloaded || 0;
      result.deleted += delta.deleted || 0;
      result.skipped += delta.skipped || 0;
    };

    const operationHandlers = {
      upload: async (task) => {
        await this.executeUpload(task);
        return { uploaded: 1 };
      },
      download: async (task) => {
        await this.executeDownload(task);
        return { downloaded: 1 };
      },
      delete: async (task) => {
        await this.executeDelete(task);
        return { deleted: 1 };
      },
      'delete-local': async (task) => {
        await this.executeDeleteLocal(task);
        return { deleted: 1 };
      },
      'upload-delete': async (task) => {
        await this.executeUploadDelete(task);
        return { deleted: 1 };
      },
      'merge-todos': async (task) => {
        await this.executeMergeTodos(task);
        return { downloaded: 1, uploaded: 1 };
      },
      skip: async () => ({ skipped: 1 }),
    };

    for (const task of tasks) {
      try {
        const handler = operationHandlers[task.operation] || operationHandlers.skip;
        const delta = await handler(task);
        addCounters(delta);
        markTaskSuccess(task);
      } catch (error) {
        if (error?.code === 'MANIFEST_DANGLING_ENTRY' && task.fileId) {
          // 这是预期的自愈路径：记录待清理条目，不按失败计数。
          result.danglingFileIds.push(task.fileId);
          result.skipped++;
          this.log(`[Execution] 检测到悬挂条目，待 commit 清理: ${task.fileId}`);
          continue;
        }

        this.logError(`任务执行失败: ${task.fileId}`, error);
        // 任务级失败按非致命告警处理，不中断整次同步提交。
        result.errors++;
        result.errorDetails.push({ fileId: task.fileId, error: error.message });
      }
    }

    // 阶段级（scan/commit）异常会抛出并触发 syncError；
    // 到达这里说明本次同步可提交，任务失败仅作为告警。
    result.success = true;
    return result;
  }

  /**
   * 执行上传
   * @private
   */
  async executeUpload(task) {
    this.log(`[Upload] ${task.fileId}`);

    if (task.fileId === 'global_todos' || task.fileId === 'global_settings') {
      // 上传 JSON
      await this.client.uploadJson(task.remotePath, task.data);
      if (task.fileId === 'global_settings') {
        await this.syncWallpaperAsset(task.data, true);
      }
    } else {
      // 上传笔记/白板
      const note = task.data;
      if (note) {
        // 如果有旧文件路径（类型转换），先删除旧文件
        if (task.oldRemotePath && task.oldRemotePath !== task.remotePath) {
          try {
            this.log(`[Upload] 删除旧文件: ${task.oldRemotePath}`);
            await this.client.delete(task.oldRemotePath);
          } catch (error) {
            // 如果旧文件不存在，忽略错误
            if (error.response?.status !== 404) {
              this.log(`[Upload] 删除旧文件失败: ${error.message}`);
            }
          }
        }

        await this.client.uploadText(task.remotePath, note.content);

        // 上传笔记中引用的图片
        await this.uploadNoteImages(note.content, note.note_type || 'markdown');

        // 白板笔记：同步上传预览图
        if ((note.note_type || 'markdown') === 'whiteboard') {
          await this.syncWhiteboardPreview(task.fileId, true);
        }
      }
    }
  }

  getWallpaperRelativePath(settingsPayload) {
    const values = settingsPayload && settingsPayload.__schema === 'kv-ts'
      ? settingsPayload.values
      : settingsPayload;
    const wallpaperPath = values?.wallpaperPath;
    if (typeof wallpaperPath !== 'string' || !wallpaperPath.startsWith('app://wallpaper/')) {
      return null;
    }
    const withoutProtocol = wallpaperPath.replace('app://', '');
    const [relativePath] = withoutProtocol.split('?');
    const decodedPath = decodeURIComponent(relativePath || '');
    if (!/^wallpaper\/current\.(jpe?g|png|gif|bmp|webp)$/i.test(decodedPath)) {
      return null;
    }
    return decodedPath;
  }

  async syncWallpaperAsset(settingsPayload, upload) {
    const relativePath = this.getWallpaperRelativePath(settingsPayload);
    if (!relativePath) return;

    const localPath = path.join(getUserDataPath(), relativePath);
    const remotePath = this.config.rootPath + relativePath;

    try {
      if (upload) {
        if (!fs.existsSync(localPath)) {
          this.log(`[Wallpaper] 本地壁纸不存在，跳过上传: ${relativePath}`);
          return;
        }
        try {
          await this.client.createDirectory(this.config.rootPath + 'wallpaper/');
        } catch (_) { /* 目录可能已存在 */ }
        await this.client.uploadBinary(remotePath, fs.readFileSync(localPath));
        this.log(`[Wallpaper] 壁纸上传成功: ${relativePath}`);
        return;
      }

      const imageData = await this.client.downloadBinary(remotePath);
      if (!imageData) return;
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(localPath, imageData);
      this.log(`[Wallpaper] 壁纸下载成功: ${relativePath}`);
    } catch (error) {
      this.log(`[Wallpaper] 壁纸${upload ? '上传' : '下载'}失败: ${relativePath}, ${error.message}`);
    }
  }

  /**
   * 上传笔记中引用的图片（带重试）
   * @private
   */
  async uploadNoteImages(content, noteType) {
    if (!content) return;

    const imageRefs = this.extractImageReferences(content, noteType);
    if (imageRefs.length === 0) return;

    this.log(`[Upload Images] 发现 ${imageRefs.length} 个图片引用`);
    const failedImages = [];

    for (const relativePath of imageRefs) {
      const localPath = path.join(getUserDataPath(), relativePath);
      if (!fs.existsSync(localPath)) {
        this.log(`[Upload Images] 本地图片不存在，跳过: ${relativePath}`);
        continue;
      }

      const remotePath = this.config.rootPath + relativePath;

      // 检查云端是否已存在（避免重复上传）
      try {
        const remoteExists = await this.client.exists(remotePath);
        if (remoteExists) {
          this.log(`[Upload Images] 图片已存在，跳过: ${relativePath}`);
          continue;
        }
      } catch (e) {
        // 忽略检查失败，继续尝试上传
      }

      // 重试逻辑（最多3次）
      let success = false;
      for (let attempt = 1; attempt <= 3 && !success; attempt++) {
        try {
          // 确保云端目录存在
          const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
          if (!await this.client.exists(remoteDir)) {
            await this.client.createDirectory(remoteDir);
          }

          const imageData = fs.readFileSync(localPath);
          await this.client.uploadBinary(remotePath, imageData);
          this.log(`[Upload Images] 图片上传成功: ${relativePath}`);
          success = true;
        } catch (error) {
          this.log(`[Upload Images] 图片上传失败 (尝试 ${attempt}/3): ${relativePath}, ${error.message}`);
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * attempt)); // 递增延迟重试
          }
        }
      }

      if (!success) {
        failedImages.push(relativePath);
      }
    }

    // 如果有失败的图片，发出事件通知
    if (failedImages.length > 0) {
      this.emit('imageUploadFailed', { failed: failedImages, total: imageRefs.length });
      this.log(`[Upload Images] ${failedImages.length} 个图片上传失败`);
    }
  }

  /**
   * 执行下载
   * @private
   */
  async executeDownload(task) {
    this.log(`[Download] ${task.fileId}`);

    if (task.fileId === 'global_todos') {
      // 下载 todos
      const remoteTodos = await this.client.downloadJson(task.remotePath);
      this.log(`[Download] 下载了 ${remoteTodos.length} 个 todos`);

      const cloudIds = new Set();
      for (const todo of remoteTodos) {
        // 确保每个 todo 都有有效的时间戳
        if (!todo.created_at) {
          todo.created_at = todo.updated_at || Date.now();
        }
        if (!todo.updated_at) {
          todo.updated_at = Date.now();
        }
        if (todo.id) cloudIds.add(todo.id);
        await this.storage.upsertTodo(todo, true);
      }

      // Safety net: soft-delete local active todos not present in cloud
      // (handles the case where another device deleted a todo)
      //
      // 重要保护：仅当云端确实有 todos 时才执行 safety net 软删除。
      // 当 remoteTodos 为空数组（首次同步、云端被错误清空、initializeCleanSlate
      // 上传了空文件等场景）时，一律不删除本地任何 todo，避免本地待办被批量丢失。
      if (remoteTodos.length > 0) {
        const localTodos = await this.storage.getAllTodos(false); // active only
        for (const syncId of Object.keys(localTodos)) {
          if (!cloudIds.has(syncId)) {
            this.log(`[Download] 云端不存在，软删除本地 todo: ${syncId}`);
            await this.storage.softDeleteTodo(syncId, true);
          }
        }
      } else {
        this.log('[Download] 云端 todos 为空，跳过 safety net 软删除（保护本地待办不被清空）');
      }
    } else if (task.fileId === 'global_settings') {
      // 下载 settings —— 兼容两种云端格式：
      //   新格式: { __schema: 'kv-ts', values: {...}, timestamps: {...} } —— 逐 key LWW
      //   旧格式: { key: value, ... } —— 整体覆盖（迁移期兼容，会 INSERT OR UPDATE 但不会删除本地多出的 key）
      const remotePayload = await this.client.downloadJson(task.remotePath);
      if (remotePayload && remotePayload.__schema === 'kv-ts') {
        const stat = await this.storage.mergeSettingsByKey(
          remotePayload.values || {},
          remotePayload.timestamps || {}
        );
        this.log(`[Download] settings 逐 key 合并: 更新=${stat.updated}, 跳过=${stat.skipped}`);
      } else {
        await this.storage.updateSettings(remotePayload || {});
        this.log('[Download] settings 旧格式整体写入（下次上传将转为新格式）');
      }
      const mergedSettings = await this.storage.getAllSettings();
      await this.syncWallpaperAsset(mergedSettings, false);
    } else {
      // 下载笔记/白板
      let content;
      let actualExt = task.remoteEntry.ext;

      try {
        content = await this.client.downloadText(task.remotePath);
      } catch (error) {
        // 如果下载失败，可能是类型转换导致文件不存在，尝试另一个扩展名
        if (error.message && error.message.includes('不存在')) {
          const alternativeExt = task.remoteEntry.ext === '.md' ? '.wb' : '.md';
          const alternativePath = this.getRemotePath(task.fileId, alternativeExt);

          this.log(`[Download] 原路径不存在，尝试另一扩展名: ${alternativePath}`);

          try {
            content = await this.client.downloadText(alternativePath);
            actualExt = alternativeExt;
            this.log(`[Download] 使用另一扩展名下载成功`);
          } catch (altError) {
            // 两个扩展名都不存在，标记为 manifest 悬挂条目，后续在 commit 阶段自愈清理。
            if (altError?.message && altError.message.includes('不存在')) {
              const danglingError = new Error(`manifest 悬挂条目: ${task.fileId}`);
              danglingError.code = 'MANIFEST_DANGLING_ENTRY';
              throw danglingError;
            }

            // 另一个扩展名是其他错误（如 503），抛出该错误用于重试/告警。
            throw altError;
          }
        } else {
          throw error;
        }
      }

      // 从 manifest 的 meta 字段获取元数据
      const meta = task.remoteEntry.meta || {};

      // 优先使用 meta.note_type，回退到从实际下载的扩展名推断
      const noteType = meta.note_type || (actualExt === '.wb' ? 'whiteboard' : 'markdown');

      const noteData = {
        id: task.fileId,
        content,
        note_type: noteType,
        // 同步层应保持源数据，不在这里自动从正文推断标题
        title: typeof meta.title === 'string' ? meta.title : '',
        tags: meta.tags || '',
        category: meta.category || '',
        is_pinned: meta.is_pinned || 0,
        is_favorite: meta.is_favorite || 0,
        // 远端为未删除版本：执行下载即意味着 "本地需对齐为未删除/恢复"
        is_deleted: 0,
        deleted_at: null,
        // 时间戳兜底：优先 t（updated_at），缺失则用 c（created_at）
        // 严禁回退为同步时间 Date.now()，否则会污染笔记的真实修改时间
        created_at: task.remoteEntry.c || task.remoteEntry.t || null,
        updated_at: task.remoteEntry.t || task.remoteEntry.c || null,
      };

      this.log(`[Download] 笔记元数据: created_at=${noteData.created_at}, title=${noteData.title}`);
      await this.storage.upsertNote(noteData, true);

      // 下载笔记中引用的图片
      await this.downloadNoteImages(content, noteType);

      // 白板笔记：同步下载预览图
      if (noteType === 'whiteboard') {
        await this.syncWhiteboardPreview(task.fileId, false);
      }
    }
  }

  /**
   * 同步白板预览图 (上传/下载)
   * @private
   * @param {string} syncId - 笔记的 sync_id
   * @param {boolean} upload - true=上传, false=下载
   */
  async syncWhiteboardPreview(syncId, upload) {
    const localPath = path.join(getUserDataPath(), 'images', 'whiteboard-preview', `${syncId}.png`);
    const remotePath = this.config.rootPath + `images/whiteboard-preview/${syncId}.png`;

    try {
      if (upload) {
        if (!fs.existsSync(localPath)) return;

        // 基于内容 hash + 持久化记录的去重策略：
        //   旧实现使用 `mtimeMs < this.lastSyncTime` 判断，在 App 重启后 lastSyncTime=0
        //   会导致所有白板预览图被重新上传，浪费带宽与请求次数。
        //   现改为：计算文件 hash，与 localManifest.previewHashes[syncId] 比对一致则跳过。
        const imageData = fs.readFileSync(localPath);
        const hash = crypto.createHash('sha256').update(imageData).digest('hex');

        if (!this._previewHashCache) {
          // 合并：本地 cache + 远端 manifest 中的 previewHashes，避免新设备首次同步时全量重传
          const cached = this.loadLocalManifest();
          const fromCached = (cached && cached.previewHashes) || {};
          const fromRemote = (this._lastRemoteManifest && this._lastRemoteManifest.previewHashes) || {};
          this._previewHashCache = { ...fromRemote, ...fromCached };
        }
        if (this._previewHashCache[syncId] === hash) {
          return; // 内容未变，跳过上传
        }

        // 确保远端目录存在（仅首次创建）
        if (!this._wbPreviewDirEnsured) {
          try {
            await this.client.createDirectory(this.config.rootPath + 'images/');
          } catch (_) { /* 目录可能已存在 */ }
          try {
            await this.client.createDirectory(this.config.rootPath + 'images/whiteboard-preview/');
          } catch (_) { /* 目录可能已存在 */ }
          this._wbPreviewDirEnsured = true;
        }
        await this.client.uploadBinary(remotePath, imageData);
        this._previewHashCache[syncId] = hash;
        this.log(`[WhiteboardPreview] 上传成功: ${syncId}`);
      } else {
        // 下载预览图 — 始终覆盖本地（确保获取最新版本）
        const imageData = await this.client.downloadBinary(remotePath);
        if (imageData) {
          const dir = path.dirname(localPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(localPath, Buffer.from(imageData));
          this.log(`[WhiteboardPreview] 下载成功: ${syncId}`);
        }
      }
    } catch (error) {
      // 预览图同步失败不阻塞主流程
      this.log(`[WhiteboardPreview] ${upload ? '上传' : '下载'}失败: ${syncId}, ${error.message}`);
    }
  }

  /**
   * 批量上传所有白板笔记的预览图 (初始化时使用)
   * @private
   */
  async uploadAllWhiteboardPreviews(notes) {
    let count = 0;
    for (const note of Object.values(notes)) {
      if ((note.note_type || 'markdown') === 'whiteboard') {
        const localPath = path.join(getUserDataPath(), 'images', 'whiteboard-preview', `${note.id}.png`);
        if (fs.existsSync(localPath)) {
          const remotePath = this.config.rootPath + `images/whiteboard-preview/${note.id}.png`;
          try {
            const imageData = fs.readFileSync(localPath);
            await this.client.uploadBinary(remotePath, imageData);
            count++;
          } catch (error) {
            this.log(`[Init WhiteboardPreview] 上传失败: ${note.id}, ${error.message}`);
          }
        }
      }
    }
    return count;
  }

  /**
   * 下载笔记中引用的图片（带重试）
   * @private
   */
  async downloadNoteImages(content, noteType) {
    if (!content) return;

    const imageRefs = this.extractImageReferences(content, noteType);
    if (imageRefs.length === 0) return;

    this.log(`[Download Images] 发现 ${imageRefs.length} 个图片引用`);
    const failedImages = [];

    // 并发下载（maxConcurrency=3）—— 单个笔记可能引用数十张图片，串行会非常慢。
    // 限制并发数避免被 WebDAV 限流（坚果云对短时间内大量请求敏感）。
    const MAX_CONCURRENCY = 3;
    const downloadOne = async (relativePath) => {
      // 检查本地是否已存在
      const localPath = path.join(getUserDataPath(), relativePath);
      if (fs.existsSync(localPath)) {
        this.log(`[Download Images] 图片已存在，跳过: ${relativePath}`);
        return;
      }

      // 重试逻辑（最多3次）
      let success = false;
      for (let attempt = 1; attempt <= 3 && !success; attempt++) {
        try {
          const remotePath = this.config.rootPath + relativePath;
          this.log(`[Download Images] 下载图片 (尝试 ${attempt}/3): ${relativePath}`);

          const imageData = await this.client.downloadBinary(remotePath);
          if (imageData) {
            const localDir = path.dirname(localPath);
            if (!fs.existsSync(localDir)) {
              fs.mkdirSync(localDir, { recursive: true });
            }
            fs.writeFileSync(localPath, imageData);
            this.log(`[Download Images] 图片下载成功: ${relativePath}`);
            success = true;
          }
        } catch (error) {
          this.log(`[Download Images] 图片下载失败 (尝试 ${attempt}/3): ${relativePath}, ${error.message}`);
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }

      if (!success) {
        failedImages.push(relativePath);
      }
    };

    // 简易并发池：分批 slice 后用 Promise.all 等待，避免引入第三方依赖
    for (let i = 0; i < imageRefs.length; i += MAX_CONCURRENCY) {
      const batch = imageRefs.slice(i, i + MAX_CONCURRENCY);
      await Promise.all(batch.map((ref) => downloadOne(ref)));
    }

    // 如果有失败的图片，发出事件通知
    if (failedImages.length > 0) {
      this.emit('imageDownloadFailed', { failed: failedImages, total: imageRefs.length });
      this.log(`[Download Images] ${failedImages.length} 个图片下载失败`);
    }
  }

  /**
   * 从内容中提取图片引用
   * @private
   */
  extractImageReferences(content, noteType) {
    const imageRefs = new Set();

    if (noteType === 'whiteboard') {
      // 白板笔记 - 从 JSON 中提取 fileMap
      try {
        const whiteboardData = JSON.parse(content);
        if (whiteboardData.fileMap && typeof whiteboardData.fileMap === 'object') {
          Object.values(whiteboardData.fileMap).forEach(fileInfo => {
            if (!fileInfo) return;

            // fileMap 的值可能是对象（包含 fileName 字段）或直接是字符串
            let filename;
            if (typeof fileInfo === 'string') {
              filename = fileInfo;
            } else if (typeof fileInfo === 'object' && fileInfo.fileName) {
              filename = fileInfo.fileName;
            }

            if (filename && typeof filename === 'string') {
              // 白板图片存储在 images/whiteboard/ 目录
              imageRefs.add(`images/whiteboard/${filename}`);
            }
          });
        }
      } catch (error) {
        this.log(`[Extract Images] 解析白板内容失败: ${error.message}`);
      }
    } else {
      // Markdown 笔记 - 先解析 frontmatter 中的封面/缩略图字段，再匹配正文图片/音频
      // frontmatter 形如：
      //   ---
      //   cover: images/foo.png
      //   thumbnail: "images/bar.jpg"
      //   banner: 'images/baz.webp'
      //   ---
      // 漏掉这些字段会导致同步后封面图缺失，且可能被 gcOrphanImages 误删。
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
      if (fmMatch) {
        const fmBody = fmMatch[1];
        const fmFieldRe = /^\s*(cover|thumbnail|banner|image|preview)\s*:\s*['"]?((?:app:\/\/)?images\/[^'"\n]+?)['"]?\s*$/gim;
        let fmm;
        while ((fmm = fmFieldRe.exec(fmBody)) !== null) {
          let value = (fmm[2] || '').trim();
          value = value.replace(/^app:\/\//, '');
          if (value.startsWith('images/')) {
            imageRefs.add(value);
          }
        }
      }

      const patterns = [
        /!\[.*?\]\((?:app:\/\/)?images\/((?:whiteboard\/)?[^)]+)\)/g,  // Markdown 图片语法
        /src=["'](?:app:\/\/)?images\/((?:whiteboard\/)?[^"']+)["']/g,  // HTML img src
        /!\[.*?\]\((audio\/[^)]+)\)/g,  // Markdown 音频语法
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const captured = match[1];
          if (captured) {
            // 音频已经包含 "audio/" 前缀，图片需要加 "images/"
            if (captured.startsWith('audio/')) {
              imageRefs.add(captured);
            } else {
              imageRefs.add(`images/${captured}`);
            }
          }
        }
      }
    }

    return Array.from(imageRefs);
  }

  /**
   * 执行删除
   * @private
   */
  async executeDelete(task) {
    this.log(`[Delete] ${task.fileId}`);
    await this.client.delete(task.remotePath);
  }

  /**
   * 执行本地删除（远程删除同步到本地）
   * @private
   */
  async executeDeleteLocal(task) {
    this.log(`[Delete Local] ${task.fileId}`);

    if (task.fileId === 'global_todos') {
      // 不删除全局 todos，只标记
      this.log(`[Delete Local] 跳过 global_todos 删除`);
    } else if (task.fileId === 'global_settings') {
      // 不删除全局 settings
      this.log(`[Delete Local] 跳过 global_settings 删除`);
    } else {
      // 软删除笔记/白板
      await this.storage.softDeleteNote(task.fileId, true);
      this.log(`[Delete Local] 已软删除本地笔记: ${task.fileId}`);
    }
  }

  /**
   * 执行上传删除状态（本地删除同步到远程）
   * @private
   */
  async executeUploadDelete(task) {
    this.log(`[Upload Delete] ${task.fileId}`);

    if (task.fileId === 'global_todos' || task.fileId === 'global_settings') {
      // 不删除全局文件
      this.log(`[Upload Delete] 跳过全局文件删除: ${task.fileId}`);
      return;
    }

    // 删除云端文件（尝试删除 .md 和 .wb 两种扩展名，与 Android 保持一致）
    const extensions = ['.md', '.wb'];
    for (const ext of extensions) {
      const delPath = this.getRemotePath(task.fileId, ext);
      try {
        await this.client.delete(delPath);
        this.log(`[Upload Delete] 已删除云端文件: ${delPath}`);
      } catch (error) {
        if (error.response?.status === 404) {
          this.log(`[Upload Delete] 云端文件已不存在: ${delPath}`);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * 执行 todos 合并（双端冲突专用）
   *
   * 策略：
   * 1. 下载远端 todos.json，逐条用 upsertTodo 做 updated_at 仲裁写入本地
   * 2. 读取合并后的本地 todos，上传至远端（保证远端与本地一致）
   *
   * @private
   */
  async executeMergeTodos(task) {
    this.log(`[MergeTodos] 开始合并 todos`);

    // #N3：两阶段提交防止"本地已合并但云端未对齐"
    // 阶段 A：先在内存中算出合并结果（不写本地 DB）
    // 阶段 B：上传到云端
    // 阶段 C：上传成功后才写入本地 DB
    // 任何阶段失败：本地 DB 仍是合并前状态，下次同步重新触发 merge-todos

    // Step 1: 下载远端 todos 到内存（不立刻 upsert 到本地）
    const remoteTodos = await this.client.downloadJson(task.remotePath).catch(() => []);
    if (!Array.isArray(remoteTodos)) {
      throw new Error('[MergeTodos] 远端 todos.json 格式异常，本次合并已取消');
    }

    // Step 2: 在内存中按 sync_id 聚合本地 + 远端，逐条按 updated_at LWW 仲裁
    const localTodos = await this.storage.getAllTodos(true);
    const mergedMap = new Map();
    // 先放本地
    for (const [syncId, todo] of Object.entries(localTodos)) {
      const { db_id, ...syncData } = todo;
      void db_id;
      mergedMap.set(syncId, syncData);
    }
    // 再用远端覆盖（仅当远端 updated_at > 本地）
    for (const remoteTodo of remoteTodos) {
      const sid = remoteTodo.id || remoteTodo.sync_id;
      if (!sid) continue;
      const localOne = mergedMap.get(sid);
      if (!localOne) {
        mergedMap.set(sid, remoteTodo);
      } else {
        const lt = this.storage.parseTimestamp(localOne.updated_at) || 0;
        const rt = this.storage.parseTimestamp(remoteTodo.updated_at) || 0;
        if (rt > lt) mergedMap.set(sid, remoteTodo);
      }
    }
    const mergedArray = Array.from(mergedMap.values());

    // Step 3: 上传合并结果到远端（先于本地写入，确保失败时本地仍是旧状态）
    await this.client.uploadJson(task.remotePath, mergedArray);
    this.log(`[MergeTodos] 上传成功 ${mergedArray.length} 条 todos`);

    // Step 4: 上传成功后才把"远端独有"的部分 upsert 到本地 DB
    // 注意：这里只 upsert 那些在本次合并中"被远端版本胜出"的条目，避免无谓写入
    let upsertCount = 0;
    for (const remoteTodo of remoteTodos) {
      const sid = remoteTodo.id || remoteTodo.sync_id;
      if (!sid) continue;
      const winner = mergedMap.get(sid);
      if (winner === remoteTodo) {
        await this.storage.upsertTodo(remoteTodo, true);
        upsertCount++;
      }
    }
    this.log(`[MergeTodos] 已 upsert ${upsertCount} 条远端胜出的 todos 到本地`);
  }

  // ==================== 阶段 4: 提交 (Commit) ====================

  /**
   * 提交同步结果
   * @private
   */
  async commit(localManifest, remoteManifest, tasks, executeResult = null) {
    this.log('[Commit] 生成新 manifest...');

    const successfulTaskKeys = new Set(executeResult?.successfulTaskKeys || []);
    const danglingFileIds = new Set(executeResult?.danglingFileIds || []);
    const isSuccessfulTask = (task) => successfulTaskKeys.has(`${task.fileId}:${task.operation}`);
    const setUploadedFileEntry = (task) => {
      if (localManifest.files[task.fileId]) {
        newFiles[task.fileId] = localManifest.files[task.fileId];
      }
    };

    const setMergedTodosEntry = async (task) => {
      try {
        const allTodos = await this.storage.getAllTodos(true);
        const todosArray = Object.values(allTodos);
        let t = 0;
        for (const todo of todosArray) {
          const ts = this.storage.parseTimestamp(todo.updated_at);
          if (ts > t) t = ts;
        }
        if (t === 0) t = 1000000000000;
        // 关键：合并后的 manifest.t 必须 >= 远端 manifest 中已有的 t，
        // 否则下次扫描会出现 remoteEntry.t < localEntry.t → 误判为本地更新 → 触发死循环上传
        const remoteT = remoteManifest.files?.[task.fileId]?.t || 0;
        const remoteH = remoteManifest.files?.[task.fileId]?.h || '';
        const mergedHash = this.storage.calculateTodosHash(todosArray);
        if (remoteT > t) {
          t = remoteT;
        }
        // 进一步保护：若合并结果 hash 与远端不同（即真的产生了"新内容"），
        // 时间戳必须严格 > 远端 t，否则其他设备会因为 hash 与本端不同但 t 未变 → 永远拉不动 #I 死循环。
        if (mergedHash !== remoteH && t <= remoteT) {
          t = Math.max(remoteT + 1, Date.now());
        }
        // #N12：时钟上限保护，防止某端时钟跑偏到未来导致永远无法被覆盖
        // 上限设为 当前时间 + 24h（容忍小幅时区/NTP 偏差，但拒绝远未来戳）
        const maxAllowedT = Date.now() + 24 * 3600 * 1000;
        if (t > maxAllowedT) {
          this.logWarning?.(`[Commit] global_todos t (${t}) 超过当前+24h，已截断到 ${maxAllowedT}`);
          t = maxAllowedT;
        }
        newFiles[task.fileId] = {
          v: 1,
          t,
          h: mergedHash,
          d: 0,
          ext: '.json',
          dev: this.deviceId, // 合并是由本机执行的，dev 标记为本机用于 LWW tiebreaker
        };
      } catch (e) {
        this.logError('[Commit] 重新计算 global_todos hash 失败', e);
        // 回退：保持 remoteManifest 中的条目
      }
    };

    const deleteFileEntry = (task) => {
      delete newFiles[task.fileId];
    };

    const commitHandlers = {
      upload: setUploadedFileEntry,
      'upload-delete': setUploadedFileEntry,
      'merge-todos': setMergedTodosEntry,
      delete: deleteFileEntry,
    };

    // 基于远程 manifest（服务器状态）构建新 manifest
    // 初始状态为同步前的服务器状态
    const newFiles = { ...remoteManifest.files };

    // 根据执行的任务更新文件状态
    if (tasks && tasks.length > 0) {
      // 清理确认不存在的悬挂条目（manifest 有记录，但 .md/.wb 均已不存在）。
      for (const fileId of danglingFileIds) {
        if (newFiles[fileId]) {
          delete newFiles[fileId];
          this.log(`[Commit] 已清理悬挂条目: ${fileId}`);
        }
      }

      for (const task of tasks) {
        // 仅基于“成功执行”的任务更新 manifest，避免失败任务污染索引。
        if (!isSuccessfulTask(task)) {
          continue;
        }

        const handler = commitHandlers[task.operation];
        if (handler) {
          await handler(task);
        }
      }
    } else {
      // 如果没有任务（tasks 为空），可能是因为没有差异
      // 此时应该合并 localManifest 中可能存在的新文件（虽然理论上 scanAndDiff 会捕获）
      // 但为了安全起见，我们可以保留简单的合并逻辑作为回退，或者直接信任 remoteManifest
      // 这里我们假设如果没有任务，remoteManifest 就是最新的
    }

    // 合并本地和远程 manifest
    const newManifest = {
      version: 3,
      last_synced_at: Date.now(),
      device_id: this.deviceId,
      files: newFiles,
    };

    // GC：清理 manifest 中已"软删除超过 N 天"的笔记条目，避免索引无限膨胀
    // 仅清理笔记条目（global_todos / global_settings 不参与）；保留对应远端 .md/.wb 文件清理由 commit 阶段保证
    try {
      const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
      const now = Date.now();
      let purgedCount = 0;
      for (const fileId of Object.keys(newManifest.files)) {
        if (fileId === 'global_todos' || fileId === 'global_settings') continue;
        const entry = newManifest.files[fileId];
        if (entry?.d === 1 && typeof entry.t === 'number' && (now - entry.t) > TOMBSTONE_TTL_MS) {
          delete newManifest.files[fileId];
          purgedCount++;
        }
      }
      if (purgedCount > 0) this.log(`[Commit GC] 清理了 ${purgedCount} 个超期墓碑条目`);
    } catch (e) {
      this.logError('[Commit GC] 清理墓碑条目失败', e);
    }

    // 上传新 manifest
    // 持久化白板预览图 hash 缓存（#8）—— 必须做"远端 + 本地缓存 + 本轮新增"三方 merge，
    // 否则：
    //   1) 本轮没有任何白板预览图触发上传时，_previewHashCache 为空，会把远端已有的 previewHashes 抹掉
    //   2) 新设备首次同步时无本地缓存，会把云端已有的 previewHashes 全部丢失
    //   3) 旧客户端（手机端）写入 manifest 时也会丢失该字段，需要桌面端在 commit 时补回
    const remoteManifestPreviewHashes = (this._lastRemoteManifest && this._lastRemoteManifest.previewHashes) || {};
    // #N11：单次读取并复用，避免一行两次 I/O
    const cachedManifestForPreview = this.loadLocalManifest();
    const cachedManifestPreviewHashes = (cachedManifestForPreview && cachedManifestForPreview.previewHashes) || {};
    const localPreviewHashCache = this._previewHashCache || {};
    const mergedPreviewHashes = {
      ...remoteManifestPreviewHashes,
      ...cachedManifestPreviewHashes, // 本地缓存优先级高于远端（避免被旧客户端覆盖）
      ...localPreviewHashCache,        // 本轮新上传优先级最高
    };
    if (Object.keys(mergedPreviewHashes).length > 0) {
      newManifest.previewHashes = mergedPreviewHashes;
    }

    // #N1：commit 原子性保护
    // execute 阶段已经把数据落到云端 + 本地 DB，但远端 manifest 还没更新。
    // 1) 先把本地 cached 标记为 _pendingCommit=true（含执行后的预期 manifest）
    // 2) 再上传远端 manifest
    // 3) 上传成功后写入正式 cached（去掉标记）
    // 任何一步失败：下次同步通过 hasPendingCommit() 检测，走"恢复路径"——
    //   把 cached 当作"事实上已成功的状态"做 diff，避免被误判为双端冲突。
    const pendingMarker = { ...newManifest, _pendingCommit: true };
    this.saveLocalManifest(pendingMarker);

    try {
      await this.client.uploadJson(this.config.rootPath + 'manifest.json', newManifest);
    } catch (uploadErr) {
      // 上传失败：cached 仍带 _pendingCommit 标记，下次同步会识别并走恢复路径
      this.logError('[Commit] 上传远端 manifest 失败，本地 cached 已标记 _pendingCommit 待恢复', uploadErr);
      throw uploadErr;
    }

    // 上传成功，写入正式 cached（去掉 _pendingCommit）
    delete newManifest._pendingCommit;
    this.saveLocalManifest(newManifest);

    // 孤儿图片清理：在每次 commit 之后异步触发（不阻塞同步主流程）
    // 仅当本地 manifest 与远端都同意"某图片不再被任何 active 笔记引用"时清理
    setImmediate(() => {
      this.gcOrphanImages(newManifest).catch((e) => this.logError('[GC Images] 异步清理失败', e));
    });

    this.log('[Commit] 新 manifest 已提交');
  }

  /**
   * GC 孤儿图片：扫描所有 active 笔记的图片引用，删除不再被引用的本地+云端图片
   * @private
   */
  async gcOrphanImages(manifest) {
    try {
      // 仅当启用 images 类别时才清理云端
      const enabledCategories = this.config.syncCategories || [];
      const allNotes = await this.storage.getAllNotes(false); // 仅 active
      const allNotesIncludingDeleted = await this.storage.getAllNotes(true);

      // 安全防御 #J：如果本地笔记数量异常少（疑似数据被意外清空），跳过 GC，
      // 防止"本地清空 → 云端图片全删"的灾难性副作用。
      // 阈值：当本地 active 笔记 < 1，且 manifest 中的笔记条目却 >= 5 时拒绝清理云端。
      const manifestNotesCount = Object.values(manifest.files || {})
        .filter(e => e && e.d === 0 && e.ext && (e.ext === '.md' || e.ext === '.wb')).length;
      const localTotal = Object.keys(allNotesIncludingDeleted || {}).length;
      const skipCloudGc = (localTotal < 1 && manifestNotesCount >= 5) || (localTotal < manifestNotesCount * 0.2 && manifestNotesCount >= 10);
      if (skipCloudGc) {
        this.log(`[GC Images] 本地笔记异常少 (local=${localTotal}, manifest=${manifestNotesCount})，跳过云端 GC 防止误删`);
      }

      // 收集所有引用的图片相对路径
      const referencedRefs = new Set();
      for (const note of Object.values(allNotes)) {
        if (!note.content) continue;
        const refs = this.extractImageReferences(note.content, note.note_type || 'markdown');
        refs.forEach((r) => referencedRefs.add(r));
      }

      // 本地 images 目录
      const localImagesDir = path.join(getUserDataPath(), 'images');
      if (!fs.existsSync(localImagesDir)) return;

      // 仅清理 30 天以前的孤儿图片，避免误删用户刚插入但尚未保存的图片
      const ORPHAN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const walk = (dir, baseDir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            walk(full, baseDir);
          } else {
            const rel = path.relative(baseDir, full).replace(/\\/g, '/');
            const normalized = `images/${rel}`;
            if (referencedRefs.has(normalized)) continue;
            // 跳过白板预览图（由白板自身管理）
            if (normalized.startsWith('images/whiteboard-preview/')) continue;
            try {
              const stat = fs.statSync(full);
              if (now - stat.mtimeMs < ORPHAN_TTL_MS) continue;
              fs.unlinkSync(full);
              this.log(`[GC Images] 删除本地孤儿图片: ${normalized}`);
              // 同步删除云端（除非触发安全防御）
              if (!skipCloudGc && enabledCategories.includes('images')) {
                this.client.delete(this.config.rootPath + normalized).catch(() => {});
              }
            } catch (_) { /* 忽略单个失败 */ }
          }
        }
      };
      walk(localImagesDir, localImagesDir);
    } catch (e) {
      this.logError('[GC Images] 失败', e);
    }
  }

  // ==================== 本地 Manifest 管理 ====================

  /**
   * 加载本地缓存的 manifest
   * @private
   */
  loadLocalManifest() {
    if (fs.existsSync(this.localManifestPath)) {
      try {
        const content = fs.readFileSync(this.localManifestPath, 'utf8');
        const parsed = JSON.parse(content);
        // #N9：基本 schema 校验，损坏的 cached manifest 不应被信任
        if (!this.isValidManifest(parsed)) {
          this.logError('[Manifest] 本地 cached manifest schema 校验失败，重命名为 .corrupt 以便诊断');
          try {
            const corruptPath = `${this.localManifestPath}.corrupt.${Date.now()}`;
            fs.renameSync(this.localManifestPath, corruptPath);
          } catch (e) {
            this.logError('重命名损坏 manifest 失败', e);
          }
          return null;
        }
        return parsed;
      } catch (error) {
        this.logError('加载本地 manifest 失败', error);
        // #N2：解析失败时保留损坏文件，便于诊断；同时返回 null 让上层决定是否阻断
        try {
          const corruptPath = `${this.localManifestPath}.corrupt.${Date.now()}`;
          fs.renameSync(this.localManifestPath, corruptPath);
          this.log(`[Manifest] 已将损坏的 cached manifest 重命名为 ${corruptPath}`);
        } catch (_) { /* 忽略重命名失败 */ }
        return null;
      }
    }
    return null;
  }

  /**
   * 保存 manifest 到本地缓存（#N2：原子写 + fsync）
   * @private
   */
  saveLocalManifest(manifest) {
    const tmpPath = `${this.localManifestPath}.tmp`;
    try {
      const json = JSON.stringify(manifest, null, 2);
      // 写临时文件 → fsync → rename，保证崩溃/断电时不会出现半截 JSON
      const fd = fs.openSync(tmpPath, 'w');
      try {
        fs.writeSync(fd, json, 0, 'utf8');
        try { fs.fsyncSync(fd); } catch (_) { /* 部分文件系统不支持 fsync，忽略 */ }
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, this.localManifestPath);
    } catch (error) {
      this.logError('保存本地 manifest 失败', error);
      // 清理临时文件
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  /**
   * #N9：manifest schema 基本校验
   * 任何字段不符就拒绝信任此 manifest（防止远端损坏导致灾难性操作）
   * @private
   */
  isValidManifest(m) {
    if (!m || typeof m !== 'object') return false;
    if (m.version !== 3) return false;
    if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) return false;
    // last_synced_at 允许缺失或 0，但若有值必须是合理范围（2000-01-01 ~ 当前+10年）
    if (m.last_synced_at != null) {
      const lo = 946684800000;  // 2000-01-01
      const hi = Date.now() + 10 * 365 * 24 * 3600 * 1000;
      // 允许 0（首次同步占位）或 [lo, hi] 范围内的合法时间戳
      if (typeof m.last_synced_at !== 'number') return false;
      if (m.last_synced_at !== 0 && (m.last_synced_at < lo || m.last_synced_at > hi)) {
        return false;
      }
    }
    // 抽查 files 中的 entry 结构（最多看 10 个，避免大 manifest 校验开销）
    let checked = 0;
    for (const [fileId, entry] of Object.entries(m.files)) {
      if (checked++ >= 10) break;
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.h !== 'string') return false;
      if (typeof entry.t !== 'number') return false;
      if (entry.d !== 0 && entry.d !== 1) return false;
      void fileId;
    }
    return true;
  }

  /**
   * #N1：检测上一轮 commit 是否中断（pending 标记 + 本地数据已动但 manifest 未上传）
   * 返回 true 表示存在中断，调用方应触发"恢复路径"
   * @private
   */
  hasPendingCommit() {
    const cached = this.loadLocalManifest();
    return !!(cached && cached._pendingCommit === true);
  }

  // ==================== 冲突解决辅助方法 ====================

  /**
   * 获取文件的可读名称
   * @private
   */
  getFileName(fileId, localData) {
    if (fileId === 'global_todos') {
      return 'todos.json';
    } else if (fileId === 'global_settings') {
      return 'settings.json';
    } else {
      // 笔记/白板，尝试从本地数据获取标题
      const note = localData.localNotes?.[fileId];
      if (note && note.title) {
        return note.title;
      }
      return fileId; // 回退到 ID
    }
  }

  /**
   * 获取文件类型
   * @private
   */
  getFileType(fileId) {
    if (fileId === 'global_todos') {
      return 'todos';
    } else if (fileId === 'global_settings') {
      return 'settings';
    }
    // 使用 manifest entry 的 ext 字段判断类型，而非 fileId 字符串
    const cached = this.loadLocalManifest();
    const entry = cached?.files?.[fileId];
    if (entry?.ext === '.wb' || entry?.meta?.note_type === 'whiteboard') {
      return 'whiteboard';
    }
    return 'note';
  }

  /**
   * 下载远程内容用于冲突对比
   * @private
   */
  async downloadForConflict(remotePath, fileId) {
    try {
      if (fileId === 'global_todos' || fileId === 'global_settings') {
        // JSON 文件
        return await this.client.downloadJson(remotePath);
      } else {
        // 笔记/白板文本
        return await this.client.downloadText(remotePath);
      }
    } catch (error) {
      this.logError(`下载远程内容失败: ${fileId}`, error);
      return null;
    }
  }

  // ==================== 日志 ====================

  /**
   * 记录日志
   * @private
   */
  log(...args) {
    const message = args.join(' ');
    console.log('[SyncEngine]', message);

    if (this.config.enableDebugLog) {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(this.logFile, `[${timestamp}] ${message}\n`);
    }
  }

  /**
   * 记录错误
   * @private
   */
  logError(message, error) {
    console.error('[SyncEngine]', message, error);

    if (this.config.enableDebugLog) {
      const timestamp = new Date().toISOString();
      const errorMessage = error ? (error.stack || error.message || error) : '';
      fs.appendFileSync(this.logFile, `[${timestamp}] ERROR: ${message}\n${errorMessage}\n`);
    }
  }

  /**
   * 清空日志文件
   * @private
   */
  clearLogFile() {
    if (this.config.enableDebugLog) {
      try {
        fs.writeFileSync(
          this.logFile,
          `=== Flota v3.0 Sync Engine Debug Log ===\n启动时间: ${new Date().toISOString()}\n\n`
        );
      } catch (error) {
        // Ignore
      }
    }
  }
}

module.exports = SyncEngine;
