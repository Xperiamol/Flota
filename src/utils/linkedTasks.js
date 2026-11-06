/**
 * 笔记里的「关联任务」：一行普通的 Markdown 任务，文字本身是指向待办的链接。
 *
 *   - [ ] [交周报](app://todo/<sync_id>)
 *
 * 在别的 Markdown 软件里它仍然是一个带链接的勾；在 Flota 里这一行和待办页里的那条待办是同一个东西：
 * 勾选、改名两边同步，勾选状态以待办为准，正文里的 [x] 只是保存时的快照。
 */

const TODO_HREF = /^app:\/\/todo\/([^\s)>]+)$/i
// 整行文字恰好是一个待办链接
const LINKED_LABEL = /^\[((?:\\.|[^\]\\\n])*)\]\(<?app:\/\/todo\/([^\s)>]+)>?\)\s*$/
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/
const FENCE = /^\s*(```|~~~)/

const decode = (value) => {
  try { return decodeURIComponent(value) } catch { return value }
}

/** 链接地址里的待办引用（sync_id 或 id），不是待办链接时返回空字符串 */
export const todoReferenceFromHref = (href) => {
  const match = TODO_HREF.exec(String(href || '').trim())
  return match ? decode(match[1]) : ''
}

/** 链接文字转义：方括号和反斜杠前加 \，读回来时原样还原 */
export const escapeLinkLabel = (text) => String(text || '').replace(/\r?\n/g, ' ').replace(/([\\[\]])/g, '\\$1')
const unescapeLinkLabel = (text) => String(text || '').replace(/\\([\\[\]])/g, '$1')

/** 关联任务这一行勾后面的部分：[文字](app://todo/引用) */
export const linkedTaskLabel = (text, reference) => `[${escapeLinkLabel(String(text || '').trim() || '待办')}](app://todo/${encodeURIComponent(String(reference))})`

/** 解析任务行后面的文字：是关联任务时返回 { text, reference } */
export const parseLinkedLabel = (rest) => {
  const match = LINKED_LABEL.exec(String(rest || '').trim())
  return match ? { text: unescapeLinkLabel(match[1]), reference: decode(match[2]) } : null
}

/** 逐行列出 Markdown 里的任务（跳过代码块） */
export function listTaskLines(markdown) {
  const lines = String(markdown || '').split('\n')
  const tasks = []
  let fence = null
  lines.forEach((line, index) => {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1]
      else if (fenceMatch[1] === fence) fence = null
      return
    }
    if (fence) return
    const match = TASK_LINE.exec(line)
    if (!match) return
    const linked = parseLinkedLabel(match[4])
    tasks.push({
      index,
      prefix: match[1],
      checked: match[2] !== ' ',
      suffix: match[3],
      text: linked ? linked.text : match[4].trim(),
      reference: linked?.reference || '',
    })
  })
  return { lines, tasks }
}

/**
 * 把还没关联的未完成任务都建成待办，并把这些行改写成关联任务。
 * @param {string} markdown
 * @param {(text: string) => Promise<{ sync_id?: string, id?: any }>} createTodo
 * @returns {Promise<{ markdown: string, created: number }>}
 */
export async function promoteTasksInMarkdown(markdown, createTodo) {
  const { lines, tasks } = listTaskLines(markdown)
  let created = 0
  for (const task of tasks) {
    if (task.checked || task.reference || !task.text) continue
    const todo = await createTodo(task.text)
    const reference = todo?.sync_id || todo?.id
    if (reference == null) continue
    lines[task.index] = `${task.prefix} ${task.suffix}${linkedTaskLabel(task.text, reference)}`
    created += 1
  }
  return { markdown: lines.join('\n'), created }
}

/** 还没关联的未完成任务有几条 */
export const countPromotableTasks = (markdown) => listTaskLines(markdown).tasks.filter((task) => !task.checked && !task.reference && task.text).length
