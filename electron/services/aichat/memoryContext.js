/**
 * 长期记忆上下文：按场景从 mem0 召回相关 memories，注入到 contextPackage。
 * 把 mem0.search 的调用统一收到后端，避免前端各入口各搜各的。
 */

// 场景 → 优先召回的记忆层 + 检索条数
// 目标：profile/semantic 是主轴；episodic/artifact 默认弱化，避免旧任务污染当前回答
const SCENE_LAYER_STRATEGY = {
  chat_panel: { layers: ['profile', 'semantic'], limit: 5 },
  floating_panel: { layers: ['profile', 'semantic'], limit: 4 },
  selection_panel: { layers: ['profile', 'semantic'], limit: 3 },
  whiteboard: { layers: ['semantic', 'artifact'], limit: 3 },
};

const DEFAULT_STRATEGY = SCENE_LAYER_STRATEGY.chat_panel;

const buildMemoryQuery = (query, currentNote) => {
  const parts = [String(query || '').trim()];
  if (currentNote?.title) parts.push(currentNote.title);
  if (currentNote?.tags) parts.push(String(currentNote.tags));
  return parts.filter(Boolean).join(' ').slice(0, 320);
};

/**
 * 按场景检索 memories；同时按 layer 过滤（mem0 不直接支持按 layer 查，
 * 这里先取 topN 再过滤，少量条数下成本可控）。
 */
const fetchMemoriesByScene = async (mem0Service, { query, scene, currentNote }) => {
  if (!mem0Service?.isAvailable?.()) return [];
  const strategy = SCENE_LAYER_STRATEGY[scene] || DEFAULT_STRATEGY;
  const memQuery = buildMemoryQuery(query, currentNote);
  if (!memQuery) return [];
  try {
    const results = await mem0Service.searchMemories('current_user', memQuery, {
      limit: strategy.limit * 2,
      maxTokens: 1200,
    });
    const allowed = new Set(strategy.layers);
    return (results || [])
      .filter((m) => !m.memory_layer || allowed.has(m.memory_layer))
      .slice(0, strategy.limit);
  } catch (_) {
    return [];
  }
};

/**
 * 把 memories 写回 contextPackage（覆盖前端可能注入的同名字段，
 * 后端是 memories 唯一来源）。
 */
const enrichContextPackageWithMemories = async (contextPackage, mem0Service, { query, scene }) => {
  const pkg = contextPackage ? { ...contextPackage } : {};
  const memories = await fetchMemoriesByScene(mem0Service, {
    query,
    scene,
    currentNote: pkg.currentNote,
  });
  if (memories.length > 0) pkg.memories = memories;
  else delete pkg.memories;
  return pkg;
};

module.exports = {
  SCENE_LAYER_STRATEGY,
  enrichContextPackageWithMemories,
};
