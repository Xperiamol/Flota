/**
 * Flota 的 AI 配置 → pi-ai 的模型描述与请求参数。
 *
 * 两种接口格式：
 *   - OpenAI Chat Completions：OpenAI / DeepSeek / 通义千问，以及默认的自定义接口。pi-ai 能按地址识别
 *     OpenAI 官方与 DeepSeek 的差异；其余统一用一组保守设置（不发 store、system 不用 developer 角色、用 max_tokens）。
 *   - Anthropic Messages：Anthropic 官方，以及在设置里选了「Anthropic 格式」的自定义接口（Claude 中转站等）。
 */
const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  anthropic: 'https://api.anthropic.com',
};

const CONSERVATIVE_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: 'max_tokens',
};

// 第三方 Anthropic 格式接口：不发官方专有的工具流式参数和长缓存，避免中转站不认识而报错
const ANTHROPIC_RELAY_COMPAT = {
  supportsEagerToolInputStreaming: false,
  supportsLongCacheRetention: false,
};

// Anthropic 协议必须带 max_tokens；调用方没给时用这个值，被截断由各处的自动续写接上
const ANTHROPIC_DEFAULT_MAX_TOKENS = 16384;

const DEFAULT_TIMEOUT_MS = 120000; // 空闲超时：这么久没有收到任何数据才算超时（见 llm/stream.js）
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

const usesAnthropicFormat = (config) => config.provider === 'anthropic' || (config.provider === 'custom' && config.apiFormat === 'anthropic');

const resolveBaseUrl = (config, aiService) => {
  if (PROVIDER_BASE_URLS[config.provider]) return PROVIDER_BASE_URLS[config.provider];
  // 自定义接口：设置里填的是完整地址或版本根路径
  const full = aiService?.normalizeApiUrl ? aiService.normalizeApiUrl(config.apiUrl) : String(config.apiUrl || '');
  const root = String(full || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  // Anthropic SDK 会自己拼 /v1/messages，所以去掉结尾的 /messages 和 /v1
  return usesAnthropicFormat(config) ? root.replace(/\/messages$/, '').replace(/\/v1$/, '') : root;
};

/** @param {{ vision?: boolean }} [options] vision 打开时工具结果里的图片才会发给模型 */
const buildModel = (config, aiService, { vision = false } = {}) => {
  const provider = PROVIDER_BASE_URLS[config.provider] ? config.provider : 'custom';
  const anthropic = usesAnthropicFormat({ ...config, provider });
  return {
    id: config.model,
    name: config.model,
    api: anthropic ? 'anthropic-messages' : 'openai-completions',
    provider,
    baseUrl: resolveBaseUrl(config, aiService),
    input: vision ? ['text', 'image'] : ['text'],
    reasoning: false,
    // pi 只在流式请求的简化入口里用它裁剪输出上限；Flota 走底层 stream，上下文预算由调用方自己管。
    // Anthropic 协议要求必带 max_tokens，没指定时用默认值
    contextWindow: 0,
    maxTokens: anthropic ? ANTHROPIC_DEFAULT_MAX_TOKENS : 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(provider === 'qwen' ? { headers: { 'X-DashScope-SSE': 'enable' } } : {}),
    ...(anthropic
      ? (provider === 'anthropic' ? {} : { compat: ANTHROPIC_RELAY_COMPAT })
      : (provider === 'openai' || provider === 'deepseek' ? {} : { compat: CONSERVATIVE_COMPAT })),
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
  // 温度默认不发：不少新模型只接受默认值（比如只允许 1），发了就报错。设置里打开「自定义温度」才带上
  temperature: config.temperatureEnabled === true ? clampTemperature(temperature, config.temperature) : undefined,
  maxTokens: Number(maxTokens) > 0 ? Math.floor(Number(maxTokens)) : undefined,
  timeoutMs: Number(timeoutMs) > 0 ? Math.min(Number(timeoutMs), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  signal,
  // 不给服务商发 pi 的署名请求头
  identity: { attribution: null },
});

module.exports = { buildModel, buildRequestOptions, resolveBaseUrl, usesAnthropicFormat, CONSERVATIVE_COMPAT, ANTHROPIC_RELAY_COMPAT };
