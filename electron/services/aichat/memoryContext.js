/**
 * 长期记忆上下文：按场景从 mem0 召回相关 memories，注入到 contextPackage。
 * 把 mem0.search 的调用统一收到后端，避免前端各入口各搜各的。
 */

// 场景 → 优先召回的记忆层 + 检索条数
// 目标：profile/semantic 是主轴，episodic（近况）也参与对话；笔记 / 待办索引（artifact）
// 不进对话——当前笔记和相关笔记由 contextPackage 另外注入，旧任务也不该污染当前回答
const SCENE_LAYER_STRATEGY = {
  chat_panel: { layers: ['profile', 'semantic', 'episodic'], limit: 5 },
  floating_panel: { layers: ['profile', 'semantic', 'episodic'], limit: 4 },
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
 * 按场景检索 memories，按 layer 在查询里过滤。
 */
const fetchMemoriesByScene = async (mem0Service, { query, scene, currentNote }) => {
  if (!mem0Service?.isAvailable?.()) return [];
  const strategy = SCENE_LAYER_STRATEGY[scene] || DEFAULT_STRATEGY;
  const memQuery = buildMemoryQuery(query, currentNote);
  if (!memQuery) return [];
  try {
    return await mem0Service.searchMemories('current_user', memQuery, {
      limit: strategy.limit,
      layers: strategy.layers,
      maxTokens: 1200,
    }) || [];
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
