/**
 * 记忆库相关工具的 handlers。
 */

const search_memory = async (args, _runtime, { mem0Service }) => {
  if (!mem0Service?.isAvailable()) {
    return JSON.stringify({ error: '记忆引擎未启用，无法搜索记忆库' });
  }
  const results = await mem0Service.searchMemories(
    'current_user',
    args.query,
    { limit: args.limit || 5, category: args.category }
  );
  if (!results || results.length === 0) {
    return JSON.stringify({ message: '记忆库中没有找到相关内容', results: [] });
  }
  return JSON.stringify(results.map((r) => ({
    content: r.content,
    category: r.category,
    memory_layer: r.memory_layer,
    score: r.score,
    vecScore: r.vecScore
  })));
};

const add_memory = async (args, _runtime, { mem0Service }) => {
  if (!mem0Service?.isAvailable()) {
    return JSON.stringify({ error: '记忆引擎未启用，无法保存记忆' });
  }
  if (!args.content?.trim()) return JSON.stringify({ error: '记忆内容不能为空' });
  const result = await mem0Service.addMemory(
    'current_user',
    args.content.trim(),
    { category: args.category || 'general', source: 'ai_extract', memoryLayer: args.layer }
  );
  return JSON.stringify({ success: true, id: result.id, content: args.content.trim() });
};

const update_memory = async (args, _runtime, { mem0Service }) => {
  if (!mem0Service?.isAvailable()) return JSON.stringify({ error: '记忆引擎未启用，无法更新记忆' });
  if (!args.id || !args.content?.trim()) return JSON.stringify({ error: '记忆ID和新内容不能为空' });
  try {
    const result = await mem0Service.updateMemory(args.id, args.content.trim(), { source: 'ai_extract' });
    if (!result.updated) return JSON.stringify({ error: `未找到ID为 ${args.id} 的记忆，或无更新` });
    return JSON.stringify({ success: true, id: args.id, content: args.content.trim() });
  } catch (error) {
    return JSON.stringify({ error: `更新失败: ${error.message}` });
  }
};

const list_memories = async (args, _runtime, { mem0Service }) => {
  if (!mem0Service?.isAvailable()) return JSON.stringify({ error: '记忆引擎未启用' });
  const memories = await mem0Service.getMemories(
    'current_user',
    { limit: args.limit || 20, category: args.category }
  );
  if (!memories || memories.length === 0) {
    return JSON.stringify({ message: '记忆库目前是空的，还没有保存任何内容', memories: [] });
  }
  return JSON.stringify(memories.map((m) => ({
    id: m.id,
    content: m.content,
    category: m.category,
    created_at: new Date(m.created_at).toLocaleDateString('zh-CN')
  })));
};

module.exports = { search_memory, add_memory, update_memory, list_memories };
