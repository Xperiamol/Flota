const { net, BrowserWindow } = require('electron')
const EventEmitter = require('events')

/**
 * 网络状态检测服务
 * 监控在线/离线状态，通知渲染进程
 */
class NetworkService extends EventEmitter {
  constructor() {
    super()
    this._online = net.isOnline()
    this._checkTimer = null
  }

  get isOnline() {
    return this._online
  }

  start() {
    // 监听 Electron net 模块的在线状态变化
    const check = () => {
      const online = net.isOnline()
      if (online !== this._online) {
        this._online = online
        this.emit('status-changed', online)
        this._broadcast(online)
      }
    }
    // 定期检查（30秒）作为补充
    this._checkTimer = setInterval(check, 30000)
    // 首次广播
    this._broadcast(this._online)
  }

  stop() {
    if (this._checkTimer) {
      clearInterval(this._checkTimer)
      this._checkTimer = null
    }
  }

  _broadcast(online) {
    try {
      BrowserWindow.getAllWindows().forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('network:status-changed', online)
        }
      })
    } catch (_) { /* ignore */ }
  }
}

// 单例
let _instance = null
function getInstance() {
  if (!_instance) _instance = new NetworkService()
  return _instance
}

module.exports = { NetworkService, getInstance }
