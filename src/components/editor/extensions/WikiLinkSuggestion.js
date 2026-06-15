import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * WikiLinkSuggestion
 *
 * 监听用户输入：当当前光标前出现 `[[query`（query 中不能含 `]` 或换行）时，
 * 通过 options.onUpdate({ query, range, clientRect }) 通知外层渲染下拉。
 * 外层负责渲染 UI 与键盘导航；选中后调用 ProseMirror command 替换 [[query → [[Title]]
 *
 * 不依赖 @tiptap/suggestion。
 */

const WIKI_TRIGGER_RE = /\[\[([^\]\n]*)$/

const findQueryAtPos = (state) => {
  const { selection } = state
  const { $from } = selection
  if (!selection.empty) return null
  // 行内代码 / 代码块内不触发
  try {
    const codeMark = state.schema.marks.code
    if (codeMark && codeMark.isInSet($from.marks())) return null
    const parentName = $from.parent?.type?.name
    if (parentName === 'codeBlock' || parentName === 'code_block') return null
  } catch {}
  // 行首到光标的文本
  const start = $from.before($from.depth)
  const text = state.doc.textBetween(start, $from.pos, '\n', '\0')
  const m = text.match(WIKI_TRIGGER_RE)
  if (!m) return null
  // [[ 起始位置：光标 - m[0].length（含 [[）
  const from = $from.pos - m[0].length
  const to = $from.pos
  return { query: m[1], from, to }
}

export const WikiLinkSuggestion = Extension.create({
  name: 'wikiLinkSuggestion',

  addOptions() {
    return {
      // (state: { open, query, range, clientRect }) => void
      onStateChange: () => {},
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    const pluginKey = new PluginKey('wikiLinkSuggestion')

    return [
      new Plugin({
        key: pluginKey,
        view() {
          let lastOpen = false
          return {
            update: (view) => {
              const found = findQueryAtPos(view.state)
              if (!found) {
                if (lastOpen) {
                  lastOpen = false
                  opts.onStateChange({ open: false })
                }
                return
              }
              // 计算光标 viewport 坐标
              const coords = view.coordsAtPos(found.to)
              const clientRect = {
                top: coords.top,
                bottom: coords.bottom,
                left: coords.left,
                right: coords.left,
                width: 0,
                height: coords.bottom - coords.top,
              }
              lastOpen = true
              opts.onStateChange({
                open: true,
                query: found.query,
                range: { from: found.from, to: found.to },
                clientRect,
              })
            },
            destroy: () => {
              if (lastOpen) opts.onStateChange({ open: false })
            },
          }
        },
      }),
    ]
  },
})

export default WikiLinkSuggestion
