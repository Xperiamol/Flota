/**
 * Mem0 知识管理服务 - v3 (四层架构)
 * 
 * 架构:
 * ┌─ 写入层 (Gatekeeper)  → 去重、价值判定、分类路由
 * ├─ 存储层 (Store)       → BLOB 向量 + FTS5 关键词 + 替代链
 * ├─ 检索层 (Retrieval)   → 混合召回(向量+关键词) + 多因子重排
 * └─ 治理层 (Governance)  → TTL 衰减、冷存归档、膨胀监控
 * 
 * 记忆分层:
 *   profile   → 用户稳定偏好与约束 (语言、风格、习惯)
 *   semantic  → 事实和知识片段 (项目规则、术语、笔记知识)
 *   episodic  → 任务过程与阶段结论 (发布踩坑、修复路径)
 *   artifact  → 笔记/待办/画布的结构化抽取
 * 
 * 技术栈：
 * - @xenova/transformers: 纯 JS 向量化模型 (384维)
 * - better-sqlite3: SQLite + FTS5
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// ── 记忆分层配置 ──────────────────────────────────
const MEMORY_LAYERS = {
  profile:  { maxCount: 50,   maxContentLen: 500,  ttlDays: null,   importance: 1.0 },
  semantic: { maxCount: 1000, maxContentLen: 1000,  ttlDays: null,   importance: 0.8 },
  episodic: { maxCount: 300,  maxContentLen: 500,   ttlDays: 180,    importance: 0.6 },
  artifact: { maxCount: 2000, maxContentLen: 1000,  ttlDays: 365,    importance: 0.7 },
};

// 旧分类到新分层的映射（向后兼容）
const CATEGORY_TO_LAYER = {
  preference: 'profile', fact: 'profile', habit: 'profile',
  knowledge: 'artifact', note_taking: 'artifact',
  task_planning: 'episodic',
  general: 'semantic',
};

const DEFAULT_LAYER = 'semantic';

// 写入层 - 守门器参数
const DEDUP_THRESHOLD   = 0.90;  // 去重：向量相似度阈值
const MIN_CONTENT_LEN   = 5;     // 价值判定：最短有效内容
const MAX_SEARCH_CANDS  = 500;   // 检索层：向量候选集上限
const FTS_BOOST         = 0.15;  // 检索层：关键词命中加分

// 重排权重
const RANK_WEIGHTS = {
  relevance:  0.50,  // 向量相似度
  freshness:  0.20,  // 新鲜度
  importance: 0.15,  // 分层重要度
  credibility: 0.15, // 来源可信度
};

// 来源可信度评分
const SOURCE_CREDIBILITY = {
  user_manual: 1.0,     // 用户手动添加
  ai_extract:  0.8,     // AI 工具萃取
  user_note:   0.7,     // 笔记迁移
  user_todo:   0.6,     // 待办迁移
  historical_analysis: 0.5, // 历史分析
};

// 治理层 - 衰减参数
const DECAY_HALF_LIFE_DAYS = 90; // 半衰期：90天新鲜度减半

class Mem0Service extends EventEmitter {
  constructor(databasePath, appDataPath) {
    super();
    this.databasePath = databasePath;
    this.appDataPath = appDataPath;
    this.db = null;
    this.embedder = null;
    this.initialized = false;
    this.initializing = false;
    // 可观测指标
    this._metrics = { searches: 0, hits: 0, writes: 0, blocked: 0, deduped: 0 };
  }

  // ═══════════════════════════════════════════════════
  //  初始化
  // ═══════════════════════════════════════════════════

  async initialize() {
    if (this.initialized) return { success: true, message: 'Already initialized' };
    if (this.initializing) {
      console.log('[Mem0] Already initializing...');
      return { success: false, error: 'Initialization in progress' };
    }
    this.initializing = true;
    try {
      console.log('[Mem0] Starting initialization (v3 architecture)...');
      await this.initDatabase();
      await this.initEmbedder();
      this.initialized = true;
      this.initializing = false;
      console.log('[Mem0] Service initialized successfully');
      return { success: true };
    } catch (error) {
      this.initializing = false;
      console.error('[Mem0] Initialization failed:', error);
      return { success: false, error: error.message };
    }
  }

  async initDatabase() {
    try {
      const Database = require('better-sqlite3');
      if (!fs.existsSync(this.databasePath)) {
        throw new Error(`Database not found: ${this.databasePath}`);
      }
      this.db = new Database(this.databasePath);
      console.log('[Mem0] Database connected:', this.databasePath);

      // 主表（保留旧结构兼容）
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS mem0_memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding TEXT,
          metadata TEXT,
          category TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // v3 Schema 迁移
      this._migrateSchemaV3();

      // 索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mem0_user_id ON mem0_memories(user_id);
        CREATE INDEX IF NOT EXISTS idx_mem0_category ON mem0_memories(category);
        CREATE INDEX IF NOT EXISTS idx_mem0_created_at ON mem0_memories(created_at);
        CREATE INDEX IF NOT EXISTS idx_mem0_user_category_time
          ON mem0_memories(user_id, category, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mem0_user_type
          ON mem0_memories(user_id, memory_type);
        CREATE INDEX IF NOT EXISTS idx_mem0_user_layer
          ON mem0_memories(user_id, memory_layer, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mem0_superseded
          ON mem0_memories(superseded_by);
      `);

      // FTS5 全文搜索索引（v3 新增）
      this._initFts();

      // 后台迁移旧的 JSON embedding → BLOB
      this._backfillBlobEmbeddings();

      console.log('[Mem0] Database tables initialized (v3)');

    } catch (error) {
      console.error('[Mem0] Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * 初始化 FTS5 索引（带自动修复）
   * 使用独立的 FTS 表（非 content-sync），避免数据不一致导致 SQLITE_CORRUPT_VTAB
   * @private
   */
  _initFts() {
    this._ftsAvailable = false;
    try {
      // 先检查是否有旧的 content-sync FTS 表（会导致 CORRUPT_VTAB）
      // 如果有，直接删掉重建
      try {
        const ftsInfo = this.db.prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='mem0_fts'`
        ).get();
        if (ftsInfo && ftsInfo.sql && ftsInfo.sql.includes("content='mem0_memories'")) {
          console.log('[Mem0] Dropping old content-sync FTS table (causes CORRUPT_VTAB)...');
          this.db.exec(`DROP TRIGGER IF EXISTS mem0_fts_insert`);
          this.db.exec(`DROP TRIGGER IF EXISTS mem0_fts_delete`);
          this.db.exec(`DROP TRIGGER IF EXISTS mem0_fts_update`);
          this.db.exec(`DROP TABLE IF EXISTS mem0_fts`);
        }
      } catch (_) {}

      // 验证现有 FTS 表是否可用
      try {
        const exists = this.db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='mem0_fts'`
        ).get();
        if (exists) {
          // 尝试读取，检测是否损坏
          this.db.prepare(`SELECT COUNT(*) as c FROM mem0_fts`).get();
          this._ftsAvailable = true;
          console.log('[Mem0] FTS5 index OK');
          return;
        }
      } catch (e) {
        // FTS 表损坏，删掉重建
        console.warn('[Mem0] FTS5 index corrupted, rebuilding...', e.message);
        try {
          this.db.exec(`DROP TRIGGER IF EXISTS mem0_fts_insert`);
          this.db.exec(`DROP TRIGGER IF EXISTS mem0_fts_delete`);
          this.db.exec(`DROP TRIGGER IF EXISTS mem0_fts_update`);
          this.db.exec(`DROP TABLE IF EXISTS mem0_fts`);
        } catch (_) {}
      }

      // 创建独立 FTS 表（不绑定 content 源，避免 CORRUPT_VTAB）
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS mem0_fts USING fts5(
          content,
          tokenize='unicode61'
        )
      `);

      // 从主表填充 FTS
      const mainCount = this.db.prepare('SELECT COUNT(*) as c FROM mem0_memories').get();
      if (mainCount.c > 0) {
        console.log(`[Mem0] Populating FTS index from ${mainCount.c} records...`);
        this.db.exec(`
          INSERT INTO mem0_fts(rowid, content)
          SELECT id, content FROM mem0_memories
        `);
      }

      this._ftsAvailable = true;
      console.log('[Mem0] FTS5 index created (standalone mode)');
    } catch (ftsErr) {
      console.warn('[Mem0] FTS5 not available, vector-only search:', ftsErr.message);
      this._ftsAvailable = false;
    }
  }

  /**
   * v3 Schema 迁移
   * @private
   */
  _migrateSchemaV3() {
    try {
      const cols = this.db.pragma('table_info(mem0_memories)');
      const colNames = cols.map(c => c.name);

      const addColumn = (name, type, defaultVal) => {
        if (!colNames.includes(name)) {
          const def = defaultVal !== undefined ? ` DEFAULT ${defaultVal}` : '';
          console.log(`[Mem0] Schema v3: adding column ${name}`);
          this.db.exec(`ALTER TABLE mem0_memories ADD COLUMN ${name} ${type}${def}`);
        }
      };

      // v2 列（向后兼容）
      addColumn('embedding_blob', 'BLOB');
      addColumn('memory_type', 'TEXT', "'knowledge'");
      addColumn('access_count', 'INTEGER', '0');
      addColumn('last_accessed_at', 'INTEGER');

      // v3 新增列
      addColumn('memory_layer', 'TEXT', "'semantic'");   // 分层: profile/semantic/episodic/artifact
      addColumn('source', 'TEXT', "'unknown'");           // 来源标识
      addColumn('superseded_by', 'INTEGER');              // 替代链: 被哪条新记忆替代
      addColumn('importance_score', 'REAL', '0.5');       // 重要度评分 [0,1]

    } catch (error) {
      console.warn('[Mem0] Schema v3 migration warning:', error.message);
    }
  }

  /**
   * 将旧 JSON embedding 批量转 BLOB
   * @private
   */
  _backfillBlobEmbeddings() {
    try {
      const rows = this.db.prepare(
        `SELECT id, embedding FROM mem0_memories
         WHERE embedding IS NOT NULL AND embedding_blob IS NULL LIMIT 200`
      ).all();
      if (rows.length === 0) return;

      console.log(`[Mem0] Backfilling ${rows.length} embeddings to BLOB...`);
      const stmt = this.db.prepare('UPDATE mem0_memories SET embedding_blob = ? WHERE id = ?');
      const batch = this.db.transaction(items => {
        for (const item of items) {
          try {
            const blob = Buffer.from(new Float32Array(JSON.parse(item.embedding)).buffer);
            stmt.run(blob, item.id);
          } catch (_) {}
        }
      });
      batch(rows);

      const remaining = this.db.prepare(
        `SELECT COUNT(*) as cnt FROM mem0_memories WHERE embedding IS NOT NULL AND embedding_blob IS NULL`
      ).get();
      if (remaining.cnt > 0) console.log(`[Mem0] ${remaining.cnt} embeddings still pending BLOB migration`);
    } catch (error) {
      console.warn('[Mem0] BLOB backfill warning:', error.message);
    }
  }

  /**
   * 同步 FTS 索引（手动同步，因为不使用触发器）
   * @private
   */
  _ftsInsert(id, content) {
    if (!this._ftsAvailable) return;
    try {
      this.db.prepare('INSERT INTO mem0_fts(rowid, content) VALUES (?, ?)').run(id, content);
    } catch (_) {}
  }

  _ftsDelete(id, content) {
    if (!this._ftsAvailable) return;
    try {
      this.db.prepare('DELETE FROM mem0_fts WHERE rowid = ?').run(id);
    } catch (_) {}
  }

  _ftsUpdate(id, oldContent, newContent) {
    if (!this._ftsAvailable) return;
    try {
      this.db.prepare('DELETE FROM mem0_fts WHERE rowid = ?').run(id);
      this.db.prepare('INSERT INTO mem0_fts(rowid, content) VALUES (?, ?)').run(id, newContent);
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════
  //  向量化模型
  // ═══════════════════════════════════════════════════

  async initEmbedder() {
    try {
      console.log('[Mem0] Loading embedding model...');
      const transformers = await import('@xenova/transformers');
      const { pipeline, env } = transformers;

      let modelsPath;
      let localFilesOnly = false;
      let isPackaged = false;
      let isStandaloneMCP = false;

      try {
        const { app } = require('electron');
        isPackaged = app && app.isPackaged;
      } catch (e) {
        isStandaloneMCP = __dirname.includes('mcp-server') && (
          __dirname.includes(path.join('AppData', 'Roaming', 'Flota')) ||
          __dirname.includes(path.join('Application Support', 'Flota')) ||
          __dirname.includes(path.join('.config', 'Flota'))
        );
        isPackaged = __dirname.includes('app.asar') && !isStandaloneMCP;
      }

      if (isPackaged) {
        try {
          require('electron');
          modelsPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'models');
        } catch (_) {
          modelsPath = path.join(__dirname, '..', '..', 'models');
        }
        localFilesOnly = true;
      } else if (isStandaloneMCP) {
        modelsPath = path.join(this.appDataPath, 'models');
      } else {
        const projModels = path.join(__dirname, '..', '..', 'models');
        if (fs.existsSync(path.join(projModels, 'Xenova', 'all-MiniLM-L6-v2'))) {
          modelsPath = projModels;
          localFilesOnly = true;
        } else {
          modelsPath = path.join(this.appDataPath, 'models');
        }
      }

      env.cacheDir = modelsPath;
      env.localModelPath = modelsPath;
      env.allowRemoteModels = !localFilesOnly;
      env.allowLocalModels = true;
      console.log(`[Mem0] Models: ${modelsPath} (local_only=${localFilesOnly})`);

      this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        local_files_only: localFilesOnly
      });
      console.log('[Mem0] Embedding model loaded');
    } catch (error) {
      console.error('[Mem0] Failed to load embedding model:', error);
      if (error.message?.includes('local_files_only')) {
        console.error('[Mem0] Run: npm run pre-build');
      }
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════
  //  向量工具
  // ═══════════════════════════════════════════════════

  async textToVector(text) {
    if (!this.embedder) throw new Error('Embedder not initialized');
    const output = await this.embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  vectorToBlob(vec)  { return Buffer.from(new Float32Array(vec).buffer); }
  blobToVector(blob) { return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4); }

  cosineSimilarity(a, b) {
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0, len = a.length; i < len; i++) {
      dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i];
    }
    const d = Math.sqrt(nA) * Math.sqrt(nB);
    return d === 0 ? 0 : dot / d;
  }

  // ═══════════════════════════════════════════════════
  //  写入层 - 守门器 (Gatekeeper)
  // ═══════════════════════════════════════════════════

  /**
   * 将 category 映射到 memory_layer
   * @private
   */
  _resolveLayer(category, options) {
    if (options.memoryLayer) return options.memoryLayer;
    return CATEGORY_TO_LAYER[category] || DEFAULT_LAYER;
  }

  /**
   * 获取分层配置
   * @private
   */
  _getLayerConfig(layer) {
    return MEMORY_LAYERS[layer] || MEMORY_LAYERS.semantic;
  }

  /**
   * 价值判定 - 过滤无价值内容
   * @private
   * @returns {string|null} 拒绝原因，null 表示通过
   */
  _gateValueCheck(content) {
    if (!content || content.trim().length < MIN_CONTENT_LEN) return 'too_short';
    // 纯标点/数字/空白
    if (/^[\s\d\p{P}]+$/u.test(content.trim())) return 'no_semantic_value';
    return null;
  }

  /**
   * 推算来源可信度
   * @private
   */
  _resolveSource(options) {
    if (options.source) return options.source;
    const meta = options.metadata || {};
    return meta.source || 'user_manual';
  }

  /**
   * 截断内容到分层允许的最大长度
   * @private
   */
  _truncateContent(content, layer) {
    const cfg = this._getLayerConfig(layer);
    if (content.length > cfg.maxContentLen) {
      return content.substring(0, cfg.maxContentLen) + '...';
    }
    return content;
  }

  /**
   * 去重检查 + 替代链构建
   * @private
   * @returns {{ id, content, score } | null}
   */
  async _findDuplicate(userId, embedding, layer, category) {
    try {
      const rows = this.db.prepare(`
        SELECT id, content, embedding_blob, embedding
        FROM mem0_memories
        WHERE user_id = ? AND (memory_layer = ? OR category = ?)
          AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 100
      `).all(userId, layer, category);

      for (const row of rows) {
        let vec;
        if (row.embedding_blob) vec = this.blobToVector(row.embedding_blob);
        else if (row.embedding) { try { vec = JSON.parse(row.embedding); } catch (_) { continue; } }
        else continue;

        const score = this.cosineSimilarity(embedding, vec);
        if (score >= DEDUP_THRESHOLD) {
          return { id: row.id, content: row.content, score };
        }
      }
      return null;
    } catch (error) {
      console.warn('[Mem0] Dedup check warning:', error.message);
      return null;
    }
  }

  /**
   * 容量限制 - 淘汰最不重要的记忆
   * @private
   */
  _enforceCapacity(userId, layer) {
    const cfg = this._getLayerConfig(layer);
    try {
      const cnt = this.db.prepare(
        'SELECT COUNT(*) as c FROM mem0_memories WHERE user_id = ? AND memory_layer = ? AND superseded_by IS NULL'
      ).get(userId, layer);

      if (cnt.c >= cfg.maxCount) {
        const overflow = cnt.c - cfg.maxCount + 1;
        this.db.prepare(`
          DELETE FROM mem0_memories WHERE id IN (
            SELECT id FROM mem0_memories
            WHERE user_id = ? AND memory_layer = ? AND superseded_by IS NULL
            ORDER BY importance_score ASC, access_count ASC, created_at ASC
            LIMIT ?
          )
        `).run(userId, layer, overflow);
        console.log(`[Mem0] Capacity: evicted ${overflow} from "${layer}"`);
      }
    } catch (error) {
      console.warn('[Mem0] Capacity enforcement warning:', error.message);
    }
  }

  /**
   * 添加记忆 - 主入口（经过完整守门器）
   */
  async addMemory(userId, content, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');

    try {
      const category = options.category || 'general';
      const layer = this._resolveLayer(category, options);
      const source = this._resolveSource(options);

      // ── 守门器 ──
      // 1. 价值判定
      const rejectReason = this._gateValueCheck(content);
      if (rejectReason) {
        console.log(`[Mem0] Write blocked (${rejectReason}):`, content.substring(0, 30));
        this._metrics.blocked++;
        return { success: false, blocked: true, reason: rejectReason };
      }

      // 2. 截断
      const finalContent = this._truncateContent(content.trim(), layer);

      console.log('[Mem0] Adding memory:', { userId, len: finalContent.length, layer, category });

      // 3. 向量化
      const embedding = await this.textToVector(finalContent);
      const blob = this.vectorToBlob(embedding);

      // 4. 去重 + 替代链
      const dup = await this._findDuplicate(userId, embedding, layer, category);
      if (dup) {
        this._metrics.deduped++;
        console.log(`[Mem0] Duplicate (score=${(dup.score * 100).toFixed(1)}%), id=${dup.id}`);
        // 如果新内容更优（更长/更新），创建新记忆并标记旧记忆被替代
        if (finalContent.length > dup.content.length) {
          const newId = this._insertMemory(userId, finalContent, embedding, blob, category, layer, source, options);
          // 替代链：旧记忆指向新记忆
          this.db.prepare('UPDATE mem0_memories SET superseded_by = ? WHERE id = ?').run(newId, dup.id);
          console.log(`[Mem0] Superseded: ${dup.id} → ${newId}`);
          return { success: true, id: newId, superseded: dup.id, embedding_dim: embedding.length };
        }
        // 旧记忆更优，仅更新 access 时间
        this.db.prepare('UPDATE mem0_memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
          .run(Date.now(), dup.id);
        return { success: true, id: dup.id, deduplicated: true, embedding_dim: embedding.length };
      }

      // 5. 容量限制
      this._enforceCapacity(userId, layer);

      // 6. 写入
      const newId = this._insertMemory(userId, finalContent, embedding, blob, category, layer, source, options);
      this._metrics.writes++;

      return { success: true, id: newId, embedding_dim: embedding.length };

    } catch (error) {
      console.error('[Mem0] Add memory failed:', error);
      throw error;
    }
  }

  /**
   * 底层 INSERT
   * @private
   */
  _insertMemory(userId, content, embedding, blob, category, layer, source, options) {
    const now = Date.now();
    const importance = this._getLayerConfig(layer).importance;
    const result = this.db.prepare(`
      INSERT INTO mem0_memories
        (user_id, content, embedding, embedding_blob, metadata, category,
         memory_type, memory_layer, source, importance_score,
         created_at, updated_at, access_count, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      userId, content, JSON.stringify(embedding), blob,
      JSON.stringify(options.metadata || {}), category,
      options.memoryType || layer, layer, source, importance,
      now, now, now
    );
    console.log('[Mem0] Memory added:', result.lastInsertRowid);
    // 同步 FTS 索引
    this._ftsInsert(result.lastInsertRowid, content);
    return result.lastInsertRowid;
  }

  // ═══════════════════════════════════════════════════
  //  检索层 - 混合召回 + 多因子重排
  // ═══════════════════════════════════════════════════

  /**
   * 语义搜索（v3：混合召回 + 多因子重排 + token 预算）
   */
  async searchMemories(userId, query, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');

    try {
      const topK = options.limit || 5;
      const category = options.category;
      const minScore = options.threshold || options.minScore || 0.3;
      const maxTokenBudget = options.maxTokens || 2000; // token 预算

      this._metrics.searches++;
      console.log('[Mem0] Searching:', { userId, query, topK, category });

      // 1. 向量化查询
      const queryVec = await this.textToVector(query);

      // 2. 向量候选集（预过滤 + LIMIT）
      let sql = `
        SELECT id, content, embedding_blob, embedding, metadata, category,
               memory_layer, source, importance_score, access_count,
               created_at, last_accessed_at
        FROM mem0_memories
        WHERE user_id = ? AND superseded_by IS NULL
      `;
      const params = [userId];
      if (category) { sql += ' AND category = ?'; params.push(category); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(MAX_SEARCH_CANDS);

      const vecCandidates = this.db.prepare(sql).all(...params);

      // 3. FTS / LIKE 关键词候选集 (JS直接扫描 + DB深度兜底)
      const hitMap = new Map(); // id -> matchCount
      try {
        const queryClean = query.replace(/[^\w\u4e00-\u9fff\s]/g, ' ').trim();
        const tokens = queryClean.split(/\s+/).filter(t => t.length > 0);
        
        if (tokens.length > 0) {
          // JS 强力匹配 vecCandidates (解决中文没有空格导致 FTS 分词失败的问题)
          vecCandidates.forEach(row => {
            let mCount = 0;
            const contentLower = row.content ? row.content.toLowerCase() : '';
            for (const t of tokens) {
              if (contentLower.includes(t.toLowerCase())) {
                mCount++;
              }
            }
            if (mCount > 0) {
              hitMap.set(row.id, mCount);
            }
          });
          
          // 如果近期 500 条一条都没命中，则进行全库深度兜底（使用 LIKE AND，因为如果用 OR 会太多）
          // 但是如果是极短查询（只有一个词），也可以只查那一个词
          if (hitMap.size === 0) {
             const likeParams = [userId];
             let likeSql = `SELECT id FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL AND (`;
             
             // 使用 AND 强制全部词必须出现
             const likeClauses = tokens.map(t => {
                likeParams.push(`%${t}%`);
                return `content LIKE ?`;
             });
             likeSql += likeClauses.join(' AND ') + `)`;

             if (category) { likeSql += ' AND category = ?'; likeParams.push(category); }
             likeSql += ' LIMIT 50';
             
             const likeRows = this.db.prepare(likeSql).all(...likeParams);
             likeRows.forEach(r => {
                hitMap.set(r.id, tokens.length);
                // 把深层找出的 row 追加到 vecCandidates 参与后续向量与打分
                if (!vecCandidates.find(v => v.id === r.id)) {
                   const fullRow = this.db.prepare(
                     `SELECT id, content, embedding_blob, embedding, metadata, category,
                             memory_layer, source, importance_score, access_count,
                             created_at, last_accessed_at
                      FROM mem0_memories WHERE id = ?`
                   ).get(r.id);
                   if (fullRow) vecCandidates.push(fullRow);
                }
             });
          }
        }
      } catch (e) {
        console.warn('[Mem0] Keyword search fallback warning:', e.message);
      }

      console.log('[Mem0] Candidates: vec=' + vecCandidates.length + ', textHit=' + hitMap.size);

      // 4. 计算向量相似度
      const now = Date.now();
      const scored = vecCandidates
        .map(row => {
          let vec;
          if (row.embedding_blob) vec = this.blobToVector(row.embedding_blob);
          else if (row.embedding) { try { vec = JSON.parse(row.embedding); } catch (_) { return null; } }
          else return null;

          const vecScore = this.cosineSimilarity(queryVec, vec);
          const matchCount = hitMap.get(row.id) || 0;
          const isTextHit = matchCount > 0;
          
          // 如果没有确切的文本匹配，且向量低于预剪枝下限(比如0.21)，抛弃
          if (!isTextHit && vecScore < minScore * 0.7) return null; 

          return { ...row, vecScore, isTextHit, matchCount, metadata: JSON.parse(row.metadata || '{}') };
        })
        .filter(Boolean);

      // 5. 多因子重排
      const ranked = scored.map(item => {
        // 如果文本直接匹配，但向量匹配的分数极低（例如跨语种或分词极化），我们依然给一个基础的 relevance
        const relevance = Math.max(item.vecScore, item.isTextHit ? 0.5 : 0);

        // 新鲜度衰减 (半衰期模型)
        const ageDays = (now - item.created_at) / (86400000);
        const freshness = Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);

        // 分层重要度
        const importance = item.importance_score || MEMORY_LAYERS[item.memory_layer]?.importance || 0.5;

        // 来源可信度
        const credibility = SOURCE_CREDIBILITY[item.source] || 0.5;

        // 文本匹配极其重要，每命中一个查询词增加显著分数
        const textBonus = item.matchCount * 0.25;

        // 综合评分
        const finalScore =
          RANK_WEIGHTS.relevance   * relevance +
          RANK_WEIGHTS.freshness   * freshness +
          RANK_WEIGHTS.importance  * importance +
          RANK_WEIGHTS.credibility * credibility +
          textBonus;

        return {
          id: item.id,
          content: item.content,
          score: finalScore,
          vecScore: relevance,
          metadata: item.metadata,
          category: item.category,
          memory_layer: item.memory_layer,
          source: item.source,
          created_at: item.created_at
        };
      });

      // 6. 排序 + topK
      ranked.sort((a, b) => b.score - a.score);

      // 7. Token 预算截断
      const results = [];
      let tokenUsed = 0;
      for (const item of ranked) {
        if (results.length >= topK) break;
        const estimatedTokens = Math.ceil(item.content.length / 2); // 粗估中文2字符=1token
        if (tokenUsed + estimatedTokens > maxTokenBudget && results.length > 0) break;
        results.push(item);
        tokenUsed += estimatedTokens;
      }

      if (results.length > 0) {
        this._metrics.hits++;
        console.log('[Mem0] Top match:', {
          score: results[0].score.toFixed(3),
          vecScore: (results[0].vecScore * 100).toFixed(1) + '%',
          layer: results[0].memory_layer,
          preview: results[0].content.substring(0, 50)
        });
      }

      // 更新访问计数
      if (results.length > 0) {
        const updStmt = this.db.prepare(
          'UPDATE mem0_memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?'
        );
        for (const r of results) updStmt.run(now, r.id);
      }

      return results;

    } catch (error) {
      console.error('[Mem0] Search failed:', error);
      throw error;
    }
  }

  /**
   * 构建 FTS5 查询（将自然语言转为 OR 查询）
   * @private
   */
  _buildFtsQuery(query) {
    // 按空格拆分，过滤太短的词，但对于单字（中文等）使用 LIKE 兜底，因此 FTS 提供额外加权
    const tokens = query
      .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 1);
    
    if (tokens.length === 0) return `"${query.replace(/"/g, '')}"`;
    return tokens.map(t => `"${t}"`).join(' OR ');
  }

  /**
   * 获取 Profile 层记忆（始终注入 AI 上下文）
   */
  async getProfileMemories(userId) {
    if (!this.initialized) return [];
    try {
      const rows = this.db.prepare(`
        SELECT content, category, importance_score
        FROM mem0_memories
        WHERE user_id = ? AND memory_layer = 'profile' AND superseded_by IS NULL
        ORDER BY importance_score DESC, created_at DESC
        LIMIT 50
      `).all(userId);
      return rows;
    } catch (error) {
      console.warn('[Mem0] getProfileMemories failed:', error.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════
  //  基础 CRUD
  // ═══════════════════════════════════════════════════

  async getMemories(userId, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    try {
      const limit = options.limit || 50;
      const category = options.category;
      let sql = 'SELECT * FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL';
      const params = [userId];
      if (category) { sql += ' AND category = ?'; params.push(category); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const rows = this.db.prepare(sql).all(...params);
      return rows.map(row => ({
        id: row.id, content: row.content, metadata: JSON.parse(row.metadata || '{}'),
        category: row.category, memory_type: row.memory_type || 'knowledge',
        memory_layer: row.memory_layer || 'semantic',
        access_count: row.access_count || 0,
        created_at: row.created_at, updated_at: row.updated_at
      }));
    } catch (error) {
      console.error('[Mem0] Get memories failed:', error);
      throw error;
    }
  }

  async deleteMemory(memoryId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    try {
      this._ftsDelete(memoryId);
      const result = this.db.prepare('DELETE FROM mem0_memories WHERE id = ?').run(memoryId);
      return result.changes > 0;
    } catch (error) {
      console.error('[Mem0] Delete memory failed:', error);
      throw error;
    }
  }

  async updateMemory(memoryId, content, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    try {
      const old = this.db.prepare('SELECT category, memory_layer, metadata FROM mem0_memories WHERE id = ?').get(memoryId);
      if (!old) return { success: false, updated: false };

      const category = options.category || old.category;
      const layer = this._resolveLayer(category, { ...options, memoryLayer: options.memoryLayer || old.memory_layer });
      const metadataStr = JSON.stringify(options.metadata || JSON.parse(old.metadata || '{}'));

      const truncated = this._truncateContent(content, layer);
      const embedding = await this.textToVector(truncated);
      const blob = this.vectorToBlob(embedding);
      const now = Date.now();
      const result = this.db.prepare(`
        UPDATE mem0_memories
        SET content = ?, embedding = ?, embedding_blob = ?,
            metadata = ?, category = ?, memory_layer = ?, updated_at = ?
        WHERE id = ?
      `).run(truncated, JSON.stringify(embedding), blob, metadataStr, category, layer, now, memoryId);
      this._ftsUpdate(memoryId, null, truncated);
      return { success: true, id: memoryId, updated: result.changes > 0 };
    } catch (error) {
      console.error('[Mem0] Update memory failed:', error);
      throw error;
    }
  }

  async clearUserMemories(userId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    try {
      // 先清空 FTS 索引，避免 delete 触发 CORRUPT_VTAB
      if (this._ftsAvailable) {
        try {
          this.db.exec(`DELETE FROM mem0_fts`);
        } catch (e) {
          console.warn('[Mem0] FTS clear warning:', e.message);
        }
      }
      const result = this.db.prepare('DELETE FROM mem0_memories WHERE user_id = ?').run(userId);
      console.log('[Mem0] Cleared', result.changes, 'memories');
      return result.changes;
    } catch (error) {
      console.error('[Mem0] Clear memories failed:', error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════
  //  治理层 - 生命周期 + 质量 + 可观测
  // ═══════════════════════════════════════════════════

  /**
   * 记忆生命周期清理
   */
  async cleanupMemories(userId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    try {
      console.log('[Mem0] Governance: starting cleanup for', userId);
      let removed = 0;
      const now = Date.now();

      // 1. TTL 过期清理（按分层 TTL）
      for (const [layer, cfg] of Object.entries(MEMORY_LAYERS)) {
        if (!cfg.ttlDays) continue;
        const expiry = now - cfg.ttlDays * 86400000;
        const r = this.db.prepare(`
          DELETE FROM mem0_memories
          WHERE user_id = ? AND memory_layer = ?
            AND access_count < 3 AND created_at < ?
            AND (last_accessed_at IS NULL OR last_accessed_at < ?)
        `).run(userId, layer, expiry, expiry);
        if (r.changes > 0) {
          removed += r.changes;
          console.log(`[Mem0] TTL: removed ${r.changes} expired "${layer}" memories`);
        }
      }

      // 2. 清理被替代的旧记忆（替代链中的旧节点，保留30天后删除）
      const chainExpiry = now - 30 * 86400000;
      const chainResult = this.db.prepare(`
        DELETE FROM mem0_memories
        WHERE user_id = ? AND superseded_by IS NOT NULL AND updated_at < ?
      `).run(userId, chainExpiry);
      removed += chainResult.changes;
      if (chainResult.changes > 0) {
        console.log(`[Mem0] Chain: removed ${chainResult.changes} superseded memories`);
      }

      // 3. 冷存降级：将长期未访问的记忆降低重要度
      const coldThreshold = now - 90 * 86400000;
      this.db.prepare(`
        UPDATE mem0_memories
        SET importance_score = MAX(0.1, importance_score * 0.7)
        WHERE user_id = ? AND memory_layer != 'profile'
          AND (last_accessed_at IS NULL OR last_accessed_at < ?)
          AND importance_score > 0.2
      `).run(userId, coldThreshold);

      // 4. 孤儿笔记记忆清理
      try {
        const orphanResult = this.db.prepare(`
          DELETE FROM mem0_memories
          WHERE user_id = ?
            AND metadata LIKE '%"source":"user_note"%'
            AND CAST(json_extract(metadata, '$.note_id') AS INTEGER) NOT IN (
              SELECT id FROM notes WHERE is_deleted = 0 OR is_deleted IS NULL
            )
        `).run(userId);
        removed += orphanResult.changes;
        if (orphanResult.changes > 0) {
          console.log(`[Mem0] Orphan: removed ${orphanResult.changes} note memories`);
        }
      } catch (_) {}

      console.log(`[Mem0] Cleanup done: removed ${removed}`);
      return { removed, merged: 0 };
    } catch (error) {
      console.error('[Mem0] Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * 获取统计信息 + 可观测指标
   */
  async getStats(userId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    try {
      const total = this.db.prepare('SELECT COUNT(*) as c FROM mem0_memories WHERE user_id = ?').get(userId);
      const activeTotal = this.db.prepare(
        'SELECT COUNT(*) as c FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL'
      ).get(userId);

      // 按分层统计
      const layerRows = this.db.prepare(`
        SELECT memory_layer, COUNT(*) as count
        FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL
        GROUP BY memory_layer
      `).all(userId);

      const byLayer = {};
      for (const row of layerRows) {
        const layer = row.memory_layer || 'semantic';
        const cfg = MEMORY_LAYERS[layer] || MEMORY_LAYERS.semantic;
        byLayer[layer] = {
          count: row.count,
          limit: cfg.maxCount,
          usage: `${((row.count / cfg.maxCount) * 100).toFixed(0)}%`
        };
      }

      // 按旧分类统计（向后兼容）
      const catRows = this.db.prepare(`
        SELECT category, COUNT(*) as count
        FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL
        GROUP BY category
      `).all(userId);
      const byCategory = {};
      for (const row of catRows) {
        byCategory[row.category] = { count: row.count };
      }

      // BLOB 迁移进度
      const blobRow = this.db.prepare(`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN embedding_blob IS NOT NULL THEN 1 ELSE 0 END) as done
        FROM mem0_memories WHERE user_id = ?
      `).get(userId);

      // 替代链统计
      const supersededCount = this.db.prepare(
        'SELECT COUNT(*) as c FROM mem0_memories WHERE user_id = ? AND superseded_by IS NOT NULL'
      ).get(userId);

      return {
        total: total.c,
        active: activeTotal.c,
        superseded: supersededCount.c,
        by_layer: byLayer,
        by_category: byCategory,
        blob_migration: {
          total: blobRow.total, migrated: blobRow.done,
          progress: blobRow.total > 0 ? `${((blobRow.done / blobRow.total) * 100).toFixed(0)}%` : '100%'
        },
        metrics: { ...this._metrics,
          hit_rate: this._metrics.searches > 0
            ? `${((this._metrics.hits / this._metrics.searches) * 100).toFixed(0)}%` : 'N/A'
        }
      };
    } catch (error) {
      console.error('[Mem0] Stats failed:', error);
      throw error;
    }
  }

  /**
   * 批量补充向量
   */
  async backfillEmbeddings(userId = null) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    try {
      let sql = 'SELECT id, content FROM mem0_memories WHERE embedding IS NULL';
      const params = [];
      if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
      const rows = this.db.prepare(sql).all(...params);
      console.log('[Mem0] Backfilling', rows.length, 'memories');

      const stmt = this.db.prepare('UPDATE mem0_memories SET embedding = ?, embedding_blob = ? WHERE id = ?');
      let cnt = 0;
      for (const row of rows) {
        try {
          const vec = await this.textToVector(row.content);
          stmt.run(JSON.stringify(vec), this.vectorToBlob(vec), row.id);
          cnt++;
          if (cnt % 10 === 0) console.log('[Mem0] Backfilled', cnt, '/', rows.length);
        } catch (_) {}
      }
      console.log('[Mem0] Backfill done:', cnt);
      return cnt;
    } catch (error) {
      console.error('[Mem0] Backfill failed:', error);
      throw error;
    }
  }

  isAvailable() { return this.initialized && this.db !== null && this.embedder !== null; }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
    this.embedder = null;
    this.initialized = false;
    console.log('[Mem0] Service closed');
  }
}

module.exports = Mem0Service;
