import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 与 pending-actions 测试相同：直接加载源文件（无依赖的纯函数）
const source = await readFile(new URL('../../src/store/noteReuse.js', import.meta.url), 'utf8')
const { reuseUnchangedNotes, sameNoteRecord, shallowEqualRecord } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const note = (id, extra = {}) => ({ id, title: `t${id}`, content: `c${id}`, tags: ['a'], is_pinned: 0, meta: null, updated_at: '2026-09-28', ...extra })
const clone = (list) => list.map((item) => ({ ...item, tags: [...item.tags] }))

test('数据完全没变时返回原数组', () => {
  const prev = [note(1), note(2)]
  assert.equal(reuseUnchangedNotes(prev, clone(prev)), prev)
})

test('改了一条：返回新数组，只有改动的那条是新对象', () => {
  const prev = [note(1), note(2), note(3)]
  const next = clone(prev); next[1].content = 'changed'
  const merged = reuseUnchangedNotes(prev, next)
  assert.notEqual(merged, prev)
  assert.equal(merged[0], prev[0]); assert.equal(merged[2], prev[2])
  assert.equal(merged[1], next[1])
  assert.deepEqual(merged, next)
})

test('标签变化、新增、删除、排序变化都视为改动', () => {
  const prev = [note(1), note(2)]
  const tagChanged = clone(prev); tagChanged[0].tags = ['a', 'b']
  assert.equal(reuseUnchangedNotes(prev, tagChanged)[0], tagChanged[0])
  const added = [...clone(prev), note(3)]
  assert.deepEqual(reuseUnchangedNotes(prev, added), added)
  const removed = clone(prev).slice(1)
  assert.deepEqual(reuseUnchangedNotes(prev, removed), removed)
  const reordered = clone(prev).reverse()
  const merged = reuseUnchangedNotes(prev, reordered)
  assert.notEqual(merged, prev)
  assert.equal(merged[0], prev[1]); assert.equal(merged[1], prev[0])
})

test('字段集合不同（内存里多了或少了字段）不沿用旧对象', () => {
  assert.equal(sameNoteRecord({ ...note(1), extra: 1 }, note(1)), false)
  assert.equal(sameNoteRecord(note(1), { ...note(1), extra: undefined }), false)
  const prev = [{ ...note(1), localOnly: true }]
  const next = [note(1)]
  assert.equal(reuseUnchangedNotes(prev, next)[0], next[0])
})

test('原列表为空时直接用新列表；计数对象浅比较', () => {
  const next = [note(1)]
  assert.equal(reuseUnchangedNotes([], next), next)
  assert.equal(shallowEqualRecord({ 1: 3 }, { 1: 3 }), true)
  assert.equal(shallowEqualRecord({ 1: 3 }, { 1: 4 }), false)
  assert.equal(shallowEqualRecord({ 1: 3 }, { 1: 3, 2: 0 }), false)
})
