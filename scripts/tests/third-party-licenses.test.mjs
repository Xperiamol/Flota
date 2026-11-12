// 第三方许可清单：由生产依赖自动生成；新增依赖若只能按 GPL 等强 Copyleft 许可使用，这里会失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// 可直接随闭源应用分发的许可证（MPL-2.0 为文件级 Copyleft，未修改其源码时可用；CC-BY-4.0 仅要求署名，用于 caniuse 数据）
const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense', 'CC0-1.0',
  'Zlib', 'WTFPL', 'BlueOak-1.0.0', 'Python-2.0', 'MPL-2.0', 'CC-BY-4.0'])
const permitted = (license) => license.split(/\s+OR\s+/).some((choice) => choice.split(/\s+AND\s+/).every((part) => ALLOWED.has(part.trim())))

test('生成的许可清单覆盖生产依赖，许可证均可随应用分发', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/generate-third-party-licenses.cjs')], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const { packages } = JSON.parse(fs.readFileSync(path.join(root, 'src/generated/third-party-licenses.json'), 'utf8'))
  assert.ok(packages.length > 100)

  const find = (name) => packages.find((item) => item.name === name)
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  for (const name of Object.keys(rootPackage.optionalDependencies || {})) {
    if (fs.existsSync(path.join(root, 'node_modules', name, 'package.json'))) {
      assert.ok(find(name)?.text.length > 100, `${name} 可选运行时依赖缺少许可声明`)
    }
  }
  for (const [name, license] of [['pdfjs-dist', 'Apache-2.0'], ['xlsx', 'Apache-2.0'], ['mammoth', 'BSD-2-Clause'], ['cfb', 'Apache-2.0'], ['word-extractor', 'MIT'], ['turndown', 'MIT']]) {
    const item = find(name)
    assert.ok(item, `${name} 不在清单中`)
    assert.equal(item.license, license, name)
    assert.ok(item.text.length > 100, `${name} 缺少许可证全文`)
  }
  // 原生库的第三方声明（sharp 附带的 libvips 含 LGPLv3 组件）
  const sharp = find('sharp')
  if (sharp) assert.match(sharp.text, /libvips\s*\|\s*LGPLv3/)
  // 构建工具与 devDependencies 不随应用发布，不应出现
  assert.equal(find('vite'), undefined)
  assert.equal(find('@babel/core'), undefined)
  assert.equal(find('electron-builder'), undefined)

  assert.deepEqual(packages.filter((item) => item.license === 'UNKNOWN').map((item) => item.name), [])
  assert.deepEqual(packages.filter((item) => !permitted(item.license)).map((item) => `${item.name}@${item.version} ${item.license}`), [])

  const notices = fs.readFileSync(path.join(root, 'build/THIRD_PARTY_NOTICES.txt'), 'utf8')
  assert.match(notices, /pdfjs-dist [\d.]+\nLicense: Apache-2\.0/)
})
