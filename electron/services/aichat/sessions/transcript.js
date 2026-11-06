/**
 * 会话完整记录（pi AgentMessage[]）的读写与上下文压缩。
 *
 * - 旧会话没有完整记录：用展示消息里的文字重建（与原先只发文字历史的效果一致）。
 * - 持久化时去掉 system 消息（工具声明每轮重建）和工具结果里的图片（只留路径），过长的工具输出截断。
 * - 发给模型前的压缩沿用 utils.compactHistoryWithLLM（四级：工具输出瘦身 → 旧轮次折叠 → 摘要 → 滑窗）：
 *   先投影成它处理的 OpenAI 格式，压缩后再换回 pi 消息；没有被改动的消息原样保留（含推理内容等字段）。
 */
const { toAgentMessages, toImageContent } = require('../../llm/messages');
const { compactHistoryWithLLM } = require('../utils');

const PERSISTED_TOOL_TEXT_LIMIT = 20000;

const textOf = (content) => (Array.isArray(content)
  ? content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  : String(content ?? ''));

/** 旧会话：展示消息 → 完整记录（只有文字和用户图片） */
const fromDisplayMessages = (messages, model) => toAgentMessages(
  (messages || [])
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && !message.actionResultFor)
    .map((message) => ({ role: message.role, content: message.content })),
  model
);

/** 一轮新产生的消息 → 可持久化的形式 */
const toPersisted = (messages) => (messages || [])
  .filter((message) => message.role !== 'system')
  .map((message) => {
    if (message.role !== 'toolResult') return message;
    const content = message.content.flatMap((block) => {
      if (block.type === 'image') return [];
      if (block.type === 'text' && block.text.length > PERSISTED_TOOL_TEXT_LIMIT) {
        return [{ ...block, text: `${block.text.slice(0, PERSISTED_TOOL_TEXT_LIMIT)}…[已截断，原长 ${block.text.length} 字符]` }];
      }
      return [block];
    });
    return { ...message, content: content.length ? content : [{ type: 'text', text: '(no tool output)' }] };
  });

/** 重新生成：去掉最后一个用户消息及其后的全部内容，返回 [剩余记录, 被去掉的用户消息] */
const dropLastTurn = (transcript) => {
  const list = transcript || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role === 'user') return [list.slice(0, i), list[i]];
  }
  return [list, null];
};

// ── 压缩：pi 消息 ⇄ OpenAI 格式投影 ──

const project = (message, index) => {
  if (message.role === 'user') {
    const content = Array.isArray(message.content)
      ? message.content.map((block) => (block.type === 'image'
        ? { type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } }
        : { type: 'text', text: block.text }))
      : message.content;
    return { role: 'user', content, __index: index };
  }
  if (message.role === 'assistant') {
    const toolCalls = message.content.filter((block) => block.type === 'toolCall');
    return {
      role: 'assistant',
      content: textOf(message.content),
      ...(toolCalls.length ? { tool_calls: toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } })) } : {}),
      __index: index,
    };
  }
  if (message.role === 'toolResult') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: textOf(message.content), __index: index };
  }
  return null;
};

const sameContent = (projected, original) => JSON.stringify(projected.content) === JSON.stringify(project(original, projected.__index).content);

/** 压缩结果换回 pi 消息：没改动的用原消息，被压缩过的按新文字重建 */
const restore = (projected, originals, model) => {
  const original = projected.__index == null ? null : originals[projected.__index];
  if (!original) return toAgentMessages([{ role: projected.role, content: projected.content }], model);
  if (sameContent(projected, original)) return [original];
  if (original.role === 'user') {
    const content = Array.isArray(projected.content)
      ? projected.content.flatMap((part) => (part.type === 'image_url'
        ? [toImageContent(part.image_url?.url)].filter(Boolean)
        : [{ type: 'text', text: part.text }]))
      : projected.content;
    return [{ ...original, content }];
  }
  if (original.role === 'assistant') {
    const others = original.content.filter((block) => block.type !== 'text');
    return [{ ...original, content: [...(projected.content ? [{ type: 'text', text: projected.content }] : []), ...others] }];
  }
  return [{ ...original, content: [{ type: 'text', text: String(projected.content || '') }] }];
};

/**
 * @param {string} systemPrompt
 * @param {Array} messages  pi 消息（最后一条是本次用户消息）
 * @param {number} maxTokens
 * @param {object} options  透传 compactHistoryWithLLM 的 { summarize, cache, cacheKey }
 * @param {object} model    摘要等新消息需要 api / provider / id
 */
const compactTranscript = async (systemPrompt, messages, maxTokens, options, model) => {
  const projected = messages.map(project).filter(Boolean);
  const compacted = await compactHistoryWithLLM(systemPrompt, projected, maxTokens, options);
  return compacted.flatMap((message) => restore(message, messages, model));
};

module.exports = { fromDisplayMessages, toPersisted, dropLastTurn, compactTranscript };
