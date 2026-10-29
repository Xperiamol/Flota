import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionAfterRemoval } from '../../src/utils/noteSelection.js'
test('deletion chooses a surviving neighbor and preserves unrelated selection', () => {
  const notes = [1,2,3,4].map(id => ({id}))
  assert.equal(selectionAfterRemoval(notes, 2, [2]), 3)
  assert.equal(selectionAfterRemoval(notes, 4, [4]), 3)
  assert.equal(selectionAfterRemoval(notes, 2, [1,2,3]), 4)
  assert.equal(selectionAfterRemoval(notes, 2, [1,2,3,4]), null)
  assert.equal(selectionAfterRemoval(notes, 2, [3]), 2)
  assert.equal(selectionAfterRemoval(notes, 2, [2], 1), 1)
  assert.equal(selectionAfterRemoval(notes, 2, [2], null), null)
  assert.equal(selectionAfterRemoval(notes, 2, [2], 99), 3)
})
