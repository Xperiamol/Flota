import TaskItem from '@tiptap/extension-task-item'
import { createTodo, deleteTodo, fetchSubtasks, toggleTodoComplete, updateTodo } from '../../../api/todoAPI'
import { findTodoByReference, refreshTodoReferences, retainTodoReferences, todoReferenceStore } from '../../../hooks/useTodoReferences'
import { isFutureRecurringTodo, isTodoCompleted, isTodoOverdue, shortDueLabel as dueLabel } from '../../../utils/todoDisplayUtils'
import { referenceLink } from '../../../utils/todoReferences'
import { linkedTaskLabel, todoReferenceFromHref } from '../../../utils/linkedTasks'
import { notifyError, notifyWithAction } from '../../../utils/notify'

/**
 * 任务列表的一项，可以「加入待办」变成关联任务（attrs.todoRef = 待办的 sync_id）。
 *
 * - 外观和普通任务一样，只在行尾多一个小标记（截止时间、象限色点）
 * - 勾选状态以待办为准：两边勾哪边都同步
 * - 在笔记里改这一行的文字，等于给待办改名（停顿后再写入）；待办在别处改了名，打开笔记时这一行跟着更新
 * - 删掉这一行只是取消关联，待办保留；提示条上可以顺手把待办也删掉
 *
 * Markdown 里存成 `- [ ] [文字](app://todo/<sync_id>)`；旧版单独一行的待办链接读进来也变成关联任务。
 */

const QUADRANT_COLORS = { both: '#f44336', important: '#ff9800', urgent: '#2196f3' }
const SYNC_META = 'linkedTaskSync'
const RENAME_DELAY = 800

const quadrantColor = (todo) => {
  const important = Boolean(todo?.is_important)
  const urgent = Boolean(todo?.is_urgent)
  if (important && urgent) return QUADRANT_COLORS.both
  if (important) return QUADRANT_COLORS.important
  if (urgent) return QUADRANT_COLORS.urgent
  return ''
}

const firstText = (node) => (node?.firstChild?.textContent || '').replace(/\u200B/g, '').trim()

/** 文档里所有关联任务：引用 → { pos, node, text } */
const collectLinked = (doc) => {
  const linked = new Map()
  doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.attrs.todoRef) linked.set(node.attrs.todoRef, { pos, node, text: firstText(node) })
  })
  return linked
}

const setTaskAttrs = (editor, pos, attrs, { history = true } = {}) => editor.chain().command(({ tr }) => {
  const node = tr.doc.nodeAt(pos)
  if (!node || node.type.name !== 'taskItem') return false
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
  if (!history) tr.setMeta('addToHistory', false).setMeta(SYNC_META, true)
  return true
}).run()

/** 把一项任务建成待办并关联；返回是否成功 */
export async function promoteTask(editor, pos, sourceNote) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'taskItem' || node.attrs.todoRef) return false
  const text = firstText(node)
  if (!text) return false
  const todo = await createTodo({ content: text.slice(0, 200), description: sourceNote ? referenceLink('note', sourceNote) : '' })
  const reference = todo?.sync_id || todo?.id
  if (reference == null) throw new Error('待办没有建成')
  if (node.attrs.checked && todo?.id != null) await toggleTodoComplete(todo.id)
  // 建待办期间这一项可能挪了位置：按原节点找回来
  let target = pos
  if (editor.state.doc.nodeAt(pos) !== node) {
    target = -1
    editor.state.doc.descendants((child, childPos) => { if (target < 0 && child === node) target = childPos })
  }
  if (target < 0) return false
  setTaskAttrs(editor, target, { todoRef: String(reference) })
  refreshTodoReferences()
  return true
}

export const LinkedTaskItem = TaskItem.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      nested: true,
      // 关闭时只是普通任务列表（待办描述里的编辑器不再嵌套待办）
      linking: true,
      /** @type {() => object | null} 当前笔记，新建的待办会关联回它 */
      getSourceNote: () => null,
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      todoRef: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element) => element.getAttribute('data-todo-ref') || null,
        renderHTML: (attributes) => (attributes.todoRef ? { 'data-todo-ref': attributes.todoRef } : {}),
      },
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const reference = node.attrs.todoRef
          if (!reference) {
            state.write(`${node.attrs.checked ? '[x]' : '[ ]'} `)
            state.renderContent(node)
            return
          }
          // 勾选状态以待办为准，正文里写的是保存时的快照
          const todo = findTodoByReference(todoReferenceStore.getState().todos, reference)
          const checked = todo ? isTodoCompleted(todo) : node.attrs.checked
          state.write(`${checked ? '[x]' : '[ ]'} ${linkedTaskLabel(firstText(node), reference)}`)
          if (node.firstChild) state.closeBlock(node.firstChild)
          node.forEach((child, _offset, index) => { if (index > 0) state.render(child, node, index) })
        },
        parse: {
          updateDOM(element) {
            // tiptap-markdown 自带的处理：markdown-it 输出的任务项 → taskItem
            element.querySelectorAll('.task-list-item').forEach((item) => {
              const input = item.querySelector('input')
              item.setAttribute('data-type', 'taskItem')
              if (input) {
                item.setAttribute('data-checked', input.checked)
                input.remove()
              }
            })
            // 文字恰好是一个待办链接的任务 → 关联任务，链接拆成纯文字
            element.querySelectorAll('li[data-type="taskItem"]').forEach((item) => {
              const holder = item.firstElementChild?.tagName === 'P' ? item.firstElementChild : item
              const inline = [...holder.childNodes].filter((child) => !(child.nodeType === 1 && /^(UL|OL)$/.test(child.tagName)))
              const meaningful = inline.filter((child) => !(child.nodeType === 3 && !child.textContent.trim()))
              if (meaningful.length !== 1 || meaningful[0].nodeName !== 'A') return
              const reference = todoReferenceFromHref(meaningful[0].getAttribute('href'))
              if (!reference) return
              item.setAttribute('data-todo-ref', reference)
              meaningful[0].replaceWith(document.createTextNode(meaningful[0].textContent))
            })
            // 旧版：单独成段的待办链接（以前显示成卡片）→ 一项关联任务
            element.querySelectorAll('p').forEach((paragraph) => {
              const children = [...paragraph.childNodes].filter((child) => !(child.nodeType === 3 && !child.textContent.trim()))
              if (children.length !== 1 || children[0].nodeName !== 'A') return
              const reference = todoReferenceFromHref(children[0].getAttribute('href'))
              if (!reference) return
              const todo = findTodoByReference(todoReferenceStore.getState().todos, reference)
              const list = document.createElement('ul')
              list.setAttribute('data-type', 'taskList')
              list.setAttribute('data-tight', 'true')
              const item = document.createElement('li')
              item.setAttribute('data-type', 'taskItem')
              item.setAttribute('data-checked', String(Boolean(todo && isTodoCompleted(todo))))
              item.setAttribute('data-todo-ref', reference)
              const text = document.createElement('p')
              text.textContent = children[0].textContent
              item.append(text)
              list.append(item)
              paragraph.replaceWith(list)
            })
          },
        },
      },
    }
  },

  addNodeView() {
    const createParentView = this.parent?.()
    const options = this.options
    return (props) => {
      const view = createParentView(props)
      const { editor, getPos } = props
      let node = props.node
      const item = view.dom
      const checkbox = item.querySelector('input[type="checkbox"]')
      const meta = document.createElement('span')
      meta.className = 'flota-task-meta'
      meta.contentEditable = 'false'
      item.append(meta)

      let release = null
      let unsubscribe = null
      let busy = false

      const position = () => (typeof getPos === 'function' ? getPos() : null)
      const currentTodo = () => (node.attrs.todoRef ? findTodoByReference(todoReferenceStore.getState().todos, node.attrs.todoRef) : null)

      const button = (label, className, onClick, title) => {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = className
        element.textContent = label
        if (title) element.title = title
        element.addEventListener('mousedown', (event) => event.preventDefault())
        element.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick(event)
        })
        return element
      }

      const openMenu = (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        editor.emit('linked-task-menu', { pos: position(), reference: node.attrs.todoRef, todo: currentTodo(), x: rect.left, y: rect.bottom + 4 })
      }

      const render = () => {
        const reference = node.attrs.todoRef
        item.classList.toggle('is-linked', Boolean(reference))
        meta.replaceChildren()
        if (!reference) {
          checkbox.disabled = false
          if (options.linking && editor.isEditable && firstText(node)) {
            meta.append(button('加入待办', 'flota-task-promote', async () => {
              if (busy) return
              busy = true
              try {
                const pos = position()
                if (typeof pos === 'number') await promoteTask(editor, pos, options.getSourceNote?.())
              } catch (error) {
                notifyError(`加入待办失败：${error?.message || '未知原因'}`)
              } finally { busy = false }
            }, '建成待办，之后勾选和改名两边同步'))
          }
          return
        }

        const { loading } = todoReferenceStore.getState()
        const todo = currentTodo()
        if (!todo) {
          if (loading) return
          item.classList.add('is-missing')
          meta.append(button('待办已删除', 'flota-task-badge is-missing', openMenu))
          return
        }
        item.classList.remove('is-missing')
        const done = isTodoCompleted(todo)
        checkbox.checked = done
        item.dataset.checked = String(done)
        checkbox.disabled = !editor.isEditable || (!done && isFutureRecurringTodo(todo))

        const badge = button('', 'flota-task-badge', openMenu, '已同步到待办 · 点击查看')
        const color = quadrantColor(todo)
        if (color) {
          const dot = document.createElement('span')
          dot.className = 'flota-task-dot'
          dot.style.backgroundColor = color
          badge.append(dot)
        }
        const due = done ? '' : dueLabel(todo)
        if (due) {
          const text = document.createElement('span')
          text.textContent = due
          if (isTodoOverdue(todo)) text.className = 'is-overdue'
          badge.append(text)
        }
        const icon = document.createElement('span')
        icon.className = 'flota-task-link-icon'
        icon.setAttribute('aria-hidden', 'true')
        badge.append(icon)
        badge.setAttribute('aria-label', `待办「${todo.content}」${due ? `，${due}到期` : ''}`)
        meta.append(badge)
      }

      const attach = () => {
        if (node.attrs.todoRef && !release) {
          release = retainTodoReferences()
          unsubscribe = todoReferenceStore.subscribe(render)
        } else if (!node.attrs.todoRef && release) {
          unsubscribe?.(); release(); release = null; unsubscribe = null
        }
      }

      // 关联任务的勾选改走待办：在捕获阶段拦下，tiptap 自己的处理（改 attrs.checked）就不会执行
      const onChange = async (event) => {
        if (event.target !== checkbox || !node.attrs.todoRef) return
        event.stopPropagation()
        const desired = checkbox.checked
        const todo = currentTodo()
        if (!todo || busy || !editor.isEditable) { checkbox.checked = !desired; return }
        busy = true
        try {
          if (desired && (await fetchSubtasks(todo.sync_id)).some((child) => !child.is_completed)) {
            throw new Error('这条待办还有没完成的子任务，先在待办里处理')
          }
          await toggleTodoComplete(todo.id)
          // 正文里的快照也跟着改，撤销时回到原来的状态
          const pos = position()
          if (typeof pos === 'number') setTaskAttrs(editor, pos, { checked: desired })
          await refreshTodoReferences()
        } catch (error) {
          checkbox.checked = !desired
          notifyError(error?.message || '操作失败')
        } finally {
          busy = false
          render()
        }
      }
      item.addEventListener('change', onChange, true)

      attach()
      render()

      const parentUpdate = view.update
      view.update = (updatedNode, ...rest) => {
        if (!parentUpdate(updatedNode, ...rest)) return false
        const textChanged = Boolean(firstText(updatedNode)) !== Boolean(firstText(node))
        const linkChanged = Boolean(updatedNode.attrs.todoRef) !== Boolean(node.attrs.todoRef)
        node = updatedNode
        attach()
        // 普通任务打字时只在「有没有文字」变化时刷新「加入待办」按钮
        if (node.attrs.todoRef || linkChanged || textChanged) render()
        return true
      }
      // 行尾标记是不可编辑的装饰，不让 ProseMirror 把对它的改动当成内容变化
      // 勾选框、行尾标记都在 contentDOM 外面，对它们的改动（disabled、按钮重建）不是内容变化
      view.ignoreMutation = (mutation) => mutation.type !== 'selection' && !view.contentDOM.contains(mutation.target)
      view.stopEvent = (event) => meta.contains(event.target)
      const parentDestroy = view.destroy
      view.destroy = () => {
        parentDestroy?.()
        item.removeEventListener('change', onChange, true)
        unsubscribe?.()
        release?.()
      }
      return view
    }
  },

  onCreate() {
    if (!this.options.linking) return
    const editor = this.editor
    // 已经同步过的文字：只有这一行真的被改过才写回待办，避免把笔记里的旧快照写回去
    this.storage.seenText = new Map([...collectLinked(editor.state.doc)].map(([reference, entry]) => [reference, entry.text]))
    this.storage.renameTimer = null
    this.storage.pendingRemoval = new Set()
    this.storage.watch = () => {
      if (this.storage.release) return
      this.storage.release = retainTodoReferences()
      this.storage.unsubscribe = todoReferenceStore.subscribe(() => this.storage.pullRenames())
    }
    // 待办在别处改了名：笔记里这一行跟着改（不进撤销栈）
    this.storage.pullRenames = () => {
      if (editor.isDestroyed || !editor.isEditable) return
      const { todos } = todoReferenceStore.getState()
      const updates = []
      collectLinked(editor.state.doc).forEach((entry, reference) => {
        const todo = findTodoByReference(todos, reference)
        if (!todo?.content || todo.content === entry.text) return
        // 笔记里改过、还没写回待办的，以笔记为准
        if (entry.text !== this.storage.seenText.get(reference)) return
        // 正在改的这一行先不动，改完会写回待办
        const { from } = editor.state.selection
        if (editor.isFocused && from > entry.pos && from < entry.pos + entry.node.nodeSize) return
        updates.push({ entry, text: todo.content, reference })
      })
      if (!updates.length) return
      editor.chain().command(({ tr }) => {
        updates.sort((a, b) => b.entry.pos - a.entry.pos).forEach(({ entry, text }) => {
          const paragraph = entry.node.firstChild
          if (!paragraph) return
          const start = entry.pos + 2
          tr.replaceWith(start, start + paragraph.content.size, editor.schema.text(text))
        })
        tr.setMeta('addToHistory', false).setMeta(SYNC_META, true)
        return true
      }).run()
      updates.forEach(({ reference, text }) => this.storage.seenText.set(reference, text))
    }
    // 只有笔记里有关联任务时才加载待办
    if (this.storage.seenText.size) this.storage.watch()
  },

  onTransaction({ transaction }) {
    if (!this.options.linking || !transaction.docChanged || !this.storage.seenText) return
    const editor = this.editor
    const before = collectLinked(transaction.before)
    const after = collectLinked(transaction.doc)
    const fromSync = transaction.getMeta(SYNC_META)
    // 整篇替换（切换笔记、云端同步）不算用户删除
    const wholeDoc = transaction.steps.some((step) => step.from === 0 && step.to >= transaction.before.content.size)
    if (after.size) this.storage.watch?.()
    if (fromSync || wholeDoc || transaction.getMeta('preventUpdate')) {
      after.forEach((entry, reference) => this.storage.seenText.set(reference, entry.text))
      return
    }

    // 改名：停顿一下再写回待办
    after.forEach((entry, reference) => {
      if (!this.storage.seenText.has(reference)) this.storage.seenText.set(reference, entry.text)
    })
    clearTimeout(this.storage.renameTimer)
    this.storage.renameTimer = setTimeout(() => {
      if (editor.isDestroyed) return
      const { todos } = todoReferenceStore.getState()
      collectLinked(editor.state.doc).forEach((entry, reference) => {
        if (!entry.text || entry.text === this.storage.seenText.get(reference)) return
        this.storage.seenText.set(reference, entry.text)
        const todo = findTodoByReference(todos, reference)
        if (!todo || todo.content === entry.text) return
        updateTodo(todo.id, { content: entry.text.slice(0, 200) })
          .then(() => refreshTodoReferences())
          .catch((error) => notifyError(`待办改名没成功：${error?.message || '未知原因'}`))
      })
    }, RENAME_DELAY)

    // 删掉了关联任务：待办保留，提示条上可以一起删掉
    const removed = [...before.keys()].filter((reference) => !after.has(reference))
    if (!removed.length) return
    removed.forEach((reference) => this.storage.pendingRemoval.add(reference))
    clearTimeout(this.storage.removalTimer)
    this.storage.removalTimer = setTimeout(() => {
      if (editor.isDestroyed) return
      const still = collectLinked(editor.state.doc)
      const { todos } = todoReferenceStore.getState()
      const gone = [...this.storage.pendingRemoval].filter((reference) => !still.has(reference))
        .map((reference) => findTodoByReference(todos, reference)).filter(Boolean)
      this.storage.pendingRemoval.clear()
      if (!gone.length) return
      const label = gone.length === 1 ? `「${gone[0].content}」` : `${gone.length} 条任务`
      notifyWithAction(`已从笔记移除${label}，待办仍保留`, {
        label: '同时删除待办',
        onClick: async () => {
          try {
            for (const todo of gone) await deleteTodo(todo.id)
            refreshTodoReferences()
          } catch (error) {
            notifyError(`删除待办失败：${error?.message || '未知原因'}`)
          }
        },
      }, 'info')
    }, 400)
  },

  onDestroy() {
    clearTimeout(this.storage.renameTimer)
    clearTimeout(this.storage.removalTimer)
    this.storage.unsubscribe?.()
    this.storage.release?.()
  },

  addCommands() {
    return {
      ...this.parent?.(),
      /** 取消关联：变回普通任务，待办保留 */
      unlinkTask: (pos) => ({ tr, state, dispatch }) => {
        const node = state.doc.nodeAt(pos)
        if (!node || node.type.name !== 'taskItem' || !node.attrs.todoRef) return false
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, todoRef: null })
        return true
      },
    }
  },
})

/** 把文档里还没关联的未完成任务都建成待办；返回建了几条 */
export async function promoteAllTasks(editor, sourceNote) {
  const pending = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && !node.attrs.todoRef && !node.attrs.checked && firstText(node)) pending.push(pos)
  })
  let created = 0
  // 从后往前：前面的改动不会让后面记下的位置失效
  for (const pos of pending.reverse()) {
    if (await promoteTask(editor, pos, sourceNote)) created += 1
  }
  return created
}

export default LinkedTaskItem
