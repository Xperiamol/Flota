import { summarizeWhiteboardContentForAI } from './whiteboardAI'

export const truncateText = (text, max = 1200) => {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export const getNoteTagsText = (tags) => {
  if (Array.isArray(tags)) return tags.join(', ')
  return String(tags || '')
}

export const getNoteText = (note) => `${note?.title || ''}\n${getNoteTagsText(note?.tags)}\n${note?.content || ''}`.toLowerCase()

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has',
  '一个', '这个', '那个', '什么', '怎么', '以及', '或者', '但是', '然后', '因为', '所以'
])

const getSearchTokens = (text, limit = 36) => {
  const value = String(text || '').toLowerCase()
  const latinTokens = value
    .split(/[\s，。！？、,.!?;；:：()[\]{}"'`<>/\\|+=*_~#$%^&@-]+/)
    .map(token => token.trim())
    .filter(token => /^[a-z0-9_]+$/i.test(token) && token.length > 1 && !STOP_WORDS.has(token))

  const cjkTokens = []
  const cjkMatches = value.match(/[\u4e00-\u9fa5]{2,}/g) || []
  cjkMatches.forEach((segment) => {
    if (segment.length <= 6) {
      cjkTokens.push(segment)
      return
    }
    for (let i = 0; i < segment.length - 1; i += 1) {
      cjkTokens.push(segment.slice(i, i + 2))
    }
  })

  return Array.from(new Set([...latinTokens, ...cjkTokens]))
    .filter(token => token.length > 1 && !STOP_WORDS.has(token))
    .slice(0, limit)
}

const getTags = (tags) => getNoteTagsText(tags)
  .split(/[,，#\s]+/)
  .map(tag => tag.trim())
  .filter(Boolean)

export const getTimestamp = (item) => {
  const raw = item?.updated_at || item?.updatedAt || item?.created_at || item?.createdAt || item?.due_date
  const value = raw ? new Date(raw).getTime() : 0
  return Number.isFinite(value) ? value : 0
}

export const formatContextTime = (value) => {
  const timestamp = value ? new Date(value).getTime() : 0
  if (!timestamp || !Number.isFinite(timestamp)) return '时间未知'

  const diffMs = Date.now() - timestamp
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays < 0) return '未来时间'
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} 个月前`
  return `${Math.floor(diffDays / 365)} 年前`
}

export const getContextAgeDays = (value) => {
  const timestamp = value ? new Date(value).getTime() : 0
  if (!timestamp || !Number.isFinite(timestamp)) return null
  return Math.floor((Date.now() - timestamp) / 86400000)
}

export const getStalenessLabel = (value) => {
  const ageDays = getContextAgeDays(value)
  if (ageDays === null || ageDays < 180) return ''
  if (ageDays < 365) return '较旧，可能过时'
  return '很旧，需谨慎使用'
}

export const getLocalDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const isTodoCompleted = (todo) => Boolean(todo?.completed || todo?.is_completed)

export const getTodoTemporalStatus = (todo) => {
  if (!todo?.due_date) {
    return {
      status: 'no_due',
      label: '无截止日期',
      isOverdue: false,
      isDueToday: false,
      isUpcoming: false,
      daysUntilDue: null,
    }
  }

  const dueKey = String(todo.due_date).substring(0, 10)
  const todayKey = getLocalDateKey()
  const dueTime = new Date(`${dueKey}T00:00:00`).getTime()
  const todayTime = new Date(`${todayKey}T00:00:00`).getTime()
  const daysUntilDue = Math.round((dueTime - todayTime) / 86400000)
  const completed = isTodoCompleted(todo)

  if (!completed && dueKey < todayKey) {
    return {
      status: 'overdue',
      label: `已过期 ${Math.abs(daysUntilDue)} 天`,
      isOverdue: true,
      isDueToday: false,
      isUpcoming: false,
      daysUntilDue,
    }
  }

  if (dueKey === todayKey) {
    return {
      status: 'today',
      label: '今天到期',
      isOverdue: false,
      isDueToday: true,
      isUpcoming: false,
      daysUntilDue: 0,
    }
  }

  if (daysUntilDue > 0 && daysUntilDue <= 7) {
    return {
      status: 'upcoming',
      label: `${daysUntilDue} 天后到期`,
      isOverdue: false,
      isDueToday: false,
      isUpcoming: true,
      daysUntilDue,
    }
  }

  return {
    status: completed ? 'completed' : 'future',
    label: completed ? '已完成' : formatContextTime(todo.due_date),
    isOverdue: false,
    isDueToday: false,
    isUpcoming: false,
    daysUntilDue,
  }
}

const getRelatedNoteSignals = (note, query, currentNote) => {
  if (!note || String(note.id) === String(currentNote?.id)) return { score: 0, reasons: [] }

  const title = String(note.title || '').toLowerCase()
  const content = String(note.content || '').toLowerCase()
  const currentTitle = String(currentNote?.title || '').toLowerCase().trim()
  const currentTags = getTags(currentNote?.tags)
  const noteTags = getTags(note?.tags)
  const sharedTags = currentTags.filter(tag => noteTags.includes(tag)).slice(0, 3)
  const tokens = getSearchTokens(query)
  const matchedInTitle = tokens.filter(token => title.includes(token)).slice(0, 4)
  const matchedInContent = tokens
    .filter(token => !matchedInTitle.includes(token) && content.includes(token))
    .slice(0, 6)
  const titleOverlap = currentTitle.length > 1 && (
    title.includes(currentTitle) || currentTitle.includes(title)
  )

  const tagScore = sharedTags.length * 6
  const titleScore = matchedInTitle.length * 3 + (titleOverlap ? 6 : 0)
  const contentScore = matchedInContent.length * 0.9
  const matchScore = tagScore + titleScore + contentScore
  const timestamp = getTimestamp(note)
  const recencyScore = matchScore > 0 && timestamp
    ? Math.max(0, 1.2 - ((Date.now() - timestamp) / 86400000 / 45))
    : 0
  const score = matchScore + recencyScore

  const reasons = [
    ...sharedTags.map(tag => `同标签：${tag}`),
    ...(titleOverlap ? ['标题高度相近'] : []),
    ...(matchedInTitle.length > 0 ? [`标题命中：${matchedInTitle.slice(0, 2).join('、')}`] : []),
    ...(matchedInContent.length > 0 ? [`内容命中：${matchedInContent.slice(0, 3).join('、')}`] : []),
    ...(recencyScore > 0.8 ? ['最近更新'] : [])
  ].slice(0, 3)

  return { score, reasons }
}

export const scoreRelatedNote = (note, query, currentNote) => {
  return getRelatedNoteSignals(note, query, currentNote).score
}

export const getRelatedNotes = ({ notes = [], selectedNoteId, query = '', limit = 5 }) => {
  const currentNote = notes.find(note => String(note.id) === String(selectedNoteId))
  const baseQuery = `${query}\n${currentNote?.title || ''}\n${getNoteTagsText(currentNote?.tags)}\n${truncateText(currentNote?.content, 1600)}`

  return notes
    .map(note => ({ note, ...getRelatedNoteSignals(note, baseQuery, currentNote) }))
    .filter(item => item.score >= 5.5 && item.reasons.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ note, score, reasons }) => ({
      id: note.id,
      title: note.title,
      tags: getNoteTagsText(note.tags),
      excerpt: formatNoteContentForAI(note, 420),
      updated_at: note.updated_at || note.updatedAt,
      created_at: note.created_at || note.createdAt,
      timeLabel: formatContextTime(note.updated_at || note.updatedAt || note.created_at || note.createdAt),
      stalenessLabel: getStalenessLabel(note.updated_at || note.updatedAt || note.created_at || note.createdAt),
      score: Number(score.toFixed(2)),
      reasons,
    }))
}

export const getTimeSensitiveTodos = ({ todos = [], limit = 8 }) => {
  const priority = { overdue: 0, today: 1, upcoming: 2 }

  return todos
    .filter(todo => !isTodoCompleted(todo))
    .map(todo => {
      const temporal = getTodoTemporalStatus(todo)
      return { todo, temporal }
    })
    .filter(item => item.temporal.isOverdue || item.temporal.isDueToday || item.temporal.isUpcoming)
    .sort((a, b) => {
      const statusDiff = priority[a.temporal.status] - priority[b.temporal.status]
      if (statusDiff !== 0) return statusDiff
      return (a.temporal.daysUntilDue ?? 999) - (b.temporal.daysUntilDue ?? 999)
    })
    .slice(0, limit)
    .map(({ todo, temporal }) => ({
      id: todo.id,
      content: todo.content,
      description: todo.description,
      due_date: todo.due_date,
      tags: todo.tags,
      is_important: todo.is_important,
      is_urgent: todo.is_urgent,
      isOverdue: temporal.isOverdue,
      isDueToday: temporal.isDueToday,
      isUpcoming: temporal.isUpcoming,
      timeLabel: temporal.label,
    }))
}

export const normalizeMemories = (memories = [], limit = 5) => (
  memories
    .filter(memory => memory?.content)
    .slice(0, limit)
    .map(memory => {
      const updatedAt = memory.updated_at || memory.updatedAt || memory.created_at || memory.createdAt
      return {
        id: memory.id,
        content: truncateText(memory.content, 420),
        category: memory.category,
        memory_layer: memory.memory_layer || memory.memoryLayer,
        score: memory.score,
        vecScore: memory.vecScore,
        created_at: memory.created_at || memory.createdAt,
        updated_at: memory.updated_at || memory.updatedAt,
        timeLabel: updatedAt ? formatContextTime(updatedAt) : '',
        stalenessLabel: updatedAt ? getStalenessLabel(updatedAt) : '',
      }
    })
)

export const formatNoteContentForAI = (note, max = 2400) => {
  if (!note) return ''
  if ((note.note_type || 'markdown') !== 'whiteboard') {
    return truncateText(note.content, max)
  }

  try {
    const summary = summarizeWhiteboardContentForAI(note.content)
    return truncateText(`画布摘要:\n${summary}`, max)
  } catch (_) {
    return '画布摘要：当前画布内容解析失败。'
  }
}

export const buildContextPackageFromNotes = ({ notes = [], todos = [], memories = [], selectedNoteId, query = '', contextEnabled = {} }) => {
  const currentNote = notes.find(note => String(note.id) === String(selectedNoteId))
  const contextPackage = {}

  if (contextEnabled.currentNote && currentNote) {
    const updatedAt = currentNote.updated_at || currentNote.updatedAt
    const createdAt = currentNote.created_at || currentNote.createdAt
    contextPackage.currentNote = {
      id: currentNote.id,
      title: currentNote.title,
      note_type: currentNote.note_type || 'markdown',
      tags: getNoteTagsText(currentNote.tags),
      content: formatNoteContentForAI(currentNote, 2400),
      updated_at: updatedAt,
      created_at: createdAt,
      timeLabel: formatContextTime(updatedAt || createdAt),
      stalenessLabel: getStalenessLabel(updatedAt || createdAt),
    }
  }

  if (contextEnabled.relatedNotes) {
    const relatedNotes = getRelatedNotes({ notes, selectedNoteId, query, limit: 5 })
    if (relatedNotes.length > 0) contextPackage.relatedNotes = relatedNotes
  }

  if (contextEnabled.todos !== false) {
    const timeSensitiveTodos = getTimeSensitiveTodos({ todos, limit: 8 })
    if (timeSensitiveTodos.length > 0) contextPackage.todayTodos = timeSensitiveTodos
  }

  if (contextEnabled.memories) {
    const normalizedMemories = normalizeMemories(memories, 5)
    if (normalizedMemories.length > 0) contextPackage.memories = normalizedMemories
  }

  return contextPackage
}

export const getContextSources = (contextPackage) => [
  ...(contextPackage.currentNote ? [{
    type: 'currentNote',
    id: contextPackage.currentNote.id,
    label: `当前：${contextPackage.currentNote.title || '未命名'}`
  }] : []),
  ...((contextPackage.relatedNotes || []).map(note => ({
    type: 'relatedNote',
    id: note.id,
    label: `相关：${note.title || '未命名'}`
  }))),
  ...((contextPackage.memories || []).map(memory => ({
    type: 'memory',
    id: memory.id,
    label: `记忆：${truncateText(memory.content, 18)}`
  })))
]
