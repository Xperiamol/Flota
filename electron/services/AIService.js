/**
 * AI服务 - 管理AI配置和提供统一的AI调用接口
 * 支持多个AI服务提供商(OpenAI、DeepSeek、通义千问等)
 */

const { EventEmitter } = require('events');
const { getInstance: getLogger } = require('./LoggerService');
const { encryptValue, decryptValue, isEncryptedValue } = require('../utils/secureValue');
const { extractTextResponse, mergeContinuationContent, getTokenCandidates, accumulateUsage } = require('./aiResponse');

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
    this._requestTimeoutMs = 120000; // 120s
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
   * 长连接 dispatcher：禁用 undici 自带的 headers/body 内部超时，
   * 让请求时长完全由我们的 AbortController 控制。
   * 否则大体量（如画布规划）非流式响应会在 undici 默认 ~300s 处被
   * 提前中断，并抛出信息被吞掉的通用 `fetch failed`。
   */
  _getLongRequestDispatcher() {
    if (this._longDispatcher !== undefined) return this._longDispatcher;
    try {
      const { Agent } = require('undici');
      this._longDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30000 });
    } catch (_) {
      this._longDispatcher = null;
    }
    return this._longDispatcher;
  }

  /**
   * 超时覆盖响应头和正文读取的非流式请求
   */
  async _fetchTextWithTimeout(url, options, timeoutMs) {
    const effective = timeoutMs && timeoutMs > 0 ? timeoutMs : this._requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effective);
    const dispatcher = this._getLongRequestDispatcher();
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
      });
      return { ok: response.ok, status: response.status, text: await response.text() };
    } catch (e) {
      if (options.signal?.aborted) throw new Error('已停止生成');
      if (e.name === 'AbortError') throw new Error(`AI请求超时（${Math.round(effective / 1000)}秒），请检查网络或API服务状态`);
      // undici 把真实原因藏在 e.cause 里，原样 throw 会只剩 "fetch failed"
      const cause = e?.cause?.message || e?.cause?.code || '';
      if (cause) throw new Error(`${e.message}: ${cause}`);
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
   * 通用 API 测试（内部方法）
   */
  async _testAPI(url, apiKey, body, label, errorExtractor = json => json.error?.message) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (response.ok) return { success: true, message: `${label}连接测试成功` };
      let errorMessage = `连接失败 (${response.status})`;
      try {
        const text = await response.text();
        if (text) errorMessage = errorExtractor(JSON.parse(text)) || errorMessage;
      } catch (_) {}
      return { success: false, error: errorMessage };
    } catch (error) {
      if (error.name === 'AbortError') return { success: false, error: '连接超时（15 秒）' };
      return { success: false, error: error.message };
    } finally {
      clearTimeout(timer);
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
  async _chatAPI(url, apiKey, body, responseExtractor, timeoutMs, signal) {
    // 网关瞬时故障（502/503/504）与限流（429）通常重试即可恢复：退避重试，不要一次失败就报错。
    const RETRYABLE = new Set([429, 502, 503, 504]);
    const MAX_ATTEMPTS = 3;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new Error('已停止生成');
      const response = await this._fetchTextWithTimeout(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body)
      }, timeoutMs);

      if (!response.ok) {
        let errorMessage = `请求失败 (${response.status})`;
        try {
          const text = response.text;
          if (text) { const e = JSON.parse(text); errorMessage = e.error?.message || e.message || errorMessage; }
        } catch (_) {}
        if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
          lastErr = Object.assign(new Error(errorMessage), { status: response.status });
          const backoff = 800 * attempt;
          this.logger.warn('AI', `网关瞬时错误 ${response.status}，${backoff}ms 后重试（${attempt}/${MAX_ATTEMPTS - 1}）`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw Object.assign(new Error(errorMessage), { status: response.status });
      }

      const text = response.text;
      if (!text) throw new Error('API 返回空响应');
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('解析 API 响应失败: ' + e.message); }
      return { success: true, data: responseExtractor(data) };
    }
    throw lastErr || new Error('请求失败');
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

      const customTimeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? Math.min(options.timeoutMs, 600000)
        : undefined;

      const temp = Math.min(Math.max(options.temperature ?? config.temperature, 0), 2);
      const limitMaxTokensEnabled = isEnabledSetting(config.limitMaxTokens);
      const hasExplicitMaxTokens = options.maxTokens != null;
      // bypassTokenLimit：结构化生成（如画布规划）忽略用户的小额 token 上限，避免输出被截断；
      // 默认省略 max_tokens；需要兼容网关时由共享额度策略处理。
      const maxTk = hasExplicitMaxTokens
        ? options.maxTokens
        : (options.bypassTokenLimit ? undefined : (limitMaxTokensEnabled ? config.maxTokens : undefined));
      // 未显式限长（maxTk == null）时，若服务商单次默认输出上限触发 finish_reason=length，自动从断点续写（最多 8 次）
      const maxContinuations = options.autoContinue === false || maxTk != null
        ? 0
        : (Number.isInteger(options.maxContinuations) ? Math.max(0, options.maxContinuations) : 8);

      // Anthropic/Claude 接口必填 max_tokens，兼容网关在省略该字段时常注入 4096/8192 默认值，
      // 开启 Extended Thinking 时会被内部推理耗尽导致正文为空（finish_reason=length, content=""）。
      const tokenCandidates = getTokenCandidates(config.model, maxTk);

      const requestSingleBudget = async (turnMessages, allowTruncated, candidateMaxTk) => {
        const stdBody = {
          model: config.model,
          messages: turnMessages,
          temperature: temp,
          ...(candidateMaxTk != null ? { max_tokens: candidateMaxTk } : {})
        };
        const qwenBody = {
          model: config.model,
          input: { messages: turnMessages },
          parameters: {
            temperature: temp,
            ...(candidateMaxTk != null ? { max_tokens: candidateMaxTk } : {})
          }
        };

        const openAIExtract = (data) => extractTextResponse(data, 'openai', { allowTruncated });
        const qwenExtract = (data) => extractTextResponse(data, 'qwen', { allowTruncated });

        switch (config.provider) {
          case 'openai':
            return await this._chatAPI('https://api.openai.com/v1/chat/completions', config.apiKey, stdBody, openAIExtract, customTimeoutMs, options.signal);
          case 'deepseek':
            return await this._chatAPI('https://api.deepseek.com/v1/chat/completions', config.apiKey, stdBody, openAIExtract, customTimeoutMs, options.signal);
          case 'qwen':
            return await this._chatAPI(
              'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
              config.apiKey, qwenBody, qwenExtract, customTimeoutMs, options.signal
            );
          case 'custom':
            return await this._chatAPI(this.normalizeApiUrl(config.apiUrl), config.apiKey, stdBody, openAIExtract, customTimeoutMs, options.signal);
          default:
            return { success: false, error: '不支持的AI提供商' };
        }
      };

      const requestTurn = async (turnMessages, allowTruncated) => {
        let lastError;
        for (let i = 0; i < tokenCandidates.length; i++) {
          const candidateMaxTk = tokenCandidates[i];
          const hasNext = i < tokenCandidates.length - 1;
          try {
            return await requestSingleBudget(turnMessages, allowTruncated, candidateMaxTk);
          } catch (err) {
            lastError = err;
            // 若自动注入的高 max_tokens 被上游以 400 拒绝，降档重试
            if (hasNext && maxTk == null && candidateMaxTk != null && err?.status === 400) {
              continue;
            }
            // 若省略 max_tokens 时网关默认额度被思考过程耗尽（返回空正文 + finish_reason=length），升档显式传入大额度重试
            if (hasNext && maxTk == null && candidateMaxTk == null && err?.code === 'EMPTY_TRUNCATED_RESPONSE') {
              continue;
            }
            throw err;
          }
        }
        throw lastError || new Error('请求失败');
      };

      let content = '';
      let usage = null;
      let finishReason = null;
      let previousAdded = null;
      for (let part = 0; part <= maxContinuations; part++) {
        const turnMessages = part === 0 ? messages : [
          ...messages,
          { role: 'assistant', content },
          { role: 'user', content: '上一条回复在末尾因单次输出长度上限截断了。请从中断的位置直接接着写：不要重复已经输出的内容，不要重新开始，不要加代码块围栏或任何解释。' }
        ];
        const turnResult = await requestTurn(turnMessages, part < maxContinuations);
        if (!turnResult?.success) return turnResult;
        const data = turnResult.data;
        finishReason = data.finishReason;
        usage = accumulateUsage(usage, data.usage);
        if (part === 0) {
          content = data.content;
          previousAdded = data.content;
        } else {
          const merged = mergeContinuationContent(content, data.content);
          if (!merged.added.trim() || merged.added === previousAdded) {
            throw new Error('模型输出被 token 上限截断，请提高模型输出额度或缩小生成内容');
          }
          content = merged.content;
          previousAdded = merged.added;
        }
        if (finishReason !== 'length') break;
      }

      return { success: true, data: { content, usage, finishReason } };
    } catch (error) {
      this.logger.error('AI', 'Chat failed', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = AIService;
