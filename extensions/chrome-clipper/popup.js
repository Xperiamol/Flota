const $ = (id) => document.getElementById(id)
const views = ['loading', 'offline', 'pair', 'clip']
let connection = null

const show = (name) => views.forEach((view) => { $(`view-${view}`).hidden = view !== name })
const message = (text, type = '') => {
  const el = $('message')
  el.hidden = !text
  el.textContent = text || ''
  el.className = `message ${type}`
}

async function loadTargets() {
  try {
    const targets = await flotaRequest(connection.port, 'GET', '/v1/targets', { token: connection.token })
    const { lastCategory, aiSummary, createTodo } = await flotaStorage.get(['lastCategory', 'aiSummary', 'createTodo'])
    const categories = [...new Set([targets.defaultCategory, ...(targets.categories || [])].filter(Boolean))]
    $('category').innerHTML = categories.map((name) => `<option>${name.replace(/</g, '&lt;')}</option>`).join('')
    $('category').value = categories.includes(lastCategory) ? lastCategory : targets.defaultCategory
    $('tag-list').innerHTML = (targets.tags || []).map((tag) => `<option value="${tag.replace(/"/g, '&quot;')}">`).join('')
    $('ai-summary').checked = Boolean(aiSummary)
    $('create-todo').checked = Boolean(createTodo)
  } catch (error) {
    if (error.status === 401) return show('pair')
    message(error.message, 'error')
  }
}

async function init() {
  show('loading')
  message('')
  connection = await flotaDiscover()
  if (!connection) return show('offline')
  if (!connection.paired) return show('pair')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  $('page-title').textContent = tab?.title || ''
  show('clip')
  await loadTargets()
}

$('retry').addEventListener('click', init)

$('pair').addEventListener('click', async () => {
  const code = $('pair-code').value.trim()
  if (!/^\d{6}$/.test(code)) return message('请输入 6 位数字配对码', 'error')
  $('pair').disabled = true
  try {
    await flotaPair(connection.port, code)
    message('配对成功', 'success')
    await init()
  } catch (error) {
    message(error.message, 'error')
  } finally {
    $('pair').disabled = false
  }
})

$('clip').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  const options = {
    category: $('category').value,
    tags: $('tags').value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    aiSummary: $('ai-summary').checked,
    createTodo: $('create-todo').checked,
  }
  await flotaStorage.set({ lastCategory: options.category, aiSummary: options.aiSummary, createTodo: options.createTodo })
  $('clip').disabled = true
  message('正在剪藏…')
  try {
    const result = await flotaClip(tab.id, mode, options)
    message(result.duplicate ? `这篇已经剪藏过：${result.title}` : `已剪藏：${result.title}`, 'success')
  } catch (error) {
    if (error.code === 'UNPAIRED' || error.status === 401) show('pair')
    message(error.message, 'error')
  } finally {
    $('clip').disabled = false
  }
})

init()
