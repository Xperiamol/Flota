importScripts('flota.js')

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'flota-clip-selection', title: '剪藏选中内容到 Flota', contexts: ['selection'] })
  chrome.contextMenus.create({ id: 'flota-clip-page', title: '剪藏此页到 Flota', contexts: ['page'] })
  chrome.contextMenus.create({ id: 'flota-clip-link', title: '把链接保存为书签到 Flota', contexts: ['link'] })
})

const notify = (title, message) => chrome.notifications.create({
  type: 'basic',
  iconUrl: 'icons/icon128.png',
  title,
  message: String(message || '').slice(0, 200),
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const { lastCategory, aiSummary, createTodo } = await flotaStorage.get(['lastCategory', 'aiSummary', 'createTodo'])
    const options = { category: lastCategory, aiSummary, createTodo }
    let result
    if (info.menuItemId === 'flota-clip-link') {
      // 链接由 Flota 端抓取标题与封面
      const connection = await flotaDiscover()
      if (!connection?.paired) throw new Error(connection ? '请先点击扩展图标与 Flota 配对' : '没有检测到 Flota，请先打开 Flota 应用')
      result = await flotaRequest(connection.port, 'POST', '/v1/clip', {
        token: connection.token,
        timeout: 60000,
        body: { clip: { kind: 'bookmark', url: info.linkUrl, fetch: true, target: { category: lastCategory } }, options },
      })
    } else {
      result = await flotaClip(tab.id, info.menuItemId === 'flota-clip-selection' ? 'selection' : 'article', options)
    }
    notify(result.duplicate ? '已经剪藏过' : '已剪藏到 Flota', result.title)
  } catch (error) {
    notify('剪藏失败', error.message)
  }
})
