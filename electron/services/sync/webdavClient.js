/**
 * Flota v3.0 原子化同步系统 - WebDAV 客户端
 *
 * 提供简洁的 WebDAV 操作接口，内置限流和重试机制
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const ConcurrencyLimiter = require('./utils/ConcurrencyLimiter');

// #N7：限流计数器持久化路径（重启后恢复，避免短时间内多次启动绕过限流）
function getRateLimitStatePath() {
  try {
    return path.join(app.getPath('userData'), 'webdav-rate-limit.json');
  } catch (_) {
    return null;
  }
}

/**
 * WebDAV 客户端类
 */
class WebDAVClient {
  /**
   * 取 WebDAV 地址的主机名（小写），解析失败返回空串
   * @param {string} baseUrl
   * @returns {string}
   */
  static getHost(baseUrl) {
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  /**
   * 是否坚果云（只有坚果云需要按其请求次数限制节流）
   * @param {string} baseUrl
   * @returns {boolean}
   */
  static isNutstoreUrl(baseUrl) {
    return /(^|\.)jianguoyun\.com$/.test(WebDAVClient.getHost(baseUrl));
  }

  /**
   * 创建 WebDAV 客户端实例
   * @param {import('./types').WebDAVConfig} config - 配置
   */
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://dav.jianguoyun.com/dav';
    this.username = config.username;
    this.password = config.password;
    this.timeout = config.timeout || 30000;
    this.retryAttempts = config.retryAttempts || 3;

    // 节流参数按服务商区分：坚果云有 600 次 / 30 分钟的硬限制；自建或其他 WebDAV 没有，
    // 沿用同一套节流只会让首次全量同步白白变慢。429 退避对所有服务都生效。
    this.host = WebDAVClient.getHost(this.baseUrl);
    this.isNutstore = WebDAVClient.isNutstoreUrl(this.baseUrl);

    // 限流器：坚果云并发 3，其他服务并发 6
    this.limiter = new ConcurrencyLimiter(this.isNutstore ? 3 : 6);

    // 请求计数器和冷却管理
    this.requestCount = 0;
    this.requestWindowStart = Date.now();
    this.maxRequestsPer30Min = this.isNutstore ? 600 : Infinity; // 坚果云限制 600 reqs / 30min
    this.requestDelay = this.isNutstore ? 200 : 0; // 坚果云每次请求间隔 200ms
    this.cooldownEvery = this.isNutstore ? 50 : 0; // 坚果云每 50 个请求冷却 2s

    // 最后一次请求时间
    this.lastRequestTime = 0;

    // #N7：429 长退避状态（指数退避，至少 60s，上限 5min）
    this.rateLimitedUntil = 0;
    this.consecutive429 = 0;

    // #N7：从磁盘恢复限流状态（防止短时间内重启绕过 30min 窗口）
    this._loadRateLimitState();
  }

  /**
   * #N7：从磁盘恢复限流状态
   * @private
   */
  _loadRateLimitState() {
    try {
      const p = getRateLimitStatePath();
      if (!p || !fs.existsSync(p)) return;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      // 状态属于哪台服务器：换了服务器就不继承旧服务器的计数和退避。
      // 旧版本写的文件没有 host 字段，那时只有坚果云会触发限流，按坚果云处理。
      const savedHost = data.host || (this.isNutstore ? this.host : null);
      if (savedHost !== this.host) return;
      const now = Date.now();
      const windowAge = now - (data.requestWindowStart || 0);
      // 仅当上次窗口未超过 30 分钟时恢复
      if (windowAge >= 0 && windowAge < 30 * 60 * 1000) {
        this.requestCount = Number.isFinite(data.requestCount) ? data.requestCount : 0;
        this.requestWindowStart = data.requestWindowStart;
      }
      // 恢复 429 退避截止时间
      if (data.rateLimitedUntil && data.rateLimitedUntil > now) {
        this.rateLimitedUntil = data.rateLimitedUntil;
        this.consecutive429 = Number.isFinite(data.consecutive429) ? data.consecutive429 : 1;
      }
    } catch (e) {
      // 损坏文件忽略
    }
  }

  /**
   * #N7：保存限流状态到磁盘（异步，不阻塞）
   * @private
   */
  _saveRateLimitState() {
    try {
      const p = getRateLimitStatePath();
      if (!p) return;
      const payload = JSON.stringify({
        host: this.host,
        requestCount: this.requestCount,
        requestWindowStart: this.requestWindowStart,
        rateLimitedUntil: this.rateLimitedUntil,
        consecutive429: this.consecutive429,
        savedAt: Date.now(),
      });
      // 自查修正：用同步写避免多次并发 writeFile 竞态导致内容丢失
      // 内容很小（几十字节），同步 I/O 开销可忽略
      fs.writeFileSync(p, payload, 'utf8');
    } catch (_) {}
  }

  /**
   * 通用 HTTP 请求方法（带限流和重试）
   * @private
   * @param {Object} options - axios 请求选项
   * @returns {Promise<any>} 响应数据
   */
  async request(options) {
    return this.limiter.run(async () => {
      // #N7：检查 429 长退避（指数退避，避免持续触发 429）
      const nowCheck = Date.now();
      if (this.rateLimitedUntil > nowCheck) {
        const waitMs = this.rateLimitedUntil - nowCheck;
        console.warn(`[WebDAV] 仍处于 429 退避期，等待 ${Math.ceil(waitMs / 1000)} 秒...`);
        await this.sleep(waitMs);
      }

      // 应用请求间隔
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await this.sleep(this.requestDelay - timeSinceLastRequest);
      }

      // 检查是否需要冷却（每 50 个请求 sleep 2s）
      this.requestCount++;
      if (this.cooldownEvery && this.requestCount % this.cooldownEvery === 0) {
        console.log(`[WebDAV] 已发送 ${this.requestCount} 个请求，冷却 2 秒...`);
        await this.sleep(2000);
      }

      // 检查 30 分钟窗口内的请求数
      const timeElapsed = now - this.requestWindowStart;
      if (timeElapsed > 30 * 60 * 1000) {
        // 重置窗口
        this.requestCount = 0;
        this.requestWindowStart = now;
      } else if (this.requestCount >= this.maxRequestsPer30Min) {
        // 达到限制，等待窗口结束
        const waitTime = 30 * 60 * 1000 - timeElapsed;
        console.warn(`[WebDAV] 达到 30 分钟请求限制，等待 ${Math.ceil(waitTime / 1000)} 秒...`);
        await this.sleep(waitTime);
        this.requestCount = 0;
        this.requestWindowStart = Date.now();
      }

      // #N7：每次请求前持久化（保证重启后窗口能恢复）；没有请求窗口的服务不需要
      if (this.isNutstore) this._saveRateLimitState();

      // 执行带重试的请求
      let lastError;
      for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
        try {
          const response = await axios({
            ...options,
            auth: {
              username: this.username,
              password: this.password,
            },
            timeout: this.timeout,
            maxRedirects: 5,
          });

          this.lastRequestTime = Date.now();
          // #N7：成功则清零连续 429 计数
          if (this.consecutive429 > 0) {
            this.consecutive429 = 0;
            this.rateLimitedUntil = 0;
            this._saveRateLimitState();
          }
          return response;
        } catch (error) {
          lastError = error;

          // #N7：命中 429 则进入指数长退避（60s → 120s → 240s，上限 300s）
          let rateLimitWaitMs = 0;
          if (error.response && error.response.status === 429) {
            this.consecutive429++;
            const backoffSec = Math.min(60 * Math.pow(2, this.consecutive429 - 1), 300);
            this.rateLimitedUntil = Date.now() + backoffSec * 1000;
            rateLimitWaitMs = backoffSec * 1000;
            this._saveRateLimitState();
            console.warn(`[WebDAV] 命中 429，进入 ${backoffSec}s 退避（连续第 ${this.consecutive429} 次）`);
          }

          // 判断是否可重试
          const isRetriable = this.isRetriableError(error);
          const isLastAttempt = attempt === this.retryAttempts - 1;

          if (!isRetriable || isLastAttempt) {
            throw this.normalizeError(error);
          }

          // 429 必须在当前 retry loop 中也执行长退避，不能只影响下一次 request
          const backoffTime = rateLimitWaitMs || Math.min(1000 * Math.pow(2, attempt), 8000);
          console.warn(`[WebDAV] 请求失败 (${attempt + 1}/${this.retryAttempts})，${backoffTime}ms 后重试:`, error.message);
          await this.sleep(backoffTime);
        }
      }

      throw this.normalizeError(lastError);
    });
  }

  /**
   * 判断错误是否可重试
   * @private
   */
  isRetriableError(error) {
    const retriableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE'];
    if (retriableCodes.includes(error.code)) {
      return true;
    }

    if (!error.response) {
      return false;
    }

    // HTTP 状态码（包含流在 2xx 响应头返回后中途断开的异常情况）
    const status = error.response.status;
    if (status >= 200 && status < 300) {
      return true;
    }
    return [408, 429, 500, 502, 503, 504].includes(status);
  }

  /**
   * 规范化错误信息
   * @private
   */
  normalizeError(error) {
    const networkErrors = {
      ENOTFOUND: '网络连接失败：无法解析域名',
      ETIMEDOUT: '网络连接超时',
      ECONNREFUSED: '连接被拒绝',
      ECONNRESET: '连接被重置',
      ECONNABORTED: '请求传输超时或中断',
      ERR_STREAM_PREMATURE_CLOSE: '响应流传输中断',
    };

    if (error.response && !(error.response.status >= 200 && error.response.status < 300)) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      // 提取请求方法 + URL 路径，便于定位是哪一步失败
      const method = (error.config?.method || '').toUpperCase();
      const url = error.config?.url || '';
      let pathInfo = '';
      try {
        pathInfo = url ? new URL(url).pathname : '';
      } catch (_) {
        pathInfo = url;
      }
      const where = method && pathInfo ? ` [${method} ${pathInfo}]` : '';
      // 提取服务器返回的 body（部分 WebDAV 服务会在 body 里写明原因，比如坚果云的限流文案）
      let serverDetail = '';
      const data = error.response.data;
      if (typeof data === 'string' && data.trim()) {
        serverDetail = data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      } else if (data && typeof data === 'object' && data.message) {
        serverDetail = String(data.message).slice(0, 160);
      }
      const detailSuffix = serverDetail ? `（${serverDetail}）` : '';

      if (status === 412) {
        const conflict = new Error('其他设备已更新云端，当前提交已停止；本地修改会保留并在下次同步重新合并');
        conflict.code = 'SYNC_CONCURRENT_WRITE';
        conflict.status = 412;
        return conflict;
      } else if (status === 401) {
        return new Error(`WebDAV 认证失败：用户名或密码错误${where}${detailSuffix}`);
      } else if (status === 403) {
        return new Error(
          `WebDAV 权限不足或存储空间/流量耗尽${where}${detailSuffix}。` +
          (this.isNutstore
            ? `坚果云常见原因：① 当月免费流量已用完（1GB/3GB）；② 应用密码未开启写权限；③ 同步盘已满或文件被锁定。`
            : `请检查该账号对同步目录是否有读写权限，以及服务器前的防火墙（如宝塔 WAF）是否拦截了 PROPFIND/MKCOL/PUT 等请求。`)
        );
      } else if (status === 404) {
        return new Error(`WebDAV 资源不存在${where}${detailSuffix}`);
      } else if (status === 405) {
        return new Error(`WebDAV 不支持该操作${where}${detailSuffix}`);
      } else if (status === 409) {
        return new Error(`WebDAV 资源冲突 (409)${where}：可能父目录不存在或资源已存在${detailSuffix}`);
      } else if (status === 423) {
        return new Error(`WebDAV 资源被锁定 (423)${where}${detailSuffix}`);
      } else if (status === 429) {
        return new Error(this.isNutstore
          ? `WebDAV 请求过于频繁 (429)${where}：已达到坚果云每 30 分钟的请求次数上限${detailSuffix}`
          : `WebDAV 请求过于频繁 (429)${where}：服务器限制了请求频率${detailSuffix}`);
      } else if (status === 507) {
        return new Error(`WebDAV 存储空间不足${where}${detailSuffix}`);
      } else if (status >= 500) {
        return new Error(`WebDAV 服务器错误 (${status})${where}: ${statusText}${detailSuffix}`);
      } else {
        return new Error(`WebDAV 请求失败 (${status})${where}: ${statusText}${detailSuffix}`);
      }
    } else if (error.code) {
      return new Error(networkErrors[error.code] || `网络错误: ${error.code}`);
    } else if (error.response && error.response.status >= 200 && error.response.status < 300) {
      return new Error(error.message ? `WebDAV 响应传输中断: ${error.message}` : 'WebDAV 响应传输中断');
    }

    return error;
  }

  /**
   * 睡眠函数
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 拼接完整路径
   * @private
   */
  getFullPath(remotePath) {
    // 确保路径以 / 开头
    if (!remotePath.startsWith('/')) {
      remotePath = '/' + remotePath;
    }
    return this.baseUrl + remotePath;
  }

  // ==================== 公共 API ====================

  /**
   * 测试连接
   * 注意：URL 必须以 `/` 结尾，否则坚果云会返回 301 重定向到带斜杠的版本，
   * 而 axios 跟随重定向时**不会**带上 Authorization 头，从而导致 401 假性失败。
   * @returns {Promise<boolean>} 是否连接成功
   */
  async testConnection() {
    try {
      const url = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
      const response = await this.request({
        method: 'PROPFIND',
        url,
        headers: {
          'Depth': '0',
          'Content-Type': 'application/xml',
        },
      });
      return response.status === 207;
    } catch (error) {
      throw new Error(`WebDAV 连接测试失败: ${error.message}`);
    }
  }

  /**
   * 检查文件/目录是否存在
   * @param {string} remotePath - 远程路径
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(remotePath) {
    try {
      const response = await this.request({
        method: 'PROPFIND',
        url: this.getFullPath(remotePath),
        headers: {
          'Depth': '0',
        },
      });
      return response.status === 207;
    } catch (error) {
      // 404 或 409 都表示资源不存在（409 通常是父目录不存在）
      if (error.message.includes('不存在') || error.message.includes('冲突') || error.message.includes('409')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 创建目录
   * @param {string} remotePath - 远程路径
   * @returns {Promise<void>}
   */
  async createDirectory(remotePath) {
    try {
      // 先检查目录是否已存在
      const exists = await this.exists(remotePath);
      if (exists) {
        return; // 目录已存在，直接返回
      }

      await this.request({
        method: 'MKCOL',
        url: this.getFullPath(remotePath),
      });
    } catch (error) {
      // 405 表示目录已存在，409 可能表示父目录不存在或冲突
      // 403 必须传播；不能把没有写权限当成目录已成功创建。
      if (
        error.message.includes('不支持该操作') ||
        error.message.includes('冲突')
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * 上传文件（文本内容）
   * @param {string} remotePath - 远程路径
   * @param {string} content - 文件内容
   * @param {string} [contentType='text/plain; charset=utf-8'] - Content-Type
   * @returns {Promise<void>}
   */
  async uploadText(remotePath, content, contentType = 'text/plain; charset=utf-8') {
    // 未读过的路径只允许创建；初始化时 HEAD 与 PUT 之间也可能有另一设备写入。
    await this.verifyUnchangedBeforeOverwrite(remotePath);
    const expected = this._writeVersions ? (this._writeVersions.get(remotePath) ?? null) : undefined;
    let response;
    try {
      response = await this.request({
        method: 'PUT',
        url: this.getFullPath(remotePath),
        headers: {
          'Content-Type': contentType,
          // 有强 ETag 仍带 If-Match（支持的服务器多一层保护）；'' 表示没有强 ETag，只靠上面的内容比对
          ...(expected === null ? { 'If-None-Match': '*' } : expected ? { 'If-Match': expected } : {}),
        },
        data: content,
      });
    } catch (error) {
      // PUT 可能已完成但响应丢失；重试收到 412 时，只确认完全相同的正文。
      if (error.code !== 'SYNC_CONCURRENT_WRITE' || await this.downloadText(remotePath) !== content) throw error;
      this._writtenBodies?.set(remotePath, content);
      return;
    }
    if (this._writeVersions) {
      const etag = response.headers?.etag;
      this._writeVersions.set(remotePath, etag && !etag.startsWith('W/') ? etag : '');
      this._writtenBodies.set(remotePath, content);
    }
  }

  beginSync() { this._writeVersions = new Map(); this._readBodies = new Map(); this._writtenBodies = new Map(); this._justVerified = new Set(); }

  /**
   * 覆盖或删除云端已有文件前，重读并比对内容：必须仍是本轮读到的版本（或本机刚写入的版本）。
   * 不能只靠 If-Match：有的服务器不给强 ETag（不返回，或经 nginx 压缩变成 W/ 弱 ETag），
   * 有的给了强 ETag 却不处理条件请求（实测 dufs 会直接覆盖）。重读与写入之间仍有极短的竞争窗口。
   * prepareWrite 刚读过的路径不再重复读取。新建文件（没有已知版本）不在此处理。
   */
  async verifyUnchangedBeforeOverwrite(remotePath) {
    const expected = this._writeVersions?.get(remotePath);
    if (typeof expected !== 'string') return;
    if (this._justVerified?.delete(remotePath)) return;
    const ownBody = this._writtenBodies?.get(remotePath);
    const readBefore = this._readBodies?.has(remotePath);
    await this.prepareWrite(remotePath, readBefore || ownBody === undefined ? undefined : value => value === ownBody);
    this._justVerified?.delete(remotePath);
  }

  async prepareWrite(remotePath, validate) {
    const previous = this._readBodies?.get(remotePath);
    try {
      const content = await this.downloadText(remotePath);
      // 与服务器返回 412 同一种冲突：调用方按 SYNC_CONCURRENT_WRITE 统一处理
      const conflict = (message) => Object.assign(new Error(message), { code: 'SYNC_CONCURRENT_WRITE' });
      if (previous !== undefined && content !== previous && content !== this._writtenBodies?.get(remotePath)) {
        throw conflict('读取后云端内容发生变化，已停止覆盖，请重新同步');
      }
      if (validate && !validate(content)) throw conflict('云端正文已被其他设备修改，已停止覆盖并等待重新合并');
      this._justVerified?.add(remotePath);
    } catch (error) {
      if (!/^WebDAV 资源不存在/.test(error.message || '')) throw error;
      this._writeVersions.set(remotePath, null);
    }
  }

  /**
   * 上传 JSON 文件
   * @param {string} remotePath - 远程路径
   * @param {Object} data - JSON 数据
   * @returns {Promise<void>}
   */
  async uploadJson(remotePath, data) {
    const content = JSON.stringify(data, null, 2);
    await this.uploadText(remotePath, content, 'application/json; charset=utf-8');
  }

  /**
   * 上传二进制文件
   * @param {string} remotePath - 远程路径
   * @param {Buffer} buffer - 文件内容
   * @param {string} [contentType='application/octet-stream'] - Content-Type
   * @returns {Promise<void>}
   */
  async uploadBinary(remotePath, buffer, contentType = 'application/octet-stream') {
    await this.request({
      method: 'PUT',
      url: this.getFullPath(remotePath),
      headers: {
        'Content-Type': contentType,
      },
      data: buffer,
    });
  }

  /**
   * 下载文件（文本内容）
   * @param {string} remotePath - 远程路径
   * @returns {Promise<string>} 文件内容
   */
  async downloadText(remotePath) {
    let response;
    try { response = await this.request({
      method: 'GET',
      url: this.getFullPath(remotePath),
      responseType: 'text',
      // 不要压缩：nginx 等反向代理压缩响应时会把强 ETag 改成弱 ETag，条件写入就用不了
      headers: { 'Accept-Encoding': 'identity' },
    }); } catch (error) {
      if (this._writeVersions && /^WebDAV 资源不存在/.test(error.message || '')) this._writeVersions.set(remotePath, null);
      throw error;
    }
    if (this._writeVersions) {
      const etag = response.headers?.etag;
      this._writeVersions.set(remotePath, etag && !etag.startsWith('W/') ? etag : '');
      this._readBodies.set(remotePath, response.data);
    }
    return response.data;
  }

  /**
   * 下载 JSON 文件
   * @param {string} remotePath - 远程路径
   * @returns {Promise<any>} 解析后的 JSON 数据
   */
  async downloadJson(remotePath) {
    const content = await this.downloadText(remotePath);
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`解析 JSON 失败 (${remotePath}): ${error.message}`);
    }
  }

  /**
   * 下载二进制文件
   * @param {string} remotePath - 远程路径
   * @returns {Promise<Buffer>} 文件内容
   */
  async downloadBinary(remotePath) {
    const response = await this.request({
      method: 'GET',
      url: this.getFullPath(remotePath),
      responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
  }

  /**
   * 删除文件或目录
   * @param {string} remotePath - 远程路径
   * @returns {Promise<void>}
   */
  async delete(remotePath) {
    await this.verifyUnchangedBeforeOverwrite(remotePath);
    const expected = this._writeVersions?.get(remotePath);
    try {
      await this.request({
        method: 'DELETE',
        url: this.getFullPath(remotePath),
        headers: expected ? { 'If-Match': expected } : {},
      });
      if (this._writeVersions) this._writeVersions.delete(remotePath);
    } catch (error) {
      // 404 表示文件不存在，忽略
      if (!error.message.includes('不存在')) {
        throw error;
      }
    }
  }

  /**
   * 列出目录内容
   * @param {string} remotePath - 远程路径
   * @param {number} [depth=1] - 深度 (1=当前目录, Infinity=递归)
   * @returns {Promise<Array<{href: string, isDirectory: boolean}>>} 文件列表
   */
  async list(remotePath, depth = 1) {
    const response = await this.request({
      method: 'PROPFIND',
      url: this.getFullPath(remotePath),
      headers: {
        'Depth': String(depth),
        'Content-Type': 'application/xml',
      },
    });

    // 简单解析 WebDAV XML 响应
    const xmlData = response.data;
    const files = [];

    // 提取 <D:href> 标签
    const hrefRegex = /<D:href>([^<]+)<\/D:href>/gi;
    let match;
    while ((match = hrefRegex.exec(xmlData)) !== null) {
      const href = match[1];
      if (href === remotePath || href === remotePath + '/') {
        continue; // 跳过当前目录
      }
      files.push({
        href: href,
        isDirectory: href.endsWith('/'),
      });
    }

    return files;
  }

  /**
   * 重置请求计数器（用于测试）
   */
  resetRequestCounter() {
    this.requestCount = 0;
    this.requestWindowStart = Date.now();
  }
}

module.exports = WebDAVClient;
