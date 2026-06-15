/**
 * 工具调用循环：
 *   1) 执行 prevResult.toolCalls 并把结果回填到 messages
 *      （assistant.tool_calls 必须紧跟对应的 tool 结果，否则 OpenAI 兼容接口会拒绝整段请求）
 *   2) 判断是否有工具已直接交付内容（delivered=true），若是则禁用工具走轻量收尾
 *   3) 达到上限时禁用工具强制最终产出
 *   4) 联网搜索次数超预算后下一轮起剔除 web_search 工具
 */

const { isEnabledSetting, safeJsonParse } = require('../utils');

const MAX_DEPTH = 3;
const MAX_WEB_SEARCH = 3;

const runToolCalls = async ({
  messages,
  prevResult,
  onChunk,
  options,
  abortSignal,
  executeTool,
  logger
}) => {
  messages.push({
    role: 'assistant',
    content: prevResult.content || null,
    tool_calls: prevResult.toolCalls
  });

  let delivered = false;
  const pendingImageInjections = [];
  for (const tc of prevResult.toolCalls) {
    const fnName = tc.function.name;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}

    onChunk({ type: 'tool_start', name: fnName, args });
    logger?.info?.('AIChatService', `Executing tool: ${fnName}`, args);

    const toolResult = await executeTool(fnName, args, {
      requireConfirmation: options.requireConfirmation !== false,
      disabledTools: options.disabledTools,
      onChunk,
      abortSignal
    });
    // 通知前端时剔除 dataURL，避免对话历史持久化数 MB 的 base64
    const parsed = safeJsonParse(toolResult);
    const publicResult = parsed && parsed.delivered_image
      ? JSON.stringify({ ok: true, path: parsed.path })
      : toolResult;
    onChunk({ type: 'tool_end', name: fnName, result: publicResult });

    if (fnName === 'web_search') options._searchCount = (options._searchCount || 0) + 1;

    if (parsed && parsed.delivered === true) delivered = true;

    // read_note_image：把 dataURL 从 tool 结果中剥离，作为后续 user 消息里的 vision part 注入
    if (parsed && parsed.delivered_image) {
      pendingImageInjections.push({ url: parsed.delivered_image, path: parsed.path });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({ ok: true, path: parsed.path, note: '图片已作为下一条 user 消息的视觉输入提供' })
      });
      continue;
    }

    messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: toolResult
    });
  }
  if (pendingImageInjections.length > 0) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `以下是按需取出的笔记图片（${pendingImageInjections.map(p => p.path).join(', ')}），请基于图片内容继续回答：` },
        ...pendingImageInjections.map((p) => ({ type: 'image_url', image_url: { url: p.url } }))
      ]
    });
  }
  return delivered;
};

const handleToolCalls = async ({
  config,
  messages,
  prevResult,
  onChunk,
  temp,
  maxTk,
  depth,
  abortSignal,
  options,
  streamRequest,
  executeTool,
  logger
}) => {
  const userOutputLimitApplied = options.maxTokens != null || isEnabledSetting(config.limitMaxTokens);

  const delivered = await runToolCalls({
    messages, prevResult, onChunk, options, abortSignal, executeTool, logger
  });

  // 已经把最终内容直接交付给用户：禁用工具走轻量收尾
  if (delivered) {
    const wrapUp = await streamRequest(
      config, messages, temp, maxTk, onChunk, abortSignal, { ...options, disableTools: true }
    );
    return {
      success: true,
      fullContent: wrapUp.content || '',
      usage: wrapUp.usage,
      finishReason: wrapUp.finishReason,
      truncated: wrapUp.finishReason === 'length',
      outputLimitApplied: userOutputLimitApplied
    };
  }

  // 达到工具轮次上限：禁用工具，强制模型基于已有结果直接产出最终回答
  if (depth >= MAX_DEPTH) {
    messages.push({
      role: 'user',
      content: '你已经拿到了足够多的工具结果，不要再调用任何工具。现在请基于已有上下文直接给出最终回答或最终文档；若用户要的是长文档/报告/方案，请直接完整输出最终内容。'
    });
    const forcedFinal = await streamRequest(
      config, messages, temp, maxTk, onChunk, abortSignal, { ...options, disableTools: true }
    );
    return {
      success: true,
      fullContent: forcedFinal.content || '',
      usage: forcedFinal.usage,
      finishReason: forcedFinal.finishReason,
      truncated: forcedFinal.finishReason === 'length',
      outputLimitApplied: userOutputLimitApplied
    };
  }

  // 搜索次数超预算后，下一轮起禁用 web_search，避免反复联网搜索却不产出
  const nextOptions = (options._searchCount || 0) >= MAX_WEB_SEARCH ? { ...options, noWebSearch: true } : options;
  const newResult = await streamRequest(config, messages, temp, maxTk, onChunk, abortSignal, nextOptions);

  if (newResult.toolCalls && newResult.toolCalls.length > 0) {
    return handleToolCalls({
      config, messages, prevResult: newResult, onChunk, temp, maxTk,
      depth: depth + 1, abortSignal, options: nextOptions,
      streamRequest, executeTool, logger
    });
  }

  return {
    success: true,
    fullContent: newResult.content,
    usage: newResult.usage,
    finishReason: newResult.finishReason,
    truncated: newResult.finishReason === 'length',
    outputLimitApplied: userOutputLimitApplied
  };
};

module.exports = { handleToolCalls };
