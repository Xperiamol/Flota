const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { getInstance: getNetworkService } = require('./NetworkService')

/**
 * 离线同步队列
 * 当网络不可用时缓存同步操作，恢复后自动重放
 */
class OfflineSyncQueue {
  constructor() {
    this._queue = []
    this._filePath = path.join(app.getPath('userData'), 'offline-sync-queue.json')
    this._processing = false
    this._syncFn = null
    this._load()
  }

  /** 设置实际的同步执行函数 */
  setSyncFunction(fn) {
    this._syncFn = fn
  }

  /** 入队一个同步操作 */
  enqueue(operation) {
    this._queue.push({
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      timestamp: Date.now(),
      ...operation,
    })
    this._save()
  }

  /** 队列长度 */
  get length() {
    return this._queue.length
  }

  /** 尝试重放队列（在线时调用） */
  async flush() {
    if (this._processing || this._queue.length === 0 || !this._syncFn) return
    const network = getNetworkService()
    if (!network.isOnline) return

    this._processing = true
    try {
      // 触发一次完整同步即可（V3 增量同步会包含所有 pending changes）
      await this._syncFn()
      // 同步成功，清空队列
      this._queue = []
      this._save()
    } catch (e) {
      console.error('[OfflineSyncQueue] flush 失败:', e.message)
    } finally {
      this._processing = false
    }
  }

  /** 监听网络恢复并自动 flush */
  startAutoFlush() {
    const network = getNetworkService()
    network.on('status-changed', (online) => {
      if (online && this._queue.length > 0) {
        console.log('[OfflineSyncQueue] 网络恢复，开始重放队列...')
        this.flush()
      }
    })
  }

  _load() {
    try {
      if (fs.existsSync(this._filePath)) {
        this._queue = JSON.parse(fs.readFileSync(this._filePath, 'utf8'))
      }
    } catch (_) {
      this._queue = []
    }
  }

  _save() {
    try {
      fs.writeFileSync(this._filePath, JSON.stringify(this._queue))
    } catch (_) { /* ignore */ }
  }
}

let _instance = null
function getInstance() {
  if (!_instance) _instance = new OfflineSyncQueue()
  return _instance
}

module.exports = { OfflineSyncQueue, getInstance }
