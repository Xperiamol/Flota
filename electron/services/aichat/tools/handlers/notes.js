/**
 * 笔记相关工具的 handlers。
 * Handler 签名：(args, runtime, services) => Promise<string JSON>
 */

const {
  buildCurrentNoteSummary,
  getCurrentNoteLines,
  validateNoteContentUpdate
} = require('../../noteSummary');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const search_notes = async (args, _runtime, { noteDAO }) => {
  const results = noteDAO.findAll({
    search: args.query,
    limit: args.limit || 5,
    page: 1
  });
  const notes = (results.notes || results || []).map((n) => ({
    id: n.id,
    title: n.title,
    content: n.content?.substring(0, 500),
    note_type: n.note_type || 'markdown',
    tags: n.tags,
    category: n.category,
    updated_at: n.updated_at
  }));
  return JSON.stringify(notes);
};

const get_current_note = async (_args, _runtime, { getCurrentNote }) => {
  if (getCurrentNote) {
    const note = await getCurrentNote();
    if (note) return JSON.stringify(buildCurrentNoteSummary(note));
  }
  return JSON.stringify({ error: '当前没有打开的笔记' });
};

const read_current_note = async (args, _runtime, { getCurrentNote }) => {
  const ctx = await getCurrentNoteLines(getCurrentNote, '按行读取');
  if (ctx.error) return JSON.stringify(ctx.error);
  const { lines, total } = ctx;
  const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
  const count = Math.min(1000, Math.max(1, Math.floor(Number(args.line_count) || 200)));
  if (start > total) {
    return JSON.stringify({ error: `start_line ${start} 超过笔记总行数 ${total}`, total_lines: total });
  }
  const end = Math.min(total, start + count - 1);
  return JSON.stringify({
    start_line: start,
    end_line: end,
    total_lines: total,
    content: lines.slice(start - 1, end).join('\n'),
    has_more: end < total
  });
};

const read_note_image = async (args, _runtime, _services) => {
  const ref = String(args?.path || '').trim();
  const cleaned = ref.replace(/^app:\/\//, '').replace(/^\.?\//, '');
  const m = cleaned.match(/^(attachments|images)\/(.+)$/);
  if (!m) return JSON.stringify({ error: '非法的图片路径' });
  const fileName = m[2];
  if (!fileName || fileName.includes('..') || /[\\/]/.test(fileName)) {
    return JSON.stringify({ error: '非法的图片文件名' });
  }
  const ext = path.extname(fileName).toLowerCase().slice(1);
  const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  if (!mimeMap[ext]) return JSON.stringify({ error: '非图片类型' });
  const fullPath = path.join(app.getPath('userData'), m[1], fileName);
  if (!fs.existsSync(fullPath)) return JSON.stringify({ error: '图片不存在' });
  const stat = fs.statSync(fullPath);
  if (stat.size > 6 * 1024 * 1024) return JSON.stringify({ error: '图片过大（>6MB）' });
  const buf = fs.readFileSync(fullPath);
  const dataUrl = `data:${mimeMap[ext]};base64,${buf.toString('base64')}`;
  // delivered=image：toolLoop 会在工具结果之后追加一条 user 消息把图作为 vision part 提供给模型
  return JSON.stringify({ delivered_image: dataUrl, path: ref });
};

const search_in_current_note = async (args, _runtime, { getCurrentNote }) => {
  const query = String(args.query || '').trim();
  if (!query) return JSON.stringify({ error: '搜索关键词不能为空' });
  const ctx = await getCurrentNoteLines(getCurrentNote, '文本搜索');
  if (ctx.error) return JSON.stringify(ctx.error);
  const { lines, total } = ctx;
  const ctxN = Math.min(20, Math.max(0, Math.floor(Number(args.context_lines) ?? 3)));
  const maxMatches = Math.min(30, Math.max(1, Math.floor(Number(args.max_matches) || 8)));
  const lower = query.toLowerCase();
  const matches = [];
  for (let i = 0; i < total && matches.length < maxMatches; i++) {
    if (!lines[i].toLowerCase().includes(lower)) continue;
    const from = Math.max(1, i + 1 - ctxN);
    const to = Math.min(total, i + 1 + ctxN);
    matches.push({ line: i + 1, context_start: from, context_end: to, snippet: lines.slice(from - 1, to).join('\n') });
  }
  return JSON.stringify({ total_lines: total, matches, truncated: matches.length >= maxMatches });
};

const summarize_current_note_section = async (args, _runtime, { aiService, getCurrentNote }) => {
  const ctx = await getCurrentNoteLines(getCurrentNote, '区间摘要');
  if (ctx.error) return JSON.stringify(ctx.error);
  const { lines, total } = ctx;
  const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
  const end = Math.min(total, Math.max(start, Math.floor(Number(args.end_line) || start)));
  if (start > total) return JSON.stringify({ error: `start_line ${start} 超过笔记总行数 ${total}` });
  const segment = lines.slice(start - 1, end).join('\n');
  const MAX_SEG = 30000;
  const sliced = segment.length > MAX_SEG ? `${segment.slice(0, MAX_SEG)}\n…(已截断 ${segment.length - MAX_SEG} 字符)` : segment;
  const focus = String(args.focus || '').trim();
  try {
    const result = await aiService.chat([
      { role: 'system', content: `你是笔记摘要助手。对用户提供的笔记片段做精炼总结，覆盖主要论点、关键数据、结论和待办事项。${focus ? `\n关注重点：${focus}` : ''}\n用简洁中文，分点列出。不要复述原文。` },
      { role: 'user', content: `笔记片段（第 ${start}-${end} 行，共 ${total} 行）：\n\n${sliced}` }
    ], { temperature: 0.3, maxTokens: 800 });
    if (!result.success) return JSON.stringify({ error: result.error || '摘要失败', start_line: start, end_line: end });
    return JSON.stringify({ start_line: start, end_line: end, total_lines: total, summary: result.data?.content || '' });
  } catch (error) {
    return JSON.stringify({ error: `摘要失败: ${error.message}`, start_line: start, end_line: end });
  }
};

const create_note = async (args, _runtime, { noteDAO }) => {
  if (!args.title?.trim() || !args.content?.trim()) {
    return JSON.stringify({ error: '标题和内容不能为空' });
  }
  const note = noteDAO.create({
    title: args.title,
    content: args.content,
    tags: args.tags || '',
    category: args.category || ''
  });
  return JSON.stringify({ success: true, id: note.id, title: note.title });
};

const edit_note = async (args, _runtime, { noteDAO }) => {
  if (!args.id) return JSON.stringify({ error: '请提供笔记ID' });
  const existing = noteDAO.findById(args.id);
  if (!existing) return JSON.stringify({ error: `未找到ID为 ${args.id} 的笔记` });
  const contentError = validateNoteContentUpdate(existing, args.content);
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
  noteDAO.update(args.id, updateData);
  return JSON.stringify({ success: true, id: args.id, title: args.title || existing.title });
};

module.exports = {
  search_notes,
  get_current_note,
  read_current_note,
  read_note_image,
  search_in_current_note,
  summarize_current_note_section,
  create_note,
  edit_note
};
