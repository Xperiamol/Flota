const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getInstance: getDatabaseManager } = require('../../dao/DatabaseManager');

const PORTS = [47831, 47832, 47833, 47834, 47835];
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const PAIR_CODE_TTL_MS = 5 * 60 * 1000;
const PAIR_ATTEMPTS_PER_MINUTE = 5;
const STORAGE_ID = '__ingress';
// 只接受浏览器扩展的来源；普通网页（http/https origin）一律拒绝，防止网页向本机服务写数据
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[\w.-]+$/i;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}

/**
 * 本地接收通道：只监听 127.0.0.1，供浏览器扩展、脚本、外部 Agent 把内容送进 Flota。
 * 具体处理由注册的 handler 完成（剪藏由“网页剪藏”插件接管）。
 *
 * 接口：
 *   GET  /v1/ping              探测服务，带 token 时返回是否已配对
 *   POST /v1/pair              { code, name } 用应用内显示的 6 位配对码换取 token
 *   GET  /v1/targets           可选分类与常用标签（需 token）
 *   POST /v1/<kind>            交给对应 handler，如 /v1/clip（需 token）
 */
class IngressService extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.version 应用版本
   * @param {(kind: string) => ((payload: any, context: object) => Promise<any>) | null} options.resolveHandler
   * @param {() => object} [options.getTargets]
   */
  constructor({ version, resolveHandler, getTargets, createMcpServer }) {
    super();
    this.createMcpServer = createMcpServer || null;
    this.version = version;
    this.resolveHandler = resolveHandler;
    this.getTargets = getTargets || (() => ({ categories: [], tags: [] }));
    this.server = null;
    this.port = null;
    this.pairing = null;
    this.pairAttempts = [];
  }

  getDB() {
    return getDatabaseManager().getDatabase();
  }

  // ==================== 配对与令牌（本机专属，不参与同步） ====================

  loadClients() {
    try {
      const row = this.getDB().prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?').get(STORAGE_ID, 'clients');
      const list = row ? JSON.parse(row.value) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  saveClients(list) {
    this.getDB().prepare(`
      INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, 'clients', ?, CURRENT_TIMESTAMP)
    `).run(STORAGE_ID, JSON.stringify(list));
  }

  listClients() {
    return this.loadClients().map(({ hash, ...client }) => client);
  }

  revokeClient(id) {
    const list = this.loadClients();
    const next = list.filter((client) => client.id !== id);
    this.saveClients(next);
    return next.length !== list.length;
  }

  createPairingCode() {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    this.pairing = { code, expiresAt: Date.now() + PAIR_CODE_TTL_MS };
    return { code, expiresAt: this.pairing.expiresAt };
  }

  authenticate(req) {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(header);
    if (!match) return null;
    const hash = sha256(match[1]);
    const list = this.loadClients();
    const client = list.find((item) => item.hash.length === hash.length && crypto.timingSafeEqual(Buffer.from(item.hash), Buffer.from(hash)));
    if (!client) return null;
    // 记录最近使用时间（最多每分钟写一次）
    if (!client.lastUsedAt || Date.now() - client.lastUsedAt > 60000) {
      client.lastUsedAt = Date.now();
      this.saveClients(list);
    }
    return client;
  }

  /** 直接签发令牌（给 MCP 客户端等无法走配对码流程的工具），令牌只在此时返回一次 */
  issueToken(name) {
    const token = crypto.randomBytes(32).toString('hex');
    const client = {
      id: crypto.randomUUID(),
      name: String(name || 'MCP 客户端').slice(0, 60),
      hash: sha256(token),
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    this.saveClients([...this.loadClients(), client]);
    this.emit('clients-changed');
    return { token, clientId: client.id };
  }

  pair({ code, name }) {
    const now = Date.now();
    this.pairAttempts = this.pairAttempts.filter((at) => now - at < 60000);
    if (this.pairAttempts.length >= PAIR_ATTEMPTS_PER_MINUTE) throw new HttpError(429, '尝试次数过多，请一分钟后再试', 'RATE_LIMITED');
    this.pairAttempts.push(now);
    if (!this.pairing || this.pairing.expiresAt < now) throw new HttpError(400, '请先在 Flota 中生成配对码', 'NO_PAIRING');
    if (String(code || '').trim() !== this.pairing.code) throw new HttpError(401, '配对码不正确', 'BAD_CODE');
    this.pairing = null;
    const token = crypto.randomBytes(32).toString('hex');
    const client = {
      id: crypto.randomUUID(),
      name: String(name || '浏览器扩展').slice(0, 60),
      hash: sha256(token),
      createdAt: now,
      lastUsedAt: now,
    };
    this.saveClients([...this.loadClients(), client]);
    this.emit('clients-changed');
    return { token, clientId: client.id };
  }

  // ==================== HTTP ====================

  async start() {
    if (this.server) return this.port;
    for (const port of PORTS) {
      try {
        await new Promise((resolve, reject) => {
          const server = http.createServer((req, res) => this.handle(req, res));
          server.once('error', reject);
          server.listen(port, '127.0.0.1', () => {
            server.removeListener('error', reject);
            this.server = server;
            this.port = port;
            resolve();
          });
        });
        console.log(`[Ingress] 本地接收服务已启动：127.0.0.1:${port}`);
        return port;
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
      }
    }
    console.warn('[Ingress] 端口均被占用，本地接收服务未启动');
    return null;
  }

  stop() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
    this.port = null;
  }

  status() {
    return {
      running: Boolean(this.server),
      port: this.port,
      pairing: this.pairing && this.pairing.expiresAt > Date.now() ? { code: this.pairing.code, expiresAt: this.pairing.expiresAt } : null,
      clients: this.listClients(),
    };
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new HttpError(413, '内容过大（上限 20MB）', 'TOO_LARGE'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new HttpError(400, '请求体不是合法 JSON', 'BAD_JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  send(res, status, body, origin) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  async handle(req, res) {
    const origin = req.headers.origin || '';
    const allowedOrigin = origin && EXTENSION_ORIGIN.test(origin) ? origin : '';
    try {
      if (origin && !allowedOrigin) throw new HttpError(403, '不允许来自网页的请求', 'FORBIDDEN_ORIGIN');
      // Host 头校验：防 DNS rebinding
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || '')) throw new HttpError(403, '非法 Host', 'FORBIDDEN_HOST');

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        });
        return res.end();
      }

      const { pathname } = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && pathname === '/v1/ping') {
        const client = this.authenticate(req);
        return this.send(res, 200, { app: 'Flota', version: this.version, port: this.port, paired: Boolean(client) }, allowedOrigin);
      }
      if (req.method === 'POST' && pathname === '/v1/pair') {
        const body = await this.readBody(req);
        return this.send(res, 200, this.pair(body), allowedOrigin);
      }

      const client = this.authenticate(req);
      if (!client) throw new HttpError(401, '未配对或令牌已失效，请重新配对', 'UNAUTHORIZED');

      // MCP（Streamable HTTP，无状态）：外部 Agent 以令牌访问 Flota 的笔记、待办、剪藏与组件
      if (pathname === '/mcp') {
        if (!this.createMcpServer) throw new HttpError(404, 'MCP 未启用', 'NOT_FOUND');
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
          return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
        }
        const body = await this.readBody(req);
        const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
        const server = this.createMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return undefined;
      }

      if (req.method === 'GET' && pathname === '/v1/targets') {
        return this.send(res, 200, await this.getTargets(), allowedOrigin);
      }

      const kindMatch = /^\/v1\/([a-z][a-z0-9-]{0,31})$/.exec(pathname);
      if (req.method === 'POST' && kindMatch) {
        const handler = this.resolveHandler(kindMatch[1]);
        if (!handler) throw new HttpError(503, kindMatch[1] === 'clip' ? '“网页剪藏”插件未启用，请在 Flota 插件中心启用' : `没有处理 ${kindMatch[1]} 的插件`, 'NO_HANDLER');
        const body = await this.readBody(req);
        const result = await handler(body, { client: { id: client.id, name: client.name } });
        return this.send(res, 200, result ?? { ok: true }, allowedOrigin);
      }

      throw new HttpError(404, '未知接口', 'NOT_FOUND');
    } catch (error) {
      const status = error.status || (error.code === 'INVALID_URL' || error.code === 'NO_CONTENT' ? 400 : 500);
      if (status >= 500 && status !== 503) console.error('[Ingress] 处理请求失败:', error);
      return this.send(res, status, { error: error.message, code: error.code || 'ERROR' }, allowedOrigin);
    }
  }
}

module.exports = IngressService;
