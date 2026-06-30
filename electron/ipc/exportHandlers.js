const { ipcMain, dialog, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

// 笔记导出：Markdown / HTML 直接落盘；PDF / PNG 用离屏窗口渲染自包含 HTML 后导出。
// 渲染层已把图片内联为 base64、并把 CSS 一起拼进 html，所以离屏窗口无需额外协议/资源。

const sanitizeFileName = (name) => String(name || 'note')
  .replace(/[\\/:*?"<>|\n\r\t]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 80) || 'note'

const FORMAT_META = {
  md: { ext: 'md', filterName: 'Markdown' },
  html: { ext: 'html', filterName: 'HTML' },
  pdf: { ext: 'pdf', filterName: 'PDF' },
  png: { ext: 'png', filterName: 'PNG 图片' },
}

const writeHtmlToTemp = async (html) => {
  const dir = path.join(os.tmpdir(), 'flota-export')
  await fs.promises.mkdir(dir, { recursive: true })
  const file = path.join(dir, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  await fs.promises.writeFile(file, html, 'utf8')
  return file
}

const renderInOffscreenWindow = async (html, render) => {
  const tempFile = await writeHtmlToTemp(html)
  const win = new BrowserWindow({
    show: false,
    width: 820,
    height: 1000,
    webPreferences: {
      offscreen: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: true,
    },
  })
  try {
    await win.loadFile(tempFile)
    // 等待样式/图片布局稳定
    await new Promise((r) => setTimeout(r, 350))
    return await render(win)
  } finally {
    try { win.destroy() } catch {}
    try { await fs.promises.unlink(tempFile) } catch {}
  }
}

const exportPdf = async (html, filePath) => {
  await renderInOffscreenWindow(html, async (win) => {
    const data = await win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      pageSize: 'A4',
    })
    await fs.promises.writeFile(filePath, data)
  })
}

const exportPng = async (html, filePath) => {
  await renderInOffscreenWindow(html, async (win) => {
    const contentWidth = 820
    const height = await win.webContents.executeJavaScript(
      'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)'
    )
    const safeHeight = Math.min(Math.max(Math.ceil(height) + 24, 200), 20000)
    win.setContentSize(contentWidth, safeHeight)
    await new Promise((r) => setTimeout(r, 250))
    const image = await win.webContents.capturePage()
    await fs.promises.writeFile(filePath, image.toPNG())
  })
}

const registerExportHandlers = () => {
  ipcMain.handle('note:export-document', async (event, payload = {}) => {
    try {
      const { format, title, markdown = '', html = '' } = payload
      const meta = FORMAT_META[format]
      if (!meta) return { success: false, error: `不支持的导出格式：${format}` }

      const baseName = sanitizeFileName(title)
      const win = BrowserWindow.fromWebContents(event.sender)
      const saveResult = await dialog.showSaveDialog(win, {
        title: '导出笔记',
        defaultPath: `${baseName}.${meta.ext}`,
        filters: [{ name: meta.filterName, extensions: [meta.ext] }],
      })
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true }
      }
      const filePath = saveResult.filePath

      if (format === 'md') {
        await fs.promises.writeFile(filePath, markdown, 'utf8')
      } else if (format === 'html') {
        await fs.promises.writeFile(filePath, html, 'utf8')
      } else if (format === 'pdf') {
        await exportPdf(html, filePath)
      } else if (format === 'png') {
        await exportPng(html, filePath)
      }

      return { success: true, filePath }
    } catch (error) {
      console.error('[note:export-document] 导出失败:', error)
      return { success: false, error: error?.message || '导出失败' }
    }
  })
}

module.exports = { registerExportHandlers }
