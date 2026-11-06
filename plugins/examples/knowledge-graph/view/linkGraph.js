// 从笔记内容里提取关联：[[双链]]、应用内引用（插入链接 / 关联画布）、标签。
// 纯函数，无外部依赖；双链规则与 src/store/useLinkGraph.js 保持一致。

const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g
const APP_LINK_RE = /\[(?:\\.|[^\]\\\n])*\]\(<?app:\/\/(note|whiteboard)\/([^\s)>]+)>?\)/g

const stripCodeBlocks = (text) => {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/~~~[\s\S]*?~~~/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

const unescapeBrackets = (text) => {
  if (!text) return ''
  return text.replace(/\\([[\]])/g, '$1')
}

/** [[目标]] / [[目标|别名]] / [[目标#小节]] → 目标 */
export const extractWikiTargets = (text) => {
  if (!text || typeof text !== 'string') return []
  const cleaned = unescapeBrackets(stripCodeBlocks(text))
  const out = []
  let m
  WIKI_LINK_RE.lastIndex = 0
  while ((m = WIKI_LINK_RE.exec(cleaned)) !== null) {
    const raw = m[1]
    if (!raw) continue
    const target = raw.split('|')[0].split('#')[0].trim()
    if (target) out.push(target)
  }
  return out
}

/** [文字](app://note/<id>) / [文字](app://whiteboard/<id>) → id（sync_id 或本地 id） */
export const extractAppReferences = (text) => {
  if (!text || typeof text !== 'string') return []
  const cleaned = stripCodeBlocks(text)
  const out = []
  let m
  APP_LINK_RE.lastIndex = 0
  while ((m = APP_LINK_RE.exec(cleaned)) !== null) {
    try { out.push(decodeURIComponent(m[2])) } catch { out.push(m[2]) }
  }
  return out
}

/** 笔记的标签：逗号分隔的字符串或 JSON 数组 */
export const parseNoteTags = (value) => {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean)
  if (!value) return []
  const text = String(value)
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map((tag) => String(tag).trim()).filter(Boolean)
    } catch { /* 按逗号分隔处理 */ }
  }
  return text.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
}
