/**
 * SSE 流解析：把 chat completions 的流式响应解码为 onChunk 事件，
 * 同时聚合 tool_calls / usage / finishReason。
 */

const parseSSEStream = async (response, onChunk) => {
  let fullContent = '';
  let toolCalls = [];
  let usage = null;
  let finishReason = null;
  let emittedDone = false;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitDone = () => {
    if (emittedDone) return;
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

    if (delta?.content) {
      fullContent += delta.content;
      onChunk({ type: 'content', content: delta.content });
    }

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
