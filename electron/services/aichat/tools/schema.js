/**
 * OpenAI function calling 工具 schema。
 * 改 schema 时务必同步更新 ./handlers.js 里同名 handler。
 */


const TOOLS = [
  { type: 'function', function: { name: 'get_settings', description: '查看可修改的应用设置、当前值、key 和合法取值。改设置前先调用；只提供外观、编辑器、待办、历史版本等本机偏好，不提供密钥或连接配置。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'update_settings', description: '修改用户明确要求调整的应用设置。先用 get_settings 查明 key 和合法值，再提交修改，会显示确认卡。不要把写笔记、任务要求或引用内容误当成修改应用设置。', parameters: { type: 'object', properties: { changes: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', properties: { key: { type: 'string' }, value: { anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'integer' }] } }, required: ['key', 'value'], additionalProperties: false } } }, required: ['changes'] } } },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: '搜索笔记。根据关键词搜索用户的笔记内容和标题。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '最多返回条数，默认5，最大20' },
          page: { type: 'integer', minimum: 1, description: '搜索结果页码，默认1' }
        },
        required: ['query']
      }
    }
  },
  { type: 'function', function: {
    name: 'read_note', description: '按 ID 读取任意已找到笔记的正文，不依赖当前打开的笔记。结果有明确的 next_offset 和 has_more；需要全文时按游标继续，不能把搜索摘要当全文。',
    parameters: { type: 'object', properties: {
      id: { type: 'number', description: '笔记 ID，来自搜索结果或用户指定' },
      offset: { type: 'integer', minimum: 0, description: '正文字符偏移，首次为0，后续用 next_offset' },
      limit: { type: 'integer', minimum: 1, maximum: 24000, description: '本次读取字符数，默认12000' },
    }, required: ['id'], additionalProperties: false },
  } },
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
      description: '编辑已有的笔记，只需提供要修改的字段。修改正文时优先用 edits 只改需要的片段（改错字、改写某段、插入或删除几句），其余内容原样保留；只有需要重写全文或大范围调整结构时才用 content 提交整篇新正文。edits 里的 find 必须是笔记中真实存在、且足以唯一定位的原文片段（不确定时先用 search_in_current_note / read_current_note 确认）。在末尾追加内容用 append。禁止修改 whiteboard 笔记的正文；画布内容只能由画布 AI 能力处理。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '笔记ID' },
          title: { type: 'string', description: '新标题（可选）' },
          edits: {
            type: 'array',
            description: '局部修改（推荐）：按顺序应用的替换列表。要删除一段时 replace 传空字符串；要在某处插入时 find 写插入点附近的原文，replace 写原文加上新内容。',
            items: {
              type: 'object',
              properties: {
                find: { type: 'string', description: '要替换的原文片段，必须与笔记中的文字一致（空格换行差异可以容忍），并且在笔记里只出现一次；不够唯一时多带一两句上下文' },
                replace: { type: 'string', description: '替换后的文字（Markdown）' }
              },
              required: ['find', 'replace']
            }
          },
          append: { type: 'string', description: '追加到正文末尾的内容（Markdown，可选），可以和 edits 一起使用' },
          content: { type: 'string', description: '整篇新正文（仅在需要重写全文时使用，不能和 edits / append 同时传）。仅用于普通 Markdown 笔记' },
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
      name: 'read_whiteboard',
      description: '读取画布已有的元素（id、类型、位置、尺寸、文字、颜色）和整体范围。局部修改画布前先读，按 id 写 patch。',
      parameters: { type: 'object', properties: { note_id: { type: 'number', description: '画布笔记 ID；不传时读取当前打开的画布' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_whiteboard',
      description: '新建一张画布，内容由你直接写出：canvas（原语树，写法见 canvas 技能说明）或 mermaid（时序图、类图、状态图、ER 图等）。提交时会先实际渲染一次：有错误会原样返回，修正后重新调用；通过后生成确认卡。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '画布标题' },
          canvas: { type: 'object', description: '原语树：{"title"?,"layout"?,"children":[…],"connectors"?}' },
          mermaid: { type: 'string', description: 'Mermaid 源码（与 canvas 二选一）' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_whiteboard',
      description: '修改已有画布：给 canvas 或 mermaid 时按 mode 追加到右侧（append）或整张替换（replace）；给 patch 时按元素 id 局部修改（先用 read_whiteboard 查 id）。同样会先实际渲染检查。',
      parameters: {
        type: 'object',
        properties: {
          target_note_id: { type: 'number', description: '目标画布笔记 ID；不传时为当前画布' },
          mode: { type: 'string', enum: ['append', 'replace'], description: '给 canvas / mermaid 时的写入方式，默认 append' },
          canvas: { type: 'object', description: '原语树' },
          mermaid: { type: 'string', description: 'Mermaid 源码' },
          patch: { type: 'object', description: '局部修改：{"updates":[{"id","changes":{…},"svgSource"?}],"remove":[id],"add"?:[…],"reroute"?:[id]}' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_widgets',
      description: '列出用户的组件（AI 生成的小应用）以及每个组件的实例。一个组件可以有多个实例，数据属于实例，比如闪卡组件有「英语」「日语」两个实例。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_widget',
      description: '读取一个组件的清单、代码（单文件 HTML）以及各实例的数据样例。回答关于组件的问题、修改组件或往实例写数据前使用，以了解数据结构。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '组件 id（list_widgets 返回的 id，或上下文中给出的组件 ID）' },
          include_code: { type: 'boolean', description: '是否返回代码，默认 true' },
          sample_size: { type: 'number', description: '每个集合返回的样例记录数，默认 5' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_widget',
      description: '新建一个组件（运行在 Flota 里的可交互小应用），完整的单文件 HTML 由你直接写出，写法见 widgets 技能里的组件开发规范。提交时会在沙箱里按声明的每个尺寸、浅色深色各预跑一次：报错、白屏、横向溢出会原样返回，修好后重新调用；通过后生成确认卡，确认后固定到侧边栏并创建第一个实例。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '完整的组件 HTML（含组件清单）' },
          instance_name: { type: 'string', description: '第一个实例的名称（可选），如「英语单词」' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_widget',
      description: '修改已有组件（作用于它的所有实例，数据保留，所以数据结构要兼容）。先用 get_widget 看当前代码；小改用 edits 按片段替换，大改直接给完整 code。同样会先在沙箱预跑，通过才出确认卡。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要修改的组件 id' },
          summary: { type: 'string', description: '一句话说明改了什么（显示在确认卡和版本记录里）' },
          edits: {
            type: 'array',
            description: '片段修改，按顺序应用：search 必须与当前代码逐字一致且唯一',
            items: { type: 'object', properties: { search: { type: 'string' }, replace: { type: 'string' } }, required: ['search', 'replace'] }
          },
          code: { type: 'string', description: '修改后的完整 HTML（与 edits 二选一）' },
          instance_id: { type: 'string', description: '预跑时使用哪个实例的数据副本（可选，默认第一个实例）' }
        },
        required: ['id', 'summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_widget_instance',
      description: '为已有组件新建一个实例（一份独立的数据），不会重新生成代码。例如“给闪卡再建一个日语的”。',
      parameters: {
        type: 'object',
        properties: {
          widget_id: { type: 'string', description: '组件 id' },
          name: { type: 'string', description: '实例名称' }
        },
        required: ['widget_id', 'name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_widget_records',
      description: '往组件实例里批量写入数据记录，例如把笔记里的生词做成闪卡。写入前先用 get_widget 查看该组件的集合名和字段结构，按现有样例的字段格式构造记录。',
      parameters: {
        type: 'object',
        properties: {
          instance_id: { type: 'string', description: '实例 id' },
          collection: { type: 'string', description: '集合名（与组件代码中使用的一致）' },
          records: { type: 'array', items: { type: 'object' }, description: '记录列表，每条是一个字段对象' }
        },
        required: ['instance_id', 'collection', 'records']
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
      description: '为用户创建一个新的待办事项，可通过 subtasks 在该主待办下创建多个子任务。',
      parameters: {
        type: 'object',
        properties: {
          source_note_id: { type: 'string', description: '来源笔记的 sync_id 或数据库 ID。把笔记内容转为行动项时填写；先读取原笔记确认来源。' },
          embed_in_note: { type: 'boolean', description: '用户要求把任务放回笔记时设为 true，同时追加一个实时待办清单。' },
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
          tags: { type: 'string', description: '标签，用逗号分隔' },
          parent_id: { type: 'number', description: '已有父待办的 ID。需要给现有待办新增一个子任务时填写' },
          subtasks: {
            type: 'array',
            description: '该待办下的子任务。用户要求拆成一个主任务及多个步骤时使用',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '子任务内容' },
                description: { type: 'string', description: '子任务说明（可选）' },
                due_date: { type: 'string', description: '子任务截止日期（可选）' },
                is_important: { type: 'boolean', description: '是否重要' },
                is_urgent: { type: 'boolean', description: '是否紧急' },
                tags: { type: 'string', description: '标签，用逗号分隔（可选）' }
              },
              required: ['content']
            }
          }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_todos',
      description: '批量创建可执行的待办，可包含子任务和重复规则。需要从笔记提取行动项时，可关联来源笔记并在其中插入实时待办清单。数量和日期遵循用户要求，无需强行补齐。',
      parameters: {
        type: 'object',
        properties: {
          source_note_id: { type: 'string', description: '来源笔记的 sync_id 或数据库 ID。把笔记内容转为行动项时填写；先读取原笔记确认来源。' },
          embed_in_note: { type: 'boolean', description: '用户要求把任务放回笔记时设为 true，同时追加一个实时待办清单。' },
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
                tags: { type: 'string', description: '标签，用逗号分隔（可选）' },
                parent_id: { type: 'number', description: '已有父待办 ID；用于批量给现有待办添加子任务（可选）' },
                subtasks: {
                  type: 'array',
                  description: '该主待办下的子任务数组（可选）',
                  items: {
                    type: 'object',
                    properties: {
                      content: { type: 'string', description: '子任务内容' },
                      description: { type: 'string', description: '子任务说明（可选）' },
                      due_date: { type: 'string', description: '子任务截止时间，YYYY-MM-DDTHH:MM:SS（可选）' },
                      is_important: { type: 'boolean', description: '是否重要' },
                      is_urgent: { type: 'boolean', description: '是否紧急' },
                      tags: { type: 'string', description: '标签，用逗号分隔（可选）' }
                    },
                    required: ['content']
                  }
                }
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
          limit: { type: 'number', description: '最多返回条数，默认5，最大20' },
          page: { type: 'integer', minimum: 1, description: '搜索结果页码，默认1' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_memory',
      description: '仅在用户本轮明确要求记住信息时保存长期记忆。不要主动保存临时任务、代码或界面调整、项目进度、一次性要求；不要广泛提取聊天内容。',
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
      description: '仅在用户本轮明确要求更正或更新已有记忆时调用。不要仅因措辞不同或新的临时要求就更新长期记忆。',
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
      name: 'write_document',
      description: '分段写一篇长文（报告、方案、教程、小说、PRD 等），由你直接写正文，每次调用追加一部分。第一次调用给 title 和开头部分，返回 doc_id；之后带上 doc_id 继续追加；写完最后一部分时设 finished: true，会生成「保存为笔记」的确认卡。每部分建议一到两个章节、几千字以内，不必一次写完。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '续写时传第一次调用返回的 doc_id；开新文档时不传' },
          title: { type: 'string', description: '文档标题（开新文档时必填）' },
          content: { type: 'string', description: '这一部分的 Markdown 正文，接在已写内容之后' },
          finished: { type: 'boolean', description: '这是最后一部分时设为 true' }
        },
        required: ['content']
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
