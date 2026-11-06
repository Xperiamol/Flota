/**
 * Flota 历史消息（OpenAI 格式：{ role, content }，content 为字符串或 text / image_url 多模态数组）
 * → pi 的 AgentMessage。
 *
 * 渲染层目前只保存 user / assistant 的文字（不含工具调用记录），所以这里只转这两类；
 * 历史压缩产生的 system 摘要当作 user 文字。
 */
const ZERO_USAGE = Object.freeze({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

/** data:image/png;base64,xxx → pi ImageContent；不是 data URL 时返回 null */
const toImageContent = (url) => {
  const match = DATA_URL.exec(String(url || ''));
  return match ? { type: 'image', mimeType: match[1], data: match[2] } : null;
};

const toUserContent = (content) => {
  if (!Array.isArray(content)) return String(content ?? '');
  const blocks = content.flatMap((part) => {
    if (part?.type === 'text') return [{ type: 'text', text: String(part.text || '') }];
    if (part?.type === 'image_url') {
      const image = toImageContent(part.image_url?.url);
      return image ? [image] : [];
    }
    return [];
  });
  return blocks.length ? blocks : '';
};

const textOf = (content) => (Array.isArray(content)
  ? content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n')
  : String(content ?? ''));

const toAgentMessages = (history, model, now = Date.now()) => (Array.isArray(history) ? history : [])
  .flatMap((message, index) => {
    const timestamp = now - (history.length - index);
    if (message?.role === 'user' || message?.role === 'system') {
      return [{ role: 'user', content: message.role === 'system' ? textOf(message.content) : toUserContent(message.content), timestamp }];
    }
    if (message?.role === 'assistant') {
      const text = textOf(message.content);
      if (!text.trim()) return [];
      return [{
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: ZERO_USAGE,
        stopReason: 'stop',
        timestamp,
      }];
    }
    return [];
  });

/** pi 的 Usage → Flota 原先使用的 OpenAI usage 形状 */
const toOpenAIUsage = (usage) => (usage ? {
  prompt_tokens: usage.input || 0,
  completion_tokens: usage.output || 0,
  total_tokens: usage.totalTokens || (usage.input || 0) + (usage.output || 0),
} : null);

const addUsage = (total, usage) => {
  if (!usage) return total;
  const next = toOpenAIUsage(usage);
  if (!total) return next;
  return {
    prompt_tokens: total.prompt_tokens + next.prompt_tokens,
    completion_tokens: total.completion_tokens + next.completion_tokens,
    total_tokens: total.total_tokens + next.total_tokens,
  };
};

const assistantText = (message) => (message?.content || [])
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('');

module.exports = { toAgentMessages, toImageContent, toOpenAIUsage, addUsage, assistantText, ZERO_USAGE };
