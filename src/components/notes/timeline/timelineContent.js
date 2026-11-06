// 时间轴记录的纯函数工具：内容拆分 / 合并 / 待办语法 / 标签。
// 不依赖 React 和 Electron，便于单元测试。

export const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|bmp|svg|avif|ico)(?:\?|$)/i

export const TIMELINE_TAG = '时间轴'

// 一整行只有媒体（图片 / 录音 / 附件）Markdown：![name](path) 或 [name](attachments/...)
const MEDIA_LINE = /^\s*(?:!\[[^\]]*]\([^)]+\)|\[[^\]]+]\((?:attachments\/|audio\/|app:\/\/|file:\/\/)[^)]*\))\s*$/

/**
 * 把笔记正文拆成「可编辑的文字」和「媒体行」。
 * 原地编辑时只让用户改文字，媒体行原样保留，避免把 ![录音](audio/...) 暴露给用户。
 */
export const splitEditableContent = (content = '') => {
  const lines = String(content || '').split('\n')
  const text = []
  const media = []
  lines.forEach((line) => (MEDIA_LINE.test(line) ? media : text).push(line))
  return { text: text.join('\n').trim(), media }
}

export const joinEditableContent = (text = '', media = []) =>
  [String(text || '').trim(), media.join('\n')].filter(Boolean).join('\n\n')

// 「待办：xxx」「todo: xxx」「- [ ] xxx」开头的输入当作待办
export const parseTodoInput = (content = '') => {
  const text = String(content || '').trim()
  const match = text.match(/^(?:todo|待办|事项)\s*[:：]\s*(.+)$/is) || text.match(/^-\s*\[\s*]\s+(.+)$/s)
  return match?.[1]?.trim() || null
}

export const appendDraftText = (current, text) => {
  if (!text) return current
  const base = current || ''
  if (!base.trim()) return text.trimStart()
  return `${base}${base.endsWith('\n') ? '' : '\n'}${text.trimStart()}`
}

export const attachmentToMarkdown = (item) => {
  if (item.type === 'image') return item.markdown
  if (item.type === 'audio') return `![录音](${item.path})`
  if (item.type === 'file') return `![${item.name}](${item.path})`
  return ''
}

const pad = (value) => String(value).padStart(2, '0')

/**
 * 把同一天的多条记录合并成一篇笔记的正文：每条记录一节，标题是时间。
 * @param {Array<{ time: number, content: string }>} records 已按时间升序
 */
export const buildMergedDayContent = (records = []) => records
  .map(({ time, content }) => {
    const date = new Date(time)
    return `### ${pad(date.getHours())}:${pad(date.getMinutes())}\n\n${String(content || '').trim()}`
  })
  .join('\n\n')

export const buildMergedDayTitle = (time) => {
  const date = new Date(time)
  return `${date.getMonth() + 1}月${date.getDate()}日 记录`
}

/** 适合转成待办的文字：取第一行非空文字，截断到 200 字 */
export const toTodoText = (text = '') => {
  const first = String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || ''
  return first.length > 200 ? `${first.slice(0, 200)}…` : first
}
