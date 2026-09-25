// 与本机 Flota 通信：发现端口、配对、剪藏。popup 与 background 共用。
const FLOTA_PORTS = [47831, 47832, 47833, 47834, 47835]

const flotaStorage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
}

async function flotaRequest(port, method, path, { body, token, timeout = 8000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.error || `请求失败（${response.status}）`)
      error.status = response.status
      error.code = data.code
      throw error
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

/** 找到正在运行的 Flota：优先上次成功的端口 */
async function flotaDiscover() {
  const { port: lastPort, token } = await flotaStorage.get(['port', 'token'])
  const ports = lastPort ? [lastPort, ...FLOTA_PORTS.filter((p) => p !== lastPort)] : FLOTA_PORTS
  for (const port of ports) {
    try {
      const info = await flotaRequest(port, 'GET', '/v1/ping', { token, timeout: 1500 })
      if (info?.app === 'Flota') {
        await flotaStorage.set({ port })
        return { port, token, paired: Boolean(info.paired), version: info.version }
      }
    } catch {
      // 继续尝试下一个端口
    }
  }
  return null
}

async function flotaPair(port, code) {
  const result = await flotaRequest(port, 'POST', '/v1/pair', { body: { code, name: `Chrome 扩展（${navigator.platform || '浏览器'}）` } })
  await flotaStorage.set({ token: result.token, port })
  return result
}

/** 在当前标签页中提取内容：mode = article | selection | bookmark */
async function flotaExtract(tabId, mode) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['vendor/Readability.js', 'vendor/turndown.js', 'vendor/turndown-plugin-gfm.js', 'extract.js'],
  })
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m) => window.__flotaExtract(m),
    args: [mode],
  })
  if (!result) throw new Error('无法读取这个页面（浏览器内置页面不支持剪藏）')
  if (result.error) throw new Error(result.error)
  return result
}

async function flotaClip(tabId, mode, options = {}) {
  const connection = await flotaDiscover()
  if (!connection) throw Object.assign(new Error('没有检测到 Flota，请先打开 Flota 应用'), { code: 'OFFLINE' })
  if (!connection.paired) throw Object.assign(new Error('还没有与 Flota 配对'), { code: 'UNPAIRED' })
  const clip = await flotaExtract(tabId, mode)
  clip.target = { category: options.category || undefined, tags: options.tags || [] }
  return flotaRequest(connection.port, 'POST', '/v1/clip', {
    token: connection.token,
    timeout: 180000,
    body: { clip, options: { aiSummary: options.aiSummary, createTodo: options.createTodo } },
  })
}
