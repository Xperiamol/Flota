import React, { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import WYSIWYGEditor from '../../src/components/editor/WYSIWYGEditor'
import WhiteboardEditor from '../../src/components/editor/WhiteboardEditor'
import MarkdownToolbar from '../../src/components/editor/MarkdownToolbar'
import { ErrorProvider } from '../../src/components/common/ErrorProvider'
import { useStore } from '../../src/store/useStore'
import { createMarkdownRenderer, prepareMarkdownForDisplay } from '../../src/markdown/index'
import { sanitizeMarkdownHtml } from '../../src/markdown/sanitizeHtml'
import { normalizeLinkUrl } from '../../src/utils/linkUtils'
import { pasteEditorText, getClipboardLink, normalizePastedHtml } from '../../src/utils/editorClipboard'
import { htmlFragmentToMarkdown } from '../../src/utils/clipboardConversion'
import { getLocalPathFromFileUrl } from '../../src/utils/fileUrl'
import { chooseWhiteboardPanelPosition } from '../../src/utils/whiteboardPanelLayout'
import { buildExportHtml } from '../../src/utils/noteExport'
import { requestLinkEditor } from '../../src/components/editor/LinkEditorDialog'
import { createSvgAsset } from '../../src/utils/diagrams/svgAsset'

const root = createRoot(document.getElementById('root'))
const ref = createRef()
const theme = createTheme()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = async (fn, label) => { for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(50) } throw new Error(`Timeout: ${label}`) }
const assert = (value, message) => { if (!value) throw new Error(message) }
const equal = (actual, expected) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
const results = []
const test = async (name, fn) => { window.testStep = name; try { await fn(); results.push({ name, ok: true }) } catch (error) { results.push({ name, ok: false, error: error.stack }) } }
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
  useStore.setState({ notes: [{ id: 'board-test', title: '白板交互检查', note_type: 'whiteboard', content }], theme: 'light', whiteboardStyle: 'neat', updateNote: async () => ({ success: true }) })
  localStorage.removeItem('flota.whiteboard.propertiesCollapsed')
  root.render(wrap(<div id="board-host" style={{ width: '100vw', height: '100vh' }}><WhiteboardEditor noteId="board-test" onGetContent={getter => { window.getBoardContent = getter }} /></div>))
  await waitFor(() => document.querySelector('.excalidraw canvas'), 'whiteboard canvas')
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
