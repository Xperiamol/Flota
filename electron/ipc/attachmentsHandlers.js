const { ipcMain, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { validateString } = require('../utils/ipcValidator')

const ATTACHMENT_DEFAULT_MAX_BYTES = 50 * 1024 * 1024  // 默认 50 MB

const sanitizeAttachmentName = (raw) => {
  const base = String(raw || '').split(/[\\/]/).pop() || 'file'
  return base.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 120) || 'file'
}

const registerAttachmentsHandlers = (services) => {
  const getAttachmentMaxBytes = async () => {
    try {
      const result = await services.settingsService?.getSetting?.('attachmentMaxSizeMB')
      if (result?.success) {
        const mb = Number(result.data)
        if (Number.isFinite(mb)) return mb > 0 ? Math.floor(mb * 1024 * 1024) : 0
      }
    } catch {}
    return ATTACHMENT_DEFAULT_MAX_BYTES
  }

  const assertAttachmentSize = async (size) => {
    const max = await getAttachmentMaxBytes()
    if (max > 0 && size > max) {
      const limitMb = Math.round(max / (1024 * 1024))
      throw new Error(`文件大小 ${(size / 1024 / 1024).toFixed(1)} MB 超过限制 ${limitMb} MB`)
    }
  }

  const writeAttachmentBuffer = (buf, originalName) => {
    const dir = path.join(app.getPath('userData'), 'attachments')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const displayName = sanitizeAttachmentName(originalName)
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    const ext = path.extname(displayName).toLowerCase()
    const fileName = ext ? `${sha1}${ext}` : sha1
    const fullPath = path.join(dir, fileName)
    if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, buf)
    return { relativePath: `attachments/${fileName}`, displayName }
  }

  ipcMain.handle('attachments:save-from-path', async (_event, sourcePath, displayName) => {
    try {
      validateString(sourcePath, 'sourcePath')
      if (!fs.existsSync(sourcePath)) throw new Error('源文件不存在')
      const stat = fs.statSync(sourcePath)
      if (!stat.isFile()) throw new Error('源不是文件')
      await assertAttachmentSize(stat.size)
      const buf = fs.readFileSync(sourcePath)
      return { success: true, data: writeAttachmentBuffer(buf, displayName || path.basename(sourcePath)) }
    } catch (error) {
      console.error('保存附件失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('attachments:save-from-buffer', async (_event, buffer, fileName) => {
    try {
      validateString(fileName, 'fileName')
      const buf = Buffer.from(buffer)
      await assertAttachmentSize(buf.length)
      return { success: true, data: writeAttachmentBuffer(buf, fileName) }
    } catch (error) {
      console.error('保存附件失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('attachments:open', async (_event, refPath) => {
    try {
      validateString(refPath, 'refPath')
      const cleaned = String(refPath).replace(/^app:\/\//, '')
      const m = cleaned.match(/^(attachments|audio|images)\/(.+)$/)
      if (!m) throw new Error('非法的附件路径')
      const subdir = m[1]
      const fileName = m[2]
      if (!fileName || fileName.includes('..') || /[\\/]/.test(fileName)) {
        throw new Error('非法的附件文件名')
      }
      const fullPath = path.join(app.getPath('userData'), subdir, fileName)
      if (!fs.existsSync(fullPath)) throw new Error('附件不存在')
      const errorMessage = await shell.openPath(fullPath)
      if (errorMessage) throw new Error(errorMessage)
      return { success: true }
    } catch (error) {
      console.error('打开附件失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 读取本地图片附件为 dataURL，供多模态 AI 注入使用（仅图片，且单文件 ≤6MB）
  ipcMain.handle('attachments:read-as-data-url', async (_event, refPath) => {
    try {
      validateString(refPath, 'refPath')
      const cleaned = String(refPath).replace(/^app:\/\//, '').replace(/^\.?\//, '')
      const m = cleaned.match(/^(attachments|images)\/(.+)$/)
      if (!m) throw new Error('非法的附件路径')
      const fileName = m[2]
      if (!fileName || fileName.includes('..') || /[\\/]/.test(fileName)) {
        throw new Error('非法的附件文件名')
      }
      const fullPath = path.join(app.getPath('userData'), m[1], fileName)
      if (!fs.existsSync(fullPath)) throw new Error('附件不存在')
      const stat = fs.statSync(fullPath)
      if (stat.size > 6 * 1024 * 1024) throw new Error('图片过大（>6MB）')
      const ext = path.extname(fileName).toLowerCase().slice(1)
      const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
      const mime = mimeMap[ext]
      if (!mime) throw new Error('非图片类型')
      const buf = fs.readFileSync(fullPath)
      return { success: true, data: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerAttachmentsHandlers }
