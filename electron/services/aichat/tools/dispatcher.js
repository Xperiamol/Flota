/**
 * 工具 dispatcher：聚合 handler registry，按 name 路由。
 * 所有 handler 签名统一为：(args, runtime, services) => Promise<string JSON>
 *   - args: 模型生成的工具参数
 *   - runtime: { onChunk, abortSignal }
 *   - services: AIChatService 注入的依赖容器（DAO / aiService / 等）
 */

const notes = require('./handlers/notes');
const todos = require('./handlers/todos');
const memories = require('./handlers/memories');
const webSearch = require('./handlers/webSearch');
const longDocument = require('./handlers/longDocument');

const HANDLERS = Object.freeze({
  ...notes,
  ...todos,
  ...memories,
  ...webSearch,
  ...longDocument
});

const dispatchTool = async (name, args, runtime, services) => {
  const handler = HANDLERS[name];
  if (!handler) return JSON.stringify({ error: `未知工具: ${name}` });
  return handler(args || {}, runtime || {}, services);
};

module.exports = { HANDLERS, dispatchTool };
