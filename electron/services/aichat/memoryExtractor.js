/**
 * 对话后自动记忆（参考 Mem0 的「提取 → 与已有记忆比对 → ADD / UPDATE / DELETE」）。
 *
 * 每轮对话结束后：
 *   1. 用用户这句话检索相关的已有记忆（偏好 / 知识 / 经历层）
 *   2. 让模型判断有没有值得长期记住的新信息，以及它和已有记忆的关系
 *   3. 执行变更：新增 / 用新说法替代旧记忆 / 删除用户要求忘掉的；旧条目进替代链，可撤销
 * 结果交给界面显示「记忆已更新」，用户可以一键撤销。
 */

const USER_ID = 'current_user';
const AUTO_LAYERS = ['profile', 'semantic', 'episodic'];
const MAX_OPS = 3;
const MIN_USER_TEXT = 4;
const MAX_CONTENT_LEN = 200;

// 密钥、证件号、银行卡、密码之类的不进记忆，即使模型提出来
const SENSITIVE_RE = /(sk-[a-z0-9]{16,}|api[_-]?key|token\s*[:=]|密码\s*[是:：为]|password\s*[:=]|\b\d{15,19}\b|\b\d{17}[\dxX]\b)/i;

const EXTRACTION_PROMPT = `你是用户的长期记忆管理员。阅读下面这轮对话，判断其中有没有关于用户、值得长期记住的信息，并和已有记忆比对，输出需要执行的变更。

值得记住的：用户的身份背景、长期偏好（语言、风格、工具、饮食等）、习惯、长期目标与正在进行的项目、约束条件（时间、预算、健康限制）、重要的人和关系。
不要记：一次性的请求或问题本身、助手说的话、笔记里已有的内容、猜测、寒暄、密码 / 密钥 / 证件号等敏感信息。

规则：
- 每条记忆只写一个事实，用第三人称“用户……”，语言与用户一致，不超过 60 字。
- layer：profile = 稳定的偏好、习惯、身份；semantic = 关于用户世界的事实（项目、工作、关系）；episodic = 有时效的近况（正在备考、这周出差）。
- 新信息与某条已有记忆矛盾或是它的更新 → update 那条（给出完整的新内容）。
- 用户明确要求忘掉 / 说某条不再成立 → delete 那条。
- 已有记忆已经覆盖的信息不要重复 add。
- 没有值得记的就输出空数组。宁缺毋滥，最多 ${MAX_OPS} 条。

只输出 JSON，不要任何其它文字：
{"operations":[{"op":"add","layer":"profile","content":"..."},{"op":"update","id":12,"content":"..."},{"op":"delete","id":7}]}`;

const messageText = (message) => {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n');
  }
  return '';
};

const truncate = (text, max) => {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const parseOperations = (raw) => {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed?.operations) ? parsed.operations : [];
  } catch (_) {
    return [];
  }
};

class MemoryExtractor {
  /**
   * @param {object} deps
   * @param {object} deps.mem0Service
   * @param {(messages: Array, opts: object) => Promise<{content: string}>} deps.generate 无工具的纯文本生成
   * @param {object} [deps.logger]
   */
  constructor({ mem0Service, generate, logger }) {
    this.mem0Service = mem0Service;
    this.generate = generate;
    this.logger = logger;
    // 同一会话的提取串行执行，避免两轮几乎同时结束时基于同一份旧记忆各写一遍
    this._queues = new Map();
  }

  isEnabled() {
    return !!this.mem0Service?.isAvailable?.() && this.mem0Service.getSetting('auto_memory', true) !== false;
  }

  /**
   * 处理一轮对话，返回实际发生的变更（供界面展示和撤销）
   * @returns {Promise<Array<{op: string, id: number, previousId?: number, content: string, previousContent?: string, layer?: string}>>}
   */
  processTurn({ conversationId, messages, assistantText }) {
    if (!this.isEnabled()) return Promise.resolve([]);
    const key = conversationId || 'default';
    const prev = this._queues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => this._process(messages, assistantText));
    this._queues.set(key, next);
    next.finally(() => { if (this._queues.get(key) === next) this._queues.delete(key); });
    return next;
  }

  /** @private */
  async _process(messages, assistantText) {
    const userMessages = (messages || []).filter((m) => m?.role === 'user');
    const userText = messageText(userMessages[userMessages.length - 1]).trim();
    if (userText.length < MIN_USER_TEXT) return [];
    const previousUserText = messageText(userMessages[userMessages.length - 2]).trim();

    const existing = await this.mem0Service.searchMemories(USER_ID, userText, {
      limit: 8, layers: AUTO_LAYERS, threshold: 0.1, touch: false,
    });
    const existingById = new Map(existing.map((m) => [m.id, m]));

    const conversation = [
      previousUserText ? `用户（上一句）：${truncate(previousUserText, 400)}` : '',
      `用户：${truncate(userText, 1500)}`,
      `助手：${truncate(assistantText, 600)}`,
    ].filter(Boolean).join('\n');
    const existingList = existing.length > 0
      ? existing.map((m) => `[${m.id}] (${m.memory_layer}) ${m.content}`).join('\n')
      : '（无）';

    const result = await this.generate([
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `已有相关记忆：\n${existingList}\n\n本轮对话：\n${conversation}` },
    ], { temperature: 0, maxTokens: 400, timeoutMs: 30000 });

    const operations = parseOperations(result?.content).slice(0, MAX_OPS);
    const changes = [];
    for (const op of operations) {
      try {
        const change = await this._apply(op, existingById);
        if (change) changes.push(change);
      } catch (error) {
        this.logger?.warn?.('MemoryExtractor', 'apply failed', { op: op?.op, error: error.message });
      }
    }
    if (changes.length > 0) {
      this.logger?.info?.('MemoryExtractor', 'memories updated', { count: changes.length, ops: changes.map((c) => c.op) });
    }
    return changes;
  }

  /** @private */
  async _apply(op, existingById) {
    const kind = String(op?.op || '').toLowerCase();
    const content = truncate(op?.content, MAX_CONTENT_LEN);
    const id = Number(op?.id);

    if (kind === 'add') {
      if (content.length < 4 || SENSITIVE_RE.test(content)) return null;
      const layer = AUTO_LAYERS.includes(op.layer) ? op.layer : 'semantic';
      const res = await this.mem0Service.addMemory(USER_ID, content, {
        memoryLayer: layer,
        category: layer === 'profile' ? 'preference' : 'general',
        source: 'ai_auto',
        metadata: { source: 'ai_auto' },
      });
      if (!res?.success || res.deduplicated) return null;
      // 守门器判定为旧记忆的新说法时，表现为替代
      return res.superseded
        ? { op: 'update', id: res.id, previousId: res.superseded, content, layer }
        : { op: 'add', id: res.id, content, layer };
    }

    // 只允许改动这轮检索出来、模型看得见的记忆，防止模型编造 ID 改到别的条目
    const target = existingById.get(id);
    if (!target) return null;

    if (kind === 'update') {
      if (content.length < 4 || SENSITIVE_RE.test(content) || content === target.content) return null;
      const res = await this.mem0Service.supersedeMemory(USER_ID, id, content, { source: 'ai_auto', metadata: { source: 'ai_auto' } });
      if (!res) return null;
      return { op: 'update', id: res.id, previousId: id, content, previousContent: res.previousContent, layer: target.memory_layer };
    }

    if (kind === 'delete') {
      const res = this.mem0Service.softDeleteMemory(id);
      if (!res) return null;
      return { op: 'delete', id, content: res.previousContent, layer: target.memory_layer };
    }
    return null;
  }
}

module.exports = { MemoryExtractor, parseOperations, SENSITIVE_RE };
