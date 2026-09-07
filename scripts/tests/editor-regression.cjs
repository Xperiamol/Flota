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
  const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
  let executable
  for (const candidate of candidates) { if (await fs.access(candidate).then(() => true, () => false)) { executable = candidate; break } }
  if (!executable) throw new Error('Set CHROME_PATH to a local Chromium browser executable')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, optimizeDeps: { entries: ['scripts/tests/editor-regression.html'] }, logLevel: 'error' })
  await server.listen()
  const port = server.httpServer.address().port
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flota-editor-test-'))
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,850', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
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
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text)
    return value.result?.value
  }
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/scripts/tests/editor-regression.html` })
  await waitFor(async () => {
    if (errors.length) throw new Error(errors.join('\n'))
    return evaluate('window.testReady && typeof window.runEditorTests === "function" && document.readyState === "complete"')
  }, 'test harness')
  await sleep(1500)
  await waitFor(() => evaluate('window.testReady && typeof window.runEditorTests === "function"'), 'dependency reload')
  const output = path.join(root, 'output/editor-regression')
  await fs.mkdir(output, { recursive: true })
  const screenshot = async name => { const { data } = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(data, 'base64')) }
  console.log('Running editor browser regressions...')
  await evaluate('window.runEditorTests()')
  await screenshot('notes.png')
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
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `\n${result.error}` : ''}`)
  const failed = results.filter(result => !result.ok)
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  if (errors.length) console.error('Browser exceptions:', errors)
  console.log(`${results.length - failed.length}/${results.length} checks passed. Screenshots: output/editor-regression`)
  if (failed.length || errors.length) process.exitCode = 1
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  socket?.close()
  if (browser && browser.exitCode === null) {
    browser.kill()
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(2000)])
  }
  await server?.close()
  // Only delete the exact temporary profile created above.
  if (profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('flota-editor-test-')) await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
})
