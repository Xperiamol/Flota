/**
 * Mem0 知识管理服务 - 纯 JS 实现
 * 使用 Transformers.js 在本地生成向量嵌入，存储在现有 SQLite 中
 * 
 * 功能：
 * - 本地语义向量化（无需云端 API）
 * - 基于余弦相似度的语义搜索
 * - 与现有 SQLite 数据库集成
 * - 支持用户级别的记忆隔离
 * 
 * 技术栈：
 * - @xenova/transformers: 纯 JS 向量化模型
 * - better-sqlite3: 已有的 SQLite
 * - compute-cosine-similarity: 余弦相似度计算
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

class Mem0Service extends EventEmitter {
  constructor(databasePath, appDataPath) {
    super();
    this.databasePath = databasePath;
    this.appDataPath = appDataPath;
    this.db = null;
    this.embedder = null;
    this.initialized = false;
    this.initializing = false;
  }

  /**
   * 初始化服务
   */
  async initialize() {
    if (this.initialized) {
      return { success: true, message: 'Already initialized' };
    }

    if (this.initializing) {
      console.log('[Mem0] Already initializing...');
      return { success: false, error: 'Initialization in progress' };
    }

    this.initializing = true;

    try {
      console.log('[Mem0] Starting initialization...');

      // 1. 初始化数据库连接（复用现有的）
      await this.initDatabase();

      // 2. 初始化向量化模型
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

  /**
   * 初始化数据库
   */
  async initDatabase() {
    try {
      const Database = require('better-sqlite3');

      // 复用现有的数据库文件
      if (!fs.existsSync(this.databasePath)) {
        throw new Error(`Database not found: ${this.databasePath}`);
      }

      this.db = new Database(this.databasePath);
      console.log('[Mem0] Database connected:', this.databasePath);

      // 创建记忆表（如果不存在）
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

      // 创建索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mem0_user_id ON mem0_memories(user_id);
        CREATE INDEX IF NOT EXISTS idx_mem0_category ON mem0_memories(category);
        CREATE INDEX IF NOT EXISTS idx_mem0_created_at ON mem0_memories(created_at);
      `);

      console.log('[Mem0] Database tables initialized');

    } catch (error) {
      console.error('[Mem0] Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * 初始化向量化模型
   */
  async initEmbedder() {
    try {
      console.log('[Mem0] Loading embedding model...');

      // 动态导入 transformers.js (ESM 模块)
      const transformers = await import('@xenova/transformers');
      const { pipeline, env } = transformers;
      
      // 检查是否在 Electron 环境
      let app = null;
      try {
        const electron = await import('electron');
        app = electron.app;
      } catch (e) {
        // Standalone mode (非 Electron 环境)
      }

      // 设置模型缓存路径
      // 打包后：使用 process.resourcesPath/models（预下载的模型）
      // 开发环境：使用 appDataPath/models（允许下载）
      let modelsPath;
      let localFilesOnly = false;

      // 检测是否在打包环境（独立 MCP Server 或 Electron）
      let isPackaged = false;
      let isStandaloneMCP = false;
      
      try {
        const { app } = require('electron');
        isPackaged = app && app.isPackaged;
      } catch (e) {
        // 独立 Node.js 环境
        // 检查是否是用户下载的独立 MCP Server（在用户数据目录）
        isStandaloneMCP = __dirname.includes('mcp-server') && (
          __dirname.includes(path.join('AppData', 'Roaming', 'Flota')) ||
          __dirname.includes(path.join('Application Support', 'Flota')) ||
          __dirname.includes(path.join('.config', 'Flota'))
        );
        isPackaged = __dirname.includes('app.asar') && !isStandaloneMCP;
      }

      if (isPackaged) {
        // Electron 打包环境：使用 app.asar.unpacked/models
        try {
          const { app } = require('electron');
          // 模型在 asarUnpack 中，路径为 resources/app.asar.unpacked/models
          modelsPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'models');
        } catch (e) {
          // resources/mcp-server 模式
          modelsPath = path.join(__dirname, '..', '..', 'models');
        }
        localFilesOnly = true;
        console.log('[Mem0] Using bundled models (Electron production mode)');
      } else if (isStandaloneMCP) {
        // 独立 MCP Server（用户下载安装到用户数据目录）
        // 允许首次运行时下载模型到用户数据目录
        modelsPath = path.join(this.appDataPath, 'models');
        localFilesOnly = false;
        console.log('[Mem0] Using user data directory for models (standalone MCP)');
        console.log('[Mem0] Models will be downloaded on first use (~22MB)');
      } else {
        // 开发环境：优先使用项目内已有的 models 目录（避免网络下载）
        const projectModelsPath = path.join(__dirname, '..', '..', 'models');
        const appDataModelsPath = path.join(this.appDataPath, 'models');
        if (fs.existsSync(path.join(projectModelsPath, 'Xenova', 'all-MiniLM-L6-v2'))) {
          modelsPath = projectModelsPath;
          localFilesOnly = true;
          console.log('[Mem0] Using project models directory (development mode)');
        } else {
          modelsPath = appDataModelsPath;
          localFilesOnly = false;
          console.log('[Mem0] Using cache directory (development mode, will download if needed)');
        }
      }

      env.cacheDir = modelsPath;
      env.localModelPath = modelsPath;
      env.allowRemoteModels = !localFilesOnly;  // 开发环境允许下载
      env.allowLocalModels = true;

      console.log(`[Mem0] Models directory: ${modelsPath}`);
      console.log(`[Mem0] Local files only: ${localFilesOnly}`);

      // 初始化嵌入管道（使用轻量级模型）
      // all-MiniLM-L6-v2: 22MB, 384维, 适合语义搜索
      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          local_files_only: localFilesOnly
        }
      );

      console.log('[Mem0] Embedding model loaded successfully');

    } catch (error) {
      console.error('[Mem0] Failed to load embedding model:', error);

      if (error.message && error.message.includes('local_files_only')) {
        console.error('[Mem0] Model not found in bundled resources. Please run: npm run pre-build');
      } else {
        console.log('[Mem0] Please install: npm install @xenova/transformers');
      }

      throw error;
    }
  }

  /**
   * 将文本转换为向量
   * @param {string} text - 输入文本
   * @returns {Promise<Array<number>>} 384维向量
   */
  async textToVector(text) {
    if (!this.embedder) {
      throw new Error('Embedder not initialized');
    }

    try {
      const output = await this.embedder(text, {
        pooling: 'mean',
        normalize: true
      });

      // 转换为普通数组
      const vector = Array.from(output.data);
      return vector;

    } catch (error) {
      console.error('[Mem0] Text to vector failed:', error);
      throw error;
    }
  }

  /**
   * 计算余弦相似度
   * @param {Array<number>} vecA 
   * @param {Array<number>} vecB 
   * @returns {number} 相似度 [0, 1]
   */
  cosineSimilarity(vecA, vecB) {
    try {
      const cosine = require('compute-cosine-similarity');
      return cosine(vecA, vecB) || 0;
    } catch (error) {
      // 如果库不存在，手动计算
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }

      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
  }

  /**
   * 添加记忆
   * @param {string} userId - 用户ID
   * @param {string} content - 记忆内容
   * @param {object} options - 选项
   * @returns {Promise<object>}
   */
  async addMemory(userId, content, options = {}) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      console.log('[Mem0] Adding memory:', { userId, contentLength: content.length });

      // 生成向量
      const embedding = await this.textToVector(content);

      // 存储到数据库
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT INTO mem0_memories (user_id, content, embedding, metadata, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        userId,
        content,
        JSON.stringify(embedding),
        JSON.stringify(options.metadata || {}),
        options.category || 'general',
        now,
        now
      );

      console.log('[Mem0] Memory added:', result.lastInsertRowid);

      return {
        success: true,
        id: result.lastInsertRowid,
        embedding_dim: embedding.length
      };

    } catch (error) {
      console.error('[Mem0] Add memory failed:', error);
      throw error;
    }
  }

  /**
   * 语义搜索记忆
   * @param {string} userId - 用户ID
   * @param {string} query - 查询文本
   * @param {object} options - 选项
   * @returns {Promise<Array>}
   */
  async searchMemories(userId, query, options = {}) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      const topK = options.limit || 5;
      const category = options.category;
      // 支持 threshold 和 minScore 两种参数名（threshold 来自插件，minScore 是历史兼容）
      const minScore = options.threshold || options.minScore || 0.3;

      console.log('[Mem0] Searching memories:', { userId, query, topK, category });

      // 1. 将查询转换为向量
      const queryVector = await this.textToVector(query);
      console.log('[Mem0] 查询向量维度:', queryVector.length, '前5维:', queryVector.slice(0, 5))

      // 2. 读取用户的所有记忆
      let sql = `
        SELECT id, content, embedding, metadata, category, created_at
        FROM mem0_memories
        WHERE user_id = ?
      `;
      const params = [userId];

      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      const rows = this.db.prepare(sql).all(...params);

      console.log('[Mem0] Found', rows.length, 'memories to search');

      // 3. 计算相似度并排序
      const scored = rows
        .map(row => {
          let embedding;
          try {
            embedding = JSON.parse(row.embedding);
          } catch (e) {
            console.warn('[Mem0] Invalid embedding for memory', row.id);
            return null;
          }

          const score = this.cosineSimilarity(queryVector, embedding);

          return {
            id: row.id,
            content: row.content,
            score: score,
            metadata: JSON.parse(row.metadata || '{}'),
            category: row.category,
            created_at: row.created_at
          };
        })
        .filter(item => item !== null && item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      console.log('[Mem0] Search results:', scored.length, 'matches');
      if (scored.length > 0) {
        console.log('[Mem0] Top match:', {
          score: (scored[0].score * 100).toFixed(1) + '%',
          preview: scored[0].content.substring(0, 50) + '...'
        })
      }

      return scored;

    } catch (error) {
      console.error('[Mem0] Search failed:', error);
      throw error;
    }
  }

  /**
   * 获取用户的所有记忆
   * @param {string} userId 
   * @param {object} options 
   * @returns {Promise<Array>}
   */
  async getMemories(userId, options = {}) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      const limit = options.limit || 50;
      const category = options.category;

      let sql = 'SELECT * FROM mem0_memories WHERE user_id = ?';
      const params = [userId];

      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params);

      return rows.map(row => ({
        id: row.id,
        content: row.content,
        metadata: JSON.parse(row.metadata || '{}'),
        category: row.category,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

    } catch (error) {
      console.error('[Mem0] Get memories failed:', error);
      throw error;
    }
  }

  /**
   * 删除记忆
   * @param {number} memoryId 
   * @returns {Promise<boolean>}
   */
  async deleteMemory(memoryId) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      const stmt = this.db.prepare('DELETE FROM mem0_memories WHERE id = ?');
      const result = stmt.run(memoryId);
      return result.changes > 0;
    } catch (error) {
      console.error('[Mem0] Delete memory failed:', error);
      throw error;
    }
  }

  /**
   * 更新记忆
   * @param {number} memoryId - 记忆ID
   * @param {string} content - 新的记忆内容
   * @param {object} options - 选项
   * @returns {Promise<object>}
   */
  async updateMemory(memoryId, content, options = {}) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      console.log('[Mem0] Updating memory:', { memoryId, contentLength: content.length });

      // 生成新的向量
      const embedding = await this.textToVector(content);

      // 更新数据库
      const now = Date.now();
      const stmt = this.db.prepare(`
        UPDATE mem0_memories 
        SET content = ?, 
            embedding = ?, 
            metadata = ?, 
            category = ?, 
            updated_at = ? 
        WHERE id = ?
      `);

      const result = stmt.run(
        content,
        JSON.stringify(embedding),
        JSON.stringify(options.metadata || {}),
        options.category || 'general',
        now,
        memoryId
      );

      console.log('[Mem0] Memory updated:', result.changes);

      return {
        success: true,
        id: memoryId,
        updated: result.changes > 0
      };

    } catch (error) {
      console.error('[Mem0] Update memory failed:', error);
      throw error;
    }
  }

  /**
   * 清除用户的所有记忆
   * @param {string} userId 
   * @returns {Promise<number>} 删除的记录数
   */
  async clearUserMemories(userId) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      const stmt = this.db.prepare('DELETE FROM mem0_memories WHERE user_id = ?');
      const result = stmt.run(userId);
      console.log('[Mem0] Cleared', result.changes, 'memories for user', userId);
      return result.changes;
    } catch (error) {
      console.error('[Mem0] Clear memories failed:', error);
      throw error;
    }
  }

  /**
   * 获取统计信息
   * @param {string} userId 
   * @returns {Promise<object>}
   */
  async getStats(userId) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      const countStmt = this.db.prepare(
        'SELECT COUNT(*) as total FROM mem0_memories WHERE user_id = ?'
      );
      const categoryStmt = this.db.prepare(`
        SELECT category, COUNT(*) as count 
        FROM mem0_memories 
        WHERE user_id = ? 
        GROUP BY category
      `);

      const totalResult = countStmt.get(userId);
      const categoryResults = categoryStmt.all(userId);

      return {
        total: totalResult.total,
        by_category: categoryResults.reduce((acc, row) => {
          acc[row.category] = row.count;
          return acc;
        }, {})
      };

    } catch (error) {
      console.error('[Mem0] Get stats failed:', error);
      throw error;
    }
  }

  /**
   * 批量补充向量（用于迁移旧数据）
   * @param {string} userId 
   * @returns {Promise<number>} 处理的记录数
   */
  async backfillEmbeddings(userId = null) {
    if (!this.initialized) {
      throw new Error('Mem0 service not initialized');
    }

    try {
      let sql = 'SELECT id, content FROM mem0_memories WHERE embedding IS NULL';
      const params = [];

      if (userId) {
        sql += ' AND user_id = ?';
        params.push(userId);
      }

      const rows = this.db.prepare(sql).all(...params);
      console.log('[Mem0] Backfilling embeddings for', rows.length, 'memories');

      const updateStmt = this.db.prepare(
        'UPDATE mem0_memories SET embedding = ? WHERE id = ?'
      );

      let processed = 0;
      for (const row of rows) {
        try {
          const embedding = await this.textToVector(row.content);
          updateStmt.run(JSON.stringify(embedding), row.id);
          processed++;

          if (processed % 10 === 0) {
            console.log('[Mem0] Processed', processed, '/', rows.length);
          }
        } catch (error) {
          console.error('[Mem0] Failed to process memory', row.id, error);
        }
      }

      console.log('[Mem0] Backfill complete:', processed, 'embeddings generated');
      return processed;

    } catch (error) {
      console.error('[Mem0] Backfill failed:', error);
      throw error;
    }
  }

  /**
   * 检查服务是否可用
   */
  isAvailable() {
    return this.initialized && this.db !== null && this.embedder !== null;
  }

  /**
   * 关闭服务
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.embedder = null;
    this.initialized = false;
    console.log('[Mem0] Service closed');
  }
}

module.exports = Mem0Service;
