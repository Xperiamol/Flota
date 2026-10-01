/**
 * Mem0 知识管理服务 - v4
 *
 * 架构:
 * ┌─ 写入层 (Gatekeeper)  → 价值判定、保守去重（近乎同文才合并）、来源绑定 upsert
 * ├─ 存储层 (Store)       → BLOB 向量（记录生成它的模型）+ 替代链 / 软删除
 * ├─ 检索层 (Retrieval)   → 全量向量 + 中文二元组关键词，有界打分，按层过滤
 * └─ 治理层 (Governance)  → TTL 衰减、替代链清理、孤儿（已删笔记 / 待办）清理
 *
 * 记忆分层:
 *   profile   → 用户稳定偏好与约束 (语言、风格、习惯)
 *   semantic  → 事实和知识片段 (项目、术语、背景)
 *   episodic  → 一段时间内的状况与阶段结论 (正在备考、发布踩坑)
 *   artifact  → 笔记 / 待办的索引（按 source_key 一一对应，随原文更新）
 *
 * 向量模型:
 *   默认用随包的 all-MiniLM-L6-v2（英文模型，中文区分度很差：
 *   「喜欢喝咖啡」和「喜欢跑步」相似度 0.98）。设置里可下载多语言模型，
 *   切换后后台把已有记忆重新向量化；每行记录 embedding_model，模型不一致的行
 *   在重算完成前只参与关键词召回，不和新模型的向量比较。
 *
 * 技术栈：
 * - @xenova/transformers: 纯 JS 向量化模型 (384维)
 * - better-sqlite3
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const Module = require('module');

// ── 记忆分层配置 ──────────────────────────────────
const MEMORY_LAYERS = {
  profile:  { maxCount: 50,   maxContentLen: 500,  ttlDays: null,   importance: 1.0 },
  semantic: { maxCount: 1000, maxContentLen: 1000, ttlDays: null,   importance: 0.8 },
  episodic: { maxCount: 300,  maxContentLen: 500,  ttlDays: 180,    importance: 0.6 },
  artifact: { maxCount: 2000, maxContentLen: 1000, ttlDays: 365,    importance: 0.7 },
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
const MIN_CONTENT_LEN = 5;      // 价值判定：最短有效内容
// 去重：向量相似 + 字面重合都要够高才算同一条。只看向量会把同句式的不同事实
// （「住在杭州」/「住在上海」）当成重复；只看字面又认不出语序调整。
const DEDUP_VECTOR_MIN = 0.90;
const DEDUP_BIGRAM_MIN = 0.60;
const MAX_SEARCH_CANDS = 5000;  // 检索层：候选上限（全量扫描的保险）
const DEFAULT_MIN_RELEVANCE = 0.15;

// 重排权重（相关度占大头；其余因子只用于同等相关时排序）
const RANK_WEIGHTS = {
  relevance:   0.70,
  freshness:   0.10,
  importance:  0.10,
  credibility: 0.10,
};

// 来源可信度评分
const SOURCE_CREDIBILITY = {
  user_manual: 1.0,          // 用户手动添加
  ai_auto:     0.85,         // 对话后自动提取
  ai_extract:  0.8,          // AI 工具写入（用户确认过）
  user_note:   0.7,          // 笔记索引
  user_todo:   0.6,          // 待办索引
  historical_analysis: 0.5,  // 旧版历史分析（已不再生成）
};

// 治理层 - 衰减参数
const DECAY_HALF_LIFE_DAYS = 90;
const CHAIN_RETENTION_DAYS = 30; // 被替代 / 软删除的记忆保留多久，期间可撤销

// 软删除标记：superseded_by = -1。所有读取都只看 superseded_by IS NULL。
const SOFT_DELETED = -1;

// ── 向量模型 ──────────────────────────────────────
const LEGACY_MODEL = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_MODELS = {
  [LEGACY_MODEL]: {
    label: '基础模型',
    description: '适合英文',
    bundled: true,
    sizeMB: 23,
    // 余弦相似度低于这个值视为噪声（中文无关句子在该模型上普遍有 0.3~0.5）
    vecFloor: 0.5,
    // 中文向量不可信：中文查询时向量分减半，主要靠关键词
    cjkReliable: false,
  },
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': {
    label: '多语言模型',
    description: '中文推荐',
    bundled: false,
    sizeMB: 130,
    vecFloor: 0.3,
    cjkReliable: true,
    files: ['config.json', 'tokenizer_config.json', 'tokenizer.json', 'onnx/model_quantized.onnx'],
  },
};
const MODEL_HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'];
const DOWNLOAD_HEADER_TIMEOUT_MS = 15000;

const REINDEX_BATCH = 16;

// ── 小工具 ────────────────────────────────────────

const normalizeText = (text) => String(text || '')
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');

// 关键词：拉丁词（≥2 字符）+ 中日韩连续字的二元组；单个汉字的片段保留单字
const keywordTerms = (text) => {
  const lower = String(text || '').toLowerCase();
  const terms = new Set();
  for (const word of lower.match(/[a-z0-9][a-z0-9_.-]+/g) || []) terms.add(word);
  for (const run of lower.match(/[㐀-鿿豈-﫿]+/g) || []) {
    if (run.length === 1) terms.add(run);
    for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
  }
  return [...terms].slice(0, 48);
};

const bigramSet = (text) => {
  const s = normalizeText(text);
  const set = new Set();
  if (s.length === 1) set.add(s);
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
};

const jaccard = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

const safeParse = (json, fallback = {}) => {
  try { return JSON.parse(json || ''); } catch (_) { return fallback; }
};

/**
 * @xenova/transformers 在顶层 import 了 sharp（只用于图片处理）。sharp 的原生模块
 * 一旦缺失或架构不符，整个 transformers 都加载失败，记忆功能也就整体不可用——
 * 而我们只用文本向量化。这里预先试加载 sharp，失败就放一个占位模块进 require 缓存，
 * ESM 加载器会复用已缓存的 CommonJS 模块。
 */
const makeSharpOptional = () => {
  try {
    const transformersEntry = require.resolve('@xenova/transformers');
    const sharpPath = Module.createRequire(transformersEntry).resolve('sharp');
    try {
      require(sharpPath);
    } catch (error) {
      const stub = new Module(sharpPath);
      stub.filename = sharpPath;
      stub.loaded = true;
      stub.exports = function sharpUnavailable() {
        throw new Error('sharp 不可用：当前环境不支持图片处理');
      };
      Module._cache[sharpPath] = stub;
      console.warn('[Mem0] sharp 加载失败，已替换为占位模块（不影响文本向量化）:', (error.message || '').split('\n')[0]);
    }
  } catch (_) {
    // 找不到 transformers / sharp 时交给后面的 import 报错
  }
};

class Mem0Service extends EventEmitter {
  /**
   * @param {string} databasePath
   * @param {string} appDataPath
   * @param {{ autoReindex?: boolean }} [options] autoReindex：换模型后是否在本进程后台重算向量
   *   （主进程开启；独立 MCP 进程不开，避免两个进程同时重算）
   */
  constructor(databasePath, appDataPath, options = {}) {
    super();
    this.databasePath = databasePath;
    this.appDataPath = appDataPath;
    this.autoReindex = !!options.autoReindex;
    this.db = null;
    this.embedder = null;
    this.activeModel = LEGACY_MODEL;
    this.initialized = false;
    this.initializing = false;
    this.state = 'idle'; // idle | loading | ready | failed
    this.lastError = null;
    this._reindex = null;   // { done, total } 进行中时有值
    this._download = null;  // { modelId, loaded, total, abort } 进行中时有值
    this._transformers = null;
    // 可观测指标
    this._metrics = { searches: 0, hits: 0, writes: 0, blocked: 0, deduped: 0 };
  }

  // ═══════════════════════════════════════════════════
  //  初始化
  // ═══════════════════════════════════════════════════

  async initialize() {
    if (this.initialized) return { success: true, message: 'Already initialized' };
    if (this.initializing) {
      return { success: false, error: 'Initialization in progress' };
    }
    this.initializing = true;
    this._setState('loading');
    try {
      console.log('[Mem0] Starting initialization (v4)...');
      if (!this.db) await this.initDatabase();
      this.activeModel = this._resolveStartupModel();
      this.embedder = await this._loadEmbedder(this.activeModel);
      this.initialized = true;
      this.initializing = false;
      this.lastError = null;
      this._setState('ready');
      console.log('[Mem0] Service initialized with', this.activeModel);
      if (this.autoReindex) this._startReindex();
      return { success: true };
    } catch (error) {
      this.initializing = false;
      // 有些原生模块错误的 message 是空串，退回到 toString，至少让日志里看得见原因
      this.lastError = (error && (error.message || String(error))) || '未知错误';
      this._setState('failed');
      console.error('[Mem0] Initialization failed:', error);
      return { success: false, error: this.lastError };
    }
  }

  async initDatabase() {
    const Database = require('better-sqlite3');
    if (!fs.existsSync(this.databasePath)) {
      throw new Error(`Database not found: ${this.databasePath}`);
    }
    this.db = new Database(this.databasePath);
    console.log('[Mem0] Database connected:', this.databasePath);

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
      );
      CREATE TABLE IF NOT EXISTS mem0_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    this._migrateSchema();

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
      CREATE INDEX IF NOT EXISTS idx_mem0_source_key
        ON mem0_memories(user_id, source_key);
    `);

    // v3 的 FTS5 索引一直在维护却从未被检索用到（中文分词也不可用），删掉
    try {
      this.db.exec(`
        DROP TRIGGER IF EXISTS mem0_fts_insert;
        DROP TRIGGER IF EXISTS mem0_fts_delete;
        DROP TRIGGER IF EXISTS mem0_fts_update;
        DROP TABLE IF EXISTS mem0_fts;
      `);
    } catch (e) {
      console.warn('[Mem0] Drop legacy FTS warning:', e.message);
    }

    this._backfillBlobEmbeddings();
    this._backfillSourceKeys();
    console.log('[Mem0] Database tables initialized (v4)');
  }

  /** @private */
  _migrateSchema() {
    try {
      const colNames = this.db.pragma('table_info(mem0_memories)').map(c => c.name);
      const addColumn = (name, type, defaultVal) => {
        if (!colNames.includes(name)) {
          const def = defaultVal !== undefined ? ` DEFAULT ${defaultVal}` : '';
          console.log(`[Mem0] Schema: adding column ${name}`);
          this.db.exec(`ALTER TABLE mem0_memories ADD COLUMN ${name} ${type}${def}`);
        }
      };
      // v2
      addColumn('embedding_blob', 'BLOB');
      addColumn('memory_type', 'TEXT', "'knowledge'");
      addColumn('access_count', 'INTEGER', '0');
      addColumn('last_accessed_at', 'INTEGER');
      // v3
      addColumn('memory_layer', 'TEXT', "'semantic'");
      addColumn('source', 'TEXT', "'unknown'");
      addColumn('superseded_by', 'INTEGER');
      addColumn('importance_score', 'REAL', '0.5');
      // v4
      addColumn('embedding_model', 'TEXT');   // 生成 embedding_blob 的模型；NULL = 旧版默认模型
      addColumn('source_key', 'TEXT');        // 来源对象：note:12 / todo:5，一个来源只对应一条记忆
    } catch (error) {
      console.warn('[Mem0] Schema migration warning:', error.message);
    }
  }

  /** 旧 JSON embedding → BLOB，并清掉已有 BLOB 的 JSON 副本（同一向量存了两份） @private */
  _backfillBlobEmbeddings() {
    try {
      const rows = this.db.prepare(
        `SELECT id, embedding FROM mem0_memories
         WHERE embedding IS NOT NULL AND embedding_blob IS NULL LIMIT 2000`
      ).all();
      if (rows.length > 0) {
        const stmt = this.db.prepare('UPDATE mem0_memories SET embedding_blob = ? WHERE id = ?');
        this.db.transaction(items => {
          for (const item of items) {
            try {
              stmt.run(Buffer.from(new Float32Array(JSON.parse(item.embedding)).buffer), item.id);
            } catch (_) {}
          }
        })(rows);
      }
      this.db.prepare(
        'UPDATE mem0_memories SET embedding = NULL WHERE embedding IS NOT NULL AND embedding_blob IS NOT NULL'
      ).run();
    } catch (error) {
      console.warn('[Mem0] BLOB backfill warning:', error.message);
    }
  }

  /** 旧版笔记 / 待办记忆只在 metadata 里记了来源 ID，补成 source_key @private */
  _backfillSourceKeys() {
    try {
      this.db.prepare(`
        UPDATE mem0_memories
        SET source_key = 'note:' || json_extract(metadata, '$.note_id')
        WHERE source_key IS NULL AND json_extract(metadata, '$.source') = 'user_note'
          AND json_extract(metadata, '$.note_id') IS NOT NULL
      `).run();
      this.db.prepare(`
        UPDATE mem0_memories
        SET source_key = 'todo:' || json_extract(metadata, '$.todo_id')
        WHERE source_key IS NULL AND json_extract(metadata, '$.source') = 'user_todo'
          AND json_extract(metadata, '$.todo_id') IS NOT NULL
      `).run();
    } catch (error) {
      console.warn('[Mem0] source_key backfill warning:', error.message);
    }
  }

  // ═══════════════════════════════════════════════════
  //  设置（存在 mem0_meta，主进程和 MCP 进程共享）
  // ═══════════════════════════════════════════════════

  getSetting(key, defaultValue = null) {
    if (!this.db) return defaultValue;
    try {
      const row = this.db.prepare('SELECT value FROM mem0_meta WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : defaultValue;
    } catch (_) {
      return defaultValue;
    }
  }

  setSetting(key, value) {
    if (!this.db) throw new Error('Mem0 database not ready');
    this.db.prepare(
      'INSERT INTO mem0_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, JSON.stringify(value));
    this._emitStatus();
  }

  // ═══════════════════════════════════════════════════
  //  向量化模型
  // ═══════════════════════════════════════════════════

  /** 随包模型所在目录（打包 / 开发） @private */
  _bundledModelsPath() {
    let isPackaged = false;
    try {
      const { app } = require('electron');
      isPackaged = !!(app && app.isPackaged);
    } catch (_) {
      isPackaged = __dirname.includes('app.asar');
    }
    if (isPackaged && process.resourcesPath) {
      return path.join(process.resourcesPath, 'app.asar.unpacked', 'models');
    }
    return path.join(__dirname, '..', '..', 'models');
  }

  /** 用户下载的模型目录 @private */
  _userModelsPath() {
    return path.join(this.appDataPath, 'models');
  }

  /** 模型文件齐全的根目录；没装返回 null @private */
  _findModelRoot(modelId) {
    for (const root of [this._bundledModelsPath(), this._userModelsPath()]) {
      const dir = path.join(root, modelId);
      if (fs.existsSync(path.join(dir, 'config.json'))
        && fs.existsSync(path.join(dir, 'onnx', 'model_quantized.onnx'))) {
        return root;
      }
    }
    return null;
  }

  /** 启动时用哪个模型：设置里选的，文件丢了就退回随包模型 @private */
  _resolveStartupModel() {
    const preferred = this.getSetting('embedding_model', LEGACY_MODEL);
    if (EMBEDDING_MODELS[preferred] && this._findModelRoot(preferred)) return preferred;
    if (preferred !== LEGACY_MODEL) {
      console.warn(`[Mem0] Embedding model ${preferred} not installed, falling back to ${LEGACY_MODEL}`);
    }
    return LEGACY_MODEL;
  }

  /** @private */
  async _getTransformers() {
    if (!this._transformers) {
      makeSharpOptional();
      this._transformers = await import('@xenova/transformers');
    }
    return this._transformers;
  }

  /** @private */
  async _loadEmbedder(modelId) {
    console.log('[Mem0] Loading embedding model', modelId);
    const { pipeline, env } = await this._getTransformers();
    const root = this._findModelRoot(modelId);
    if (root) {
      env.localModelPath = root;
      env.cacheDir = root;
      env.allowRemoteModels = false;
    } else if (modelId === LEGACY_MODEL) {
      // 开发环境没预下载随包模型时，允许从网络拉一次（与旧版行为一致）
      const userRoot = this._userModelsPath();
      env.localModelPath = userRoot;
      env.cacheDir = userRoot;
      env.allowRemoteModels = true;
    } else {
      throw new Error(`模型 ${modelId} 尚未下载`);
    }
    env.allowLocalModels = true;
    const embedder = await pipeline('feature-extraction', modelId, {
      quantized: true,
      local_files_only: !env.allowRemoteModels,
    });
    console.log('[Mem0] Embedding model loaded:', modelId);
    return embedder;
  }

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

  /** 行的向量（只有和当前模型一致时才可比较） @private */
  _rowVector(row) {
    if ((row.embedding_model || LEGACY_MODEL) !== this.activeModel) return null;
    if (row.embedding_blob) return this.blobToVector(row.embedding_blob);
    if (row.embedding) { try { return JSON.parse(row.embedding); } catch (_) { return null; } }
    return null;
  }

  // ── 模型下载 / 切换 ──

  getModels() {
    return Object.entries(EMBEDDING_MODELS).map(([id, cfg]) => ({
      id,
      label: cfg.label,
      description: cfg.description,
      sizeMB: cfg.sizeMB,
      bundled: cfg.bundled,
      installed: !!this._findModelRoot(id),
      active: id === this.activeModel,
    }));
  }

  /**
   * 下载模型到用户目录。先试官方源，连不上再走镜像；文件先写 .part，全部完成后再改名。
   */
  async downloadModel(modelId) {
    const cfg = EMBEDDING_MODELS[modelId];
    if (!cfg || cfg.bundled) throw new Error('该模型无需下载');
    if (this._findModelRoot(modelId)) return { success: true, alreadyInstalled: true };
    if (this._download) throw new Error('已有模型正在下载');

    const targetDir = path.join(this._userModelsPath(), modelId);
    const controller = new AbortController();
    this._download = { modelId, loaded: 0, total: cfg.sizeMB * 1024 * 1024, abort: controller };
    this._emitStatus();

    const { Readable } = require('stream');
    const { pipeline: streamPipeline } = require('stream/promises');
    const written = [];
    try {
      for (const file of cfg.files) {
        const dest = path.join(targetDir, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const res = await this._fetchModelFile(modelId, file, controller.signal);
        const partPath = `${dest}.part`;
        let lastEmit = 0;
        const counter = new (require('stream').Transform)({
          transform: (chunk, _enc, cb) => {
            this._download.loaded += chunk.length;
            const now = Date.now();
            if (now - lastEmit > 300) { lastEmit = now; this._emitStatus(); }
            cb(null, chunk);
          },
        });
        await streamPipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(partPath), { signal: controller.signal });
        written.push([partPath, dest]);
      }
      for (const [partPath, dest] of written) fs.renameSync(partPath, dest);
      console.log('[Mem0] Model downloaded:', modelId);
      return { success: true };
    } catch (error) {
      for (const [partPath] of written) { try { fs.unlinkSync(partPath); } catch (_) {} }
      if (controller.signal.aborted) return { success: false, cancelled: true };
      throw new Error(`下载失败：${error.message}`);
    } finally {
      this._download = null;
      this._emitStatus();
    }
  }

  /** @private */
  async _fetchModelFile(modelId, file, signal) {
    let lastError;
    for (const host of MODEL_HOSTS) {
      const url = `${host}/${modelId}/resolve/main/${file}`;
      const headerTimeout = new AbortController();
      const timer = setTimeout(() => headerTimeout.abort(), DOWNLOAD_HEADER_TIMEOUT_MS);
      const onAbort = () => headerTimeout.abort();
      signal.addEventListener('abort', onAbort);
      try {
        const res = await fetch(url, { redirect: 'follow', signal: headerTimeout.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        clearTimeout(timer);
        return res;
      } catch (error) {
        lastError = error;
        if (signal.aborted) throw error;
        console.warn(`[Mem0] Download ${file} from ${host} failed:`, error.message);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    }
    throw lastError || new Error('无法连接模型下载源');
  }

  cancelDownload() {
    this._download?.abort?.abort();
  }

  /**
   * 切换向量模型：加载新模型后替换，再在后台重算已有记忆的向量。
   */
  async setActiveModel(modelId) {
    if (!EMBEDDING_MODELS[modelId]) throw new Error('未知模型');
    if (!this._findModelRoot(modelId) && modelId !== LEGACY_MODEL) throw new Error('模型尚未下载');
    if (!this.db) throw new Error('Mem0 database not ready');
    if (modelId === this.activeModel && this.initialized) return { success: true };

    const embedder = await this._loadEmbedder(modelId);
    this.embedder = embedder;
    this.activeModel = modelId;
    this.setSetting('embedding_model', modelId);
    if (!this.initialized) {
      this.initialized = true;
      this.lastError = null;
      this._setState('ready');
    }
    this._startReindex();
    return { success: true };
  }

  /** 把向量不是当前模型生成的记忆重新向量化（后台分批，单实例） @private */
  _startReindex() {
    if (this._reindexRunning || !this.db || !this.embedder) return;
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) AS c FROM mem0_memories WHERE COALESCE(embedding_model, ?) != ?`
    );
    const total = countStmt.get(LEGACY_MODEL, this.activeModel).c;
    if (total === 0) return;

    this._reindexRunning = true;
    this._reindex = { done: 0, total };
    this._emitStatus();
    const model = this.activeModel;
    const select = this.db.prepare(
      `SELECT id, content FROM mem0_memories WHERE COALESCE(embedding_model, ?) != ? LIMIT ${REINDEX_BATCH}`
    );
    const update = this.db.prepare(
      'UPDATE mem0_memories SET embedding_blob = ?, embedding = NULL, embedding_model = ? WHERE id = ?'
    );

    const run = async () => {
      try {
        for (;;) {
          // 模型在重算过程中又被切换：交给新一轮
          if (this.activeModel !== model) break;
          const rows = select.all(LEGACY_MODEL, model);
          if (rows.length === 0) break;
          for (const row of rows) {
            const vec = await this.textToVector(row.content);
            update.run(this.vectorToBlob(vec), model, row.id);
            this._reindex.done++;
          }
          this._emitStatus();
          await new Promise(resolve => setImmediate(resolve));
        }
        console.log(`[Mem0] Reindex done: ${this._reindex.done}/${this._reindex.total}`);
      } catch (error) {
        console.error('[Mem0] Reindex failed:', error);
      } finally {
        this._reindexRunning = false;
        this._reindex = null;
        this._emitStatus();
        if (this.activeModel !== model) this._startReindex();
      }
    };
    run();
  }

  // ═══════════════════════════════════════════════════
  //  状态
  // ═══════════════════════════════════════════════════

  getStatus() {
    return {
      state: this.state,
      error: this.lastError,
      activeModel: this.activeModel,
      models: this.db ? this.getModels() : [],
      reindex: this._reindex ? { ...this._reindex } : null,
      download: this._download
        ? { modelId: this._download.modelId, loaded: this._download.loaded, total: this._download.total }
        : null,
      autoMemory: this.getSetting('auto_memory', true),
      lastIndexedAt: this.getSetting('index_last_run', null),
    };
  }

  /** @private */
  _setState(state) {
    this.state = state;
    this._emitStatus();
  }

  /** @private */
  _emitStatus() {
    try { this.emit('status', this.getStatus()); } catch (_) {}
  }

  // ═══════════════════════════════════════════════════
  //  写入层 - 守门器 (Gatekeeper)
  // ═══════════════════════════════════════════════════

  /** @private */
  _resolveLayer(category, options) {
    if (options.memoryLayer && MEMORY_LAYERS[options.memoryLayer]) return options.memoryLayer;
    return CATEGORY_TO_LAYER[category] || DEFAULT_LAYER;
  }

  /** @private */
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
    if (/^[\s\d\p{P}]+$/u.test(content.trim())) return 'no_semantic_value';
    return null;
  }

  /** @private */
  _resolveSource(options) {
    if (options.source) return options.source;
    const meta = options.metadata || {};
    return meta.source || 'user_manual';
  }

  /** @private */
  _truncateContent(content, layer) {
    const cfg = this._getLayerConfig(layer);
    return content.length > cfg.maxContentLen ? content.substring(0, cfg.maxContentLen) + '...' : content;
  }

  /**
   * 找同一条记忆的旧版本：字面完全相同，或向量和字面重合都很高。
   * 同句式的不同事实（「喜欢喝咖啡」/「喜欢跑步」）字面重合低，不会被合并。
   * @private
   */
  _findDuplicate(userId, content, embedding, layer) {
    try {
      const rows = this.db.prepare(`
        SELECT id, content, embedding_blob, embedding, embedding_model
        FROM mem0_memories
        WHERE user_id = ? AND memory_layer = ? AND superseded_by IS NULL AND source_key IS NULL
        ORDER BY created_at DESC LIMIT 300
      `).all(userId, layer);

      const norm = normalizeText(content);
      const grams = bigramSet(content);
      for (const row of rows) {
        if (normalizeText(row.content) === norm) return { id: row.id, content: row.content, exact: true };
        const vec = this._rowVector(row);
        if (!vec) continue;
        const score = this.cosineSimilarity(embedding, vec);
        if (score >= DEDUP_VECTOR_MIN && jaccard(grams, bigramSet(row.content)) >= DEDUP_BIGRAM_MIN) {
          return { id: row.id, content: row.content, score, exact: false };
        }
      }
      return null;
    } catch (error) {
      console.warn('[Mem0] Dedup check warning:', error.message);
      return null;
    }
  }

  /** 容量限制：先淘汰自动生成、少被用到的；用户手动添加的最后才动 @private */
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
            ORDER BY CASE WHEN source = 'user_manual' THEN 1 ELSE 0 END ASC,
                     importance_score ASC, access_count ASC, created_at ASC
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
   * 添加记忆 - 主入口（经过守门器）
   * 近似重复时新内容替代旧内容（最新的说法为准），旧条目保留在替代链里可撤销。
   */
  async addMemory(userId, content, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');

    const category = options.category || 'general';
    const layer = this._resolveLayer(category, options);
    const source = this._resolveSource(options);

    const rejectReason = this._gateValueCheck(content);
    if (rejectReason) {
      this._metrics.blocked++;
      return { success: false, blocked: true, reason: rejectReason };
    }

    const finalContent = this._truncateContent(content.trim(), layer);
    const embedding = await this.textToVector(finalContent);

    const dup = this._findDuplicate(userId, finalContent, embedding, layer);
    if (dup) {
      this._metrics.deduped++;
      if (dup.exact) {
        this.db.prepare('UPDATE mem0_memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
          .run(Date.now(), dup.id);
        return { success: true, id: dup.id, deduplicated: true, embedding_dim: embedding.length };
      }
      const newId = this._insertMemory(userId, finalContent, embedding, category, layer, source, options);
      this._markSuperseded(dup.id, newId);
      console.log(`[Mem0] Superseded: ${dup.id} → ${newId}`);
      return { success: true, id: newId, superseded: dup.id, embedding_dim: embedding.length };
    }

    this._enforceCapacity(userId, layer);
    const newId = this._insertMemory(userId, finalContent, embedding, category, layer, source, options);
    this._metrics.writes++;
    return { success: true, id: newId, embedding_dim: embedding.length };
  }

  /** @private */
  _insertMemory(userId, content, embedding, category, layer, source, options = {}) {
    const now = Date.now();
    const importance = this._getLayerConfig(layer).importance;
    const result = this.db.prepare(`
      INSERT INTO mem0_memories
        (user_id, content, embedding, embedding_blob, embedding_model, metadata, category,
         memory_type, memory_layer, source, source_key, importance_score,
         created_at, updated_at, access_count, last_accessed_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      userId, content, this.vectorToBlob(embedding), this.activeModel,
      JSON.stringify(options.metadata || {}), category,
      options.memoryType || layer, layer, source, options.sourceKey || null, importance,
      now, now, now
    );
    return Number(result.lastInsertRowid);
  }

  /** @private */
  _markSuperseded(oldId, newId) {
    this.db.prepare('UPDATE mem0_memories SET superseded_by = ?, updated_at = ? WHERE id = ?')
      .run(newId, Date.now(), oldId);
  }

  // ── 来源绑定的记忆（笔记 / 待办索引） ──

  /**
   * 来源对象的记忆：一个 source_key 只保留一条，原文变了就原地更新。
   * 不做语义去重——两篇内容相近的笔记仍是两条记忆。
   */
  async upsertSourceMemory(userId, sourceKey, content, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    const layer = this._resolveLayer(options.category || 'knowledge', { memoryLayer: options.memoryLayer || 'artifact' });
    const finalContent = this._truncateContent(String(content || '').trim(), layer);
    if (this._gateValueCheck(finalContent)) return { success: false, blocked: true };

    const rows = this.db.prepare(
      'SELECT id, content FROM mem0_memories WHERE user_id = ? AND source_key = ? AND superseded_by IS NULL ORDER BY updated_at DESC'
    ).all(userId, sourceKey);
    // 旧版同一来源可能存了多条，只留最新一条
    if (rows.length > 1) {
      const extra = rows.slice(1).map(r => r.id);
      this.db.prepare(`DELETE FROM mem0_memories WHERE id IN (${extra.map(() => '?').join(',')})`).run(...extra);
    }

    const metadata = JSON.stringify(options.metadata || {});
    const existing = rows[0];
    if (existing) {
      if (existing.content === finalContent) {
        this.db.prepare('UPDATE mem0_memories SET metadata = ? WHERE id = ?').run(metadata, existing.id);
        return { success: true, id: existing.id, unchanged: true };
      }
      const embedding = await this.textToVector(finalContent);
      this.db.prepare(`
        UPDATE mem0_memories
        SET content = ?, embedding = NULL, embedding_blob = ?, embedding_model = ?, metadata = ?, updated_at = ?
        WHERE id = ?
      `).run(finalContent, this.vectorToBlob(embedding), this.activeModel, metadata, Date.now(), existing.id);
      return { success: true, id: existing.id, updated: true };
    }

    const embedding = await this.textToVector(finalContent);
    this._enforceCapacity(userId, layer);
    const id = this._insertMemory(userId, finalContent, embedding, options.category || 'knowledge', layer,
      options.source || 'unknown', { ...options, sourceKey });
    this._metrics.writes++;
    return { success: true, id, added: true };
  }

  /** 某类来源已建立的索引：source_key → { id, metadata, updatedAt } */
  getSourceIndex(userId, prefix) {
    if (!this.db) return new Map();
    const rows = this.db.prepare(
      `SELECT id, source_key, metadata, updated_at FROM mem0_memories
       WHERE user_id = ? AND source_key LIKE ? AND superseded_by IS NULL`
    ).all(userId, `${prefix}%`);
    const map = new Map();
    for (const row of rows) {
      map.set(row.source_key, { id: row.id, metadata: safeParse(row.metadata), updatedAt: row.updated_at });
    }
    return map;
  }

  /** 只合并更新元数据，不动内容和向量 */
  mergeMemoryMetadata(memoryId, patch) {
    if (!this.db) return;
    const row = this.db.prepare('SELECT metadata FROM mem0_memories WHERE id = ?').get(memoryId);
    if (!row) return;
    this.db.prepare('UPDATE mem0_memories SET metadata = ? WHERE id = ?')
      .run(JSON.stringify({ ...safeParse(row.metadata), ...patch }), memoryId);
  }

  // ═══════════════════════════════════════════════════
  //  检索层
  // ═══════════════════════════════════════════════════

  /**
   * 语义搜索：全部有效记忆参与向量比较 + 关键词匹配，打分有上界。
   * @param {object} options
   *   limit / category / layers(string[]) / threshold(最低相关度 0~1) / maxTokens /
   *   touch(是否计入访问次数，默认 true；设置页和内部检查传 false)
   */
  async searchMemories(userId, query, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');

    const topK = options.limit || 5;
    const minRelevance = options.threshold ?? options.minScore ?? DEFAULT_MIN_RELEVANCE;
    const maxTokenBudget = options.maxTokens || 2000;
    const touch = options.touch !== false;
    const modelCfg = EMBEDDING_MODELS[this.activeModel] || {};
    const floor = modelCfg.vecFloor ?? 0.4;
    const cjkChars = (String(query).match(/[\u3400-\u9fff]/g) || []).length;
    const vecWeight = modelCfg.cjkReliable === false && cjkChars >= String(query).length * 0.3 ? 0.5 : 1;

    this._metrics.searches++;

    let sql = `
      SELECT id, content, embedding_blob, embedding, embedding_model, metadata, category,
             memory_layer, source, source_key, importance_score, access_count,
             created_at, updated_at, last_accessed_at
      FROM mem0_memories
      WHERE user_id = ? AND superseded_by IS NULL
    `;
    const params = [userId];
    if (options.category) { sql += ' AND category = ?'; params.push(options.category); }
    if (Array.isArray(options.layers) && options.layers.length > 0) {
      sql += ` AND memory_layer IN (${options.layers.map(() => '?').join(',')})`;
      params.push(...options.layers);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(MAX_SEARCH_CANDS);
    const candidates = this.db.prepare(sql).all(...params);

    const queryVec = await this.textToVector(query);
    const terms = keywordTerms(query);
    const now = Date.now();

    const ranked = [];
    for (const row of candidates) {
      const vec = this._rowVector(row);
      const cos = vec ? this.cosineSimilarity(queryVec, vec) : 0;
      // 把模型的噪声底线以下压成 0，让不同模型的相关度可比
      const vecRel = vec ? clamp01((cos - floor) / (1 - floor)) * vecWeight : 0;

      let kwRel = 0;
      if (terms.length > 0) {
        const lower = (row.content || '').toLowerCase();
        let hit = 0;
        for (const t of terms) if (lower.includes(t)) hit++;
        kwRel = hit / terms.length;
      }

      const relevance = Math.min(1, Math.max(vecRel, kwRel) + 0.2 * Math.min(vecRel, kwRel));
      if (relevance < minRelevance) continue;

      const ageDays = (now - (row.updated_at || row.created_at)) / 86400000;
      // 偏好层是长期稳定的事实，不随时间衰减
      const freshness = row.memory_layer === 'profile' ? 1 : Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
      const importance = row.importance_score || MEMORY_LAYERS[row.memory_layer]?.importance || 0.5;
      const credibility = SOURCE_CREDIBILITY[row.source] || 0.5;

      ranked.push({
        id: row.id,
        content: row.content,
        score: RANK_WEIGHTS.relevance * relevance
          + RANK_WEIGHTS.freshness * freshness
          + RANK_WEIGHTS.importance * importance
          + RANK_WEIGHTS.credibility * credibility,
        vecScore: relevance,
        metadata: safeParse(row.metadata),
        category: row.category,
        memory_layer: row.memory_layer,
        source: row.source,
        source_key: row.source_key,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    const results = [];
    let tokenUsed = 0;
    for (const item of ranked) {
      if (results.length >= topK) break;
      const estimatedTokens = Math.ceil(item.content.length / 2);
      if (tokenUsed + estimatedTokens > maxTokenBudget && results.length > 0) break;
      results.push(item);
      tokenUsed += estimatedTokens;
    }

    if (results.length > 0) {
      this._metrics.hits++;
      if (touch) {
        const upd = this.db.prepare(
          'UPDATE mem0_memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?'
        );
        for (const r of results) upd.run(now, r.id);
      }
    }
    return results;
  }

  /** Profile 层记忆（注入 AI 系统提示词） */
  async getProfileMemories(userId, limit = 20) {
    if (!this.initialized) return [];
    try {
      return this.db.prepare(`
        SELECT content, category, importance_score
        FROM mem0_memories
        WHERE user_id = ? AND memory_layer = 'profile' AND superseded_by IS NULL
        ORDER BY importance_score DESC, updated_at DESC
        LIMIT ?
      `).all(userId, limit);
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
    const limit = options.limit || 50;
    let sql = 'SELECT * FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL';
    const params = [userId];
    if (options.category) { sql += ' AND category = ?'; params.push(options.category); }
    if (options.layer) { sql += ' AND memory_layer = ?'; params.push(options.layer); }
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, options.offset || 0);
    return this.db.prepare(sql).all(...params).map(row => ({
      id: row.id,
      content: row.content,
      metadata: safeParse(row.metadata),
      category: row.category,
      memory_type: row.memory_type || 'knowledge',
      memory_layer: row.memory_layer || 'semantic',
      source: row.source,
      source_key: row.source_key,
      access_count: row.access_count || 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async deleteMemory(memoryId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    return this.db.prepare('DELETE FROM mem0_memories WHERE id = ?').run(memoryId).changes > 0;
  }

  async updateMemory(memoryId, content, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    const old = this.db.prepare('SELECT category, memory_layer, metadata FROM mem0_memories WHERE id = ?').get(memoryId);
    if (!old) return { success: false, updated: false };

    const category = options.category || old.category;
    const layer = this._resolveLayer(category, { ...options, memoryLayer: options.memoryLayer || old.memory_layer });
    const metadataStr = JSON.stringify(options.metadata || safeParse(old.metadata));
    const truncated = this._truncateContent(content, layer);
    const embedding = await this.textToVector(truncated);
    const result = this.db.prepare(`
      UPDATE mem0_memories
      SET content = ?, embedding = NULL, embedding_blob = ?, embedding_model = ?,
          metadata = ?, category = ?, memory_layer = ?, updated_at = ?
      WHERE id = ?
    `).run(truncated, this.vectorToBlob(embedding), this.activeModel, metadataStr, category, layer, Date.now(), memoryId);
    return { success: true, id: memoryId, updated: result.changes > 0 };
  }

  /**
   * 用新内容替代一条记忆：旧条目进替代链（30 天内可撤销），返回新条目 ID。
   */
  async supersedeMemory(userId, oldId, content, options = {}) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    const old = this.db.prepare(
      'SELECT category, memory_layer, content FROM mem0_memories WHERE id = ? AND superseded_by IS NULL'
    ).get(oldId);
    if (!old) return null;
    const finalContent = this._truncateContent(String(content).trim(), old.memory_layer);
    const embedding = await this.textToVector(finalContent);
    const newId = this._insertMemory(userId, finalContent, embedding, old.category, old.memory_layer,
      options.source || 'ai_auto', options);
    this._markSuperseded(oldId, newId);
    return { id: newId, previousContent: old.content };
  }

  /** 软删除（30 天内可撤销） */
  softDeleteMemory(memoryId) {
    if (!this.db) throw new Error('Mem0 database not ready');
    const row = this.db.prepare('SELECT content FROM mem0_memories WHERE id = ? AND superseded_by IS NULL').get(memoryId);
    if (!row) return null;
    this._markSuperseded(memoryId, SOFT_DELETED);
    return { previousContent: row.content };
  }

  /**
   * 撤销一组自动记忆变更（倒序执行）。
   * changes: [{ op: 'add', id } | { op: 'update', id, previousId } | { op: 'delete', id }]
   */
  revertChanges(changes = []) {
    if (!this.db) throw new Error('Mem0 database not ready');
    const del = this.db.prepare('DELETE FROM mem0_memories WHERE id = ?');
    const restore = this.db.prepare('UPDATE mem0_memories SET superseded_by = NULL, updated_at = ? WHERE id = ?');
    let reverted = 0;
    this.db.transaction(() => {
      for (const change of [...changes].reverse()) {
        if (change.op === 'add') {
          reverted += del.run(change.id).changes;
        } else if (change.op === 'update') {
          del.run(change.id);
          reverted += restore.run(Date.now(), change.previousId).changes;
        } else if (change.op === 'delete') {
          reverted += restore.run(Date.now(), change.id).changes;
        }
      }
    })();
    return { reverted };
  }

  async clearUserMemories(userId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    const result = this.db.prepare('DELETE FROM mem0_memories WHERE user_id = ?').run(userId);
    console.log('[Mem0] Cleared', result.changes, 'memories');
    return result.changes;
  }

  // ═══════════════════════════════════════════════════
  //  治理层
  // ═══════════════════════════════════════════════════

  async cleanupMemories(userId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    let removed = 0;
    const now = Date.now();

    // 1. TTL 过期（按分层；常被用到的保留）
    for (const [layer, cfg] of Object.entries(MEMORY_LAYERS)) {
      if (!cfg.ttlDays) continue;
      const expiry = now - cfg.ttlDays * 86400000;
      removed += this.db.prepare(`
        DELETE FROM mem0_memories
        WHERE user_id = ? AND memory_layer = ?
          AND access_count < 3 AND updated_at < ?
          AND (last_accessed_at IS NULL OR last_accessed_at < ?)
      `).run(userId, layer, expiry, expiry).changes;
    }

    // 2. 替代链 / 软删除：超过保留期的旧条目
    removed += this.db.prepare(`
      DELETE FROM mem0_memories
      WHERE user_id = ? AND superseded_by IS NOT NULL AND updated_at < ?
    `).run(userId, now - CHAIN_RETENTION_DAYS * 86400000).changes;

    // 3. 冷存降级：长期未访问的降低重要度
    this.db.prepare(`
      UPDATE mem0_memories
      SET importance_score = MAX(0.1, importance_score * 0.7)
      WHERE user_id = ? AND memory_layer != 'profile'
        AND (last_accessed_at IS NULL OR last_accessed_at < ?)
        AND importance_score > 0.2
    `).run(userId, now - 90 * 86400000);

    // 4. 孤儿：原笔记 / 待办已删除
    try {
      removed += this.db.prepare(`
        DELETE FROM mem0_memories
        WHERE user_id = ? AND source_key LIKE 'note:%'
          AND CAST(substr(source_key, 6) AS INTEGER) NOT IN (
            SELECT id FROM notes WHERE is_deleted = 0 OR is_deleted IS NULL
          )
      `).run(userId).changes;
      removed += this.db.prepare(`
        DELETE FROM mem0_memories
        WHERE user_id = ? AND source_key LIKE 'todo:%'
          AND CAST(substr(source_key, 6) AS INTEGER) NOT IN (
            SELECT id FROM todos WHERE is_deleted = 0 OR is_deleted IS NULL
          )
      `).run(userId).changes;
    } catch (_) {
      // 独立 MCP 等没有 notes/todos 表的场景
    }

    if (removed > 0) console.log(`[Mem0] Cleanup done: removed ${removed}`);
    return { removed, merged: 0 };
  }

  async getStats(userId) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    const activeTotal = this.db.prepare(
      'SELECT COUNT(*) as c FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL'
    ).get(userId).c;
    const total = this.db.prepare('SELECT COUNT(*) as c FROM mem0_memories WHERE user_id = ?').get(userId).c;

    const byLayer = {};
    for (const row of this.db.prepare(`
      SELECT memory_layer, COUNT(*) as count
      FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL
      GROUP BY memory_layer
    `).all(userId)) {
      const layer = row.memory_layer || 'semantic';
      const cfg = MEMORY_LAYERS[layer] || MEMORY_LAYERS.semantic;
      byLayer[layer] = {
        count: row.count,
        limit: cfg.maxCount,
        usage: `${((row.count / cfg.maxCount) * 100).toFixed(0)}%`,
      };
    }

    const byCategory = {};
    for (const row of this.db.prepare(`
      SELECT category, COUNT(*) as count
      FROM mem0_memories WHERE user_id = ? AND superseded_by IS NULL
      GROUP BY category
    `).all(userId)) {
      byCategory[row.category] = { count: row.count };
    }

    // 近 26 周每天新增的记忆数（本地日期），设置页画热力图
    const activity = this.db.prepare(`
      SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
      FROM mem0_memories
      WHERE user_id = ? AND superseded_by IS NULL AND created_at >= ?
      GROUP BY day
    `).all(userId, Date.now() - 26 * 7 * 86400000);

    return {
      total,
      active: activeTotal,
      superseded: total - activeTotal,
      activity,
      by_layer: byLayer,
      by_category: byCategory,
      metrics: {
        ...this._metrics,
        hit_rate: this._metrics.searches > 0
          ? `${((this._metrics.hits / this._metrics.searches) * 100).toFixed(0)}%` : 'N/A',
      },
    };
  }

  /** 补齐缺失的向量（兼容旧插件 API） */
  async backfillEmbeddings(userId = null) {
    if (!this.initialized) throw new Error('Mem0 service not initialized');
    let sql = 'SELECT id, content FROM mem0_memories WHERE embedding_blob IS NULL AND embedding IS NULL';
    const params = [];
    if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
    const rows = this.db.prepare(sql).all(...params);
    const stmt = this.db.prepare('UPDATE mem0_memories SET embedding_blob = ?, embedding_model = ? WHERE id = ?');
    let cnt = 0;
    for (const row of rows) {
      try {
        stmt.run(this.vectorToBlob(await this.textToVector(row.content)), this.activeModel, row.id);
        cnt++;
      } catch (_) {}
    }
    return cnt;
  }

  isAvailable() { return this.initialized && this.db !== null && this.embedder !== null; }

  close() {
    this.cancelDownload();
    if (this.db) { this.db.close(); this.db = null; }
    this.embedder = null;
    this.initialized = false;
    console.log('[Mem0] Service closed');
  }
}

Mem0Service.EMBEDDING_MODELS = EMBEDDING_MODELS;
Mem0Service.LEGACY_MODEL = LEGACY_MODEL;
Mem0Service._internals = { keywordTerms, bigramSet, jaccard, normalizeText };

module.exports = Mem0Service;
