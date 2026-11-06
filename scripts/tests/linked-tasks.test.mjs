import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 纯函数模块，直接按源码加载
const source = await readFile(new URL('../../src/utils/linkedTasks.js', import.meta.url), 'utf8')
const {
  linkedTaskLabel, parseLinkedLabel, listTaskLines, promoteTasksInMarkdown, countPromotableTasks, todoReferenceFromHref,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('关联任务的文字可以带方括号，写进去再读回来不变', () => {
  const label = linkedTaskLabel('读 [深度工作] 第三章', 'abc-1')
  assert.equal(label, '[读 \\[深度工作\\] 第三章](app://todo/abc-1)')
  assert.deepEqual(parseLinkedLabel(label), { text: '读 [深度工作] 第三章', reference: 'abc-1' })
})

test('只认待办链接，不把笔记链接、待办清单当成关联任务', () => {
  assert.equal(todoReferenceFromHref('app://todo/x%201'), 'x 1')
  assert.equal(todoReferenceFromHref('app://todo-list/note/1'), '')
  assert.equal(todoReferenceFromHref('app://note/1'), '')
  assert.equal(parseLinkedLabel('[a](app://note/1)'), null)
  assert.equal(parseLinkedLabel('[a](app://todo/1) 还有字'), null)
})

test('列出任务时跳过代码块，区分普通任务和关联任务', () => {
  const md = ['- [ ] 买菜', '```', '- [ ] 代码里的不算', '```', '  - [x] [交周报](app://todo/t1)', '1. [ ] 编号任务'].join('\n')
  const { tasks } = listTaskLines(md)
  assert.deepEqual(tasks.map((task) => [task.text, task.checked, task.reference]), [
    ['买菜', false, ''],
    ['交周报', true, 't1'],
    ['编号任务', false, ''],
  ])
})

test('批量加入待办：只处理没关联、没完成、有文字的任务，缩进和列表符号保留', async () => {
  const md = ['- [ ] 买菜', '- [x] 已完成的不加', '  * [ ] 子任务', '- [ ] [旧的](app://todo/old)', '- [ ] '].join('\n')
  assert.equal(countPromotableTasks(md), 2)
  const created = []
  const result = await promoteTasksInMarkdown(md, async (text) => {
    created.push(text)
    return { sync_id: `id-${created.length}` }
  })
  assert.deepEqual(created, ['买菜', '子任务'])
  assert.equal(result.created, 2)
  assert.equal(result.markdown, ['- [ ] [买菜](app://todo/id-1)', '- [x] 已完成的不加', '  * [ ] [子任务](app://todo/id-2)', '- [ ] [旧的](app://todo/old)', '- [ ] '].join('\n'))
})
