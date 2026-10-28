import test from 'node:test'
import assert from 'node:assert/strict'
import { searchSettings, SETTINGS_SEARCH_ITEMS } from '../../src/components/settings/settingsSearchIndex.js'
import { SETTINGS_CATEGORY_NAMES } from '../../src/components/settings/settingsCategories.js'

test('search covers every settings category without duplicate ids or nonexistent tabs', () => {
  assert.equal(new Set(SETTINGS_SEARCH_ITEMS.map(item => item.id)).size, SETTINGS_SEARCH_ITEMS.length)
  for (const [id, name] of Object.entries(SETTINGS_CATEGORY_NAMES)) assert.ok(searchSettings(name).some(item => item.tab === Number(id)), name)
  assert.ok(SETTINGS_SEARCH_ITEMS.every(item => SETTINGS_CATEGORY_NAMES[item.tab]))
})

test('user-facing aliases find settings across categories and rank exact matches first', () => {
  for (const [query, label] of [['历史版本', '自动保存历史快照'], ['本地模型', '本机离线'], ['阅读时间', '显示阅读时长'], ['皮革', '背景'], ['隐身', '隐藏模式'], ['proxy', '网络代理'], ['keyboard shortcut', '快捷键']]) {
    assert.ok(searchSettings(query).some(item => item.label === label), query)
  }
  assert.equal(searchSettings('显示字数')[0].label, '显示字数')
  assert.equal(searchSettings('  WEBDAV  ')[0].tab, 6)
})

test('empty and unmatched queries have no results', () => {
  assert.deepEqual(searchSettings('  '), [])
  assert.deepEqual(searchSettings('不存在的设置xyz123'), [])
})
