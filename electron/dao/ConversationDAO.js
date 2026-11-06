const { getInstance } = require('./DatabaseManager');

/**
 * AI 会话持久化 DAO。
 *
 * 每条会话存两份内容：
 *   - messages：界面展示用的消息（文字、确认卡、工具标记、步骤进度等）
 *   - transcript：发给模型的完整记录（pi AgentMessage，含工具调用与结果），下一轮据此重建上下文
 * 两者都只由主进程的会话服务（ConversationSessions）写入；渲染层只能改标题、归属笔记等元数据。
 */
let transcriptColumnReady = false;

class ConversationDAO {
  constructor() {
    this.dbManager = getInstance();
  }

  getDB() {
    const db = this.dbManager.getDatabase();
    if (!transcriptColumnReady) {
      const columns = db.prepare('PRAGMA table_info(ai_conversations)').all().map((column) => column.name);
      if (!columns.includes('transcript')) db.exec('ALTER TABLE ai_conversations ADD COLUMN transcript TEXT');
      transcriptColumnReady = true;
    }
    return db;
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

  /** @param {{ withTranscript?: boolean }} [options] 完整记录只给主进程用，不发给渲染层 */
  _rowToConversation(row, { withTranscript = false } = {}) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title || '',
      noteId: row.note_id == null ? null : String(row.note_id),
      source: row.source || (row.note_id ? 'note' : 'general'),
      messages: this._parseMessages(row.messages),
      ...(withTranscript ? { transcript: row.transcript ? this._parseMessages(row.transcript) : null } : {}),
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null
    };
  }

  /**
   * 创建会话或更新元数据（标题 / 归属笔记 / 来源）。渲染层通过这里保存，不会改动消息与完整记录。
   */
  upsert(conversation = {}) {
    const db = this.getDB();
    const id = conversation.id;
    if (!id) throw new Error('conversation.id is required');

    const now = Date.now();
    const noteId = conversation.noteId == null ? null : String(conversation.noteId);
    const source = conversation.source || (noteId ? 'note' : 'general');
    db.prepare(`
      INSERT INTO ai_conversations (id, title, note_id, source, messages, created_at, updated_at)
      VALUES (?, ?, ?, ?, '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        note_id = excluded.note_id,
        source = excluded.source,
        updated_at = excluded.updated_at
    `).run(id, conversation.title || '', noteId, source, conversation.createdAt ?? now, conversation.updatedAt ?? now);

    return this.getById(id);
  }

  /** 会话服务写入一轮对话的结果：展示消息、完整记录、标题 */
  saveSession(id, { messages, transcript, title, updatedAt = Date.now() }) {
    const db = this.getDB();
    db.prepare(`
      UPDATE ai_conversations SET
        messages = ?,
        transcript = COALESCE(?, transcript),
        title = COALESCE(?, title),
        updated_at = ?
      WHERE id = ?
    `).run(
      this._serializeMessages(messages),
      transcript === undefined ? null : this._serializeMessages(transcript),
      title ?? null,
      updatedAt,
      id
    );
    return this.getById(id, { withTranscript: true });
  }

  getById(id, options = {}) {
    if (!id) return null;
    const db = this.getDB();
    const row = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
    return this._rowToConversation(row, options);
  }

  /**
   * 拉取全部会话（含展示消息，不含完整记录），按更新时间倒序。用于启动时水合内存状态。
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
