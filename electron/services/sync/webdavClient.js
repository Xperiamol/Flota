/**
 * Flota v3.0 原子化同步系统 - WebDAV 客户端
 *
 * 提供简洁的 WebDAV 操作接口，内置限流和重试机制
 */

const axios = require('axios');
const ConcurrencyLimiter = require('./utils/ConcurrencyLimiter');

/**
 * WebDAV 客户端类
 */
class WebDAVClient {
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

    // 限流器：最大并发数为 3
    this.limiter = new ConcurrencyLimiter(3);

    // 请求计数器和冷却管理
    this.requestCount = 0;
    this.requestWindowStart = Date.now();
    this.maxRequestsPer30Min = 600; // WebDAV 限制 600 reqs / 30min
    this.requestDelay = 200; // 每次请求间隔 200ms

    // 最后一次请求时间
    this.lastRequestTime = 0;
  }

  /**
   * 通用 HTTP 请求方法（带限流和重试）
   * @private
   * @param {Object} options - axios 请求选项
   * @returns {Promise<any>} 响应数据
   */
  async request(options) {
    return this.limiter.run(async () => {
      // 应用请求间隔
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await this.sleep(this.requestDelay - timeSinceLastRequest);
      }

      // 检查是否需要冷却（每 50 个请求 sleep 2s）
      this.requestCount++;
      if (this.requestCount % 50 === 0) {
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
          return response;
        } catch (error) {
          lastError = error;

          // 判断是否可重试
          const isRetriable = this.isRetriableError(error);
          const isLastAttempt = attempt === this.retryAttempts - 1;

          if (!isRetriable || isLastAttempt) {
            throw this.normalizeError(error);
          }

          // 指数退避
          const backoffTime = Math.min(1000 * Math.pow(2, attempt), 8000);
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
    if (!error.response) {
      // 网络错误
      return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(error.code);
    }

    // HTTP 状态码
    const status = error.response.status;
    return [408, 429, 500, 502, 503, 504].includes(status);
  }

  /**
   * 规范化错误信息
   * @private
   */
  normalizeError(error) {
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;

      if (status === 401) {
        return new Error('WebDAV 认证失败：用户名或密码错误');
      } else if (status === 403) {
        return new Error('WebDAV 权限不足：无法访问该资源');
      } else if (status === 404) {
        return new Error('WebDAV 资源不存在');
      } else if (status === 405) {
        return new Error('WebDAV 不支持该操作');
      } else if (status === 409) {
        return new Error('WebDAV 资源冲突 (409): 可能父目录不存在或资源已存在');
      } else if (status === 507) {
        return new Error('WebDAV 存储空间不足');
      } else if (status >= 500) {
        return new Error(`WebDAV 服务器错误 (${status}): ${statusText}`);
      } else {
        return new Error(`WebDAV 请求失败 (${status}): ${statusText}`);
      }
    } else if (error.code) {
      const networkErrors = {
        ENOTFOUND: '网络连接失败：无法解析域名',
        ETIMEDOUT: '网络连接超时',
        ECONNREFUSED: '连接被拒绝',
        ECONNRESET: '连接被重置',
      };
      return new Error(networkErrors[error.code] || `网络错误: ${error.code}`);
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
   * @returns {Promise<boolean>} 是否连接成功
   */
  async testConnection() {
    try {
      const response = await this.request({
        method: 'PROPFIND',
        url: this.baseUrl,
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
      if (error.message.includes('不支持该操作') || error.message.includes('冲突')) {
        // 忽略，可能是目录已存在
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
    await this.request({
      method: 'PUT',
      url: this.getFullPath(remotePath),
      headers: {
        'Content-Type': contentType,
      },
      data: content,
    });
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
    const response = await this.request({
      method: 'GET',
      url: this.getFullPath(remotePath),
      responseType: 'text',
    });
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
    try {
      await this.request({
        method: 'DELETE',
        url: this.getFullPath(remotePath),
      });
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
