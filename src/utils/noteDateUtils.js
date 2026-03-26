import { formatDistanceToNow } from 'date-fns'

/**
 * 统一解析笔记时间字段，兼容时间戳、ISO、SQLite DATETIME。
 */
export const parseNoteDate = (value) => {
  if (value === null || value === undefined || value === '') return null

  const str = String(value).trim()
  if (!str) return null

  // 纯数字：时间戳（毫秒）
  if (/^\d+$/.test(str)) {
    const date = new Date(Number(str))
    return Number.isNaN(date.getTime()) ? null : date
  }

  // ISO 字符串
  if (str.includes('T') || str.includes('Z')) {
    const date = new Date(str)
    return Number.isNaN(date.getTime()) ? null : date
  }

  // SQLite CURRENT_TIMESTAMP 格式，按 UTC 解析
  const sqliteDate = new Date(str.replace(' ', 'T') + 'Z')
  if (!Number.isNaN(sqliteDate.getTime())) {
    return sqliteDate
  }

  // 最后兜底
  const fallbackDate = new Date(str)
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate
}

export const formatRelativeNoteTime = (value, options = {}) => {
  const { locale, unknownText = '' } = options
  const date = parseNoteDate(value)
  if (!date) return unknownText

  return formatDistanceToNow(date, {
    addSuffix: true,
    locale
  })
}
