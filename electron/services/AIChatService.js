/**
 * AI Chat Service - 为 AI 助手提供带工具调用的流式聊天
 * 
 * 复用 AIService 的配置和提供商抽象层，
 * 新增服务端流式推送和 function calling 支持，
 * 允许 AI 操作笔记、待办、记忆等应用功能。
 */

const { getInstance: getLogger } = require('./LoggerService');

// ─── 工具定义（OpenAI function calling 格式） ───

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: '搜索笔记。根据关键词搜索用户的笔记内容和标题。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '最多返回条数，默认5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_note',
      description: '获取用户当前正在编辑的笔记完整内容与类型信息。编辑前应先确认 note_type；白板笔记的 content 必须保持为完整有效的白板 JSON，不能拼接普通文本。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: '为用户创建一个新笔记。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '笔记标题' },
          content: { type: 'string', description: '笔记内容（Markdown格式）' },
          tags: { type: 'string', description: '标签，用逗号分隔' },
          category: { type: 'string', description: '分类名称' }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_note',
      description: '编辑已有的笔记。可以修改标题、内容、标签或分类，只需提供要修改的字段。禁止通过该工具修改 whiteboard 笔记的 content；白板内容只能由前端白板 AI 生成/插入能力处理。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '笔记ID' },
          title: { type: 'string', description: '新标题（可选）' },
          content: { type: 'string', description: '新内容。仅用于普通 Markdown 笔记；whiteboard 笔记禁止传 content（可选）' },
          tags: { type: 'string', description: '新标签，用逗号分隔（可选）' },
          category: { type: 'string', description: '新分类名称（可选）' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_todos',
      description: '搜索待办事项。可按关键词、状态等搜索。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（可选）' },
          status: { type: 'string', enum: ['all', 'completed', 'pending'], description: '筛选状态，默认all' },
          limit: { type: 'number', description: '最多返回条数，默认10' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_today_todos',
      description: '获取今天的待办事项列表，包括今天到期的和已过期未完成的。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_todo',
      description: '为用户创建一个新的待办事项。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '待办内容' },
          description: { type: 'string', description: '详细描述（可选）' },
          due_date: { type: 'string', description: '截止日期，格式 YYYY-MM-DD 或 YYYY-MM-DD HH:mm' },
          is_important: { type: 'boolean', description: '是否重要' },
          is_urgent: { type: 'boolean', description: '是否紧急' },
          tags: { type: 'string', description: '标签，用逗号分隔' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '语义搜索记忆库，找出与查询内容相关的已保存记忆。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索内容' },
          limit: { type: 'number', description: '最多返回条数，默认5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_memory',
      description: '向记忆库中随时保存一条高价值记忆。不要仅限偏好，应广泛提取记录关于用户的身份/职业客观事实、技术栈、项目环境、任务状态等有助于未来个性化服务的内容。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要保存的记忆内容' },
          category: { type: 'string', description: '分类，如 preference（偏好）、fact（事实）、habit（习惯）等，默认 general' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description: '更新或纠正记忆库中已有的记忆。当发现已有记忆不准确、过时需要修改时调用。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '要更新的记忆ID' },
          content: { type: 'string', description: '更新后的记忆内容' }
        },
        required: ['id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_memories',
      description: '列出记忆库中所有已保存的记忆条目。当用户想查看记忆库内容或询问记忆库是否有内容时调用。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '最多返回条数，默认20' },
          category: { type: 'string', description: '按分类筛选（可选）' }
        }
      }
    }
  }
];

const WRITE_TOOL_NAMES = new Set(['create_note', 'edit_note', 'create_todo', 'add_memory', 'update_memory']);

const ACTION_LABELS = {
  create_note: '创建笔记',
  edit_note: '编辑笔记',
  create_todo: '创建待办',
  add_memory: '保存记忆',
  update_memory: '更新记忆'
};

const getLocalDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodoTemporalStatus = (todo) => {
  if (!todo?.due_date || todo.is_completed) {
    return { label: todo?.is_completed ? '已完成' : '无截止日期', isOverdue: false, isDueToday: false, isUpcoming: false };
  }

  const dueKey = String(todo.due_date).substring(0, 10);
  const todayKey = getLocalDateKey();
  const dueTime = new Date(`${dueKey}T00:00:00`).getTime();
  const todayTime = new Date(`${todayKey}T00:00:00`).getTime();
  const daysUntilDue = Math.round((dueTime - todayTime) / 86400000);

  if (dueKey < todayKey) return { label: `已过期 ${Math.abs(daysUntilDue)} 天`, isOverdue: true, isDueToday: false, isUpcoming: false };
  if (dueKey === todayKey) return { label: '今天到期', isOverdue: false, isDueToday: true, isUpcoming: false };
  if (daysUntilDue <= 7) return { label: `${daysUntilDue} 天后到期`, isOverdue: false, isDueToday: false, isUpcoming: true };
  return { label: '未来待办', isOverdue: false, isDueToday: false, isUpcoming: false };
};

class AIChatService {
  constructor(aiService, noteDAO, todoDAO, mem0Service) {
    this.aiService = aiService;
    this.noteDAO = noteDAO;
    this.todoDAO = todoDAO;
    this.mem0Service = mem0Service;
    this.logger = getLogger();
    this._currentNoteGetter = null; // 由 main.js 注入
    this._pendingActions = new Map();
  }

  /** 注入获取当前笔记的函数 */
  setCurrentNoteGetter(fn) {
    this._currentNoteGetter = fn;
  }

  async _createPendingAction(name, args) {
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

  async _getMemoryReview(name, args = {}) {
    if (!['add_memory', 'update_memory'].includes(name)) return null;
    if (!this.mem0Service?.isAvailable() || !args.content?.trim()) return null;

    try {
      const similar = await this.mem0Service.searchMemories('current_user', args.content.trim(), { limit: 3 });
      const candidates = (similar || [])
        .filter(item => item?.content)
        .map(item => ({
          id: item.id,
          content: String(item.content).slice(0, 180),
          score: item.score,
          category: item.category,
          memory_layer: item.memory_layer
        }));

      if (candidates.length === 0) return null;

      const highSimilarity = candidates.some(item => Number(item.score || 0) >= 0.72);
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
      case 'create_note':
        return `创建笔记「${args.title || '未命名'}」`;
      case 'edit_note':
        return `编辑笔记 #${args.id}${args.title ? `，标题改为「${args.title}」` : ''}`;
      case 'create_todo':
        return `创建待办「${args.content || '未命名待办'}」`;
      case 'add_memory':
        return `保存记忆「${String(args.content || '').slice(0, 40)}」`;
      case 'update_memory':
        return `更新记忆 #${args.id}`;
      default:
        return ACTION_LABELS[name] || name;
    }
  }

  async executePendingAction(actionId) {
    const action = this._pendingActions.get(actionId);
    if (!action) {
      return { success: false, error: '待确认操作不存在或已过期' };
    }

    this._pendingActions.delete(actionId);
    try {
      const result = await this._executeTool(action.name, action.args, { requireConfirmation: false });
      const parsed = this._safeJsonParse(result);
      const success = !(parsed?.error || parsed?.success === false);
      return {
        success,
        error: success ? undefined : parsed.error || '操作执行失败',
        action,
        result: parsed
      };
    } catch (error) {
      return { success: false, error: error.message, action };
    }
  }

  _safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return value;
    }
  }

  _validateNoteContentUpdate(existing, nextContent) {
    if (nextContent === undefined) return null;
    if ((existing?.note_type || 'markdown') !== 'whiteboard') return null;
    return '白板内容不能通过 edit_note 直接修改，请使用白板 AI 生成/插入能力';
  }

  // ─── 工具执行器 ───

  async _executeTool(name, args, options = {}) {
    if (options.requireConfirmation !== false && WRITE_TOOL_NAMES.has(name)) {
      return JSON.stringify(await this._createPendingAction(name, args));
    }

    switch (name) {
      case 'search_notes': {
        const results = this.noteDAO.findAll({
          search: args.query,
          limit: args.limit || 5,
          page: 1
        });
        const notes = (results.notes || results || []).map(n => ({
          id: n.id,
          title: n.title,
          content: n.content?.substring(0, 500),
          note_type: n.note_type || 'markdown',
          tags: n.tags,
          category: n.category,
          updated_at: n.updated_at
        }));
        return JSON.stringify(notes);
      }

      case 'get_current_note': {
        if (this._currentNoteGetter) {
          const note = await this._currentNoteGetter();
          if (note) {
            return JSON.stringify({
              id: note.id,
              title: note.title,
              content: note.content,
              note_type: note.note_type || 'markdown',
              tags: note.tags,
              category: note.category
            });
          }
        }
        return JSON.stringify({ error: '当前没有打开的笔记' });
      }

      case 'create_note': {
        if (!args.title?.trim() || !args.content?.trim()) {
          return JSON.stringify({ error: '标题和内容不能为空' });
        }
        const note = this.noteDAO.create({
          title: args.title,
          content: args.content,
          tags: args.tags || '',
          category: args.category || ''
        });
        return JSON.stringify({ success: true, id: note.id, title: note.title });
      }

      case 'edit_note': {
        if (!args.id) {
          return JSON.stringify({ error: '请提供笔记ID' });
        }
        const existing = this.noteDAO.findById(args.id);
        if (!existing) {
          return JSON.stringify({ error: `未找到ID为 ${args.id} 的笔记` });
        }
        const contentError = this._validateNoteContentUpdate(existing, args.content);
        if (contentError) {
          return JSON.stringify({
            success: false,
            error: contentError,
            note_type: existing.note_type || 'markdown'
          });
        }
        const updateData = {};
        if (args.title !== undefined) updateData.title = args.title;
        if (args.content !== undefined) updateData.content = args.content;
        if (args.tags !== undefined) updateData.tags = args.tags;
        if (args.category !== undefined) updateData.category = args.category;
        this.noteDAO.update(args.id, updateData);
        return JSON.stringify({ success: true, id: args.id, title: args.title || existing.title });
      }

      case 'search_todos': {
        const opts = { limit: args.limit || 10, page: 1 };
        if (args.status === 'completed') opts.status = 'completed';
        else if (args.status === 'pending') opts.status = 'pending';
        if (args.query) opts.search = args.query;
        const results = this.todoDAO.findAll(opts);
        const todos = (results.todos || results || []).map(t => {
          const temporal = getTodoTemporalStatus(t);
          return {
            id: t.id,
            content: t.content,
            description: t.description,
            is_completed: t.is_completed,
            is_important: t.is_important,
            is_urgent: t.is_urgent,
            due_date: t.due_date,
            tags: t.tags,
            timeLabel: temporal.label,
            isOverdue: temporal.isOverdue,
            isDueToday: temporal.isDueToday,
            isUpcoming: temporal.isUpcoming
          };
        });
        return JSON.stringify(todos);
      }

      case 'get_today_todos': {
        const today = getLocalDateKey();
        const results = this.todoDAO.findAll({ due_date: today, limit: 50, page: 1 });
        const todos = (results.todos || results || []).map(t => {
          const temporal = getTodoTemporalStatus(t);
          return {
            id: t.id,
            content: t.content,
            is_completed: t.is_completed,
            is_important: t.is_important,
            is_urgent: t.is_urgent,
            due_date: t.due_date,
            timeLabel: temporal.label,
            isOverdue: temporal.isOverdue,
            isDueToday: temporal.isDueToday
          };
        });
        return JSON.stringify(todos);
      }

      case 'create_todo': {
        const todo = this.todoDAO.create({
          content: args.content,
          description: args.description || '',
          due_date: args.due_date || null,
          is_important: args.is_important ? 1 : 0,
          is_urgent: args.is_urgent ? 1 : 0,
          tags: args.tags || ''
        });
        return JSON.stringify({ success: true, id: todo.id, content: todo.content });
      }

      case 'search_memory': {
        if (!this.mem0Service?.isAvailable()) {
          return JSON.stringify({ error: '记忆引擎未启用，无法搜索记忆库' });
        }
        const results = await this.mem0Service.searchMemories(
          'current_user',
          args.query,
          { limit: args.limit || 5, category: args.category }
        );
        if (!results || results.length === 0) {
          return JSON.stringify({ message: '记忆库中没有找到相关内容', results: [] });
        }
        return JSON.stringify((results).map(r => ({
          content: r.content,
          category: r.category,
          memory_layer: r.memory_layer,
          score: r.score,
          vecScore: r.vecScore
        })));
      }

      case 'add_memory': {
        if (!this.mem0Service?.isAvailable()) {
          return JSON.stringify({ error: '记忆引擎未启用，无法保存记忆' });
        }
        if (!args.content?.trim()) {
          return JSON.stringify({ error: '记忆内容不能为空' });
        }
        const result = await this.mem0Service.addMemory(
          'current_user',
          args.content.trim(),
          {
            category: args.category || 'general',
            source: 'ai_extract',
            memoryLayer: args.layer
          }
        );
        return JSON.stringify({ success: true, id: result.id, content: args.content.trim() });
      }

      case 'update_memory': {
        if (!this.mem0Service?.isAvailable()) return JSON.stringify({ error: '记忆引擎未启用，无法更新记忆' });
        if (!args.id || !args.content?.trim()) return JSON.stringify({ error: '记忆ID和新内容不能为空' });
        try {
          const result = await this.mem0Service.updateMemory(args.id, args.content.trim(), { source: 'ai_extract' });
          if (!result.updated) return JSON.stringify({ error: `未找到ID为 ${args.id} 的记忆，或无更新` });
          return JSON.stringify({ success: true, id: args.id, content: args.content.trim() });
        } catch (error) {
          return JSON.stringify({ error: `更新失败: ${error.message}` });
        }
      }

      case 'list_memories': {
        if (!this.mem0Service?.isAvailable()) {
          return JSON.stringify({ error: '记忆引擎未启用' });
        }
        const memories = await this.mem0Service.getMemories(
          'current_user',
          { limit: args.limit || 20, category: args.category }
        );
        if (!memories || memories.length === 0) {
          return JSON.stringify({ message: '记忆库目前是空的，还没有保存任何内容', memories: [] });
        }
        return JSON.stringify(memories.map(m => ({
          id: m.id,
          content: m.content,
          category: m.category,
          created_at: new Date(m.created_at).toLocaleDateString('zh-CN')
        })));
      }

      default:
        return JSON.stringify({ error: `未知工具: ${name}` });
    }
  }

  // ─── 获取系统提示词（v3: 自动注入 Profile 记忆） ───

  async _getSystemPrompt() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'long'
    });
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // v3: 自动加载 Profile 层记忆（用户偏好、约束）
    let profileSection = '';
    try {
      if (this.mem0Service?.isAvailable() && typeof this.mem0Service.getProfileMemories === 'function') {
        const profiles = await this.mem0Service.getProfileMemories('current_user');
        if (profiles && profiles.length > 0) {
          const items = profiles.map(p => `- ${p.content}`).join('\n');
          profileSection = `\n\n## 关于用户（来自记忆）\n${items}`;
        }
      }
    } catch (e) {
      // Profile 加载失败不影响基础功能
    }

    return `你是 FlotaAI，FlashNote 智能笔记应用的内置 AI 助手。

当前时间：${dateStr} ${timeStr}

## 能力
- 搜索、阅读、创建和编辑笔记
- 查询和创建待办事项
- 查看、搜索、添加和更新记忆库条目
- 写作辅助、翻译、问答等通用任务

## 记忆档案管理
- 【高价值才保存】只有当信息长期有效、可复用、对未来回答有明显帮助时，才调用 add_memory；临时任务、一次性上下文、当前笔记里已经明确存在的信息不要重复保存。
- 【先查再写】保存或更新记忆前优先用 search_memory 检查是否已有相似记忆；相似时优先 update_memory，避免重复和冲突。
- 【多维归类】合理分配 category：如 profile(身份)、preference(偏好要求)、fact(事实结论)、habit(排版风格等习惯)。
- 【动态刷新】当用户明确更新偏好、身份、工作流或稳定事实时，调用 update_memory 修正旧记忆；不确定时先询问用户。

## 规则
- 用简洁友好的中文回复
- 需要查询用户数据时主动调用工具，不要猜测
- 创建、编辑笔记/待办/记忆这类写入操作默认只生成待确认计划；拿到工具返回的 requiresConfirmation 后，必须清楚告诉用户等待确认，不要声称已经执行
- 当前笔记类型为 whiteboard 时，不要调用 edit_note 修改 content；白板内容生成/插入由应用前端的白板 AI 能力处理
- 使用 Markdown 格式回复，善用列表和标题
- 不确定时如实说明，不编造数据
- 回复要简明扼要，避免冗余${profileSection}`;
  }

  _buildContextSection(contextPackage = {}) {
    const sections = [];
    const truncate = (text, max = 1800) => {
      const value = String(text || '').trim();
      return value.length > max ? `${value.slice(0, max)}…` : value;
    };

    if (contextPackage.currentNote) {
      const note = contextPackage.currentNote;
      sections.push([
        '### 当前笔记',
        `ID: ${note.id || '未知'}`,
        `标题: ${note.title || '未命名'}`,
        `类型: ${note.note_type || 'markdown'}`,
        note.timeLabel ? `时间: ${note.timeLabel}` : '',
        note.stalenessLabel ? `时效性: ${note.stalenessLabel}` : '',
        note.updated_at ? `最近修改: ${note.updated_at}` : '',
        note.tags ? `标签: ${note.tags}` : '',
        `内容:\n${truncate(note.content)}`
      ].filter(Boolean).join('\n'));
    }

    if (Array.isArray(contextPackage.relatedNotes) && contextPackage.relatedNotes.length > 0) {
      sections.push([
        '### 相关笔记候选',
        ...contextPackage.relatedNotes.slice(0, 6).map((note, index) =>
          `${index + 1}. [#${note.id}] ${note.title || '未命名'}（${note.timeLabel || '时间未知'}${note.stalenessLabel ? `，${note.stalenessLabel}` : ''}）：${truncate(note.excerpt || note.content, 360)}`
        )
      ].join('\n'));
    }

    if (Array.isArray(contextPackage.todayTodos) && contextPackage.todayTodos.length > 0) {
      sections.push([
        '### 今日/近期待办',
        ...contextPackage.todayTodos.slice(0, 8).map((todo, index) =>
          `${index + 1}. [#${todo.id}] ${todo.content}${todo.due_date ? `（截止: ${todo.due_date}，${todo.timeLabel || (todo.isOverdue ? '已过期' : '有截止日期')}）` : ''}`
        )
      ].join('\n'));
    }

    if (Array.isArray(contextPackage.memories) && contextPackage.memories.length > 0) {
      sections.push([
        '### 相关长期记忆',
        ...contextPackage.memories.slice(0, 8).map((memory, index) =>
          `${index + 1}. ${memory.memory_layer ? `[${memory.memory_layer}] ` : ''}${truncate(memory.content, 260)}${memory.stalenessLabel ? `（${memory.stalenessLabel}）` : ''}${memory.score != null ? ` · 相关度 ${Math.round(memory.score * 100)}%` : ''}`
        )
      ].join('\n'));
    }

    if (sections.length === 0) return '';

    return `\n\n## 本次对话自动上下文\n以下内容由应用按用户选择注入。回答时优先引用这些上下文；如果使用了相关笔记或长期记忆，请说明来源标题、ID 或“长期记忆”。注意时间感知：最近修改的信息优先级更高，旧信息要标注可能过时，过期待办不能当作未来计划。长期记忆代表稳定偏好/事实，但遇到用户当前明确说法时，以当前上下文为准。\n\n${sections.join('\n\n')}`;
  }

  // ─── 流式聊天（主方法） ───

  /**
   * 流式聊天，支持工具调用
   * @param {Array} messages - 聊天消息数组 [{role, content}]
   * @param {Function} onChunk - 每次收到流式片段时回调 (chunk: {type, content, ...})
   * @param {Object} options - 可选参数
   * @returns {Object} {success, fullContent, usage}
   */
  async chatStream(messages, onChunk, options = {}) {
    try {
      const configResult = await this.aiService.getConfig();
      if (!configResult.success) throw new Error(configResult.error || '获取AI配置失败');
      const config = configResult.data;
      if (!config.enabled) throw new Error('AI功能未启用，请在设置中开启');
      if (!config.apiKey) throw new Error('请先在设置中配置API密钥');

      this.aiService._checkRateLimit();

      const temp = Math.min(Math.max(options.temperature || config.temperature, 0), 2);
      const maxTk = options.maxTokens || config.maxTokens || 4000;

      // 构建完整消息列表（v3: _getSystemPrompt 现在是异步的）
      const systemPrompt = `${await this._getSystemPrompt()}${this._buildContextSection(options.contextPackage)}`;
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];

      // 第一轮调用：可能返回工具调用
      const result = await this._streamRequest(config, fullMessages, temp, maxTk, onChunk, options.abortSignal, options);

      // 处理工具调用循环（最多3轮）
      if (result.toolCalls && result.toolCalls.length > 0) {
        return await this._handleToolCalls(config, fullMessages, result, onChunk, temp, maxTk, 0, options.abortSignal, options);
      }

      return { success: true, fullContent: result.content, usage: result.usage };
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted|取消|cancel/i.test(error?.message || '')) {
        return { success: false, cancelled: true, error: '已取消生成' };
      }
      this.logger.error('AIChatService', 'Stream chat failed', error);
      onChunk({ type: 'error', content: error.message });
      return { success: false, error: error.message };
    }
  }

  // ─── 处理工具调用 ───

  async _handleToolCalls(config, messages, prevResult, onChunk, temp, maxTk, depth, abortSignal, options = {}) {
    if (depth >= 3) {
      // 防止无限循环
      return { success: true, fullContent: prevResult.content || '', usage: prevResult.usage };
    }

    // 拼接 assistant 的 tool_calls 消息
    messages.push({
      role: 'assistant',
      content: prevResult.content || null,
      tool_calls: prevResult.toolCalls
    });

    // 执行每个工具并回填结果
    for (const tc of prevResult.toolCalls) {
      const fnName = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}

      onChunk({ type: 'tool_start', name: fnName, args });
      this.logger.info('AIChatService', `Executing tool: ${fnName}`, args);

      const toolResult = await this._executeTool(fnName, args, {
        requireConfirmation: options.requireConfirmation !== false
      });
      onChunk({ type: 'tool_end', name: fnName, result: toolResult });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResult
      });
    }

    // 继续调用 AI，让它汇总工具结果
    const newResult = await this._streamRequest(config, messages, temp, maxTk, onChunk, abortSignal, options);

    if (newResult.toolCalls && newResult.toolCalls.length > 0) {
      return await this._handleToolCalls(config, messages, newResult, onChunk, temp, maxTk, depth + 1, abortSignal, options);
    }

    return { success: true, fullContent: newResult.content, usage: newResult.usage };
  }

  // ─── 单次流式请求 ───

  async _streamRequest(config, messages, temp, maxTk, onChunk, abortSignal = null, options = {}) {
    const { url, headers, body } = this._buildRequest(config, messages, temp, maxTk, options);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000); // 2分钟超时
    let abortHandler = null;

    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort();
      } else {
        abortHandler = () => controller.abort();
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        let errorMsg = `API请求失败 (${response.status})`;
        try {
          const text = await response.text();
          if (text) {
            const e = JSON.parse(text);
            errorMsg = e.error?.message || e.message || errorMsg;
          }
        } catch (_) {}
        throw new Error(errorMsg);
      }

      return await this._parseSSEStream(response, onChunk, config.provider);
    } finally {
      clearTimeout(timer);
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
    }
  }

  // ─── 构建请求 ───

  _buildRequest(config, messages, temp, maxTk, options = {}) {
    const { provider, apiKey, apiUrl } = config;

    const providerUrls = {
      openai: 'https://api.openai.com/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/v1/chat/completions',
      custom: this.aiService.normalizeApiUrl(apiUrl)
    };

    // 通义千问也用 OpenAI 兼容接口进行流式调用
    const url = providerUrls[provider] || providerUrls.openai;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    const body = {
      model: config.model,
      messages,
      temperature: temp,
      max_tokens: maxTk,
      stream: true
    };

    if (options.disableTools !== true) {
      body.tools = TOOLS;
      body.tool_choice = 'auto';
    }

    // 通义千问的流式 API 也用 OpenAI 兼容格式
    if (provider === 'qwen') {
      // 通义千问兼容 OpenAI 接口
      const qwenUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      return { url: qwenUrl, headers: { ...headers, 'X-DashScope-SSE': 'enable' }, body };
    }

    return { url, headers, body };
  }

  // ─── SSE 流式解析 ───

  async _parseSSEStream(response, onChunk) {
    let fullContent = '';
    let toolCalls = [];
    let usage = null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { continue; }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) {
          // 检查 usage
          if (parsed.usage) usage = parsed.usage;
          continue;
        }

        // 处理文本内容
        if (delta.content) {
          fullContent += delta.content;
          onChunk({ type: 'content', content: delta.content });
        }

        // 处理工具调用
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = {
                id: tc.id || `call_${idx}`,
                type: 'function',
                function: { name: '', arguments: '' }
              };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }

        // finish_reason
        if (parsed.choices?.[0]?.finish_reason === 'stop') {
          onChunk({ type: 'done' });
        }
      }
    }

    // 过滤空的 tool_calls
    toolCalls = toolCalls.filter(tc => tc && tc.function.name);

    return { content: fullContent, toolCalls, usage };
  }

  /**
   * 非流式聊天（简单模式，用于快速操作）
   */
  async chat(messages, options = {}) {
    const systemPrompt = await this._getSystemPrompt();
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    return await this.aiService.chat(fullMessages, options);
  }
}

module.exports = AIChatService;
