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
      description: '获取用户当前正在编辑的笔记的完整内容。',
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
      description: '编辑已有的笔记。可以修改标题、内容、标签或分类，只需提供要修改的字段。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '笔记ID' },
          title: { type: 'string', description: '新标题（可选）' },
          content: { type: 'string', description: '新内容（Markdown格式，可选）' },
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
      description: '向记忆库中保存一条记忆。用于记住用户的偏好、重要信息、个人习惯等需要长期保存的内容。',
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

class AIChatService {
  constructor(aiService, noteDAO, todoDAO, mem0Service) {
    this.aiService = aiService;
    this.noteDAO = noteDAO;
    this.todoDAO = todoDAO;
    this.mem0Service = mem0Service;
    this.logger = getLogger();
    this._currentNoteGetter = null; // 由 main.js 注入
  }

  /** 注入获取当前笔记的函数 */
  setCurrentNoteGetter(fn) {
    this._currentNoteGetter = fn;
  }

  // ─── 工具执行器 ───

  async _executeTool(name, args) {
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
        const todos = (results.todos || results || []).map(t => ({
          id: t.id,
          content: t.content,
          description: t.description,
          is_completed: t.is_completed,
          is_important: t.is_important,
          is_urgent: t.is_urgent,
          due_date: t.due_date,
          tags: t.tags
        }));
        return JSON.stringify(todos);
      }

      case 'get_today_todos': {
        const today = new Date().toISOString().split('T')[0];
        const results = this.todoDAO.findAll({ due_date: today, limit: 50, page: 1 });
        const todos = (results.todos || results || []).map(t => ({
          id: t.id,
          content: t.content,
          is_completed: t.is_completed,
          is_important: t.is_important,
          is_urgent: t.is_urgent,
          due_date: t.due_date
        }));
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
          { limit: args.limit || 5 }
        );
        if (!results || results.length === 0) {
          return JSON.stringify({ message: '记忆库中没有找到相关内容', results: [] });
        }
        return JSON.stringify((results).map(r => ({
          content: r.content,
          category: r.category,
          score: r.score
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
          { category: args.category || 'general' }
        );
        return JSON.stringify({ success: true, id: result.id, content: args.content.trim() });
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

  // ─── 获取系统提示词 ───

  _getSystemPrompt() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'long'
    });
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    return `你是 FlotaAI，FlashNote 智能笔记应用的内置 AI 助手。

当前时间：${dateStr} ${timeStr}

## 能力
- 搜索、阅读、创建和编辑笔记
- 查询和创建待办事项
- 查看、搜索、添加记忆库条目
- 写作辅助、翻译、问答等通用任务

## 规则
- 用简洁友好的中文回复，适当使用 emoji
- 需要查询用户数据时主动调用工具，不要猜测
- 创建或编辑笔记、创建待办后告知用户，并附上摘要
- 编辑笔记前先确认用户意图，说明要修改的内容
- 使用 Markdown 格式回复，善用列表和标题
- 不确定时如实说明，不编造数据
- 回复要简明扼要，避免冗余`;
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

      // 构建完整消息列表
      const fullMessages = [
        { role: 'system', content: this._getSystemPrompt() },
        ...messages
      ];

      // 第一轮调用：可能返回工具调用
      const result = await this._streamRequest(config, fullMessages, temp, maxTk, onChunk);

      // 处理工具调用循环（最多3轮）
      if (result.toolCalls && result.toolCalls.length > 0) {
        return await this._handleToolCalls(config, fullMessages, result, onChunk, temp, maxTk, 0);
      }

      return { success: true, fullContent: result.content, usage: result.usage };
    } catch (error) {
      this.logger.error('AIChatService', 'Stream chat failed', error);
      onChunk({ type: 'error', content: error.message });
      return { success: false, error: error.message };
    }
  }

  // ─── 处理工具调用 ───

  async _handleToolCalls(config, messages, prevResult, onChunk, temp, maxTk, depth) {
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

      const toolResult = await this._executeTool(fnName, args);
      onChunk({ type: 'tool_end', name: fnName, result: toolResult });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResult
      });
    }

    // 继续调用 AI，让它汇总工具结果
    const newResult = await this._streamRequest(config, messages, temp, maxTk, onChunk);

    if (newResult.toolCalls && newResult.toolCalls.length > 0) {
      return await this._handleToolCalls(config, messages, newResult, onChunk, temp, maxTk, depth + 1);
    }

    return { success: true, fullContent: newResult.content, usage: newResult.usage };
  }

  // ─── 单次流式请求 ───

  async _streamRequest(config, messages, temp, maxTk, onChunk) {
    const { url, headers, body } = this._buildRequest(config, messages, temp, maxTk);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000); // 2分钟超时

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
    }
  }

  // ─── 构建请求 ───

  _buildRequest(config, messages, temp, maxTk) {
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
      stream: true,
      tools: TOOLS,
      tool_choice: 'auto'
    };

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
    const fullMessages = [
      { role: 'system', content: this._getSystemPrompt() },
      ...messages
    ];
    return await this.aiService.chat(fullMessages, options);
  }
}

module.exports = AIChatService;
