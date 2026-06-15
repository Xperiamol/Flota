/**
 * 待确认动作（写入类工具的二次确认）。
 */

const { ACTION_LABELS } = require('./constants');

class PendingActionStore {
  constructor({ mem0Service }) {
    this.mem0Service = mem0Service;
    this._pendingActions = new Map();
  }

  async create(name, args) {
    const actionId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const memoryReview = await this._getMemoryReview(name, args);
    const action = {
      id: actionId,
      name,
      label: ACTION_LABELS[name] || name,
      args,
      memoryReview,
      createdAt: Date.now()
    };
    this._pendingActions.set(actionId, action);

    return {
      requiresConfirmation: true,
      actionId,
      name,
      label: action.label,
      args,
      summary: this._summarizeAction(name, args),
      memoryReview
    };
  }

  take(actionId) {
    const action = this._pendingActions.get(actionId);
    if (action) this._pendingActions.delete(actionId);
    return action || null;
  }

  async _getMemoryReview(name, args = {}) {
    if (!['add_memory', 'update_memory'].includes(name)) return null;
    if (!this.mem0Service?.isAvailable() || !args.content?.trim()) return null;

    try {
      const similar = await this.mem0Service.searchMemories('current_user', args.content.trim(), { limit: 3 });
      const candidates = (similar || [])
        .filter((item) => item?.content)
        .map((item) => ({
          id: item.id,
          content: String(item.content).slice(0, 180),
          score: item.score,
          category: item.category,
          memory_layer: item.memory_layer
        }));

      if (candidates.length === 0) return null;

      const highSimilarity = candidates.some((item) => Number(item.score || 0) >= 0.72);
      return {
        level: highSimilarity ? 'warning' : 'info',
        summary: highSimilarity
          ? '发现相似记忆，请确认是更新旧记忆还是新增一条'
          : '找到可能相关的既有记忆',
        candidates
      };
    } catch (error) {
      return { level: 'info', summary: `相似记忆检查失败：${error.message}`, candidates: [] };
    }
  }

  _summarizeAction(name, args = {}) {
    switch (name) {
      case 'create_note': return `创建笔记「${args.title || '未命名'}」`;
      case 'edit_note': return `编辑笔记 #${args.id}${args.title ? `，标题改为「${args.title}」` : ''}`;
      case 'create_todo': return `创建待办「${args.content || '未命名待办'}」`;
      case 'create_todos': {
        const list = Array.isArray(args.todos) ? args.todos : [];
        const first = list[0]?.content || '';
        return `批量创建 ${list.length} 条待办${first ? `：${first}…` : ''}`;
      }
      case 'add_memory': return `保存记忆「${String(args.content || '').slice(0, 40)}」`;
      case 'update_memory': return `更新记忆 #${args.id}`;
      default: return ACTION_LABELS[name] || name;
    }
  }
}

module.exports = PendingActionStore;
