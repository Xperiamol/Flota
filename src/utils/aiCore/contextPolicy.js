// 通用聊天不借用后台最后选中的笔记；笔记入口只使用当前可见或明确指定的那篇。
export const resolveContextPolicy = ({ scene = 'chat_panel', selectedNoteId, location, query = '' }) => {
  const noteId = scene === 'chat_panel' ? null : location?.noteId ?? null
  const noteScoped = noteId != null && String(noteId) === String(selectedNoteId)
  return {
    selectedNoteId: noteScoped ? noteId : null,
    contextEnabled: {
      currentNote: noteScoped,
      relatedNotes: noteScoped || /我的笔记|笔记里|笔记中|记录里|从笔记|查找笔记|搜索笔记|my notes|in my notes/i.test(query),
      todos: ['todo', 'calendar'].includes(location?.view)
        || /我的待办|我的任务|我的日程|我的日历|待办里|日历里|安排今天|安排明天|今天的任务|未完成.{0,8}(?:待办|任务)|my (?:tasks|todos|calendar|schedule)/i.test(query),
      memories: true,
    },
  }
}
