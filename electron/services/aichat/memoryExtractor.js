/**
 * 对话后自动记忆（参考 Mem0 的「提取 → 与已有记忆比对 → ADD / UPDATE / DELETE」）。
 *
 * 对符合长期信息条件的对话，至多每5分钟尝试一次；明确记忆请求不受此间隔限制：
 *   1. 用用户这句话检索相关的已有记忆（偏好 / 知识层）
 *   2. 让模型判断有没有值得长期记住的新信息，以及它和已有记忆的关系
 *   3. 执行变更：新增 / 用新说法替代旧记忆 / 删除用户要求忘掉的；旧条目进替代链，可撤销
 * 结果交给界面显示「记忆已更新」，用户可以一键撤销。
 */

const USER_ID = 'current_user';
const AUTO_LAYERS = ['profile', 'semantic'];
const MAX_OPS = 1;
const AUTO_COOLDOWN_MS = 5 * 60 * 1000;
const MIN_USER_TEXT = 12;
const MAX_CONTENT_LEN = 200;

// 密钥、证件号、银行卡、密码之类的不进记忆，即使模型提出来
const SENSITIVE_RE = /(sk-[a-z0-9]{16,}|api[_-]?key|token\s*[:=]|密码\s*[是:：为]|password\s*[:=]|\b\d{15,19}\b|\b\d{17}[\dxX]\b)/i;

const EXPLICIT_MEMORY_RE = /(?:^|[，,。.!！?？\n])\s*(?:请|帮我|麻烦你?|以后请)?\s*(?:记住|记下|记一下|别忘了|忘掉|忘记|删除.{0,12}记忆|更新.{0,12}记忆)|(?:^|[.!?\n])\s*(?:please\s+)?(?:remember|forget|update my memor)\b/i;
const FORGET_MEMORY_RE = /(?:忘掉|忘记|删除.{0,12}记忆)|\bforget\b/i;
const DURABLE_USER_RE = /我(?:更喜欢|偏好|习惯|通常|一直|长期)|我的(?:职业|专业|母语)|我(?:目前|正在)?(?:就读于|任职于|从事)|我是.{0,30}(?:学生|工程师|教师|设计师|研究员|程序员)|\bI (?:prefer|usually|always|work as|study at)\b/i;

const EXTRACTION_PROMPT = `你是严格、克制的长期记忆管理员。默认不保存；只有明确、稳定、未来多次对话都会有用的信息才允许进入记忆。

只保留：用户明确表达的长期回答偏好、稳定身份职业和长期习惯。用户明确要求记住、更正或忘掉的信息按其意图处理。
不要记：这次任务的要求、产品界面修改、代码调整、临时排错、近期进度、截止时间、预算、助手给出的建议、笔记或引用中的内容、推断、敏感信息。不要把“这个按钮改蓝色”泛化成用户长期喜欢蓝色。

规则：
- 每次最多 ${MAX_OPS} 条，宁可空数组。已有记忆覆盖的内容不再保存，不要为换一种措辞而更新。
- 仅依据用户本轮亲口表达的内容；助手回答、上一轮与引用资料都不能作为新事实依据。
- 未明确要求记忆时，必须同时提供 durable:true、confidence>=0.9，以及 evidence（本轮用户原话的连续片段），缺一不可。
- layer 只能是 profile（身份、长期偏好、习惯）或 semantic（用户明确要求保存的长期事实）。不要自动记录近况。
- update 仅用于事实确实发生变化；delete 仅在本轮用户明确要求忘掉或删除时允许。
- 内容用第三人称“用户……”，每条只写一个事实，不超过60字。

只输出JSON：{"operations":[{"op":"add","layer":"profile","content":"...","durable":true,"confidence":0.95,"evidence":"用户本轮原话"}]}。update/delete须给出已有记忆id，没有合适内容输出{"operations":[]}。`;

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
    this._lastAutoAttempt = -Infinity;
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
    const explicit = EXPLICIT_MEMORY_RE.test(userText);
    if (SENSITIVE_RE.test(userText) || userText.length < (explicit ? 4 : MIN_USER_TEXT)) return [];
    if (!explicit) {
      if (!DURABLE_USER_RE.test(userText) || Date.now() - this._lastAutoAttempt < AUTO_COOLDOWN_MS) return [];
      this._lastAutoAttempt = Date.now();
    }

    const existing = await this.mem0Service.searchMemories(USER_ID, userText, {
      limit: 8, layers: explicit ? [...AUTO_LAYERS, 'episodic'] : AUTO_LAYERS, threshold: 0.1, touch: false,
    });
    const existingById = new Map(existing.map((m) => [m.id, m]));

    const conversation = `用户本轮：${truncate(userText, 1500)}\n是否明确要求记忆：${explicit ? '是' : '否'}`;
    const existingList = existing.length > 0
      ? existing.map((m) => `[${m.id}] (${m.memory_layer}) ${m.content}`).join('\n')
      : '（无）';

    const result = await this.generate([
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `已有相关记忆：\n${existingList}\n\n本轮对话：\n${conversation}` },
    ], { temperature: 0, bypassTokenLimit: true, timeoutMs: 30000 });

    const operations = parseOperations(result?.content).slice(0, MAX_OPS);
    const changes = [];
    for (const op of operations) {
      try {
        if (op?.op === 'delete' && !(explicit && FORGET_MEMORY_RE.test(userText))) continue;
        if (!explicit && (op?.durable !== true || Number(op.confidence) < .9 || !Number.isFinite(Number(op.confidence)) ||
          typeof op.evidence !== 'string' || op.evidence.trim().length < 4 || !userText.includes(op.evidence.trim()) || !AUTO_LAYERS.includes(op.layer))) continue;
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
