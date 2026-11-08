import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AIChatService = require('../../electron/services/aichat/index.js')
const PendingActionStore = require('../../electron/services/aichat/PendingActionStore')

const setup = () => {
  const svc = Object.create(AIChatService.prototype)
  svc.logger = { warn() {}, info() {}, error() {} }
  svc._documentDrafts = new Map()
  svc._pendingActions = new PendingActionStore({})
  const notes = []
  svc.noteDAO = { create: (n) => { const note = { id: notes.length + 1, ...n }; notes.push(note); return note } }
  svc._toolServices = () => ({ noteDAO: svc.noteDAO })
  svc._notifyNotesChanged = () => {}
  return { svc, notes }
}
const call = async (svc, args, options = {}) => JSON.parse(await svc._executeTool('write_document', args, options))

test('write_document: the agent appends parts itself; finishing produces one save card with the whole text', async () => {
  const { svc, notes } = setup()
  const first = await call(svc, { title: '个人知识管理入门', content: '# 个人知识管理入门\n\n## 为什么记笔记\n第一章正文。' })
  assert.equal(first.success, true)
  assert.ok(first.doc_id)
  assert.deepEqual(first.headings, ['# 个人知识管理入门', '## 为什么记笔记'])
  const second = await call(svc, { doc_id: first.doc_id, content: '## 如何建立体系\n第二章正文。' })
  assert.equal(second.parts, 2)
  assert.equal(notes.length, 0, 'nothing is saved while writing')
  const done = await call(svc, { doc_id: first.doc_id, content: '## 常见误区\n第三章正文。', finished: true })
  assert.equal(done.requiresConfirmation, true)
  assert.equal(done.name, 'save_document')
  assert.match(done.args.content, /第一章正文。\n\n## 如何建立体系\n第二章正文。\n\n## 常见误区/)
  assert.equal(done.args.headings.length, 4)
  assert.equal(done.confirmationHint, undefined)
  // confirm → saved as a note
  const action = svc._pendingActions.take(done.actionId)
  const saved = JSON.parse(await svc._executeTool('save_document', action.args, { requireConfirmation: false }))
  assert.equal(saved.success, true)
  assert.equal(notes[0].title, '个人知识管理入门')
  assert.match(notes[0].content, /常见误区/)
})

test('write_document: helpful errors for empty content, missing title, unknown doc; finished draft cannot be appended again', async () => {
  const { svc } = setup()
  assert.match((await call(svc, { content: '  ' })).error, /content 不能为空/)
  assert.match((await call(svc, { content: '正文' })).error, /需要 title/)
  assert.match((await call(svc, { doc_id: 'doc_x', content: '正文' })).error, /找不到文档 doc_x/)
  const first = await call(svc, { title: 't', content: 'a', finished: true })
  assert.equal(first.requiresConfirmation, true)
  assert.match((await call(svc, { doc_id: first.doc_id, content: 'b' })).error, /找不到文档/)
})

test('write_document without confirmation (e.g. automations) saves directly', async () => {
  const { svc, notes } = setup()
  const res = await call(svc, { title: '晨报', content: '今天三件事', finished: true }, { requireConfirmation: false })
  assert.equal(res.success, true)
  assert.equal(notes.length, 1)
})

test('old long-document cards explain the change instead of failing silently', async () => {
  const { write_long_document } = require('../../electron/services/aichat/tools/handlers/documents.js')
  assert.match(JSON.parse(await write_long_document()).error, /改为由 AI 直接分段写作/)
})
