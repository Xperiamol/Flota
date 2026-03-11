const path = require('path')
const { app } = require('electron')

/**
 * IPC 输入校验工具
 * 防止路径遍历、类型注入等安全问题
 */

// 允许的基础路径（延迟获取，因为 app ready 前不可用）
let _allowedRoots = null
function getAllowedRoots() {
  if (!_allowedRoots) {
    const userData = app.getPath('userData')
    _allowedRoots = [
      path.join(userData, 'images'),
      path.join(userData, 'audio'),
      path.join(userData, 'database'),
      path.join(userData, 'backups'),
      path.join(userData, 'plugins'),
    ]
  }
  return _allowedRoots
}

/**
 * 校验文件路径安全性：禁止路径遍历、只允许白名单目录
 */
function validatePath(inputPath, { allowedRoots } = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('路径不能为空')
  }
  const normalized = path.resolve(inputPath)
  const roots = allowedRoots || getAllowedRoots()
  const safe = roots.some(root => normalized.startsWith(path.resolve(root)))
  if (!safe) {
    throw new Error('路径不在允许范围内')
  }
  return normalized
}

/**
 * 校验相对路径（如 images/abc.png），不允许 .. 和绝对路径
 */
function validateRelativePath(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error('路径不能为空')
  }
  if (path.isAbsolute(relPath)) {
    throw new Error('不允许绝对路径')
  }
  const normalized = path.normalize(relPath)
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    throw new Error('不允许路径遍历')
  }
  return normalized
}

/**
 * 校验字符串类型参数
 */
function validateString(value, name, { maxLength = 10000, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new Error(`${name} 必须是字符串`)
  }
  if (!allowEmpty && !value.trim()) {
    throw new Error(`${name} 不能为空`)
  }
  if (value.length > maxLength) {
    throw new Error(`${name} 超出最大长度 ${maxLength}`)
  }
  return value
}

/**
 * 校验整数 ID
 */
function validateId(value, name = 'id') {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return parseInt(value, 10)
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  // 也允许 UUID 格式的 syncId
  if (typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)) {
    return value
  }
  // 允许普通字符串 ID（部分旧代码使用数字字符串）
  if (typeof value === 'string' && value.length > 0 && value.length <= 200) {
    return value
  }
  throw new Error(`${name} 格式无效`)
}

/**
 * 校验 URL（用于外部链接打开等）
 */
function validateUrl(url) {
  if (typeof url !== 'string') throw new Error('URL 必须是字符串')
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('仅支持 http/https 协议')
    }
    return url
  } catch (e) {
    if (e.message === '仅支持 http/https 协议') throw e
    throw new Error('URL 格式无效')
  }
}

/**
 * 校验数组（如批量操作的 IDs）
 */
function validateArray(value, name, { maxLength = 1000, itemValidator } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} 必须是数组`)
  }
  if (value.length > maxLength) {
    throw new Error(`${name} 数量超出限制 ${maxLength}`)
  }
  if (itemValidator) {
    return value.map((item, i) => itemValidator(item, `${name}[${i}]`))
  }
  return value
}

/**
 * 校验对象非空
 */
function validateObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} 必须是对象`)
  }
  return value
}

module.exports = {
  validatePath,
  validateRelativePath,
  validateString,
  validateId,
  validateUrl,
  validateArray,
  validateObject,
}
