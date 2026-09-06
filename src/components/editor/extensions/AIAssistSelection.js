import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const aiAssistSelectionPluginKey = new PluginKey('aiAssistSelection')

const clampRange = (doc, range) => {
  const from = Math.max(0, Math.min(Number(range?.from) || 0, doc.content.size))
  const to = Math.max(from, Math.min(Number(range?.to) || 0, doc.content.size))
  return from < to ? { from, to } : null
}

export const showAIAssistSelection = (editor, range) => {
  if (!editor || editor.isDestroyed) return
  const safeRange = clampRange(editor.state.doc, range)
  if (!safeRange) return
  editor.view.dispatch(
    editor.state.tr
      .setMeta(aiAssistSelectionPluginKey, { type: 'show', range: safeRange })
      .setMeta('addToHistory', false)
  )
}

export const hideAIAssistSelection = (editor) => {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(
    editor.state.tr
      .setMeta(aiAssistSelectionPluginKey, { type: 'hide' })
      .setMeta('addToHistory', false)
  )
}

// 浏览器在编辑器失焦后不会稳定保留原生选区颜色。用 decoration 只绘制视觉反馈，
// 不给正文加 mark、不触发 onUpdate，也不会污染 Markdown 或撤销历史。
const AIAssistSelection = Extension.create({
  name: 'aiAssistSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiAssistSelectionPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, decorations, _oldState, newState) {
            const meta = transaction.getMeta(aiAssistSelectionPluginKey)
            if (meta?.type === 'hide') return DecorationSet.empty
            if (meta?.type === 'show') {
              const range = clampRange(newState.doc, meta.range)
              if (!range) return DecorationSet.empty
              return DecorationSet.create(newState.doc, [
                Decoration.inline(range.from, range.to, {
                  class: 'ai-assist-selection',
                  'data-ai-assist-selection': 'true',
                }),
              ])
            }
            return decorations.map(transaction.mapping, transaction.doc)
          },
        },
        props: {
          decorations(state) {
            return aiAssistSelectionPluginKey.getState(state)
          },
        },
      }),
    ]
  },
})

export default AIAssistSelection
