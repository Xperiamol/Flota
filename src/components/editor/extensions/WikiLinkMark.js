import { Mark, mergeAttributes, markPasteRule } from '@tiptap/core'

const WIKI_LINK_REGEX = /\[\[([^\]\n]+?)\]\]/g

// 解析 `[[target|alias]]` / `[[target#section]]` / `[[target|alias#section]]` 等形态
// 返回 { target, alias, section }；任一字段缺失为 ''
const parseWikiInner = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return { target: '', alias: '', section: '' }
  let target = s
  let alias = ''
  let section = ''
  // 先拆 alias（| 后面的部分）
  const pipeIdx = target.indexOf('|')
  if (pipeIdx >= 0) {
    alias = target.slice(pipeIdx + 1).trim()
    target = target.slice(0, pipeIdx).trim()
  }
  // 再从 target 拆 section
  const hashIdx = target.indexOf('#')
  if (hashIdx >= 0) {
    section = target.slice(hashIdx + 1).trim()
    target = target.slice(0, hashIdx).trim()
  }
  // 兼容：alias 中带 #section（如 `[[Foo|别名#章节]]`），把 # 后视为 section
  if (!section && alias) {
    const aHash = alias.indexOf('#')
    if (aHash >= 0) {
      section = alias.slice(aHash + 1).trim()
      alias = alias.slice(0, aHash).trim()
    }
  }
  return { target, alias, section }
}

// inline Mark：把文本 `[[xxx]]` 染成可点击的 wiki link
// 序列化为 markdown 时输出 mark 包裹文本本身（即 `[[xxx]]`），
// 与现有 markdown-it wikiLink 渲染兼容，无需自定义 toMarkdown。
export const WikiLinkMark = Mark.create({
  name: 'wikiLink',
  inclusive: false,
  exitable: true,
  spanning: false,

  addOptions() {
    return {
      HTMLAttributes: { class: 'markdown-wiki-link' },
      // 函数：(target) => boolean。返回 false 时给 not-found 样式
      isTargetExists: null,
    }
  },

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-wiki-target') || '',
        renderHTML: (attrs) => (attrs.target ? { 'data-wiki-target': attrs.target } : {}),
      },
      alias: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-wiki-alias') || '',
        renderHTML: (attrs) => (attrs.alias ? { 'data-wiki-alias': attrs.alias } : {}),
      },
      section: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-wiki-section') || '',
        renderHTML: (attrs) => (attrs.section ? { 'data-wiki-section': attrs.section } : {}),
      },
    }
  },

  // tiptap-markdown 的存储钩子：mark open/close 都为空字符串，
  // 让序列化输出 mark 包裹文本本身（即 `[[xxx]]`），不污染 markdown 存储格式。
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: () => '',
          close: () => '',
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-wiki-target]',
        getAttrs: (el) => ({
          target: el.getAttribute('data-wiki-target') || '',
          alias: el.getAttribute('data-wiki-alias') || '',
          section: el.getAttribute('data-wiki-section') || '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const target = mark.attrs.target
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      'data-wiki-target': target,
    })
    let notFound = false
    try {
      const fn = this.options.isTargetExists
      if (typeof fn === 'function' && target) notFound = fn(target) === false
    } catch {}
    if (notFound) {
      attrs.class = `${attrs.class || ''} markdown-wiki-link-not-found`.trim()
    }
    return ['a', attrs, 0]
  },

  // 粘贴含 `[[xxx]]` 文本时立即套 mark
  // 注：嵌入语法 ![[xxx]] 粘贴后，前面的 `!` 也会原样保留，标记里依然是 [[xxx]]，
  // 预览侧由 markdown-it 重新识别为嵌入；编辑器内被套 mark 无副作用。
  addPasteRules() {
    return [
      markPasteRule({
        find: WIKI_LINK_REGEX,
        type: this.type,
        getAttributes: (match) => parseWikiInner(match[1]),
      }),
    ]
  },

  // 输入到 `]]` 末尾时套 mark；前缀 `!` 视为嵌入语法，跳过
  addInputRules() {
    const type = this.type
    return [
      {
        find: /(^|[^!])\[\[([^\]\n]+?)\]\]$/,
        handler: ({ state, range, match }) => {
          const parsed = parseWikiInner(match[2])
          if (!parsed.target) return null
          const tr = state.tr
          // match[1] 是前置非 `!` 字符（或空），需把 mark 范围相应右移
          const offset = (match[1] || '').length
          tr.addMark(range.from + offset, range.to, type.create(parsed))
          tr.removeStoredMark(type)
          return tr
        },
      },
    ]
  },

  onCreate() {
    rescanWikiLinks(this.editor, this.type)
  },

  onUpdate() {
    // setContent / 远端同步会带来裸 `[[xxx]]` 文本，按 doc 变化重扫一遍。
    // microtask 节流；rescan 事务带 wikiLinkRescan meta，避免 WYSIWYGEditor.onUpdate
    // 把它当成用户编辑回写到上层，造成切笔记串内容。
    const editor = this.editor
    if (!editor || editor.isDestroyed) return
    if (this._rescanScheduled) return
    this._rescanScheduled = true
    queueMicrotask(() => {
      this._rescanScheduled = false
      rescanWikiLinks(editor, this.type)
    })
  },
})

// 给所有未被 mark 的 `[[xxx]]` 文本套 wikiLink mark
const rescanWikiLinks = (editor, type) => {
  if (!editor || editor.isDestroyed) return
  let view
  try { view = editor.view } catch { return }
  if (!view) return
  try {
    const { state } = editor
    const tr = state.tr
    let changed = false
    state.doc.descendants((node, pos) => {
      if (!node.isText) return
      if (node.marks.some((m) => m.type === type)) return
      // 行内代码不解析双链
      if (node.marks.some((m) => m.type.name === 'code')) return
      const text = node.text || ''
      const re = /\[\[([^\]\n]+?)\]\]/g
      let m
      while ((m = re.exec(text)) !== null) {
        // 嵌入语法 ![[xxx]]：跳过，避免与预览侧嵌入渲染冲突
        if (m.index > 0 && text.charAt(m.index - 1) === '!') continue
        const parsed = parseWikiInner(m[1])
        if (!parsed.target) continue
        const from = pos + m.index
        const to = from + m[0].length
        tr.addMark(from, to, type.create(parsed))
        changed = true
      }
    })
    if (changed) {
      // wikiLinkRescan meta：上层 onUpdate 据此跳过 onChange
      view.dispatch(tr.setMeta('addToHistory', false).setMeta('wikiLinkRescan', true))
    }
  } catch {
    // 静默
  }
}

export default WikiLinkMark

