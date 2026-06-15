import { create } from 'zustand'

// 双链索引 store
// outgoing: noteId -> Set<targetTitleLowerCase>
// incoming: targetTitleLowerCase -> Set<noteId>
// outgoingDisplay: noteId -> Map<targetTitleLowerCase, displayTargetTitle>
//   用 lowercase 做比较，但保留一个原始大小写副本用于反链 UI 显示
//
// 注：title 为空的笔记不会被索引为目标（[[]] 也不会插入）。

const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g

// 把 markdown 源码中的代码块（``` ... ```）与行内代码（`...`）剥成等长空白，
// 避免代码内的 `[[xxx]]` 字面量被错误索引为双链。
const stripCodeBlocks = (text) => {
  if (!text) return ''
  return text
    // ```...``` 围栏代码块
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    // ~~~...~~~ 也算
    .replace(/~~~[\s\S]*?~~~/g, (m) => ' '.repeat(m.length))
    // 行内 `...`（不跨行）
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

// tiptap-markdown 序列化时会给 `[` `]` 加 `\` 转义，导致 DB 里实际是 `\[\[xxx\]\]`。
// 扫描前先把转义还原为字面 `[` `]`，让正则可以正确命中。
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
    // 去掉 |display 和 #section
    const target = raw.split('|')[0].split('#')[0].trim()
    if (target) out.push(target)
  }
  return out
}

const addToSetMap = (map, key, value) => {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

const removeFromSetMap = (map, key, value) => {
  const set = map.get(key)
  if (!set) return
  set.delete(value)
  if (set.size === 0) map.delete(key)
}

// 比较两个出边集合是否相等
const setsEqual = (a, b) => {
  if (a === b) return true
  if (!a || !b) return false
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

export const useLinkGraph = create((set, get) => ({
  outgoing: new Map(),
  incoming: new Map(),
  outgoingDisplay: new Map(),
  // 笔记 id -> title（用于图谱节点展示）
  titleById: new Map(),

  indexNote: (note) => {
    if (!note || !note.id) return
    const id = note.id
    const { outgoing, incoming, outgoingDisplay, titleById } = get()

    // 计算新出边（白板内容是 JSON，跳过双链扫描，避免误识别）
    const isWhiteboard = note.note_type === 'whiteboard'
    const text = !isWhiteboard && typeof note.content === 'string' ? note.content : ''
    const targets = extractWikiTargets(text)
    const newTargetSet = new Set()
    const newDisplay = new Map()
    targets.forEach((t) => {
      const key = t.toLowerCase()
      newTargetSet.add(key)
      if (!newDisplay.has(key)) newDisplay.set(key, t)
    })

    const prevTargetSet = outgoing.get(id)
    const titleChanged = (note.title || '') !== (titleById.get(id) || '')
    const targetsChanged = !setsEqual(prevTargetSet, newTargetSet)

    // 短路：title 与出边都没变，跳过 set，避免触发订阅者重渲染
    if (!titleChanged && !targetsChanged) return

    // 拆掉旧出边
    if (prevTargetSet) {
      prevTargetSet.forEach((t) => removeFromSetMap(incoming, t, id))
    }

    // 写入新出边
    if (newTargetSet.size === 0) {
      outgoing.delete(id)
      outgoingDisplay.delete(id)
    } else {
      outgoing.set(id, newTargetSet)
      outgoingDisplay.set(id, newDisplay)
      newTargetSet.forEach((key) => addToSetMap(incoming, key, id))
    }

    // 标题表
    if (note.title) titleById.set(id, note.title)
    else titleById.delete(id)

    // 仅在真正有变化的字段上发新引用，避免无关订阅 churn
    const next = { titleById: new Map(titleById) }
    if (targetsChanged) {
      next.outgoing = new Map(outgoing)
      next.incoming = new Map(incoming)
      next.outgoingDisplay = new Map(outgoingDisplay)
    }
    set(next)
  },

  removeNote: (id) => {
    if (!id) return
    const { outgoing, incoming, outgoingDisplay, titleById } = get()
    const prev = outgoing.get(id)
    if (prev) prev.forEach((t) => removeFromSetMap(incoming, t, id))
    outgoing.delete(id)
    outgoingDisplay.delete(id)
    titleById.delete(id)
    set({
      outgoing: new Map(outgoing),
      incoming: new Map(incoming),
      outgoingDisplay: new Map(outgoingDisplay),
      titleById: new Map(titleById),
    })
  },

  // 全量重建（loadNotes 后调用）
  rebuildFromNotes: (notes) => {
    const outgoing = new Map()
    const incoming = new Map()
    const outgoingDisplay = new Map()
    const titleById = new Map()
    if (Array.isArray(notes)) {
      notes.forEach((note) => {
        if (!note || !note.id) return
        if (note.title) titleById.set(note.id, note.title)
        // 白板内容是 JSON，跳过双链扫描
        if (note.note_type === 'whiteboard') return
        const text = typeof note.content === 'string' ? note.content : ''
        const targets = extractWikiTargets(text)
        if (targets.length === 0) return
        const targetSet = new Set()
        const display = new Map()
        targets.forEach((t) => {
          const key = t.toLowerCase()
          targetSet.add(key)
          if (!display.has(key)) display.set(key, t)
        })
        outgoing.set(note.id, targetSet)
        outgoingDisplay.set(note.id, display)
        targetSet.forEach((key) => addToSetMap(incoming, key, note.id))
      })
    }
    set({ outgoing, incoming, outgoingDisplay, titleById })
  },

  // 反链：根据当前笔记 title 反查谁引用了它（按 title 不区分大小写）
  getBacklinkIds: (title) => {
    if (!title) return []
    const set = get().incoming.get(title.toLowerCase())
    return set ? Array.from(set) : []
  },

  // 出链：当前笔记引用了哪些 target title（用 displayTitle 还原大小写）
  getOutgoingTargets: (noteId) => {
    if (!noteId) return []
    const display = get().outgoingDisplay.get(noteId)
    if (!display) return []
    return Array.from(display.values())
  },
}))

export default useLinkGraph
