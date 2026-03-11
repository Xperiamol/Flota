/**
 * AI服务 - 管理AI配置和提供统一的AI调用接口
 * 支持多个AI服务提供商(OpenAI、DeepSeek、通义千问等)
 */

const { EventEmitter } = require('events');
const { getInstance: getLogger } = require('./LoggerService');

class AIService extends EventEmitter {
  constructor(settingDAO) {
    super();
    this.settingDAO = settingDAO;
    this.initialized = false;
    this.logger = getLogger();
    // 速率限制：滑动窗口
    this._requestTimestamps = [];
    this._maxRequestsPerMinute = 20;
    this._requestTimeoutMs = 60000; // 60s
  }

  /**
   * 检查速率限制，超限则拒绝
   */
  _checkRateLimit() {
    const now = Date.now();
    this._requestTimestamps = this._requestTimestamps.filter(t => now - t < 60000);
    if (this._requestTimestamps.length >= this._maxRequestsPerMinute) {
      throw new Error('AI请求过于频繁，请稍后再试');
    }
    this._requestTimestamps.push(now);
  }

  /**
   * 带超时的 fetch 请求
   */
  async _fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._requestTimeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('AI请求超时（60秒），请检查网络或API服务状态');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 规范化自定义 API URL，确保以 /chat/completions 结尾
   * @param {string} apiUrl 用户输入的 API 地址
   * @returns {string} 规范化后的完整 URL
   */
  normalizeApiUrl(apiUrl) {
    if (!apiUrl) return apiUrl;
    
    // 移除末尾的斜杠
    let url = apiUrl.replace(/\/+$/, '');
    
    // 如果已经以 /chat/completions 结尾，直接返回
    if (url.endsWith('/chat/completions')) {
      return url;
    }
    
    // 如果以 /v1, /v2, /v3 等版本号结尾，添加 /chat/completions
    if (/\/v\d+$/.test(url)) {
      return `${url}/chat/completions`;
    }
    
    // 如果以 /api/v1, /api/v2, /api/v3 等结尾，添加 /chat/completions
    if (/\/api\/v\d+$/.test(url)) {
      return `${url}/chat/completions`;
    }
    
    // 其他情况，假设需要添加 /chat/completions
    // 但如果 URL 看起来已经是完整的端点（包含 chat 或 completions），则不添加
    if (url.includes('/chat') || url.includes('/completions')) {
      return url;
    }
    
    // 默认添加 /chat/completions
    return `${url}/chat/completions`;
  }

  /**
   * 初始化AI服务
   */
  async initialize() {
    try {
      // 确保必要的设置键存在
      this.ensureDefaultSettings();
      this.initialized = true;
      this.logger.info('AI', 'Service initialized');
      return { success: true };
    } catch (error) {
      this.logger.error('AI', 'Failed to initialize', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 确保默认设置存在
   */
  ensureDefaultSettings() {
    const defaults = [
      { key: 'ai_enabled', value: 'false', type: 'boolean', description: 'AI功能开关' },
      { key: 'ai_provider', value: 'openai', type: 'string', description: 'AI服务提供商' },
      { key: 'ai_api_key', value: '', type: 'string', description: 'AI API密钥' },
      { key: 'ai_api_url', value: '', type: 'string', description: '自定义API地址' },
      { key: 'ai_model', value: 'gpt-3.5-turbo', type: 'string', description: 'AI模型' },
      { key: 'ai_temperature', value: '0.7', type: 'number', description: '温度参数' },
      { key: 'ai_max_tokens', value: '2000', type: 'number', description: '最大token数' }
    ];

    defaults.forEach(({ key, value, type, description }) => {
      const existing = this.settingDAO.get(key);
      if (!existing) {
        this.settingDAO.set(key, value, type, description);
      }
    });
  }

  /**
   * 获取AI配置
   */
  async getConfig() {
    try {
      // 使用 SettingDAO.get() 方法，返回 { key, value, type, description } 或 null
      // 注意：SettingDAO.get() 已经调用了 parseValue，所以 value 是解析后的类型
      const enabledSetting = this.settingDAO.get('ai_enabled');
      const providerSetting = this.settingDAO.get('ai_provider');
      const apiKeySetting = this.settingDAO.get('ai_api_key');
      const apiUrlSetting = this.settingDAO.get('ai_api_url');
      const modelSetting = this.settingDAO.get('ai_model');
      const temperatureSetting = this.settingDAO.get('ai_temperature');
      const maxTokensSetting = this.settingDAO.get('ai_max_tokens');

      const config = {
        enabled: enabledSetting ? enabledSetting.value : false,
        provider: providerSetting ? providerSetting.value : 'openai',
        apiKey: apiKeySetting ? apiKeySetting.value : '',
        apiUrl: apiUrlSetting ? apiUrlSetting.value : '',
        model: modelSetting ? modelSetting.value : 'gpt-3.5-turbo',
        temperature: temperatureSetting ? temperatureSetting.value : 0.7,
        maxTokens: maxTokensSetting ? maxTokensSetting.value : 2000
      };

      return {
        success: true,
        data: config
      };
    } catch (error) {
      this.logger.error('AI', 'Failed to get config', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 保存AI配置
   */
  async saveConfig(config) {
    try {
      const { enabled, provider, apiKey, apiUrl, model, temperature, maxTokens } = config;

      // 使用 SettingDAO.set() 方法，让DAO自己处理类型转换
      this.settingDAO.set('ai_enabled', enabled, 'boolean', 'AI功能开关');
      this.settingDAO.set('ai_provider', provider, 'string', 'AI服务提供商');
      this.settingDAO.set('ai_api_key', apiKey, 'string', 'AI API密钥');
      this.settingDAO.set('ai_api_url', apiUrl || '', 'string', '自定义API地址');
      this.settingDAO.set('ai_model', model, 'string', 'AI模型');
      this.settingDAO.set('ai_temperature', temperature, 'number', '温度参数');
      this.settingDAO.set('ai_max_tokens', maxTokens, 'number', '最大token数');

      // 触发配置更改事件
      this.emit('config-changed', config);

      return {
        success: true,
        message: '配置已保存'
      };
    } catch (error) {
      this.logger.error('AI', 'Failed to save config', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 通用 API 测试（内部方法）
   */
  async _testAPI(url, apiKey, body, label, errorExtractor = json => json.error?.message) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body)
      });
      if (response.ok) return { success: true, message: `${label}连接测试成功` };
      let errorMessage = `连接失败 (${response.status})`;
      try {
        const text = await response.text();
        if (text) errorMessage = errorExtractor(JSON.parse(text)) || errorMessage;
      } catch (_) {}
      return { success: false, error: errorMessage };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 测试AI连接
   */
  async testConnection(config) {
    try {
      const { provider, apiKey, apiUrl, model } = config;
      if (!apiKey) return { success: false, error: '请先配置API密钥' };

      const stdBody = (m) => ({ model: m, messages: [{ role: 'user', content: 'Hello' }], max_tokens: 10 });
      const qwenBody = (m) => ({ model: m, input: { messages: [{ role: 'user', content: 'Hello' }] }, parameters: { max_tokens: 10 } });

      switch (provider) {
        case 'openai':
          return await this._testAPI('https://api.openai.com/v1/chat/completions', apiKey, stdBody(model || 'gpt-3.5-turbo'), 'OpenAI');
        case 'deepseek':
          return await this._testAPI('https://api.deepseek.com/v1/chat/completions', apiKey, stdBody(model || 'deepseek-chat'), 'DeepSeek');
        case 'qwen':
          return await this._testAPI(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
            apiKey, qwenBody(model || 'qwen-turbo'), '通义千问', json => json.message
          );
        case 'custom':
          if (!apiUrl) return { success: false, error: '请先配置自定义API地址' };
          return await this._testAPI(
            this.normalizeApiUrl(apiUrl), apiKey, stdBody(model || 'gpt-3.5-turbo'),
            '自定义API', json => json.error?.message || json.message
          );
        default:
          return { success: false, error: '不支持的AI提供商' };
      }
    } catch (error) {
      this.logger.error('AI', 'Failed to test connection', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取支持的AI提供商列表
   */
  getProviders() {
    return {
      success: true,
      data: [
        {
          id: 'openai',
          name: 'OpenAI',
          description: 'ChatGPT, GPT-4等模型',
          models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'],
          requiresApiKey: true,
          requiresApiUrl: false
        },
        {
          id: 'deepseek',
          name: 'DeepSeek',
          description: '深度求索AI模型',
          models: ['deepseek-chat', 'deepseek-coder'],
          requiresApiKey: true,
          requiresApiUrl: false
        },
        {
          id: 'qwen',
          name: '通义千问',
          description: '阿里云通义千问系列模型',
          models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
          requiresApiKey: true,
          requiresApiUrl: false
        },
        {
          id: 'custom',
          name: '自定义',
          description: '兼容OpenAI API格式的自定义服务',
          models: [],
          requiresApiKey: true,
          requiresApiUrl: true
        }
      ]
    };
  }

  /**
   * 通用 API 聊天（内部方法）
   */
  async _chatAPI(url, apiKey, body, responseExtractor) {
    const response = await this._fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorMessage = `请求失败 (${response.status})`;
      try {
        const text = await response.text();
        if (text) { const e = JSON.parse(text); errorMessage = e.error?.message || e.message || errorMessage; }
      } catch (_) {}
      throw new Error(errorMessage);
    }

    const text = await response.text();
    if (!text) throw new Error('API 返回空响应');
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('解析 API 响应失败: ' + e.message); }
    return { success: true, data: responseExtractor(data) };
  }

  /**
   * 调用AI完成任务（供后续功能使用）
   */
  async chat(messages, options = {}) {
    try {
      const configResult = await this.getConfig();
      if (!configResult.success) return configResult;
      const config = configResult.data;
      if (!config.enabled) return { success: false, error: 'AI功能未启用' };
      if (!config.apiKey) return { success: false, error: '请先配置API密钥' };

      this._checkRateLimit();

      const temp = Math.min(Math.max(options.temperature || config.temperature, 0), 2);
      const maxTk = options.maxTokens || config.maxTokens;
      const stdBody = { model: config.model, messages, temperature: temp, max_tokens: maxTk };
      const qwenBody = { model: config.model, input: { messages }, parameters: { temperature: temp, max_tokens: maxTk } };

      const openAIExtract = (data) => {
        if (!data.choices?.[0]?.message) throw new Error('API 响应格式不正确');
        return { content: data.choices[0].message.content, usage: data.usage };
      };
      const qwenExtract = (data) => {
        if (!data.output?.text) throw new Error('API 响应格式不正确');
        return { content: data.output.text, usage: data.usage };
      };

      switch (config.provider) {
        case 'openai':
          return await this._chatAPI('https://api.openai.com/v1/chat/completions', config.apiKey, stdBody, openAIExtract);
        case 'deepseek':
          return await this._chatAPI('https://api.deepseek.com/v1/chat/completions', config.apiKey, stdBody, openAIExtract);
        case 'qwen':
          return await this._chatAPI(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
            config.apiKey, qwenBody, qwenExtract
          );
        case 'custom':
          return await this._chatAPI(this.normalizeApiUrl(config.apiUrl), config.apiKey, stdBody, openAIExtract);
        default:
          return { success: false, error: '不支持的AI提供商' };
      }
    } catch (error) {
      this.logger.error('AI', 'Chat failed', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = AIService;
