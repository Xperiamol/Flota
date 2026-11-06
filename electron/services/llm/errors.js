/**
 * 模型请求错误 → 给用户看的提示。AI 对话（chatStream）和非流式生成（AIService.chat）共用。
 */
const test = (pattern) => (error) => pattern.test(String(error?.message || error || ''));

const isContentBlockedError = test(/content_filter|blocked|content.*blocked|machine outputted|安全|拦截|审核|风控/i);
const isGatewayError = test(/请求失败 \((?:429|502|503|504)\)|\b(?:429|502|503|504)\b|bad gateway|gateway timeout|service unavailable|too many requests|rate limit/i);
const isNetworkError = test(/fetch failed|network|网络|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|connection error/i);

const normalizeModelError = (error) => {
  if (isContentBlockedError(error)) return '模型内容审核拦截，请调整表述后重试';
  if (/超时|timed? ?out/i.test(String(error?.message || ''))) return error.message;
  if (isGatewayError(error)) return 'AI 服务暂时不可用，请稍后重试';
  if (isNetworkError(error)) return '网络请求失败，请检查网络或 AI 配置后重试';
  return error?.message || String(error || '请求失败');
};

module.exports = { normalizeModelError };
