/**
 * 带工具的流式对话：pi-agent-core 的 Agent 循环 + Flota 的工具与规则。
 *
 * Flota 的规则挂在 pi 的扩展点上，循环本身交给 pi：
 *   - 按需加载技能：每轮开始前（prepareNextTurn）按已加载的技能重建工具列表
 *   - 有确认卡 / 工具已直接交付结果：下一轮不再允许调用工具（tool_choice: none），只写一段收尾
 *   - 预算：总轮次上限、连续无进展、上下文接近上限 → 追加说明并停止调用工具，标记未完成
 *   收尾时不撤掉工具声明：有工具历史的会话里 pi-ai 会改发空的 tools 数组，部分服务商不接受；
 *   tool_choice: none 各家都支持，模型万一仍发起调用也会在 beforeToolCall 被拦下。
 *   - 联网搜索超过次数后，下一轮起去掉 web_search
 *   - 旧轮次的工具输出在请求前压缩（transformContext），不改动会话记录本身
 *   - 读图：工具结果直接带图片，由 pi-ai 转成附图消息
 *
 * 输出的事件沿用渲染层现有格式：content / tool_call_prepare / tool_start / tool_end，
 * 工具执行过程中的 step_* 进度由工具自己通过 onChunk 发出。
 */
const { loadPi } = require('../../llm/piRuntime');
const { openStream } = require('../../llm/stream');
const { toImageContent, addUsage, assistantText } = require('../../llm/messages');
const { safeJsonParse, estimateTokens, compactToolMessageContent } = require('../utils');
const { withoutReferencePayload } = require('../../aiReferences');
const { MAX_CONTEXT_TOKENS } = require('../constants');

const MAX_WEB_SEARCH = 3;
const MAX_TOTAL_ROUNDS = 24;
const MAX_STALLED_ROUNDS = 3;
// 出了确认卡之后还允许几轮工具调用：用来修正同轮失败的调用，或看过渲染图后交修正版
const MAX_ROUNDS_AFTER_CARD = 2;
const COMPACT_ABOVE = 0.55; // 超过上下文预算的这个比例时，压缩旧轮次的工具输出
const STOP_ABOVE = 0.85; // 压缩后仍超过这个比例就停止继续调用工具

// 模型不接受图片时各家的报错（中转站的中文提示、OpenAI / DeepSeek / 通义的英文提示）
const IMAGE_REJECTED = /不支持图片|不支持视觉|image_url|does not support (?:image|vision)|image input|unknown variant `image/i;
const IMAGE_DROPPED_NOTE = '[图片未发送：当前模型不支持图片输入]';
const hasImages = (context) => context.messages.some((message) => Array.isArray(message.content) && message.content.some((block) => block.type === 'image'));
const withoutImages = (context) => ({
  ...context,
  messages: context.messages.map((message) => (Array.isArray(message.content) && message.content.some((block) => block.type === 'image')
    ? { ...message, content: [...message.content.filter((block) => block.type !== 'image'), { type: 'text', text: IMAGE_DROPPED_NOTE }] }
    : message)),
});

const BUDGET_STOP_PROMPT = '本轮因重复调用没有取得新结果或达到上下文/执行预算而停止。请明确说明已完成与仍缺少的部分；不要编造数据或宣称整项任务完成。';

const textOfBlocks = (content) => (Array.isArray(content)
  ? content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  : String(content || ''));

const estimateMessages = (messages) => messages.reduce((sum, message) => {
  const images = Array.isArray(message.content) ? message.content.filter((block) => block.type === 'image').length : 0;
  const toolCalls = Array.isArray(message.content)
    ? message.content.filter((block) => block.type === 'toolCall').map((block) => JSON.stringify(block.arguments || {})).join('')
    : '';
  return sum + estimateTokens(textOfBlocks(message.content) + toolCalls) + images * 800;
}, 0);

/** 旧轮次（最后一次工具调用之前）的工具输出做结构化压缩；返回新数组，不改原记录 */
const compactOldToolResults = (messages) => {
  let lastToolCallIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant' && message.content?.some?.((block) => block.type === 'toolCall')) {
      lastToolCallIndex = i;
      break;
    }
  }
  if (lastToolCallIndex <= 0) return messages;
  return messages.map((message, index) => {
    if (index >= lastToolCallIndex || message.role !== 'toolResult') return message;
    return {
      ...message,
      content: message.content.map((block) => (block.type === 'text' ? { ...block, text: compactToolMessageContent(block.text) } : block)),
    };
  });
};

/** 发给模型前的上下文：超过预算一定比例时压缩旧工具输出 */
const fitContext = (messages) => (estimateMessages(messages) > MAX_CONTEXT_TOKENS * COMPACT_ABOVE
  ? compactOldToolResults(messages)
  : messages);

/** Flota 工具（返回 JSON 字符串）的结果 → 给模型看的内容 + 给前端看的结果 */
const toToolOutput = (raw) => {
  const parsed = safeJsonParse(raw);
  // 读图：图片直接放进工具结果，由 pi-ai 转成附图消息；前端只拿到路径，避免会话里存几 MB 的 base64
  if (parsed?.delivered_image) {
    const image = toImageContent(parsed.delivered_image);
    const note = { ok: true, path: parsed.path };
    return {
      parsed,
      publicResult: JSON.stringify(note),
      content: [{ type: 'text', text: JSON.stringify(note) }, ...(image ? [image] : [])],
    };
  }
  // 画布提案附带的渲染图：给模型看，不存进会话记录
  if (parsed?.preview_image) {
    const { preview_image: dataUrl, ...rest } = parsed;
    const image = toImageContent(dataUrl);
    const text = JSON.stringify(rest?.context?.referenceImages ? withoutReferencePayload(rest) : rest);
    return { parsed: rest, publicResult: JSON.stringify(rest), content: [{ type: 'text', text }, ...(image ? [image] : [])] };
  }
  const modelText = parsed?.context?.referenceImages ? JSON.stringify(withoutReferencePayload(parsed)) : raw;
  return { parsed, publicResult: raw, content: [{ type: 'text', text: modelText }] };
};

/**
 * @param {object} params
 * @param {object} params.model, params.requestOptions  buildModel / buildRequestOptions 的结果
 * @param {string} params.systemPrompt
 * @param {Array}  params.history          pi 消息（已压缩的历史，不含本次用户消息）
 * @param {object} params.prompt           本次用户消息（pi UserMessage）
 * @param {object} params.toolSession      createSkillSession() 的结果
 * @param {(name, args, runtime) => Promise<string>} params.executeTool  返回 JSON 字符串
 * @param {(chunk) => void} params.onChunk
 * @param {AbortSignal} [params.abortSignal]
 * @param {boolean} [params.disableTools]
 * @param {(text: string) => string|null} [params.phantomNudge]  回复空口声称有确认卡时返回纠正提示
 */
const runChat = async ({
  model, requestOptions, systemPrompt, history, prompt, toolSession, executeTool, onChunk,
  abortSignal, disableTools = false, phantomNudge = null,
}) => {
  const { Agent, createAssistantMessageEventStream } = await loadPi();
  const run = {
    rounds: 0,
    stalled: 0,
    searches: 0,
    progressThisTurn: false,
    delivered: false,
    pendingConfirmation: false,
    wrapUp: false,
    taskStatus: undefined,
    stopReason: undefined,
    seenResults: new Map(),
    content: '',
    usage: null,
  };

  const toAgentTool = (definition) => ({
    name: definition.function.name,
    label: definition.function.name,
    description: definition.function.description,
    parameters: definition.function.parameters,
    execute: async (_toolCallId, args, signal) => {
      const name = definition.function.name;
      const raw = await executeTool(name, args, { onChunk, abortSignal: signal || abortSignal });
      const { parsed, publicResult, content } = toToolOutput(raw);
      const failed = Boolean(parsed?.error || parsed?.success === false);
      // 无进展判断：同一个调用（工具 + 参数）返回了和上次一样的结果，不算进展
      const key = JSON.stringify([name, args]);
      if (!failed && run.seenResults.get(key) !== raw) run.progressThisTurn = true;
      if (failed) run.failedThisTurn = true;
      run.seenResults.set(key, raw);
      if (parsed?.requiresConfirmation) run.pendingConfirmation = true;
      // 画布确认卡附带了渲染图：模型看过之后可能要交修正版，下一轮保留工具
      if (parsed?.requiresConfirmation && parsed?.rendered) run.inspectsResult = true;
      if (parsed?.delivered === true) run.delivered = true;
      if (name === 'web_search') run.searches += 1;
      return { content, details: { publicResult }, isError: failed };
    },
  });

  const currentTools = () => {
    if (disableTools) return [];
    const definitions = toolSession.getTools()
      .filter((tool) => run.searches < MAX_WEB_SEARCH || tool.function.name !== 'web_search');
    return definitions.map(toAgentTool);
  };

  // 每轮工具执行完、下一轮请求前：决定下一轮能用哪些工具，必要时追加说明
  const prepareNextTurn = ({ context }) => {
    run.rounds += 1;
    if (run.wrapUp) return undefined;
    // 有了确认卡 / 已交付结果：通常只写收尾。本轮有调用失败（让模型修正），或画布卡附了渲染图（模型可能交修正版）时，
    // 再给有限几轮工具调用
    if (run.delivered || run.pendingConfirmation) {
      run.roundsAfterCard = (run.roundsAfterCard || 0) + 1;
      const keepGoing = (run.failedThisTurn || run.inspectsResult) && run.roundsAfterCard <= MAX_ROUNDS_AFTER_CARD;
      run.failedThisTurn = false;
      run.inspectsResult = false;
      if (!keepGoing) {
        run.wrapUp = true;
        run.taskStatus = run.pendingConfirmation ? 'awaiting_confirmation' : 'delivered';
        return undefined;
      }
      return { context: { ...context, tools: currentTools() } };
    }
    run.failedThisTurn = false;
    run.stalled = run.progressThisTurn ? 0 : run.stalled + 1;
    run.progressThisTurn = false;
    const contextFull = estimateMessages(fitContext(context.messages)) > MAX_CONTEXT_TOKENS * STOP_ABOVE;
    if (contextFull || run.stalled >= MAX_STALLED_ROUNDS || run.rounds >= MAX_TOTAL_ROUNDS) {
      run.wrapUp = true;
      run.taskStatus = 'incomplete';
      run.stopReason = contextFull ? 'context_budget' : run.stalled >= MAX_STALLED_ROUNDS ? 'no_progress' : 'budget';
      return { messages: [{ role: 'user', content: BUDGET_STOP_PROMPT, timestamp: Date.now() }] };
    }
    return { context: { ...context, tools: currentTools() } };
  };

  if (prompt?.role !== 'user') throw new Error('对话缺少用户消息');

  const agent = new Agent({
    initialState: { systemPrompt, model, tools: currentTools(), messages: history },
    // 「图片理解」开着但模型其实不收图片时：第一次被拒就去掉图片重发，本轮之后也不再带图，不让整轮失败
    streamFn: async (streamModel, context, options) => {
      const send = (ctx) => openStream(streamModel, ctx, {
        ...options,
        ...requestOptions,
        signal: options?.signal,
        ...(run.wrapUp ? { toolChoice: 'none' } : {}),
      });
      if (!hasImages(context)) return send(context);
      if (run.imagesRejected) return send(withoutImages(context));
      const first = await send(context);
      const out = createAssistantMessageEventStream();
      (async () => {
        let started = false;
        for await (const event of first) {
          if (!started && event.type === 'error' && IMAGE_REJECTED.test(String(event.error?.errorMessage || ''))) {
            run.imagesRejected = true;
            for await (const retried of await send(withoutImages(context))) out.push(retried);
            out.end();
            return;
          }
          if (event.type !== 'start') started = true;
          out.push(event);
        }
        out.end();
      })().catch(() => out.end());
      return out;
    },
    identity: requestOptions.identity,
    transformContext: async (messages) => fitContext(messages),
    prepareNextTurnWithContext: prepareNextTurn,
    // 收尾轮次只写文字：万一模型仍发起工具调用，不执行，并在这一轮后结束
    beforeToolCall: async () => (run.wrapUp
      ? { block: true, reason: JSON.stringify({ success: false, error: '本轮已停止调用工具，请直接用文字回答。' }), terminate: true }
      : undefined),
    finishTurn: () => (run.inWrapUpTurn ? { action: 'end' } : undefined),
    toolExecution: 'sequential',
  });

  agent.subscribe((event) => {
    if (event.type === 'turn_start' && run.wrapUp) run.inWrapUpTurn = true;
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update?.type === 'text_delta' && update.delta) {
        // 纠正轮的文字接在上一段之后，首段内容前补一个空行分隔
        if (run.separateNextText) {
          run.separateNextText = false;
          if (run.content) {
            run.content += '\n\n';
            onChunk({ type: 'content', content: '\n\n' });
          }
        }
        run.content += update.delta;
        onChunk({ type: 'content', content: update.delta });
      } else if (update?.type === 'toolcall_start') {
        const block = update.partial?.content?.[update.contentIndex];
        if (block?.name) onChunk({ type: 'tool_call_prepare', name: block.name });
      }
    } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
      run.usage = addUsage(run.usage, event.message.usage);
    } else if (event.type === 'tool_execution_start') {
      onChunk({ type: 'tool_start', name: event.toolName, args: event.args || {} });
    } else if (event.type === 'tool_execution_end') {
      const publicResult = event.result?.details?.publicResult
        ?? JSON.stringify({ success: false, error: textOfBlocks(event.result?.content) || '工具执行失败' });
      onChunk({ type: 'tool_end', name: event.toolName, result: publicResult });
    }
  });

  const onAbort = () => agent.abort();
  if (abortSignal?.aborted) throw Object.assign(new Error('已取消生成'), { name: 'AbortError' });
  abortSignal?.addEventListener('abort', onAbort, { once: true });

  const settle = () => {
    const last = agent.state.messages.at(-1);
    if (last?.role === 'assistant' && last.stopReason === 'aborted') {
      throw Object.assign(new Error('已取消生成'), { name: 'AbortError' });
    }
    if (last?.role === 'assistant' && last.stopReason === 'error') {
      throw new Error(last.errorMessage || agent.state.errorMessage || 'AI 请求失败');
    }
    return last;
  };

  // 构造后的记录里已有开头的 system 消息和历史；之后追加的都是本轮新消息
  const startLength = agent.state.messages.length;
  try {
    await agent.prompt(prompt);
    let last = settle();

    // 回复声称已生成确认卡、实际却没有调用写入工具：追加一轮纠正，让模型真正调用工具
    const nudge = !run.pendingConfirmation && run.taskStatus !== 'incomplete' && !disableTools && phantomNudge
      ? phantomNudge(assistantText(last))
      : null;
    if (nudge) {
      Object.assign(run, { wrapUp: false, inWrapUpTurn: false, delivered: false, stalled: 0, separateNextText: true });
      agent.state.tools = currentTools();
      await agent.prompt({ role: 'user', content: nudge, timestamp: Date.now() });
      last = settle();
    }

    const finishReason = last?.stopReason === 'length' ? 'length' : 'stop';
    return {
      content: run.content || assistantText(last),
      usage: run.usage,
      finishReason,
      truncated: finishReason === 'length',
      taskStatus: run.taskStatus,
      stopReason: run.stopReason,
      pendingConfirmation: run.pendingConfirmation,
      retriedPhantomClaim: Boolean(nudge),
      // 本轮新增的消息（用户消息、助手回复、工具调用与结果），由会话服务追加进完整记录
      newMessages: agent.state.messages.slice(startLength),
    };
  } finally {
    abortSignal?.removeEventListener('abort', onAbort);
  }
};

module.exports = { runChat, compactOldToolResults, toToolOutput };
