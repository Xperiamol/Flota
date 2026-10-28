const { getTokenCandidates, accumulateUsage } = require('../../aiResponse');
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
    const availableTools = options.toolSession ? options.toolSession.getTools() : TOOLS;
    body.tools = (webSearchOn ? availableTools : availableTools.filter((t) => t.function?.name !== 'web_search'))
      .filter((t) => !disabledTools.has(t.function?.name));
    if (body.tools.length) body.tool_choice = 'auto';
    else delete body.tools;
  }

  if (provider === 'qwen') {
    const qwenUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    return { url: qwenUrl, headers: { ...headers, 'X-DashScope-SSE': 'enable' }, body };
  }

  return { url, headers, body };
};

const executeStreamFetch = async (config, messages, temp, candidateMaxTk, onChunk, abortSignal, options, aiService) => {
  const { url, headers, body } = buildRequest(config, messages, temp, candidateMaxTk, options, aiService);

  const controller = new AbortController();
  // 默认 2 分钟超时；长输出任务（如组件生成）可通过 options.timeoutMs 放宽
  const timeoutMs = Number(options?.timeoutMs) > 0 ? Math.min(Number(options.timeoutMs), 15 * 60 * 1000) : 120000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      throw Object.assign(new Error(errorMsg), { status: response.status });
    }

    return await parseSSEStream(response, onChunk);
  } finally {
    controller.abort();
    clearTimeout(timer);
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
  }
};

const requestOnce = async (config, messages, temp, maxTk, onChunk, abortSignal, options, aiService) => {
  const hasExplicitMaxTk = Number(maxTk) > 0;
  const candidates = getTokenCandidates(config.model, maxTk);

  let lastErr;
  for (let i = 0; i < candidates.length; i++) {
    const candidateMaxTk = candidates[i];
    const hasNext = i < candidates.length - 1;
    let deferredDone = null;
    try {
      const result = await executeStreamFetch(
        config,
        messages,
        temp,
        candidateMaxTk,
        (chunk) => {
          if (chunk.type === 'done') {
            deferredDone = chunk;
            return;
          }
          onChunk(chunk);
        },
        abortSignal,
        options,
        aiService
      );
      if (
        hasNext &&
        !hasExplicitMaxTk &&
        candidateMaxTk == null &&
        result.finishReason === 'length' &&
        !result.content.trim() &&
        !result.toolCalls?.length
      ) {
        continue;
      }
      if (deferredDone) onChunk(deferredDone);
      return result;
    } catch (err) {
      lastErr = err;
      if (hasNext && !hasExplicitMaxTk && candidateMaxTk != null && err?.status === 400) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('API请求失败');
};

// 只续写没有显式限长的普通正文。工具参数不能当成正文拼接，结构化长文档由其管线自行续写。
const streamRequest = async (config, messages, temp, maxTk, onChunk, abortSignal, options = {}, aiService) => {
  if (!options.autoContinue || Number(maxTk) > 0) {
    return requestOnce(config, messages, temp, maxTk, onChunk, abortSignal, options, aiService);
  }
  let currentMessages = [...messages];
  let content = '';
  let usage = null;
  let previousPart = null;
  let result;
  for (;;) {
    if (abortSignal?.aborted) throw Object.assign(new Error('已取消生成'), { name: 'AbortError' });
    // 让模型回显断点，再精确剥离；直接要求“继续”可能吞掉边界空格或重复半句话。
    const anchor = content ? Array.from(content).slice(-120).join('') : '';
    let prefix = '';
    let checkingAnchor = Boolean(anchor);
    result = await requestOnce(config, currentMessages, temp, maxTk, chunk => {
      if (chunk.type === 'done') return;
      if (chunk.type === 'content' && checkingAnchor) {
        prefix += chunk.content;
        if (anchor.startsWith(prefix)) return;
        if (!prefix.startsWith(anchor)) throw new Error('自动续写未能对齐断点，已保留原文，请重试继续生成');
        checkingAnchor = false;
        if (prefix.length > anchor.length) onChunk({ type: 'content', content: prefix.slice(anchor.length) });
        return;
      }
      onChunk(chunk);
    }, abortSignal, content ? { ...options, disableTools: true } : options, aiService);
    if (anchor) {
      if (!result.content.startsWith(anchor)) throw new Error('自动续写未能对齐断点，已保留原文，请重试继续生成');
      result.content = result.content.slice(anchor.length);
    }
    if (previousPart !== null && !result.content.trim()) result.finishReason = 'length';
    content += result.content;
    usage = accumulateUsage(usage, result.usage);
    if (result.finishReason !== 'length' || result.toolCalls?.length ||
        !result.content.trim() || result.content === previousPart) break;
    previousPart = result.content;
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: result.content },
      { role: 'user', content: `上条回复因单次输出长度被截断。请先逐字回显下面 JSON 字符串所表示的断点原文（不加引号或代码围栏，不转义，保留原有换行），紧接着从断点继续完成原始任务。续写开头所需的空格和换行必须保留；不要重写开头或解释续写过程。断点原文：${JSON.stringify(Array.from(content).slice(-120).join(''))}` }
    ];
  }
  onChunk({ type: 'done', finishReason: result.finishReason });
  return { ...result, content, usage };
};

module.exports = { buildRequest, streamRequest };
