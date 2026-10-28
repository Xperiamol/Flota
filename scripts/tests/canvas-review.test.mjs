import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const parser = await readFile(new URL('../../src/utils/diagrams/structuredOutput.js', import.meta.url), 'utf8')
let source = await readFile(new URL('../../src/utils/diagrams/visualReview.js', import.meta.url), 'utf8')
source = source.replace("import { parseStructuredOutput } from './structuredOutput'", parser.replace('export const', 'const'))
source = source.replace("await import('@excalidraw/excalidraw')", "{ exportToBlob: async () => ({}) }")
const { parseCanvasReview, reviewCanvas } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('review parsing accepts fenced JSON and empty legacy arrays; malformed output has a readable error', () => {
  assert.deepEqual(parseCanvasReview('```json\n{"issues":["标签遮挡"]}\n```'), ['标签遮挡'])
  assert.deepEqual(parseCanvasReview('[]'), [])
  for (const content of ['{"issues":["坏JSON" "缺逗号"]}', '{"issues":null}', '{"issues":[{}]}']) assert.throws(() => parseCanvasReview(content), /^Error: 视觉复核返回格式不正确$/)
})

test('malformed review is repaired once as text; repair failure is bounded', async () => {
  const previousWindow = globalThis.window, previousReader = globalThis.FileReader
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,test'; this.onload() } }
  try {
    for (const repairOK of [true, false]) {
      const calls = []
      globalThis.window = { electronAPI: { ai: {
        getConfig: async () => ({ data: { visionEnabled: true } }),
        chat: async messages => { calls.push(messages); return { success: true, data: { content: calls.length === 1 || !repairOK ? 'bad json' : '{"issues":["调整间距"]}' } } },
      } } }
      if (repairOK) assert.deepEqual(await reviewCanvas({ elements: [] }, '流程图'), ['调整间距'])
      else await assert.rejects(reviewCanvas({ elements: [] }, '流程图'), /视觉复核返回格式不正确/)
      assert.equal(calls.length, 2)
      assert.equal(typeof calls[1][1].content, 'string')
      assert.ok(!JSON.stringify(calls[1]).includes('image_url'))
    }
  } finally { globalThis.window = previousWindow; globalThis.FileReader = previousReader }
})
