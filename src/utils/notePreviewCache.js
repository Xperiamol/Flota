import { stripMarkdownToPreviewText } from './markdownTextUtils'

// 笔记预览文字缓存（模块级，笔记列表、引用选择器等共用，离开页面再回来仍有效）：正文没变就不重复清洗。
// 长笔记清洗一次要对全文跑二十多个正则，而这些列表每次渲染、每行都要用到。
const previewCache = new Map()
const computeCleanPreview = (content, noteType) => {
  if (noteType === 'whiteboard') {
    try {
      const whiteboardData = JSON.parse(content)
      const texts = whiteboardData.elements
        ?.filter(e => e.type === 'text' && !e.isDeleted && e.text?.trim())
        .map(e => stripMarkdownToPreviewText(e.text).trim())
        .filter(Boolean) || []
      if (texts.length > 0) return { whiteboard: texts.join(' ').substring(0, 100) }
      const count = whiteboardData.elements?.filter(e => !e.isDeleted)?.length || 0
      return { whiteboard: count > 0 ? `画布笔记 · ${count} 个元素` : '画布笔记' }
    } catch (error) {
      return { whiteboard: '画布笔记' }
    }
  }
  return { text: stripMarkdownToPreviewText(content) }
}
/** 返回 { text }（Markdown 清洗后的全文）或 { whiteboard }（画布预览文案） */
export const getCleanPreview = (note) => {
  const cached = previewCache.get(note.id)
  if (cached && cached.content === note.content && cached.noteType === note.note_type) return cached.value
  const value = computeCleanPreview(note.content, note.note_type)
  previewCache.set(note.id, { content: note.content, noteType: note.note_type, value })
  return value
}

/** 有用户写的标题（空标题和默认占位标题不算） */
export const hasRealNoteTitle = (note) => Boolean(note.title && note.title !== '无标题' && note.title !== 'Untitled')

/** 预览文字（最多 100 字）；skipChars 跳过开头（标题借用了正文开头时）。空正文返回 emptyText */
export const getNotePreviewText = (note, skipChars = 0, emptyText = '空笔记') => {
  if (!note.content) return emptyText
  const cached = getCleanPreview(note)
  // 画布笔记的预览是画布里的文字，不按标题跳过开头
  if (cached.whiteboard !== undefined) return cached.whiteboard
  const clean = cached.text
  if (skipChars > 0) {
    const remaining = clean.substring(skipChars).trim()
    return remaining.substring(0, 100) || null
  }
  return clean.substring(0, 100) || null
}

/** 列表里显示的标题：有标题用标题，否则用正文前 9 个字 */
export const getNoteDisplayTitle = (note, untitledText = '未命名笔记') => {
  if (hasRealNoteTitle(note)) return note.title
  if (note.content) {
    if (note.note_type === 'whiteboard') return '画布笔记'
    const preview = getNotePreviewText(note, 0)
    if (preview) return preview.substring(0, 9) + (preview.length > 9 ? '...' : '')
  }
  return untitledText
}

/** 列表行的摘要：标题借用了正文前 9 个字时，摘要从第 9 个字开始 */
export const getNoteRowPreview = (note, emptyText) => getNotePreviewText(note, hasRealNoteTitle(note) ? 0 : 9, emptyText)
