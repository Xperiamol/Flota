/**
 * 联网搜索服务（对外入口）
 *
 * 默认对接官方端点：
 *   POST https://open.feedcoopapi.com/search_api/web_search
 *
 * 请求体对齐官方示例：
 * {
 *   Query, SearchType: "web_summary", Count,
 *   Filter: { NeedContent: false, NeedUrl: true },
 *   NeedSummary: true
 * }
 *
 * 响应支持普通 JSON 与按行/SSE 风格，解析逻辑见 normalizer.js。
 */

const { getInstance: getLogger } = require('../LoggerService');
const { PROVIDER_ENDPOINTS, DEFAULT_PROVIDER } = require('./providers');
const {
  cleanText,
  extractPayloads,
  extractError,
  extractInlineError,
  normalizeResults,
  formatResults
} = require('./normalizer');

const isEnabledSetting = (value) => value === true || value === 'true' || value === 1 || value === '1';

class WebSearchService {
  constructor(aiService) {
    this.aiService = aiService;
    this.logger = getLogger();
  }

  _normalizeConfig(config = {}) {
    return {
      webSearchEnabled: config.webSearchEnabled,
      webSearchProvider: config.webSearchProvider || DEFAULT_PROVIDER,
      webSearchApiKey: config.webSearchApiKey || '',
      webSearchApiUrl: config.webSearchApiUrl || '',
      webSearchCount: config.webSearchCount
    };
  }

  async _getConfig() {
    const result = await this.aiService.getConfig();
    if (!result.success) throw new Error(result.error || '获取配置失败');
    return result.data;
  }

  async isEnabled() {
    try {
      const cfg = await this._getConfig();
      return isEnabledSetting(cfg.webSearchEnabled) && Boolean(cfg.webSearchApiKey);
    } catch (_) {
      return false;
    }
  }

  async testConnection(configOverride = null) {
    const cfg = configOverride ? this._normalizeConfig(configOverride) : await this._getConfig();
    if (!isEnabledSetting(cfg.webSearchEnabled)) {
      return { success: false, error: '请先开启联网搜索' };
    }
    if (!cfg.webSearchApiKey) {
      return { success: false, error: '请先填写联网搜索 API 密钥' };
    }
    if ((cfg.webSearchProvider || DEFAULT_PROVIDER) === 'custom' && !String(cfg.webSearchApiUrl || '').trim()) {
      return { success: false, error: '自定义搜索端点不能为空' };
    }

    const result = await this.search('最新 AI 新闻', { count: 3, configOverride: cfg });
    if (!result.success) return result;

    const first = result.results?.[0];
    return {
      success: true,
      message: result.results?.length
        ? `联网搜索可用，返回 ${result.results.length} 条结果，首条：${first.title || first.url || '无标题'}`
        : '联网搜索请求成功，但未返回结果',
      results: result.results || []
    };
  }

  _resolveEndpoint(cfg) {
    const provider = cfg.webSearchProvider || DEFAULT_PROVIDER;
    return cleanText((cfg.webSearchApiUrl && cfg.webSearchApiUrl.trim())
      || PROVIDER_ENDPOINTS[provider]
      || PROVIDER_ENDPOINTS[DEFAULT_PROVIDER]);
  }

  _buildRequestBody(query, count) {
    return {
      Query: query,
      SearchType: 'web_summary',
      Count: count,
      Filter: { NeedContent: false, NeedUrl: true },
      NeedSummary: true
    };
  }

  /**
   * 执行联网搜索
   * @param {string} query
   * @param {{ count?: number, abortSignal?: AbortSignal, configOverride?: object }} [opts]
   * @returns {Promise<{ success: boolean, results?: {title:string,url:string,snippet:string}[], error?: string }>}
   */
  async search(query, opts = {}) {
    const q = String(query || '').trim();
    if (!q) return { success: false, error: '搜索关键词为空' };

    let cfg;
    try {
      cfg = opts.configOverride ? this._normalizeConfig(opts.configOverride) : await this._getConfig();
    } catch (e) {
      return { success: false, error: e.message };
    }

    if (!isEnabledSetting(cfg.webSearchEnabled)) {
      return { success: false, error: '联网搜索未启用，请在设置中开启' };
    }
    if (!cfg.webSearchApiKey) {
      return { success: false, error: '请先在设置中配置联网搜索 API 密钥' };
    }

    const endpoint = this._resolveEndpoint(cfg);
    const count = Math.min(Math.max(Number(opts.count) || Number(cfg.webSearchCount) || 5, 1), 20);
    const body = this._buildRequestBody(q, count);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.webSearchApiKey}`
        },
        body: JSON.stringify(body),
        signal: opts.abortSignal
      });

      const text = await response.text();
      if (!response.ok) {
        return { success: false, error: extractError(text, response.status) };
      }

      const payloads = extractPayloads(text);
      const inlineError = extractInlineError(payloads);
      if (inlineError) return { success: false, error: inlineError };

      const results = normalizeResults(payloads).slice(0, count);
      if (results.length === 0) {
        this.logger.warn('WebSearch', 'search returned empty results', {
          endpoint,
          query: q,
          payloadCount: payloads.length,
          preview: String(text || '').slice(0, 500)
        });
      }
      return { success: true, results };
    } catch (e) {
      if (e && e.name === 'AbortError') return { success: false, error: '联网搜索已取消' };
      this.logger.error('WebSearch', 'search failed', e);
      return { success: false, error: e.message };
    }
  }
}

WebSearchService.formatResults = formatResults;

module.exports = WebSearchService;
