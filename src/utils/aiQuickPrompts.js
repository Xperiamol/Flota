export const GENERAL_AI_QUICK_PROMPTS = [
  { id: 'general-0', label: '整理标题', prompt: '帮我把最近的笔记标题润色一下，让它们更清晰统一。先搜索我的笔记，再用批量编辑一次性给出修改建议让我确认。' },
  { id: 'general-1', label: '整理标签', prompt: '帮我给最近的笔记补充并统一标签。先搜索我的笔记，再用批量编辑一次性给出标签建议让我确认。' },
  { id: 'general-2', label: '生成日报', prompt: '根据我今天的笔记和待办，帮我生成一份今日工作日报，包含已完成事项、进展和明日计划。' },
  { id: 'general-3', label: '写部小说', prompt: '我想写一部小说，帮我构思并撰写。请先和我确认题材、主角和大致情节走向。' },
]

export const NOTE_AI_QUICK_PROMPTS = [
  { id: 'summarize', label: '总结当前笔记', prompt: '请总结当前笔记，输出：核心要点、关键结论。' },
  { id: 'next-step', label: '下一步建议', prompt: '基于当前笔记，给我 3 条具体可执行的下一步行动建议。' },
  { id: 'extract-todos', label: '提取待办', prompt: '请从当前笔记提取待办事项，并按优先级排序。' },
  { id: 'related', label: '关联内容', prompt: '找出和当前笔记最相关的笔记、待办和记忆，并简要说明关联原因。' },
]

// 任务规划会话的快速开始（AI 页面和「问 AI」小窗共用；id 稳定，用户自定义的快捷方式才能对得上）
export const TASK_PLANNING_QUICK_PROMPTS = [
  { id: 'plan-today', label: '规划今天', prompt: '请读取我今天和已经逾期的待办，结合重要性、紧急度与截止时间，帮我规划今天的执行顺序。先给出简洁方案，需要调整或新建待办时统一列出并等我确认。' },
  { id: 'break-down-goal', label: '拆解目标', prompt: '我有一个目标需要拆解成可执行的待办。请先询问目标、截止时间和限制条件，再按阶段生成具体任务，并合理设置重要性、紧急度与截止时间。' },
  { id: 'plan-week', label: '安排本周', prompt: '请查看我现有的未完成待办，为本周制定一份现实可执行的计划。识别冲突、逾期和优先级问题，给出调整建议，并在我确认后更新待办。' },
  { id: 'clean-backlog', label: '整理积压', prompt: '请帮我整理积压的未完成待办：找出重复、长期逾期、描述模糊或优先级不合理的项目，给出保留、拆解、延期或删除建议，等我确认后再执行修改。' },
]
