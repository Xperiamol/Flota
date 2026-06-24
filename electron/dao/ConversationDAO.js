const { getInstance } = require('./DatabaseManager');

/**
 * AI 会话持久化 DAO。
 * 把完整会话（含图片、长消息、工具结果等大对象）落到 SQLite，
 * 替代原先全量塞进 localStorage 导致的体积膨胀与随机写入失败。
 */
class ConversationDAO {
  constructor() {
    this.dbManager = getInstance();
  }

  getDB() {
    return this.dbManager.getDatabase();
  }

  _serializeMessages(messages) {
    try {
      return JSON.stringify(Array.isArray(messages) ? messages : []);
    } catch (_) {
      return '[]';
    }
  }

  _parseMessages(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  _rowToConversation(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title || '',
      noteId: row.note_id == null ? null : String(row.note_id),
      source: row.source || (row.note_id ? 'note' : 'general'),
      messages: this._parseMessages(row.messages),
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null
    };
  }

  /**
   * 创建或整体覆盖一条会话。
   */
  upsert(conversation = {}) {
    const db = this.getDB();
    const id = conversation.id;
    if (!id) throw new Error('conversation.id is required');

    const now = Date.now();
    const noteId = conversation.noteId == null ? null : String(conversation.noteId);
    const source = conversation.source || (noteId ? 'note' : 'general');
    const createdAt = conversation.createdAt ?? now;
    const updatedAt = conversation.updatedAt ?? now;

    const stmt = db.prepare(`
      INSERT INTO ai_conversations (id, title, note_id, source, messages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        note_id = excluded.note_id,
        source = excluded.source,
        messages = excluded.messages,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      id,
      conversation.title || '',
      noteId,
      source,
      this._serializeMessages(conversation.messages),
      createdAt,
      updatedAt
    );

    return this.getById(id);
  }

  getById(id) {
    if (!id) return null;
    const db = this.getDB();
    const row = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
    return this._rowToConversation(row);
  }

  /**
   * 拉取全部会话（含完整消息），按更新时间倒序。用于启动时水合内存状态。
   */
  getAll() {
    const db = this.getDB();
    const rows = db.prepare('SELECT * FROM ai_conversations ORDER BY updated_at DESC').all();
    return rows.map((row) => this._rowToConversation(row));
  }

  delete(id) {
    if (!id) return false;
    const db = this.getDB();
    const result = db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteMany(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const db = this.getDB();
    const stmt = db.prepare('DELETE FROM ai_conversations WHERE id = ?');
    const tx = db.transaction((list) => {
      let count = 0;
      for (const id of list) {
        if (!id) continue;
        count += stmt.run(id).changes;
      }
      return count;
    });
    return tx(ids);
  }
}

module.exports = ConversationDAO;
