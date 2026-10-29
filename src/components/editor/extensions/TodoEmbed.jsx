import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Box, IconButton, Tooltip } from '@mui/material'
import { Close } from '../../common/AppIcons'
import TodoReferenceCard from '../../todos/TodoReferenceCard'
import useTodoReferences from '../../../hooks/useTodoReferences'
import { referenceLink } from '../../../utils/todoReferences'

function TodoEmbedView({ node, editor, getPos, selected }) {
  const { todos, loading, error } = useTodoReferences()
  const todo = todos.find(item => String(item.sync_id || item.id) === node.attrs.reference)
  return <NodeViewWrapper contentEditable={false} data-drag-handle="">
    <Box sx={{ my: 1, position: 'relative', borderRadius: 2, outline: selected ? '2px solid' : 'none', outlineColor: 'primary.main', '& .remove-todo-reference': { opacity: 0 }, '&:hover .remove-todo-reference, &:focus-within .remove-todo-reference': { opacity: 1 }, '@media (hover: none)': { '& .remove-todo-reference': { opacity: 1 } } }}>
      <TodoReferenceCard todo={todo} title={node.attrs.title} loading={loading} error={error} readOnly={!editor.isEditable} />
      {editor.isEditable && <Tooltip title="移除引用，保留待办"><IconButton className="remove-todo-reference" size="small" aria-label="移除待办引用" sx={{ position: 'absolute', right: 4, top: 4, bgcolor: 'background.paper' }} onClick={() => {
        const pos = getPos()
        if (typeof pos === 'number') editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
      }}><Close sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
    </Box>
  </NodeViewWrapper>
}
export const createTodoEmbed = (name, host, View) => Node.create({
  name, priority: 1000, group: 'block', atom: true, draggable: true,
  addCommands() { return { requestTodoReference: () => ({ editor }) => { editor.emit('todo-reference-request'); return true } } },
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

export const TodoEmbed = createTodoEmbed('todoEmbed', 'todo', TodoEmbedView)
