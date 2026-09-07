import { useState } from 'react'
import { Node, InputRule, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'
import mathPlugin, { readInlineMath, renderMath } from '../../../markdown/plugins/math.js'

const MathView = ({ node, updateAttributes, selected, editor }) => {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const display = node.type.name === 'blockMath'
  const edit = () => {
    if (!editor.isEditable) return
    setDraft(node.attrs.latex)
    setOpen(true)
  }
  const save = () => {
    if (!draft.trim()) return
    updateAttributes({ latex: draft.trim() })
    setOpen(false)
    editor.commands.focus()
  }
  return (
    <NodeViewWrapper as={display ? 'div' : 'span'} className={`${display ? 'math-block' : 'math-inline'} math-node${selected ? ' math-selected' : ''}`}>
      <span contentEditable={false} role="button" tabIndex={0} aria-label="编辑公式"
        title="双击编辑公式" onDoubleClick={edit}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); edit() } }}
        dangerouslySetInnerHTML={{ __html: renderMath(node.attrs.latex, display) }} />
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>编辑{display ? '独立' : '行内'}公式</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline minRows={display ? 4 : 2} label="LaTeX 公式"
            value={draft} onChange={event => setDraft(event.target.value)} sx={{ mt: 1 }}
            helperText="直接输入公式内容，无需添加 $。Ctrl / ⌘ + Enter 保存。"
            onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save() } }} />
          <Box sx={{ mt: 2, p: 2, overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: renderMath(draft, display) }} />
        </DialogContent>
        <DialogActions><Button onClick={() => setOpen(false)}>取消</Button><Button onClick={save} disabled={!draft.trim()}>保存</Button></DialogActions>
      </Dialog>
    </NodeViewWrapper>
  )
}

const createMathNode = (display) => Node.create({
  name: display ? 'blockMath' : 'inlineMath',
  group: display ? 'block' : 'inline',
  inline: !display,
  atom: true,
  selectable: true,
  draggable: display,
  addAttributes: () => ({ latex: { default: '', parseHTML: element => element.getAttribute('data-latex'), renderHTML: attrs => ({ 'data-latex': attrs.latex }) } }),
  parseHTML: () => [{ tag: `[data-type="${display ? 'math-block' : 'math-inline'}"][data-latex]` }],
  renderHTML({ HTMLAttributes }) {
    return [display ? 'div' : 'span', mergeAttributes(HTMLAttributes, { 'data-type': display ? 'math-block' : 'math-inline', class: display ? 'math-block' : 'math-inline' })]
  },
  addNodeView: () => ReactNodeViewRenderer(MathView),
  addStorage() {
    return { markdown: {
      serialize(state, node) {
        if (display) { state.write(`$$\n${node.attrs.latex}\n$$`); state.closeBlock(node) }
        else state.write(`$${node.attrs.latex}$`)
      },
      parse: { setup(md) { md.use(mathPlugin, { render: false }) } },
    } }
  },
  addInputRules() {
    return [new InputRule({
      find: display ? /^\$\$\s$/ : /(?:\$[^$\n]+\$|\\\([^\n]+\\\))$/,
      handler: ({ state, range, match }) => {
        if (state.selection.$from.parent.type.spec.code || state.selection.$from.marks().some(mark => mark.type.name === 'code')) return null
        if (display) {
          state.tr.replaceWith(range.from - 1, range.to, this.type.create({ latex: 'E = mc^2' }))
        } else {
          const source = state.selection.$from.parent.textContent.slice(0, state.selection.$from.parentOffset) + match[0].slice(-1)
          const parsed = readInlineMath(source, source.length - match[0].length)
          if (!parsed) return null
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex: parsed.latex }))
        }
      },
    })]
  },
})

export const InlineMath = createMathNode(false)
export const BlockMath = createMathNode(true)

// Literal dollars (plain paste, escaped Markdown, logs) must remain literal
// after saving and reopening; math nodes write their own delimiters directly.
export const MathAwareText = Node.create({
  name: 'text',
  group: 'inline',
  addStorage() {
    return { markdown: {
      serialize(state, node) {
        state.options.escapeExtraCharacters = /\$/g
        state.text(node.text, !state.inAutolink)
      },
      parse: {},
    } }
  },
})
