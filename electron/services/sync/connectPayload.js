/**
 * 「连接手机」二维码的内容：把电脑上同步不会带过去的设置（同步账号、AI、语音转文字）交给手机版，
 * 手机扫码后确认即可填好。普通偏好（主题、标签等）连上同步后会自动同步，不放进二维码。
 *
 * 格式：flota://connect?d=<base64url(JSON)>，字段尽量短，二维码更容易扫：
 *   { v: 1,
 *     s?: { u: WebDAV 地址, r: 同步目录, n: 账号, p: 应用密码 },
 *     a?: { p: 服务商, u: 接口地址, k: Key, m: 模型 },
 *     t?: { i: 火山引擎 AppID, k: Access Token, r: 资源 ID } }
 * 内容没有加密（手机离线也要能解开），所以二维码只在用户点开时显示、一分钟后自动隐藏，并提醒不要截图转发。
 */
const VERSION = 1;

/** 手机版支持的 AI 服务商；其他（如 Anthropic 格式）手机上暂时用不了，不带过去 */
const PHONE_PROVIDERS = new Set(['openai', 'deepseek', 'qwen', 'custom']);

/** AI 设置能不能带到手机：不能时返回原因 */
const aiUnavailableReason = (ai) => {
  if (!ai?.apiKey) return '还没填 API Key';
  const anthropic = ai.provider === 'anthropic' || (ai.provider === 'custom' && ai.apiFormat === 'anthropic');
  if (anthropic || !PHONE_PROVIDERS.has(ai.provider)) return '手机版暂不支持 Anthropic 格式';
  return null;
};

/** 语音转文字能不能带到手机：手机版只支持火山引擎云端识别 */
const sttUnavailableReason = (stt) => {
  if (!stt?.volcAppId || !stt?.volcToken) return '还没填火山引擎配置（离线识别不能带到手机）';
  return null;
};

/**
 * @param {object} parts 要带上的部分，不带的传 null
 * @param {{ baseUrl: string, rootPath: string, username: string, password: string }|null} parts.sync
 * @param {object|null} parts.ai   电脑端 AIService.getConfig() 的 data
 * @param {object|null} parts.stt  电脑端 STTService.getConfig() 的 data
 * @param {(url: string) => string} [normalizeApiUrl] 自定义接口地址规范化为 .../chat/completions（两端一致）
 * @returns {{ link: string|null, included: string[], skipped: { [part: string]: string } }}
 */
function buildConnectLink({ sync = null, ai = null, stt = null } = {}, normalizeApiUrl = (url) => url) {
  const payload = { v: VERSION };
  const included = [];
  const skipped = {};
  if (sync) {
    payload.s = { u: sync.baseUrl, r: sync.rootPath, n: sync.username, p: sync.password };
    included.push('sync');
  }
  if (ai) {
    const reason = aiUnavailableReason(ai);
    if (reason) skipped.ai = reason;
    else {
      payload.a = { p: ai.provider, u: ai.provider === 'custom' ? normalizeApiUrl(ai.apiUrl || '') : '', k: ai.apiKey, m: ai.model || '' };
      included.push('ai');
    }
  }
  if (stt) {
    const reason = sttUnavailableReason(stt);
    if (reason) skipped.stt = reason;
    else {
      payload.t = { i: stt.volcAppId, k: stt.volcToken, r: stt.volcResourceId || 'volcengine_short_sentence' };
      included.push('stt');
    }
  }
  if (!included.length) return { link: null, included, skipped };
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { link: `flota://connect?d=${data}`, included, skipped };
}

/** 解析（测试和手机端逻辑对照用）：至少要有一部分内容 */
function parseConnectLink(link) {
  const match = /^flota:\/\/connect\?d=([A-Za-z0-9_-]+)$/.exec(String(link || '').trim());
  if (!match) return null;
  try {
    const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    if (payload?.v !== VERSION) return null;
    const syncOk = !payload.s || (payload.s.u && payload.s.n && payload.s.p);
    return syncOk && (payload.s || payload.a || payload.t) ? payload : null;
  } catch (_) {
    return null;
  }
}

/** 手机版安装包（和官网、更新检查同一个地址） */
const PHONE_DOWNLOAD_URL = 'https://download.flota.cn/downloads/latest/app-release.apk';

module.exports = { buildConnectLink, parseConnectLink, aiUnavailableReason, sttUnavailableReason, PHONE_PROVIDERS, PHONE_DOWNLOAD_URL };
