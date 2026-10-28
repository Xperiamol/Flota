// AI 位置感知：只有真正打开着的笔记才是“当前笔记”。之前在待办页打开 AI，会把最后选中的笔记当成正在看的笔记。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolveContextPolicy } from '../../src/utils/aiCore/contextPolicy.js'
import { applyLocation, getUiLocation, getVisibleNoteId, noteWindowLocation } from '../../src/utils/aiCore/uiLocation.js'
const require = createRequire(import.meta.url)
const { buildContextSection } = require('../../electron/services/aichat/systemPrompt')
const AIChatService = require('../../electron/services/aichat')

// buildContextPackageFromNotes 注入的当前笔记（字段与前端一致）
const injected = () => ({ currentNote: { id: 7, title: '旅行计划', content: '去杭州', note_type: 'markdown' } })
// 与 buildContext 一致：选中笔记 id 为空时不注入笔记
const buildContext = async ({ selectedNoteId, location }) => {
  const policy = resolveContextPolicy({ selectedNoteId, location, scene: location.view === 'ai' ? 'chat_panel' : 'floating_panel' })
  return applyLocation(policy.selectedNoteId == null ? {} : injected(), location)
}

test('只有笔记页正在显示的笔记才算打开；待办、回收站不算', () => {
  assert.equal(getVisibleNoteId({ currentView: 'notes', selectedNoteId: 7 }), 7)
  assert.equal(getVisibleNoteId({ currentView: 'todo', selectedNoteId: 7 }), null)
  assert.equal(getVisibleNoteId({ currentView: 'notes', noteTrashOpen: true, selectedNoteId: 7 }), null)
  assert.deepEqual(getUiLocation({ currentView: 'todo', selectedNoteId: 7 }), { view: 'todo', label: '待办', noteId: null })
  assert.deepEqual(noteWindowLocation(7), { view: 'note-window', label: '独立笔记窗口', noteId: '7' })
})

test('待办页：不注入笔记，提示词说明没有打开笔记', async () => {
  const location = getUiLocation({ currentView: 'todo', selectedNoteId: 7 })
  const pkg = await buildContext({ selectedNoteId: getVisibleNoteId({ currentView: 'todo', selectedNoteId: 7 }), location })
  assert.equal(pkg.currentNote, undefined)
  const prompt = buildContextSection(pkg)
  assert.match(prompt, /待办页面，没有打开任何笔记/)
  assert.doesNotMatch(prompt, /旅行计划|### 当前笔记/)
})

test('笔记页：注入的就是当前笔记', async () => {
  const state = { currentView: 'notes', selectedNoteId: 7 }
  const pkg = await buildContext({ selectedNoteId: 7, location: getUiLocation(state) })
  assert.equal(pkg.currentNote.visible, true)
  const prompt = buildContextSection(pkg)
  assert.match(prompt, /笔记页面，正在查看下面的笔记/)
  assert.match(prompt, /### 当前笔记[\s\S]*旅行计划/)
})

test('AI 页：不注入后台最近查看的笔记', async () => {
  const pkg = await buildContext({ selectedNoteId: 7, location: getUiLocation({ currentView: 'ai', selectedNoteId: 7 }) })
  const prompt = buildContextSection(pkg)
  assert.match(prompt, /AI 助手页面，没有打开任何笔记/)
  assert.equal(pkg.currentNote, undefined)
  assert.doesNotMatch(prompt, /旅行计划|最近查看的笔记/)
})

test('工具读取当前笔记：以请求上下文为准，不再询问主窗口', async () => {
  const fake = {
    noteDAO: { findById: (id) => ({ id, title: `note-${id}` }) },
    _currentNoteGetter: async () => ({ id: 'main-window' }),
    _getLongDocPipeline: () => null,
  }
  const services = (pkg) => AIChatService.prototype._toolServices.call(fake, pkg)
  assert.deepEqual(await services({ currentNote: { id: 7 } }).getCurrentNote(), { id: 7, title: 'note-7' })
  assert.equal(await services({ location: { label: '待办', noteOpen: false } }).getCurrentNote(), null)
  // 没有上下文的调用（其他入口）仍按主窗口正在显示的笔记
  assert.deepEqual(await services(undefined).getCurrentNote(), { id: 'main-window' })
})


test('场景自动选择：日常问答不附待办，安排任务时才取待办', () => {
  const ask = (query, view = 'ai') => resolveContextPolicy({ query, location: getUiLocation({ currentView: view, selectedNoteId: 7 }) })
  assert.equal(ask('介绍一下量子力学').contextEnabled.todos, false)
  assert.equal(ask('帮我安排今天的任务').contextEnabled.todos, true)
  assert.equal(ask('有哪些未完成的？', 'todo').contextEnabled.todos, true)
  assert.equal(ask('你好').contextEnabled.relatedNotes, false)
})

test('笔记和独立画布入口只注入可见且匹配的笔记', () => {
  const build = (selectedNoteId, location, scene = 'floating_panel') => resolveContextPolicy({ selectedNoteId, location, scene })
  assert.equal(build(7, noteWindowLocation(7)).selectedNoteId, '7')
  assert.equal(build(8, noteWindowLocation(7)).selectedNoteId, null)
  assert.equal(build(7, noteWindowLocation(7), 'chat_panel').selectedNoteId, null)
  assert.equal(build(7, getUiLocation({ currentView: 'settings', selectedNoteId: 7 })).selectedNoteId, null)
})
