const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 尝试加载 Electron，如果失败则使用 null（独立运行模式）
let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {
  // 独立运行模式（如 MCP Server），不依赖 Electron
}

// ========== 数据库日志工具 ==========
const getUserDataPath = () => {
  if (app) {
    return app.getPath('userData');
  }
  // 独立运行模式：使用标准路径
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || homeDir, 'Flota');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  } else {
    return path.join(homeDir, '.config', 'Flota');
  }
};

const dbLogFile = path.join(getUserDataPath(), 'startup-debug.log');
function dbLog(...args) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [DB] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`;
  console.log('[DB]', ...args);
  try { fs.appendFileSync(dbLogFile, message); } catch (e) { /* ignore */ }
}

class DatabaseManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.repairInProgress = null;
  }

  /**
   * 初始化数据库连接
   * @param {string} customDbPath - 自定义数据库路径（可选，用于独立运行）
   */
  async initialize(customDbPath = null) {
    try {
      // 获取用户数据目录
      const userDataPath = app ? app.getPath('userData') : getUserDataPath();
      const dbDir = path.join(userDataPath, 'database');
      
      dbLog('用户数据目录:', userDataPath);
      
      // 确保数据库目录存在
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        dbLog('创建数据库目录:', dbDir);
      }
      
      this.dbPath = customDbPath || path.join(dbDir, 'flota.db');
      const dbExists = fs.existsSync(this.dbPath);
      dbLog('数据库路径:', this.dbPath, '是否存在:', dbExists);

      // ========== 旧版数据迁移（FlashNote → Flota）==========
      // 如果新数据库不存在，尝试从旧的 FlashNote 路径迁移数据
      if (!dbExists && !customDbPath) {
        const oldDbCandidates = [
          // Windows
          path.join(process.env.APPDATA || '', 'FlashNote', 'database', 'flashnote.db'),
          // macOS
          path.join(process.env.HOME || '', 'Library', 'Application Support', 'FlashNote', 'database', 'flashnote.db'),
          // Linux
          path.join(process.env.HOME || '', '.config', 'FlashNote', 'database', 'flashnote.db'),
        ];
        for (const oldDbPath of oldDbCandidates) {
          if (fs.existsSync(oldDbPath)) {
            dbLog('发现旧版数据库，开始迁移:', oldDbPath, '->', this.dbPath);
            try {
              fs.copyFileSync(oldDbPath, this.dbPath);
              // 同步迁移 WAL 和 SHM 文件（如果存在）
              for (const ext of ['-wal', '-shm']) {
                const oldExtra = oldDbPath + ext;
                if (fs.existsSync(oldExtra)) {
                  fs.copyFileSync(oldExtra, this.dbPath + ext);
                }
              }
              dbLog('旧版数据库迁移成功');
            } catch (migrateErr) {
              dbLog('旧版数据库迁移失败:', migrateErr.message);
            }
            break;
          }
        }
      }
      // ========== 迁移结束 ==========

      // 创建数据库连接
      this.db = new Database(this.dbPath);
      dbLog('数据库连接已创建');

      // ========== 关键SQLite配置 ==========

      // 1. 设置busy_timeout（5秒）- 防止并发写入时立即失败导致corruption
      this.db.pragma('busy_timeout = 5000');
      dbLog('设置 busy_timeout = 5000ms');

      // 2. 启用外键约束
      this.db.pragma('foreign_keys = ON');
      dbLog('启用外键约束');

      // 3. 设置WAL模式以提高并发性能
      this.db.pragma('journal_mode = WAL');
      dbLog('设置 journal_mode = WAL');

      // 4. 设置synchronous模式（NORMAL对WAL模式足够安全）
      this.db.pragma('synchronous = NORMAL');
      dbLog('设置 synchronous = NORMAL');

      // 5. 配置WAL自动checkpoint（每1000页触发）
      this.db.pragma('wal_autocheckpoint = 1000');
      dbLog('设置 wal_autocheckpoint = 1000');

      // 6. 设置缓存大小（提高性能）
      this.db.pragma('cache_size = -8000'); // 8MB
      dbLog('设置 cache_size = -8000 (8MB)');

      // 启动时做一次快速完整性检查，尽早发现损坏并给出修复指引
      const quickCheck = this.checkIntegrity('quick_check');
      if (!quickCheck.ok) {
        dbLog('数据库快速完整性检查未通过:', quickCheck.details || quickCheck.error);
      }
      
      // 创建表结构
      dbLog('开始创建表结构...');
      await this.createTables();
      dbLog('表结构创建完成');
    
      // 执行数据库迁移
      if (dbExists && !customDbPath) {
        await this.backupBeforeMigration(dbDir);
      }
      dbLog('开始执行数据库迁移...');
      await this.runMigrations();
      dbLog('数据库迁移完成');
    
      dbLog('数据库初始化成功');
      return true;
    } catch (error) {
      dbLog('数据库初始化失败:', error.message, error.stack);
      throw error;
    }
  }

  async backupBeforeMigration(dbDir) {
    try {
      const backupDir = path.join(dbDir, 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const day = new Date().toISOString().slice(0, 10);
      const backupPath = path.join(backupDir, `pre-migration-${day}.db`);
      if (fs.existsSync(backupPath)) {
        dbLog('今日迁移前备份已存在，跳过:', backupPath);
        return;
      }

      await this.db.backup(backupPath);
      dbLog('迁移前备份完成:', backupPath);
    } catch (error) {
      dbLog('迁移前备份失败，继续启动:', error.message);
    }
  }

  /**
   * 判断错误是否属于数据库损坏类错误
   * @param {Error|string} error
   * @returns {boolean}
   */
  isCorruptionError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('database disk image is malformed') ||
      message.includes('sqlite_corrupt') ||
      message.includes('sqlite_notadb') ||
      message.includes('malformed');
  }

  /**
   * 返回统一的用户可读错误文案
   */
  getCorruptionGuidanceMessage() {
    return '数据库文件可能已损坏，已尝试自动修复但未成功。请先备份数据目录，再执行“npm run repair-db”或在设置中运行数据库修复。';
  }

  /**
   * 完整性检查
   * @param {'quick_check'|'integrity_check'} mode
   */
  checkIntegrity(mode = 'quick_check') {
    if (!this.db) {
      return { ok: false, error: '数据库未初始化' };
    }

    try {
      const rows = this.db.prepare(`PRAGMA ${mode}`).all();
      const key = mode;
      const details = rows.map((row) => row[key]).filter(Boolean);
      const ok = details.length === 1 && details[0] === 'ok';
      return { ok, details };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * 命中损坏错误时执行一次串行修复，避免并发重复修复
   * @param {Error|string} error
   * @param {string} context
   */
  async tryRepairOnCorruption(error, context = 'unknown') {
    if (!this.isCorruptionError(error)) {
      return { success: false, skipped: true, reason: 'not-corruption-error' };
    }

    if (this.repairInProgress) {
      return await this.repairInProgress;
    }

    this.repairInProgress = (async () => {
      try {
        dbLog(`检测到数据库损坏错误，开始自动修复。context=${context}`, String(error?.message || error));
        const repairResult = await this.repairDatabase();
        const postCheck = this.checkIntegrity('quick_check');
        if (!repairResult.success || !postCheck.ok) {
          return {
            success: false,
            error: this.getCorruptionGuidanceMessage(),
            repairResult,
            postCheck
          };
        }

        return {
          success: true,
          repairResult,
          postCheck
        };
      } finally {
        this.repairInProgress = null;
      }
    })();

    return await this.repairInProgress;
  }

  /**
   * 创建数据库表结构
   */
  async createTables() {
    const tables = [
      // 笔记表 - 包含 sync_id 用于跨设备同步
      `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_id TEXT UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        tags TEXT DEFAULT '',
        category TEXT DEFAULT 'default',
        is_pinned INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        note_type TEXT DEFAULT 'markdown',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL
      )`,
      
      // 设置表
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT DEFAULT 'string',
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // 分类表
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#1976d2',
        icon TEXT DEFAULT 'folder',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // 标签表
      `CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#666666',
        usage_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // 待办事项表 - 包含 sync_id 用于跨设备同步
      `CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_id TEXT UNIQUE,
        content TEXT NOT NULL,
        description TEXT DEFAULT '',
        tags TEXT DEFAULT '',
        is_completed INTEGER DEFAULT 0,
        is_important INTEGER DEFAULT 0,
        is_urgent INTEGER DEFAULT 0,
        due_date DATETIME NULL,
        end_date DATETIME NULL,
        item_type TEXT DEFAULT 'todo',
        has_time INTEGER DEFAULT 0,
        focus_time_seconds INTEGER DEFAULT 0,
        repeat_type TEXT DEFAULT 'none',
        repeat_days TEXT DEFAULT '',
        repeat_interval INTEGER DEFAULT 1,
        next_due_date DATETIME NULL,
        is_recurring INTEGER DEFAULT 0,
        parent_todo_id INTEGER NULL,
        completions TEXT DEFAULT '[]',
        is_deleted INTEGER DEFAULT 0,
        deleted_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL
      )`,
      
      // 变更日志表 - 用于增量同步
      // 注意：entity_id 存储 sync_id (UUID)，用于跨设备同步
      `CREATE TABLE IF NOT EXISTS changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        change_data TEXT,
        device_id TEXT,
        created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
        synced INTEGER DEFAULT 0,
        synced_at DATETIME NULL
      )`,
      
      // 插件存储表 - 用于插件数据持久化
      `CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (plugin_id, key)
      )`
    ];

    // 创建索引（移除 sync_id 相关索引，将在迁移阶段创建）
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category)',
      'CREATE INDEX IF NOT EXISTS idx_notes_is_pinned ON notes(is_pinned)',
      'CREATE INDEX IF NOT EXISTS idx_notes_is_deleted ON notes(is_deleted)',
      'CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title)',
      // sync_id 索引移到 _migrateSyncId() 中创建
      'CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)',
      'CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date)',
      'CREATE INDEX IF NOT EXISTS idx_todos_is_completed ON todos(is_completed)',
      'CREATE INDEX IF NOT EXISTS idx_todos_is_important ON todos(is_important)',
      'CREATE INDEX IF NOT EXISTS idx_todos_is_urgent ON todos(is_urgent)',
      // sync_id 索引移到 _migrateSyncId() 中创建
      'CREATE INDEX IF NOT EXISTS idx_changes_entity ON changes(entity_type, entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_changes_synced ON changes(synced)',
      'CREATE INDEX IF NOT EXISTS idx_changes_created_at ON changes(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_plugin_storage_plugin ON plugin_storage(plugin_id)'
    ];

    // 执行建表语句
    for (const sql of tables) {
      this.db.exec(sql);
    }

    // 执行索引创建语句
    for (const sql of indexes) {
      this.db.exec(sql);
    }

    // 插入默认设置
    await this.insertDefaultSettings();
    
    // 插入默认分类
    await this.insertDefaultCategories();
  }

  /**
   * 插入默认设置
   */
  async insertDefaultSettings() {
    const defaultSettings = [
      { key: 'theme', value: 'system', type: 'string', description: '主题模式' },
      { key: 'customThemeColor', value: '#1976d2', type: 'string', description: '主色调' },
      { key: 'titleBarStyle', value: 'windows', type: 'string', description: '标题栏样式' },
      { key: 'language', value: 'zh-CN', type: 'string', description: '界面语言' },
      { key: 'maskOpacity', value: 'medium', type: 'string', description: '遮罩强度' },
      { key: 'backgroundPattern', value: 'none', type: 'string', description: '背景花纹' },
      { key: 'patternOpacity', value: '1', type: 'number', description: '花纹强度' },
      { key: 'auto_save', value: 'true', type: 'boolean', description: '自动保存' },
      { key: 'auto_save_interval', value: '3000', type: 'number', description: '自动保存间隔(ms)' },
      { key: 'window_width', value: '1200', type: 'number', description: '窗口宽度' },
      { key: 'window_height', value: '800', type: 'number', description: '窗口高度' },
      { key: 'window_x', value: 'center', type: 'string', description: '窗口X位置' },
      { key: 'window_y', value: 'center', type: 'string', description: '窗口Y位置' },
      { key: 'userAvatar', value: '', type: 'string', description: '用户头像' },
      { key: 'mcpEnabled', value: 'false', type: 'boolean', description: 'MCP服务开关' }
    ];

    const insertSetting = this.db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, type, description) 
      VALUES (?, ?, ?, ?)
    `);

    for (const setting of defaultSettings) {
      insertSetting.run(setting.key, setting.value, setting.type, setting.description);
    }
  }

  /**
   * 插入默认分类
   */
  async insertDefaultCategories() {
    const defaultCategories = [
      { name: 'default', color: '#1976d2', icon: 'folder', sort_order: 0 },
      { name: '工作', color: '#f44336', icon: 'work', sort_order: 1 },
      { name: '学习', color: '#4caf50', icon: 'school', sort_order: 2 },
      { name: '生活', color: '#ff9800', icon: 'home', sort_order: 3 },
      { name: '想法', color: '#9c27b0', icon: 'lightbulb', sort_order: 4 }
    ];

    const insertCategory = this.db.prepare(`
      INSERT OR IGNORE INTO categories (name, color, icon, sort_order) 
      VALUES (?, ?, ?, ?)
    `);

    for (const category of defaultCategories) {
      insertCategory.run(category.name, category.color, category.icon, category.sort_order);
    }
  }

  /**
   * 判断错误是否来自 notes_fts 旧结构，常见于修复脚本把 FTS 表重建成仅 content 列后。
   */
  isNotesFtsSchemaError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('notes_fts') &&
      (message.includes('title') || message.includes('column'));
  }

  getNotesFtsState() {
    const ftsTable = this.db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name='notes_fts'"
    ).get();

    if (!ftsTable) {
      return {
        exists: false,
        columns: [],
        triggers: [],
        isValid: false
      };
    }

    let columns = [];
    let triggers = [];
    let tableSql = '';

    try {
      tableSql = String(ftsTable.sql || '').toLowerCase();
      columns = this.db.prepare('PRAGMA table_info(notes_fts)').all().map(col => col.name);
      triggers = this.db.prepare(`
        SELECT name, sql
        FROM sqlite_master
        WHERE type='trigger' AND name IN ('notes_fts_insert', 'notes_fts_update', 'notes_fts_delete')
      `).all();
    } catch (error) {
      return {
        exists: true,
        columns,
        triggers,
        error: error.message,
        isValid: false
      };
    }

    const triggerSql = triggers.map(trigger => trigger.sql || '').join('\n').toLowerCase();
    const hasRequiredColumns = columns.includes('title') && columns.includes('content');
    const hasRequiredTriggers = triggers.length === 3 &&
      triggerSql.includes('insert into notes_fts(rowid, title, content)') &&
      !triggerSql.includes('update notes_fts set');
    const usesExternalContent = tableSql.includes("content='notes'") || tableSql.includes('content="notes"');

    return {
      exists: true,
      columns,
      triggers,
      tableSql,
      usesExternalContent,
      isValid: hasRequiredColumns && hasRequiredTriggers && !usesExternalContent
    };
  }

  rebuildNotesFts(reason = 'schema-check') {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }

    dbLog('重建 notes_fts 全文搜索索引:', reason);

    const rebuild = this.db.transaction(() => {
      this.db.exec('DROP TRIGGER IF EXISTS notes_fts_insert');
      this.db.exec('DROP TRIGGER IF EXISTS notes_fts_update');
      this.db.exec('DROP TRIGGER IF EXISTS notes_fts_delete');
      this.db.exec('DROP TABLE IF EXISTS notes_fts');

      this.db.exec(`
        CREATE VIRTUAL TABLE notes_fts USING fts5(
          title,
          content,
          tokenize='unicode61 remove_diacritics 1'
        )
      `);

      const existingNotes = this.db.prepare('SELECT id, title, content FROM notes').all();
      const insertStmt = this.db.prepare(
        'INSERT INTO notes_fts(rowid, title, content) VALUES (?, ?, ?)'
      );

      for (const note of existingNotes) {
        insertStmt.run(note.id, note.title || '', note.content || '');
      }

      this.db.exec(`
        CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content)
          VALUES (new.id, new.title, new.content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
          DELETE FROM notes_fts WHERE rowid = old.id;
          INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
          DELETE FROM notes_fts WHERE rowid = old.id;
        END
      `);

      return existingNotes.length;
    });

    const syncedNotes = rebuild();
    this.db.prepare('SELECT COUNT(*) AS c FROM notes_fts').get();
    dbLog(`notes_fts 重建完成，已同步 ${syncedNotes} 条笔记`);
    return { success: true, syncedNotes };
  }

  ensureNotesFtsSchema(reason = 'migration') {
    const state = this.getNotesFtsState();

    if (state.isValid) {
      dbLog('notes_fts 结构正常，跳过重建');
      return { rebuilt: false, state };
    }

    const rebuildReason = state.exists
      ? `${reason}: invalid columns=${state.columns.join(',') || '(empty)'}, triggers=${state.triggers.length}`
      : `${reason}: missing notes_fts`;

    const result = this.rebuildNotesFts(rebuildReason);
    return { rebuilt: true, state, result };
  }

  /**
   * 执行数据库迁移
   */
  async runMigrations() {
    try {
      // 迁移1：检查todos表是否有tags字段，如果没有则添加
      const tableInfo = this.db.prepare("PRAGMA table_info(todos)").all();
      const hasTagsColumn = tableInfo.some(column => column.name === 'tags');
      
      if (!hasTagsColumn) {
        console.log('添加tags字段到todos表...');
        this.db.exec("ALTER TABLE todos ADD COLUMN tags TEXT DEFAULT ''");
        console.log('todos表迁移完成');
      }
      
      // 迁移2：修复 changes 表的 entity_id 类型
      await this.migrateChangesTableType();

      // 迁移3：添加 device_id 到 changes 表
      const changesTableInfo = this.db.prepare("PRAGMA table_info(changes)").all();
      const hasDeviceIdColumn = changesTableInfo.some(column => column.name === 'device_id');
      
      if (!hasDeviceIdColumn) {
        console.log('添加device_id字段到changes表...');
        this.db.exec("ALTER TABLE changes ADD COLUMN device_id TEXT");
        console.log('changes表 device_id 字段添加完成');
      }
      
      // 检查并添加重复事项相关字段
      const currentTableInfo = this.db.prepare("PRAGMA table_info(todos)").all();
      const columnNames = currentTableInfo.map(col => col.name);
      
      const repeatColumns = [
        { name: 'repeat_type', sql: "ALTER TABLE todos ADD COLUMN repeat_type TEXT DEFAULT 'none'" },
        { name: 'repeat_days', sql: "ALTER TABLE todos ADD COLUMN repeat_days TEXT DEFAULT ''" },
        { name: 'repeat_interval', sql: "ALTER TABLE todos ADD COLUMN repeat_interval INTEGER DEFAULT 1" },
        { name: 'next_due_date', sql: "ALTER TABLE todos ADD COLUMN next_due_date DATETIME NULL" },
        { name: 'is_recurring', sql: "ALTER TABLE todos ADD COLUMN is_recurring INTEGER DEFAULT 0" },
        { name: 'parent_todo_id', sql: "ALTER TABLE todos ADD COLUMN parent_todo_id INTEGER NULL" }
      ];
      
      for (const column of repeatColumns) {
        if (!columnNames.includes(column.name)) {
          console.log(`添加${column.name}字段到todos表...`);
          this.db.exec(column.sql);
        }
      }

      // ===== Schedule model: completions 字段 =====
      if (!columnNames.includes('completions')) {
        console.log('添加completions字段到todos表 (schedule model)...');
        this.db.exec("ALTER TABLE todos ADD COLUMN completions TEXT DEFAULT '[]'");
      }

      if (!columnNames.includes('focus_time_seconds')) {
        console.log('添加focus_time_seconds字段到todos表...');
        this.db.exec("ALTER TABLE todos ADD COLUMN focus_time_seconds INTEGER DEFAULT 0");
      }

      if (!columnNames.includes('description')) {
        console.log('添加description字段到todos表...');
        this.db.exec("ALTER TABLE todos ADD COLUMN description TEXT DEFAULT ''");
      }

      // ===== 待办事项软删除支持 (2025-11-18) =====
      if (!columnNames.includes('is_deleted')) {
        console.log('添加is_deleted字段到todos表 (软删除支持)...');
        this.db.exec("ALTER TABLE todos ADD COLUMN is_deleted INTEGER DEFAULT 0");
      }

      if (!columnNames.includes('deleted_at')) {
        console.log('添加deleted_at字段到todos表 (软删除时间戳)...');
        this.db.exec("ALTER TABLE todos ADD COLUMN deleted_at DATETIME NULL");
      }
      
      // 添加索引
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_todos_is_deleted ON todos(is_deleted)');
      console.log('待办事项软删除字段迁移完成');

      // ===== 日程/待办区分和时间类型支持 (2025-11-11) =====
      if (!columnNames.includes('item_type')) {
        console.log('添加item_type字段到todos表 (区分日程/待办)...');
        this.db.exec("ALTER TABLE todos ADD COLUMN item_type TEXT DEFAULT 'todo'"); // 'todo' 或 'event'
      }

      if (!columnNames.includes('has_time')) {
        console.log('添加has_time字段到todos表 (区分全天/带时间)...');
        this.db.exec("ALTER TABLE todos ADD COLUMN has_time INTEGER DEFAULT 0"); // 0=全天, 1=带时间
      }

      if (!columnNames.includes('end_date')) {
        console.log('添加end_date字段到todos表 (支持结束时间)...');
        this.db.exec("ALTER TABLE todos ADD COLUMN end_date DATETIME NULL");
      }
      
      // 添加索引
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_todos_item_type ON todos(item_type)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_todos_has_time ON todos(has_time)');
      
      console.log('日程/待办字段迁移完成');

      // ===== 笔记表基础字段检查 (2025-11-14) =====
      // 检查notes表结构
      const notesTableInfo = this.db.prepare("PRAGMA table_info(notes)").all();
      const notesColumnNames = notesTableInfo.map(col => col.name);
      
      console.log('检查notes表字段:', notesColumnNames);
      
      // 检查并添加title字段（兼容旧版本数据库）
      let titleAdded = false;
      if (!notesColumnNames.includes('title')) {
        console.log('添加title字段到notes表 (兼容旧版本)...');
        this.db.exec("ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT ''");
        titleAdded = true;
        console.log('✅ title字段添加完成');
      }
      
      // ===== 笔记收藏功能 (2025-12-16) =====
      if (!notesColumnNames.includes('is_favorite')) {
        console.log('添加is_favorite字段到notes表 (收藏功能)...');
        this.db.exec("ALTER TABLE notes ADD COLUMN is_favorite INTEGER DEFAULT 0");
        // 创建索引
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_is_favorite ON notes(is_favorite)');
        console.log('✅ is_favorite字段添加完成');
      }
      
      if (titleAdded) {
        this.rebuildNotesFts('notes title column added');
      }
      
      // ===== 笔记类型系统 (2025-11-11) =====
      if (!notesColumnNames.includes('note_type')) {
        console.log('添加note_type字段到notes表 (支持Markdown/白板等类型)...');
        this.db.exec("ALTER TABLE notes ADD COLUMN note_type TEXT DEFAULT 'markdown'");
        
        // 迁移现有数据：将 category='whiteboard' 的笔记迁移为 note_type='whiteboard'
        console.log('迁移现有白板笔记...');
        this.db.exec("UPDATE notes SET note_type = 'whiteboard' WHERE category = 'whiteboard'");
        
        // 创建索引
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type)');
        
        console.log('笔记类型字段迁移完成');
      }
      
      // 添加重复事项相关索引
      const repeatIndexes = [
        'CREATE INDEX IF NOT EXISTS idx_todos_repeat_type ON todos(repeat_type)',
        'CREATE INDEX IF NOT EXISTS idx_todos_is_recurring ON todos(is_recurring)',
        'CREATE INDEX IF NOT EXISTS idx_todos_next_due_date ON todos(next_due_date)',
        'CREATE INDEX IF NOT EXISTS idx_todos_parent_todo_id ON todos(parent_todo_id)'
      ];
      
      for (const indexSql of repeatIndexes) {
        this.db.exec(indexSql);
      }
      
      console.log('重复事项字段迁移完成');
      
      // ===== 性能优化索引（2025-11-09 添加）=====
      console.log('创建性能优化索引...');
      
      // 1. 笔记列表查询优化（最常用）
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_list_updated 
        ON notes(is_deleted, updated_at DESC, is_pinned DESC)
      `);
      
      // 2. 置顶笔记快速查询
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_pinned 
        ON notes(is_deleted, is_pinned, updated_at DESC)
      `);
      
      // 3. 已删除笔记查询优化
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_deleted 
        ON notes(is_deleted, deleted_at DESC)
      `);
      
      // 4. 分类筛选优化
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_category 
        ON notes(category, is_deleted, updated_at DESC)
      `);
      
      // 5. 创建时间索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_created 
        ON notes(is_deleted, created_at DESC)
      `);
      
      console.log('✅ 性能索引创建完成');
      
      // ===== 多设备同步 sync_id 迁移 (2025-11-19) =====
      // 添加 sync_id 字段用于跨设备同步识别，避免整数 ID 冲突
      await this._migrateSyncId();
      
      // 6. FTS5 全文搜索
      try {
        const ftsResult = this.ensureNotesFtsSchema('startup migration');
        if (ftsResult.rebuilt) {
          console.log('✅ FTS5 全文搜索引擎已重建');
        } else {
          console.log('FTS5 全文搜索引擎已是最新版本');
        }
      } catch (ftsError) {
        console.warn('FTS5 检查/修复失败（不影响应用启动）:', ftsError.message);
      }

      // 分析表优化查询计划
      this.db.exec('ANALYZE notes');
      console.log('✅ 数据库性能优化完成');
      
    } catch (error) {
      console.error('数据库迁移失败:', error);
      // 不抛出错误，允许应用继续运行
    }
  }

  /**
   * 迁移 sync_id 字段
   * 为 notes 和 todos 表添加 UUID 格式的 sync_id 用于跨设备同步
   */
  async _migrateSyncId() {
    try {
      dbLog('开始 sync_id 迁移...');
      
      // 检查 notes 表
      const notesTableInfo = this.db.prepare("PRAGMA table_info(notes)").all();
      const notesHasSyncId = notesTableInfo.some(col => col.name === 'sync_id');
      dbLog('notes 表是否有 sync_id:', notesHasSyncId);
      
      if (!notesHasSyncId) {
        dbLog('添加 sync_id 字段到 notes 表...');
        this.db.exec("ALTER TABLE notes ADD COLUMN sync_id TEXT UNIQUE");
        
        // 为现有记录生成 sync_id
        const notes = this.db.prepare('SELECT id FROM notes').all();
        const updateStmt = this.db.prepare('UPDATE notes SET sync_id = ? WHERE id = ?');
        
        for (const note of notes) {
          const syncId = this._generateSyncId();
          updateStmt.run(syncId, note.id);
        }
        
        // 创建索引
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_sync_id ON notes(sync_id)');
        
        dbLog(`✅ notes 表 sync_id 迁移完成（已更新 ${notes.length} 条记录）`);
      }
      
      // 检查 todos 表
      const todosTableInfo = this.db.prepare("PRAGMA table_info(todos)").all();
      const todosHasSyncId = todosTableInfo.some(col => col.name === 'sync_id');
      dbLog('todos 表是否有 sync_id:', todosHasSyncId);
      
      if (!todosHasSyncId) {
        dbLog('添加 sync_id 字段到 todos 表...');
        this.db.exec("ALTER TABLE todos ADD COLUMN sync_id TEXT UNIQUE");
        
        // 为现有记录生成 sync_id
        const todos = this.db.prepare('SELECT id FROM todos').all();
        const updateStmt = this.db.prepare('UPDATE todos SET sync_id = ? WHERE id = ?');
        
        for (const todo of todos) {
          const syncId = this._generateSyncId();
          updateStmt.run(syncId, todo.id);
        }
        
        // 创建索引
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_todos_sync_id ON todos(sync_id)');
        
        dbLog(`✅ todos 表 sync_id 迁移完成（已更新 ${todos.length} 条记录）`);
      }
      
      dbLog('sync_id 迁移检查完成');
      
    } catch (error) {
      dbLog('sync_id 迁移失败:', error.message, error.stack);
      // 不抛出错误，允许应用继续运行
    }
  }

  /**
   * 生成同步 ID (UUID v4 格式)
   */
  _generateSyncId() {
    const crypto = require('crypto');
    return crypto.randomUUID();
  }

  /**
   * 获取数据库实例
   */
  getDatabase() {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }
    return this.db;
  }

  /**
   * 获取数据库文件路径
   * @returns {string} 数据库文件路径
   */
  getDatabasePath() {
    return this.dbPath;
  }

  /**
   * 执行事务
   */
  transaction(callback) {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }
    return this.db.transaction(callback);
  }

  /**
   * 备份数据库
   */
  async backup(backupPath) {
    try {
      if (!this.db) {
        throw new Error('数据库未初始化');
      }
      
      await this.db.backup(backupPath);
      console.log('数据库备份成功:', backupPath);
      return true;
    } catch (error) {
      console.error('数据库备份失败:', error);
      throw error;
    }
  }

  /**
   * 修复损坏的数据库
   * 处理 SQLITE_CORRUPT_VTAB 等错误
   */
  async repairDatabase() {
    try {
      console.log('🔧 开始修复数据库...');
      
      if (!this.db) {
        throw new Error('数据库未初始化');
      }

      const beforeCheck = this.checkIntegrity('quick_check');

      const results = {
        beforeCheck,
        walCheckpoint: false,
        ftsRebuild: false,
        ftsUsable: null,
        vacuum: false,
        analyze: false,
        afterCheck: null
      };

      // 1. 执行 WAL checkpoint
      try {
        console.log('  🔄 执行 WAL checkpoint...');
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        results.walCheckpoint = true;
        console.log('  ✅ WAL checkpoint 完成');
      } catch (error) {
        console.error('  ⚠️  WAL checkpoint 失败:', error.message);
      }

      // 2. 重建 FTS5 虚拟表
      try {
        console.log('  🔨 重建 FTS5 虚拟表...');
        this.rebuildNotesFts('repairDatabase');
        results.ftsRebuild = true;
        results.ftsUsable = true;
        console.log('  ✅ FTS5 表重建完成');
      } catch (error) {
        console.error('  ⚠️  FTS5 重建失败:', error.message);
        results.ftsUsable = false;
      }

      // 3. 优化数据库
      try {
        console.log('  ⚡ 执行 VACUUM...');
        this.db.exec('VACUUM');
        results.vacuum = true;
        console.log('  ✅ VACUUM 完成');
      } catch (error) {
        console.error('  ⚠️  VACUUM 失败:', error.message);
      }

      // 4. 分析数据库
      try {
        console.log('  📊 执行 ANALYZE...');
        this.db.exec('ANALYZE');
        results.analyze = true;
        console.log('  ✅ ANALYZE 完成');
      } catch (error) {
        console.error('  ⚠️  ANALYZE 失败:', error.message);
      }

      results.afterCheck = this.checkIntegrity('quick_check');

      console.log('✅ 数据库修复完成');
      return { success: true, results };
      
    } catch (error) {
      console.error('❌ 数据库修复失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('数据库连接已关闭');
    }
  }

  /**
   * 迁移 changes 表的 entity_id 类型从 INTEGER 到 TEXT
   */
  async migrateChangesTableType() {
    try {
      const changesTableInfo = this.db.prepare("PRAGMA table_info(changes)").all();
      const entityIdColumn = changesTableInfo.find(col => col.name === 'entity_id');
      
      if (!entityIdColumn) {
        console.log('[迁移] changes 表不存在 entity_id 字段，跳过迁移');
        return;
      }
      
      if (entityIdColumn.type === 'TEXT') {
        console.log('[迁移] changes 表的 entity_id 已经是 TEXT 类型，跳过迁移');
        return;
      }
      
      console.log('[迁移] 开始修复 changes 表的 entity_id 类型...');
      console.log(`[迁移] 当前类型: ${entityIdColumn.type} → 目标类型: TEXT`);
      
      const migrate = this.db.transaction(() => {
        // 统计数据
        const stats = this.db.prepare('SELECT COUNT(*) as total FROM changes').get();
        console.log(`[迁移] 当前 changes 表有 ${stats.total} 条记录`);

        const backupTableName = `changes_backup_${Date.now()}`;
        this.db.exec(`CREATE TABLE ${backupTableName} AS SELECT * FROM changes`);
        console.log(`[迁移] 已备份到 ${backupTableName}`);

        const oldColumns = new Set(changesTableInfo.map(col => col.name));

        this.db.exec('DROP TABLE IF EXISTS changes_new');
        this.db.exec(`
          CREATE TABLE changes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            change_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            synced INTEGER DEFAULT 0,
            synced_at DATETIME NULL,
            device_id TEXT
          )
        `);

        const selectDeviceId = oldColumns.has('device_id') ? 'device_id' : 'NULL AS device_id';
        this.db.exec(`
          INSERT INTO changes_new (
            id, entity_type, entity_id, operation, change_data, created_at, synced, synced_at, device_id
          )
          SELECT
            id,
            entity_type,
            CAST(entity_id AS TEXT),
            operation,
            change_data,
            created_at,
            COALESCE(synced, 0),
            synced_at,
            ${selectDeviceId}
          FROM changes
        `);

        this.db.exec('DROP TABLE IF EXISTS changes');
        this.db.exec('ALTER TABLE changes_new RENAME TO changes');

        // 重建索引
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_changes_entity ON changes(entity_type, entity_id)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_changes_synced ON changes(synced)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_changes_created_at ON changes(created_at DESC)');
      });

      try {
        migrate();
        console.log('[迁移] ✅ changes 表迁移完成');
      } catch (error) {
        throw error;
      }
    } catch (error) {
      console.error('[迁移] ❌ changes 表迁移失败:', error);
      // 不抛出错误，避免影响应用启动
    }
  }

  /**
   * 获取数据库信息
   */
  getInfo() {
    if (!this.db) {
      return null;
    }
    
    return {
      path: this.dbPath,
      inTransaction: this.db.inTransaction,
      open: this.db.open,
      readonly: this.db.readonly
    };
  }
}

// 单例模式
let instance = null;

module.exports = {
  getInstance() {
    if (!instance) {
      instance = new DatabaseManager();
    }
    return instance;
  },
  DatabaseManager
};
