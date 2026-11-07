/**
 * AI服务 - 管理AI配置和提供统一的AI调用接口
 * 支持多个AI服务提供商(OpenAI、DeepSeek、通义千问等)
 */

const { EventEmitter } = require('events');
const { getInstance: getLogger } = require('./LoggerService');
const { encryptValue, decryptValue, isEncryptedValue } = require('../utils/secureValue');
const { buildModel, buildRequestOptions } = require('./llm/model');
const { generateText } = require('./llm/generateText');
const { normalizeModelError } = require('./llm/errors');

const { isEnabledSetting } = require('./aichat/utils');

class AIService extends EventEmitter {
  constructor(settingDAO) {
    super();
    this.settingDAO = settingDAO;
    this.initialized = false;
    this.logger = getLogger();
    // 速率限制：滑动窗口
    this._requestTimestamps = [];
    this._maxRequestsPerMinute = 20;
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
      { key: 'ai_limit_max_tokens', value: 'false', type: 'boolean', description: '是否限制最大输出token数' },
      { key: 'ai_max_tokens', value: '2000', type: 'number', description: '最大token数' },
      { key: 'web_search_enabled', value: 'false', type: 'boolean', description: '联网搜索开关' },
      { key: 'web_search_provider', value: 'feedcoop', type: 'string', description: '联网搜索服务商' },
      { key: 'web_search_api_key', value: '', type: 'string', description: '联网搜索 API 密钥' },
      { key: 'web_search_api_url', value: '', type: 'string', description: '联网搜索自定义端点' },
      { key: 'web_search_count', value: '5', type: 'number', description: '联网搜索返回结果数' },
      { key: 'ai_auto_title_enabled', value: 'false', type: 'boolean', description: '切换笔记时自动 AI 生成空标题' },
      { key: 'ai_auto_tags_enabled', value: 'false', type: 'boolean', description: '切换笔记时自动 AI 推荐标签' }
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
      const temperatureEnabledSetting = this.settingDAO.get('ai_temperature_enabled');
      const apiFormatSetting = this.settingDAO.get('ai_api_format');
      const limitMaxTokensSetting = this.settingDAO.get('ai_limit_max_tokens');
      const maxTokensSetting = this.settingDAO.get('ai_max_tokens');
      const visionEnabledSetting = this.settingDAO.get('ai_vision_enabled');
      const webSearchEnabledSetting = this.settingDAO.get('web_search_enabled');
      const webSearchProviderSetting = this.settingDAO.get('web_search_provider');
      const webSearchApiKeySetting = this.settingDAO.get('web_search_api_key');
      const webSearchApiUrlSetting = this.settingDAO.get('web_search_api_url');
      const webSearchCountSetting = this.settingDAO.get('web_search_count');
      const autoTitleSetting = this.settingDAO.get('ai_auto_title_enabled');
      const autoTagsSetting = this.settingDAO.get('ai_auto_tags_enabled');

      // 解密失败（钥匙串暂不可用、应用更新后签名变化等）只在本次返回空值，绝不回写清空：
      // 以前这里会把密钥永久删掉，表现为 AI 功能“莫名其妙失效”。用户重新填写即可覆盖。
      const apiKey = apiKeySetting ? decryptValue(apiKeySetting.value) : '';
      const webSearchApiKey = webSearchApiKeySetting ? decryptValue(webSearchApiKeySetting.value) : '';
      if (apiKeySetting && isEncryptedValue(apiKeySetting.value) && !apiKey) {
        this.logger.warn('AI', 'API key could not be decrypted on this device; keeping stored value');
      }

      const config = {
        enabled: enabledSetting ? enabledSetting.value : false,
        provider: providerSetting ? providerSetting.value : 'openai',
        apiKey,
        apiUrl: apiUrlSetting ? apiUrlSetting.value : '',
        model: modelSetting ? modelSetting.value : 'gpt-3.5-turbo',
        temperature: temperatureSetting ? temperatureSetting.value : 0.7,
        temperatureEnabled: temperatureEnabledSetting ? temperatureEnabledSetting.value === true : false,
        apiFormat: apiFormatSetting?.value === 'anthropic' ? 'anthropic' : 'openai',
        limitMaxTokens: limitMaxTokensSetting ? limitMaxTokensSetting.value : false,
        maxTokens: maxTokensSetting ? maxTokensSetting.value : 2000,
        visionEnabled: visionEnabledSetting ? visionEnabledSetting.value : false,
        webSearchEnabled: webSearchEnabledSetting ? webSearchEnabledSetting.value : false,
        webSearchProvider: webSearchProviderSetting ? webSearchProviderSetting.value : 'feedcoop',
        webSearchApiKey,
        webSearchApiUrl: webSearchApiUrlSetting ? webSearchApiUrlSetting.value : '',
        webSearchCount: webSearchCountSetting ? webSearchCountSetting.value : 5,
        autoTitleEnabled: autoTitleSetting ? autoTitleSetting.value : false,
        autoTagsEnabled: autoTagsSetting ? autoTagsSetting.value : false
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
      if (!config || typeof config !== 'object') throw new Error('配置无效');
      const { enabled, provider, apiKey, apiUrl, model, temperature, limitMaxTokens, maxTokens } = config;

      // 只写入调用方明确给出的字段：部分更新不能把 enabled / apiKey 等覆盖成空值
      // 使用 SettingDAO.set() 方法，让DAO自己处理类型转换
      if (enabled !== undefined) this.settingDAO.set('ai_enabled', isEnabledSetting(enabled), 'boolean', 'AI功能开关');
      if (provider !== undefined) this.settingDAO.set('ai_provider', provider, 'string', 'AI服务提供商');
      if (apiKey !== undefined) this.settingDAO.set('ai_api_key', encryptValue(apiKey), 'string', 'AI API密钥');
      if (apiUrl !== undefined) this.settingDAO.set('ai_api_url', apiUrl || '', 'string', '自定义API地址');
      if (model !== undefined) this.settingDAO.set('ai_model', model, 'string', 'AI模型');
      if (temperature !== undefined) this.settingDAO.set('ai_temperature', temperature, 'number', '温度参数');
      if (config.temperatureEnabled !== undefined) this.settingDAO.set('ai_temperature_enabled', isEnabledSetting(config.temperatureEnabled), 'boolean', '是否发送自定义温度');
      if (config.apiFormat !== undefined) this.settingDAO.set('ai_api_format', config.apiFormat === 'anthropic' ? 'anthropic' : 'openai', 'string', '自定义接口格式');
      if (limitMaxTokens !== undefined) this.settingDAO.set('ai_limit_max_tokens', isEnabledSetting(limitMaxTokens), 'boolean', '是否限制最大输出token数');
      if (maxTokens !== undefined) this.settingDAO.set('ai_max_tokens', maxTokens, 'number', '最大token数');
      if (config.visionEnabled !== undefined) {
        this.settingDAO.set('ai_vision_enabled', isEnabledSetting(config.visionEnabled), 'boolean', '是否启用图片理解（多模态）');
      }

      // 联网搜索配置（仅在字段存在时写入，避免覆盖为 undefined）
      if (config.webSearchEnabled !== undefined) {
        this.settingDAO.set('web_search_enabled', isEnabledSetting(config.webSearchEnabled), 'boolean', '联网搜索开关');
      }
      if (config.webSearchProvider !== undefined) {
        this.settingDAO.set('web_search_provider', config.webSearchProvider || 'feedcoop', 'string', '联网搜索服务商');
      }
      if (config.webSearchApiKey !== undefined) {
        this.settingDAO.set('web_search_api_key', encryptValue(config.webSearchApiKey || ''), 'string', '联网搜索 API 密钥');
      }
      if (config.webSearchApiUrl !== undefined) {
        this.settingDAO.set('web_search_api_url', config.webSearchApiUrl || '', 'string', '联网搜索自定义端点');
      }
      if (config.webSearchCount !== undefined) {
        this.settingDAO.set('web_search_count', config.webSearchCount, 'number', '联网搜索返回结果数');
      }
      if (config.autoTitleEnabled !== undefined) {
        this.settingDAO.set('ai_auto_title_enabled', isEnabledSetting(config.autoTitleEnabled), 'boolean', '切换笔记时自动 AI 生成空标题');
      }
      if (config.autoTagsEnabled !== undefined) {
        this.settingDAO.set('ai_auto_tags_enabled', isEnabledSetting(config.autoTagsEnabled), 'boolean', '切换笔记时自动 AI 推荐标签');
      }

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
   * 测试 AI 连接：用传入的（可能还没保存的）配置发一条极短的请求
   */
  async testConnection(config) {
    const { provider, apiKey, apiUrl } = config || {};
    if (!apiKey) return { success: false, error: '请先配置API密钥' };
    if (provider === 'custom' && !apiUrl) return { success: false, error: '请先配置自定义API地址' };
    const label = this.getProviders().data.find((item) => item.id === provider)?.name || 'AI';
    try {
      const testConfig = { ...config, model: config.model || this.getProviders().data.find((item) => item.id === provider)?.models?.[0] || 'gpt-3.5-turbo' };
      await generateText({
        model: buildModel(testConfig, this),
        messages: [{ role: 'user', content: 'Hello' }],
        requestOptions: buildRequestOptions(testConfig, { maxTokens: 10, timeoutMs: 15000 }),
      });
      return { success: true, message: `${label}连接测试成功` };
    } catch (error) {
      return { success: false, error: normalizeModelError(error) };
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
          id: 'anthropic',
          name: 'Anthropic',
          description: 'Claude 系列模型',
          models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
          requiresApiKey: true,
          requiresApiUrl: false
        },
        {
          id: 'custom',
          name: '自定义',
          description: '兼容 OpenAI 或 Anthropic 接口格式的服务（中转站、本地模型等）',
          models: [],
          requiresApiKey: true,
          requiresApiUrl: true
        }
      ]
    };
  }

  /**
   * 非流式文本生成（画布、组件、MCP、插件等）：内部仍是流式请求，拿到完整结果后一次返回。
   *
   * 默认自动续写：没有显式限长、输出因长度被截断时从断点接着写（最多 8 次）。
   * 最终仍被截断、或模型没有返回正文时报错，不把半截内容当成功结果。
   *
   * @param {Array} messages OpenAI 格式消息
   * @param {object} [options] temperature / maxTokens / bypassTokenLimit / autoContinue / timeoutMs / signal
   */
  async chat(messages, options = {}) {
    try {
      const configResult = await this.getConfig();
      if (!configResult.success) return configResult;
      const config = configResult.data;
      if (!config.enabled) return { success: false, error: 'AI功能未启用' };
      if (!config.apiKey) return { success: false, error: '请先配置API密钥' };

      this._checkRateLimit();

      // bypassTokenLimit：结构化生成（如画布规划）忽略用户的小额 token 上限，避免输出被截断
      const maxTokens = options.maxTokens != null
        ? options.maxTokens
        : (options.bypassTokenLimit || !isEnabledSetting(config.limitMaxTokens) ? undefined : config.maxTokens);
      const result = await generateText({
        model: buildModel(config, this),
        messages,
        requestOptions: buildRequestOptions(config, {
          temperature: options.temperature ?? config.temperature,
          maxTokens,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        }),
        autoContinue: options.autoContinue !== false && maxTokens == null,
      });
      if (!result.content.trim()) {
        throw new Error(result.reasoningOnly
          ? '模型仅返回推理过程，未返回正文，请检查模型输出额度或更换模型'
          : '模型返回空正文，请检查 AI 服务配置后重试');
      }
      if (result.truncated) throw new Error('模型输出被 token 上限截断，请提高模型输出额度或缩小生成内容');
      return { success: true, data: { content: result.content, usage: result.usage, finishReason: result.finishReason } };
    } catch (error) {
      if (options.signal?.aborted || error?.name === 'AbortError') return { success: false, error: '已停止生成' };
      this.logger.error('AI', 'Chat failed', error);
      return { success: false, error: normalizeModelError(error) };
    }
  }
}

module.exports = AIService;
