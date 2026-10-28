import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { read_note, search_notes } = createRequire(import.meta.url)('../../electron/services/aichat/tools/handlers/notes')

test('search labels its truncated previews; ID-based pagination reconstructs a long single-line note exactly', async () => {
  const content = '中文段落🙂'.repeat(12000)
  const note = { id: 7, title: '长文', content }
  const services = { noteDAO: { findById: id => id === 7 ? note : null, findAll: () => ({ notes: [note] }) } }
  const [found] = JSON.parse(await search_notes({ query: '长文' }, {}, services))
  assert.equal(found.has_more, true)
  assert.equal(found.total_chars, content.length)
  let offset = 0, rebuilt = '', pages = 0
  do {
    const page = JSON.parse(await read_note({ id: found.id, offset, limit: 1001 }, {}, services))
    rebuilt += page.content; offset = page.next_offset; pages++
    if (page.has_more) assert.ok(offset > page.offset)
    assert.ok(!/[\uD800-\uDBFF]$/.test(page.content))
  } while (offset != null)
  assert.equal(rebuilt, content)
  assert.ok(pages > 4)
})

test('missing/deleted notes and invalid offsets give explicit results instead of another current note', async () => {
  for (const note of [null, { is_deleted: true, content: 'deleted' }]) {
    const result = JSON.parse(await read_note({ id: 7 }, {}, { noteDAO: { findById: () => note } }))
    assert.equal(result.success, false)
  }
  const services = { noteDAO: { findById: () => ({ id: 7, content: 'abc' }) } }
  assert.equal(JSON.parse(await read_note({ id: 7, offset: 999 }, {}, services)).success, false)
  assert.equal(JSON.parse(await read_note({ id: 7, offset: 3 }, {}, services)).has_more, false)
})
