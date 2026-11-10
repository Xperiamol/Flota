/**
 * 「连接手机」二维码的内容：把电脑上的同步账号（可选带上 AI 设置）交给手机版，手机扫码后自动填好。
 *
 * 格式：flota://connect?d=<base64url(JSON)>，JSON 字段尽量短，二维码更容易扫：
 *   { v: 1, s: { u: WebDAV 地址, r: 同步目录, n: 账号, p: 应用密码 }, a?: { p: 服务商, u: 接口地址, k: Key, m: 模型 } }
 * 内容没有加密（手机离线也要能解开），所以二维码只在用户点开时显示、一分钟后自动隐藏，并提醒不要截图转发。
 */
const VERSION = 1;

/** 手机版支持的 AI 服务商；其他（如 Anthropic 格式）手机上暂时用不了，不带过去 */
const PHONE_PROVIDERS = new Set(['openai', 'deepseek', 'qwen', 'custom']);

/**
 * @param {{ baseUrl: string, rootPath: string, username: string, password: string }} sync
 * @param {object|null} ai  电脑端 AIService.getConfig() 的结果；不带 AI 时传 null
 * @param {(url: string) => string} [normalizeApiUrl] 自定义接口地址规范化为 .../chat/completions（两端一致）
 * @returns {{ link: string, aiIncluded: boolean, aiSkippedReason: string | null }}
 */
function buildConnectLink(sync, ai = null, normalizeApiUrl = (url) => url) {
  const payload = { v: VERSION, s: { u: sync.baseUrl, r: sync.rootPath, n: sync.username, p: sync.password } };
  let aiSkippedReason = null;
  if (ai) {
    const anthropic = ai.provider === 'anthropic' || (ai.provider === 'custom' && ai.apiFormat === 'anthropic');
    if (!ai.apiKey) aiSkippedReason = '电脑上还没有填写 AI 的 API Key';
    else if (anthropic || !PHONE_PROVIDERS.has(ai.provider)) aiSkippedReason = '手机版暂不支持 Anthropic 格式的接口';
    else {
      payload.a = {
        p: ai.provider,
        u: ai.provider === 'custom' ? normalizeApiUrl(ai.apiUrl || '') : '',
        k: ai.apiKey,
        m: ai.model || '',
      };
    }
  }
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { link: `flota://connect?d=${data}`, aiIncluded: Boolean(payload.a), aiSkippedReason };
}

/** 解析（测试和手机端逻辑对照用） */
function parseConnectLink(link) {
  const match = /^flota:\/\/connect\?d=([A-Za-z0-9_-]+)$/.exec(String(link || '').trim());
  if (!match) return null;
  try {
    const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    return payload?.v === VERSION && payload.s?.u && payload.s?.n && payload.s?.p ? payload : null;
  } catch (_) {
    return null;
  }
}

module.exports = { buildConnectLink, parseConnectLink, PHONE_PROVIDERS };
