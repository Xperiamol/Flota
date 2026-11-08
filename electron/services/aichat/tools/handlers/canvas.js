/**
 * read_whiteboard：读取画布里已有的元素（id、类型、位置、尺寸、文字、颜色），
 * 供模型用 update_whiteboard 的 patch 按 id 局部修改，或判断追加内容放在哪里。
 */
const MAX_ELEMENTS = 400;

const round = (value) => (Number.isFinite(value) ? Math.round(value) : value);

const compactElement = (element) => {
  const out = { id: element.id, type: element.type, x: round(element.x), y: round(element.y), w: round(element.width), h: round(element.height) };
  if (element.text) out.text = String(element.text).slice(0, 300);
  if (element.fontSize) out.fontSize = element.fontSize;
  if (element.strokeColor && element.strokeColor !== 'transparent') out.stroke = element.strokeColor;
  if (element.backgroundColor && element.backgroundColor !== 'transparent') out.fill = element.backgroundColor;
  if (element.containerId) out.containerId = element.containerId;
  if (element.startBinding?.elementId) out.from = element.startBinding.elementId;
  if (element.endBinding?.elementId) out.to = element.endBinding.elementId;
  const kind = element.customData?.kind;
  if (kind === 'svg-image') out.svg = true;
  if (kind === 'mermaid-image') out.mermaid = true;
  return out;
};

const read_whiteboard = async (args, _runtime, { noteDAO, getCurrentNote }) => {
  let note = null;
  if (args.note_id != null && args.note_id !== '') note = noteDAO.findById(Number(args.note_id));
  else if (getCurrentNote) note = await getCurrentNote();
  if (!note) return JSON.stringify({ error: args.note_id != null ? `笔记 ${args.note_id} 不存在` : '当前没有打开的画布，请传 note_id' });
  if (note.note_type !== 'whiteboard') return JSON.stringify({ error: `笔记 ${note.id} 不是画布` });
  let elements = [];
  try {
    elements = (JSON.parse(note.content || '{}').elements || []).filter((element) => element && !element.isDeleted);
  } catch (_) {
    return JSON.stringify({ error: '画布数据无法解析' });
  }
  const bounds = elements.length ? {
    x: round(Math.min(...elements.map((e) => e.x))),
    y: round(Math.min(...elements.map((e) => e.y))),
    right: round(Math.max(...elements.map((e) => e.x + (e.width || 0)))),
    bottom: round(Math.max(...elements.map((e) => e.y + (e.height || 0)))),
  } : null;
  return JSON.stringify({
    note_id: note.id,
    title: note.title,
    element_count: elements.length,
    bounds,
    elements: elements.slice(0, MAX_ELEMENTS).map(compactElement),
    ...(elements.length > MAX_ELEMENTS ? { truncated: `只列出前 ${MAX_ELEMENTS} 个元素` } : {}),
  });
};

module.exports = { read_whiteboard };
