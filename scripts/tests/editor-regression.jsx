import ExternalFileWindow from '../../src/components/common/ExternalFileWindow'
import { usePrefsStore } from '../../src/store/usePrefsStore'
import PendingActionCard from '../../src/components/ai/PendingActionCard'
import { useDebouncedSave } from '../../src/hooks/useDebouncedSave'
import { flushEditorSaves } from '../../src/utils/editorSaveRegistry'
import { createGenerationTask, getGenerationTaskPhase } from '../../src/utils/aiCore/generationTask'
import { TypewriterText } from '../../src/components/ai/thinking'
import { renderComposer } from '../../src/utils/diagrams/composer'
import { applyScenePatch } from '../../src/utils/diagrams/editScene'
import { generationGallery } from './generation-gallery'
import widgetCSS from '../../electron/services/widgets/runtime/base.css?raw'
import widgetSDK from '../../electron/services/widgets/runtime/sdk.js?raw'
import WidgetProbeHost, { collectProblems, probeWidget } from '../../src/components/widgets/WidgetProbeHost'
import { exportToSvg } from '@excalidraw/excalidraw'
import AICommandCenter from '../../src/components/ai/AICommandCenter'
import MemoryUpdateNotice from '../../src/components/ai/MemoryUpdateNotice'
import { replaceDataImagesInHtml } from '../../src/utils/dataUrlImage'
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
  await test('外部文件：重复保存等待同一请求，保存期间新输入继续落盘，失败阻止关闭', async () => {
    const oldAPI = window.electronAPI, oldMode = usePrefsStore.getState().externalFileMode
    let release, fail = false, saved = [], revision = 0, closed = 0
    usePrefsStore.setState({ externalFileMode: 'edit' })
    window.electronAPI = { ...oldAPI, window: { close: async () => { await flushEditorSaves(); closed++ } }, externalFiles: {
      read: async () => ({ success: true, data: { format: 'text', name: 'external.txt', raw: 'old', content: 'old', writable: true, modifiedAt: 1, revision: 'r0' } }),
      write: async (_path, text, options) => {
        equal(options.expectedRevision, `r${revision}`)
        if (fail) return { success: false, error: 'disk full' }
        await new Promise(resolve => { release = resolve })
        saved.push(text); revision++
        return { success: true, data: { size: text.length, modifiedAt: revision + 1, revision: `r${revision}` } }
      },
    } }
    const edit = async text => {
      const field = document.querySelector('textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true })); await sleep(20)
    }
    const save = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, ctrlKey: true, bubbles: true }))
    try {
      root.render(wrap(<ExternalFileWindow filePath="/tmp/external.txt" />))
      await waitFor(() => document.querySelector('textarea'), 'external editor')
      await edit('first'); save(); await waitFor(() => release, 'first save')
      save()
      let completed = false
      const closing = flushEditorSaves().then(() => { completed = true })
      await edit('second')
      assert(!completed, 'closing bypassed in-flight save')
      const first = release; release = null; first()
      await waitFor(() => release, 'second save')
      equal(saved, ['first']); assert(!completed, 'closing bypassed latest input')
      release(); await closing
      equal(saved, ['first', 'second'])
      fail = true; await edit('third'); save(); await sleep(30)
      let blocked = false
      try { await flushEditorSaves() } catch { blocked = true }
      assert(blocked && document.querySelector('textarea').value === 'third', 'failure lost unsaved input')
      await flushEditorSaves({ reason: 'sync' })
      equal(closed, 0)
      await waitFor(() => [...document.querySelectorAll('button')].some(button => button.textContent === '不保存'), 'close confirmation')
      const discard = [...document.querySelectorAll('button')].find(button => button.textContent === '不保存')
      assert(discard, 'close confirmation missing'); discard.click(); await sleep(30)
      equal(closed, 1); equal(saved, ['first', 'second'])
    } finally {
      release?.()
      root.render(wrap(<div />)); await sleep(30)
      window.electronAPI = oldAPI; usePrefsStore.setState({ externalFileMode: oldMode })
    }
  })

  await test('外部文件白板：等版本替换仍是修改，保存期间新增元素不会被标成已保存', async () => {
    const oldAPI = window.electronAPI, oldMode = usePrefsStore.getState().externalFileMode
    usePrefsStore.setState({ externalFileMode: 'edit' })
    let release, saved = []
    const elements = convertToExcalidrawElements([{ type: 'rectangle', id: 'original', x: 40, y: 40, width: 100, height: 60 }])
    window.electronAPI = { ...oldAPI, externalFiles: {
      read: async () => ({ success: true, data: { format: 'whiteboard', name: 'scene.excalidraw', writable: true, modifiedAt: 1,
        whiteboard: { elements, appState: { viewBackgroundColor: '#ffffff' }, files: {} } } }),
      writeWhiteboard: async (_path, scene) => {
        const snapshot = JSON.parse(JSON.stringify(scene))
        await new Promise(resolve => { release = resolve })
        saved.push(snapshot)
        return { success: true, data: { size: 100, modifiedAt: saved.length + 1 } }
      },
    } }
    const save = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, ctrlKey: true, bubbles: true }))
    try {
      root.render(wrap(<ExternalFileWindow filePath="/tmp/scene.excalidraw" />))
      await waitFor(() => window.h?.app?.scene?.getNonDeletedElements()?.[0]?.id === elements[0].id, 'external board')
      await sleep(100)
      const board = window.h.app
      const replacement = { ...board.scene.getNonDeletedElements()[0], id: 'replacement', x: 70 }
      board.updateScene({ elements: [replacement] }); await sleep(40)
      save(); await waitFor(() => release, 'board first save')
      board.updateScene({ elements: [replacement, { ...replacement, id: 'added', x: 220 }] }); await sleep(40)
      let completed = false
      const closing = flushEditorSaves().then(() => { completed = true })
      const first = release; release = null; first()
      await waitFor(() => release, 'board latest scene save')
      equal(saved[0].elements.map(el => el.id), ['replacement'])
      assert(!completed, 'latest board marked clean too soon')
      release(); await closing
      equal(saved[1].elements.map(el => el.id), ['replacement', 'added'])
      await flushEditorSaves()
    } finally {
      release?.(); root.render(wrap(<div />)); await sleep(40)
      window.electronAPI = oldAPI; usePrefsStore.setState({ externalFileMode: oldMode })
    }
  })
  await test('保存屏障：连续输入有最长等待，失败可重试，保存中新增输入仍会落盘', async () => {
    let hook, value = 0, saved = [], fail = false, release
    const Probe = () => {
      hook = useDebouncedSave(async () => {
        const snapshot = value
        if (fail) return false
        if (release === 'pause') await new Promise(resolve => { release = resolve })
        saved.push(snapshot)
      }, 80, 140)
      return null
    }
    root.render(wrap(<Probe />))
    await waitFor(() => hook, 'save hook')
    const typing = setInterval(() => { value++; hook.debouncedSave() }, 20)
    try { await sleep(230); assert(saved.length > 0, 'continuous typing starved saving') }
    finally { clearInterval(typing) }
    await flushEditorSaves()
    equal(saved.at(-1), value)
    fail = true; value++; hook.debouncedSave()
    let rejected = false
    try { await flushEditorSaves() } catch { rejected = true }
    assert(rejected && hook.hasPendingSave(), 'failed save was acknowledged')
    fail = false; release = 'pause'
    const first = flushEditorSaves()
    await waitFor(() => typeof release === 'function', 'in-flight save')
    value++; hook.debouncedSave()
    release(); release = null
    await first
    equal(saved.at(-1), value)
    assert(!hook.hasPendingSave(), 'latest save remains pending')
    root.render(wrap(<div />)); await sleep(20)
  })
  if (window.acceptanceStorage) await test('Electron验收：图片真实落盘与 SQLite 保存、重开后可解码', async () => {
    const storage = window.acceptanceStorage
    const oldAPI = window.electronAPI
    window.electronAPI = { ...oldAPI, images: { getPath: async path => ({ success: true, data: path }) } }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 32; canvas.height = 24
      canvas.getContext('2d').fillRect(0, 0, 32, 24)
      for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
        const original = canvas.toDataURL(mime)
        const bytes = Uint8Array.from(atob(original.split(',')[1]), char => char.charCodeAt(0))
        const relative = await storage.saveImage(bytes, `pasted.${mime.split('/')[1]}`)
        await mountNote(`![验收图片](${relative})\n\n# 图片后的标题`)
        const created = await storage.createNote(ref.current.getMarkdown())
        assert(created.success, created.error)
        const saved = await storage.readNote(created.data.id)
        assert(saved.success, saved.error)
        await mountNote(saved.data.content)
        await waitFor(() => [...document.querySelectorAll('.tiptap img')].some(img => img.complete && img.naturalWidth === 32), 'real app image decoded')
        equal(await storage.readImage(relative), original)
        const updated = await storage.updateNote(created.data.id, ref.current.getMarkdown())
        assert(updated.success, updated.error)
        equal((await storage.readNote(created.data.id)).data.content, saved.data.content)
      }
    } finally { window.electronAPI = oldAPI }
  })
  await test('审批流程：Mermaid 原生图元保留判断菱形和审核回路', async () => {
    const { renderMermaidNative } = await import('../../src/utils/diagrams/mermaidNative')
    const result = await renderMermaidNative(`flowchart TD
      A([开始]) --> B[提交申请]
      B --> C{负责人审核}
      C -->|通过| D[执行项目]
      D --> E([结束])
      C -->|不通过| F[修改申请]
      F --> G[重新提交]
      G --> C`)
    assert(result.elements.some(element => element.type === 'diamond'), 'review decision shape was lost')
    assert(!result.elements.some(element => element.type === 'image'), 'editable diagram became a flattened image')
    assert(result.elements.filter(element => element.type === 'arrow').length >= 7, 'approval loop lost its edges')
    const { prepareSceneStyle } = await import('../../src/utils/diagrams/sceneStyle')
    const svg = await exportToSvg({ elements: prepareSceneStyle(result.elements, 'neat'), files: result.files || {}, appState: { viewBackgroundColor: '#ffffff', exportBackground: true } })
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%')
    window.approvalFlowSvg = svg.outerHTML
    window.showApprovalFlow = () => { root.render(wrap(<div style={{ padding: 32, height: '100vh', background: '#fff' }} dangerouslySetInnerHTML={{ __html: window.approvalFlowSvg }} />)) }

    // 验收带 subgraph（含中文标题、subgraph[...]、括号标题）的流程图不报 SubGraph element not found 且不退化为图片
    const subgraphResult = await renderMermaidNative(`flowchart TD
      subgraph["感知层 (Sensor)"]
        S1[图像采集] --> S2[特征提取]
      end
      subgraph 核心决策层
        S2 --> D1{风险评估}
        D1 -->|通过| D2[执行动作]
      end`)
    equal(subgraphResult.tier, 1)
    assert(!subgraphResult.elements.some(element => element.type === 'image'), 'subgraph flowchart degraded to static image')
    assert(subgraphResult.elements.filter(element => element.type === 'rectangle').length >= 5, 'subgraph containers or nodes missing')
  })
  await test('Mermaid兼容：只读 API、并发子图与失败清理不污染全局', async () => {
    const mermaid = (await import('mermaid')).default
    const { renderMermaidNative } = await import('../../src/utils/diagrams/mermaidNative')
    const render = mermaid.render, apiRender = mermaid.mermaidAPI.render
    const append = document.body.appendChild
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')
    const sources = [
      'flowchart TD\nsubgraph SG1 ["中文分组"]\n A[输入] --> B[输出]\nend',
      'flowchart LR\nsubgraph OUTER ["外层"]\n subgraph INNER ["内层"]\n A[开始] --> B[结束]\n end\nend',
    ]
    const results = await Promise.all(sources.map(code => renderMermaidNative(code)))
    assert(results.every(result => result.tier === 1), 'subgraphs degraded into images')
    let rejected = false
    try { await renderMermaidNative('flowchart TD\n A[未闭合') } catch { rejected = true }
    assert(rejected, 'invalid syntax should fail')
    equal(document.body.appendChild, append)
    equal(Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').set, descriptor.set)
    equal(mermaid.render, render)
    equal(mermaid.mermaidAPI.render, apiRender)
    assert(!document.querySelector('[id^="mermaid-to-excalidraw-"][id$="-container"]'), 'temporary container leaked')
    equal((await renderMermaidNative(sources[0])).tier, 1)
  })
  await test('局部画布：新增节点与避障连线可由真实 Excalidraw 导出', async () => {
    const { makeRect } = await import('../../src/utils/diagrams/shared')
    const a = { ...makeRect({ x: 40, y: 40, width: 160, height: 80 }), id: 'patch-start' }
    const scene = applyScenePatch([a], {
      updates: [{ id: a.id, changes: { type: 'diamond' } }], remove: [],
      add: [{ id: 'patch-end', type: 'rectangle', x: 360, y: 240, width: 180, height: 80, label: '新增审核节点' }, { id: 'patch-edge', type: 'arrow', from: a.id, to: 'patch-end' }],
    }).elements
    const svg = await exportToSvg({ elements: scene, files: {}, appState: { viewBackgroundColor: '#ffffff', exportBackground: true } })
    assert(svg.textContent.includes('新增审核节点'), 'bound label missing from native export')
    assert(!/NaN|Infinity/.test(svg.outerHTML), 'invalid native geometry')
    equal(scene.find(el => el.id === 'patch-edge').endBinding.elementId, 'patch-end')
    equal(a.type, 'rectangle')
  })
  await test('AI验收：运行卡片可停止，失败提示留在原卡片且可重试', async () => {
    const task = createGenerationTask('acceptance-stop')
    const action = { actionId: 'acceptance-stop', name: 'update_whiteboard', args: { id: 328 }, status: 'running' }
    const show = value => root.render(wrap(<div id="action-acceptance"><PendingActionCard action={value} onExecute={() => {}} /></div>))
    try {
      show(action)
      await waitFor(() => [...document.querySelectorAll('#action-acceptance button')].some(b => b.textContent === '停止生成'), 'stop button')
      const stop = [...document.querySelectorAll('#action-acceptance button')].find(b => b.textContent === '停止生成')
      stop.click()
      await waitFor(() => stop.disabled && stop.textContent === '正在停止', 'cancellation state')
      equal(getGenerationTaskPhase(action.actionId), 'cancelling')
      show({ ...action, status: 'failed', error: '验收：图片保存失败' })
      await waitFor(() => document.querySelector('#action-acceptance').textContent.includes('验收：图片保存失败'), 'inline failure')
      assert([...document.querySelectorAll('#action-acceptance button')].some(b => b.textContent === '重试'), 'retry missing')
    } finally { task.dispose(); root.render(wrap(<div />)) }
  })
  await test('AI体验：逐字输入、停顿、回删与短语切换', async () => {
    const show = text => root.render(wrap(<React.StrictMode><div id="typing-test"><TypewriterText text={text} /></div></React.StrictMode>))
    show('ABC')
    await waitFor(() => document.querySelector('#typing-test'), 'typing mounted')
    const content = () => document.querySelector('#typing-test').textContent
    const frames = []
    const observer = new MutationObserver(() => frames.push(content()))
    observer.observe(document.querySelector('#typing-test'), { childList: true, characterData: true, subtree: true })
    await waitFor(() => content() === 'A', 'first character')
    show('新👩‍💻')
    await waitFor(() => content() === 'ABC', 'old phrase completes without jumping')
    await sleep(400)
    equal(content(), 'ABC')
    await waitFor(() => frames.includes('AB'), 'erasing')
    await waitFor(() => frames.includes(''), 'erased')
    await waitFor(() => content() === '新👩‍💻', 'new phrase and grapheme')
    await waitFor(() => frames.lastIndexOf('新') > frames.indexOf('新👩‍💻'), 'erase entire emoji')
    observer.disconnect()
    root.render(wrap(<div />))
  })
  await test('AI体验：深色卡片在明暗画布真实导出', async () => {
    const result = renderComposer({ type: 'card', props: { w: 480, fill: 'rgb(15, 23, 42)', title: '教学与学习创新', body: '总奖金池 $11,000', titleSize: 32, bodySize: 24 } })
    const panels = []
    for (const dark of [false, true]) {
      const svg = await exportToSvg({ elements: result.elements, files: {}, appState: { viewBackgroundColor: '#ffffff', exportBackground: true, exportWithDarkMode: dark } })
      assert([...svg.querySelectorAll('text')].every(el => el.getAttribute('fill') === '#ffffff'), 'dark banner text must be light before theme filtering')
      assert(Boolean(svg.getAttribute('filter')) === dark, 'theme export filter not applied')
      svg.style.width = '100%'
      svg.style.height = 'auto'
      panels.push(`<div style="flex:1;min-width:0"><p>${dark ? '深色画布' : '浅色画布'}</p>${svg.outerHTML}</div>`)
    }
    window.showColorGallery = async () => {
      root.render(wrap(<div id="color-gallery" style={{ display: 'flex', gap: 24, padding: 24 }} dangerouslySetInnerHTML={{ __html: panels.join('') }} />))
      await waitFor(() => document.querySelector('#color-gallery svg'), 'color gallery')
    }
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
  await test('AI链路：组件实际 SDK 写入、重开读取、窄窗样式与溢出反馈', async () => {
    const records = []
    const frame = document.createElement('iframe')
    frame.style.cssText = 'width:320px;height:240px;border:0'
    document.body.appendChild(frame)
    let health
    const listener = event => {
      if (event.source !== frame.contentWindow || !event.data?.__flota) return
      const msg = event.data
      if (msg.type === 'health') health = msg
      if (msg.type === 'rpc') {
        let result
        if (msg.method === 'data.insert') { records.push({ ...msg.params.data, _id: 'record' }); result = records.at(-1) }
        else if (msg.method === 'data.query') result = records
        else result = null
        frame.contentWindow.postMessage({ __flota: 1, type: 'rpc-result', id: msg.id, result }, '*')
      }
    }
    window.addEventListener('message', listener)
    const html = `<!doctype html><html data-theme="light"><head><style>${widgetCSS}</style></head><body>
      <main class="fl-card"><h1 class="fl-title">本周阅读</h1><p class="fl-muted">记录一点进展，让计划持续发生。</p><button class="fl-btn fl-btn-primary">完成一项</button><p id="count"></p></main>
      <script>${widgetSDK}<\/script><script>
      const rows = flota.data.collection('entries');
      async function refresh(){document.querySelector('#count').textContent = (await rows.query()).length + ' 项已完成';}
      document.querySelector('button').onclick = async () => {await rows.insert({title:'读书'}); await refresh();}; refresh();
      <\/script></body></html>`
    try {
      frame.srcdoc = html
      await waitFor(() => frame.contentDocument?.querySelector('#count')?.textContent === '0 项已完成', 'widget SDK read')
      frame.contentDocument.querySelector('button').click()
      await waitFor(() => records.length === 1 && frame.contentDocument.querySelector('#count').textContent === '1 项已完成', 'widget SDK write')
      await waitFor(() => health, 'widget health')
      assert(health.overflowX <= 8, 'compact widget overflows')
      frame.contentDocument.documentElement.dataset.theme = 'dark'
      assert(frame.contentWindow.getComputedStyle(frame.contentDocument.body).color !== 'rgb(30, 41, 59)', 'dark theme did not apply')
      frame.srcdoc = html
      await waitFor(() => frame.contentDocument?.querySelector('#count')?.textContent === '1 项已完成', 'widget reopened state')
      assert(collectProblems({ errors: [], health: { elements: 5, text: 20, overflowX: 200 } }).some(problem => problem.message.includes('溢出')), 'overflow must fail preflight')
      assert(collectProblems({ skipped: true }).length > 0, 'skipped preflight must fail')
    } finally { window.removeEventListener('message', listener); frame.remove() }
  })
  await test('AI链路：局部 SVG 修改保留尺寸、ID、其他元素及图片', async () => {
    const asset = createSvgAsset('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><text x="20" y="50">旧标题</text></svg>')
    const unrelated = { ...asset.elements[0], id: 'untouched', x: 600 }
    const result = applyScenePatch([...asset.elements, unrelated], { updates: [{ id: asset.elements[0].id, svgSource: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><text x="20" y="50">新标题</text></svg>' }], remove: [] })
    equal(result.elements[0].id, asset.elements[0].id)
    equal(result.elements[0].width, asset.elements[0].width)
    assert(result.elements[1] === unrelated, 'unrelated element changed')
    assert(result.elements[0].fileId !== asset.elements[0].fileId, 'SVG file must be replaced')
  })
  await test('AI链路：后台局部修改保存后保留旧图片索引', async () => {
    const previous = window.electronAPI
    let saved
    const { applyWhiteboardGenerationToNote, buildWhiteboardContent } = await import('../../src/utils/whiteboardAI')
    const elements = [{ id: 'title', type: 'text', text: '旧标题', originalText: '旧标题', x: 10, y: 10, width: 200, height: 20, fontSize: 16 }, { id: 'photo', type: 'image', fileId: 'photo-file', x: 400, y: 10, width: 200, height: 200 }]
    window.electronAPI = { ai: { chat: async () => ({ success: true, data: { content: JSON.stringify({ updates: [{ id: 'title', changes: { text: '新标题' } }], remove: [] }) } }) } }
    try {
      await applyWhiteboardGenerationToNote({ note: { id: 7, note_type: 'whiteboard', content: buildWhiteboardContent({ elements, fileMap: { 'photo-file': { fileName: 'photo.png' } } }) }, action: 'edit', prompt: '修改标题', updateNote: async (id, data) => { saved = JSON.parse(data.content); return { success: true } } })
      equal(saved.fileMap['photo-file'].fileName, 'photo.png')
      equal(saved.elements.find(element => element.id === 'photo').fileId, 'photo-file')
      equal(saved.elements.find(element => element.id === 'title').text, '新标题')
    } finally { window.electronAPI = previous }
  })
  await test('AI链路：StrictMode 不会把重复挂载误判为检查中断', async () => {
    const controller = new AbortController()
    root.render(wrap(<React.StrictMode><WidgetProbeHost /></React.StrictMode>))
    await sleep(100)
    let resolved = false
    const checking = probeWidget('__draft__strict-test', 'full', controller.signal).then(result => { resolved = true; return result })
    await sleep(100)
    assert(!resolved, 'StrictMode cleanup prematurely resolved preflight')
    controller.abort()
    await checking
    root.render(wrap(<div />))
  })
  await test('AI链路：原语样张真实导出、文字与长表格完整呈现', async () => {
    const result = renderComposer(structuredClone(generationGallery))
    const svg = await exportToSvg({ elements: result.elements, files: {}, appState: { viewBackgroundColor: '#f8fafc', exportBackground: true, exportWithDarkMode: false } })
    assert(!/NaN/.test(svg.outerHTML), 'invalid SVG coordinates')
    assert(svg.textContent.includes('更多重点'), 'missing title')
    svg.style.width = '100%'
    svg.style.height = 'auto'
    root.render(wrap(<div id="generation-gallery" style={{ margin: '24px auto', maxWidth: 1180, border: '1px solid #e2e8f0', borderRadius: 20, overflow: 'hidden' }} />))
    await waitFor(() => document.querySelector('#generation-gallery'), 'gallery')
    document.querySelector('#generation-gallery').appendChild(svg)
    const previousAPI = window.electronAPI
    let reviewed
    window.electronAPI = { ai: { getConfig: async () => ({ success: true, data: { visionEnabled: true } }), chat: async messages => { reviewed = messages; return { success: true, data: { content: '{"issues":[]}' } } } } }
    try {
      const { reviewCanvas } = await import('../../src/utils/diagrams/visualReview')
      equal(await reviewCanvas(result, '验收原语样张'), [])
      assert(reviewed[1].content[1].image_url.url.startsWith('data:image/png;base64,'), 'visual review did not receive actual rendered PNG')
    } finally { window.electronAPI = previousAPI }
    window.generationGallerySvg = svg.outerHTML
    window.showGenerationGallery = async () => {
      root.render(wrap(<div id="final-gallery" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: window.generationGallerySvg }} />))
      await waitFor(() => document.querySelector('#final-gallery svg'), 'final gallery')
    }
  })
  await test('画布反馈：已完成卡片的结果不再重复显示为气泡', async () => {
    const oldAPI = window.electronAPI, oldState = useStore.getState()
    const messages = [
      { role: 'user', content: '画个流程图' },
      { role: 'assistant', content: '已准备好', actions: [{ actionId: 'feedback', name: 'create_whiteboard', status: 'done', resultMessage: '画布已生成测试结果' }] },
      { role: 'assistant', content: '画布已生成测试结果', actionResultFor: 'feedback' },
    ]
    window.electronAPI = { ...oldAPI, ai: { getConfig: async () => ({ success: true, data: {} }), onChatChunk: () => () => {} } }
    useStore.setState({ currentView: 'ai', selectedNoteId: null, aiActiveConvId: 'feedback-chat', aiConversations: [{ id: 'feedback-chat', messages }] })
    try {
      root.render(wrap(<AICommandCenter open notesOverride={[]} selectedNoteIdOverride={null} onClose={() => {}} />))
      await waitFor(() => document.body.textContent.includes('画布已生成测试结果'), 'result card')
      equal(document.body.textContent.match(/画布已生成测试结果/g).length, 1)
      equal(useStore.getState().aiConversations[0].messages.length, 3)
    } finally { root.render(wrap(<div />)); window.electronAPI = oldAPI; useStore.setState(oldState) }
  })
  await test('画布 AI 示例明确能力，点击填入草稿而不自动请求', async () => {
    const oldAPI = window.electronAPI
    const oldState = useStore.getState()
    let calls = 0
    window.electronAPI = { ...oldAPI, ai: { getConfig: async () => ({ success: true, data: {} }), onChatChunk: () => () => {}, chatStream: async () => { calls++; return { success: true } } } }
    const note = { id: 'canvas-guide', note_type: 'whiteboard', title: '测试画布', content: '' }
    useStore.setState({ currentView: 'notes', notes: [note], selectedNoteId: note.id, aiActiveConvId: 'canvas-guide-chat', aiNoteConversationMap: { [note.id]: 'canvas-guide-chat' }, aiConversations: [{ id: 'canvas-guide-chat', noteId: note.id, messages: [] }] })
    try {
      root.render(wrap(<AICommandCenter open notesOverride={[note]} selectedNoteIdOverride={note.id} onClose={() => {}} />))
      await waitFor(() => document.body.textContent.includes('想把什么画出来？'), 'canvas AI examples')
      for (const label of ['流程图', '思维导图', '架构图', '文字成图', '局部改图', '读图总结']) assert(document.body.textContent.includes(label), `missing ${label}`)
      const chip = [...document.querySelectorAll('.MuiChip-root')].find(node => node.textContent === '流程图')
      chip.click()
      await waitFor(() => document.querySelector('textarea')?.value.includes('项目审批流程图'), 'example draft')
      equal(calls, 0)
      const read = [...document.querySelectorAll('.MuiChip-root')].find(node => node.textContent === '读图总结')
      read.click()
      await waitFor(() => document.querySelector('textarea')?.value.includes('不修改画布'), 'read-only example draft')
      equal(calls, 0)
    } finally {
      root.render(wrap(<div />)); await sleep(50)
      window.electronAPI = oldAPI; useStore.setState(oldState)
    }
  })
  await test('附件：AI 小窗拖入图片和文本，预览并发送多模态消息', async () => {
    const oldAPI = window.electronAPI
    const oldState = useStore.getState()
    let sent
    window.electronAPI = { ...oldAPI, ai: {
      getConfig: async () => ({ success: true, data: { visionEnabled: true } }),
      onChatChunk: () => () => {},
      chatStream: async messages => { sent = messages; return { success: true, fullContent: '收到附件' } },
    } }
    useStore.setState({ notes: [], selectedNoteId: null, aiActiveConvId: 'attachments-test', aiConversations: [{ id: 'attachments-test', messages: [], title: '附件测试' }] })
    try {
      root.render(wrap(<AICommandCenter open notesOverride={[]} selectedNoteIdOverride={null} onClose={() => {}} />))
      await waitFor(() => document.querySelector('[aria-label="添加图片或文本文件"]'), 'attachment picker')
      await sleep(100)
      const button = document.querySelector('[aria-label="添加图片或文本文件"]')
      const panel = button.closest('.MuiPaper-root')
      const transfer = new DataTransfer()
      transfer.items.add(new File(['任务：23 Oct 2026 截止'], 'dates.txt', { type: 'text/plain' }))
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII='), ch => ch.charCodeAt(0))
      transfer.items.add(new File([png], 'sample.png', { type: 'image/png' }))
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      panel.dispatchEvent(drop)
      assert(drop.defaultPrevented, '文件拖入没有被接管')
      await waitFor(() => panel.textContent.includes('dates.txt') && panel.textContent.includes('sample.png'), 'attachment previews')
      panel.querySelector('[aria-label="发送"]').click()
      await waitFor(() => sent, 'multimodal send')
      const content = sent.at(-1).content
      assert(Array.isArray(content), '图片没有以多模态消息发送')
      assert(content.some(part => part.type === 'text' && part.text.includes('23 Oct 2026')), '文本文件内容丢失')
      assert(content.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')), '图片内容丢失')
      await sleep(100)
    } finally {
      root.render(wrap(<div />))
      await sleep(50)
      window.electronAPI = oldAPI
      useStore.setState({ notes: oldState.notes, selectedNoteId: oldState.selectedNoteId, aiActiveConvId: oldState.aiActiveConvId, aiConversations: oldState.aiConversations })
    }
  })
  await test('附件：本地图片保存、重开、再次保存保持引用与独立段落', async () => {
    const imagePath = 'images/1791354883254_009c361ada6a725f432ad2dcd7f0c485.jpg'
    const markdown = `![照片](${imagePath})\n\n# 图片之后的标题`
    await mountNote(markdown)
    const saved = ref.current.getMarkdown()
    await mountNote(saved)
    const savedAgain = ref.current.getMarkdown()
    equal(savedAgain, saved)
    let src
    editor.state.doc.descendants(node => { if (node.type.name === 'image') src = node.attrs.src })
    equal(src, imagePath)
    assert(types().includes('heading'), '图片吞掉了后续标题')
    const spec = editor.schema.nodes.image.spec.toDOM(editor.schema.nodes.image.create({ src: imagePath }))
    equal(spec[1].src, `app://${imagePath}`)
  })
  await test('附件：临时 Blob 图片持久化后不保留临时地址', async () => {
    const oldAPI = window.electronAPI
    const blobUrl = URL.createObjectURL(new Blob(['test-image'], { type: 'image/jpeg' }))
    let stored
    window.electronAPI = { ...oldAPI, images: { saveFromBuffer: async (buffer, name) => { stored = { buffer, name }; return { success: true, data: 'images/stored.jpg' } } } }
    try {
      const html = await replaceDataImagesInHtml(`<p>前文</p><img src="${blobUrl}"><p>后文</p>`)
      assert(html.includes('images/stored.jpg') && !html.includes('blob:'), html)
      assert(stored.name.endsWith('.jpg'), stored.name)
      equal(new TextDecoder().decode(stored.buffer), 'test-image')
    } finally { window.electronAPI = oldAPI; URL.revokeObjectURL(blobUrl) }
  })
  await test('附件：窄窗口撤销按钮仍保持单行且不被摘要挤压', async () => {
    root.render(wrap(<div style={{ width: 180 }}><MemoryUpdateNotice variant="pill" updates={{ changes: [{ op: 'add', id: 1, content: '这是一条很长很长的记忆摘要，用于测试按钮的收缩问题' }] }} onUndo={() => {}} /></div>))
    await waitFor(() => [...document.querySelectorAll('button')].some(button => button.textContent === '撤销'), 'undo button')
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === '撤销')
    equal(getComputedStyle(button).whiteSpace, 'nowrap')
    equal(getComputedStyle(button).flexShrink, '0')
    assert(button.getBoundingClientRect().width >= 35, '撤销按钮被挤窄')
  })
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
      await sleep(2100) // 等待 1.5 秒防抖及异步保存
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
      await flushEditorSaves()
      root.render(wrap(<div />)); await sleep(50)
      useStore.setState({ updateNote: original, notes: [], selectedNoteId: null })
    }
  })
  await test('类型转换：数据库拒绝时保留画布，重试成功后才切到 Markdown', async () => {
    const originalState = useStore.getState()
    const oldAPI = window.electronAPI
    const note = { id: 'conversion-retry', title: '转换验收', note_type: 'whiteboard', tags: [], content: JSON.stringify({
      type: 'excalidraw', version: 2,
      elements: convertToExcalidrawElements([{ type: 'text', text: '保留这段内容', x: 30, y: 30 }]),
      appState: { viewBackgroundColor: '#ffffff' }, fileMap: {}
    }) }
    let attempts = 0, fail = true
    window.electronAPI = { ...oldAPI, whiteboard: {
      loadImages: async map => ({ success: true, data: map }),
      saveImages: async map => ({ success: true, data: map }),
      savePreview: async () => ({ success: true }),
    } }
    useStore.setState({ notes: [note], selectedNoteId: note.id, currentView: 'notes', editorMode: 'wysiwyg',
      updateNote: async (id, updates) => {
        if (updates.note_type === 'markdown') {
          attempts++
          if (fail) return { success: false, error: '模拟磁盘写入失败' }
        }
        useStore.setState(state => ({ notes: state.notes.map(n => n.id === id ? { ...n, ...updates } : n) }))
        return { success: true, data: { ...note, ...updates } }
      }
    })
    const convert = async () => {
      document.querySelector('button[aria-label="Markdown"]').click()
      await waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent === '确认转换'), 'conversion dialog')
      ;[...document.querySelectorAll('button')].find(b => b.textContent === '确认转换').click()
    }
    try {
      root.render(wrap(<div style={{ height: 700 }}><NoteEditor /></div>))
      await waitFor(() => document.querySelector('.excalidraw canvas'), 'conversion canvas')
      await sleep(400)
      await convert()
      await waitFor(() => attempts === 1, 'failed conversion attempted').catch(error => {
        throw new Error(error.message + JSON.stringify({ attempts, text: document.body.textContent.slice(-1600) }))
      })
      await sleep(100)
      assert(document.querySelector('.excalidraw canvas'), 'failed conversion unmounted original canvas')
      equal(useStore.getState().notes[0].note_type, 'whiteboard')
      await waitFor(() => !document.querySelector('#conversion-dialog-title'), 'failed dialog closed')
      fail = false
      await convert()
      await waitFor(() => document.querySelector('.wysiwyg-editor-content')?.textContent.includes('保留这段内容'), 'conversion committed').catch(error => { throw new Error(error.message + JSON.stringify({ attempts, note: useStore.getState().notes[0], text: document.body.textContent.slice(-1600) })) })
      equal(useStore.getState().notes[0].note_type, 'markdown')
    } finally {
      root.render(wrap(<div />)); await sleep(50)
      window.electronAPI = oldAPI
      useStore.setState(originalState)
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
  await test('笔记复制不改写代码里的反斜杠与双链样例，不混入序列化器函数源码', async () => {
    const inline = '`\\[x\\] \\~name \\[\\[literal\\]\\]`'
    await mountNote('代码示例 ' + inline + '\n\n```js\nconst sample = "\\[x\\]"\n```')
    editor.commands.selectAll()
    const text = clipboardEvent('copy').getData('text/plain')
    assert(text.includes(inline), `inline source changed: ${JSON.stringify(text)}`)
    assert(text.includes('const sample = "\\[x\\]"'), 'fenced code changed')
    const nativeExample = '```js\nString(Math.max) // function max() { [native code] }\n```'
    await mountNote(nativeExample)
    editor.commands.selectAll()
    equal(clipboardEvent('copy').getData('text/plain'), nativeExample)
    await mountNote('原来的内容')
    editor.commands.selectAll()
    const serializer = editor.storage.markdown.serializer
    const original = serializer.serialize
    serializer.serialize = () => '原来的内容 function () { [native code] }'
    try {
      const copied = clipboardEvent('copy').getData('text/plain')
      assert(!copied.includes('native code'), 'serializer garbage leaked to clipboard')
      assert(copied.includes('原来的内容'), 'copy lost actual text')
    } finally { serializer.serialize = original }
  })
  await test('右键复制与快捷键复制的 Markdown 一致，公式可复制，剪切等待期间不删新选区', async () => {
    const clipboard = navigator.clipboard
    const original = Object.getOwnPropertyDescriptor(clipboard, 'writeText')
    let written = [], release = null
    Object.defineProperty(clipboard, 'writeText', { configurable: true, value: async text => {
      written.push(text)
      if (release === 'pending') await new Promise(resolve => { release = resolve })
    } })
    const clickMenu = async label => {
      const coords = editor.view.coordsAtPos(editor.state.selection.from)
      editor.view.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: coords.left + 1, clientY: coords.top + 1 }))
      await waitFor(() => document.querySelector('[data-editor-context-menu]'), 'context menu')
      const button = [...document.querySelectorAll('[data-editor-context-menu] button')].find(node => node.textContent.startsWith(label))
      assert(button && !button.disabled, `${label} unavailable`)
      button.click()
    }
    try {
      for (const source of ['# 标题\n\n**粗体**、[[笔记]]、`\\[literal\\]`\n\n- [x] 完成\n- [ ] 待办', '$E=mc^2$', '| A | B |\n| --- | --- |\n| 甲 | 乙 |']) {
        await mountNote(source)
        editor.commands.selectAll()
        const expected = clipboardEvent('copy').getData('text/plain')
        written = []
        await clickMenu('复制')
        await waitFor(() => written.length === 1, 'copied text')
        equal(written[0], expected)
      }
      await mountNote('原文不能被误删')
      editor.commands.selectAll()
      release = 'pending'
      await clickMenu('剪切')
      await waitFor(() => typeof release === 'function', 'clipboard write pending')
      editor.commands.setTextSelection(2)
      release()
      await sleep(50)
      equal(editor.state.doc.textContent, '原文不能被误删')
    } finally {
      if (original) Object.defineProperty(clipboard, 'writeText', original)
      else delete clipboard.writeText
    }
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
  await test('VS Code 的 Markdown 按格式粘贴，语言元数据优先，代码与代码块内粘贴保持原文', async () => {
    const html = '<div style="font-family: Menlo, monospace;white-space: pre;"><div># 标题</div></div>'
    for (const source of [
      { text: '# 单行标题', metadata: JSON.stringify({ version: 1, mode: 'markdown' }) },
      { text: '# 标题\n\n- 第一项\n- 第二项', metadata: '' },
      { text: '# 标题\n\n- 第一项\n- 第二项', metadata: '{broken' },
      { text: '# 长文\n\n' + '这是一段用于验证长文粘贴完整性的正文。'.repeat(3000) + '\n\n**全文结束**', metadata: JSON.stringify({ version: 1, mode: 'markdown' }) },
    ]) {
      await mountNote('')
      clipboardEvent('paste', { 'text/plain': source.text, 'text/html': html, 'vscode-editor-data': source.metadata })
      assert(types().includes('heading'), 'Markdown became literal text or code')
      assert(!types().includes('codeBlock'), 'Markdown wrapped in code block')
      equal(ref.current.getMarkdown().trim(), source.text)
    }
    await mountNote('')
    const script = '# 安装脚本\n# **说明**\necho ok'
    clipboardEvent('paste', { 'text/plain': script, 'text/html': html, 'vscode-editor-data': JSON.stringify({ version: 1, mode: 'shellscript' }) })
    assert(types().includes('codeBlock') && !types().includes('heading'), 'script misclassified as Markdown')
    await mountNote('```\ncode\n```')
    editor.commands.setTextSelection(3)
    clipboardEvent('paste', { 'text/plain': '# 标题', 'text/html': html, 'vscode-editor-data': JSON.stringify({ version: 1, mode: 'markdown' }) })
    assert(!types().includes('heading'), 'Markdown parsed inside code block')
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
  await test('代码语言菜单使用玻璃表面且筛选选择正常', async () => {
    await mountNote('\`\`\`text\ncode\n\`\`\`')
    document.querySelector('.wysiwyg-code-block [contenteditable="false"]').click()
    await waitFor(() => document.querySelector('[data-code-language-menu]'), 'language menu')
    const menu = document.querySelector('[data-code-language-menu]')
    const style = getComputedStyle(menu)
    assert(style.backdropFilter.includes('blur(24px)'), 'menu misses shared glass blur')
    assert(style.backgroundColor.includes('0.72'), 'menu remains opaque')
    const input = menu.querySelector('input')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(input, 'javascript')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(100)
    const row = [...menu.querySelectorAll('div')].find(el => el.textContent === 'JavaScript')
    assert(row, 'language search lost JavaScript')
    row.click()
    await waitFor(() => !document.querySelector('[data-code-language-menu]'), 'language selected')
    assert(ref.current.getMarkdown().includes('\`\`\`javascript'), 'language not saved')
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
  if (window.legacyAcceptanceScene) await test('原画布验收：第328号画布副本在两种风格恢复颜色且保存不丢元素', async () => {
    const original = window.legacyAcceptanceScene
    const oldAPI = window.electronAPI
    const oldState = useStore.getState()
    let output
    try {
      window.electronAPI = { ...oldAPI, whiteboard: {
        loadImages: async map => ({ success: true, data: map }),
        saveImages: async map => ({ success: true, data: map }),
        savePreview: async () => ({ success: true }),
      } }
      for (const style of ['neat', 'sketchy']) {
        const note = { id: `legacy-${style}`, title: '原画布只读副本', note_type: 'whiteboard', content: JSON.stringify(original) }
        useStore.setState({ notes: [note], theme: 'light', whiteboardStyle: style, updateNote: async () => ({ success: true }) })
        let getter
        root.render(wrap(<div style={{ width: 1200, height: 760 }}><WhiteboardEditor key={style} noteId={note.id} onGetContent={value => { getter = value }} /></div>))
        await waitFor(() => document.querySelector('.excalidraw canvas') && getter, 'legacy editor')
        let content
        for (let attempt = 0; attempt < 50; attempt++) {
          content = await getter()
          if (content && JSON.parse(content).elements.length === original.elements.length) break
          await sleep(100)
        }
        assert(content, 'legacy scene not ready')
        output = JSON.parse(content)
        equal(output.elements.length, original.elements.length)
        const gradients = original.elements.filter(el => String(el.backgroundColor).includes('gradient('))
        assert(gradients.length === 2, 'unexpected source scene')
        for (const shape of gradients) {
          const restored = output.elements.find(el => el.id === shape.id)
          equal(restored.backgroundColor.toLowerCase(), shape.backgroundColor.match(/#[0-9a-f]{6}/i)[0].toLowerCase())
          equal([restored.x, restored.y, restored.width, restored.height], [shape.x, shape.y, shape.width, shape.height])
        }
      }
      const panels = []
      for (const dark of [false, true]) {
        const svg = await exportToSvg({ elements: output.elements, files: {}, appState: { viewBackgroundColor: '#ffffff', exportBackground: true, exportWithDarkMode: dark } })
        svg.style.width = '100%'; svg.style.height = 'auto'
        panels.push(`<div style="flex:1;min-width:0"><p>${dark ? '深色显示' : '浅色显示'}</p>${svg.outerHTML}</div>`)
      }
      window.showLegacyGallery = async () => {
        root.render(wrap(<div id="legacy-gallery" style={{ display: 'flex', gap: 16, padding: 16 }} dangerouslySetInnerHTML={{ __html: panels.join('') }} />))
        await waitFor(() => document.querySelector('#legacy-gallery svg'), 'legacy gallery')
      }
    } finally {
      root.render(wrap(<div />)); await sleep(50)
      window.electronAPI = oldAPI
      useStore.setState(oldState)
    }
  })
  await mountNote('# 数学笔记\n\n勾股定理：$a^2 + b^2 = c^2$。\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n[查看参考文档](<https://example.com/中文(a)?x=1&y=2>)\n\n双击公式可编辑，链接支持直接粘贴。')
  return results
}

window.mountWhiteboard = async () => {
  const originalError = console.error
  window.whiteboardPropWarnings = []
  console.error = (...args) => {
    if (args.join(' ').includes('Failed prop type')) window.whiteboardPropWarnings.push(args.join(' '))
    originalError(...args)
  }
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
  console.error = originalError
  const canvas = document.querySelector('.excalidraw canvas').getBoundingClientRect()
  return {
    rectangle: { x: canvas.left + 130, y: canvas.top + 190 },
    svg: { x: canvas.left + 410, y: canvas.top + 180 },
    mermaid: { x: canvas.left + 670, y: canvas.top + 180 },
  }
}
window.checkWhiteboardToolbar = async () => {
  await test('画布 Portal 控件不会触发 Box children 类型警告', () => equal(window.whiteboardPropWarnings, []))
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
  await test('白板验收：外部保存遇到图片落盘失败必须拒绝不完整内容', async () => {
    const original = window.electronAPI.whiteboard.saveImages
    window.electronAPI.whiteboard.saveImages = async () => ({ success: false, error: '验收磁盘写入失败' })
    try {
      let error
      try { await window.getBoardContent() } catch (caught) { error = caught }
      assert(error?.message.includes('验收磁盘写入失败'), 'image persistence failure was silently ignored')
    } finally { window.electronAPI.whiteboard.saveImages = original }
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
window.openMobileProperties = async () => {
  const restore = document.querySelector('.App-bottom-bar [aria-label="展开属性面板"]')
  restore?.click()
  if (!document.querySelector('.App-mobile-menu')) {
    const edit = [...document.querySelectorAll('.App-bottom-bar [aria-label]')].find(el => /属性|properties|编辑|Edit/i.test(el.getAttribute('aria-label')))
    assert(edit, 'mobile property toggle missing')
    edit.click()
  }
  await waitFor(() => document.querySelector('.App-mobile-menu .flota-properties-header'), 'shared mobile property header')
  await sleep(150)
}
window.checkEmbeddedWhiteboard = async () => {
  document.getElementById('board-host').style.width = '820px'
  document.getElementById('board-host').style.height = '580px'
  await sleep(200)
  await test('嵌入式窄白板的颜色弹窗保持在画布范围内', async () => {
    document.querySelector('button[aria-label="矩形"]').click()
    await waitFor(() => document.querySelector('.App-menu__left .properties-trigger'), 'rectangle color controls')
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
  await test('窄窗和正常尺寸复用绘图工具栏、动画及工具状态', async () => {
    const host = document.getElementById('board-host')
    for (const width of [620, 420, 820]) {
      host.style.width = `${width}px`
      await sleep(350)
      await waitFor(() => document.querySelector('.flota-whiteboard-toolbar button[aria-label="矩形"]'), `toolbar ${width}`)
      assert(document.querySelectorAll('.flota-whiteboard-toolbar').length === 1, 'duplicate toolbar')
      const toolbar = document.querySelector('.flota-whiteboard-toolbar')
      const rect = toolbar.getBoundingClientRect()
      const canvas = document.querySelector('.excalidraw canvas').getBoundingClientRect()
      assert(rect.width > 0 && rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1, `toolbar overflow at ${width}`)
      if (width === 420) {
        await window.openMobileProperties()
        const panel = document.querySelector('.App-mobile-menu').getBoundingClientRect()
        assert(panel.width <= 230 && panel.top >= rect.bottom && panel.bottom <= canvas.bottom, `mobile property panel invalid: ${JSON.stringify(panel.toJSON())}`)
      }
      const button = toolbar.querySelector('button[aria-label="矩形"]')
      assert(getComputedStyle(button).transitionDuration !== '0s', 'button motion lost')
      const target = button.getBoundingClientRect()
      assert(button.contains(document.elementFromPoint(target.left + target.width / 2, target.top + target.height / 2)), `toolbar is obscured at ${width}px`)
      button.click()
      await waitFor(() => button.getAttribute('aria-pressed') === 'true', 'tool active')
      const native = document.querySelector('.App-toolbar--mobile')
      if (native) assert(native.getClientRects().length === 0, 'native mobile toolbar remains visible')
    }
  })
  return results
}
window.showDarkWhiteboard = async () => {
  useStore.setState({ theme: 'dark' })
  await sleep(300)
  return true
}
