const https = require('https');
const { performance } = require('perf_hooks');
const { HttpsProxyAgent } = require('https-proxy-agent');
const SettingDAO = require('../dao/SettingDAO');

/**
 * 代理配置服务
 * 负责代理的配置、测试和应用
 */
class ProxyService {
  constructor() {
    this.settingDAO = new SettingDAO();
    this.TEST_URL = 'https://www.googleapis.com/discovery/v1/apis';
    this.TEST_TIMEOUT = 10000; // 10秒
  }

  /**
   * 获取代理配置
   * @returns {object} 代理配置对象
   */
  getConfig() {
    try {
      const enabled = this.settingDAO.get('proxy_enabled');
      const protocol = this.settingDAO.get('proxy_protocol');
      const host = this.settingDAO.get('proxy_host');
      const port = this.settingDAO.get('proxy_port');

      console.log('[ProxyService] 读取配置:', { enabled, protocol, host, port });

      // 修复损坏的 protocol 数据
      let protocolValue = protocol?.value || 'http';
      if (protocolValue === '[object Object]' || typeof protocolValue !== 'string') {
        console.warn('[ProxyService] 检测到损坏的 protocol 值，重置为 http');
        protocolValue = 'http';
        // 立即修复数据库
        this.settingDAO.set('proxy_protocol', 'http');
      }

      const config = {
        enabled: enabled?.value === 'true',
        protocol: protocolValue,
        host: host?.value || '127.0.0.1',
        port: port?.value || '7890'
      };

      console.log('[ProxyService] 解析后配置:', config);
      return config;
    } catch (error) {
      console.error('[ProxyService] 获取配置失败:', error);
      return this._getDefaultConfig();
    }
  }

  /**
   * 保存代理配置
   * @param {object} config - 代理配置
   * @returns {object} 操作结果
   */
  saveConfig(config) {
    try {
      console.log('[ProxyService] 保存配置:', config);
      
      // 确保 protocol 是字符串，不是对象
      const protocol = typeof config.protocol === 'string' 
        ? config.protocol 
        : (config.protocol?.value || 'http');
      
      console.log('[ProxyService] 标准化的 protocol:', protocol);
      
      this.settingDAO.set('proxy_enabled', String(config.enabled));
      this.settingDAO.set('proxy_protocol', protocol);
      this.settingDAO.set('proxy_host', config.host);
      this.settingDAO.set('proxy_port', config.port);

      // 立即应用代理配置
      const normalizedConfig = {
        ...config,
        protocol
      };
      this.applyConfig(normalizedConfig);

      return { success: true, message: '代理配置已保存' };
    } catch (error) {
      console.error('[ProxyService] 保存配置失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 应用代理配置到当前进程
   * @param {object} config - 代理配置
   */
  applyConfig(config) {
    if (config.enabled) {
      const proxyUrl = this._buildProxyUrl(config);
      process.env.HTTP_PROXY = proxyUrl;
      process.env.HTTPS_PROXY = proxyUrl;
      console.log('[ProxyService] 已应用代理:', proxyUrl);
    } else {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      console.log('[ProxyService] 已禁用代理');
    }
  }

  /**
   * 测试代理连接
   * @param {object} config - 代理配置
   * @returns {Promise<object>} 测试结果
   */
  async testConnection(config) {
    const proxyUrl = this._buildProxyUrl(config);
    console.log('[ProxyService] 测试代理:', proxyUrl);
    console.log('[ProxyService] 目标 URL:', this.TEST_URL);

    try {
      const latency = await this._performHttpsRequest(proxyUrl);
      return {
        success: true,
        data: {
          latency,
          message: `代理连接成功！延迟: ${latency}ms`
        }
      };
    } catch (error) {
      console.error('[ProxyService] 测试失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 执行 HTTPS 请求测试
   * @param {string} proxyUrl - 代理 URL
   * @returns {Promise<number>} 延迟时间(ms)
   * @private
   */
  _performHttpsRequest(proxyUrl) {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const proxyAgent = new HttpsProxyAgent(proxyUrl);

      const options = {
        hostname: 'www.googleapis.com',
        port: 443,
        path: '/discovery/v1/apis',
        method: 'GET',
        headers: { 'User-Agent': 'Flota/2.0' },
        agent: proxyAgent,
        timeout: this.TEST_TIMEOUT
      };

      const req = https.request(options, (res) => {
        const latency = Math.round(performance.now() - startTime);
        console.log('[ProxyService] 响应状态码:', res.statusCode);
        console.log('[ProxyService] 延迟:', latency, 'ms');

        if (res.statusCode === 200) {
          res.resume(); // 消费响应数据
          resolve(latency);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: 无法访问 Google API`));
        }
      });

      req.on('error', (error) => {
        reject(new Error(`代理连接失败: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`代理连接超时 (${this.TEST_TIMEOUT / 1000}秒)`));
      });

      req.end();
    });
  }

  /**
   * 构建代理 URL
   * @param {object} config - 代理配置
   * @returns {string} 代理 URL
   * @private
   */
  _buildProxyUrl(config) {
    return `${config.protocol}://${config.host}:${config.port}`;
  }

  /**
   * 获取默认配置
   * @returns {object} 默认代理配置
   * @private
   */
  _getDefaultConfig() {
    return {
      enabled: false,
      protocol: 'http',
      host: '127.0.0.1',
      port: '7890'
    };
  }
}

module.exports = ProxyService;
