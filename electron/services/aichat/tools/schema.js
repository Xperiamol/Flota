/**
 * OpenAI function calling 工具 schema。
 * 改 schema 时务必同步更新 ./handlers.js 里同名 handler。
 */

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
      description: '获取用户当前正在编辑的笔记元信息和首尾内容预览。返回 title、note_type、total_lines、preview_head/tail 与目录大纲。如果笔记很长，preview 不是完整内容——使用 read_current_note 按行区间读取或 search_in_current_note 搜索关键词定位。编辑前应先确认 note_type；画布笔记的 content 必须保持为完整有效的画布 JSON，不能拼接普通文本。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_current_note',
      description: '按行区间读取当前笔记内容。当 get_current_note 返回的 total_lines 较大、需要查看具体段落时使用。',
      parameters: {
        type: 'object',
        properties: {
          start_line: { type: 'number', description: '起始行号（从 1 开始）' },
          line_count: { type: 'number', description: '读取行数，默认 200，最大 1000' }
        },
        required: ['start_line']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_note_image',
      description: '按需读取当前笔记里的一张本地图片（attachments/ 或 images/ 下）。当你需要"看"图片内容来回答用户时调用，每次只取一张；调用后下一轮你将能直接看到该图。仅在用户要求理解图片内容时调用，不要为常规文本提问无谓取图。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '图片路径，形如 attachments/xxx.png，可来自 get_current_note.images。' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_in_current_note',
      description: '在当前笔记中搜索关键词，返回匹配行的上下文片段。比 read_current_note 更快定位长笔记里的关键内容。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（不区分大小写）' },
          context_lines: { type: 'number', description: '每个匹配前后保留几行上下文，默认 3' },
          max_matches: { type: 'number', description: '最多返回匹配数，默认 8' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize_current_note_section',
      description: '让 AI 自己再调一次模型，对当前笔记的指定行区间生成精炼摘要。仅在 read_current_note 一次拿不下、又需要把握中段全貌时使用（会消耗额外 token）。',
      parameters: {
        type: 'object',
        properties: {
          start_line: { type: 'number', description: '起始行号（从 1 开始）' },
          end_line: { type: 'number', description: '结束行号（包含）' },
          focus: { type: 'string', description: '关注重点，例如「主要论点」「数据结论」（可选）' }
        },
        required: ['start_line', 'end_line']
      }
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
      description: '编辑已有的笔记。可以修改标题、内容、标签或分类，只需提供要修改的字段。禁止通过该工具修改 whiteboard 笔记的 content；画布内容只能由前端画布 AI 生成/插入能力处理。',
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
      name: 'edit_notes',
      description: '批量编辑多条已有笔记的标题或标签，用于"批量整理标题/标签"这类一次涉及多条笔记的请求（如"帮我把这些笔记的标题润色一下"、"给这一批笔记补上合适的标签"）。一次提交多条修改，前端只弹一张聚合确认卡，用户可逐条勾选后统一应用。禁止用于修改 content（正文请用 edit_note 逐条处理），也禁止修改 whiteboard 笔记。调用前应先用 search_notes 或当前选中笔记拿到准确的笔记 id。',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description: '要批量修改的笔记列表，每项至少包含 id 以及一个要修改的字段',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '笔记ID' },
                title: { type: 'string', description: '新标题（可选）' },
                tags: { type: 'string', description: '新标签，用逗号分隔（可选）' }
              },
              required: ['id']
            }
          }
        },
        required: ['edits']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_whiteboard',
      description: '创建一张新的画布（whiteboard）并根据用户描述生成图形内容。适用于“在新画板/白板里画一个思维导图、流程图、架构图、时序图”等请求。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '画布标题（可选）' },
          prompt: { type: 'string', description: '要在画布中生成的内容描述，使用自然语言详细说明' },
          diagram_type: {
            type: 'string',
            enum: ['auto', 'mindmap', 'flowchart', 'architecture', 'sequence', 'hierarchy', 'fishbone', 'timeline', 'gantt', 'quadrant', 'pie'],
            description: '图表类型偏好，默认 auto'
          },
          source_note_id: { type: 'number', description: '作为内容来源的笔记 ID（可选）' },
          use_current_note_context: { type: 'boolean', description: '是否参考当前笔记内容，默认 true' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_whiteboard',
      description: '修改现有画布内容。适用于“在当前画布补充内容”“重画当前图”“修改已有白板”等请求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '如何修改画布的自然语言描述' },
          target_note_id: { type: 'number', description: '目标画布笔记 ID；不传时默认当前画布' },
          action: {
            type: 'string',
            enum: ['append', 'replace', 'edit'],
            description: '修改方式：append 追加，replace 重画，edit 基于现有内容修改'
          },
          diagram_type: {
            type: 'string',
            enum: ['auto', 'mindmap', 'flowchart', 'architecture', 'sequence', 'hierarchy', 'fishbone', 'timeline', 'gantt', 'quadrant', 'pie'],
            description: '图表类型偏好，默认 auto'
          }
        },
        required: ['prompt']
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
          repeat_type: {
            type: 'string',
            enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
            description: '重复规则：不重复/每天/每周/每月/每年。用户说“每天、每周、每月、每年”时必须设置对应值'
          },
          repeat_interval: { type: 'integer', minimum: 1, maximum: 365, description: '重复间隔，默认 1；例如每 2 周为 2' },
          repeat_days: { type: 'string', description: '仅每周重复使用，逗号分隔的星期数字：1=周一，…，7=周日，例如“1,3,5”' },
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
      name: 'create_todos',
      description: '批量创建待办事项，用于把用户的模糊大目标（如"周末去武汉玩"、"准备下周述职"、"学习 React"）拆解为多条具体可执行的任务。调用前应先 search_memory 拉相关知识/偏好、search_todos 看未来一周已有事项以避免冲突；本工具一次提交 5-12 条任务，每条 content 必须是**具体可执行**的动作（实际景点/活动/步骤），不要"调研 X / 规划 Y / 确定 Z"这类空泛准备任务。所有 due_date 时间在 08:00-23:59 之间且不早于当前时间。',
      parameters: {
        type: 'object',
        properties: {
          intro: { type: 'string', description: '一句话说明本次规划的整体思路（可选，给用户预览时显示）' },
          todos: {
            type: 'array',
            description: '待办事项数组',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '待办内容（具体描述要做什么，10-40 字）' },
                description: { type: 'string', description: '地点详情、注意事项或具体步骤（可选）' },
                due_date: { type: 'string', description: '截止时间，YYYY-MM-DDTHH:MM:SS 格式' },
                repeat_type: {
                  type: 'string',
                  enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
                  description: '重复规则：不重复/每天/每周/每月/每年'
                },
                repeat_interval: { type: 'integer', minimum: 1, maximum: 365, description: '重复间隔，默认 1' },
                repeat_days: { type: 'string', description: '仅每周重复使用：1=周一，…，7=周日，多个用逗号分隔' },
                is_important: { type: 'boolean', description: '是否重要' },
                is_urgent: { type: 'boolean', description: '是否紧急' },
                tags: { type: 'string', description: '标签，用逗号分隔（可选）' }
              },
              required: ['content']
            }
          }
        },
        required: ['todos']
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
  },
  {
    type: 'function',
    function: {
      name: 'write_long_document',
      description: '生成超长篇、多章节的文档时使用，例如写一部几万字的小说、长篇研究报告、完整方案、系统技术文档、长篇教程等。该工具会自动规划大纲、把任务拆分为多个章节子任务并逐章撰写，最后归并成完整成稿，过程会流式展示。当用户的写作需求明显超出一次性回复能力（通常 >2000 字或需要多个章节）时调用；普通的短回答、单段落内容不要调用。',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: '完整的写作需求/主题描述，尽量包含用户提到的所有要求（风格、背景设定、受众、结构偏好等）。' },
          doc_type: { type: 'string', description: '文档类型提示，如 小说/研究报告/方案/技术文档/教程 等（可选）。' },
          target_words: { type: 'number', description: '期望的总字数（可选）。' },
          extra_context: { type: 'string', description: '额外的参考资料、约束或已有素材（可选）。' }
        },
        required: ['topic']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索实时信息。当用户的问题涉及最新动态、时效性数据、你不确定或知识可能过期的事实时调用，返回若干网页结果（标题、链接、摘要）。请根据结果作答并在合适处标注来源。注意：query 应是精炼的搜索关键词（一般不超过 20 字），不要把用户的整段需求原样塞进来；复杂需求请拆成多个关键词分别检索，但同一主题最多检索 2-3 次即可，不要反复搜索。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
          count: { type: 'number', description: '期望返回的结果条数（可选，默认按设置）' }
        },
        required: ['query']
      }
    }
  }
];

module.exports = { TOOLS };
