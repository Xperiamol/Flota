// 组件运行时的纯函数测试：清单解析、文档组装、AI 输出中的 HTML 提取、运行时资源读取
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const { parseManifest, writeManifest } = require(path.join(root, 'electron/services/widgets/manifest.js'))
const { buildWidgetDocument, readRuntimeAsset, LIB_FILES } = require(path.join(root, 'electron/services/widgets/runtime.js'))
const WidgetGenerator = require(path.join(root, 'electron/services/widgets/WidgetGenerator.js'))

const withManifest = (manifest, body = '<div id="app"></div>') =>
  `<!doctype html><html><head><script type="application/flota-widget">${JSON.stringify(manifest)}</script></head><body>${body}</body></html>`

test('清单：过滤非法的库、权限与 imports', () => {
  const { manifest, found, error } = parseManifest(withManifest({
    name: '测试', libs: ['preact', 'jquery'], permissions: ['notes:read', 'fs:write'], imports: ['w1.books', 'bad'], sizes: ['full', 'huge'],
  }))
  assert.equal(found, true)
  assert.equal(error, null)
  assert.deepEqual(manifest.libs, ['preact'])
  assert.deepEqual(manifest.permissions, ['notes:read'])
  assert.deepEqual(manifest.imports, ['w1.books'])
  assert.deepEqual(manifest.sizes, ['full'])
})

test('清单：缺失时给默认值，JSON 错误时报错', () => {
  assert.equal(parseManifest('<html></html>').found, false)
  assert.equal(parseManifest('<html></html>').manifest.name, '未命名组件')
  const broken = parseManifest('<script type="application/flota-widget">{oops</script>')
  assert.match(broken.error, /不是合法 JSON/)
})

test('清单：写回时替换已有清单块', () => {
  const html = writeManifest(withManifest({ name: '旧' }), { name: '新' })
  assert.equal(parseManifest(html).manifest.name, '新')
  assert.equal((html.match(/application\/flota-widget/g) || []).length, 1)
})

test('文档组装：注入主题、SDK 与声明的库，库带 crossorigin', () => {
  const doc = buildWidgetDocument(withManifest({ name: 'x', libs: ['preact', 'chart.js'] }), new URLSearchParams('theme=dark&size=full&primary=%23ff0000'))
  assert.match(doc, /<html data-theme="dark" data-size="full">/)
  assert.match(doc, /--fl-primary:#ff0000/)
  assert.match(doc, /widget-runtime\/sdk\.js" crossorigin="anonymous"/)
  assert.match(doc, /lib\/preact\.js" crossorigin="anonymous"/)
  assert.match(doc, /lib\/chart\.js\.js" crossorigin="anonymous"/)
  assert.doesNotMatch(doc, /lib\/dayjs/)
})

test('文档组装：片段也能包成完整文档，非法主色回退默认值', () => {
  const doc = buildWidgetDocument('<p>hi</p>', new URLSearchParams('primary=red;background:url(x)'))
  assert.match(doc, /^<!doctype html>/)
  assert.match(doc, /--fl-primary:#1976d2/)
  assert.match(doc, /<body>\n<p>hi<\/p>/)
})

test('运行时资源：库文件存在，拒绝未知路径', () => {
  for (const name of Object.keys(LIB_FILES)) {
    assert.ok(readRuntimeAsset(`lib/${name}.js`)?.body.length > 0, name)
  }
  assert.ok(readRuntimeAsset('sdk.js').body.length > 0)
  assert.equal(readRuntimeAsset('../main.js'), null)
  assert.equal(readRuntimeAsset('lib/unknown.js'), null)
})

test('HTML 提取：代码块、裸 HTML、缺失', () => {
  assert.equal(WidgetGenerator.extractHtml('说明\n```html\n<!doctype html><html><body>a</body></html>\n```'), '<!doctype html><html><body>a</body></html>')
  assert.equal(WidgetGenerator.extractHtml('<html><body>b</body></html>'), '<html><body>b</body></html>')
  assert.equal(WidgetGenerator.extractHtml('没有代码'), null)
})

test('商店组件的清单都合法，且注册表条目都能找到文件', () => {
  const dir = 'plugins/widgets'
  const files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.html'))
  assert.ok(files.length > 0)
  for (const file of files) {
    const { found, error, manifest } = parseManifest(fs.readFileSync(path.join(root, dir, file), 'utf8'))
    assert.ok(found && !error, `${dir}/${file}`)
    assert.ok(manifest.libs.length > 0, `${file} 应声明使用的库`)
    assert.ok(manifest.help, `${file} 应提供使用说明`)
  }
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'plugins/registry.json'), 'utf8'))
  const entries = (registry.plugins || registry).filter((entry) => entry.type === 'widget')
  assert.ok(entries.length > 0)
  for (const entry of entries) {
    const file = path.basename(entry.source?.path || entry.source?.file || entry.path || '')
    assert.ok(files.includes(file), `${entry.id} 指向的文件不存在：${file}`)
  }
})

test('组件图标：SDK 文档、图标集与商店组件使用同一套名字', () => {
  const iconsSource = fs.readFileSync(path.join(root, 'src/components/widgets/widgetIcons.jsx'), 'utf8')
  const block = iconsSource.slice(iconsSource.indexOf('export const WIDGET_ICONS = {'), iconsSource.indexOf('}', iconsSource.indexOf('export const WIDGET_ICONS = {')))
  const names = [...block.matchAll(/^\s+(\w+):/gm)].map((match) => match[1])
  const docSource = fs.readFileSync(path.join(root, 'electron/services/widgets/sdkDoc.js'), 'utf8')
  const docLine = docSource.split('\n').find((line) => line.includes('icon 从这些名字里选'))
  const docNames = [...docLine.matchAll(/([a-z]+)（/g)].map((match) => match[1])
  assert.deepEqual([...docNames].sort(), [...names].sort())
  for (const file of fs.readdirSync(path.join(root, 'plugins/widgets')).filter((f) => f.endsWith('.html'))) {
    const { manifest } = parseManifest(fs.readFileSync(path.join(root, 'plugins/widgets', file), 'utf8'))
    assert.ok(names.includes(manifest.icon), `${file} 的图标 ${manifest.icon} 不在图标集中`)
  }
})
