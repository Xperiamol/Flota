/**
 * Flota MCP Server
 * 实现 Model Context Protocol，允许其他 AI 应用调用 Flota 功能
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

class MCPServer {
  constructor(services) {
    this.services = services;
    this.server = null;
    this.transport = null;
  }

  /**
   * 初始化并启动 MCP Server
   */
  async start() {
    try {
      // 创建 MCP Server 实例
      this.server = new Server(
        {
          name: 'Flota',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
          },
        }
      );

      // 注册工具列表处理器
      this.server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
          tools: this.getToolDefinitions(),
        };
      });

      // 注册工具调用处理器
      this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        return await this.handleToolCall(request);
      });

      // 创建 stdio 传输
      this.transport = new StdioServerTransport();
      
      // 连接服务器和传输
      await this.server.connect(this.transport);

      console.log('[MCP Server] 已启动，通过 stdio 通信');
    } catch (error) {
      console.error('[MCP Server] 启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止 MCP Server
   */
  async stop() {
    if (this.server) {
      await this.server.close();
      console.log('[MCP Server] 已停止');
    }
  }

  /**
   * 获取所有可用工具的定义
   */
  getToolDefinitions() {
    return [
      // ==================== 笔记相关工具 ====================
      {
        name: 'create_note',
        description: '创建新笔记',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: '笔记标题',
            },
            content: {
              type: 'string',
              description: '笔记内容（支持 Markdown）',
            },
            category: {
              type: 'string',
              description: '笔记分类',
            },
            tags: {
              type: 'string',
              description: '标签（逗号分隔）',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'search_notes',
        description: '搜索笔记',
        inputSchema: {
          type: 'object',
          properties: {
            keyword: {
              type: 'string',
              description: '搜索关键词',
            },
            category: {
              type: 'string',
              description: '按分类筛选',
            },
            limit: {
              type: 'number',
              description: '返回结果数量限制（默认10）',
            },
          },
          required: ['keyword'],
        },
      },
      {
        name: 'get_note',
        description: '根据 ID 获取笔记详情',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: '笔记 ID',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'update_note',
        description: '更新笔记',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: '笔记 ID',
            },
            title: {
              type: 'string',
              description: '笔记标题',
            },
            content: {
              type: 'string',
              description: '笔记内容',
            },
            category: {
              type: 'string',
              description: '笔记分类',
            },
            tags: {
              type: 'string',
              description: '标签',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'list_notes',
        description: '列出所有笔记（分页）',
        inputSchema: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              description: '页码（从1开始）',
            },
            pageSize: {
              type: 'number',
              description: '每页数量',
            },
            category: {
              type: 'string',
              description: '按分类筛选',
            },
          },
        },
      },

      // ==================== 待办事项相关工具 ====================
      {
        name: 'create_todo',
        description: '创建新待办事项（使用艾森豪威尔矩阵：重要性×紧急性）',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: '待办内容',
            },
            description: {
              type: 'string',
              description: '待办描述',
            },
            is_important: {
              type: 'boolean',
              description: '是否重要',
            },
            is_urgent: {
              type: 'boolean',
              description: '是否紧急',
            },
            due_date: {
              type: 'string',
              description: '截止日期（ISO 8601 格式）',
            },
            tags: {
              type: 'string',
              description: '标签（逗号分隔）',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'list_todos',
        description: '列出待办事项',
        inputSchema: {
          type: 'object',
          properties: {
            includeCompleted: {
              type: 'boolean',
              description: '是否包含已完成的待办',
            },
          },
        },
      },
      {
        name: 'get_todos_by_quadrant',
        description: '按四象限（艾森豪威尔矩阵）获取待办事项',
        inputSchema: {
          type: 'object',
          properties: {
            includeCompleted: {
              type: 'boolean',
              description: '是否包含已完成的待办',
            },
          },
        },
      },
      {
        name: 'update_todo',
        description: '更新待办事项',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: '待办 ID',
            },
            content: {
              type: 'string',
              description: '待办内容',
            },
            description: {
              type: 'string',
              description: '待办描述',
            },
            is_important: {
              type: 'boolean',
              description: '是否重要',
            },
            is_urgent: {
              type: 'boolean',
              description: '是否紧急',
            },
            is_completed: {
              type: 'boolean',
              description: '是否完成',
            },
            due_date: {
              type: 'string',
              description: '截止日期',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'toggle_todo_complete',
        description: '切换待办的完成状态',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: '待办 ID',
            },
          },
          required: ['id'],
        },
      },

      // ==================== AI 相关工具 ====================
      {
        name: 'ai_chat',
        description: '使用 Flota 配置的 AI 进行对话',
        inputSchema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              description: '对话消息数组',
              items: {
                type: 'object',
                properties: {
                  role: {
                    type: 'string',
                    enum: ['user', 'assistant', 'system'],
                  },
                  content: {
                    type: 'string',
                  },
                },
              },
            },
            temperature: {
              type: 'number',
              description: 'AI 温度参数（0-2）',
            },
            maxTokens: {
              type: 'number',
              description: '最大 token 数',
            },
          },
          required: ['messages'],
        },
      },

      // ==================== Mem0 记忆相关工具 ====================
      {
        name: 'add_memory',
        description: '添加记忆到 Mem0（支持对话消息或纯文本）',
        inputSchema: {
          type: 'object',
          properties: {
            messages: {
              description: '消息内容（可以是字符串或消息数组）',
            },
            metadata: {
              type: 'object',
              description: '元数据（如 category, timestamp 等）',
            },
          },
          required: ['messages'],
        },
      },
      {
        name: 'search_memories',
        description: '搜索相关记忆',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索查询',
            },
            limit: {
              type: 'number',
              description: '返回结果数量（默认5）',
            },
          },
          required: ['query'],
        },
      },

      // ==================== 标签相关工具 ====================
      {
        name: 'list_tags',
        description: '列出所有标签',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_notes_by_tag',
        description: '根据标签获取笔记',
        inputSchema: {
          type: 'object',
          properties: {
            tag: {
              type: 'string',
              description: '标签名称',
            },
          },
          required: ['tag'],
        },
      },
    ];
  }

  /**
   * 处理工具调用
   */
  async handleToolCall(request) {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        // ==================== 笔记操作 ====================
        case 'create_note':
          result = await this.createNote(args);
          break;

        case 'search_notes':
          result = await this.searchNotes(args);
          break;

        case 'get_note':
          result = await this.getNote(args);
          break;

        case 'update_note':
          result = await this.updateNote(args);
          break;

        case 'list_notes':
          result = await this.listNotes(args);
          break;

        // ==================== 待办操作 ====================
        case 'create_todo':
          result = await this.createTodo(args);
          break;

        case 'list_todos':
          result = await this.listTodos(args);
          break;

        case 'get_todos_by_quadrant':
          result = await this.getTodosByQuadrant(args);
          break;

        case 'update_todo':
          result = await this.updateTodo(args);
          break;

        case 'toggle_todo_complete':
          result = await this.toggleTodoComplete(args);
          break;

        // ==================== AI 操作 ====================
        case 'ai_chat':
          result = await this.aiChat(args);
          break;

        // ==================== Mem0 操作 ====================
        case 'add_memory':
          result = await this.addMemory(args);
          break;

        case 'search_memories':
          result = await this.searchMemories(args);
          break;

        // ==================== 标签操作 ====================
        case 'list_tags':
          result = await this.listTags(args);
          break;

        case 'get_notes_by_tag':
          result = await this.getNotesByTag(args);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error(`[MCP Server] 工具调用失败 (${name}):`, error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  // ==================== 笔记操作实现 ====================

  async createNote(args) {
    const { title, content, category, tags } = args;
    const result = await this.services.noteService.createNote({
      title,
      content,
      category: category || '',
      tags: tags || '',
    });
    return result;
  }

  async searchNotes(args) {
    const { keyword, category, limit = 10 } = args;
    const result = await this.services.noteService.searchNotes(keyword, {
      category,
      limit,
    });
    return result;
  }

  async getNote(args) {
    const { id } = args;
    const result = await this.services.noteService.getNoteById(id);
    return result;
  }

  async updateNote(args) {
    const { id, ...updates } = args;
    const result = await this.services.noteService.updateNote(id, updates);
    return result;
  }

  async listNotes(args) {
    const { page = 1, pageSize = 20, category } = args;
    const result = await this.services.noteService.getNotes({
      page,
      pageSize,
      category,
    });
    return result;
  }

  // ==================== 待办操作实现 ====================

  async createTodo(args) {
    const todo = this.services.todoService.createTodo(args);
    return { success: true, data: todo };
  }

  async listTodos(args) {
    const { includeCompleted = false } = args;
    const todos = this.services.todoService.getAllTodos({ includeCompleted });
    return { success: true, data: todos };
  }

  async getTodosByQuadrant(args) {
    const { includeCompleted = false } = args;
    const quadrants = this.services.todoService.getTodosByQuadrant(includeCompleted);
    return { success: true, data: quadrants };
  }

  async updateTodo(args) {
    const { id, ...updates } = args;
    const todo = this.services.todoService.updateTodo(id, updates);
    return { success: true, data: todo };
  }

  async toggleTodoComplete(args) {
    const { id } = args;
    const todo = this.services.todoService.toggleTodoComplete(id);
    return { success: true, data: todo };
  }

  // ==================== AI 操作实现 ====================

  async aiChat(args) {
    const { messages, temperature, maxTokens } = args;
    const result = await this.services.aiService.chat(messages, {
      temperature,
      maxTokens,
    });
    return result;
  }

  // ==================== Mem0 操作实现 ====================

  async addMemory(args) {
    // 检查 Mem0 是否可用（精简版 MCP 可能没有 AI 依赖）
    if (!this.services.mem0Service) {
      return {
        success: false,
        message: 'Mem0 功能未启用（精简版 MCP Server）',
        error: 'Mem0Service not available'
      };
    }

    const { messages, metadata = {} } = args;
    // 将 messages 转换为字符串（如果是数组）
    const content = Array.isArray(messages) 
      ? messages.map(m => `${m.role}: ${m.content}`).join('\n')
      : String(messages);
    
    const result = await this.services.mem0Service.addMemory('current_user', content, { metadata });
    return { 
      success: result.success, 
      message: result.success ? '记忆已添加' : '添加记忆失败',
      data: { id: result.id }
    };
  }

  async searchMemories(args) {
    // 检查 Mem0 是否可用
    if (!this.services.mem0Service) {
      return {
        success: false,
        message: 'Mem0 功能未启用（精简版 MCP Server）',
        data: []
      };
    }

    const { query, limit = 5 } = args;
    const memories = await this.services.mem0Service.searchMemories('current_user', query, { limit });
    return { success: true, data: memories };
  }

  // ==================== 标签操作实现 ====================

  async listTags(args) {
    const result = await this.services.tagService.getAllTags();
    return result;
  }

  async getNotesByTag(args) {
    const { tag } = args;
    // 使用 NoteService 的 searchNotes 方法搜索包含该标签的笔记
    const result = await this.services.noteService.searchNotes(tag, {});
    return result;
  }
}

module.exports = MCPServer;
