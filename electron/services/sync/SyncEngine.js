/**
 * FlashNote v3.0 原子化同步系统 - 同步引擎
 *
 * 核心同步逻辑，实现 manifest-driven 的原子化增量同步
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

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
  if (platform === 'win32') return path.join(process.env.APPDATA || homeDir, 'flashnote');
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'flashnote');
  return path.join(homeDir, '.config', 'flashnote');
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
      rootPath: config.rootPath || '/FlashNote/',
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
   * 执行完整同步
   * @param {boolean} [forceFullSync=false] - 是否强制全量同步
   * @returns {Promise<import('./types').SyncResult>} 同步结果
   */
  async performSync(forceFullSync = false) {
    if (this.isSyncing) {
      throw new Error('同步已在进行中');
    }

    this.isSyncing = true;
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
      await this.commit(localManifest, remoteManifest, tasks);
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
    }
  }

  /**
   * 强制全量同步 - 清空云端并重新上传
   * @returns {Promise<import('./types').SyncResult>} 同步结果
   */
  async forceFullSync() {
    this.log('========== 强制全量同步：清空云端 ==========');

    try {
      // 删除云端 manifest
      await this.client.delete(this.config.rootPath + 'manifest.json');
      this.log('已删除云端 manifest');

      // 删除本地缓存 manifest
      if (fs.existsSync(this.localManifestPath)) {
        fs.unlinkSync(this.localManifestPath);
        this.log('已删除本地缓存 manifest');
      }

      // 执行同步（将触发初始化）
      return await this.performSync(true);
    } catch (error) {
      this.logError('强制全量同步失败', error);
      throw error;
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
      await this.client.createDirectory(this.config.rootPath + 'audio/');
      this.log('[Init] 子目录结构创建完成');
    } catch (error) {
      this.log('[Init] 子目录创建失败:', error.message);
      throw error;
    }

    // 2. 上传初始空文件（todos 和 settings）
    await this.client.uploadJson(this.config.rootPath + 'todos.json', []);
    await this.client.uploadJson(this.config.rootPath + 'settings.json', {});
    uploadCount += 2;
    this.log('[Init] 初始空文件上传完成');

    // 3. 获取本地数据（根据启用的类别过滤）
    const enabledCategories = this.config.syncCategories || [];
    const localNotes = enabledCategories.includes('notes') ? await this.storage.getAllNotes(false) : {}; // 不包含已删除
    const localTodos = enabledCategories.includes('todos') ? await this.storage.getAllTodos(false) : {};
    const localSettings = enabledCategories.includes('settings') ? await this.storage.getAllSettings() : {};

    this.log(`[Init] 本地数据 (已启用类别: ${enabledCategories.join(', ')}): ${Object.keys(localNotes).length} 笔记, ${Object.keys(localTodos).length} 待办`);

    // 4. 上传本地笔记和白板（如果启用）
    const noteUploads = enabledCategories.includes('notes') ? Object.values(localNotes).map(note => this.uploadNote(note)) : [];
    await Promise.all(noteUploads);
    uploadCount += noteUploads.length;
    if (noteUploads.length > 0) {
      this.log(`[Init] ${noteUploads.length} 个笔记/白板上传完成`);
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
      await this.client.uploadJson(this.config.rootPath + 'settings.json', localSettings);
      this.log('[Init] settings 上传完成');
    }

    // 7. 生成初始 manifest
    const manifest = await this.generateManifest(localNotes, localTodos, localSettings);
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
    for (const [syncId, note] of Object.entries(notes)) {
      this.log(`[Manifest] 笔记 ${syncId}: is_deleted=${note.is_deleted}, note_type=${note.note_type}, updated_at=${note.updated_at}`);
      manifest.files[syncId] = {
        v: 1,
        t: note.updated_at,
        c: note.created_at, // 添加创建时间
        h: this.storage.calculateNoteHash(note),
        d: note.is_deleted ? 1 : 0,
        ext: note.note_type === 'whiteboard' ? '.wb' : '.md',
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
    // Settings 的时间戳策略：使用缓存的时间戳（从 cachedManifest），除非 hash 变化
    const settingsHash = this.storage.calculateSettingsHash(settings);
    let settingsUpdatedAt = Date.now();

    // 如果有缓存的 manifest，且 hash 未变，保持原时间戳
    const cachedManifest = this.loadLocalManifest();
    if (cachedManifest && cachedManifest.files && cachedManifest.files['global_settings']) {
      const cachedSettings = cachedManifest.files['global_settings'];
      if (cachedSettings.h === settingsHash) {
        // Hash 未变，保持原时间戳
        settingsUpdatedAt = cachedSettings.t;
        this.log(`[Manifest] global_settings: hash 未变，保持缓存时间戳 ${settingsUpdatedAt}`);
      } else {
        this.log(`[Manifest] global_settings: hash 变化，使用新时间戳 ${settingsUpdatedAt}`);
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

    // 1. 下载远程 manifest
    const remoteManifest = await this.client.downloadJson(this.config.rootPath + 'manifest.json');
    this.log(`[Scan] 远程 manifest: ${Object.keys(remoteManifest.files).length} 文件`);

    // 2. 加载本地缓存 manifest
    const cachedManifest = this.loadLocalManifest();

    // 3. 扫描本地实时数据（根据启用的类别过滤）
    const enabledCategories = this.config.syncCategories || [];
    const localNotes = enabledCategories.includes('notes') ? await this.storage.getAllNotes(true) : {};
    const localTodos = enabledCategories.includes('todos') ? await this.storage.getAllTodos(true) : {};
    const localSettings = enabledCategories.includes('settings') ? await this.storage.getAllSettings() : {};

    // 4. 生成本地实时 manifest
    const localManifest = await this.generateManifest(localNotes, localTodos, localSettings);
    this.log(`[Scan] 本地 manifest: ${Object.keys(localManifest.files).length} 文件`);

    // 5. 三向合并：remoteManifest vs cachedManifest vs localManifest
    const tasks = await this.computeSyncTasks(remoteManifest, cachedManifest, localManifest, {
      localNotes,
      localTodos,
      localSettings,
    });

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

    // 处理删除状态同步
    if (remoteDeleted && !localDeleted) {
      // 远程已删除，本地未删除 -> 需要删除本地
      this.log(`[Delete Sync] 远程已删除，同步删除本地: ${fileId}`);
      return {
        operation: 'delete-local',
        fileId,
        remotePath,
        remoteEntry,
      };
    }

    if (localDeleted && !remoteDeleted) {
      // 本地已删除，远程未删除 -> 需要上传删除状态（通过更新 manifest）
      this.log(`[Delete Sync] 本地已删除，同步删除到远程: ${fileId}`);
      return {
        operation: 'upload-delete',
        fileId,
        remotePath,
        localEntry,
      };
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
      // Hash 相同，跳过
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

    if (!isGlobalData && localChanged && remoteChanged && this.syncIPCHandler && this.config.conflictStrategy === 'ask') {
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
    if (remoteEntry.t > localEntry.t) {
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
      return localData.localSettings;
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
      return this.config.rootPath + 'notes/' + fileId + ext;
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
    };

    for (const task of tasks) {
      try {
        if (task.operation === 'upload') {
          await this.executeUpload(task);
          result.uploaded++;
        } else if (task.operation === 'download') {
          await this.executeDownload(task);
          result.downloaded++;
        } else if (task.operation === 'delete') {
          await this.executeDelete(task);
          result.deleted++;
        } else if (task.operation === 'delete-local') {
          // 远程删除同步到本地
          await this.executeDeleteLocal(task);
          result.deleted++;
        } else if (task.operation === 'upload-delete') {
          // 本地删除同步到远程（删除云端文件）
          await this.executeUploadDelete(task);
          result.deleted++;
        } else if (task.operation === 'merge-todos') {
          // todos 双端冲突：逐条 updated_at 仲裁后上传合并结果
          await this.executeMergeTodos(task);
          result.downloaded++;
          result.uploaded++;
        } else {
          result.skipped++;
        }
      } catch (error) {
        this.logError(`任务执行失败: ${task.fileId}`, error);
        result.errors++;
        result.errorDetails.push({ fileId: task.fileId, error: error.message });
      }
    }

    result.success = result.errors === 0;
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
      const localTodos = await this.storage.getAllTodos(false); // active only
      for (const [syncId, todo] of Object.entries(localTodos)) {
        if (!cloudIds.has(syncId)) {
          this.log(`[Download] 云端不存在，软删除本地 todo: ${syncId}`);
          await this.storage.softDeleteTodo(syncId, true);
        }
      }
    } else if (task.fileId === 'global_settings') {
      // 下载 settings
      const remoteSettings = await this.client.downloadJson(task.remotePath);
      await this.storage.updateSettings(remoteSettings);
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
            // 两个扩展名都失败，抛出原始错误
            throw error;
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
        title: meta.title || this.extractTitle(content),
        tags: meta.tags || '',
        category: meta.category || '',
        is_pinned: meta.is_pinned || 0,
        is_favorite: meta.is_favorite || 0,
        created_at: task.remoteEntry.c || task.remoteEntry.t, // 使用 c (created_at) 或回退到 t (updated_at)
        updated_at: task.remoteEntry.t,
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

        // 检查本地文件是否已在上次同步后修改过（通过 mtime）
        // 如果 localMtime 早于上次同步时间，说明没有更新，跳过
        if (this.lastSyncTime) {
          const stat = fs.statSync(localPath);
          if (stat.mtimeMs < this.lastSyncTime) return;
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
        const imageData = fs.readFileSync(localPath);
        await this.client.uploadBinary(remotePath, imageData);
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

    for (const relativePath of imageRefs) {
      // 检查本地是否已存在
      const localPath = path.join(getUserDataPath(), relativePath);
      if (fs.existsSync(localPath)) {
        this.log(`[Download Images] 图片已存在，跳过: ${relativePath}`);
        continue;
      }

      // 重试逻辑（最多3次）
      let success = false;
      for (let attempt = 1; attempt <= 3 && !success; attempt++) {
        try {
          const remotePath = this.config.rootPath + relativePath;
          this.log(`[Download Images] 下载图片 (尝试 ${attempt}/3): ${relativePath}`);

          const imageData = await this.client.downloadBinary(remotePath);
          if (imageData) {
            // 确保目录存在
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
      // Markdown 笔记 - 使用正则匹配图片和音频
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

    // Step 1: 下载远端 todos，逐条 upsertTodo（内部按 updated_at 仲裁）
    await this.executeDownload({ ...task, operation: 'download' });

    // Step 2: 读取合并后的所有本地 todos（含已删除，确保墓碑同步）
    const allTodos = await this.storage.getAllTodos(true);
    const mergedArray = Object.values(allTodos).map(todo => {
      const { db_id, ...syncData } = todo;
      return syncData;
    });

    // Step 3: 上传合并结果到远端，确保远端与本地完全一致
    await this.client.uploadJson(task.remotePath, mergedArray);
    this.log(`[MergeTodos] 合并完成，已上传 ${mergedArray.length} 条 todos`);
  }

  /**
   * 应用远程 todos 到本地
   * @private
   */
  async applyTodos(remoteTodos) {
    for (const todo of remoteTodos) {
      await this.storage.upsertTodo(todo, true);
    }
  }

  /**
   * 从内容中提取标题
   * @private
   */
  extractTitle(content) {
    if (!content) return '无标题';
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        return trimmed.substring(0, 50);
      } else if (trimmed.startsWith('#')) {
        return trimmed.replace(/^#+\s*/, '').substring(0, 50);
      }
    }
    return '无标题';
  }

  // ==================== 阶段 4: 提交 (Commit) ====================

  /**
   * 提交同步结果
   * @private
   */
  async commit(localManifest, remoteManifest, tasks) {
    this.log('[Commit] 生成新 manifest...');

    // 基于远程 manifest（服务器状态）构建新 manifest
    // 初始状态为同步前的服务器状态
    const newFiles = { ...remoteManifest.files };

    // 根据执行的任务更新文件状态
    if (tasks && tasks.length > 0) {
      for (const task of tasks) {
        // 对于上传操作，服务器状态已更新为本地状态
        if (task.operation === 'upload' || task.operation === 'upload-delete') {
          if (localManifest.files[task.fileId]) {
            newFiles[task.fileId] = localManifest.files[task.fileId];
          }
        }

        // merge-todos：远端已被更新为合并后的本地状态，重新计算 manifest 条目
        if (task.operation === 'merge-todos') {
          try {
            const allTodos = await this.storage.getAllTodos(true);
            const todosArray = Object.values(allTodos);
            let t = 0;
            for (const todo of todosArray) {
              const ts = this.storage.parseTimestamp(todo.updated_at);
              if (ts > t) t = ts;
            }
            if (t === 0) t = 1000000000000;
            newFiles[task.fileId] = {
              v: 1,
              t,
              h: this.storage.calculateTodosHash(todosArray),
              d: 0,
              ext: '.json',
            };
          } catch (e) {
            this.logError('[Commit] 重新计算 global_todos hash 失败', e);
            // 回退：使用 remoteManifest 的条目（已含下载内容）
          }
        }

        // 对于下载操作，本地状态已更新为服务器状态
        // newFiles 中已包含 remoteManifest 的条目，无需更改

        // 对于删除操作 (delete)，通常是清理操作，如果需要从 manifest 移除
        if (task.operation === 'delete') {
          delete newFiles[task.fileId];
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

    // 上传新 manifest
    await this.client.uploadJson(this.config.rootPath + 'manifest.json', newManifest);

    // 保存到本地缓存
    this.saveLocalManifest(newManifest);

    this.log('[Commit] 新 manifest 已提交');
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
        return JSON.parse(content);
      } catch (error) {
        this.logError('加载本地 manifest 失败', error);
        return null;
      }
    }
    return null;
  }

  /**
   * 保存 manifest 到本地缓存
   * @private
   */
  saveLocalManifest(manifest) {
    try {
      fs.writeFileSync(this.localManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (error) {
      this.logError('保存本地 manifest 失败', error);
    }
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
          `=== FlashNote v3.0 Sync Engine Debug Log ===\n启动时间: ${new Date().toISOString()}\n\n`
        );
      } catch (error) {
        // Ignore
      }
    }
  }
}

module.exports = SyncEngine;
