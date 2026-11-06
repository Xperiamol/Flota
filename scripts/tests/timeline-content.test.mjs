import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 纯函数模块，直接按源码加载（与 pending-actions.test.mjs 一致，不引入测试框架）
const source = await readFile(new URL('../../src/components/notes/timeline/timelineContent.js', import.meta.url), 'utf8')
const {
  splitEditableContent, joinEditableContent, parseTodoInput,
  buildMergedDayContent, buildMergedDayTitle, toTodoText, appendDraftText,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('原地编辑只拆出文字，图片 / 录音 / 附件行原样保留', () => {
  const content = '今天的想法\n第二行\n\n![录音](audio/a.m4a)\n![截图.png](images/x.png)\n[报告.pdf](attachments/r.pdf)'
  const { text, media } = splitEditableContent(content)
  assert.equal(text, '今天的想法\n第二行')
  assert.deepEqual(media, ['![录音](audio/a.m4a)', '![截图.png](images/x.png)', '[报告.pdf](attachments/r.pdf)'])
  assert.equal(joinEditableContent('改过的想法', media), '改过的想法\n\n![录音](audio/a.m4a)\n![截图.png](images/x.png)\n[报告.pdf](attachments/r.pdf)')
  // 行内的普通链接属于文字，不当作媒体
  assert.equal(splitEditableContent('看看 [官网](https://a.com) 吧').text, '看看 [官网](https://a.com) 吧')
  // 只有媒体时文字为空，保存时不会多出空行
  assert.equal(joinEditableContent('', ['![录音](audio/a.m4a)']), '![录音](audio/a.m4a)')
})

test('待办语法：前缀与复选框，其余照常是记录', () => {
  assert.equal(parseTodoInput('待办：买牛奶'), '买牛奶')
  assert.equal(parseTodoInput('todo: buy milk'), 'buy milk')
  assert.equal(parseTodoInput('- [ ] 回邮件'), '回邮件')
  assert.equal(parseTodoInput('今天想到要买牛奶'), null)
  assert.equal(parseTodoInput('待办：'), null)
})

test('合并一天的记录：按时间分节，标题带日期', () => {
  const morning = new Date(2026, 1, 20, 9, 5).getTime()
  const noon = new Date(2026, 1, 20, 12, 30).getTime()
  assert.equal(
    buildMergedDayContent([{ time: morning, content: '早上 ' }, { time: noon, content: '中午' }]),
    '### 09:05\n\n早上\n\n### 12:30\n\n中午'
  )
  assert.equal(buildMergedDayTitle(morning), '2月20日 记录')
})

test('转待办取第一行文字并截断；草稿追加转写文字换行', () => {
  assert.equal(toTodoText('\n  第一行  \n第二行'), '第一行')
  assert.equal(toTodoText('a'.repeat(250)).length, 201)
  assert.equal(appendDraftText('', '  你好'), '你好')
  assert.equal(appendDraftText('已有', '新的'), '已有\n新的')
})
