// 非流式文本生成共用的响应检查。不要把“只有 reasoning / 拒答 / 截断”当成成功。
const extractTextResponse = (data, provider = 'openai', { allowTruncated = false } = {}) => {
  const choice = provider === 'qwen' ? data.output?.choices?.[0] : data.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason ?? data.output?.finish_reason;
  const raw = provider === 'qwen' ? (data.output?.text ?? message?.content) : message?.content;
  const content = Array.isArray(raw)
    ? raw.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
    : (typeof raw === 'string' ? raw : '');
  if (message?.refusal || finishReason === 'content_filter') {
    throw new Error('模型内容审核拦截，未返回可用正文');
  }
  if (finishReason === 'length' && (!allowTruncated || !content.trim())) {
    const err = new Error(message?.reasoning_content || message?.reasoning
      ? '模型仅返回推理过程，未返回正文，请检查模型输出额度或更换模型'
      : '模型输出被 token 上限截断，请提高模型输出额度或缩小生成内容');
    err.code = !content.trim() ? 'EMPTY_TRUNCATED_RESPONSE' : 'TRUNCATED_RESPONSE';
    throw err;
  }
  if (!content.trim()) {
    throw new Error(message?.reasoning_content || message?.reasoning
      ? '模型仅返回推理过程，未返回正文，请检查模型输出额度或更换模型'
      : '模型返回空正文，请检查 AI 服务配置后重试');
  }
  return { content, usage: data.usage, finishReason, truncated: finishReason === 'length' };
};

// 去掉续写片段开头可能重新打开的代码围栏，以及模型重复回显的前文尾部重叠片段
const mergeContinuationContent = (accumulated, piece) => {
  const prev = String(accumulated || '');
  let next = String(piece || '').replace(/^\s*```[\w-]*[ \t]*\r?\n/i, '');
  if (!prev || !next) return { content: prev + next, added: next };
  const maxOverlap = Math.min(200, prev.length, next.length);
  for (let len = maxOverlap; len >= 6; len--) {
    if (prev.endsWith(next.slice(0, len))) {
      next = next.slice(len);
      break;
    }
  }
  return { content: prev + next, added: next };
};

// Both streaming and non-streaming requests use the same provider budget policy.
const getTokenCandidates = (model, maxTokens) => {
  const explicit = Number(maxTokens);
  if (Number.isFinite(explicit) && explicit > 0) return [Math.floor(explicit)];
  return /claude/i.test(String(model || ''))
    ? [64000, 32000, 16384, undefined]
    : [undefined, 64000, 32000, 16384];
};

const accumulateUsage = (current, next) => {
  if (!next) return current;
  const total = { ...current };
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (typeof next[key] === 'number') total[key] = (total[key] || 0) + next[key];
  }
  return total;
};

module.exports = { extractTextResponse, mergeContinuationContent, getTokenCandidates, accumulateUsage };
