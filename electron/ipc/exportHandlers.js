const { ipcMain, dialog, BrowserWindow, app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const AdmZip = require('adm-zip')

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
  bundle: { ext: 'zip', filterName: 'Flota 资料包' },
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

const renderPdf = async (html) => (
  renderInOffscreenWindow(html, async (win) => (
    win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      pageSize: 'A4',
    })
  ))
)

const exportPdf = async (html, filePath) => {
  const data = await renderPdf(html)
  await fs.promises.writeFile(filePath, data)
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

const sanitizeBundleEntryName = (displayName, sourceName) => {
  const sourceExt = path.extname(sourceName || '').toLowerCase()
  let safe = sanitizeFileName(displayName || sourceName || '附件')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  if (!safe) safe = '附件'
  if (!path.extname(safe) && sourceExt) safe += sourceExt
  // 保留扩展名，避免 sanitizeFileName 的总长度截断让系统无法识别附件类型。
  if (safe.length > 120) {
    const ext = path.extname(safe)
    safe = `${path.basename(safe, ext).slice(0, Math.max(1, 120 - ext.length))}${ext}`
  }
  return safe
}

const reserveUniqueName = (desiredName, usedNames) => {
  const ext = path.extname(desiredName)
  const stem = path.basename(desiredName, ext) || '附件'
  let candidate = desiredName
  let suffix = 2
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem} (${suffix})${ext}`
    suffix += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

const normalizeBundleAttachmentRef = (ref) => {
  const cleaned = String(ref || '')
    .trim()
    .replace(/^app:\/\//i, '')
    .replace(/^\/+/, '')
  const match = cleaned.match(/^(attachments|audio)\/([^\\/]+)$/i)
  if (!match || match[2].includes('..')) return null
  return { cleaned: `${match[1].toLowerCase()}/${match[2]}`, subdir: match[1].toLowerCase(), fileName: match[2] }
}

const replaceLiteral = (source, search, replacement) => String(source).split(search).join(replacement)

const exportBundle = async ({ title, html, markdown, attachments }, filePath) => {
  const baseName = sanitizeFileName(title)
  const zip = new AdmZip()
  const usedNames = new Set()
  const copiedByRef = new Map()
  const missing = []
  let linkedHtml = String(html || '')
  let portableMarkdown = String(markdown || '')
  const manifest = Array.isArray(attachments) ? attachments.slice(0, 500) : []

  for (const item of manifest) {
    const id = Number(item?.id)
    const parsed = normalizeBundleAttachmentRef(item?.ref)
    if (!Number.isInteger(id) || id < 0 || !parsed) continue

    let entry = copiedByRef.get(parsed.cleaned.toLowerCase())
    if (!entry) {
      const fullPath = path.join(app.getPath('userData'), parsed.subdir, parsed.fileName)
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        missing.push(item?.name || parsed.fileName)
        linkedHtml = replaceLiteral(linkedHtml, `flota-attachment://${id}`, '#missing-attachment')
        continue
      }
      const desiredName = sanitizeBundleEntryName(item?.name, parsed.fileName)
      const fileName = reserveUniqueName(desiredName, usedNames)
      entry = {
        fileName,
        url: `attachments/${encodeURIComponent(fileName)}`,
      }
      copiedByRef.set(parsed.cleaned.toLowerCase(), entry)
      zip.addFile(`attachments/${fileName}`, await fs.promises.readFile(fullPath))
    }

    linkedHtml = replaceLiteral(linkedHtml, `flota-attachment://${id}`, `./${entry.url}`)
    // Markdown 中同时兼容 app://attachments/... 与 attachments/... 两种写法。
    portableMarkdown = replaceLiteral(portableMarkdown, `app://${parsed.cleaned}`, entry.url)
    portableMarkdown = replaceLiteral(portableMarkdown, parsed.cleaned, entry.url)
  }

  // PDF 只呈现附件卡片；真正可移植的相对链接保留在同包 HTML 中。
  const pdfHtml = String(html || '').replace(/\s+href="flota-attachment:\/\/\d+"/g, '')
  const pdfData = await renderPdf(pdfHtml)
  zip.addFile(`${baseName}.pdf`, Buffer.from(pdfData))
  zip.addFile(`${baseName}.html`, Buffer.from(linkedHtml, 'utf8'))
  zip.addFile(`${baseName}.md`, Buffer.from(portableMarkdown, 'utf8'))

  const missingSection = missing.length
    ? `\n未找到的附件（${missing.length}）：\n${missing.map((name) => `- ${name}`).join('\n')}\n`
    : '\n所有检测到的本地附件均已打包。\n'
  const readme = `Flota 导出资料包\n\n` +
    `- ${baseName}.pdf：适合阅读和打印，附件以卡片形式呈现\n` +
    `- ${baseName}.html：保留版式，附件卡片可点击打开\n` +
    `- ${baseName}.md：可继续编辑，附件路径已改为资料包内相对路径\n` +
    `- attachments/：附件副本；Flota 中的原文件未被移动或删除\n` +
    missingSection
  zip.addFile('导出说明.txt', Buffer.from(readme, 'utf8'))

  await new Promise((resolve, reject) => {
    zip.writeZip(filePath, (error) => (error ? reject(error) : resolve()))
  })
  return { attachmentCount: copiedByRef.size, missing }
}

const registerExportHandlers = () => {
  ipcMain.handle('note:export-document', async (event, payload = {}) => {
    try {
      const { format, title, markdown = '', html = '', attachments = [] } = payload
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
      } else if (format === 'bundle') {
        const bundleResult = await exportBundle({ title, html, markdown, attachments }, filePath)
        return {
          success: true,
          filePath,
          attachmentCount: bundleResult.attachmentCount,
          warning: bundleResult.missing.length
            ? `${bundleResult.missing.length} 个附件未找到，详情见资料包内导出说明`
            : '',
        }
      }

      return { success: true, filePath }
    } catch (error) {
      console.error('[note:export-document] 导出失败:', error)
      return { success: false, error: error?.message || '导出失败' }
    }
  })
}

module.exports = { registerExportHandlers }
