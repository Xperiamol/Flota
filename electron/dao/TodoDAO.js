const { getInstance } = require('./DatabaseManager');
const TimeZoneUtils = require('../utils/timeZoneUtils');
const ChangeLogDAO = require('./ChangeLogDAO');
const crypto = require('crypto');

class TodoDAO {
  constructor() {
    this.dbManager = getInstance();
    this.changeLog = new ChangeLogDAO();
  }

  /**
   * 获取数据库实例
   */
  getDB() {
    return this.dbManager.getDatabase();
  }

  /**
   * 判断日期字符串是否包含时间信息
   * @param {string} dateStr - 日期字符串
   * @returns {number} 1=有时间, 0=无时间/全天
   * @private
   */
  _hasTimeInfo(dateStr) {
    if (!dateStr) return 0;
    
    // 格式示例：
    // "2025-11-12" → 0 (全天)
    // "2025-11-12T10:00:00.000Z" → 1 (有时间)
    // "2025-11-12 18:00:00" → 1 (有时间)
    
    // 检查是否包含时间部分（T 或空格后跟时分秒）
    const hasTimePattern = /T\d{2}:\d{2}|\s\d{2}:\d{2}/;
    return hasTimePattern.test(dateStr) ? 1 : 0;
  }

  /**
   * 创建新待办事项
   * @param {object} todoData - 待办数据
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  create(todoData, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    const { 
      id, // 支持指定 ID（UUID 同步时需要）
      sync_id, // 同步 ID（跨设备唯一标识）
      content, 
      description = '',
      tags = '',
      is_completed = 0,
      is_important = 0, 
      is_urgent = 0, 
      due_date = null,
      end_date = null,
      item_type = 'todo',
      focus_time_seconds = 0,
      repeat_type = 'none',
      repeat_days = '',
      repeat_interval = 1,
      next_due_date = null,
      is_recurring = 0,
      parent_todo_id = null,
      completions = '[]',
      is_deleted = 0,
      completed_at = null,
      deleted_at = null,
      created_at,
      updated_at
    } = todoData;
    
    // 自动生成 sync_id（如果未提供）
    const finalSyncId = sync_id || crypto.randomUUID();
    
    // 自动判断 has_time
    const has_time = todoData.has_time !== undefined 
      ? todoData.has_time 
      : this._hasTimeInfo(due_date);
    
    let result;
    if (id) {
      // 如果指定了 ID（从远程同步），使用 INSERT OR REPLACE
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO todos (
          id, sync_id, content, description, tags, is_completed, is_important, is_urgent, due_date, end_date, 
          item_type, has_time,
          focus_time_seconds,
          repeat_type, repeat_days, repeat_interval, next_due_date, is_recurring, parent_todo_id,
          completions,
          is_deleted, completed_at, deleted_at,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          COALESCE((SELECT created_at FROM todos WHERE id = ?), COALESCE(?, CURRENT_TIMESTAMP)),
          COALESCE(?, CURRENT_TIMESTAMP))
      `);
      result = stmt.run(
        id, finalSyncId, content, description, tags, is_completed, is_important, is_urgent, due_date, end_date,
        item_type, has_time,
        focus_time_seconds,
        repeat_type, repeat_days, repeat_interval, next_due_date, is_recurring, parent_todo_id,
        completions,
        is_deleted, completed_at, deleted_at,
        id,
        created_at,
        updated_at
      );
      result.lastInsertRowid = id;
    } else {
      const stmt = db.prepare(`
        INSERT INTO todos (
          sync_id, content, description, tags, is_completed, is_important, is_urgent, due_date, end_date, 
          item_type, has_time,
          focus_time_seconds,
          repeat_type, repeat_days, repeat_interval, next_due_date, is_recurring, parent_todo_id,
          completions,
          is_deleted, completed_at, deleted_at,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
      `);
      result = stmt.run(
        finalSyncId, content, description, tags, is_completed, is_important, is_urgent, due_date, end_date,
        item_type, has_time,
        focus_time_seconds,
        repeat_type, repeat_days, repeat_interval, next_due_date, is_recurring, parent_todo_id,
        completions,
        is_deleted, completed_at, deleted_at,
        created_at, updated_at
      );
    }
    
    const todo = this.findById(result.lastInsertRowid) || this.findByIdIncludeDeleted(result.lastInsertRowid);
    
    // 记录变更日志（同步来源的操作不记录，防止无限循环）
    if (!skipChangeLog) {
      this.changeLog.logChange('todo', todo.id, 'create', todo);
    }
    
    return todo;
  }

  /**
   * 根据ID查找待办事项
   */
  findById(id) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM todos WHERE id = ? AND is_deleted = 0');
    return stmt.get(id);
  }

  /**
   * 根据 sync_id 查找待办事项
   * @param {string} syncId - 同步 ID
   */
  findBySyncId(syncId) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM todos WHERE sync_id = ? AND is_deleted = 0');
    return stmt.get(syncId);
  }

  /**
   * 根据 sync_id 查找待办事项（包括已删除）
   * @param {string} syncId - 同步 ID
   */
  findBySyncIdIncludeDeleted(syncId) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM todos WHERE sync_id = ?');
    return stmt.get(syncId);
  }

  /**
   * 根据ID查找待办事项(包括已删除)
   */
  findByIdIncludeDeleted(id) {
    const db = this.getDB();
    const stmt = db.prepare('SELECT * FROM todos WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * 更新待办事项
   * @param {number|string} id - 待办 ID
   * @param {object} todoData - 待办数据
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  update(id, todoData, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    const {
      content,
      description,
      tags,
      is_completed,
      is_important,
      is_urgent,
      due_date,
      repeat_type,
      repeat_days,
      repeat_interval,
      next_due_date,
      is_recurring,
      parent_todo_id,
      focus_time_seconds,
      completions,
      is_deleted,
      updated_at,
      completed_at
    } = todoData;

    let updateFields = [];
    let params = [];

    if (content !== undefined) {
      updateFields.push('content = ?');
      params.push(content);
    }

    if (description !== undefined) {
      updateFields.push('description = ?');
      params.push(description);
    }

    if (tags !== undefined) {
      updateFields.push('tags = ?');
      params.push(tags);
    }

    if (is_completed !== undefined) {
      updateFields.push('is_completed = ?');
      params.push(is_completed);

      if (completed_at !== undefined) {
        // 显式传入了 completed_at（同步场景），直接使用
        updateFields.push('completed_at = ?');
        params.push(completed_at);
      } else if (is_completed) {
        // 用户手动完成，自动设置当前时间
        updateFields.push('completed_at = CURRENT_TIMESTAMP');
      } else {
        // 标记为未完成，清空完成时间
        updateFields.push('completed_at = NULL');
      }
    } else if (completed_at !== undefined) {
      // 仅更新 completed_at（不常见但保持完整性）
      updateFields.push('completed_at = ?');
      params.push(completed_at);
    }

    if (is_important !== undefined) {
      updateFields.push('is_important = ?');
      params.push(is_important);
    }

    if (is_urgent !== undefined) {
      updateFields.push('is_urgent = ?');
      params.push(is_urgent);
    }

    if (due_date !== undefined) {
      updateFields.push('due_date = ?');
      params.push(due_date);

      // 自动更新 has_time（如果 todoData 没有明确指定）
      if (todoData.has_time === undefined) {
        updateFields.push('has_time = ?');
        params.push(this._hasTimeInfo(due_date));
      }
    }

    // 明确指定的 has_time 和其他字段
    if (todoData.has_time !== undefined) {
      updateFields.push('has_time = ?');
      params.push(todoData.has_time);
    }

    if (todoData.end_date !== undefined) {
      updateFields.push('end_date = ?');
      params.push(todoData.end_date);
    }

    if (todoData.item_type !== undefined) {
      updateFields.push('item_type = ?');
      params.push(todoData.item_type);
    }

    if (repeat_type !== undefined) {
      updateFields.push('repeat_type = ?');
      params.push(repeat_type);
    }

    if (repeat_days !== undefined) {
      updateFields.push('repeat_days = ?');
      params.push(repeat_days);
    }

    if (repeat_interval !== undefined) {
      updateFields.push('repeat_interval = ?');
      params.push(repeat_interval);
    }

    if (next_due_date !== undefined) {
      updateFields.push('next_due_date = ?');
      params.push(next_due_date);
    }

    if (is_recurring !== undefined) {
      updateFields.push('is_recurring = ?');
      params.push(is_recurring);
    }

    if (parent_todo_id !== undefined) {
      updateFields.push('parent_todo_id = ?');
      params.push(parent_todo_id);
    }

    if (focus_time_seconds !== undefined) {
      updateFields.push('focus_time_seconds = ?');
      params.push(focus_time_seconds);
    }

    if (completions !== undefined) {
      updateFields.push('completions = ?');
      params.push(completions);
    }

    // 处理删除状态
    if (is_deleted !== undefined) {
      updateFields.push('is_deleted = ?');
      params.push(is_deleted);

      // 如果恢复（is_deleted从1变为0），清除deleted_at
      if (is_deleted === 0) {
        updateFields.push('deleted_at = NULL');
      }
      // 如果删除（is_deleted从0变为1），设置deleted_at
      else if (is_deleted === 1) {
        updateFields.push('deleted_at = CURRENT_TIMESTAMP');
      }
    }

    // 如果提供了 updated_at（同步时），使用提供的值；否则使用当前时间
    if (updated_at !== undefined) {
      updateFields.push('updated_at = ?');
      params.push(updated_at);
    } else {
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
    }
    params.push(id);

    const stmt = db.prepare(`
      UPDATE todos
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes > 0) {
      const updatedTodo = this.findById(id);
      // 记录变更日志（同步来源的操作不记录，防止无限循环）
      if (!skipChangeLog && updatedTodo) {
        // 传递完整实体数据以确保 sync_id 被记录
        this.changeLog.logChange('todo', id, 'update', updatedTodo);
      }
      return updatedTodo;
    }

    return null;
  }

  /**
   * 为待办事项累加专注时长（秒）
   */
  addFocusTime(id, durationSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return this.findById(id);
    }

    const db = this.getDB();
    const stmt = db.prepare(`
      UPDATE todos
      SET focus_time_seconds = COALESCE(focus_time_seconds, 0) + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(Math.round(durationSeconds), id);
    return this.findById(id);
  }

  /**
   * 软删除待办事项
   */
  delete(id) {
    return this.softDelete(id);
  }

  /**
   * 软删除待办事项
   * @param {number|string} id - 待办 ID
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  softDelete(id, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    
    // 先获取完整实体数据（包含 sync_id），用于记录变更日志
    const todoBeforeDelete = this.findByIdIncludeDeleted(id);
    
    const stmt = db.prepare(`
      UPDATE todos 
      SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const result = stmt.run(id).changes > 0;
    
    if (result && !skipChangeLog && todoBeforeDelete) {
      // 记录变更日志（同步来源的操作不记录，防止无限循环）
      // 传递完整实体数据以确保 sync_id 被记录
      this.changeLog.logChange('todo', id, 'delete', todoBeforeDelete);
    }
    
    return result;
  }

  /**
   * 恢复已删除的待办事项
   * @param {number|string} id - 待办 ID
   * @param {object} options - 选项
   * @param {boolean} options.skipChangeLog - 是否跳过变更日志（同步时使用，防止无限循环）
   */
  restore(id, options = {}) {
    const { skipChangeLog = false } = options;
    const db = this.getDB();
    const stmt = db.prepare(`
      UPDATE todos 
      SET is_deleted = 0, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const result = stmt.run(id).changes > 0;
    
    if (result && !skipChangeLog) {
      // 获取恢复后的完整实体数据（包含 sync_id）
      const restoredTodo = this.findById(id);
      // 记录变更日志（同步来源的操作不记录，防止无限循环）
      // 传递完整实体数据以确保 sync_id 被记录
      this.changeLog.logChange('todo', id, 'restore', restoredTodo);
    }
    
    return result;
  }

  /**
   * 永久删除待办事项
   */
  hardDelete(id) {
    const db = this.getDB();
    const stmt = db.prepare('DELETE FROM todos WHERE id = ?');
    return stmt.run(id).changes > 0;
  }

  /**
   * 清理软删除超过 keepDays 天的待办事项（物理删除）
   * @param {number} keepDays - 保留天数，默认30天
   * @returns {number} 删除的条数
   */
  purgeOldDeleted(keepDays = 30) {
    const db = this.getDB();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = cutoff.toISOString();
    const stmt = db.prepare('DELETE FROM todos WHERE is_deleted = 1 AND deleted_at < ?');
    return stmt.run(cutoffStr).changes;
  }

  /**
   * 获取所有待办事项
   */
  findAll(options = {}) {
    const db = this.getDB();
    const VALID_SORT_COLUMNS = ['quadrant', 'due_date', 'created_at', 'updated_at'];
    const VALID_SORT_ORDERS = ['ASC', 'DESC'];
    let {
      includeCompleted = true,
      includeDeleted = false,
      sortBy = 'quadrant', // 'quadrant', 'due_date', 'created_at'
      sortOrder = 'ASC'
    } = options;
    
    // 防止 SQL 注入：白名单校验
    if (!VALID_SORT_COLUMNS.includes(sortBy)) sortBy = 'quadrant';
    if (!VALID_SORT_ORDERS.includes(sortOrder.toUpperCase())) sortOrder = 'ASC';
    
    let whereConditions = [];
    let params = [];
    
    if (!includeDeleted) {
      whereConditions.push('is_deleted = 0');
    }
    
    if (!includeCompleted) {
      whereConditions.push('is_completed = 0');
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    let orderClause = '';
    if (sortBy === 'quadrant') {
      // 四象限排序：重要且紧急 > 重要不紧急 > 不重要紧急 > 不重要不紧急
      orderClause = `ORDER BY 
        (is_important * 2 + is_urgent) DESC,
        CASE 
          WHEN due_date IS NOT NULL THEN due_date 
          ELSE '9999-12-31 23:59:59'
        END ASC,
        created_at ASC`;
    } else if (sortBy === 'due_date') {
      orderClause = `ORDER BY 
        CASE 
          WHEN due_date IS NOT NULL THEN due_date 
          ELSE '9999-12-31 23:59:59'
        END ${sortOrder},
        created_at ASC`;
    } else {
      orderClause = `ORDER BY ${sortBy} ${sortOrder}`;
    }
    
    const stmt = db.prepare(`
      SELECT * FROM todos 
      ${whereClause}
      ${orderClause}
    `);
    
    return stmt.all(...params);
  }

  /**
   * 按四象限分组获取待办事项
   */
  findByQuadrant(includeCompleted = false) {
    const todos = this.findAll({ includeCompleted, sortBy: 'quadrant' });
    
    const quadrants = {
      urgent_important: [], // 重要且紧急
      not_urgent_important: [], // 重要不紧急
      urgent_not_important: [], // 紧急不重要
      not_urgent_not_important: [] // 不重要不紧急
    };
    
    todos.forEach(todo => {
      if (todo.is_important && todo.is_urgent) {
        quadrants.urgent_important.push(todo);
      } else if (todo.is_important && !todo.is_urgent) {
        quadrants.not_urgent_important.push(todo);
      } else if (!todo.is_important && todo.is_urgent) {
        quadrants.urgent_not_important.push(todo);
      } else {
        quadrants.not_urgent_not_important.push(todo);
      }
    });
    
    return quadrants;
  }

  /**
   * 获取指定日期的待办事项
   */
  findByDate(dateString) {
    const db = this.getDB();
    const dateStart = `${dateString} 00:00:00`;
    const dateEnd = `${dateString} 23:59:59`;
    
    const stmt = db.prepare(`
      SELECT * FROM todos 
      WHERE is_deleted = 0 
        AND is_completed = 0 
        AND due_date >= ? AND due_date <= ?
      ORDER BY due_date ASC
    `);
    
    return stmt.all(dateStart, dateEnd);
  }

  /**
   * 获取今日到期的待办事项
   */
  findDueToday() {
    const db = this.getDB();
    const todayStart = TimeZoneUtils.todayStartUTC();
    const todayEnd = TimeZoneUtils.todayEndUTC();
    
    const stmt = db.prepare(`
      SELECT * FROM todos 
      WHERE is_deleted = 0 
        AND is_completed = 0 
        AND due_date >= ? AND due_date <= ?
      ORDER BY due_date ASC
    `);
    
    return stmt.all(todayStart, todayEnd);
  }

  /**
   * 获取逾期的待办事项
   */
  findOverdue() {
    const db = this.getDB();
    const nowUTC = TimeZoneUtils.nowUTC();
    
    const stmt = db.prepare(`
      SELECT * FROM todos 
      WHERE is_deleted = 0 
        AND is_completed = 0 
        AND due_date < ?
      ORDER BY due_date ASC
    `);
    
    return stmt.all(nowUTC);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const db = this.getDB();
    const nowUTC = TimeZoneUtils.nowUTC();
    const todayStart = new Date(nowUTC);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(nowUTC);
    todayEnd.setHours(23, 59, 59, 999);
    
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0');
    const completedStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0 AND is_completed = 1');
    const pendingStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0 AND is_completed = 0');
    const overdueStmt = db.prepare(`
      SELECT COUNT(*) as count FROM todos 
      WHERE is_deleted = 0 AND is_completed = 0 AND due_date < ?
    `);
    const dueTodayStmt = db.prepare(`
      SELECT COUNT(*) as count FROM todos 
      WHERE is_deleted = 0 AND is_completed = 0 AND due_date >= ? AND due_date <= ?
    `);
    const deletedStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 1');
    
    // 获取专注时长统计
    const totalFocusTimeStmt = db.prepare('SELECT COALESCE(SUM(focus_time_seconds), 0) as total FROM todos WHERE is_deleted = 0');
    const todayFocusTimeStmt = db.prepare(`
      SELECT COALESCE(SUM(focus_time_seconds), 0) as total FROM todos 
      WHERE is_deleted = 0 AND DATE(updated_at) = DATE(?)
    `);
    const weekFocusTimeStmt = db.prepare(`
      SELECT COALESCE(SUM(focus_time_seconds), 0) as total FROM todos 
      WHERE is_deleted = 0 AND updated_at >= datetime(?, '-6 days')
    `);
    const monthFocusTimeStmt = db.prepare(`
      SELECT COALESCE(SUM(focus_time_seconds), 0) as total FROM todos 
      WHERE is_deleted = 0 AND updated_at >= datetime(?, '-29 days')
    `);
    
    // 获取按时完成率统计：completed_at <= due_date
    // 比较完整的时间戳，如果due_date只有日期则会是当天00:00:00
    const completedOnTimeStmt = db.prepare(`
      SELECT COUNT(*) as count FROM todos 
      WHERE is_deleted = 0 AND is_completed = 1 
      AND due_date IS NOT NULL 
      AND completed_at IS NOT NULL 
      AND completed_at <= due_date
    `);
    
    // 调试：获取有截止日期的已完成待办总数
    const completedWithDueDateStmt = db.prepare(`
      SELECT COUNT(*) as count FROM todos 
      WHERE is_deleted = 0 AND is_completed = 1 AND due_date IS NOT NULL
    `);
    
    const completed = completedStmt.get().count;
    const completedOnTime = completedOnTimeStmt.get().count;
    const completedWithDueDate = completedWithDueDateStmt.get().count;
    
    return {
      total: totalStmt.get().count,
      completed: completed,
      pending: pendingStmt.get().count,
      overdue: overdueStmt.get(nowUTC).count,
      dueToday: dueTodayStmt.get(todayStart.toISOString(), todayEnd.toISOString()).count,
      deleted: deletedStmt.get().count,
      // 按时完成统计
      completedOnTime: completedOnTime,
      completedWithDueDate: completedWithDueDate,
      onTimeRate: completedWithDueDate > 0 ? Math.round((completedOnTime / completedWithDueDate) * 100) : 0,
      // 专注时长统计（秒）
      totalFocusTime: totalFocusTimeStmt.get().total,
      todayFocusTime: todayFocusTimeStmt.get(nowUTC).total,
      weekFocusTime: weekFocusTimeStmt.get(nowUTC).total,
      monthFocusTime: monthFocusTimeStmt.get(nowUTC).total
    };
  }

  /**
   * 获取优先级统计
   */
  getPriorityStats() {
    const db = this.getDB();
    
    const urgentStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0 AND is_important = 1 AND is_urgent = 1 AND is_completed = 0');
    const importantStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0 AND is_important = 1 AND is_urgent = 0 AND is_completed = 0');
    const normalStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0 AND is_important = 0 AND is_urgent = 1 AND is_completed = 0');
    const lowStmt = db.prepare('SELECT COUNT(*) as count FROM todos WHERE is_deleted = 0 AND is_important = 0 AND is_urgent = 0 AND is_completed = 0');
    
    return {
      urgent: urgentStmt.get().count,
      important: importantStmt.get().count,
      normal: normalStmt.get().count,
      low: lowStmt.get().count
    };
  }

  /**
   * 批量更新待办事项
   */
  batchUpdate(updates) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      updates.forEach(({ id, ...data }) => {
        this.update(id, data);
      });
    });
    
    return transaction();
  }

  /**
   * 批量软删除待办事项
   */
  batchDelete(ids) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      ids.forEach(id => {
        const todo = this.findById(id);
        if (todo) {
          const stmt = db.prepare(`
            UPDATE todos 
            SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `);
          if (stmt.run(id).changes > 0) {
            this.changeLog.logChange('todo', id, 'delete', { ...todo, is_deleted: 1 });
          }
        }
      });
    });
    return transaction();
  }

  /**
   * 批量恢复待办事项
   */
  batchRestore(ids) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      ids.forEach(id => {
        const stmt = db.prepare(`
          UPDATE todos 
          SET is_deleted = 0, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `);
        if (stmt.run(id).changes > 0) {
          const restored = this.findById(id);
          if (restored) {
            this.changeLog.logChange('todo', id, 'restore', restored);
          }
        }
      });
    });
    return transaction();
  }

  /**
   * 批量永久删除待办事项
   */
  batchHardDelete(ids) {
    const db = this.getDB();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM todos WHERE id IN (${placeholders})`);
    return stmt.run(...ids).changes;
  }

  /**
   * 批量完成待办事项
   */
  batchComplete(ids) {
    const db = this.getDB();
    const transaction = db.transaction(() => {
      ids.forEach(id => {
        const stmt = db.prepare(`
          UPDATE todos 
          SET is_completed = 1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
          WHERE is_deleted = 0 AND id = ?
        `);
        if (stmt.run(id).changes > 0) {
          const completed = this.findById(id);
          if (completed) {
            this.changeLog.logChange('todo', id, 'update', completed);
          }
        }
      });
    });
    return transaction();
  }

  /**
   * 搜索待办事项
   */
  search(query) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT *, 
        CASE 
          WHEN is_important = 1 AND is_urgent = 1 THEN 'urgent'
          WHEN is_important = 1 AND is_urgent = 0 THEN 'important'
          WHEN is_important = 0 AND is_urgent = 1 THEN 'normal'
          ELSE 'low'
        END as priority,
        content as title
      FROM todos 
      WHERE is_deleted = 0 AND (content LIKE ? OR description LIKE ?)
      ORDER BY created_at DESC
    `);
    return stmt.all(`%${query}%`, `%${query}%`);
  }

  /**
   * 按优先级排序获取待办事项
   */
  findByPriority() {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT *, 
        CASE 
          WHEN is_important = 1 AND is_urgent = 1 THEN 'urgent'
          WHEN is_important = 1 AND is_urgent = 0 THEN 'important'
          WHEN is_important = 0 AND is_urgent = 1 THEN 'normal'
          ELSE 'low'
        END as priority,
        content as title
      FROM todos 
      WHERE is_deleted = 0
      ORDER BY 
        CASE 
          WHEN is_important = 1 AND is_urgent = 1 THEN 1
          WHEN is_important = 1 AND is_urgent = 0 THEN 2
          WHEN is_important = 0 AND is_urgent = 1 THEN 3
          ELSE 4
        END,
        created_at DESC
    `);
    return stmt.all();
  }

  /**
   * 按截止时间排序获取待办事项
   */
  findByDueDate() {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT *, 
        CASE 
          WHEN is_important = 1 AND is_urgent = 1 THEN 'urgent'
          WHEN is_important = 1 AND is_urgent = 0 THEN 'important'
          WHEN is_important = 0 AND is_urgent = 1 THEN 'normal'
          ELSE 'low'
        END as priority,
        content as title
      FROM todos 
      WHERE is_deleted = 0
      ORDER BY 
        CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
        due_date ASC,
        created_at DESC
    `);
    return stmt.all();
  }

  /**
   * 按创建时间排序获取待办事项
   */
  findByCreatedAt() {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT *, 
        CASE 
          WHEN is_important = 1 AND is_urgent = 1 THEN 'urgent'
          WHEN is_important = 1 AND is_urgent = 0 THEN 'important'
          WHEN is_important = 0 AND is_urgent = 1 THEN 'normal'
          ELSE 'low'
        END as priority,
        content as title
      FROM todos 
      WHERE is_deleted = 0
      ORDER BY created_at DESC
    `);
    return stmt.all();
  }

  /**
   * 获取待办事项标签统计
   */
  getTodoTagStats() {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT tags FROM todos 
      WHERE is_deleted = 0 AND tags IS NOT NULL AND tags != ''
    `);
    
    const todos = stmt.all();
    const tagCounts = {};
    
    todos.forEach(todo => {
      if (todo.tags) {
        // 解析标签字符串，支持逗号分隔和空格分隔
        const tags = todo.tags.split(/[,\s]+/).filter(tag => tag.trim());
        tags.forEach(tag => {
          const cleanTag = tag.trim();
          if (cleanTag) {
            tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
          }
        });
      }
    });
    
    // 转换为数组格式，按使用次数排序
    return Object.entries(tagCounts)
      .map(([name, usage_count]) => ({ name, usage_count }))
      .sort((a, b) => b.usage_count - a.usage_count);
  }

  /**
   * 查找所有重复事项
   */
  findRecurringTodos() {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM todos 
      WHERE is_deleted = 0 AND is_recurring = 1 AND is_completed = 0
      ORDER BY next_due_date ASC
    `);
    return stmt.all();
  }

  /**
   * 查找需要生成下次重复的待办事项
   */
  findTodosNeedingNextRecurrence() {
    const db = this.getDB();
    const nowUTC = TimeZoneUtils.nowUTC();
    const stmt = db.prepare(`
      SELECT * FROM todos 
      WHERE recurrence_pattern IS NOT NULL 
        AND is_completed = 1 
        AND next_due_date IS NOT NULL 
        AND next_due_date <= ?
    `);
    return stmt.all(nowUTC);
  }

  /**
   * 创建重复事项的下一个实例
   */
  createNextRecurrence(originalTodo, nextDueDate) {
    const db = this.getDB();
    const stmt = db.prepare(`
      INSERT INTO todos (
        content, tags, is_important, is_urgent, due_date,
        repeat_type, repeat_days, repeat_interval, next_due_date, is_recurring, parent_todo_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    
    const result = stmt.run(
      originalTodo.content,
      originalTodo.tags,
      originalTodo.is_important,
      originalTodo.is_urgent,
      nextDueDate,
      originalTodo.repeat_type,
      originalTodo.repeat_days,
      originalTodo.repeat_interval,
      null, // next_due_date will be calculated later
      originalTodo.is_recurring,
      originalTodo.parent_todo_id || originalTodo.id
    );
    
    return this.findById(result.lastInsertRowid);
  }

  /**
   * 查找某个重复事项的所有实例
   */
  findRecurrenceInstances(parentTodoId) {
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM todos 
      WHERE (parent_todo_id = ? OR id = ?) AND is_deleted = 0
      ORDER BY due_date ASC
    `);
    return stmt.all(parentTodoId, parentTodoId);
  }

  /**
   * 获取已删除的待办事项
   */
  findDeleted(options = {}) {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;
    
    const db = this.getDB();
    const stmt = db.prepare(`
      SELECT * FROM todos 
      WHERE is_deleted = 1
      ORDER BY deleted_at DESC
      LIMIT ? OFFSET ?
    `);
    
    const todos = stmt.all(limit, offset);
    
    // 获取总数
    const countStmt = db.prepare('SELECT COUNT(*) as total FROM todos WHERE is_deleted = 1');
    const { total } = countStmt.get();
    
    return {
      todos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}

module.exports = TodoDAO;