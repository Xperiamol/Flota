import { create } from 'zustand'

/**
 * 确认后执行的 AI 动作（长文写作等）的步骤进度，按 actionId 区分。
 * 主进程在执行时推送 step_start / step_token / step_update / step_end（与 AI 页面流式对话里的步骤同一格式）。
 */
export const useActionSteps = create((set) => ({
  byAction: {},
  setSteps: (actionId, steps) => set((state) => ({ byAction: { ...state.byAction, [actionId]: steps } })),
  clear: (actionId) => set((state) => {
    const next = { ...state.byAction }
    delete next[actionId]
    return { byAction: next }
  }),
}))

const reduceStep = (steps, chunk) => {
  const upsert = (id, patch) => {
    const index = steps.findIndex((step) => step.id === id)
    if (index === -1) return [...steps, { id, ...patch }]
    return steps.map((step) => (step.id === id ? { ...step, ...patch, meta: { ...step.meta, ...patch.meta } } : step))
  }
  switch (chunk.type) {
    case 'step_start':
      return upsert(chunk.stepId, { parentId: chunk.parentId, stepType: chunk.stepType, title: chunk.title || '', status: 'running', content: '', meta: chunk.meta || {} })
    case 'step_token': {
      const node = steps.find((step) => step.id === chunk.stepId)
      return upsert(chunk.stepId, { content: (node?.content || '') + (chunk.token || '') })
    }
    case 'step_update':
      return upsert(chunk.stepId, {
        ...(chunk.title ? { title: chunk.title } : {}),
        ...(chunk.status ? { status: chunk.status } : {}),
        ...(chunk.meta ? { meta: chunk.meta } : {}),
      })
    case 'step_end':
      return upsert(chunk.stepId, {
        status: chunk.status || 'done',
        ...(chunk.title ? { title: chunk.title } : {}),
        ...(chunk.meta ? { meta: chunk.meta } : {}),
      })
    default:
      return steps
  }
}

// 正文逐字到达，按帧合并后再写入 store，避免每个字都触发一次渲染
const pending = new Map()
let frame = 0
const flush = () => {
  frame = 0
  const { byAction, setSteps } = useActionSteps.getState()
  pending.forEach((chunks, actionId) => {
    setSteps(actionId, chunks.reduce(reduceStep, byAction[actionId] || []))
  })
  pending.clear()
}

let subscribed = false
export const ensureActionProgressSubscription = () => {
  if (subscribed || typeof window === 'undefined') return
  const listen = window.electronAPI?.ai?.onActionProgress
  if (!listen) return
  subscribed = true
  listen((payload) => {
    if (!payload?.actionId || !payload.chunk) return
    if (!pending.has(payload.actionId)) pending.set(payload.actionId, [])
    pending.get(payload.actionId).push(payload.chunk)
    if (!frame) frame = window.requestAnimationFrame(flush)
  })
}
