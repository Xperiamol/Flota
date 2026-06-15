// extractWikiTargets - 从笔记内容提取双链目标
// 复制自 src/store/useLinkGraph.js（保持纯函数，无外部依赖），仅供本插件视图使用。

const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g

const stripCodeBlocks = (text) => {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/~~~[\s\S]*?~~~/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

const unescapeBrackets = (text) => {
  if (!text) return ''
  return text.replace(/\\([\[\]])/g, '$1')
}

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
