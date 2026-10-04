// 清理"无人引用的图片"前的引用判断：各种写法都要认出来，宁可少删不可误删
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { collectReferencedImageNames, isImageReferenced } = require('../../electron/services/imageReferences.js')

test('各种图片写法都算引用', () => {
  const index = collectReferencedImageNames([
    '![](<images/1700_ab.png>) ![a](images/1701_cd.jpg "标题")',
    '<img src="app://images/1702_ef.webp" width="300">',
    '![](images/paste\\(1\\).png) ![](images/my%20photo.png) ![](images/1704\\_x.png)',
    JSON.stringify({ type: 'excalidraw', fileMap: { f1: { fileName: '1703_gh.png' }, f2: '1705_ij.PNG' } }),
    '---\ncover: images/1706_kl.jpeg\n---\n正文',
  ])
  for (const name of ['1700_ab.png', '1701_cd.jpg', '1702_ef.webp', 'paste(1).png', 'my photo.png', '1704_x.png', '1703_gh.png', '1705_ij.png', '1706_kl.jpeg']) {
    assert.ok(isImageReferenced(name, index), `${name} 应算作被引用`)
  }
})

test('正文里没出现的图片才算孤儿', () => {
  const index = collectReferencedImageNames(['![](images/1700_ab.png)', null, ''])
  assert.equal(isImageReferenced('1799_zz.png', index), false)
  assert.equal(isImageReferenced('other photo.png', index), false)
})
