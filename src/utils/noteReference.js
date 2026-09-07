import { stripMarkdownToPreviewText } from './markdownTextUtils'

export function noteReferenceText(note) {
  if (!note || note.is_deleted || note.deleted_at) return '原笔记已删除或尚未同步'
  // Bound the snapshot to the card interior; the complete note stays one click away.
  const wrap = (text, columns, limit) => {
    const lines = []; let line = ''; let width = 0
    for (const char of String(text).replace(/\s+/g, ' ')) {
      const units = char.charCodeAt(0) > 255 ? 2 : 1
      if (width + units > columns) { lines.push(line); line = ''; width = 0 }
      if (lines.length >= limit) return `${lines.join('\n')}…`
      line += char; width += units
    }
    if (line) lines.push(line)
    return lines.join('\n')
  }
  return `${wrap(note.title || '未命名笔记', 30, 2)}\n\n${wrap(stripMarkdownToPreviewText(note.content || ''), 30, 5)}`
}
