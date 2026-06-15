/**
 * 单次流式 chat 请求：构造 OpenAI 兼容请求 + 调用 + SSE 解析。
 */

const { TOOLS } = require('../tools/schema');
const { isEnabledSetting } = require('../utils');
const { parseSSEStream } = require('./sseParser');

const buildRequest = (config, messages, temp, maxTk, options = {}, aiService) => {
  const { provider, apiKey, apiUrl } = config;

  const providerUrls = {
    openai: 'https://api.openai.com/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/v1/chat/completions',
    custom: aiService.normalizeApiUrl(apiUrl)
  };

  const url = providerUrls[provider] || providerUrls.openai;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const body = {
    model: config.model,
    messages,
    temperature: temp,
    stream: true
  };

  const normalizedMaxTokens = Number(maxTk);
  if (Number.isFinite(normalizedMaxTokens) && normalizedMaxTokens > 0) {
    body.max_tokens = Math.floor(normalizedMaxTokens);
  }

  if (options.disableTools !== true) {
    const webSearchOn = isEnabledSetting(config.webSearchEnabled)
      && Boolean(config.webSearchApiKey)
      && options.noWebSearch !== true;
    const disabledTools = new Set(Array.isArray(options.disabledTools) ? options.disabledTools : []);
    body.tools = (webSearchOn ? TOOLS : TOOLS.filter((t) => t.function?.name !== 'web_search'))
      .filter((t) => !disabledTools.has(t.function?.name));
    body.tool_choice = 'auto';
  }

  if (provider === 'qwen') {
    const qwenUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    return { url: qwenUrl, headers: { ...headers, 'X-DashScope-SSE': 'enable' }, body };
  }

  return { url, headers, body };
};

const streamRequest = async (config, messages, temp, maxTk, onChunk, abortSignal, options, aiService) => {
  const { url, headers, body } = buildRequest(config, messages, temp, maxTk, options, aiService);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000); // 2 分钟超时
  let abortHandler = null;

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      abortHandler = () => controller.abort();
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorMsg = `API请求失败 (${response.status})`;
      try {
        const text = await response.text();
        if (text) {
          const e = JSON.parse(text);
          errorMsg = e.error?.message || e.message || errorMsg;
        }
      } catch (_) {}
      throw new Error(errorMsg);
    }

    return await parseSSEStream(response, onChunk);
  } finally {
    clearTimeout(timer);
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
  }
};

module.exports = { buildRequest, streamRequest };
