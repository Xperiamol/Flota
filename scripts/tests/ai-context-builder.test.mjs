import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'

const bundled = await build({ entryPoints: ['src/utils/aiCore/contextBuilder.js'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' })
const calls = []
const sandbox = { module: { exports: {} }, window: { electronAPI: { todos: { getAll: async () => { calls.push('todos'); return [] } } } } }
vm.runInNewContext(bundled.outputFiles[0].text, sandbox)
const { buildContext } = sandbox.module.exports
const notes = [
  { id: 7, title: '睡眠与记忆', content: '后台笔记正文不应污染普通聊天', tags: ['睡眠'] },
  { id: 8, title: '咖啡研磨指南', content: '手冲咖啡的研磨方法和水温', tags: ['咖啡'] },
]

test('real builder excludes the last selected note and todos for unrelated general chat', async () => {
  calls.length = 0
  const pkg = await buildContext({ notes, selectedNoteId: 7, query: '你好，介绍一下你自己', scene: 'chat_panel', location: { view: 'ai', label: 'AI 助手', noteId: null } })
  assert.equal(pkg.currentNote, undefined)
  assert.equal(pkg.relatedNotes, undefined)
  assert.equal(calls.length, 0)
})

test('related-note retrieval is based on the actual question, not the last opened note', async () => {
  const pkg = await buildContext({ notes, selectedNoteId: 7, query: '从我的笔记里找咖啡研磨方法', scene: 'chat_panel', location: { view: 'ai', noteId: null } })
  assert.equal(pkg.currentNote, undefined)
  assert.ok(pkg.relatedNotes?.some(note => note.id === 8))
  assert.ok(!pkg.relatedNotes?.some(note => note.id === 7))
})

test('note-window requests retain full current content; task questions fetch todos', async () => {
  calls.length = 0
  const pkg = await buildContext({ notes, selectedNoteId: 7, query: '总结这篇文章', scene: 'floating_panel', location: { view: 'note-window', noteId: '7' } })
  assert.equal(pkg.currentNote.content, notes[0].content)
  assert.equal(pkg.currentNote.visible, true)
  assert.equal(calls.length, 0)
  await buildContext({ notes, selectedNoteId: 7, query: '安排今天的任务', scene: 'chat_panel', location: { view: 'ai', noteId: null } })
  assert.equal(calls.length, 1)
})


test('generic planning and knowledge questions do not pull private notes or tasks', async () => {
  calls.length = 0
  for (const query of ['解释什么是项目计划', '帮我规划一门新课程', '截止日期是什么意思', '咖啡研磨怎么做']) {
    const pkg = await buildContext({ notes, selectedNoteId: 7, query, location: { view: 'ai', noteId: null } })
    assert.equal(pkg.relatedNotes, undefined)
    assert.equal(pkg.todayTodos, undefined)
  }
  assert.equal(calls.length, 0)
})
