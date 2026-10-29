import test from 'node:test'
import assert from 'node:assert/strict'
import { referencesIn, referenceLink, relatedTodos, noteTodoReferences } from '../../src/utils/todoReferences.js'

test('relationships use stable IDs and survive Markdown escaping and renaming', () => {
  const note = { id: 12, sync_id: 'note/stable', title: '资料 [新版]\\计划' }
  const markdown = referenceLink('note', note)
  assert.deepEqual([...referencesIn(markdown, 'note')], ['note/stable'])
  assert.deepEqual([...referencesIn('[changed](<app://note/note%2Fstable>)', 'note')], ['note/stable'])
  assert.deepEqual([...referencesIn('[资料 \\[新版\\]](app://note/stable)', 'note')], ['stable'])
  const todos = [{ id: 22, sync_id: 'task-1', description: markdown }, { id: 12, sync_id: 'unrelated', description: '' }]
  assert.deepEqual(relatedTodos({ ...note, title: 'renamed', content: '' }, todos).map(t => t.sync_id), ['task-1'])
})

test('embedded tasks deduplicate backlinks and code samples are not relationships', () => {
  const todo = { id: 1, sync_id: 'task-1', description: '[note](app://note/note-1)' }
  const note = { sync_id: 'note-1', content: '[task](app://todo/task-1)\n\n[task again](app://todo/task-1)' }
  assert.equal(relatedTodos(note, [todo]).length, 1)
  assert.equal(referencesIn('```md\n[task](app://todo/task-1)\n```\n`[task](app://todo/task-2)`', 'todo').size, 0)
  assert.equal(referencesIn('[broken](app://note/%GG)', 'note').size, 0)
})

test('list scopes use exact tags and stable source links, never the current UI filter', async () => {
  const { tasksForScope, todoEmbedSelection } = await import('../../src/utils/todoReferences.js')
  const todos = [{ sync_id: 'one', tags: '工作,计划', description: '[来源](app://note/source)' }, {sync_id:'two',tags:'工作计划',description:''}, {sync_id:'three',tags:'工作',description:'', parent_todo_id:'one'}]
  assert.deepEqual(tasksForScope(todos,'tag/工作').map(t=>t.sync_id),['one'])
  assert.deepEqual(tasksForScope(todos,'note/source').map(t=>t.sync_id),['one'])
  assert.deepEqual(tasksForScope(todos,'all').map(t=>t.sync_id),['one','two'])
  const selection = todoEmbedSelection({kind:'list',reference:'tag/工作 & 生活',content:'项目待办'})
  assert.equal(selection.type,'todoListEmbed')
  assert.deepEqual([...referencesIn(selection.markdown,'todo-list')],['tag/工作 & 生活'])
})

test('AI list insertion refreshes the source note, ordinary task creation does not', async () => {
  const { getEditedNoteIds } = await import('../../src/utils/aiCore/noteRefresh.js')
  assert.deepEqual(getEditedNoteIds({name:'create_todos',args:{source_note_id:'stable-source',embed_in_note:true}}),['stable-source'])
  assert.deepEqual(getEditedNoteIds({name:'create_todos',args:{source_note_id:'stable-source'}}),[])
})

test('note details unify direct references, list scopes and backlinks without duplicates', () => {
  const note = { id: 1, sync_id: 'note-a', content: '[one](app://todo/one)\n[list](app://todo-list/tag%2Fwork)' }
  const todos = [
    { sync_id: 'one', tags: 'work', description: '[source](app://note/note-a)' },
    { sync_id: 'two', tags: 'work' },
    { sync_id: 'child', tags: 'work', parent_todo_id: 'one' },
    { sync_id: 'three', description: '[source](app://note/note-a)' },
  ]
  const result = noteTodoReferences(note, todos)
  assert.deepEqual(result.tasks.map(task => task.sync_id), ['one', 'three', 'two'])
  assert.equal(result.hasReferences, true)
  assert.equal(result.missingCount, 0)
})

test('details indicator follows current references including missing and empty lists', () => {
  assert.equal(noteTodoReferences(null, []).hasReferences, false)
  assert.equal(noteTodoReferences({ content: 'ordinary note' }, []).hasReferences, false)
  const missing = noteTodoReferences({ content: '[gone](app://todo/missing)' }, [])
  assert.equal(missing.hasReferences, true)
  assert.equal(missing.missingCount, 1)
  assert.equal(noteTodoReferences({ content: '[empty](app://todo-list/all)' }, []).hasReferences, true)
  assert.equal(noteTodoReferences({ content: '`[example](app://todo/missing)`' }, []).hasReferences, false)
})
