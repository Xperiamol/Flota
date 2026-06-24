/**
 * SSE 流解析：把 chat completions 的流式响应解码为 onChunk 事件，
 * 同时聚合 tool_calls / usage / finishReason。
 *
 * 兼容点：部分模型不会用 OpenAI 的 tool_calls 字段，而是把工具调用以
 *   <tool_call><function=NAME><parameter=KEY>VALUE</parameter>...</function></tool_call>
 * 这种文本格式塞进 content。这里在流式阶段就把这段文本拦截不发给 UI，
 * 流结束后再解析为标准的 tool_calls。
 */

const TOOL_CALL_OPEN = '<tool_call>';
const TOOL_CALL_OPEN_PREFIX_MAX = TOOL_CALL_OPEN.length - 1;

const findOpenIndex = (text) => {
  const direct = text.indexOf(TOOL_CALL_OPEN);
  if (direct >= 0) return { idx: direct, partial: false };
  // 检查尾部是否可能是 <tool_call> 的前缀，留作下一次再判断
  const start = Math.max(0, text.length - TOOL_CALL_OPEN_PREFIX_MAX);
  for (let i = start; i < text.length; i++) {
    const tail = text.slice(i);
    if (TOOL_CALL_OPEN.startsWith(tail)) return { idx: i, partial: true };
  }
  return { idx: -1, partial: false };
};

const parseTextualToolCalls = (text) => {
  if (!text || !text.includes(TOOL_CALL_OPEN)) return [];
  const calls = [];
  const blockRe = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let blockMatch;
  let idx = 0;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    const block = blockMatch[1];
    const fnMatch = /<function=([\w.\-]+)>([\s\S]*?)<\/function>/.exec(block);
    if (!fnMatch) continue;
    const name = fnMatch[1];
    const inside = fnMatch[2];
    const paramRe = /<parameter=([\w.\-]+)>([\s\S]*?)<\/parameter>/g;
    const argObj = {};
    let pm;
    while ((pm = paramRe.exec(inside)) !== null) {
      const key = pm[1];
      const raw = pm[2].trim();
      let value = raw;
      if (raw.startsWith('{') || raw.startsWith('[')) {
        try { value = JSON.parse(raw); } catch (_) { value = raw; }
      } else if (raw === 'true' || raw === 'false') {
        value = raw === 'true';
      } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
        const num = Number(raw);
        if (!Number.isNaN(num)) value = num;
      }
      argObj[key] = value;
    }
    calls.push({
      id: `text_call_${idx++}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(argObj) }
    });
  }
  return calls;
};

const parseSSEStream = async (response, onChunk) => {
  let fullContent = '';
  let toolCalls = [];
  let usage = null;
  let finishReason = null;
  let emittedDone = false;

  // 文本工具调用流式过滤状态
  let pendingContent = '';   // 未确认是否安全 emit 的尾部缓冲
  let toolTextBuffer = '';   // 已经确认进入 <tool_call> 的全部文本
  let inToolText = false;

  const flushSafe = (text) => {
    if (!text) return;
    fullContent += text;
    onChunk({ type: 'content', content: text });
  };

  const consumeContent = (delta) => {
    if (!delta) return;
    if (inToolText) {
      toolTextBuffer += delta;
      return;
    }
    pendingContent += delta;
    while (pendingContent) {
      const { idx, partial } = findOpenIndex(pendingContent);
      if (idx === -1) {
        flushSafe(pendingContent);
        pendingContent = '';
        break;
      }
      if (idx > 0) flushSafe(pendingContent.slice(0, idx));
      if (partial) {
        pendingContent = pendingContent.slice(idx);
        break;
      }
      inToolText = true;
      toolTextBuffer = pendingContent.slice(idx);
      pendingContent = '';
      break;
    }
  };

  const finalizeContent = () => {
    if (inToolText) {
      const parsed = parseTextualToolCalls(toolTextBuffer);
      if (parsed.length > 0) {
        for (const tc of parsed) toolCalls.push(tc);
        if (!finishReason) finishReason = 'tool_calls';
        return;
      }
      // 解析失败则把这段当作普通文字补发，保证用户不丢内容
      flushSafe(toolTextBuffer);
      toolTextBuffer = '';
      inToolText = false;
    }
    if (pendingContent) {
      flushSafe(pendingContent);
      pendingContent = '';
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitDone = () => {
    if (emittedDone) return;
    finalizeContent();
    emittedDone = true;
    onChunk({ type: 'done', finishReason });
  };

  const handleData = (data) => {
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') emitDone();
      return;
    }

    let parsed;
    try { parsed = JSON.parse(data); } catch (_) { return; }

    if (parsed.usage) usage = parsed.usage;

    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    if (choice?.finish_reason) finishReason = choice.finish_reason;

    if (delta?.content) consumeContent(delta.content);

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) {
          toolCalls[idx] = {
            id: tc.id || `call_${idx}`,
            type: 'function',
            function: { name: '', arguments: '' }
          };
        }
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }

    if (choice?.finish_reason) emitDone();
  };

  const processLines = (text) => {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      handleData(trimmed.replace(/^data:\s*/, ''));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    processLines(lines.join('\n'));
  }

  buffer += decoder.decode();
  if (buffer.trim()) processLines(buffer);
  if (!emittedDone) emitDone();

  toolCalls = toolCalls.filter((tc) => tc && tc.function.name);
  return { content: fullContent, toolCalls, usage, finishReason };
};

module.exports = { parseSSEStream };
