// 确认卡：状态迁移由主进程的会话服务负责（所有窗口同步），渲染层只读取和展示。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

// 渲染层是 Vite ESM、仓库默认 CommonJS；用原文件测试纯逻辑，无需引入测试框架。
const source = await readFile(new URL('../../src/utils/aiCore/pendingActions.js', import.meta.url), 'utf8')
const { getDisplayMessages, getLatestConfirmableActions, isExplicitPendingActionConfirmation, stripInternalActionAnnotations } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const require = createRequire(import.meta.url)
const ConversationSessions = require('../../electron/services/aichat/sessions/ConversationSessions')
const { supersedeStalePendingActions } = require('../../electron/services/aichat/sessions/messageModel')

const action = { actionId: 'draw-1', name: 'create_whiteboard', args: { prompt: '画图' } }
const initial = () => [{ role: 'assistant', content: '请确认', actions: [{ ...action }] }]

// 只带确认卡相关能力的会话服务（内存数据库）
const sessionsWith = (messages = initial()) => {
  const rows = new Map([['c', { id: 'c', title: '', source: 'general', messages: structuredClone(messages), transcript: [] }]])
  const dao = {
    rows,
    getById: (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
    saveSession: (id, { messages: next, transcript }) => {
      if (!rows.has(id)) return null
      rows.set(id, { ...rows.get(id), messages: structuredClone(next), ...(transcript !== undefined ? { transcript } : {}) })
      return structuredClone(rows.get(id))
    },
  }
  const aiService = { getConfig: async () => ({ success: true, data: { provider: 'custom', model: 'm', apiUrl: 'https://t.test/v1' } }), normalizeApiUrl: v => v }
  const sessions = new ConversationSessions({ dao, aiChatService: {}, aiService, broadcast: () => {} })
  const card = () => dao.rows.get('c')?.messages.flatMap(m => m.actions || []).find(a => a.actionId === action.actionId)
  return { sessions, dao, card }
}

test('同一张卡只执行一次（多个窗口同时点确认也一样），完成后不能重放', async () => {
  const { sessions, card, dao } = sessionsWith()
  assert.equal(sessions.beginAction('c', action.actionId).success, true)
  assert.equal(card().status, 'running')
  assert.equal(sessions.beginAction('c', action.actionId).success, false)
  await sessions.finishAction('c', action.actionId, { success: true, message: '已创建' })
  assert.equal(card().status, 'done')
  assert.equal(sessions.beginAction('c', action.actionId).success, false)
  assert.equal(dao.rows.get('c').messages.filter(m => m.content === '已创建').length, 1)
})

test('执行期间新增的消息保留；执行中会话被删除时不把它写回来', async () => {
  const { sessions, dao } = sessionsWith()
  sessions.beginAction('c', action.actionId)
  dao.rows.get('c').messages.push({ role: 'user', content: '后续要求' })
  await sessions.finishAction('c', action.actionId, { success: true, message: '完成' })
  assert.deepEqual(dao.rows.get('c').messages.slice(1).map(m => m.content), ['后续要求', '完成'])

  const other = sessionsWith()
  other.sessions.beginAction('c', action.actionId)
  other.dao.rows.delete('c')
  assert.equal((await other.sessions.finishAction('c', action.actionId, { success: true, message: '完成' })).success, false)
  assert.equal(other.dao.rows.has('c'), false)
})

test('失败标记失败并保留原因；失败或停止后可以重试，成功后记录结果笔记 id', async () => {
  const { sessions, card, dao } = sessionsWith()
  sessions.beginAction('c', action.actionId)
  await sessions.finishAction('c', action.actionId, { success: false, error: '网络错误', message: '操作失败：网络错误' })
  assert.equal(card().status, 'failed')
  assert.equal(card().error, '网络错误')
  assert.equal(dao.rows.get('c').messages.length, 1, '失败不追加结果消息')

  assert.equal(sessions.beginAction('c', action.actionId).success, true)
  await sessions.finishAction('c', action.actionId, { success: false, cancelled: true, message: '已停止生成' })
  assert.equal(card().status, 'cancelled')

  assert.equal(sessions.beginAction('c', action.actionId).success, true)
  assert.equal(card().error, undefined)
  await sessions.finishAction('c', action.actionId, { success: true, message: '已创建', resultNoteId: 42 })
  assert.equal(card().status, 'done')
  assert.equal(card().resultNoteId, 42)
})

test('忽略只作用于待确认卡片；忽略后不能执行或文字确认；误触可恢复，其它状态不可恢复', () => {
  const { sessions, card, dao } = sessionsWith()
  assert.equal(sessions.restoreAction('c', action.actionId).success, false)
  assert.equal(sessions.dismissAction('c', action.actionId).success, true)
  assert.equal(card().status, 'dismissed')
  assert.equal(sessions.dismissAction('c', action.actionId).success, false)
  assert.deepEqual(getLatestConfirmableActions(dao.rows.get('c').messages), [])
  assert.equal(sessions.beginAction('c', action.actionId).success, false)

  assert.equal(sessions.restoreAction('c', action.actionId).success, true)
  assert.equal(card().status, 'pending')
  assert.equal(getLatestConfirmableActions(dao.rows.get('c').messages)[0].actionId, action.actionId)

  const superseded = sessionsWith([{ role: 'assistant', actions: [{ ...action, status: 'superseded' }] }])
  assert.equal(superseded.sessions.restoreAction('c', action.actionId).success, false)
})

test('旧会话里挂在 toolCalls[].action 上的卡片也能执行', async () => {
  const { sessions, dao } = sessionsWith([{ role: 'assistant', content: '请确认', toolCalls: [{ name: 'create_whiteboard', action: { ...action } }] }])
  assert.equal(sessions.beginAction('c', action.actionId).success, true)
  await sessions.finishAction('c', action.actionId, { success: true, message: '已创建' })
  assert.equal(dao.rows.get('c').messages[0].toolCalls[0].action.status, 'done')
})

test('AI 给出新方案时旧的待确认卡片被替代，已完成的不受影响', () => {
  const done = { ...action, actionId: 'old-done', status: 'done' }
  const stale = { ...action, actionId: 'old-pending' }
  const fresh = { ...action, actionId: 'new-pending' }
  const messages = [
    { role: 'assistant', actions: [done] },
    { role: 'assistant', toolCalls: [{ action: stale }], actions: [stale] },
    { role: 'user', content: '改一下' },
    { role: 'assistant', actions: [fresh] },
  ]
  const next = supersedeStalePendingActions(messages)
  assert.equal(next[0].actions[0].status, 'done')
  assert.equal(next[1].actions[0].status, 'superseded')
  assert.equal(next[1].toolCalls[0].action.status, 'superseded')
  assert.equal(next[3].actions[0].status, undefined)
  const plain = [...messages.slice(0, 3), { role: 'assistant', content: '好的' }]
  assert.equal(supersedeStalePendingActions(plain), plain)
})

test('文字确认只接受紧邻的普通卡片，不越过新话题或忽略批量勾选', () => {
  assert.equal(getLatestConfirmableActions(initial())[0].actionId, action.actionId)
  for (const name of ['create_todos', 'edit_notes']) {
    assert.deepEqual(getLatestConfirmableActions([{ role: 'assistant', actions: [{ ...action, name }] }]), [])
    // 含批量卡时整体放弃，避免部分执行
    assert.deepEqual(getLatestConfirmableActions([{ role: 'assistant', actions: [{ ...action }, { ...action, actionId: 'batch', name }] }]), [])
  }
  assert.deepEqual(getLatestConfirmableActions([...initial(), { role: 'user', content: '新话题' }]), [])
  assert.deepEqual(getLatestConfirmableActions([...initial(), { role: 'assistant', content: '另一提议' }]), [])
  assert.deepEqual(
    getLatestConfirmableActions([{ role: 'assistant', actions: [action, { ...action, actionId: 'second' }] }]).map(a => a.actionId),
    [action.actionId, 'second']
  )
  assert.deepEqual(
    getLatestConfirmableActions([{ role: 'assistant', actions: [{ ...action, status: 'done' }, { ...action, actionId: 'second' }] }]).map(a => a.actionId),
    ['second']
  )
  assert.equal(getLatestConfirmableActions([{ role: 'assistant', toolCalls: [{ action }] }])[0].actionId, action.actionId)
  assert.equal(isExplicitPendingActionConfirmation('可以！'), true)
  assert.equal(isExplicitPendingActionConfirmation('可以，但改成蓝色'), false)
})

test('旧回复里的内部执行注释显示时去掉，但不删除正常方括号内容', () => {
  const raw = '请确认。\n[本条回复实际生成的确认卡：创建画布（failed）]\n其他说明 [NTU]'
  assert.equal(stripInternalActionAnnotations(raw), '请确认。\n\n其他说明 [NTU]')
})

test('卡片已显示的执行结果不再重复显示一条气泡', () => {
  const messages = [{ role: 'assistant', content: '已准备好', actions: [{ actionId: 'a', status: 'done', resultMessage: '已更新画布' }] }, { role: 'assistant', content: '已更新画布', actionResultFor: 'a' }]
  assert.equal(getDisplayMessages(messages).length, 1)
  assert.equal(getDisplayMessages([messages[1]]).length, 1)
  assert.equal(getDisplayMessages([messages[0], { ...messages[1], content: '额外说明' }]).length, 2)
})
