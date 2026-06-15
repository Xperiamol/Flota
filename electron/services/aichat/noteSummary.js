/**
 * 当前笔记上下文取数 + 摘要构造（被 handlers 与 systemPrompt 共用）。
 */

const validateNoteContentUpdate = (existing, nextContent) => {
  if (nextContent === undefined) return null;
  if ((existing?.note_type || 'markdown') !== 'whiteboard') return null;
  return '画布内容不能通过 edit_note 直接修改，请使用画布 AI 生成/插入能力';
};

/**
 * 取当前 markdown 笔记并按行切分；whiteboard 或无打开笔记时返回 error。
 */
const getCurrentNoteLines = async (getCurrentNote, action = '读取') => {
  if (!getCurrentNote) return { error: { error: '当前没有打开的笔记' } };
  const note = await getCurrentNote();
  if (!note) return { error: { error: '当前没有打开的笔记' } };
  if ((note.note_type || 'markdown') === 'whiteboard') {
    return { error: { error: `画布笔记不支持${action}` } };
  }
  const lines = String(note.content || '').split('\n');
  return { note, lines, total: lines.length };
};

const extractImageRefs = (text) => {
  const re = /!\[[^\]]*\]\((?:app:\/\/)?((?:attachments|images)\/[^)\s]+\.(?:png|jpe?g|gif|webp|bmp))\)/gi
  const refs = []
  let m
  while ((m = re.exec(text)) !== null) {
    if (!refs.includes(m[1])) refs.push(m[1])
    if (refs.length >= 12) break
  }
  return refs
}

/**
 * 构造当前笔记的元信息+预览（首尾+目录大纲）。
 * 短笔记可以直接给完整内容；长笔记给摘要，模型按需调用 read/search 工具。
 */
const buildCurrentNoteSummary = (note, { headLines = 60, tailLines = 30, maxOutline = 40 } = {}) => {
  const noteType = note.note_type || 'markdown';
  const base = {
    id: note.id,
    title: note.title || '未命名',
    note_type: noteType,
    tags: note.tags,
    category: note.category
  };

  if (noteType === 'whiteboard') {
    return { ...base, content: note.content };
  }

  const text = String(note.content || '');
  const lines = text.split('\n');
  const total = lines.length;
  const images = extractImageRefs(text);
  const imageHint = images.length > 0
    ? '笔记里含本地图片。如果图片对当前问题（总结、理解笔记主题、识图、描述配图等）有帮助，**直接调用 read_note_image(path) 取图，不要向用户征求许可**。多张图分次调。'
    : null;

  if (text.length <= 8000) {
    return { ...base, total_lines: total, total_chars: text.length, content: text, images, image_hint: imageHint };
  }

  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(Math.max(0, total - tailLines)).join('\n');
  const outline = [];
  for (let i = 0; i < total && outline.length < maxOutline; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) outline.push({ line: i + 1, level: m[1].length, text: m[2].slice(0, 80) });
  }

  return {
    ...base,
    total_lines: total,
    total_chars: text.length,
    preview_head_lines: Math.min(headLines, total),
    preview_tail_lines: Math.min(tailLines, Math.max(0, total - headLines)),
    preview_head: head,
    preview_tail: tail,
    outline,
    images,
    image_hint: imageHint,
    hint: '内容较长，使用 read_current_note(start_line, line_count) 按区间读取，或 search_in_current_note(query) 搜索关键词。'
  };
};

module.exports = {
  validateNoteContentUpdate,
  getCurrentNoteLines,
  buildCurrentNoteSummary
};
