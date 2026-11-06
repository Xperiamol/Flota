/**
 * 无工具的纯文本流式生成（长文档、记忆提取、历史压缩、剪藏、组件生成等内部任务）。
 *
 * 直接调用 pi-ai 的 OpenAI Chat Completions 实现，不经过 Agent 循环。
 * autoContinue：输出因长度被截断时追加一轮「继续」，用 mergeContinuationContent 去掉续写开头的重复。
 */
const { loadPi } = require('./piRuntime');
const { openStream } = require('./stream');
const { toAgentMessages, addUsage, assistantText } = require('./messages');

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

const MAX_CONTINUATIONS = 8;
const CONTINUE_PROMPT = '上一条回复因为长度被截断了。请从断点处直接接着写，不要重复已经写过的内容，也不要解释。';

const splitSystem = (messages) => {
  const system = messages.filter((message) => message.role === 'system').map((message) => String(message.content || '')).join('\n\n');
  return { systemPrompt: system || undefined, history: messages.filter((message) => message.role !== 'system') };
};

const streamOnce = async ({ model, systemPrompt, history, requestOptions, onToken }) => {
  const { normalizeContext } = await loadPi();
  const events = await openStream(model, normalizeContext({ systemPrompt, messages: history }), requestOptions);
  for await (const event of events) {
    if (event.type === 'text_delta' && onToken) onToken(event.delta);
  }
  const message = await events.result();
  if (message.stopReason === 'error') throw new Error(message.errorMessage || 'AI 请求失败');
  if (message.stopReason === 'aborted') throw Object.assign(new Error('已取消生成'), { name: 'AbortError' });
  return message;
};

/**
 * @param {object} params
 * @param {object} params.model           buildModel() 的结果
 * @param {Array}  params.messages        OpenAI 格式消息（可含 system）
 * @param {object} params.requestOptions  buildRequestOptions() 的结果
 * @param {(token: string) => void} [params.onToken]
 * @param {boolean} [params.autoContinue]
 */
const generateText = async ({ model, messages, requestOptions, onToken, autoContinue = false }) => {
  const { systemPrompt, history: rawHistory } = splitSystem(messages);
  let history = toAgentMessages(rawHistory, model);
  let content = '';
  let usage = null;
  let message;
  for (let round = 0; ; round += 1) {
    message = await streamOnce({ model, systemPrompt, history, requestOptions, onToken: round === 0 ? onToken : null });
    usage = addUsage(usage, message.usage);
    const piece = assistantText(message);
    const merged = round === 0 ? { content: piece, added: piece } : mergeContinuationContent(content, piece);
    // 续写轮次去掉重复后才把新增部分推给调用方，避免回显的前文出现两遍
    if (round > 0 && onToken && merged.added) onToken(merged.added);
    content = merged.content;
    const truncated = message.stopReason === 'length';
    if (!autoContinue || !truncated || !piece.trim() || round >= MAX_CONTINUATIONS) break;
    history = [...history, message, { role: 'user', content: CONTINUE_PROMPT, timestamp: Date.now() }];
  }
  const finishReason = message.stopReason === 'length' ? 'length' : 'stop';
  // 只返回推理、没有正文时，调用方可以给出更准确的提示
  const reasoningOnly = !content.trim() && (message.content || []).some((block) => block.type === 'thinking');
  return { content, finishReason, truncated: finishReason === 'length', usage, reasoningOnly };
};

module.exports = { generateText, mergeContinuationContent };
