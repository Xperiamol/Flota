/**
 * 联网搜索响应解析与归一化。
 * 把任意官方/兼容端点的返回拍平成 { title, url, snippet }[]。
 */

const cleanText = (value) => String(value || '')
  .replace(/^[\s`'"]+|[\s`'"]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function tryJsonParse(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

/** 把响应文本切成 0..N 个 JSON payload（支持普通 JSON 与按行/SSE 风格）。 */
function extractPayloads(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const direct = tryJsonParse(raw);
  if (direct) return [direct];

  const payloads = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const clean = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!clean || clean === '[DONE]') continue;
    const parsed = tryJsonParse(clean);
    if (parsed) payloads.push(parsed);
  }
  return payloads;
}

/** 从一组 payload 里选出第一条错误信息，没有就返回空串。 */
function pickMessage(payloads) {
  for (const p of payloads) {
    const msg = p?.message || p?.msg || p?.error?.message || p?.error;
    if (msg) return String(msg);
  }
  return '';
}

/** 失败响应的错误文案。 */
function extractError(text, status) {
  return pickMessage(extractPayloads(text)) || `联网搜索失败 (${status})`;
}

/** 200 但 body 是错误对象的情况（如官方的 invalid_request）。 */
function extractInlineError(payloads) {
  for (const payload of payloads) {
    const code = payload?.code || payload?.Code || payload?.error_code;
    if (String(code || '').toLowerCase() === 'invalid_request') {
      return pickMessage([payload]) || '联网搜索请求参数错误';
    }
    if (payload?.success === false) {
      const msg = pickMessage([payload]);
      if (msg) return msg;
    }
  }
  return '';
}

function normalizeItem(item) {
  return {
    title: cleanText(
      item?.Title || item?.title || item?.Name || item?.name
      || item?.SiteName || item?.site_name || item?.article_title || ''
    ),
    url: cleanText(
      item?.Url || item?.url || item?.Link || item?.link
      || item?.article_url || item?.share_url || ''
    ),
    snippet: cleanText(
      item?.Summary || item?.summary || item?.Snippet || item?.snippet
      || item?.Description || item?.description
      || item?.abstract || item?.introduction || ''
    )
  };
}

/** 把 payload 列表归一化为搜索结果数组（去重、忽略空条目）。 */
function normalizeResults(payloads) {
  const items = [];
  for (const payload of payloads) {
    const candidates = [
      ...(Array.isArray(payload?.Result?.WebResults) ? payload.Result.WebResults : []),
      ...(Array.isArray(payload?.data) ? payload.data : []),
      ...(Array.isArray(payload?.results) ? payload.results : [])
    ];
    for (const item of candidates) {
      const blockArticles = Array.isArray(item?.articles) ? item.articles : null;
      if (blockArticles) {
        for (const article of blockArticles) items.push(normalizeItem(article));
      } else {
        items.push(normalizeItem(item));
      }
    }
  }

  const seen = new Set();
  return items.filter((item) => {
    if (!item.title && !item.snippet) return false;
    const key = `${item.title}::${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 把结果格式化为可喂给 LLM 的文本块。 */
function formatResults(results) {
  if (!Array.isArray(results) || results.length === 0) return '（无搜索结果）';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join('\n\n');
}

module.exports = {
  cleanText,
  extractPayloads,
  extractError,
  extractInlineError,
  normalizeResults,
  formatResults
};
