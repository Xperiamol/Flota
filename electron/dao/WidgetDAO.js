const crypto = require('crypto');
const { getInstance } = require('./DatabaseManager');

const MAX_VERSIONS = 50;

const parseFields = (text) => {
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

// 记录对外的形态：业务字段平铺，系统字段以下划线开头，避免和组件自定义字段冲突
const toRecord = (row) => ({
  ...parseFields(row.fields),
  _id: row.id,
  _collection: row.collection,
  _sortKey: row.sort_key || '',
  _createdAt: row.created_at,
  _updatedAt: row.updated_at,
});

// 写入时剥掉系统字段，只存业务字段
const cleanFields = (fields) => {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (key.startsWith('_') || value === undefined) continue;
    result[key] = value;
  }
  return result;
};

const toWidgetRow = (row) => row && ({
  id: row.id,
  name: row.name,
  code: row.code,
  source: row.source || 'ai',
  storeId: row.store_id || null,
  pinned: Boolean(row.pinned),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isDeleted: Boolean(row.is_deleted),
  deletedAt: row.deleted_at || null,
});

const toInstanceRow = (row) => row && ({
  id: row.id,
  widgetId: row.widget_id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isDeleted: Boolean(row.is_deleted),
  deletedAt: row.deleted_at || null,
});

/**
 * 组件数据访问：组件（代码）→ 实例（数据归属）→ 记录；另有本地版本历史。
 */
class WidgetDAO {
  constructor() {
    this.dbManager = getInstance();
  }

  getDB() {
    return this.dbManager.getDatabase();
  }

  // ==================== 组件 ====================

  listWidgets({ includeDeleted = false } = {}) {
    return this.getDB().prepare(`
      SELECT * FROM widgets ${includeDeleted ? '' : 'WHERE is_deleted = 0'} ORDER BY created_at ASC
    `).all().map(toWidgetRow);
  }

  getWidget(id, { includeDeleted = false } = {}) {
    const row = this.getDB().prepare(`SELECT * FROM widgets WHERE id = ? ${includeDeleted ? '' : 'AND is_deleted = 0'}`).get(String(id));
    return toWidgetRow(row) || null;
  }

  insertWidget({ id, name, code, source = 'ai', storeId = null, pinned = true, createdAt, updatedAt }) {
    const now = Date.now();
    const widgetId = id || crypto.randomUUID();
    this.getDB().prepare(`
      INSERT INTO widgets (id, name, code, source, store_id, pinned, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(widgetId, name || '', code || '', source, storeId, pinned ? 1 : 0, createdAt || now, updatedAt || now);
    return this.getWidget(widgetId);
  }

  updateWidget(id, patch = {}) {
    const current = this.getDB().prepare('SELECT * FROM widgets WHERE id = ?').get(String(id));
    if (!current) return null;
    const fields = [];
    const values = [];
    const map = { name: 'name', code: 'code', pinned: 'pinned', isDeleted: 'is_deleted', deletedAt: 'deleted_at', source: 'source', storeId: 'store_id' };
    for (const [key, column] of Object.entries(map)) {
      if (patch[key] === undefined) continue;
      fields.push(`${column} = ?`);
      values.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key]);
    }
    fields.push('updated_at = ?');
    values.push(patch.updatedAt || Math.max(Date.now(), current.updated_at + 1));
    this.getDB().prepare(`UPDATE widgets SET ${fields.join(', ')} WHERE id = ?`).run(...values, String(id));
    return this.getWidget(id, { includeDeleted: true });
  }

  // ==================== 实例 ====================

  listInstances(widgetId, { deleted = false } = {}) {
    return this.getDB().prepare(`
      SELECT * FROM widget_instances WHERE widget_id = ? AND is_deleted = ? ORDER BY created_at ASC
    `).all(String(widgetId), deleted ? 1 : 0).map(toInstanceRow);
  }

  listAllInstances({ includeDeleted = false } = {}) {
    return this.getDB().prepare(`
      SELECT * FROM widget_instances ${includeDeleted ? '' : 'WHERE is_deleted = 0'} ORDER BY created_at ASC
    `).all().map(toInstanceRow);
  }

  getInstance(id, { includeDeleted = false } = {}) {
    const row = this.getDB().prepare(`SELECT * FROM widget_instances WHERE id = ? ${includeDeleted ? '' : 'AND is_deleted = 0'}`).get(String(id));
    return toInstanceRow(row) || null;
  }

  insertInstance({ id, widgetId, name, createdAt, updatedAt }) {
    const now = Date.now();
    const instanceId = id || crypto.randomUUID();
    this.getDB().prepare(`
      INSERT INTO widget_instances (id, widget_id, name, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, 0)
    `).run(instanceId, String(widgetId), name || '', createdAt || now, updatedAt || now);
    return this.getInstance(instanceId);
  }

  updateInstance(id, patch = {}) {
    const current = this.getDB().prepare('SELECT * FROM widget_instances WHERE id = ?').get(String(id));
    if (!current) return null;
    const fields = [];
    const values = [];
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(String(patch.name)); }
    if (patch.isDeleted !== undefined) { fields.push('is_deleted = ?'); values.push(patch.isDeleted ? 1 : 0); }
    if (patch.deletedAt !== undefined) { fields.push('deleted_at = ?'); values.push(patch.deletedAt); }
    fields.push('updated_at = ?');
    values.push(patch.updatedAt || Math.max(Date.now(), current.updated_at + 1));
    this.getDB().prepare(`UPDATE widget_instances SET ${fields.join(', ')} WHERE id = ?`).run(...values, String(id));
    return this.getInstance(id, { includeDeleted: true });
  }

  // 彻底删除实例及其数据（“最近删除”超过保留期后）
  purgeInstance(id) {
    const db = this.getDB();
    db.transaction(() => {
      db.prepare('DELETE FROM widget_records WHERE instance_id = ?').run(String(id));
      db.prepare('DELETE FROM widget_instances WHERE id = ?').run(String(id));
    })();
  }

  countRecords(instanceId) {
    return this.getDB().prepare('SELECT COUNT(*) AS count FROM widget_records WHERE instance_id = ? AND is_deleted = 0')
      .get(String(instanceId)).count;
  }

  // ==================== 记录 ====================

  listRecords(instanceId, collection) {
    return this.getDB().prepare(`
      SELECT * FROM widget_records WHERE instance_id = ? AND collection = ? AND is_deleted = 0
      ORDER BY sort_key ASC, created_at ASC
    `).all(instanceId, collection).map(toRecord);
  }

  getRecord(instanceId, collection, id) {
    const row = this.getDB().prepare(`
      SELECT * FROM widget_records WHERE instance_id = ? AND id = ? AND collection = ? AND is_deleted = 0
    `).get(instanceId, id, collection);
    return row ? toRecord(row) : null;
  }

  listCollections(instanceId) {
    return this.getDB().prepare(`
      SELECT collection, COUNT(*) AS count FROM widget_records
      WHERE instance_id = ? AND is_deleted = 0 GROUP BY collection ORDER BY collection
    `).all(instanceId);
  }

  insertRecords(instanceId, collection, items) {
    const db = this.getDB();
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO widget_records (id, instance_id, collection, fields, sort_key, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const ids = [];
    db.transaction(() => {
      items.forEach((item, index) => {
        const id = typeof item?._id === 'string' && item._id ? item._id : crypto.randomUUID();
        const sortKey = typeof item?._sortKey === 'string' ? item._sortKey : '';
        // 同一批插入的记录时间戳递增 1ms，保证按创建时间排序稳定
        const createdAt = now + index;
        stmt.run(id, instanceId, collection, JSON.stringify(cleanFields(item)), sortKey, createdAt, createdAt);
        ids.push(id);
      });
    })();
    return ids.map((id) => this.getRecord(instanceId, collection, id));
  }

  updateRecord(instanceId, collection, id, patch, { replace = false } = {}) {
    const db = this.getDB();
    const row = db.prepare(`
      SELECT * FROM widget_records WHERE instance_id = ? AND id = ? AND collection = ? AND is_deleted = 0
    `).get(instanceId, id, collection);
    if (!row) return null;
    const next = replace ? cleanFields(patch) : { ...parseFields(row.fields), ...cleanFields(patch) };
    // null 表示删除该字段
    for (const [key, value] of Object.entries(next)) {
      if (value === null) delete next[key];
    }
    const sortKey = typeof patch?._sortKey === 'string' ? patch._sortKey : row.sort_key;
    db.prepare(`
      UPDATE widget_records SET fields = ?, sort_key = ?, updated_at = ? WHERE instance_id = ? AND id = ?
    `).run(JSON.stringify(next), sortKey, Math.max(Date.now(), row.updated_at + 1), instanceId, id);
    return this.getRecord(instanceId, collection, id);
  }

  deleteRecord(instanceId, collection, id) {
    return this.getDB().prepare(`
      UPDATE widget_records SET is_deleted = 1, fields = '{}', updated_at = ?
      WHERE instance_id = ? AND id = ? AND collection = ? AND is_deleted = 0
    `).run(Date.now(), instanceId, id, collection).changes > 0;
  }

  // 修改组件时的预览：把实例数据复制到草稿命名空间（保留记录 id，字段间引用不失效）
  cloneRecords(fromInstanceId, toInstanceId) {
    return this.getDB().prepare(`
      INSERT OR REPLACE INTO widget_records (id, instance_id, collection, fields, sort_key, created_at, updated_at, is_deleted)
      SELECT id, ?, collection, fields, sort_key, created_at, updated_at, is_deleted
      FROM widget_records WHERE instance_id = ? AND is_deleted = 0
    `).run(toInstanceId, fromInstanceId).changes;
  }

  moveRecords(fromInstanceId, toInstanceId) {
    return this.getDB().prepare('UPDATE widget_records SET instance_id = ? WHERE instance_id = ?').run(toInstanceId, fromInstanceId).changes;
  }

  dropRecords(instanceId) {
    return this.getDB().prepare('DELETE FROM widget_records WHERE instance_id = ?').run(instanceId).changes;
  }

  // ==================== 同步 ====================

  // 导出某个实例的全部记录（含墓碑），按 id 排序保证 hash 稳定
  exportForSync(instanceId) {
    return this.getDB().prepare(`
      SELECT id, collection, fields, sort_key, created_at, updated_at, is_deleted
      FROM widget_records WHERE instance_id = ? ORDER BY id
    `).all(instanceId).map((row) => ({
      id: row.id,
      collection: row.collection,
      fields: parseFields(row.fields),
      sort_key: row.sort_key || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_deleted: row.is_deleted ? 1 : 0,
    }));
  }

  // 按 updated_at 逐条合并远端记录，较新的一方胜出
  mergeFromSync(instanceId, records) {
    const db = this.getDB();
    const getStmt = db.prepare('SELECT updated_at FROM widget_records WHERE instance_id = ? AND id = ?');
    const upsertStmt = db.prepare(`
      INSERT INTO widget_records (id, instance_id, collection, fields, sort_key, created_at, updated_at, is_deleted)
      VALUES (@id, @instance_id, @collection, @fields, @sort_key, @created_at, @updated_at, @is_deleted)
      ON CONFLICT(instance_id, id) DO UPDATE SET
        collection = excluded.collection, fields = excluded.fields, sort_key = excluded.sort_key,
        updated_at = excluded.updated_at, is_deleted = excluded.is_deleted
    `);
    let applied = 0;
    db.transaction(() => {
      for (const record of records || []) {
        if (!record?.id || !record.collection) continue;
        const local = getStmt.get(instanceId, record.id);
        if (local && local.updated_at >= record.updated_at) continue;
        upsertStmt.run({
          id: record.id,
          instance_id: instanceId,
          collection: record.collection,
          fields: JSON.stringify(record.fields || {}),
          sort_key: record.sort_key || '',
          created_at: record.created_at || record.updated_at || Date.now(),
          updated_at: record.updated_at || Date.now(),
          is_deleted: record.is_deleted ? 1 : 0,
        });
        applied++;
      }
    })();
    return applied;
  }

  // 同步：直接写入远端的组件 / 实例行（保留远端时间戳）
  upsertWidgetFromSync(entry) {
    this.getDB().prepare(`
      INSERT INTO widgets (id, name, code, source, store_id, pinned, created_at, updated_at, is_deleted, deleted_at)
      VALUES (@id, @name, @code, @source, @store_id, @pinned, @created_at, @updated_at, @is_deleted, @deleted_at)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code, source = excluded.source,
        store_id = excluded.store_id, pinned = excluded.pinned, updated_at = excluded.updated_at,
        is_deleted = excluded.is_deleted, deleted_at = excluded.deleted_at
    `).run({
      id: entry.id,
      name: entry.name || '',
      code: entry.code || '',
      source: entry.source || 'ai',
      store_id: entry.storeId || null,
      pinned: entry.pinned ? 1 : 0,
      created_at: entry.createdAt || entry.updatedAt || Date.now(),
      updated_at: entry.updatedAt || Date.now(),
      is_deleted: entry.isDeleted ? 1 : 0,
      deleted_at: entry.deletedAt || null,
    });
  }

  upsertInstanceFromSync(entry) {
    this.getDB().prepare(`
      INSERT INTO widget_instances (id, widget_id, name, created_at, updated_at, is_deleted, deleted_at)
      VALUES (@id, @widget_id, @name, @created_at, @updated_at, @is_deleted, @deleted_at)
      ON CONFLICT(id) DO UPDATE SET widget_id = excluded.widget_id, name = excluded.name, updated_at = excluded.updated_at,
        is_deleted = excluded.is_deleted, deleted_at = excluded.deleted_at
    `).run({
      id: entry.id,
      widget_id: entry.widgetId,
      name: entry.name || '',
      created_at: entry.createdAt || entry.updatedAt || Date.now(),
      updated_at: entry.updatedAt || Date.now(),
      is_deleted: entry.isDeleted ? 1 : 0,
      deleted_at: entry.deletedAt || null,
    });
  }

  // ==================== 版本 ====================

  addVersion(widgetId, code, note = '') {
    const db = this.getDB();
    const last = db.prepare('SELECT MAX(version) AS v FROM widget_versions WHERE widget_id = ?').get(widgetId);
    const version = (last?.v || 0) + 1;
    db.prepare(`
      INSERT INTO widget_versions (widget_id, version, code, note, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(widgetId, version, code, note || '', Date.now());
    db.prepare('DELETE FROM widget_versions WHERE widget_id = ? AND version <= ?').run(widgetId, version - MAX_VERSIONS);
    return version;
  }

  latestVersion(widgetId) {
    return this.getDB().prepare('SELECT MAX(version) AS v FROM widget_versions WHERE widget_id = ?').get(widgetId)?.v || 0;
  }

  listVersions(widgetId) {
    return this.getDB().prepare(`
      SELECT version, note, created_at, LENGTH(code) AS size FROM widget_versions
      WHERE widget_id = ? ORDER BY version DESC
    `).all(widgetId);
  }

  getVersion(widgetId, version) {
    return this.getDB().prepare(`
      SELECT version, code, note, created_at FROM widget_versions WHERE widget_id = ? AND version = ?
    `).get(widgetId, version) || null;
  }
}

module.exports = WidgetDAO;
