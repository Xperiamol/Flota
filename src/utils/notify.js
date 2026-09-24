// 应用内通知 / 确认框的全局入口。
//
// 组件外（编辑器节点视图、工具函数、事件回调）也能调用，统一由 ErrorProvider 渲染成
// 应用风格的 Snackbar / 确认对话框，替代系统原生 alert() / confirm()。
// 没有 Provider 挂载时（极早期或异常场景）退回原生弹框，保证提示不会丢。

const listeners = new Set()

export const subscribeNotify = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const emit = (payload) => {
  if (listeners.size === 0) return false
  listeners.forEach((listener) => listener(payload))
  return true
}

const notify = (severity) => (message) => {
  const text = String(message || '')
  if (!text) return
  if (!emit({ type: 'toast', severity, message: text })) {
    try { window.alert(text) } catch {}
  }
}

export const notifyError = notify('error')
export const notifyWarning = notify('warning')
export const notifySuccess = notify('success')
export const notifyInfo = notify('info')

/**
 * 应用内确认框。
 * @returns {Promise<boolean>} 用户点确认为 true，取消 / 关闭为 false
 */
export const confirmAction = ({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false
} = {}) => new Promise((resolve) => {
  const delivered = emit({ type: 'confirm', title, message, confirmText, cancelText, danger, resolve })
  if (!delivered) {
    try { resolve(window.confirm(message || title)) } catch { resolve(false) }
  }
})

/**
 * 应用内输入框（Electron 不支持 window.prompt，调用会直接返回 null）。
 * @returns {Promise<string|null>} 确认时返回输入内容（已去除首尾空白），取消返回 null
 */
export const promptInput = ({
  title = '请输入',
  message = '',
  label = '',
  placeholder = '',
  defaultValue = '',
  confirmText = '确定',
  cancelText = '取消'
} = {}) => new Promise((resolve) => {
  const delivered = emit({
    type: 'prompt',
    title,
    message,
    label,
    placeholder,
    defaultValue,
    confirmText,
    cancelText,
    resolve
  })
  if (!delivered) resolve(null)
})
