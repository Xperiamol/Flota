/**
 * save_document：write_document 写完后的「保存为笔记」（确认后执行）。
 */
const save_document = async (args, _runtime, { noteDAO }) => {
  const title = String(args.title || '').trim() || '未命名文档';
  const content = String(args.content || '');
  if (!content.trim()) return JSON.stringify({ success: false, error: '文档内容为空' });
  const note = noteDAO.create({ title, content, tags: '', category: '' });
  return JSON.stringify({ success: true, noteId: note.id, note_id: note.id, title: note.title, message: `已保存为笔记《${note.title}》` });
};

// 旧版「长文档生成」确认卡（由单独的流水线代写）已停用：重新执行时给出明确说明
const write_long_document = async () => JSON.stringify({ success: false, error: '长文写作已改为由 AI 直接分段写作，请在对话里让 AI 重新写一次' });

module.exports = { save_document, write_long_document };
