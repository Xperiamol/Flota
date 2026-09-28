/**
 * 回收站自动清理：已删除超过保留天数的笔记会被永久删除。
 * - 保留天数在「设置 → 数据管理 → 回收站」里调整，0 表示永不自动清理，默认 30 天。
 * - 首次启用时记下起算时间：升级前就在回收站里的笔记从这一刻开始计时，
 *   不会因为更新版本而被立刻清空。
 */
const DAYS_KEY = 'trash_retention_days'
const SINCE_KEY = 'trash_retention_since'
const DEFAULT_DAYS = 30
const ALLOWED_DAYS = [0, 7, 14, 30, 60, 90]
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// 与 SQLite CURRENT_TIMESTAMP 同格式（UTC），方便直接比较
const sqliteNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

class TrashRetention {
  constructor({ settingDAO, noteService }) {
    this.settingDAO = settingDAO
    this.noteService = noteService
    this.timer = null
  }

  getPolicy() {
    const raw = Number(this.settingDAO.get(DAYS_KEY)?.value)
    const days = ALLOWED_DAYS.includes(raw) ? raw : DEFAULT_DAYS
    let since = this.settingDAO.get(SINCE_KEY)?.value
    if (!since) {
      since = sqliteNow()
      this.settingDAO.set(SINCE_KEY, since, 'string', '回收站自动清理的起算时间')
    }
    return { days, since }
  }

  setDays(days) {
    const value = Number(days)
    if (!ALLOWED_DAYS.includes(value)) throw new Error('不支持的保留天数')
    this.settingDAO.set(DAYS_KEY, value, 'number', '回收站保留天数（0 为不自动清理）')
    return this.purgeExpired()
  }

  /** 永久删除过期的已删除笔记，返回 { policy, purged } */
  async purgeExpired() {
    const policy = this.getPolicy()
    if (!policy.days) return { policy, purged: 0 }
    const db = this.noteService.noteDAO.getDB()
    const ids = db.prepare(`
      SELECT id FROM notes
      WHERE is_deleted = 1
        AND julianday(MAX(COALESCE(deleted_at, updated_at), ?)) < julianday('now', ?)
    `).all(policy.since, `-${policy.days} days`).map((row) => row.id)
    if (!ids.length) return { policy, purged: 0 }
    const result = await this.noteService.batchPermanentDeleteNotes(ids)
    if (!result?.success) throw new Error(result?.error || '清理回收站失败')
    console.log(`[TrashRetention] 已永久删除 ${ids.length} 篇超过 ${policy.days} 天的回收站笔记`)
    return { policy, purged: ids.length, ids }
  }

  start() {
    const run = () => this.purgeExpired().catch((error) => console.warn('[TrashRetention] 清理失败:', error.message))
    run()
    this.timer = setInterval(run, CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

TrashRetention.ALLOWED_DAYS = ALLOWED_DAYS
module.exports = TrashRetention
