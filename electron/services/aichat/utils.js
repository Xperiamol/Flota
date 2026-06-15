/**
 * AI Chat 通用工具函数：纯函数，无外部依赖。
 */

const isEnabledSetting = (value) => value === true || value === 'true' || value === 1 || value === '1';

const getLocalDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodoTemporalStatus = (todo) => {
  if (!todo?.due_date || todo.is_completed) {
    return { label: todo?.is_completed ? '已完成' : '无截止日期', isOverdue: false, isDueToday: false, isUpcoming: false };
  }

  const dueKey = String(todo.due_date).substring(0, 10);
  const todayKey = getLocalDateKey();
  const dueTime = new Date(`${dueKey}T00:00:00`).getTime();
  const todayTime = new Date(`${todayKey}T00:00:00`).getTime();
  const daysUntilDue = Math.round((dueTime - todayTime) / 86400000);

  if (dueKey < todayKey) return { label: `已过期 ${Math.abs(daysUntilDue)} 天`, isOverdue: true, isDueToday: false, isUpcoming: false };
  if (dueKey === todayKey) return { label: '今天到期', isOverdue: false, isDueToday: true, isUpcoming: false };
  if (daysUntilDue <= 7) return { label: `${daysUntilDue} 天后到期`, isOverdue: false, isDueToday: false, isUpcoming: true };
  return { label: '未来待办', isOverdue: false, isDueToday: false, isUpcoming: false };
};

const safeJsonParse = (value) => {
  try { return JSON.parse(value); } catch (_) { return value; }
};

/** 把一段较长的写作主题压缩成适合联网检索的精炼关键词（取首句/首行，截断长度）。 */
const compactSearchQuery = (topic) => {
  const raw = String(topic || '').trim();
  if (raw.length <= 40) return raw;
  const firstChunk = raw.split(/[\n。；;！!？?]/).map((s) => s.trim()).find(Boolean) || raw;
  return firstChunk.slice(0, 40);
};

/** 粗估文本 token 数：中文约 1 字/token，英文约 4 字符/token，取折中按 2 字符/token 估算。 */
const estimateTokens = (text) => Math.ceil(String(text || '').length / 2);

/** 估算消息体 token：兼容字符串与多模态 content array（图片按 1500 tokens/张粗估）。 */
const estimateMessageTokens = (content) => {
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (part?.type === 'image_url') return sum + 1500;
      if (part?.type === 'text') return sum + estimateTokens(part.text);
      return sum;
    }, 0);
  }
  return estimateTokens(content);
};

/**
 * 历史消息预算裁剪：保证 system + 历史的粗估 token 不超过 maxTokens。
 * 超出时从最早的历史轮次开始丢弃（system 永远保留，最近的对话优先保留）。
 */
const trimMessagesToBudget = (systemPrompt, messages, maxTokens) => {
  let used = estimateTokens(systemPrompt);
  const kept = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i].content);
    if (used + cost > maxTokens && kept.length > 0) break;
    used += cost;
    kept.unshift(messages[i]);
  }
  return kept;
};

module.exports = {
  isEnabledSetting,
  getLocalDateKey,
  getTodoTemporalStatus,
  safeJsonParse,
  compactSearchQuery,
  estimateTokens,
  estimateMessageTokens,
  trimMessagesToBudget
};
