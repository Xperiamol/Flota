/**
 * Flota 的 AI 配置 → pi-ai 的模型描述与请求参数。
 *
 * Flota 支持的服务商都走 OpenAI Chat Completions 协议。pi-ai 能按地址自动识别 OpenAI 官方与
 * DeepSeek 的差异；通义千问和自定义接口识别不出来，统一用一组保守设置（不发 store、system
 * 不用 developer 角色、用 max_tokens），不再为个别服务商单独写兼容。
 */
const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

const CONSERVATIVE_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: 'max_tokens',
};

const DEFAULT_TIMEOUT_MS = 120000; // 空闲超时：这么久没有收到任何数据才算超时（见 llm/stream.js）
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

const resolveBaseUrl = (config, aiService) => {
  if (PROVIDER_BASE_URLS[config.provider]) return PROVIDER_BASE_URLS[config.provider];
  // 自定义接口：设置里填的是完整地址或版本根路径，openai SDK 需要的是不含 /chat/completions 的根路径
  const full = aiService?.normalizeApiUrl ? aiService.normalizeApiUrl(config.apiUrl) : String(config.apiUrl || '');
  return String(full || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
};

/** @param {{ vision?: boolean }} [options] vision 打开时工具结果里的图片才会发给模型 */
const buildModel = (config, aiService, { vision = false } = {}) => {
  const provider = PROVIDER_BASE_URLS[config.provider] ? config.provider : 'custom';
  return {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider,
    baseUrl: resolveBaseUrl(config, aiService),
    input: vision ? ['text', 'image'] : ['text'],
    reasoning: false,
    // pi 只在流式请求的简化入口里用它裁剪输出上限；Flota 走底层 stream，上下文预算由调用方自己管
    contextWindow: 0,
    maxTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(provider === 'qwen' ? { headers: { 'X-DashScope-SSE': 'enable' } } : {}),
    ...(provider === 'openai' || provider === 'deepseek' ? {} : { compat: CONSERVATIVE_COMPAT }),
  };
};

const clampTemperature = (value, fallback) => {
  const temperature = typeof value === 'number' ? value : fallback;
  return typeof temperature === 'number' ? Math.min(Math.max(temperature, 0), 2) : undefined;
};

/**
 * 每次请求的参数。maxTokens 不传时请求里不带输出上限，由服务商决定（与原先行为一致）。
 */
const buildRequestOptions = (config, { temperature, maxTokens, timeoutMs, signal } = {}) => ({
  apiKey: config.apiKey,
  temperature: clampTemperature(temperature, config.temperature),
  maxTokens: Number(maxTokens) > 0 ? Math.floor(Number(maxTokens)) : undefined,
  timeoutMs: Number(timeoutMs) > 0 ? Math.min(Number(timeoutMs), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  signal,
  // 不给服务商发 pi 的署名请求头
  identity: { attribution: null },
});

module.exports = { buildModel, buildRequestOptions, resolveBaseUrl, CONSERVATIVE_COMPAT };
