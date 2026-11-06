/**
 * 任务列表：`- [ ] 文字` / `- [x] 文字` 渲染成勾选框。
 * 文字恰好是一个待办链接（`[文字](app://todo/…)`）的是关联任务，<li> 上带 data-todo-ref，
 * 预览里会按待办的实时状态显示勾选。
 */
import { todoReferenceFromHref } from '../../utils/linkedTasks.js'

const MARKER = /^\[([ xX])\][ \u00a0]/

export default function taskListPlugin(md) {
  md.core.ruler.after('inline', 'flota_task_list', (state) => {
    const tokens = state.tokens
    for (let i = 2; i < tokens.length; i += 1) {
      const inline = tokens[i]
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
      const first = inline.children?.[0]
      const match = first?.type === 'text' ? MARKER.exec(first.content) : null
      if (!match) continue

      const checked = match[1] !== ' '
      first.content = first.content.slice(match[0].length)
      inline.content = inline.content.slice(match[0].length)

      const item = tokens[i - 2]
      item.attrJoin('class', 'task-list-item')
      item.attrSet('data-checked', String(checked))

      // 剩下的内容只有一个待办链接 → 关联任务
      const meaningful = inline.children.filter((child) => !(child.type === 'text' && !child.content.trim()))
      if (meaningful[0]?.type === 'link_open' && meaningful[meaningful.length - 1]?.type === 'link_close'
        && meaningful.filter((child) => child.type === 'link_open').length === 1) {
        const reference = todoReferenceFromHref(meaningful[0].attrGet('href'))
        if (reference) item.attrSet('data-todo-ref', reference)
      }

      const box = new state.Token('html_inline', '', 0)
      box.content = `<span class="task-list-checkbox"><input type="checkbox"${checked ? ' checked' : ''} aria-label="${checked ? '已完成' : '未完成'}"></span>`
      inline.children.unshift(box)

      // 所在列表标记一下，去掉圆点
      for (let j = i - 3; j >= 0; j -= 1) {
        if ((tokens[j].type === 'bullet_list_open' || tokens[j].type === 'ordered_list_open') && tokens[j].level === item.level - 1) {
          if (!String(tokens[j].attrGet('class') || '').includes('contains-task-list')) tokens[j].attrJoin('class', 'contains-task-list')
          break
        }
      }
    }
  })
}
