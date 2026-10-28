// Browser integration tests against the actual editor, using existing Vite/ws.
// Set CHROME_PATH when Chromium is installed outside the standard locations.
const { createServer } = require('vite')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const WebSocket = require('ws')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const root = path.resolve(__dirname, '../..')
const waitFor = async (fn, label, timeout = 120000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(200) }
  throw new Error(`Timeout: ${label}`)
}
let server, browser, socket, profile
;(async () => {
  const electronEngine = process.env.EDITOR_ENGINE === 'electron'
  const candidates = [electronEngine ? require('electron') : null, process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
  let executable
  for (const candidate of candidates) { if (await fs.access(candidate).then(() => true, () => false)) { executable = candidate; break } }
  if (!executable) throw new Error('Set CHROME_PATH to a local Chromium browser executable')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, optimizeDeps: { entries: ['scripts/tests/editor-regression.html'] }, logLevel: 'error' })
  await server.listen()
  const port = server.httpServer.address().port
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flota-editor-test-'))
  const browserEnv = { ...process.env }
  delete browserEnv.ELECTRON_RUN_AS_NODE
  const browserArgs = electronEngine ? [path.join(__dirname, 'editor-electron-host.cjs'), `--acceptance-profile=${profile}`] : ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,850', 'about:blank']
  browser = spawn(executable, browserArgs, { windowsHide: true, stdio: 'ignore', env: browserEnv })
  browser.on('error', error => { console.error(error); process.exitCode = 1 })
  const debugPort = await waitFor(() => fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then(value => value.split('\n')[0], () => null), 'Chrome startup', 20000)
  const tabs = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json())
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  let sequence = 0
  const pending = new Map()
  const errors = []
  socket.on('message', raw => {
    const message = JSON.parse(raw)
    if (message.id) { const promise = pending.get(message.id); pending.delete(message.id); if (message.error) promise?.reject(new Error(message.error.message)); else promise?.resolve(message.result) }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.args?.[0]?.value === 'DEBUG') console.log(message.params.args.map(arg => arg.value).join(' '))
    // 页面弹出原生对话框会让所有 evaluate 卡住：记录并关掉
    if (message.method === 'Page.javascriptDialogOpening') {
      errors.push(`Unexpected dialog: ${message.params.type} ${message.params.message}`)
      socket.send(JSON.stringify({ id: ++sequence, method: 'Page.handleJavaScriptDialog', params: { accept: false } }))
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    if (process.env.EDITOR_TRACE) console.log('CDP', method, params.expression?.slice(0, 90) || '')
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)) }, method === 'Runtime.evaluate' ? 180000 : method === 'Page.captureScreenshot' ? 60000 : 20000)
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value) },
      reject: error => { clearTimeout(timer); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    let timer
    const value = await Promise.race([
      call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser evaluation timed out: ' + expression.slice(0, 100))), 180000) }),
    ]).finally(() => clearTimeout(timer))
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text)
    return value.result?.value
  }
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Page.bringToFront')
  const testPage = process.env.EDITOR_SURFACE === 'features' ? 'features-preview.html' : process.env.EDITOR_SURFACE === 'rows' ? 'row-actions-preview.html' : 'editor-regression.html'
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/scripts/tests/${testPage}` })
  await waitFor(async () => {
    if (errors.length) throw new Error(errors.join('\n'))
    return evaluate('window.testReady && typeof window.runEditorTests === "function" && document.readyState === "complete"')
  }, 'test harness')
  await sleep(1500)
  await waitFor(() => evaluate('window.testReady && typeof window.runEditorTests === "function"'), 'dependency reload')
  const output = path.join(root, electronEngine ? 'output/electron-acceptance' : 'output/editor-regression')
  await fs.mkdir(output, { recursive: true })
  const screenshotsEnabled = process.env.EDITOR_SCREENSHOTS !== '0'
  const screenshot = async name => { if (!screenshotsEnabled) return; if (process.env.EDITOR_TRACE) console.log('Screenshot', name); const { data } = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(data, 'base64')) }
  console.log(`Running editor regressions in ${electronEngine ? 'Electron (isolated real storage)' : 'Chrome'}...`)
  if (process.env.EDITOR_FILTER) await evaluate(`window.testFilter = ${JSON.stringify(process.env.EDITOR_FILTER)}`)
  if (process.env.EDITOR_DEBUG) await evaluate(`window.debugSources = ${process.env.EDITOR_DEBUG}`)
  if (process.env.EDITOR_LEGACY_SCENE) await evaluate(`window.legacyAcceptanceScene = ${await fs.readFile(process.env.EDITOR_LEGACY_SCENE, 'utf8')}`)
  if (process.env.EDITOR_SURFACE === 'rows') {
    const point = await evaluate('(() => { const r = document.querySelector(".note-menu-button").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()')
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await sleep(200)
  }
  const noteResults = await evaluate('window.runEditorTests()').catch(async error => {
    const step = await evaluate('window.testStep').catch(() => 'unknown')
    throw new Error(`${error.message}; test step: ${step}`)
  })
  if (process.env.EDITOR_SURFACE === 'features') {
    for (const [view, mode, width, height = 850] of [['ai-settings','light',1200],['ai-settings','dark',1200],['ai-settings','light',500],['settings-search','light',1200],['settings-search','dark',1200],['settings-search','light',500],['ai-capabilities','light',1200],['ai-capabilities','dark',1200],['ai-capabilities','light',500],['christmas-art','light',1200],['christmas-art','dark',1200],['onboarding','light',1200],['onboarding','dark',1200],['onboarding','light',500],['onboarding','light',500,500],['patterns','light',1200],['patterns','dark',1200],['patterns','light',500],['christmas','light',1200],['christmas','dark',1200],['christmas','light',500],['shortcuts','light',1200],['shortcuts','dark',1200],['shortcuts','light',500],['choices','light',1200],['choices','dark',1200],['choices','light',500],['timeline','light',1200],['timeline','dark',1200],['timeline','light',500],['cloud','light',1200],['offline','light',1200],['history','light',1200],['cloud','dark',1200],['offline','dark',1200],['history','dark',1200],['cloud','light',500],['offline','light',500],['history','light',500],['history','light',1200,500],['history','light',500,500]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      if (view === 'ai-capabilities') await evaluate('window.captureCapabilityPause = true')
      await evaluate(`window.showFeature(${JSON.stringify(view)}, ${JSON.stringify(mode)})`)
      if (view === 'onboarding') {
        await evaluate("window.dispatchEvent(new Event('flota:show-onboarding'))")
        await sleep(100)
        await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('带我看看')).click()")
      }
      await sleep(350)
      if (view === 'settings-search') {
        await evaluate(`(() => { const input = document.querySelector('[aria-label="搜索设置"]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '历史'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
        await sleep(100)
      }
      if (view === 'onboarding') noteResults.push({ name: `引导 ${mode} ${width}×${height} 卡片位于窗口内`, ok: await evaluate("(() => { const r = document.querySelector('[data-onboarding-card]').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })()") })
      if (view === 'history') noteResults.push({ name: `历史长文 ${mode} ${width}×${height} 单层滚动且操作可见`, ok: await evaluate('window.checkHistoryLayout()') })
      await screenshot(`feature-${view}-${mode}-${width}-${height}.png`)
      if (view === 'ai-capabilities') {
        await evaluate("document.querySelector('[aria-label=\"新增 Prompt 快捷方式\"]').click()")
        await sleep(200)
        await screenshot(`feature-prompt-editor-${mode}-${width}.png`)
        await evaluate("[...document.querySelectorAll('[aria-label=\"快捷方式编辑面板\"] button')].find(button => button.textContent.trim() === '取消').click()")
        await sleep(50)
        await evaluate("[...document.querySelectorAll('[aria-label=\"快捷方式编辑面板\"] button')].find(button => button.textContent.trim() === '完成').click()")
      }
      if (view === 'onboarding') {
        await evaluate("(async () => { for (let i = 0; i < 4; i++) { [...document.querySelectorAll('button')].find(button => button.textContent.includes('下一步')).click(); await new Promise(resolve => setTimeout(resolve, 50)); } })()")
        await screenshot(`feature-onboarding-ai-${mode}-${width}-${height}.png`)
        await evaluate("(async () => { for (let i = 0; i < 2; i++) { [...document.querySelectorAll('button')].find(button => button.textContent.includes('下一步')).click(); await new Promise(resolve => setTimeout(resolve, 50)); } })()")
        await screenshot(`feature-onboarding-canvas-${mode}-${width}-${height}.png`)
        await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('下一步')).click()")
        await sleep(100)
        await screenshot(`feature-onboarding-special-${mode}-${width}-${height}.png`)
      }
      if (view === 'christmas') {
        await evaluate("(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new CustomEvent('flota:christmas-celebrate', { detail: { kind: 'note' } })); })()")
        await sleep(500)
        await screenshot(`feature-christmas-discovery-${mode}-${width}.png`)
      }
      noteResults.push({ name: `${view} ${mode} ${width}px 无页面横向溢出`, ok: await evaluate('document.documentElement.scrollWidth <= innerWidth') })
    }
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await evaluate("window.showFeature('christmas', 'light')")
    await sleep(200)
    noteResults.push({ name: '圣诞模式尊重减少动态效果设置', ok: await evaluate("!document.querySelector('[data-christmas-snow]') && !document.querySelector('[data-christmas-burst]') && !document.querySelector('[data-christmas-gift]')") })
    await evaluate("window.captureCapabilityPause = false; window.showFeature('ai-capabilities')")
    await sleep(150)
    noteResults.push({ name: '减少动态效果时 AI 能力完整静态显示', ok: await evaluate("document.querySelector('[data-ai-capability-ticker]').textContent.includes('做一个读书打卡组件')") })
    await evaluate("window.showFeature('cloud')")
    await call('Emulation.setEmulatedMedia', { features: [] })
    for (const result of noteResults) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? '\n' + result.error : ''}`)
    await fs.writeFile(path.join(output, 'feature-results.json'), JSON.stringify({ results: noteResults, errors }, null, 2))
    if (noteResults.some(result => !result.ok) || errors.length) process.exitCode = 1
    return
  }
  if (process.env.EDITOR_SURFACE === 'rows') {
    const point = await evaluate('(() => { const r = document.querySelector(".note-menu-button").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()')
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await sleep(200)
    noteResults.push({ name: '按下时无填色及水波纹', ok: await evaluate('(() => { const b = document.querySelector(".note-menu-button"), ripple = b.querySelector(".MuiTouchRipple-root"); return b.matches(":active") && getComputedStyle(b).backgroundColor === "rgba(0, 0, 0, 0)" && (!ripple || getComputedStyle(ripple).display === "none") })()') })
    await screenshot('row-actions-pressed.png')
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await evaluate('document.querySelector("[data-menu-open]").setAttribute("data-menu-open", "false")')
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
    await evaluate('document.activeElement.blur()')
    await sleep(200)
    noteResults.push({ name: '离开行后图标及模糊隐藏', ok: await evaluate('(() => { const b = document.querySelector(".note-menu-button"); return getComputedStyle(b, "::before").opacity === "0" && getComputedStyle(b).pointerEvents === "none" })()') })
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await sleep(200)
    noteResults.push({ name: '悬停重新显示模糊', ok: await evaluate('getComputedStyle(document.querySelector(".note-menu-button"), "::before").opacity === "1"') })
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await evaluate('document.querySelector(".note-menu-button").focus()')
    await sleep(200)
    noteResults.push({ name: '键盘聚焦保留描边及模糊且无填色', ok: await evaluate('(() => { const b = document.querySelector(".note-menu-button"), s = getComputedStyle(b); return b.matches(":focus-visible") && s.outlineStyle !== "none" && s.backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(b, "::before").opacity === "1" })()') })
    await screenshot('row-actions-focus.png')
    await evaluate('document.activeElement.blur(); document.querySelector("[data-menu-open]").setAttribute("data-menu-open", "true")')
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    noteResults.push({ name: '减少动态效果时关闭模糊过渡', ok: await evaluate('getComputedStyle(document.querySelector(".note-menu-button"), "::before").transitionDuration === "0s"') })
    await call('Emulation.setEmulatedMedia', { features: [] })
    await sleep(200)
    await screenshot(process.env.EDITOR_CAPTURE_NAME || 'row-actions.png')
    await call('Emulation.setDeviceMetricsOverride', { width: 760, height: 850, deviceScaleFactor: 1, mobile: false })
    await screenshot('row-actions-narrow.png')
    for (const result of noteResults) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${!result.ok && result.error ? ': ' + result.error : ''}`)
    if (noteResults.some(result => !result.ok)) process.exitCode = 1
    console.log(`${noteResults.filter(r => r.ok).length}/${noteResults.length} row action checks passed`)
    return
  }
  if (screenshotsEnabled && await evaluate('!!window.generationGallerySvg')) {
    await fs.writeFile(path.join(output, 'generation-gallery.svg'), await evaluate('window.generationGallerySvg'))
    await evaluate('window.showGenerationGallery()')
    await evaluate('document.querySelectorAll(".MuiSnackbar-root").forEach(element => element.style.visibility = "hidden")')
    const metrics = await call('Page.getLayoutMetrics')
    const { data: galleryPng } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1280, height: Math.min(3000, metrics.cssContentSize.height), scale: 1 } })
    await fs.writeFile(path.join(output, 'generation-gallery.png'), Buffer.from(galleryPng, 'base64'))
  }
  if (screenshotsEnabled && await evaluate('!!window.showApprovalFlow')) {
    await fs.writeFile(path.join(output, 'approval-flow.svg'), await evaluate('window.approvalFlowSvg'))
    await evaluate('window.showApprovalFlow()')
    await screenshot('approval-flow.png')
  }
  if (screenshotsEnabled && await evaluate('!!window.showColorGallery')) {
    await evaluate('window.showColorGallery()')
    await screenshot('canvas-color-themes.png')
  }
  if (screenshotsEnabled && await evaluate('!!window.showLegacyGallery')) {
    await evaluate('window.showLegacyGallery()')
    await screenshot('legacy-canvas-repaired.png')
  }
  await screenshot('notes.png')
  // 笔记编辑器结果先打印：后面白板部分出错时也能看到序列化/保存回归的结论
  for (const result of noteResults) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `\n${result.error}` : ''}`)
  console.log(`Note editor: ${noteResults.filter(result => result.ok).length}/${noteResults.length} checks passed.`)
  if (noteResults.some(result => !result.ok)) process.exitCode = 1
  if (process.env.EDITOR_ONLY) return
  const points = await evaluate('window.mountWhiteboard()')
  const toolbarCenterBefore = await evaluate('(() => { const rect = document.querySelector(".flota-whiteboard-toolbar").getBoundingClientRect(); return rect.left + rect.width / 2 })()')
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.rectangle, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.rectangle, button: 'left', clickCount: 1 })
  await sleep(150)
  const toolbarCenterAfter = await evaluate('(() => { const rect = document.querySelector(".flota-whiteboard-toolbar").getBoundingClientRect(); return rect.left + rect.width / 2 })()')
  await evaluate(`window.toolbarCenterCheck = ${JSON.stringify({ before: toolbarCenterBefore, after: toolbarCenterAfter })}`)
  await evaluate('document.querySelector(\'button[aria-label="选择"]\').click()')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82 })
  await sleep(80)
  const rectangleShortcut = await evaluate('document.querySelector(\'button[aria-label="矩形"]\').getAttribute("aria-pressed") === "true"')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86 })
  await sleep(80)
  const selectionShortcut = await evaluate('document.querySelector(\'button[aria-label="选择"]\').getAttribute("aria-pressed") === "true"')
  await evaluate(`window.toolbarShortcutCheck = ${JSON.stringify({ rectangle: rectangleShortcut, selection: selectionShortcut })}`)
  await evaluate('window.checkWhiteboardToolbar()')
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.rectangle, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.rectangle, button: 'left', clickCount: 1 })
  for (const kind of ['svg', 'mermaid']) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[kind], button: 'right', clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points[kind], button: 'right', clickCount: 1 })
    await sleep(100)
    const menuHoverPoint = await evaluate('(() => { const item = [...document.querySelectorAll(".context-menu-item")].find(button => button.textContent.includes("复制为 PNG")); if (!item) return null; const rect = item.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })()')
    if (menuHoverPoint) {
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...menuHoverPoint, button: 'none' })
      await sleep(60)
    }
    await screenshot(`whiteboard-${kind}-context-menu.png`)
    await evaluate(`window.checkEditableContextMenu(${JSON.stringify(kind)})`)
  }
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.rectangle, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.rectangle, button: 'left', clickCount: 1 })
  await evaluate('window.checkWhiteboard()')
  await screenshot('whiteboard.png')
  await waitFor(() => evaluate('Boolean(document.querySelector(\'button[aria-label="更多工具与成图"]\'))'), 'toolbar after fit')
  await evaluate('document.querySelector(\'button[aria-label="更多工具与成图"]\').click()')
  await sleep(100)
  await screenshot('whiteboard-tools-menu.png')
  await evaluate('document.querySelector(\'button[aria-label="更多工具与成图"]\').click()')
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.rectangle, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.rectangle, button: 'left', clickCount: 1 })
  await sleep(100)
  const results = await evaluate('window.checkEmbeddedWhiteboard()')
  await screenshot('whiteboard-popover.png')
  await evaluate('window.showDarkWhiteboard()')
  await screenshot('whiteboard-dark.png')
  await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 580, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  await screenshot('whiteboard-narrow.png')
  await evaluate("document.getElementById('board-host').style.width = '420px'")
  await sleep(350)
  await evaluate('window.openMobileProperties()')
  await screenshot('whiteboard-compact.png')
  for (const result of results.slice(noteResults.length)) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `\n${result.error}` : ''}`)
  const failed = results.filter(result => !result.ok)
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  if (errors.length) console.error('Browser exceptions:', errors)
  console.log(`${results.length - failed.length}/${results.length} checks passed. ${screenshotsEnabled ? `Screenshots: ${output}` : 'Screenshots disabled for functional checks'}`)
  if (failed.length || errors.length) process.exitCode = 1
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  socket?.close()
  if (browser && browser.exitCode === null) {
    browser.kill()
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(2000)])
    if (browser.exitCode === null) browser.kill('SIGKILL')
  }
  await server?.close()
  // Only delete the exact temporary profile created above.
  if (profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('flota-editor-test-')) await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
})
