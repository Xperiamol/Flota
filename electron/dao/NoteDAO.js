const { getInstance } = require('./DatabaseManager');
const TagService = require('../services/TagService');
const ChangeLogDAO = require('./ChangeLogDAO');
const crypto = require('crypto');

class NoteDAO {
  constructor() {
    this.dbManager = getInstance();
    this.tagService = new TagService();
    this.changeLog = new ChangeLogDAO();
  }

  /**
   * 获取数据库实例
   */
  getDB() {
    return this.dbManager.getDatabase();
  }

  /**
   * 创建新笔记
   * @param {object} noteData - 笔记数据
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  create(noteData, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    const { 
      id, // 支持指定 ID（UUID 同步时需要）
      sync_id, // 同步 ID（跨设备唯一标识）
      title = '', 
      content = '', 
      tags = '', 
      category = 'default',
      note_type = 'markdown', // 新增：笔记类型
      created_at,
      updated_at
    } = noteData;
    
    // 自动生成 sync_id（如果未提供）
    const finalSyncId = sync_id || crypto.randomUUID();
    
    let result;
    if (id) {
      // 如果指定了 ID（从远程同步），使用 INSERT OR REPLACE
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO notes (id, sync_id, title, content, tags, category, note_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 
          COALESCE((SELECT created_at FROM notes WHERE id = ?), COALESCE(?, CURRENT_TIMESTAMP)),
          COALESCE(?, CURRENT_TIMESTAMP))
      `);
      result = stmt.run(id, finalSyncId, title, content, tags, category, note_type, id, created_at, updated_at);
      result.lastInsertRowid = id;
    } else {
      const stmt = db.prepare(`
        INSERT INTO notes (sync_id, title, content, tags, category, note_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
      `);
      result = stmt.run(finalSyncId, title, content, tags, category, note_type, created_at, updated_at);
    }
    
    // 更新标签使用次数
    if (tags) {
      this.tagService.updateTagsUsage(tags);
    }
    
    const note = this.findById(result.lastInsertRowid) || this.findByIdIncludeDeleted(result.lastInsertRowid);
    
    // 记录变更日志（同步来源的操作不记录，防止无限循环）
    if (!skipChangeLog) {
      this.changeLog.logChange('note', note.id, 'create', note);
    }
    
    return note;
  }

  /**
   * 根据ID查找笔记
   */
  findById(id) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM notes 
      WHERE id = ? AND is_deleted = 0
    `);
    
    return stmt.get(id);
  }

  /**
   * 根据 sync_id 查找笔记
   * @param {string} syncId - 同步 ID
   */
  findBySyncId(syncId) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM notes 
      WHERE sync_id = ? AND is_deleted = 0
    `);
    return stmt.get(syncId);
  }

  /**
   * 根据 sync_id 查找笔记（包括已删除）
   * @param {string} syncId - 同步 ID
   */
  findBySyncIdIncludeDeleted(syncId) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM notes WHERE sync_id = ?');
    return stmt.get(syncId);
  }

  /**
   * 根据ID查找笔记(包括已删除)
   */
  findByIdIncludeDeleted(id) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * 更新笔记
   * @param {number|string} id - 笔记 ID
   * @param {object} noteData - 笔记数据
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  update(id, noteData, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    const { title, content, tags, category, is_pinned, is_deleted, deleted_at, note_type, updated_at } = noteData;

    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }

    if (content !== undefined) {
      updates.push('content = ?');
      values.push(content);
    }

    if (tags !== undefined) {
      updates.push('tags = ?');
      values.push(tags);

      // 更新标签使用次数
    if (tags) {
      this.tagService.updateTagsUsage(tags);
    }
    }

    if (category !== undefined) {
      updates.push('category = ?');
      values.push(category);
    }

    if (note_type !== undefined) {
      updates.push('note_type = ?');
      values.push(note_type);
    }

    if (is_pinned !== undefined) {
      updates.push('is_pinned = ?');
      values.push(is_pinned ? 1 : 0);
    }

    if (is_deleted !== undefined) {
      updates.push('is_deleted = ?');
      values.push(is_deleted ? 1 : 0);
      
      // 处理 deleted_at
      if (is_deleted) {
        updates.push('deleted_at = CURRENT_TIMESTAMP');
      } else {
        updates.push('deleted_at = NULL');
      }
    } else if (deleted_at !== undefined) {
      updates.push('deleted_at = ?');
      values.push(deleted_at);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    // 如果提供了 updated_at（同步时），使用提供的值；否则使用当前时间
    if (updated_at !== undefined) {
      updates.push('updated_at = ?');
      values.push(updated_at);
    } else {
      updates.push('updated_at = CURRENT_TIMESTAMP');
    }
    values.push(id);

    const stmt = db.prepare(`
      UPDATE notes
      SET ${updates.join(', ')}
      WHERE id = ? AND is_deleted = 0
    `);

    stmt.run(...values);

    // 获取更新后的完整笔记数据（包含 sync_id）
    const updatedNote = this.findById(id);

    // 记录变更日志（同步来源的操作不记录，防止无限循环）
    if (!skipChangeLog && updatedNote) {
      // 传递完整实体数据以确保 sync_id 被记录
      this.changeLog.logChange('note', id, 'update', updatedNote);
    }

    return updatedNote;
  }

  /**
   * 软删除笔记
   * @param {number|string} id - 笔记 ID
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  softDelete(id, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    
    // 先获取完整实体数据（包含 sync_id），用于记录变更日志
    const noteBeforeDelete = this.findByIdIncludeDeleted(id);
    
    const stmt = db.prepare(`
      UPDATE notes 
      SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    const result = stmt.run(id).changes > 0;
    
    if (result && !skipChangeLog && noteBeforeDelete) {
      // 记录变更日志（同步来源的操作不记录，防止无限循环）
      // 传递完整实体数据以确保 sync_id 被记录
      this.changeLog.logChange('note', id, 'delete', noteBeforeDelete);
    }
    
    return result;
  }

  /**
   * 恢复已删除的笔记
   * @param {number|string} id - 笔记 ID
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  restore(id, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    const stmt = db.prepare(`
      UPDATE notes 
      SET is_deleted = 0, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    const result = stmt.run(id).changes > 0;
    
    if (result && !skipChangeLog) {
      // 获取恢复后的完整实体数据（包含 sync_id）
      const restoredNote = this.findById(id);
      // 记录变更日志（同步来源的操作不记录，防止无限循环）
      // 传递完整实体数据以确保 sync_id 被记录
      this.changeLog.logChange('note', id, 'restore', restoredNote);
    }
    
    return result;
  }

  /**
   * 永久删除笔记
   */
  hardDelete(id) {
    const db = this.getDB();
    const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
    return stmt.run(id).changes > 0;
  }

  /**
   * 获取所有笔记（分页）
   */
  findAll(options = {}) {
    const db = this.getDB();
    const VALID_SORT_COLUMNS = ['updated_at', 'created_at', 'title'];
    const VALID_SORT_ORDERS = ['ASC', 'DESC'];
    let {
      page = 1,
      limit = 50,
      category = null,
      tags = null,
      search = null,
      sortBy = 'updated_at',
      sortOrder = 'DESC',
      includeDeleted = false,
      pinnedFirst = true
    } = options;
    
    // 防止 SQL 注入：白名单校验
    if (!VALID_SORT_COLUMNS.includes(sortBy)) sortBy = 'updated_at';
    if (!VALID_SORT_ORDERS.includes(sortOrder.toUpperCase())) sortOrder = 'DESC';
    
    let whereConditions = [];
    let params = [];
    
    // 是否包含已删除的笔记
    if (!includeDeleted) {
      whereConditions.push('is_deleted = 0');
    }
    
    // 分类筛选
    if (category) {
      whereConditions.push('category = ?');
      params.push(category);
    }
    
    // 标签筛选
    if (tags && tags.length > 0) {
      const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
      whereConditions.push(`(${tagConditions})`);
      tags.forEach(tag => {
        params.push(`%${tag}%`);
      });
    }
    
    // 搜索
    if (search) {
      whereConditions.push('(title LIKE ? OR content LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // 排序
    let orderClause = '';
    if (pinnedFirst) {
      orderClause = `ORDER BY is_pinned DESC, ${sortBy} ${sortOrder}`;
    } else {
      orderClause = `ORDER BY ${sortBy} ${sortOrder}`;
    }
    
    // 分页
    const offset = (page - 1) * limit;
    const limitClause = `LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const sql = `
      SELECT * FROM notes 
      ${whereClause}
      ${orderClause}
      ${limitClause}
    `;
    
    const stmt = db.prepare(sql);
    const notes = stmt.all(...params);
    
    // 获取总数
    const countSql = `
      SELECT COUNT(*) as total FROM notes 
      ${whereClause}
    `;
    const countStmt = db.prepare(countSql);
    const countParams = params.slice(0, -2); // 移除 limit 和 offset 参数
    const { total } = countStmt.get(...countParams);
    
    return {
      notes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * 获取置顶笔记
   */
  findPinned() {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM notes 
      WHERE is_pinned = 1 AND is_deleted = 0
      ORDER BY updated_at DESC
    `);
    
    return stmt.all();
  }

  /**
   * 获取已删除的笔记
   */
  findDeleted(options = {}) {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;
    
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM notes 
      WHERE is_deleted = 1
      ORDER BY deleted_at DESC
      LIMIT ? OFFSET ?
    `);
    
    const notes = stmt.all(limit, offset);
    
    // 获取总数
    const countStmt = db.prepare('SELECT COUNT(*) as total FROM notes WHERE is_deleted = 1');
    const { total } = countStmt.get();
    
    return {
      notes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * 按分类统计笔记数量
   */
  countByCategory() {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM notes 
      WHERE is_deleted = 0
      GROUP BY category
      ORDER BY count DESC
    `);
    
    return stmt.all();
  }

  /**
   * 获取最近修改的笔记
   */
  findRecent(limit = 10) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM notes 
      WHERE is_deleted = 0
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    
    return stmt.all(limit);
  }

  /**
   * 搜索笔记
   */
  search(query, options = {}) {
    const { limit = 50, category = null } = options;
    
    const db = this.getDB();
    let sql = `
      SELECT *, 
        (CASE 
          WHEN title LIKE ? THEN 3
          WHEN content LIKE ? THEN 2
          WHEN tags LIKE ? THEN 1
          ELSE 0
        END) as relevance
      FROM notes 
      WHERE is_deleted = 0 
        AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
    `;
    
    const params = [
      `%${query}%`, `%${query}%`, `%${query}%`,
      `%${query}%`, `%${query}%`, `%${query}%`
    ];
    
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    
    sql += ' ORDER BY relevance DESC, updated_at DESC LIMIT ?';
    params.push(limit);
    
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * 切换笔记置顶状态
   */
  togglePin(id) {
    const db = this.getDB();
    const note = this.findById(id);
    if (!note) {
      return null;
    }
    
    const newPinnedState = note.is_pinned ? 0 : 1;
    const stmt = db.prepare(`
      UPDATE notes 
      SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(newPinnedState, id);
    return this.findById(id);
  }

  /**
   * 批量操作
   */
  batchUpdate(ids, updates) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      for (const id of ids) {
        this.update(id, updates);
      }
    });
    
    return transaction();
  }

  /**
   * 批量删除
   */
  batchDelete(ids) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      for (const id of ids) {
        this.softDelete(id);
      }
    });
    
    return transaction();
  }

  /**
   * 批量恢复
   */
  batchRestore(ids) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      for (const id of ids) {
        this.restore(id);
      }
    });
    
    return transaction();
  }

  /**
   * 批量永久删除
   */
  batchHardDelete(ids) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      for (const id of ids) {
        this.hardDelete(id);
      }
    });
    
    return transaction();
  }



  /**
   * 获取统计信息
   */
  getStats() {
    const db = this.getDB();
    
    const totalStmt = db.prepare('SELECT COUNT(*) as total FROM notes WHERE is_deleted = 0');
    const pinnedStmt = db.prepare('SELECT COUNT(*) as pinned FROM notes WHERE is_pinned = 1 AND is_deleted = 0');
    const deletedStmt = db.prepare('SELECT COUNT(*) as deleted FROM notes WHERE is_deleted = 1');
    const categoriesStmt = db.prepare('SELECT COUNT(DISTINCT category) as categories FROM notes WHERE is_deleted = 0');
    
    return {
      total: totalStmt.get().total,
      pinned: pinnedStmt.get().pinned,
      deleted: deletedStmt.get().deleted,
      categories: categoriesStmt.get().categories
    };
  }
}

module.exports = NoteDAO;