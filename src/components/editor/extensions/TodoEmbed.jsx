import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { referenceLink } from '../../../utils/todoReferences'

// 嵌入块的公共节点定义（目前只有待办清单用）。单条待办已经改成任务列表里的关联任务（LinkedTaskItem）。
export const createTodoEmbed = (name, host, View) => Node.create({
  name, priority: 1000, group: 'block', atom: true, draggable: true,
  addCommands() { return { requestTodoReference: (kind = 'single') => ({ editor }) => { editor.emit('todo-reference-request', { kind }); return true } } },
  addStorage() { return { markdown: {
    serialize(state, node) { state.write(referenceLink(host, { sync_id: node.attrs.reference, content: node.attrs.title })); state.closeBlock(node) },
    parse: { updateDOM(element) {
      element.querySelectorAll(`a[href^="app://${host}/"]`).forEach(link => {
        // A live task is a block: only promote standalone links, never split a sentence/list.
        const paragraph = link.parentElement
        if (!paragraph?.matches('p') || paragraph.childNodes.length !== 1) return
        let reference
        try { reference = decodeURIComponent(new URL(link.getAttribute('href')).pathname.slice(1)) } catch { return }
        if (!reference) return
        const embed = document.createElement('div')
        embed.setAttribute('data-type', name); embed.setAttribute('data-reference', reference); embed.setAttribute('data-title', link.textContent || '待办')
        paragraph.replaceWith(embed)
      })
    } },
  } } },
  addAttributes: () => ({ reference: { default: '', parseHTML: el => el.getAttribute('data-reference') }, title: { default: '待办', parseHTML: el => el.getAttribute('data-title') } }),
  parseHTML: () => [{ tag: `div[data-type="${name}"][data-reference]` }],
  renderHTML: ({ node }) => ['div', mergeAttributes({ 'data-type': name, 'data-reference': node.attrs.reference, 'data-title': node.attrs.title })],
  addNodeView: () => ReactNodeViewRenderer(View),
})

