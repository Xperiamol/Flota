// 组件代码片段修改（update_widget 的 edits）：按顺序应用，容忍缩进差异，找不到或不唯一时报错
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { applyPatches } = require('../../electron/services/widgets/codeEdits')

const base = [
  '<!doctype html><html><head>',
  '<script type="application/flota-widget">{"name":"计数器","sizes":["medium"]}</script>',
  '</head><body>',
  '  <button id="add">加一</button>',
  '  <script>',
  "    const price = '$1'",
  '    let count = 0',
  "    document.getElementById('add').onclick = () => { count += 1 }",
  '  </script>',
  '</body></html>',
].join('\n')

test('edits：按顺序应用，容忍缩进差异，$ 原样保留，找不到或不唯一时报错', () => {
  const edits = [
    { search: '    let count = 0', replace: '    let count = 0 // 计数' },
    { search: "document.getElementById('add').onclick = () => { count += 1 }", replace: "    document.getElementById('add').onclick = () => { count += 2; render('$&') }" },
  ]
  const result = applyPatches(base, edits)
  assert.match(result, /let count = 0 \/\/ 计数/)
  assert.match(result, /count \+= 2; render\('\$&'\)/)
  assert.match(result, /const price = '\$1'/)
  assert.match(result, /<button id="add">加一<\/button>/)

  assert.throws(() => applyPatches(base, [{ search: 'let missing = 1', replace: 'x' }]), /第 1 处修改.*找不到/)
  assert.throws(() => applyPatches(`${base}\n${base}`, [{ search: '<button id="add">加一</button>', replace: 'x' }]), /出现了 2 次/)
})
