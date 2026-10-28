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
