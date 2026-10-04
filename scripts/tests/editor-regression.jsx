import React, { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import WYSIWYGEditor from '../../src/components/editor/WYSIWYGEditor'
import NoteEditor from '../../src/components/editor/NoteEditor'
import WhiteboardEditor from '../../src/components/editor/WhiteboardEditor'
import MarkdownToolbar from '../../src/components/editor/MarkdownToolbar'
import { ErrorProvider } from '../../src/components/common/ErrorProvider'
import { useStore } from '../../src/store/useStore'
import { createMarkdownRenderer, prepareMarkdownForDisplay } from '../../src/markdown/index'
import { sanitizeMarkdownHtml } from '../../src/markdown/sanitizeHtml'
import { normalizeLinkUrl } from '../../src/utils/linkUtils'
import { pasteEditorText, getClipboardLink, normalizePastedHtml, looksLikeMarkdown } from '../../src/utils/editorClipboard'
import { htmlFragmentToMarkdown } from '../../src/utils/clipboardConversion'
import { getLocalPathFromFileUrl } from '../../src/utils/fileUrl'
import { chooseWhiteboardPanelPosition } from '../../src/utils/whiteboardPanelLayout'
import { buildExportHtml } from '../../src/utils/noteExport'
import { requestLinkEditor } from '../../src/components/editor/LinkEditorDialog'
import { subscribeNotify } from '../../src/utils/notify'
import { createSvgAsset } from '../../src/utils/diagrams/svgAsset'

const root = createRoot(document.getElementById('root'))
const ref = createRef()
const theme = createTheme()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = async (fn, label) => { for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(50) } throw new Error(`Timeout: ${label}`) }
const assert = (value, message) => { if (!value) throw new Error(message) }
const equal = (actual, expected) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
const results = []
const test = async (name, fn) => { if (window.testFilter && !name.includes(window.testFilter)) return; window.testStep = name; try { await fn(); results.push({ name, ok: true }) } catch (error) { results.push({ name, ok: false, error: error.stack }) } }
const wrap = children => <ThemeProvider theme={theme}><CssBaseline /><ErrorProvider>{children}</ErrorProvider></ThemeProvider>
let editor
let noteCounter = 0
const mountNote = async content => {
  editor = null
  root.render(wrap(<div style={{ maxWidth: 880, margin: '24px auto', padding: 24 }}>
    <h2>公式与链接</h2>
    <WYSIWYGEditor key={++noteCounter} noteId={`test-${noteCounter}`} ref={ref} content={content} onChange={() => {}} onEditorReady={value => { editor = value; window.testEditor = value }} />
  </div>))
  await waitFor(() => editor && !editor.isDestroyed, 'note editor')
  await sleep(50)
}
const types = () => { const found = []; editor.state.doc.descendants(node => { found.push(node.type.name) }); return found }
const mathSources = () => { const found = []; editor.state.doc.descendants(node => { if (/Math$/.test(node.type.name)) found.push(node.attrs.latex) }); return found }
const links = () => { const found = []; editor.state.doc.descendants(node => { node.marks.forEach(mark => { if (mark.type.name === 'link') found.push(mark.attrs.href) }) }); return found }

window.runEditorTests = async () => {
  await test('网址规范化保留编码、查询参数和锚点', () => {
    equal(normalizeLinkUrl(' https://example.com/a(b)?x=a%26b&next=%2Fhome#章节 '), 'https://example.com/a(b)?x=a%26b&next=%2Fhome#%E7%AB%A0%E8%8A%82')
    equal(normalizeLinkUrl('www.example.com/a'), 'https://www.example.com/a')
    equal(normalizeLinkUrl('example.com:8080/a'), 'https://example.com:8080/a')
    equal(normalizeLinkUrl('mailto:me@example.com'), 'mailto:me@example.com')
    equal(normalizeLinkUrl('https://example.com/?user=me@example.com'), 'https://example.com/?user=me@example.com')
    equal(normalizeLinkUrl('javascript:alert(1)'), '')
    equal(getClipboardLink('1.23'), null)
  })
  await test('Markdown 预览支持四种公式分隔符并保留代码、金额', () => {
    const md = createMarkdownRenderer()
    const html = sanitizeMarkdownHtml(md.render(prepareMarkdownForDisplay(String.raw`行内 $E=mc^2$ 与 \(a_1+b_2\)。

$$
\frac{1}{2}
$$

\[
\sum_{i=1}^n i
\]

价格 $5 和 $10；代码 \`$literal$\`。`.replaceAll('\\`', '`'))))
    const div = document.createElement('div'); div.innerHTML = html
    equal(div.querySelectorAll('math').length, 4)
    assert(div.textContent.includes('价格 $5 和 $10'), 'currency changed')
    assert(div.querySelector('code')?.textContent.includes('$literal$'), 'code changed')
  })
  await test('公式清洗保留渲染、拒绝 HTML 注入', () => {
    const html = sanitizeMarkdownHtml('<div data-type="math-block" data-latex="x^2" onclick="alert(1)"><img src=x onerror=alert(1)></div><unknown><img src="https://example.com/x" onerror="alert(1)"></unknown>')
    assert(html.includes('<math'), 'MathML lost')
    assert(!/onerror|onclick/.test(html), 'event handler survived')
  })
  await test('同一段多个双链（别名、章节）保存后不变成乱码', async () => {
    const source = '[[B]] 与 [[B|别名]] 和 ![[B]]，见 [[B#章节]]。'
    await mountNote(source)
    const stored = ref.current.getMarkdown()
    assert(!stored.includes('native code'), `garbage: ${stored}`)
    assert(stored.includes(source), `wiki links changed: ${stored}`)
  })
  // ── 随机化序列化回归：覆盖 4.1.3 修过的"function () { [native code] }"乱码以及各种格式组合 ──
  // 固定种子，失败可复现；每轮：随机源文 → 打开 → 保存 → 重开 → 再保存，两次结果必须一致且没有函数源码
  const GARBAGE = /native code|function\s*\w*\s*\(/
  const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const FRAGMENTS = [
    '[[B]]', '[[B|别名]]', '[[B#章节]]', '[[笔记 A|别名#小节]]', '![[B]]', '[[B]][[C]]',
    '**粗体**', '*斜体*', '~~删除~~', '`code`', '==高亮==', '=={#fde68a}黄色高亮==', '++下划线++',
    '<span style="color:#ef4444">红字</span>', '[链接](https://example.com/a(b)?x=1)',
    '$x^2$', '中文', 'plain', ' ', '  ', '，', '。', '😀', 'a < b', '&lt;div&gt;', '#tag', '$5',
    '**[[B]] 粗体里的双链**', '*[[B|别名]]*', '~~[[B#章节]]~~', '<span style="color:#3b82f6">[[B]] 蓝</span>',
  ]
  const randomParagraph = (rand) => {
    const n = 1 + Math.floor(rand() * 7)
    let out = ''
    for (let i = 0; i < n; i++) out += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)] + (rand() < 0.5 ? ' ' : '')
    return out.trim() || '空'
  }
  const randomSource = (rand) => {
    const blocks = []
    const count = 1 + Math.floor(rand() * 4)
    for (let i = 0; i < count; i++) {
      const roll = rand()
      const p = randomParagraph(rand)
      if (roll < 0.1) blocks.push(`# ${p}`)
      else if (roll < 0.2) blocks.push(`- ${p}\n- ${randomParagraph(rand)}`)
      else if (roll < 0.3) blocks.push(`> ${p}`)
      else if (roll < 0.38) blocks.push(`- [ ] ${p}`)
      else if (roll < 0.46) blocks.push(`${p}\n${randomParagraph(rand)}`)
      else blocks.push(p)
    }
    return blocks.join('\n\n')
  }
  await test('随机格式组合（双链/颜色/高亮/粗斜体/链接/公式）保存重开稳定且不出乱码', async () => {
    const rand = seeded(20261004)
    for (let i = 0; i < 160; i++) {
      const source = randomSource(rand)
      await mountNote(source)
      // 直接看序列化器的原始输出：保存兜底会拦下乱码，测试不能被它掩盖
      const raw = editor.storage.markdown.getMarkdown()
      assert(!GARBAGE.test(raw), `#${i} serializer garbage\nsource: ${source}\nraw: ${raw}`)
      const first = ref.current.getMarkdown()
      assert(!GARBAGE.test(first), `#${i} garbage after first save\nsource: ${source}\nstored: ${first}`)
      const text = editor.state.doc.textContent
      await mountNote(first)
      assert(editor.state.doc.textContent === text, `#${i} text changed on reopen\nsource: ${JSON.stringify(source)}\nstored: ${JSON.stringify(first)}\nbefore: ${JSON.stringify(text)}\nafter:  ${JSON.stringify(editor.state.doc.textContent)}`)
      const second = ref.current.getMarkdown()
      assert(!GARBAGE.test(second), `#${i} garbage after reopen\nsource: ${source}\nstored: ${second}`)
      assert(second === first, `#${i} not stable on reopen\nsource: ${source}\nfirst:  ${JSON.stringify(first)}\nsecond: ${JSON.stringify(second)}`)
    }
  })
  await test('随机编辑（加粗/斜体/颜色/高亮/链接/输入双链）后每次自动保存都不出乱码', async () => {
    const rand = seeded(42)
    const emitted = []
    const mountTracked = async content => {
      editor = null
      root.render(wrap(<div style={{ maxWidth: 880, margin: '24px auto', padding: 24 }}>
        <WYSIWYGEditor key={++noteCounter} noteId={`test-${noteCounter}`} ref={ref} content={content} onChange={value => emitted.push(value)} onEditorReady={value => { editor = value }} />
      </div>))
      await waitFor(() => editor && !editor.isDestroyed, 'note editor')
      await sleep(30)
    }
    const ops = [
      ed => ed.chain().toggleBold().run(),
      ed => ed.chain().toggleItalic().run(),
      ed => ed.chain().toggleStrike().run(),
      ed => ed.chain().toggleCode().run(),
      ed => ed.chain().toggleUnderline().run(),
      ed => ed.chain().toggleHighlight().run(),
      ed => ed.chain().toggleHighlight({ color: '#fde68a' }).run(),
      ed => ed.chain().setTextColor('#ef4444').run(),
      ed => ed.chain().unsetTextColor().run(),
      ed => ed.chain().setLink({ href: 'https://example.com/x' }).run(),
      ed => ed.chain().insertContent({ type: 'text', text: ' [[B]] ' }).run(),
      ed => ed.chain().insertContent({ type: 'text', text: '[[B|别名]]' }).run(),
      ed => ed.chain().insertContent({ type: 'text', text: ' 文字 ' }).run(),
      ed => ed.chain().setHardBreak().run(),
    ]
    for (let i = 0; i < 60; i++) {
      const source = randomSource(rand)
      await mountTracked(source)
      for (let step = 0; step < 8; step++) {
        const size = editor.state.doc.content.size
        const a = 1 + Math.floor(rand() * Math.max(1, size - 2))
        const b = Math.min(size - 1, a + Math.floor(rand() * 12))
        try { editor.commands.setTextSelection({ from: a, to: Math.max(a, b) }) } catch { continue }
        ops[Math.floor(rand() * ops.length)](editor)
      }
      await sleep(170) // 等 120ms 的合并保存发出
      const raw = editor.storage.markdown.getMarkdown()
      assert(!GARBAGE.test(raw), `#${i} serializer garbage\nsource: ${source}\nraw: ${raw}`)
      const stored = ref.current.getMarkdown()
      const bad = [...emitted, stored].find(value => GARBAGE.test(value))
      assert(!bad, `#${i} garbage emitted\nsource: ${source}\nstored: ${bad}`)
      // 随机选区会把 [[ ]]、** 拆成半截，这种文档的重开稳定性不在这里要求，只要求绝不写出乱码
      await mountTracked(stored)
      const reopened = ref.current.getMarkdown()
      assert(!GARBAGE.test(reopened), `#${i} garbage after reopen\nstored: ${reopened}`)
      emitted.length = 0
    }
  })
  // 调试用：EDITOR_DEBUG='["源文"]' 时打印每段源文保存后的结果与文档结构
  if (window.debugSources) await test('DEBUG', async () => {
    for (const source of (window.debugSources || [])) {
      await mountNote(source)
      console.log('DEBUG', JSON.stringify(source), '=>', JSON.stringify(ref.current.getMarkdown()), JSON.stringify(editor.getJSON()))
    }
  })
  await test('常见格式叠加（高亮里加粗/上色、整段双链加斜体等）保存重开不变', async () => {
    const select = (needle) => {
      let from = null
      editor.state.doc.descendants((node, pos) => {
        if (from === null && node.isTextblock && node.textContent.includes(needle)) from = pos + 1 + node.textContent.indexOf(needle)
        return from === null
      })
      assert(from !== null, `missing ${needle}`)
      editor.commands.setTextSelection({ from, to: from + needle.length })
    }
    const cases = [
      ['今天要做的重要事情', [['重要事情', c => c.toggleHighlight()], ['重要', c => c.toggleBold()]]],
      ['今天要做的重要事情', [['今天要做的重要事情', c => c.toggleHighlight({ color: '#fde68a' })], ['做的', c => c.setTextColor('#ef4444')]]],
      ['红色里有高亮的字', [['红色里有高亮的字', c => c.setTextColor('#ef4444')], ['高亮', c => c.toggleHighlight()]]],
      ['参见 [[笔记B|别名]] 和 [[C#章节]] 两篇', [['[[笔记B|别名]]', c => c.toggleItalic()], ['[[C#章节]]', c => c.toggleBold()]]],
      ['参见 [[笔记B]] 和 [[C]]', [['参见 [[笔记B]] 和 [[C]]', c => c.setTextColor('#3b82f6')]]],
      ['参见 [[笔记B]] 和 [[C]]', [['参见 [[笔记B]] 和 [[C]]', c => c.toggleHighlight()]]],
      ['加粗 斜体 删除 下划线', [['加粗 斜体', c => c.toggleBold()], ['斜体', c => c.toggleItalic()], ['删除 下划线', c => c.toggleStrike()], ['下划线', c => c.toggleUnderline()]]],
      ['链接文字里有粗体', [['链接文字里有粗体', c => c.setLink({ href: 'https://example.com/a(b)' })], ['粗体', c => c.toggleBold()]]],
      ['写 a=b 与 x == y', [['a=b 与 x', c => c.toggleHighlight()]]],
      ['重要的红字后面', [['重要的红字后面', c => c.toggleBold()], ['重要的红字', c => c.setTextColor('#ef4444')]]],
      ['重要的红字后面', [['重要的红字', c => c.setTextColor('#ef4444')], ['重要的红字后面', c => c.toggleBold()]]],
      ['前面高亮下划线后面', [['高亮下划线', c => c.toggleHighlight()], ['下划线', c => c.toggleUnderline()]]],
      ['粗体整句里高亮一词', [['粗体整句里高亮一词', c => c.toggleBold()], ['高亮', c => c.toggleHighlight()]]],
      ['斜体开头的高亮', [['斜体开头', c => c.toggleItalic()], ['斜体开头的高亮', c => c.toggleHighlight()]]],
    ]
    // 同一颜色可能存成 #ef4444 或 rgb(239, 68, 68)
    const hexColor = c => { const m = String(c).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/); return m ? '#' + m.slice(1, 4).map(n => (+n).toString(16).padStart(2, '0')).join('') : String(c).toLowerCase() }
    for (const [source, steps] of cases) {
      await mountNote(source)
      for (const [needle, apply] of steps) { select(needle); apply(editor.chain()).run() }
      const marksOf = () => { const out = []; editor.state.doc.descendants(node => { if (node.isText) out.push(`${node.text}:${node.marks.map(mark => mark.type.name + (mark.attrs.color ? `(${hexColor(mark.attrs.color)})` : '')).sort().join('+')}`) }); return out.join('|') }
      const before = marksOf()
      const stored = ref.current.getMarkdown()
      assert(!GARBAGE.test(stored), stored)
      await mountNote(stored)
      assert(marksOf() === before, `formatting changed on reopen\nstored: ${JSON.stringify(stored)}\nbefore: ${before}\nafter:  ${marksOf()}`)
      equal(ref.current.getMarkdown(), stored)
    }
    // 粗体紧贴中文引号：CommonMark 不认 `的**“`，序列化时把 ** 挪进引号内——粗体范围变小，但文字一个不少
    await mountNote('前面的“引号里加粗”后面')
    select('“引号里加粗”'); editor.chain().toggleBold().run()
    await mountNote(ref.current.getMarkdown())
    equal(editor.state.doc.textContent, '前面的“引号里加粗”后面')
  })
  await test('序列化器一旦写出函数源码，保存兜底拒绝写入并保留原内容', async () => {
    const emitted = []
    editor = null
    root.render(wrap(<WYSIWYGEditor key={++noteCounter} noteId={`test-${noteCounter}`} ref={ref} content="原来的内容 [[B]]" onChange={value => emitted.push(value)} onEditorReady={value => { editor = value }} />))
    await waitFor(() => editor && !editor.isDestroyed, 'note editor')
    const original = editor.storage.markdown.getMarkdown
    editor.storage.markdown.getMarkdown = () => '原来的内容 [[B]]function () { [native code] }'
    try {
      editor.chain().focus('end').insertContent('新输入').run()
      await sleep(200)
      assert(!emitted.some(value => GARBAGE.test(value)), `garbage emitted: ${emitted}`)
      equal(ref.current.getMarkdown(), '原来的内容 [[B]]')
    } finally {
      editor.storage.markdown.getMarkdown = original
    }
  })
  await test('打开着的笔记被云同步更新：没在编辑就换成新版本，正在编辑则不覆盖', async () => {
    const saved = []
    const original = useStore.getState().updateNote
    const note = { id: 'sync-open', title: '同步中的笔记', content: '电脑上的旧内容', note_type: 'markdown', tags: [], updated_at: '2026-10-01 10:00:00' }
    useStore.setState({ notes: [note], selectedNoteId: 'sync-open', currentView: 'notes', editorMode: 'wysiwyg', updateNote: async (id, updates) => { saved.push({ id, ...updates }); useStore.setState(state => ({ notes: state.notes.map(item => item.id === id ? { ...item, ...updates } : item) })); return { success: true, data: { ...note, ...updates } } } })
    try {
      root.render(wrap(<div style={{ height: 600 }}><NoteEditor /></div>))
      await waitFor(() => document.querySelector('.wysiwyg-editor-content')?.textContent.includes('电脑上的旧内容'), 'note editor mounted')
      // 同步下载了新版本 → 编辑器跟着换
      useStore.setState(state => ({ notes: state.notes.map(item => ({ ...item, content: '手机上改过的新内容', updated_at: '2026-10-01 10:05:00' })) }))
      await waitFor(() => document.querySelector('.wysiwyg-editor-content')?.textContent.includes('手机上改过的新内容'), 'synced content shown')
      // 用户接着打字，保存的是"新内容 + 输入"，不是旧内容
      const tiptap = document.querySelector('.wysiwyg-editor-content').editor
      tiptap.commands.insertContentAt(1, '补充：')
      await sleep(3600) // NoteEditor 防抖 3 秒保存
      assert(saved.length > 0, 'nothing saved')
      const last = saved[saved.length - 1].content
      assert(last.includes('手机上改过的新内容') && last.includes('补充：'), `saved stale content: ${last}`)
      // 有未保存的输入时，同步来的版本不覆盖编辑器
      tiptap.commands.insertContentAt(1, '未保存')
      await sleep(200)
      useStore.setState(state => ({ notes: state.notes.map(item => ({ ...item, content: '又一个远端版本' })) }))
      await sleep(300)
      assert(document.querySelector('.wysiwyg-editor-content').textContent.includes('未保存'), 'unsaved typing was overwritten')
    } finally {
      useStore.setState({ updateNote: original, notes: [], selectedNoteId: null })
    }
  })
  await test('打开着的画布被云同步更新：没在编辑就载入新版本', async () => {
    window.electronAPI = { ...(window.electronAPI || {}), whiteboard: {
      saveImages: async (files) => ({ success: true, data: files || {} }),
      loadImages: async (fileMap) => ({ success: true, data: fileMap || {} }),
      savePreview: async () => ({ success: true }),
    } }
    const scene = (ids) => JSON.stringify({ type: 'excalidraw', version: 2, elements: convertToExcalidrawElements(ids.map((id, index) => ({ id, type: 'rectangle', x: 40 + index * 160, y: 40, width: 120, height: 80 }))), appState: { viewBackgroundColor: '#ffffff' }, fileMap: {} })
    const original = useStore.getState().updateNote
    useStore.setState({ notes: [{ id: 'board-sync', title: '同步画布', note_type: 'whiteboard', content: scene(['a']) }], updateNote: async () => ({ success: true }) })
    let getContent = null
    try {
      root.render(wrap(<div style={{ width: 900, height: 600 }}><WhiteboardEditor noteId="board-sync" onGetContent={getter => { getContent = getter }} /></div>))
      await waitFor(() => document.querySelector('.excalidraw canvas') && getContent, 'whiteboard canvas')
      await sleep(500)
      const count = async () => JSON.parse(await getContent()).elements.filter(element => !element.isDeleted).length
      equal(await count(), 1)
      useStore.setState(state => ({ notes: state.notes.map(note => ({ ...note, content: scene(['a', 'b', 'c']) })) }))
      for (let i = 0; i < 40 && await count() !== 3; i++) await sleep(100)
      equal(await count(), 3)
    } finally {
      useStore.setState({ updateNote: original, notes: [] })
    }
  })
  await test('JS 笔记里真的写着 "function () { [native code] }" 时照常保存', async () => {
    await mountNote('```js\nString(Math.max) // function max() { [native code] }\n```\n\n正文 function () { [native code] }')
    const stored = ref.current.getMarkdown()
    assert(stored.includes('function max() { [native code] }'), stored)
    assert(stored.includes('function () { \\[native code\\] }') || stored.includes('function () { [native code] }'), stored)
  })
  await test('正文里的 <div>、&lt; 字面文字重开两次后仍在', async () => {
    const source = '手打 &lt;div&gt; 与 &lt;/think&gt; 和 &amp;lt; 以及 a < b'
    await mountNote(source)
    const text = editor.state.doc.textContent
    await mountNote(ref.current.getMarkdown())
    await mountNote(ref.current.getMarkdown())
    equal(editor.state.doc.textContent, text)
  })
  await test('段内单个换行保存重开后保持（不再并成一行）', async () => {
    const stable = [
      '第一行\n第二行\n第三行',
      '> 引用一\n> 引用二',
      '> [!note] 提示\n> 内容',
      '- 项目\n  续行\n- 第二项',
      '诗句一，\n诗句二。\n\n下一段',
      '连续\\\n\\\n两个换行',
      '| a | b |\n| --- | --- |\n| 1<br>2 | 3 |',
      '```\n代码 1\n代码 2\n```',
    ]
    for (const source of stable) {
      await mountNote(source)
      const stored = ref.current.getMarkdown()
      equal(stored.trim(), source)
      await mountNote(stored)
      equal(ref.current.getMarkdown(), stored)
    }
    // 旧笔记里的 `\` 续行照样读成换行，存成普通换行
    await mountNote('旧写法\\\n下一行')
    equal(ref.current.getMarkdown().trim(), '旧写法\n下一行')
  })
  await test('换行后以 - # 1. 开头的文字重开后不变成列表或标题', async () => {
    for (const line of ['- 不是列表', '# 不是标题', '1. 不是编号', '> 不是引用']) {
      await mountNote('开头')
      editor.chain().focus('end').setHardBreak().insertContent({ type: 'text', text: line }).run()
      const stored = ref.current.getMarkdown()
      await mountNote(stored)
      equal(types().filter(type => type !== 'text'), ['paragraph', 'hardBreak'])
      equal(editor.state.doc.textContent, `开头${line}`)
    }
  })
  await test('Shift+Enter 换行保存为普通换行', async () => {
    await mountNote('甲')
    editor.chain().focus('end').setHardBreak().insertContent('乙').run()
    equal(ref.current.getMarkdown().trim(), '甲\n乙')
  })
  const clipboardEvent = (type, data = {}) => {
    const transfer = new DataTransfer()
    Object.entries(data).forEach(([format, value]) => transfer.setData(format, value))
    editor.view.dom.dispatchEvent(new ClipboardEvent(type, { clipboardData: transfer, bubbles: true, cancelable: true }))
    return transfer
  }
  await test('全选复制出去的纯文本是干净的 Markdown，公式带源码', async () => {
    await mountNote('见 [[笔记B|别名]]，路径 ~/a，[注]\n\n\n\n> [!note] 提示\n> 内容\n\n公式 $E=mc^2$')
    editor.commands.focus(); editor.commands.selectAll()
    const copied = clipboardEvent('copy')
    const plain = copied.getData('text/plain')
    assert(!/[\u200B\u00A0]/.test(plain), `hidden characters: ${JSON.stringify(plain)}`)
    equal(plain, '见 [[笔记B|别名]]，路径 ~/a，[注]\n\n\n\n> [!note] 提示\n> 内容\n\n公式 $E=mc^2$')
    assert(copied.getData('text/html').includes('$E=mc^2$'), 'formula missing from copied HTML')
  })
  await test('粘贴多行纯文本保留换行与空行，保存与原文一致', async () => {
    await mountNote('')
    clipboardEvent('paste', { 'text/plain': '第一行\n第二行\n\n\n\n隔了多行\n结尾 $5' })
    equal(ref.current.getMarkdown().trim(), '第一行\n第二行\n\n\n\n隔了多行\n结尾 \\$5')
  })
  await test('AI 回答等明显的 Markdown 按格式粘贴，普通文本和脚本保持原样', async () => {
    assert(!looksLikeMarkdown('#!/bin/bash\n# 安装依赖\nnpm i'), 'shell script treated as Markdown')
    assert(!looksLikeMarkdown('2*3*4\n价格 $5'), 'plain text treated as Markdown')
    await mountNote('')
    clipboardEvent('paste', { 'text/plain': '# 标题\n\n这是**重点**\n\n- 一\n- 二' })
    equal(ref.current.getMarkdown().trim(), '# 标题\n\n这是**重点**\n\n- 一\n- 二')
    // 提示里的「保持原文」：撤掉格式化，按原样文字插入
    await mountNote('')
    let action = null
    const unsubscribe = subscribeNotify(payload => { if (payload.action) action = payload.action })
    clipboardEvent('paste', { 'text/plain': '# 标题\n\n- 一\n- 二' })
    unsubscribe()
    assert(action, 'no keep-original action offered')
    action.onClick()
    equal(types().filter(type => type === 'heading' || type === 'bulletList').length, 0)
    assert(editor.state.doc.textContent.includes('# 标题'), editor.state.doc.textContent)
    await mountNote('```\ncode\n```')
    editor.commands.setTextSelection(3)
    clipboardEvent('paste', { 'text/plain': '# 标题\n\n- 一\n- 二' })
    equal(types().filter(type => type === 'heading').length, 0)
  })
  await test('VS Code 复制的代码粘成代码块，背景色不存成 color:null', async () => {
    await mountNote('')
    clipboardEvent('paste', {
      'text/plain': 'const a = 1\n  go()',
      'text/html': '<div style="color: #d4d4d4;font-family: Consolas, monospace;white-space: pre;"><div><span style="color: #569cd6;">const</span> a = 1</div><div>&nbsp; go()</div></div>',
    })
    equal(ref.current.getMarkdown().trim(), '```\nconst a = 1\n  go()\n```')
    await mountNote('')
    clipboardEvent('paste', { 'text/plain': '注意', 'text/html': '<p><span style="background-color:yellow">注意</span></p>' })
    assert(!ref.current.getMarkdown().includes('color:null'), ref.current.getMarkdown())
  })
  await test('公式加载、序列化和重开保持 LaTeX', async () => {
    const source = '公式 $a_1 + b^2$。\n\n$$\n\\begin{aligned}\na &= b + c \\\\\n\n  d &= \\frac{1}{2}\n\\end{aligned}\n$$'
    await mountNote(source)
    equal(mathSources().length, 2)
    const original = mathSources()
    const stored = ref.current.getMarkdown()
    assert(stored.includes('$$\n'), 'block delimiter missing')
    await mountNote(stored)
    equal(mathSources(), original)
    equal(document.querySelectorAll('.math-node math').length, 2)
  })
  await test('连续插入的行内公式保存重开后保持稳定', async () => {
    await mountNote('')
    editor.commands.insertContent([
      { type: 'inlineMath', attrs: { latex: 'a_1' } },
      { type: 'inlineMath', attrs: { latex: 'b^2' } },
      { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
    ])
    equal(mathSources(), ['a_1', 'b^2', 'E = mc^2'])
    const stored = ref.current.getMarkdown()
    assert(stored.includes('$a_1$ $b^2$ $E = mc^2$'), `ambiguous math: ${stored}`)
    await mountNote(stored)
    equal(mathSources(), ['a_1', 'b^2', 'E = mc^2'])
    equal(ref.current.getMarkdown(), stored)
  })
  await test('键盘输入行内公式支持转换及撤销', async () => {
    await mountNote('')
    editor.commands.insertContent({ type: 'text', text: '$x^2' })
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', fn => fn(editor.view, from, to, '$'))
    assert(handled, 'input rule did not handle closing delimiter')
    equal(mathSources(), ['x^2'])
    editor.commands.undoInputRule()
    assert(editor.state.doc.textContent.includes('$x^2$'), 'input undo lost source')
  })
  await test('粘贴公式段落，保留普通标点及代码围栏', async () => {
    await mountNote('')
    pasteEditorText(editor.view, '说明 $a_1$ 和 **普通文本**\n\n$$\n\\frac{a}{b}\n$$\n\n```\n$literal$\n```')
    equal(mathSources(), ['a_1', '\\frac{a}{b}'])
    assert(editor.state.doc.textContent.includes('**普通文本**'), 'literal punctuation changed')
    assert(editor.state.doc.textContent.includes('$literal$'), 'fenced code changed')
  })
  await test('独立公式快捷输入不丢失后续段落', async () => {
    await mountNote('$$\n\n后续段落')
    editor.commands.setTextSelection(3)
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', fn => fn(editor.view, from, to, ' '))
    assert(handled, 'block input rule did not run')
    equal(mathSources(), ['E = mc^2'])
    assert(editor.state.doc.textContent.includes('后续段落'), 'following paragraph lost')
  })
  await test('选中文字粘贴网址保留标签，撤销恢复', async () => {
    await mountNote('查看文档')
    editor.commands.setTextSelection({ from: 1, to: 5 })
    pasteEditorText(editor.view, 'example.com/a(b)?x=1&y=2')
    equal(editor.state.doc.textContent, '查看文档')
    equal(links(), ['https://example.com/a(b)?x=1&y=2'])
    editor.commands.undo()
    equal(editor.state.doc.textContent, '查看文档')
    equal(links(), [])
  })
  await test('链接粘贴经过实际编辑器处理器，保存重开可点击', async () => {
    await mountNote('')
    const data = new DataTransfer()
    data.setData('text/plain', 'https://example.com/中文(a)?key=a%26b#section')
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    const expected = normalizeLinkUrl(data.getData('text/plain'))
    equal(links(), [expected])
    const stored = ref.current.getMarkdown()
    await mountNote(stored)
    equal(links(), [expected])
  })
  await test('多行链接和 Markdown 链接标签可识别', async () => {
    await mountNote('')
    pasteEditorText(editor.view, '[文档](https://example.com/a(b))')
    equal(editor.state.doc.textContent, '文档')
    equal(links(), ['https://example.com/a(b)'])
    await mountNote('')
    pasteEditorText(editor.view, '请看 https://example.com/a\n另见 www.example.org/b')
    equal(links().length, 2)
  })
  await test('代码块和无格式粘贴保持原始文本', async () => {
    await mountNote('```text\ncode\n```')
    editor.commands.setTextSelection(3)
    pasteEditorText(editor.view, 'https://example.com\n$x^2$')
    equal(types().filter(type => type === 'codeBlock').length, 1)
    equal(links(), [])
    equal(mathSources(), [])
    const saved = ref.current.getMarkdown()
    await mountNote(saved)
    equal(mathSources(), [])
    assert(editor.state.doc.textContent.includes('$x^2$'), 'code dollars changed on reopen')
    await mountNote('')
    pasteEditorText(editor.view, 'https://example.com $x$', { plain: true })
    equal(links(), [])
    equal(mathSources(), [])
    await mountNote(ref.current.getMarkdown())
    equal(mathSources(), [])
    assert(editor.state.doc.textContent.includes('$x$'), 'literal dollars changed on reopen')
  })
  await test('网页链接与本地文件链接保留括号、空格', async () => {
    const source = htmlFragmentToMarkdown('<p><a href="https://example.com/a(b)?x=1&amp;y=2">[文档]</a></p>')
    await mountNote(source)
    equal(editor.state.doc.textContent, '[文档]')
    equal(links(), ['https://example.com/a(b)?x=1&y=2'])
    await mountNote('[文件](<file:///C:/Docs/a%20(b).pdf>)')
    equal(links(), ['file:///C:/Docs/a%20(b).pdf'])
    equal(getLocalPathFromFileUrl('file:///C:/Docs/a%20(b).pdf'), 'C:/Docs/a (b).pdf')
    equal(getLocalPathFromFileUrl('file://server/share/a.pdf'), '//server/share/a.pdf')
  })
  await test('从网页复制的 KaTeX 公式保留源码', async () => {
    const html = normalizePastedHtml('<span class="katex"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span>')
    await mountNote('')
    editor.commands.insertContent(html)
    equal(mathSources(), ['x^2'])
  })
  await test('公式弹窗可以编辑、取消及保存', async () => {
    await mountNote('$x^2$')
    document.querySelector('.math-node [role="button"]').click()
    await waitFor(() => document.querySelector('[role="dialog"] textarea'), 'math dialog')
    const field = document.querySelector('[role="dialog"] textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '\\sqrt{x}')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(50)
    ;[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === '保存').click()
    await sleep(100)
    equal(mathSources(), ['\\sqrt{x}'])
  })
  await test('新增链接弹窗保留选区并自动补全协议', async () => {
    await mountNote('链接文字')
    editor.commands.setTextSelection({ from: 1, to: 5 })
    requestLinkEditor(editor)
    await waitFor(() => document.querySelector('[role="dialog"] input'), 'link dialog')
    const field = document.querySelector('[role="dialog"] input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'example.com/a(b)')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(50)
    ;[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === '确定').click()
    await sleep(100)
    equal(editor.state.doc.textContent, '链接文字')
    equal(links(), ['https://example.com/a(b)'])
  })
  await test('HTML 导出包含可离线显示的公式与完整链接', async () => {
    const html = await buildExportHtml({ title: '公式导出', content: '结果 $x^2$。\n\n$$\n\\frac{a}{b}\n$$\n\n[链接](<https://example.com/a(b)?x=1&y=2>)' })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    equal(doc.querySelectorAll('math').length, 2)
    equal(doc.querySelector('a').getAttribute('href'), 'https://example.com/a(b)?x=1&y=2')
    equal(doc.querySelectorAll('script[src], link[rel="stylesheet"]').length, 0)
  })
  await test('属性面板选择低遮挡位置，窗口边界内且位置稳定', () => {
    const options = { width: 1000, height: 700, panelWidth: 210, panelHeight: 430, selection: { left: 30, top: 100, right: 200, bottom: 300 } }
    const position = chooseWhiteboardPanelPosition(options)
    equal(position.side, 'right-top')
    equal(chooseWhiteboardPanelPosition({ ...options, previous: position.side }).side, position.side)
    assert(position.left + 210 <= 1000, 'outside canvas')
  })
  await mountNote('# 数学笔记\n\n勾股定理：$a^2 + b^2 = c^2$。\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n[查看参考文档](<https://example.com/中文(a)?x=1&y=2>)\n\n双击公式可编辑，链接支持直接粘贴。')
  return results
}

window.mountWhiteboard = async () => {
  const baseElements = convertToExcalidrawElements([{ id: 'left-shape', type: 'rectangle', x: 40, y: 140, width: 180, height: 100, backgroundColor: '#a5d8ff', fillStyle: 'solid' }])
  const svg = createSvgAsset('<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="80" rx="12" fill="#91a7ff"/><text x="60" y="46" text-anchor="middle" font-size="18">SVG</text></svg>', { offsetX: 350, offsetY: 140 })
  const mermaid = createSvgAsset('<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="80" rx="12" fill="#b2f2bb"/><text x="60" y="46" text-anchor="middle" font-size="15">Mermaid</text></svg>', { offsetX: 610, offsetY: 140 })
  mermaid.elements[0] = { ...mermaid.elements[0], customData: { kind: 'mermaid-image', mermaidSource: 'sequenceDiagram\n  Alice->>Bob: Hello' } }
  const elements = [...baseElements, ...svg.elements, ...mermaid.elements]
  const fileMap = { ...svg.files, ...mermaid.files }
  const content = JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, selectedElementIds: {} }, fileMap })
  // 浏览器里没有 Electron 预加载的 API：画布图片原样当作已保存（只测交互，不测落盘）
  window.electronAPI = { ...(window.electronAPI || {}), whiteboard: {
    saveImages: async (files) => ({ success: true, data: Object.fromEntries(Object.entries(files || {}).map(([id, file]) => [id, { ...file }])) }),
    loadImages: async (fileMap) => ({ success: true, data: fileMap || {} }),
    savePreview: async () => ({ success: true }),
  } }
  useStore.setState({ notes: [{ id: 'board-test', title: '白板交互检查', note_type: 'whiteboard', content }], theme: 'light', whiteboardStyle: 'neat', updateNote: async () => ({ success: true }) })
  localStorage.removeItem('flota.whiteboard.propertiesCollapsed')
  root.render(wrap(<div id="board-host" style={{ width: '100vw', height: '100vh' }}><WhiteboardEditor noteId="board-test" onGetContent={getter => { window.getBoardContent = getter }} /></div>))
  try { await waitFor(() => document.querySelector('.excalidraw canvas'), 'whiteboard canvas') } catch (error) { throw new Error(`${error.message}; page: ${document.getElementById('root').innerText.slice(0, 300)}`) }
  await sleep(700)
  const canvas = document.querySelector('.excalidraw canvas').getBoundingClientRect()
  return {
    rectangle: { x: canvas.left + 130, y: canvas.top + 190 },
    svg: { x: canvas.left + 410, y: canvas.top + 180 },
    mermaid: { x: canvas.left + 670, y: canvas.top + 180 },
  }
}
window.checkWhiteboardToolbar = async () => {
  await test('Flota 工具栏切换工具并统一承载高级工具与成图', async () => {
    const toolbar = document.querySelector('.flota-whiteboard-toolbar')
    assert(toolbar?.closest('.shapes-section'), 'custom toolbar is outside native toolbar slot')
    assert(!document.querySelector('.flota-create-trigger'), 'duplicate create button returned')
    const selection = toolbar.querySelector('button[aria-label="选择"]')
    assert(selection?.getAttribute('aria-pressed') === 'true', 'selection tool state is not visible')
    const rectangleTool = toolbar.querySelector('button[aria-label="矩形"]')
    rectangleTool.click(); await waitFor(() => rectangleTool.getAttribute('aria-pressed') === 'true', 'rectangle active feedback')
    selection.click(); await waitFor(() => selection.getAttribute('aria-pressed') === 'true', 'selection active feedback')
    const more = toolbar.querySelector('button[aria-label="更多工具与成图"]')
    assert(more, 'missing unified more menu')
    assert(window.toolbarShortcutCheck?.rectangle, 'R shortcut did not switch to rectangle')
    assert(window.toolbarShortcutCheck?.selection, 'V shortcut did not switch back to selection')
    more.click(); await waitFor(() => [...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.includes('Mermaid 图表')), 'unified tool menu')
    const menu = document.querySelector('[role="menu"]')
    const menuText = menu.textContent
    assert(menuText.includes('画框') && menuText.includes('嵌入网页') && menuText.includes('激光笔'), 'advanced drawing tools are missing')
    assert(menuText.includes('Mermaid 图表') && menuText.includes('SVG 源码'), 'create actions are missing')
    assert(getComputedStyle(more).backgroundColor !== 'rgba(0, 0, 0, 0)', 'open menu button does not fill its rounded square')
    const menuSurface = getComputedStyle(menu.closest('.MuiPaper-root'))
    assert(parseFloat(menuSurface.borderRadius) >= 10, 'menu does not use app corner radius')
    assert(menuSurface.backdropFilter.includes('blur'), 'menu does not use app glass surface')
    more.click()
    await waitFor(() => !document.querySelector('[role="menu"]'), 'create menu close')
  })
  await test('富文本 Markdown 公式自动转换且代码和金额保持原样', async () => {
    const html = normalizePastedHtml('<p>公式 <span>$x^2$</span> 和 \\(y+1\\)</p><p>$$<br>\\frac{a}{b}<br>$$</p><pre><code>$literal$</code></pre><p>价格 $5 和 $10</p>')
    await mountNote('')
    editor.commands.insertContent(html)
    equal(mathSources(), ['x^2', 'y+1', '\\frac{a}{b}'])
    assert(editor.state.doc.textContent.includes('$literal$'), 'code changed')
    assert(editor.state.doc.textContent.includes('价格 $5 和 $10'), 'currency changed')
    const saved = ref.current.getMarkdown()
    await mountNote(saved)
    equal(mathSources(), ['x^2', 'y+1', '\\frac{a}{b}'])
  })
  return results
}
window.checkWhiteboard = async () => {
  await test('选中元素前后绘图工具栏保持居中', () => {
    assert(window.toolbarCenterCheck, 'missing toolbar position sample')
    assert(Math.abs(window.toolbarCenterCheck.before - window.toolbarCenterCheck.after) < 1, `toolbar moved: ${JSON.stringify(window.toolbarCenterCheck)}`)
  })
  await test('真实白板选中图形后属性栏避开图形且可收起展开', async () => {
    await waitFor(() => document.querySelector('.App-menu__left'), 'properties panel')
    await sleep(150)
    const panel = document.querySelector('.App-menu__left')
    const rect = panel.getBoundingClientRect()
    const canvas = document.querySelector('.excalidraw canvas').getBoundingClientRect()
    assert(rect.left >= canvas.left + 220 || rect.top >= canvas.top + 250, `panel overlaps selection: ${JSON.stringify(rect.toJSON())}`)
    assert(rect.bottom <= canvas.bottom - 45, 'panel overlaps bottom controls')
    assert(!document.querySelector('[aria-label="白板辅助工具"]'), 'standalone toolbar returned')
    const toggle = document.querySelector('button[aria-label="收起属性面板"]')
    assert(toggle, 'missing toggle')
    toggle.click(); await sleep(80)
    equal(getComputedStyle(panel).display, 'none')
    equal(localStorage.getItem('flota.whiteboard.propertiesCollapsed'), 'true')
    const reopen = document.querySelector('button[aria-label="展开属性面板"]')
    assert(reopen && reopen.closest('.zoom-actions'), 'restore button is not in zoom controls')
    reopen.click(); await sleep(80)
    assert(getComputedStyle(panel).display !== 'none', 'panel did not reopen')
    const fit = document.querySelector('button[aria-label="适应内容"]')
    assert(fit?.closest('.zoom-actions'), 'fit button is not in zoom controls')
    fit.click(); await sleep(80)
    const toolbar = document.querySelector('.flota-whiteboard-toolbar')
    assert(toolbar?.closest('.shapes-section'), 'custom toolbar is outside native toolbar slot')
    assert(!document.querySelector('.flota-create-trigger'), 'duplicate create button returned')
    const toolbarBounds = toolbar.getBoundingClientRect()
    const canvasBounds = document.querySelector('.excalidraw canvas').getBoundingClientRect()
    assert(toolbarBounds.width > 0 && toolbarBounds.left >= canvasBounds.left && toolbarBounds.right <= canvasBounds.right, `toolbar outside canvas: ${JSON.stringify(toolbarBounds.toJSON())}`)
  })
  return results
}
window.checkEditableContextMenu = async (kind) => {
  const label = kind === 'mermaid' ? '编辑 Mermaid 源码' : '编辑 SVG 源码'
  const title = kind === 'mermaid' ? '编辑 Mermaid DSL' : '编辑 SVG 源码'
  await test(`${kind === 'mermaid' ? 'Mermaid' : 'SVG'} 图片可从元素右键菜单编辑`, async () => {
    await waitFor(() => document.querySelector(`button[aria-label="${label}"]`), `${kind} context action`)
    const action = document.querySelector(`button[aria-label="${label}"]`)
    assert(action.closest('.context-menu'), 'edit action is outside native context menu')
    assert(action.parentElement === action.closest('.context-menu').firstElementChild, 'edit action is not first in context menu')
    const menuBounds = action.closest('.popover').getBoundingClientRect()
    const canvasBounds = document.querySelector('.excalidraw canvas').getBoundingClientRect()
    assert(menuBounds.bottom <= canvasBounds.bottom - 7, `context menu clipped: ${JSON.stringify(menuBounds.toJSON())}`)
    const nativeMenuStyle = getComputedStyle(action.closest('.context-menu'))
    assert(parseFloat(nativeMenuStyle.borderRadius) >= 10, 'native context menu does not use app corner radius')
    assert(nativeMenuStyle.backdropFilter.includes('blur'), 'native context menu does not use app glass surface')
    action.click()
    await waitFor(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.textContent.includes(title)), `${kind} editor dialog`)
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(item => item.textContent.includes(title))
    const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent.includes('取消'))
    assert(cancel, 'missing dialog cancel')
    cancel.click()
    await waitFor(() => ![...document.querySelectorAll('[role="dialog"]')].some(item => item.textContent.includes(title)), `${kind} editor close`)
  })
  return results
}
window.testReady = true
window.checkEmbeddedWhiteboard = async () => {
  document.getElementById('board-host').style.width = '820px'
  document.getElementById('board-host').style.height = '580px'
  await sleep(200)
  await test('嵌入式窄白板的颜色弹窗保持在画布范围内', async () => {
    const trigger = document.querySelector('.App-menu__left .properties-trigger')
    trigger.click()
    await waitFor(() => document.querySelector('[data-radix-popper-content-wrapper] .color-picker-content'), 'color popover')
    await sleep(200)
    const rect = document.querySelector('[data-radix-popper-content-wrapper]').getBoundingClientRect()
    const canvas = document.querySelector('.excalidraw canvas').getBoundingClientRect()
    assert(rect.left >= canvas.left && rect.right <= canvas.right && rect.bottom <= canvas.bottom, `popover clipped: ${JSON.stringify(rect.toJSON())}`)
    trigger.click()
    await waitFor(() => !document.querySelector('[data-radix-popper-content-wrapper] .color-picker-content'), 'color popover close')
  })
  return results
}
window.showDarkWhiteboard = async () => {
  useStore.setState({ theme: 'dark' })
  await sleep(300)
  return true
}
