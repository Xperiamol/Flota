/**
 * 修复损坏的数据库
 * 处理 SQLITE_CORRUPT_VTAB 错误
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function getUserDataPath() {
  if (process.platform === 'win32') {
    const roamingDir = process.env.APPDATA ||
      path.join(process.env.USERPROFILE || process.env.HOME, 'AppData', 'Roaming');
    return path.join(roamingDir, 'Flota');
  }

  if (process.platform === 'darwin') {
    return path.join(process.env.HOME, 'Library', 'Application Support', 'Flota');
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, '.config'), 'Flota');
}

// 数据库路径，支持通过 FLOTA_DB_PATH 手动指定。
const prodDbPath = process.env.FLOTA_DB_PATH || path.join(getUserDataPath(), 'database', 'flota.db');

console.log('🔧 开始修复数据库...\n');
console.log('数据库路径:', prodDbPath);

if (!fs.existsSync(prodDbPath)) {
  console.error('❌ 数据库文件不存在');
  process.exit(1);
}

try {
  // 1. 创建备份
  const timestamp = Date.now();
  const backupPath = `${prodDbPath}.backup.${timestamp}`;
  fs.copyFileSync(prodDbPath, backupPath);
  console.log('✅ 已创建备份:', backupPath);

  // 2. 打开数据库
  console.log('\n📂 打开数据库...');
  const db = new Database(prodDbPath);

  // 3. 执行 WAL checkpoint，将 WAL 文件内容合并到主数据库
  console.log('🔄 执行 WAL checkpoint...');
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log('✅ WAL checkpoint 完成');
  } catch (error) {
    console.error('⚠️  WAL checkpoint 失败:', error.message);
  }

  // 4. 检查完整性
  console.log('\n🔍 检查数据库完整性...');
  try {
    const integrityCheck = db.pragma('integrity_check');
    if (integrityCheck[0].integrity_check === 'ok') {
      console.log('✅ 数据库完整性检查通过');
    } else {
      console.log('⚠️  发现完整性问题:', integrityCheck);
    }
  } catch (error) {
    console.error('❌ 完整性检查失败:', error.message);
  }

  // 5. 重建 FTS5 表，确保列和触发器与应用写入逻辑一致
  console.log('\n🔨 重建 FTS5 虚拟表...');
  try {
    const notesExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='notes'
    `).get();

    if (!notesExists) {
      throw new Error('notes 表不存在，无法重建 notes_fts');
    }

    console.log('  - 删除旧的 FTS5 触发器和表...');
    db.exec('DROP TRIGGER IF EXISTS notes_fts_insert');
    db.exec('DROP TRIGGER IF EXISTS notes_fts_update');
    db.exec('DROP TRIGGER IF EXISTS notes_fts_delete');
    db.exec('DROP TABLE IF EXISTS notes_fts');

    console.log('  - 重新创建 FTS5 表...');
    db.exec(`
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        content,
        content='notes',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 1'
      )
    `);

    console.log('  - 同步现有笔记...');
    const existingNotes = db.prepare('SELECT id, title, content FROM notes').all();
    const insertStmt = db.prepare('INSERT INTO notes_fts(rowid, title, content) VALUES (?, ?, ?)');
    for (const note of existingNotes) {
      insertStmt.run(note.id, note.title || '', note.content || '');
    }

    console.log('  - 创建同步触发器...');
    db.exec(`
      CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
      END;

      CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
        DELETE FROM notes_fts WHERE rowid = old.id;
        INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;

      CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
        DELETE FROM notes_fts WHERE rowid = old.id;
      END;
    `);

    console.log(`✅ FTS5 表重建完成（已同步 ${existingNotes.length} 条笔记）`);
  } catch (error) {
    console.error('⚠️  FTS5 重建失败:', error.message);
  }

  // 6. 优化数据库
  console.log('\n⚡ 优化数据库...');
  try {
    db.exec('VACUUM');
    console.log('✅ VACUUM 完成');
  } catch (error) {
    console.error('⚠️  VACUUM 失败:', error.message);
  }

  // 7. 分析数据库
  try {
    db.exec('ANALYZE');
    console.log('✅ ANALYZE 完成');
  } catch (error) {
    console.error('⚠️  ANALYZE 失败:', error.message);
  }

  // 8. 显示数据库信息
  console.log('\n📊 数据库信息:');
  try {
    const noteCount = db.prepare('SELECT COUNT(*) as count FROM notes WHERE is_deleted = 0').get();
    const todoCount = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0').get();
    console.log('  - 笔记数量:', noteCount.count);
    console.log('  - 待办数量:', todoCount.count);
  } catch (error) {
    console.error('⚠️  无法获取数据统计:', error.message);
  }

  db.close();
  console.log('\n✅ 数据库修复完成！');

} catch (error) {
  console.error('\n❌ 修复失败:', error.message);
  console.error(error);
  process.exit(1);
}
