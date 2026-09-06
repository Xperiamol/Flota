import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 前端为 Vite ESM、仓库默认 CommonJS；用原文件测试纯逻辑，无需引入测试框架。
const source = await readFile(new URL('../../src/utils/aiCore/pendingActions.js', import.meta.url), 'utf8')
const { executeConversationAction, getLatestConfirmableAction, isExplicitPendingActionConfirmation } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const action = { actionId: 'draw-1', name: 'create_whiteboard', args: { prompt: '画图' } }
const initial = () => [{ role: 'assistant', content: '请确认', actions: [{ ...action }] }]
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('快速重复确认只执行一次，完成后旧卡片不能重放', async () => {
  let messages = initial()
  let calls = 0
  const pending = deferred()
  const request = {
    actionId: action.actionId, read: () => messages, write: next => { messages = next },
    execute: () => { calls += 1; return pending.promise },
  }
  const first = executeConversationAction(request)
  assert.equal(await executeConversationAction(request), null)
  pending.resolve({ success: true, message: '已创建' })
  await first
  assert.equal(await executeConversationAction(request), null)
  assert.equal(calls, 1)
  assert.equal(messages[0].actions[0].status, 'done')
  assert.equal(messages.filter(m => m.content === '已创建').length, 1)
})

test('切换会话后仍写回原会话，并保留执行期间的新消息', async () => {
  const conversations = { a: initial(), b: [{ role: 'user', content: '另一会话' }] }
  let activeId = 'a'
  const origin = activeId
  const pending = deferred()
  const task = executeConversationAction({
    actionId: action.actionId,
    read: () => conversations[origin], write: next => { conversations[origin] = next },
    execute: () => pending.promise,
  })
  activeId = 'b'
  conversations.a.push({ role: 'user', content: '后续要求' })
  pending.resolve({ success: true, message: '完成' })
  await task
  assert.deepEqual(conversations[activeId], [{ role: 'user', content: '另一会话' }])
  assert.equal(conversations.a[1].content, '后续要求')
  assert.equal(conversations.a[2].content, '完成')
})

test('执行失败标记失败；删除会话后不恢复会话', async () => {
  let messages = initial()
  await executeConversationAction({
    actionId: action.actionId, read: () => messages, write: next => { messages = next },
    execute: async () => { throw new Error('生成失败') },
  })
  assert.equal(messages[0].actions[0].status, 'failed')
  assert.match(messages[1].content, /生成失败/)
  messages = initial()
  const pending = deferred()
  const task = executeConversationAction({
    actionId: action.actionId, read: () => messages, write: next => { messages = next },
    execute: () => pending.promise,
  })
  messages = undefined
  pending.resolve({ success: true, message: '完成' })
  await task
  assert.equal(messages, undefined)
})

test('文字确认只接受紧邻的唯一普通卡片，不越过新话题或忽略批量勾选', () => {
  assert.equal(getLatestConfirmableAction(initial()).actionId, action.actionId)
  for (const name of ['create_todos', 'edit_notes']) {
    assert.equal(getLatestConfirmableAction([{ role: 'assistant', actions: [{ ...action, name }] }]), null)
  }
  assert.equal(getLatestConfirmableAction([...initial(), { role: 'user', content: '新话题' }]), null)
  assert.equal(getLatestConfirmableAction([...initial(), { role: 'assistant', content: '另一提议' }]), null)
  assert.equal(getLatestConfirmableAction([{ role: 'assistant', actions: [action, { ...action, actionId: 'second' }] }]), null)
  assert.equal(getLatestConfirmableAction([{ role: 'assistant', toolCalls: [{ action }] }]).actionId, action.actionId)
  assert.equal(isExplicitPendingActionConfirmation('可以！'), true)
  assert.equal(isExplicitPendingActionConfirmation('可以，但改成蓝色'), false)
})
