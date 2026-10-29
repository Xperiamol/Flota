// Stable references travel with Markdown and resolve through sync_id on each device.
export const referenceUrl = (kind, id) => `app://${kind}/${encodeURIComponent(String(id))}`
export const referenceLink = (kind, item) => `[${String(item.title || item.content || '未命名').replace(/[\\[\]\r\n]/g, ' ')}](${referenceUrl(kind, item.sync_id || item.id)})`
export function referencesIn(markdown, kind) {
  const result = new Set()
  // Ignore fenced and inline code: examples are not relationships.
  const text = String(markdown || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, '')
  for (const match of text.matchAll(/\[(?:\\.|[^\]\\\n])*\]\(<?app:\/\/(note|todo|todo-list)\/([^\s)>]+)>?\)/g)) {
    if (match[1] !== kind) continue
    try { result.add(decodeURIComponent(match[2])) } catch { /* malformed link stays ordinary text */ }
  }
  return result
}
export const matchesReference = (item, references) => references.has(String(item.sync_id || item.id))
export const relatedTodos = (note, todos) => {
  if (!note) return []
  const embedded = referencesIn(note.content, 'todo')
  return topLevelMatches(todos.filter(todo => matchesReference(todo, embedded) || matchesReference(note, referencesIn(todo.description, 'note'))))
}

export function todoTags(value) {
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map(String) } catch {}
  return String(value || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
}
const topLevelMatches = tasks => {
  const ids = new Set(tasks.map(todo => String(todo.sync_id || todo.id)))
  return tasks.filter(todo => !todo.parent_todo_id || !ids.has(String(todo.parent_todo_id)))
}
export function tasksForScope(todos, reference, notes = []) {
  const separator = reference.indexOf('/')
  const kind = separator < 0 ? reference : reference.slice(0, separator)
  const target = separator < 0 ? '' : reference.slice(separator + 1)
  if (kind === 'all') return todos.filter(todo => !todo.parent_todo_id)
  if (kind === 'tag') return topLevelMatches(todos.filter(todo => todoTags(todo.tags).includes(target)))
  if (kind === 'note') {
    const note = notes.find(note => String(note.sync_id || note.id) === target)
    const ids = new Set([target])
    const embedded = referencesIn(note?.content, 'todo')
    return topLevelMatches(todos.filter(todo => matchesReference(todo, embedded) || [...referencesIn(todo.description, 'note')].some(id => ids.has(id))))
  }
  return []
}
export function todoEmbedSelection(item) {
  const list = item.kind === 'list'
  const reference = list ? item.reference : String(item.sync_id || item.id)
  const title = item.content || '待办清单'
  return { type: list ? 'todoListEmbed' : 'todoEmbed', attrs: { reference, title }, markdown: referenceLink(list ? 'todo-list' : 'todo', { sync_id: reference, content: title }) }
}

// One relationship model drives both the note-details badge and its task section.
export function noteTodoReferences(note, todos, notes = []) {
  if (!note) return { tasks: [], hasReferences: false, missingCount: 0 }
  const direct = referencesIn(note.content, 'todo')
  const lists = referencesIn(note.content, 'todo-list')
  const byId = new Map(relatedTodos(note, todos).map(todo => [String(todo.sync_id || todo.id), todo]))
  const scopeNotes = [note, ...notes.filter(item => String(item.id) !== String(note.id))]
  for (const scope of lists) {
    for (const todo of tasksForScope(todos, scope, scopeNotes)) byId.set(String(todo.sync_id || todo.id), todo)
  }
  const missingCount = [...direct].filter(id => !todos.some(todo => String(todo.sync_id || todo.id) === id)).length
  const tasks = topLevelMatches([...byId.values()])
  return { tasks, missingCount, hasReferences: Boolean(tasks.length || direct.size || lists.size) }
}
