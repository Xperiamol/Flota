const crypto = require('crypto');
const DatabaseManager = require('../dao/DatabaseManager');

/**
 * 笔记 / 待办 → 记忆索引（artifact 层）
 *
 * 每篇笔记、每条待办对应一条记忆（source_key = note:<id> / todo:<id>）：
 * - 原文没变（按内容哈希判断）就跳过，不重复调用 LLM 摘要
 * - 原文改了就原地更新这条记忆；待办完成后状态也会跟着变
 * - 原文删除后由 Mem0Service.cleanupMemories 清掉对应记忆
 *
 * 触发：引擎就绪后立即一次、之后每小时一次、窗口失焦 20 秒后一次；同一时间只跑一个。
 */
class HistoricalDataMigrationService {
  constructor(mem0Service, aiService = null) {
    this.mem0Service = mem0Service;
    this.aiService = aiService;
    this.dbManager = DatabaseManager.getInstance();
    this.db = this.dbManager.getDatabase();

    this.config = {
      daysToAnalyze: 90,
      // 刚改过的笔记大概率还在编辑，等它停下来再索引，避免每次失焦都对半成品做摘要
      settleMinutes: 10,
      summarizeMinLength: 200,
      autoMigrateIntervalHours: 1,
    };

    this.userId = 'current_user';
    this._running = null;
  }

  /**
   * 引擎就绪后启动：立即索引一次，之后每小时一次
   */
  startAutoMigration(userId) {
    this.userId = userId;
    this.migrateAll(userId).catch(err => console.error('[Memory Index] 自动索引失败:', err));
    if (this.autoMigrateTimer) clearInterval(this.autoMigrateTimer);
    this.autoMigrateTimer = setInterval(() => {
      this.migrateAll(userId).catch(err => console.error('[Memory Index] 定时索引失败:', err));
    }, this.config.autoMigrateIntervalHours * 60 * 60 * 1000);
  }

  stopAutoMigration() {
    if (this.autoMigrateTimer) {
      clearInterval(this.autoMigrateTimer);
      this.autoMigrateTimer = null;
    }
    this.cancelBackgroundMigration();
  }

  /**
   * 应用进入后台时触发（延迟 20 秒执行）
   */
  triggerMigrationOnBackground() {
    if (!this.mem0Service?.isAvailable()) return;
    this.cancelBackgroundMigration();
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = null;
      this.migrateAll(this.userId).catch(err => console.error('[Memory Index] 后台索引失败:', err));
    }, 20 * 1000);
  }

  /**
   * 应用返回前台时取消后台索引
   */
  cancelBackgroundMigration() {
    if (this.backgroundTimer) {
      clearTimeout(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  /**
   * 增量索引笔记和待办，并做一次生命周期清理。同一时间只有一个在跑，重复调用拿到同一个结果。
   * @returns {Promise<{success: boolean, memoryCount: number, updatedCount: number, skippedCount: number, errors: string[]}>}
   */
  migrateAll(userId = this.userId) {
    if (!this.mem0Service?.isAvailable()) {
      return Promise.resolve({
        success: false, skipped: true, error: '记忆引擎未就绪',
        memoryCount: 0, updatedCount: 0, skippedCount: 0, errors: [],
      });
    }
    if (!this._running) {
      this._running = this._run(userId).finally(() => { this._running = null; });
    }
    return this._running;
  }

  /** @private */
  async _run(userId) {
    const results = { memoryCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };
    try {
      for (const sync of [() => this._syncNotes(userId), () => this._syncTodos(userId)]) {
        const r = await sync();
        results.memoryCount += r.added;
        results.updatedCount += r.updated;
        results.skippedCount += r.skipped;
        results.errors.push(...r.errors);
      }

      try {
        await this.mem0Service.cleanupMemories(userId);
      } catch (cleanupErr) {
        console.warn('[Memory Index] 记忆清理失败（非致命）:', cleanupErr.message);
      }

      this.mem0Service.setSetting('index_last_run', Date.now());
      if (results.memoryCount || results.updatedCount || results.errors.length) {
        console.log(`[Memory Index] 新增 ${results.memoryCount}，更新 ${results.updatedCount}，未变化 ${results.skippedCount}，失败 ${results.errors.length}`);
      }
      return { success: true, ...results };
    } catch (error) {
      console.error('[Memory Index] 索引失败:', error);
      return { success: false, ...results, errors: [...results.errors, error.message] };
    }
  }

  // ========== 笔记 ==========

  /** @private */
  async _syncNotes(userId) {
    const notes = this.db.prepare(`
      SELECT id, title, content, tags, note_type, created_at, updated_at
      FROM notes
      WHERE (is_deleted = 0 OR is_deleted IS NULL)
        AND length(content) > 1
        AND (updated_at >= datetime('now', ?) OR created_at >= datetime('now', ?))
      ORDER BY updated_at DESC
    `).all(`-${this.config.daysToAnalyze} days`, `-${this.config.daysToAnalyze} days`);

    const index = this.mem0Service.getSourceIndex(userId, 'note:');
    const settleBefore = Date.now() - this.config.settleMinutes * 60 * 1000;
    const r = { added: 0, updated: 0, skipped: 0, errors: [] };

    for (const note of notes) {
      const key = `note:${note.id}`;
      const hash = this._hash(note.title, note.content, note.tags);
      const indexed = index.get(key);
      if (indexed?.metadata?.source_hash === hash) { r.skipped++; continue; }
      if (this._adoptLegacy(indexed, note.updated_at, hash)) { r.skipped++; continue; }
      if (this._parseDbTime(note.updated_at) > settleBefore) { r.skipped++; continue; }

      try {
        const text = await this._noteToMemoryText(note);
        if (!text) { r.skipped++; continue; }
        const tags = note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const res = await this.mem0Service.upsertSourceMemory(userId, key, text, {
          category: 'knowledge',
          memoryLayer: 'artifact',
          source: 'user_note',
          metadata: {
            source: 'user_note',
            note_id: note.id,
            note_type: note.note_type || 'markdown',
            title: note.title || '',
            tags,
            created_at: note.created_at,
            source_updated_at: note.updated_at,
            source_hash: hash,
          },
        });
        if (res.added) r.added++;
        else if (res.updated) r.updated++;
        else r.skipped++;
      } catch (err) {
        r.errors.push(`note ${note.id}: ${err.message}`);
        console.error(`[Memory Index] 笔记 ${note.id} 索引失败:`, err.message);
      }
    }
    return r;
  }

  /** 笔记 → 记忆文本：标题 + 正文（长文用 LLM 摘要，画布提取文字和连线） @private */
  async _noteToMemoryText(note) {
    let body;
    if (note.note_type === 'whiteboard') {
      try {
        body = this._extractWhiteboardKnowledge(note.content);
      } catch (e) {
        return null;
      }
      if (!body) return null;
    } else {
      body = this._toPlainText(note.content);
      if (body.length >= this.config.summarizeMinLength) body = await this._summarizeNote(body);
    }
    const title = (note.title || '').trim();
    return title && !body.startsWith(title) ? `${title}\n${body}` : body;
  }

  /** 去掉 HTML 标签、图片和 data URI，只留可读文字 @private */
  _toPlainText(content) {
    return String(content || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 从画布 Excalidraw 数据中提取文字和连线关系，没有文字返回 null
   * @private
   */
  _extractWhiteboardKnowledge(jsonContent) {
    const whiteboardData = JSON.parse(jsonContent);
    if (!Array.isArray(whiteboardData?.elements)) return null;

    const textElements = [];
    const relationships = [];
    const elementById = new Map();
    for (const el of whiteboardData.elements) {
      if (el.isDeleted) continue;
      elementById.set(el.id, el);
      if (el.type === 'text' && el.text && el.text.trim()) textElements.push(el.text.trim());
    }
    for (const el of whiteboardData.elements) {
      if (el.isDeleted || (el.type !== 'arrow' && el.type !== 'line')) continue;
      const startText = this._getElementText(elementById.get(el.startBinding?.elementId), elementById);
      const endText = this._getElementText(elementById.get(el.endBinding?.elementId), elementById);
      if (startText && endText) relationships.push(`${startText} → ${endText}`);
    }
    if (textElements.length === 0 && relationships.length === 0) return null;

    const parts = [];
    if (textElements.length > 0) parts.push(textElements.join('\n'));
    if (relationships.length > 0) parts.push('关系: ' + relationships.join('; '));
    return parts.join('\n');
  }

  /** @private */
  _getElementText(el, elementById) {
    if (!el) return null;
    if (el.type === 'text' && el.text) return el.text.trim();
    for (const bound of el.boundElements || []) {
      if (bound.type === 'text') {
        const textEl = elementById.get(bound.id);
        if (textEl?.text) return textEl.text.trim();
      }
    }
    return null;
  }

  /**
   * 用 LLM 将长笔记压缩为知识摘要；失败或未配置 AI 时截断
   * @private
   */
  async _summarizeNote(content) {
    const fallback = content.length > 800 ? content.substring(0, 800) + '...' : content;
    if (!this.aiService) return fallback;
    try {
      const result = await this.aiService.chat([{
        role: 'user',
        content: `请用1-3句话概括以下笔记的核心知识点，保留关键术语和结论，不要添加评论：\n\n${content.substring(0, 2000)}`
      }], { maxTokens: 300, temperature: 0.3 });
      const summary = result?.success && result.data?.content?.trim();
      if (summary && summary.length >= 10) return summary;
    } catch (e) {
      console.warn('[Memory Index] LLM 摘要失败，降级截断:', e.message);
    }
    return fallback;
  }

  // ========== 待办 ==========

  /** @private */
  async _syncTodos(userId) {
    const todos = this.db.prepare(`
      SELECT id, content, description, is_completed, is_important, is_urgent,
             due_date, completed_at, created_at, updated_at
      FROM todos
      WHERE (is_deleted = 0 OR is_deleted IS NULL)
        AND (updated_at >= datetime('now', ?) OR created_at >= datetime('now', ?))
      ORDER BY updated_at DESC
    `).all(`-${this.config.daysToAnalyze} days`, `-${this.config.daysToAnalyze} days`);

    const index = this.mem0Service.getSourceIndex(userId, 'todo:');
    const r = { added: 0, updated: 0, skipped: 0, errors: [] };

    for (const todo of todos) {
      if (!todo.content || todo.content.trim().length < 5) { r.skipped++; continue; }
      const key = `todo:${todo.id}`;
      const hash = this._hash(todo.content, todo.description, todo.is_completed, todo.is_important,
        todo.is_urgent, todo.due_date, todo.completed_at);
      const indexed = index.get(key);
      if (indexed?.metadata?.source_hash === hash) { r.skipped++; continue; }
      if (this._adoptLegacy(indexed, todo.updated_at, hash)) { r.skipped++; continue; }

      try {
        const { text, onTimeStatus } = this._todoToMemoryText(todo);
        const res = await this.mem0Service.upsertSourceMemory(userId, key, text, {
          category: 'knowledge',
          memoryLayer: 'artifact',
          source: 'user_todo',
          metadata: {
            source: 'user_todo',
            todo_id: todo.id,
            is_completed: todo.is_completed,
            is_important: todo.is_important,
            is_urgent: todo.is_urgent,
            completed_on_time: onTimeStatus,
            created_at: todo.created_at,
            source_updated_at: todo.updated_at,
            source_hash: hash,
          },
        });
        if (res.added) r.added++;
        else if (res.updated) r.updated++;
        else r.skipped++;
      } catch (err) {
        r.errors.push(`todo ${todo.id}: ${err.message}`);
        console.error(`[Memory Index] 待办 ${todo.id} 索引失败:`, err.message);
      }
    }
    return r;
  }

  /** @private */
  _todoToMemoryText(todo) {
    const priorityText = todo.is_important && todo.is_urgent ? '紧急重要' :
      todo.is_important ? '重要' : todo.is_urgent ? '紧急' : '';
    const dueDateText = todo.due_date ? `截止于 ${new Date(todo.due_date).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    })}` : '';

    // null = 无截止日期或未完成
    let onTimeStatus = null;
    if (todo.is_completed && todo.due_date) {
      onTimeStatus = todo.completed_at ? new Date(todo.completed_at) <= new Date(todo.due_date) : true;
    }

    let text = `待办任务: ${todo.content}`;
    if (todo.description) text += `\n描述: ${this._toPlainText(todo.description)}`;
    if (priorityText) text += `\n优先级: ${priorityText}`;
    if (dueDateText) text += `\n${dueDateText}`;
    text += `\n状态: ${todo.is_completed ? '已完成' : '待处理'}`;
    if (onTimeStatus !== null) text += ` (${onTimeStatus ? '按时完成' : '逾期完成'})`;
    return { text, onTimeStatus };
  }

  // ========== 工具 ==========

  /**
   * 旧版索引没记内容哈希。原文在记忆写入之后没改过，就直接认领这条旧记忆（补上哈希），
   * 不重新生成——否则升级后第一次运行会把所有笔记重新摘要一遍，产生大量 LLM 调用。
   * @private
   */
  _adoptLegacy(indexed, sourceUpdatedAt, hash) {
    if (!indexed || indexed.metadata?.source_hash) return false;
    if (this._parseDbTime(sourceUpdatedAt) > (indexed.updatedAt || 0)) return false;
    this.mem0Service.mergeMemoryMetadata(indexed.id, { source_hash: hash, source_updated_at: sourceUpdatedAt });
    return true;
  }

  /** @private */
  _hash(...parts) {
    return crypto.createHash('sha1').update(parts.map(p => String(p ?? '')).join('\u0001')).digest('hex').slice(0, 16);
  }

  /** SQLite CURRENT_TIMESTAMP 是 UTC 的 'YYYY-MM-DD HH:MM:SS' @private */
  _parseDbTime(value) {
    if (!value) return 0;
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  }
}

module.exports = HistoricalDataMigrationService;
