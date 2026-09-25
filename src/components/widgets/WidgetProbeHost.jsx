import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import WidgetHost from './WidgetHost'

const PROBE_TIMEOUT_MS = 8000
const PROBE_SETTLE_MS = 900

let enqueue = null

/**
 * 在不可见的沙箱里运行一次组件草稿，收集报错与渲染情况，供 AI 自动修复。
 * @returns {Promise<{ errors: Array<{message: string, stack?: string}>, health: object | null, skipped?: boolean }>}
 */
export const probeWidget = (draftId) => new Promise((resolve) => {
  if (!enqueue) return resolve({ errors: [], health: null, skipped: true })
  enqueue({ id: `${draftId}-${Date.now()}`, draftId, resolve })
})

/** 由预跑结果得出需要修复的问题 */
export const collectProblems = (probe) => {
  if (probe.skipped) return []
  const problems = [...probe.errors]
  if (probe.health && probe.health.elements <= 2 && probe.health.text === 0) {
    problems.push({ message: '白屏：组件加载后页面上没有渲染出任何内容' })
  } else if (!probe.health && !problems.length) {
    problems.push({ message: '组件加载超时，没有完成渲染（可能有死循环，或脚本在加载时就中断了）' })
  }
  return problems
}

function Probe({ request, onDone }) {
  const [state] = useState(() => ({ errors: [], health: null, timer: null, finished: false }))
  const finish = () => {
    if (state.finished) return
    state.finished = true
    clearTimeout(state.timer)
    request.resolve({ errors: state.errors, health: state.health })
    onDone(request.id)
  }
  useEffect(() => {
    state.timer = setTimeout(finish, PROBE_TIMEOUT_MS)
    return () => clearTimeout(state.timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const onEvent = (event) => {
    if (event.type === 'error') state.errors.push({ message: event.message, stack: event.stack })
    if (event.type === 'console' && event.level === 'error') state.errors.push({ message: `console.error: ${event.text}` })
    if (event.type === 'health') {
      state.health = event
      clearTimeout(state.timer)
      state.timer = setTimeout(finish, PROBE_SETTLE_MS)
    }
  }
  return <WidgetHost instanceId={request.draftId} size="full" surface="probe" onEvent={onEvent} showErrors={false} sx={{ height: 600 }} />
}

/** 全局挂载一次：在屏幕外运行预跑用的沙箱 */
export default function WidgetProbeHost() {
  const [requests, setRequests] = useState([])
  useEffect(() => {
    enqueue = (request) => setRequests((list) => [...list, request])
    return () => { enqueue = null }
  }, [])
  if (!requests.length) return null
  return (
    <Box aria-hidden sx={{ position: 'fixed', left: -10000, top: 0, width: 480, pointerEvents: 'none', opacity: 0 }}>
      {requests.map((request) => (
        <Probe key={request.id} request={request} onDone={(id) => setRequests((list) => list.filter((item) => item.id !== id))} />
      ))}
    </Box>
  )
}
