const { ipcMain, app, dialog, clipboard, Notification, shell, nativeImage, BrowserWindow, net } = require('electron')
const https = require('https')
const path = require('path')
const fs = require('fs')
const DatabaseManager = require('../dao/DatabaseManager')
const { validateImagePath, validateString, validateUrl } = require('../utils/ipcValidator')
const { getLocalUsageStats } = require('../utils/storageUsage')
const { registerIpcHandlers } = require('./helpers')

const RELEASES_PAGE_URL = 'https://github.com/Xperiamol/Flota/releases'
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Xperiamol/Flota/releases/latest'
const LATEST_RELEASE_WEB_URL = 'https://github.com/Xperiamol/Flota/releases/latest'

const normalizeVersion = (value) => String(value || '')
  .trim()
  .replace(/^v/i, '')
  .split('-')[0]

const compareVersions = (a, b) => {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

const extractVersionFromReleaseUrl = (url) => {
  const matched = String(url || '').match(/\/releases\/tag\/v?([^/?#]+)/i)
  return matched ? normalizeVersion(matched[1]) : ''
}

const resolveLatestReleaseRedirect = (url, headers = {}) => new Promise((resolve, reject) => {
  const request = https.request(url, { method: 'HEAD', headers }, (response) => {
    const location = response.headers.location
    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      resolve(new URL(location, url).toString())
      return
    }
    reject(new Error(`Unexpected status ${response.statusCode || 'unknown'} while resolving latest release redirect`))
  })
  request.on('error', reject)
  request.setTimeout(8000, () => request.destroy(new Error('Timeout while resolving latest release redirect')))
  request.end()
})

async function checkForAppUpdates() {
  const currentVersion = app.getVersion()
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `Flota/${currentVersion}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  try {
    const response = await net.fetch(LATEST_RELEASE_API_URL, { headers })
    if (response.ok) {
      const release = await response.json()
      const latestVersion = normalizeVersion(release?.tag_name || release?.name || '')
      if (!latestVersion) throw new Error('Latest version missing in release payload')
      return {
        success: true,
        data: {
          currentVersion,
          latestVersion,
          hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
          downloadUrl: release?.html_url || RELEASES_PAGE_URL,
          publishedAt: release?.published_at || '',
          source: 'github-api',
        },
      }
    }
  } catch (error) {
    console.warn('[update-check] GitHub API check failed, fallback to releases page:', error?.message || error)
  }
  try {
    const finalUrl = await resolveLatestReleaseRedirect(LATEST_RELEASE_WEB_URL, {
      'User-Agent': `Flota/${currentVersion}`,
    })
    const latestVersion = extractVersionFromReleaseUrl(finalUrl)
    if (!latestVersion) throw new Error('Failed to parse latest version from release redirect URL')
    return {
      success: true,
      data: {
        currentVersion,
        latestVersion,
        hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
        downloadUrl: finalUrl === LATEST_RELEASE_WEB_URL ? RELEASES_PAGE_URL : finalUrl,
        publishedAt: '',
        source: 'github-release-page',
      },
    }
  } catch (error) {
    console.error('[update-check] Release page fallback failed:', error)
    return {
      success: false,
      error: error?.message || 'Check for updates failed',
      data: {
        currentVersion,
        latestVersion: '',
        hasUpdate: false,
        downloadUrl: RELEASES_PAGE_URL,
        publishedAt: '',
        source: 'github-release-page',
      },
    }
  }
}

const getEventWindow = (event) => BrowserWindow.fromWebContents(event.sender)

const registerSystemHandlers = ({ isDev }) => {
  registerIpcHandlers([
    { channel: 'system:get-platform', handler: async () => process.platform },
    { channel: 'system:get-version', handler: async () => app.getVersion() },
    { channel: 'system:check-for-updates', handler: async () => checkForAppUpdates() },
    { channel: 'system:get-path', handler: async (event, name) => app.getPath(name) },
    {
      channel: 'system:get-storage-usage',
      handler: async () => getLocalUsageStats(app.getPath('userData'))
    },
    {
      channel: 'system:show-open-dialog',
      handler: async (event, options) => dialog.showOpenDialog(getEventWindow(event), options)
    },
    {
      channel: 'system:show-save-dialog',
      handler: async (event, options) => dialog.showSaveDialog(getEventWindow(event), options)
    },
    {
      channel: 'system:show-message-box',
      handler: async (event, options) => dialog.showMessageBox(getEventWindow(event), options)
    },
    {
      channel: 'system:write-text',
      handler: async (event, text) => { clipboard.writeText(text); return true }
    },
    { channel: 'system:read-text', handler: async () => clipboard.readText() }
  ])

  ipcMain.handle('system:show-notification', async (event, options) => {
    if (!options.icon) {
      const iconPath = isDev
        ? path.join(__dirname, '../../logo.png')
        : path.join(process.resourcesPath, 'logo.png')
      if (fs.existsSync(iconPath)) {
        options.icon = nativeImage.createFromPath(iconPath)
      }
    }
    const notification = new Notification(options)
    notification.show()
    return { success: true }
  })

  ipcMain.handle('system:open-data-folder', async () => {
    try {
      const dbManager = DatabaseManager.getInstance()
      const dbPath = dbManager.getDatabasePath()
      const dbDir = path.dirname(dbPath)
      await shell.openPath(dbDir)
      return { success: true }
    } catch (error) {
      console.error('打开数据文件夹失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('system:open-external', async (event, url) => {
    try {
      validateUrl(url)
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('打开外部链接失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('system:open-path', async (_event, targetPath) => {
    try {
      validateString(targetPath, '文件路径')
      const errorMessage = await shell.openPath(targetPath)
      if (errorMessage) throw new Error(errorMessage)
      return { success: true }
    } catch (error) {
      console.error('打开本地路径失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('system:read-image-as-base64', async (event, filePath) => {
    try {
      const safePath = validateImagePath(filePath)
      const imageData = await fs.promises.readFile(safePath)
      const ext = path.extname(safePath).toLowerCase().substring(1)
      const mimeType = {
        jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', bmp: 'bmp', webp: 'webp'
      }[ext] || 'jpeg'
      return `data:image/${mimeType};base64,${imageData.toString('base64')}`
    } catch (error) {
      console.error('读取图片文件失败:', error)
      throw new Error('读取图片文件失败: ' + error.message)
    }
  })
}

module.exports = { registerSystemHandlers, checkForAppUpdates }
