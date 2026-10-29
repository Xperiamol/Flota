import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTagSuggestions } from '../../src/utils/tagUtils.js'

test('tag suggestions accept arrays and IPC envelopes', () => {
  assert.deepEqual(normalizeTagSuggestions(['工作', '计划']), ['工作', '计划'])
  assert.deepEqual(normalizeTagSuggestions({ success: true, data: ['工作'] }), ['工作'])
  assert.deepEqual(normalizeTagSuggestions({ data: ['计划'] }), ['计划'])
})
test('tag suggestions reject failed, malformed and non-string results', () => {
  for (const value of [null, undefined, {}, '工作', { success: false, data: ['工作'] }, { data: {} }]) {
    assert.deepEqual(normalizeTagSuggestions(value), [])
  }
  assert.deepEqual(normalizeTagSuggestions([' 工作 ', '工作', '', null, 7, { name: '计划' }, '计划']), ['工作', '计划'])
})
