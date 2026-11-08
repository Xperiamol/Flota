// 任务独立于聊天组件生命周期：切换会话不取消；只有卡片上的“停止”取消。
const tasks = new Map()
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
export const subscribeGenerationTasks = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export const getGenerationTaskPhase = id => tasks.get(id)?.phase || null
export const cancelGenerationTask = id => tasks.get(id)?.cancel() || false
const abortError = () => Object.assign(new Error('已停止生成'), { name: 'AbortError' })

// onCancel：任务在主进程执行（长文写作等）时，用它通知主进程中止
export const createGenerationTask = (id, { onCancel } = {}) => {
  if (tasks.has(id)) throw new Error('该任务正在执行')
  const controller = new AbortController()
  let requestId = null
  const task = {
    phase: 'generating',
    referenceImages: [],
    signal: controller.signal,
    throwIfCancelled() { if (controller.signal.aborted) throw abortError() },
    cancel() {
      if (task.phase !== 'generating') return false
      task.phase = 'cancelling'
      controller.abort()
      if (requestId) Promise.resolve(window.electronAPI?.ai?.cancelChat?.(requestId)).catch(() => {})
      if (onCancel) Promise.resolve().then(onCancel).catch(() => {})
      emit()
      return true
    },
    beginCommit() {
      task.throwIfCancelled()
      task.phase = 'committing'
      emit()
    },
    async chat(messages, options) {
      task.throwIfCancelled()
      if (task.referenceImages.length) {
        messages = [...messages, { role: 'user', content: [
          { type: 'text', text: '以下是本次任务的参考图片，请结合原始需求使用。' },
          ...task.referenceImages.map(url => ({ type: 'image_url', image_url: { url } })),
        ] }]
      }
      requestId = `whiteboard_${Date.now()}_${Math.random().toString(36).slice(2)}`
      let onAbort
      try {
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(abortError())
          controller.signal.addEventListener('abort', onAbort, { once: true })
        })
        const result = await Promise.race([
          window.electronAPI.ai.chat(messages, { ...options, requestId }), aborted,
        ])
        task.throwIfCancelled()
        return result
      } finally {
        controller.signal.removeEventListener('abort', onAbort)
        requestId = null
      }
    },
    dispose() { if (tasks.get(id) === task) { tasks.delete(id); emit() } },
  }
  tasks.set(id, task)
  emit()
  return task
}
