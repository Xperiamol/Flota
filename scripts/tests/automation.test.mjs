import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AutomationScheduler = require('../../electron/services/aichat/AutomationScheduler.js')
const { nextOccurrence } = AutomationScheduler

const memoryDAO = () => { const store = new Map(); return { get: (k) => (store.has(k) ? { value: store.get(k) } : null), set: (k, v) => store.set(k, v) } }
const local = (s) => new Date(s).getTime()

test('next run: daily / weekly / monthly / weekdays skip forward past now; weekdays never land on a weekend', () => {
  const fri8 = local('2026-11-13T08:00') // Friday
  assert.equal(nextOccurrence(fri8, 'daily', local('2026-11-13T09:00')), local('2026-11-14T08:00'))
  assert.equal(nextOccurrence(fri8, 'weekdays', local('2026-11-13T09:00')), local('2026-11-16T08:00'))
  assert.equal(nextOccurrence(local('2026-11-14T08:00'), 'weekdays', local('2026-11-14T07:00')), local('2026-11-16T08:00'), 'a weekend start moves to Monday')
  assert.equal(nextOccurrence(fri8, 'weekly', local('2026-11-13T09:00')), local('2026-11-20T08:00'))
  const jan31 = local('2026-01-31T08:00')
  const feb = nextOccurrence(jan31, 'monthly', local('2026-02-01T00:00'))
  assert.equal(feb, local('2026-02-28T08:00'), 'short month lands on its last day')
  assert.equal(nextOccurrence(feb, 'monthly', local('2026-03-01T00:00'), 31), local('2026-03-31T08:00'), 'returns to the 31st afterwards')
})

test('add validates input with messages the model can act on', () => {
  const s = new AutomationScheduler({ settingDAO: memoryDAO(), runTask: async () => ({}), now: () => local('2026-11-09T10:00') })
  assert.throws(() => s.add({ prompt: 'x', at: '2026-11-10T08:00' }), /需要 title/)
  assert.throws(() => s.add({ title: 't', at: '2026-11-10T08:00' }), /需要 prompt/)
  assert.throws(() => s.add({ title: 't', prompt: 'x', at: '明天' }), /at 需要是时间/)
  assert.throws(() => s.add({ title: 't', prompt: 'x', at: '2026-11-09T08:00' }), /晚于现在/)
  assert.throws(() => s.add({ title: 't', prompt: 'x', at: '2026-11-10T08:00', repeat: 'hourly' }), /repeat 只能是/)
  const daily = s.add({ title: '早间简报', prompt: '整理今天的待办', at: '2026-11-09T08:00', repeat: 'daily' })
  assert.equal(daily.nextRunAt, local('2026-11-10T08:00'), 'a past start for a repeating task rolls to the next occurrence')
  assert.equal(s.list().length, 1)
  assert.equal(s.remove(daily.id), true)
  assert.equal(s.remove(daily.id), false)
})

test('due tasks run once in their own conversation, notify, and advance; one-off tasks disappear after running', async () => {
  let now = local('2026-11-09T07:59')
  const runs = [], notes = []
  const s = new AutomationScheduler({ settingDAO: memoryDAO(), now: () => now, runTask: async (task) => { runs.push(task.id); return { success: true, content: '今天有 3 件事', pendingCards: 1 } }, notify: (task, outcome) => notes.push([task.title, outcome.pendingCards]) })
  const daily = s.add({ title: '早间简报', prompt: 'p', at: '2026-11-09T08:00', repeat: 'daily' })
  const once = s.add({ title: '检查进度', prompt: 'p', at: '2026-11-09T08:00' })
  await s.tick()
  assert.equal(runs.length, 0)
  now = local('2026-11-09T08:00:30')
  await s.tick()
  assert.deepEqual(runs.sort(), [daily.id, once.id].sort())
  assert.equal(notes.length, 2)
  await s.tick()
  assert.equal(runs.length, 2, 'not triggered twice')
  const left = s.list()
  assert.equal(left.length, 1)
  assert.equal(left[0].id, daily.id)
  assert.equal(left[0].nextRunAt, local('2026-11-10T08:00'))
  assert.equal(left[0].lastStatus, 'done')
})

test('runs missed while the app was closed: caught up within 12 hours, skipped beyond that', async () => {
  let now = local('2026-11-09T07:00')
  const runs = []
  const s = new AutomationScheduler({ settingDAO: memoryDAO(), now: () => now, runTask: async (task) => { runs.push(task.title); return { success: true } } })
  s.add({ title: 'recent', prompt: 'p', at: '2026-11-09T08:00', repeat: 'daily' })
  s.add({ title: 'old', prompt: 'p', at: '2026-11-09T08:00' })
  now = local('2026-11-09T15:00')
  await s.tick()
  assert.deepEqual(runs.sort(), ['old', 'recent'])
  runs.length = 0
  now = local('2026-11-11T09:00') // closed for ~2 days
  await s.tick()
  assert.deepEqual(runs, [], 'too old: skipped, not run late')
  assert.equal(s.list()[0].nextRunAt, local('2026-11-12T08:00'))
})

test('a failing run is recorded and still notifies', async () => {
  let now = local('2026-11-09T07:00')
  const notes = []
  const s = new AutomationScheduler({ settingDAO: memoryDAO(), now: () => now, runTask: async () => { throw new Error('网络错误') }, notify: (t, o) => notes.push(o) })
  s.add({ title: 't', prompt: 'p', at: '2026-11-09T08:00', repeat: 'daily' })
  now = local('2026-11-09T08:01')
  await s.tick()
  assert.equal(notes[0].success, false)
  assert.equal(s.list()[0].lastStatus, 'failed')
})

test('tools: schedule / list / cancel via the scheduler; schedule and cancel need confirmation', async () => {
  const { schedule_task, list_scheduled_tasks, cancel_scheduled_task } = require('../../electron/services/aichat/tools/handlers/automation.js')
  const { WRITE_TOOL_NAMES } = require('../../electron/services/aichat/constants.js')
  assert.ok(WRITE_TOOL_NAMES.has('schedule_task') && WRITE_TOOL_NAMES.has('cancel_scheduled_task') && !WRITE_TOOL_NAMES.has('list_scheduled_tasks'))
  const automationScheduler = new AutomationScheduler({ settingDAO: memoryDAO(), runTask: async () => ({}), now: () => local('2026-11-09T10:00') })
  const added = JSON.parse(await schedule_task({ title: '周五复盘', prompt: '回顾本周完成的待办', at: '2026-11-13T17:00', repeat: 'weekly' }, {}, { automationScheduler }))
  assert.equal(added.success, true)
  assert.equal(added.task.repeat, '每周')
  const listed = JSON.parse(await list_scheduled_tasks({}, {}, { automationScheduler }))
  assert.equal(listed.tasks.length, 1)
  assert.equal(JSON.parse(await cancel_scheduled_task({ id: listed.tasks[0].id }, {}, { automationScheduler })).success, true)
  assert.match(JSON.parse(await cancel_scheduled_task({ id: 'nope' }, {}, { automationScheduler })).error, /没有找到/)
  assert.match(JSON.parse(await schedule_task({ title: 'x' }, {}, { automationScheduler })).error, /需要 prompt/)
})
