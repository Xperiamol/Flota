const { getInstance } = require('./DatabaseManager');
const { getInstance: getDeviceIdManager } = require('../utils/DeviceIdManager');

/**
 * 变更日志DAO - 用于追踪数据变更以支持增量同步
 * 
 * 注意：entity_id 存储的是 sync_id（UUID），而不是整数 id。
 * 这样可以确保跨设备同步时能正确识别实体。
 */
class ChangeLogDAO {
  constructor() {
    this.dbManager = getInstance();
  }

  /**
   * 获取数据库实例
   */
  getDB() {
    return this.dbManager.getDatabase();
  }

  /**
   * 记录变更
   * @param {string} entityType - 实体类型 ('note' 或 'todo')
   * @param {string|number} entityId - 实体ID（优先使用 sync_id）
   * @param {string} operation - 操作类型 ('create', 'update', 'delete', 'restore')
   * @param {object} changeData - 变更数据 (可选)
   */
  logChange(entityType, entityId, operation, changeData = null) {
    const db = this.getDB();
    
    // 优先使用 changeData 中的 sync_id 作为实体标识符
    // 这确保了跨设备同步时能正确识别实体
    let syncEntityId = entityId;
    if (changeData && changeData.sync_id) {
      syncEntityId = changeData.sync_id;
    }

    // 获取设备ID和高精度时间戳
    const deviceId = getDeviceIdManager().getDeviceId();
    const createdAt = new Date().toISOString();
    
    const stmt = db.prepare(`
      INSERT INTO changes (entity_type, entity_id, operation, change_data, device_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const changeDataJson = changeData ? JSON.stringify(changeData) : null;
    const result = stmt.run(entityType, syncEntityId, operation, changeDataJson, deviceId, createdAt);
    return result.lastInsertRowid;
  }

  /**
   * 获取未同步的变更
   * @param {number} limit - 限制数量
   */
  getUnsyncedChanges(limit = 100) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM changes 
      WHERE synced = 0
      ORDER BY created_at ASC
      LIMIT ?
    `);
    
    return stmt.all(limit).map(change => ({
      ...change,
      change_data: change.change_data ? JSON.parse(change.change_data) : null
    }));
  }

  /**
   * 获取指定时间后的变更
   * @param {string} since - ISO时间戳
   * @param {number} limit - 限制数量
   */
  getChangesSince(since, limit = 100) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM changes 
      WHERE created_at > ?
      ORDER BY created_at ASC
      LIMIT ?
    `);
    
    return stmt.all(since, limit).map(change => ({
      ...change,
      change_data: change.change_data ? JSON.parse(change.change_data) : null
    }));
  }

  /**
   * 获取指定实体的未同步变更
   * @param {string} entityType - 实体类型
   * @param {string} entityId - 实体ID (sync_id)
   */
  getUnsyncedChangesForEntity(entityType, entityId) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM changes 
      WHERE entity_type = ? AND entity_id = ? AND synced = 0
    `);
    return stmt.all(entityType, entityId);
  }

  /**
   * 标记变更为已同步
   * @param {number[]} changeIds - 变更ID列表
   */
  markAsSynced(changeIds) {
    if (!changeIds || changeIds.length === 0) {
      return 0;
    }

    const db = this.getDB();
    const placeholders = changeIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE changes 
      SET synced = 1, synced_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `);
    
    return stmt.run(...changeIds).changes;
  }

  /**
   * 获取特定实体的变更历史
   * @param {string} entityType - 实体类型
   * @param {number} entityId - 实体ID
   * @param {number} limit - 限制数量
   */
  getEntityHistory(entityType, entityId, limit = 50) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM changes 
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    
    return stmt.all(entityType, entityId, limit).map(change => ({
      ...change,
      change_data: change.change_data ? JSON.parse(change.change_data) : null
    }));
  }

  /**
   * 按本地日期统计实体的活动次数（用于活动热力图）
   * 统计 create/update/restore 三类编辑活动，delete 不计入
   * @param {string} entityType - 实体类型 ('note' 或 'todo')
   * @param {number} days - 统计最近天数
   * @returns {Object} { 'YYYY-MM-DD': count, ... }
   */
  getDailyActivityCounts(entityType, days = 90) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT date(created_at, 'localtime') AS day, COUNT(*) AS count
      FROM changes
      WHERE entity_type = ?
        AND operation IN ('create', 'update', 'restore')
        AND date(created_at, 'localtime') >= date('now', 'localtime', ?)
      GROUP BY day
    `);

    const rows = stmt.all(entityType, `-${Math.max(0, days - 1)} days`);
    const result = {};
    for (const row of rows) {
      result[row.day] = row.count;
    }
    return result;
  }

  /**
   * 清理已同步的旧变更记录
   * @param {number} daysToKeep - 保留天数
   */
  cleanupOldChanges(daysToKeep = 30) {
    const db = this.getDB();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const stmt = db.prepare(`
      DELETE FROM changes 
      WHERE synced = 1 AND synced_at < ?
    `);
    
    return stmt.run(cutoffDate.toISOString()).changes;
  }

  /**
   * 获取变更统计
   */
  getStats() {
    const db = this.getDB();
    
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM changes');
    const unsyncedStmt = db.prepare('SELECT COUNT(*) as count FROM changes WHERE synced = 0');
    const noteChangesStmt = db.prepare("SELECT COUNT(*) as count FROM changes WHERE entity_type = 'note'");
    const todoChangesStmt = db.prepare("SELECT COUNT(*) as count FROM changes WHERE entity_type = 'todo'");
    
    return {
      total: totalStmt.get().count,
      unsynced: unsyncedStmt.get().count,
      noteChanges: noteChangesStmt.get().count,
      todoChanges: todoChangesStmt.get().count
    };
  }

  /**
   * 批量记录变更
   * @param {Array} changes - 变更数组，每项包含 {entityType, entityId, operation, changeData}
   */
  batchLogChanges(changes) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      for (const change of changes) {
        this.logChange(
          change.entityType,
          change.entityId,
          change.operation,
          change.changeData
        );
      }
    });
    
    return transaction();
  }

  /**
   * 删除特定实体的所有变更记录
   * @param {string} entityType - 实体类型
   * @param {number} entityId - 实体ID
   */
  deleteEntityChanges(entityType, entityId) {
    const db = this.getDB();
    const stmt = db.prepare(`
      DELETE FROM changes 
      WHERE entity_type = ? AND entity_id = ?
    `);
    
    return stmt.run(entityType, entityId).changes;
  }
}

module.exports = ChangeLogDAO;
