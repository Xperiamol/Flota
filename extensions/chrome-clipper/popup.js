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

// ---- 标签编辑：预填 Flota 里设置的默认标签，回车 / 逗号添加，点常用标签快速加上 ----
let tags = []
let popularTags = []

const renderTags = () => {
  const chips = $('tag-chips')
  chips.textContent = ''
  tags.forEach((tag) => {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.textContent = `#${tag}`
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '×'
    remove.title = `移除 ${tag}`
    remove.addEventListener('click', () => { tags = tags.filter((item) => item !== tag); renderTags() })
    chip.appendChild(remove)
    chips.appendChild(chip)
  })
  const suggest = $('tag-suggest')
  suggest.textContent = ''
  popularTags.filter((tag) => !tags.includes(tag)).slice(0, 8).forEach((tag) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `#${tag}`
    button.addEventListener('click', () => addTag(tag))
    suggest.appendChild(button)
  })
}

const addTag = (raw) => {
  const tag = String(raw || '').trim().replace(/^#/, '')
  if (tag && !tags.includes(tag) && tags.length < 10) tags.push(tag)
  renderTags()
}

$('tag-box').addEventListener('click', () => $('tag-input').focus())
$('tag-input').addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
    event.preventDefault()
    addTag(event.target.value)
    event.target.value = ''
  } else if (event.key === 'Backspace' && !event.target.value && tags.length) {
    tags.pop()
    renderTags()
  }
})
$('tag-input').addEventListener('blur', (event) => { if (event.target.value.trim()) { addTag(event.target.value); event.target.value = '' } })

async function loadTargets() {
  try {
    const targets = await flotaRequest(connection.port, 'GET', '/v1/targets', { token: connection.token })
    const { aiSummary, createTodo } = await flotaStorage.get(['aiSummary', 'createTodo'])
    tags = Array.isArray(targets.defaultTags) ? [...targets.defaultTags] : []
    popularTags = targets.tags || []
    renderTags()
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
  if ($('tag-input').value.trim()) { addTag($('tag-input').value); $('tag-input').value = '' }
  const options = {
    tags: [...tags],
    aiSummary: $('ai-summary').checked,
    createTodo: $('create-todo').checked,
  }
  await flotaStorage.set({ aiSummary: options.aiSummary, createTodo: options.createTodo })
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
