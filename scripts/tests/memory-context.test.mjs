import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { enrichContextPackageWithMemories } = createRequire(import.meta.url)('../../electron/services/aichat/memoryContext')
test('unrelated general questions do not recall private episodic context', async () => {
  let calls = 0
  const service = { isAvailable: () => true, searchMemories: async () => { calls++; return [] } }
  const result = await enrichContextPackageWithMemories({ memories: [{ content: 'old' }] }, service, { query: '解释一下量子计算', scene: 'chat_panel' })
  assert.equal(calls, 0)
  assert.equal(result.memories, undefined)
})
test('personal references recall stable relevant layers when needed', async () => {
  let request
  const service = { isAvailable: () => true, searchMemories: async (_id, query, options) => { request = { query, options }; return [{ content: '用户偏好简洁' }] } }
  const result = await enrichContextPackageWithMemories({}, service, { query: '你记得我的偏好吗', scene: 'chat_panel' })
  assert.equal(result.memories.length, 1)
  assert.ok(!request.options.layers.includes('episodic'))
})
