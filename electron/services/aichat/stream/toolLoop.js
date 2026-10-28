const { withoutReferencePayload } = require('../../aiReferences');
/**
 * 工具调用循环：
 *   1) 执行 prevResult.toolCalls 并把结果回填到 messages
 *      （assistant.tool_calls 必须紧跟对应的 tool 结果，否则 OpenAI 兼容接口会拒绝整段请求）
 *   2) 判断是否有工具已直接交付内容（delivered=true），若是则禁用工具走轻量收尾
 *   3) 达到上限时禁用工具强制最终产出
 *   4) 联网搜索次数超预算后下一轮起剔除 web_search 工具
 *   5) 有新结果时继续；重复无进展、上下文或总轮次达到预算时停止
 */

const {
  isEnabledSetting,
  safeJsonParse,
  estimateFullMessageTokens,
  compactMessagesInPlace
} = require('../utils');

const { MAX_CONTEXT_TOKENS } = require('../constants');
const MAX_WEB_SEARCH = 3;
const MAX_TOTAL_ROUNDS = 24;
const MAX_STALLED_ROUNDS = 3;

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
  let pendingConfirmation = false;
  let madeProgress = false;
  options._toolResults ||= new Map();
  const pendingImageInjections = [];
  for (const tc of prevResult.toolCalls) {
    const fnName = tc.function.name;
    const rawArgs = tc.function.arguments || '{}';
    let args = {};
    let argParseError = null;
    try {
      args = JSON.parse(rawArgs);
    } catch (err) {
      argParseError = err;
    }

    onChunk({ type: 'tool_start', name: fnName, args });
    logger?.info?.('AIChatService', `Executing tool: ${fnName}`, {
      requestId: options.requestId || null,
      conversationId: options.conversationId || null,
      name: fnName,
    });

    const toolResult = argParseError
      ? JSON.stringify({
        error: prevResult.finishReason === 'length'
          ? `工具 ${fnName} 的参数因单次输出长度上限被截断（JSON 未闭合）。请不要在单次工具参数中塞入超长内容，改为分段写入（如先创建再按段 edit_note append）或使用 write_long_document 工具。`
          : `工具 ${fnName} 的参数不是合法 JSON（${argParseError.message}），请检查格式后重试。`
      })
      : await executeTool(fnName, args, {
        requireConfirmation: options.requireConfirmation !== false,
        disabledTools: options.disabledTools,
        actionContext: options.actionContext || null,
        onChunk,
        abortSignal
      });
    // 通知前端时剔除 dataURL，避免对话历史持久化数 MB 的 base64
    const parsed = safeJsonParse(toolResult);
    const key = JSON.stringify([fnName, args]);
    if (!parsed?.error && parsed?.success !== false && options._toolResults.get(key) !== toolResult) madeProgress = true;
    options._toolResults.set(key, toolResult);
    if (parsed?.requiresConfirmation) pendingConfirmation = true;
    if (parsed && (parsed.error || parsed.success === false)) {
      logger?.warn?.('AIChatService', `Tool failed: ${fnName}`, {
        requestId: options.requestId || null,
        conversationId: options.conversationId || null,
        name: fnName,
        actionId: parsed.actionId || null,
        error: parsed.error || null,
      });
    } else if (parsed && parsed.requiresConfirmation) {
      logger?.info?.('AIChatService', `Tool pending: ${fnName}`, {
        requestId: options.requestId || null,
        conversationId: options.conversationId || null,
        name: fnName,
        actionId: parsed.actionId || null,
      });
    }
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
      content: parsed?.context?.referenceImages ? JSON.stringify(withoutReferencePayload(parsed)) : toolResult
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
  return { delivered, pendingConfirmation, madeProgress };
};

const handleToolCalls = async ({
  config,
  messages,
  prevResult,
  onChunk,
  temp,
  maxTk,
  abortSignal,
  options,
  streamRequest,
  executeTool,
  logger
}) => {
  options._toolRounds = (options._toolRounds || 0) + 1;
  const userOutputLimitApplied = options.maxTokens != null || isEnabledSetting(config.limitMaxTokens);

  const { delivered, pendingConfirmation, madeProgress } = await runToolCalls({
    messages, prevResult, onChunk, options, abortSignal, executeTool, logger
  });

  // 已经把最终内容直接交付给用户：禁用工具走轻量收尾
  if (delivered || pendingConfirmation) {
    const wrapUp = await streamRequest(
      config, messages, temp, maxTk, onChunk, abortSignal, { ...options, disableTools: true }
    );
    return {
      success: true,
      fullContent: wrapUp.content || '',
      usage: wrapUp.usage,
      finishReason: wrapUp.finishReason,
      truncated: wrapUp.finishReason === 'length',
      outputLimitApplied: userOutputLimitApplied,
      taskStatus: pendingConfirmation ? 'awaiting_confirmation' : 'delivered'
    };
  }

  options._stalledRounds = madeProgress ? 0 : (options._stalledRounds || 0) + 1;
  // 先对历史工具轮次执行分级压缩（L1/L2/L3），压缩后仍超预算才强制收尾
  const rawTokens = messages.reduce((sum, message) => sum + estimateFullMessageTokens(message), 0);
  if (rawTokens > MAX_CONTEXT_TOKENS * 0.55) {
    compactMessagesInPlace(messages, Math.floor(MAX_CONTEXT_TOKENS * 0.8));
  }
  // 达到工具轮次上限：禁用工具，强制模型基于已有结果直接产出最终回答
  const contextFull = messages.reduce((sum, message) => sum + estimateFullMessageTokens(message), 0) > MAX_CONTEXT_TOKENS * .85;
  if (contextFull || options._stalledRounds >= MAX_STALLED_ROUNDS || options._toolRounds >= MAX_TOTAL_ROUNDS) {
    messages.push({
      role: 'user',
      content: '本轮因重复调用没有取得新结果或达到上下文/执行预算而停止。请明确说明已完成与仍缺少的部分；不要编造数据或宣称整项任务完成。'
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
      outputLimitApplied: userOutputLimitApplied,
      taskStatus: 'incomplete',
      stopReason: contextFull ? 'context_budget' : options._stalledRounds >= MAX_STALLED_ROUNDS ? 'no_progress' : 'budget'
    };
  }

  // 搜索次数超预算后，下一轮起禁用 web_search，避免反复联网搜索却不产出
  const nextOptions = (options._searchCount || 0) >= MAX_WEB_SEARCH ? { ...options, noWebSearch: true } : options;
  const newResult = await streamRequest(config, messages, temp, maxTk, onChunk, abortSignal, nextOptions);

  if (newResult.toolCalls && newResult.toolCalls.length > 0) {
    return handleToolCalls({
      config, messages, prevResult: newResult, onChunk, temp, maxTk,
      abortSignal, options: nextOptions,
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
