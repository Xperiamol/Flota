import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Collapse, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useStore } from '../../store/useStore'
import { useWidgetStore } from '../../store/useWidgetStore'
import { confirmAction, notifyError, notifyInfo, notifySuccess, notifyWarning } from '../../utils/notify'

const SIZES = ['compact', 'medium', 'full']
const MAX_ERRORS = 20

const buildThemeVars = (theme, primaryColor) => ({
  '--fl-primary': primaryColor,
  '--fl-text': theme.palette.text.primary,
  '--fl-text-2': theme.palette.text.secondary,
  '--fl-surface': theme.palette.background.paper,
})

const openNoteByRef = (ref) => {
  const state = useStore.getState()
  const note = state.notes.find((item) => String(item.sync_id) === String(ref) || String(item.id) === String(ref))
  if (!note) return false
  state.setCurrentView?.('notes')
  state.setSelectedNoteId(note.id)
  return true
}

/**
 * 组件宿主：在沙箱 iframe（无 same-origin）中运行组件的一个实例，并把 SDK 调用转发给主进程。
 * 运行身份（实例 / 草稿）由宿主决定，组件自身无法伪造。
 *
 * @param {object} props
 * @param {string} props.instanceId 实例 id 或草稿 id
 * @param {'compact'|'medium'|'full'} [props.size]
 * @param {string} [props.surface] 放置位置：page / note / dashboard / window / probe（也用于区分界面状态）
 * @param {number|string} [props.reloadKey] 变化时强制重新加载
 * @param {(event: object) => void} [props.onEvent] 组件事件（error / console / health / ready）
 * @param {(errors: object[]) => void} [props.onFixRequest] 用户点击“让 AI 修复”
 */
export default function WidgetHost({
  instanceId,
  size = 'medium',
  surface = 'note',
  reloadKey = 0,
  minHeight = 60,
  maxHeight = 900,
  onEvent,
  onFixRequest,
  showErrors = true,
  sx,
}) {
  const theme = useTheme()
  const primaryColor = useStore((state) => state.primaryColor) || '#1976d2'
  const isDraft = String(instanceId).startsWith('__draft__')
  // 组件代码或授权变化时重新加载
  const widgetsVersion = useWidgetStore((state) => state.widgets.map((w) => `${w.id}:${w.updatedAt}:${w.pendingApproval ? 1 : 0}`).join('|'))
  const iframeRef = useRef(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const [info, setInfo] = useState(null)
  const [contentHeight, setContentHeight] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState([])
  const [errorsOpen, setErrorsOpen] = useState(false)

  useEffect(() => {
    if (isDraft) return setInfo(null)
    window.electronAPI?.widgets?.getInstance(instanceId).then((result) => setInfo(result?.success ? result.data : null))
  }, [instanceId, isDraft, widgetsVersion])

  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const resolvedSize = SIZES.includes(size) ? size : 'medium'
  const envRef = useRef(null)
  envRef.current = {
    instanceId,
    instanceName: info?.instance?.name || '',
    size: resolvedSize,
    surface,
    theme: mode,
    locale: navigator.language || 'zh-CN',
    draft: isDraft,
    maxHeight,
    vars: buildThemeVars(theme, primaryColor),
  }

  // 主题变化不重新加载 iframe（通过 env 事件推送），只有代码或尺寸变化才重新加载
  const initialThemeRef = useRef({ mode, primaryColor })
  const widgetUpdatedAt = info?.widget?.updatedAt || ''
  const src = useMemo(() => {
    const params = new URLSearchParams({
      instance: instanceId,
      size: resolvedSize,
      surface,
      theme: initialThemeRef.current.mode,
      primary: initialThemeRef.current.primaryColor,
      locale: navigator.language || 'zh-CN',
      draft: isDraft ? '1' : '0',
      v: `${widgetUpdatedAt}-${reloadKey}`,
    })
    return `app://widget/${encodeURIComponent(instanceId)}/index.html?${params.toString()}`
  }, [instanceId, resolvedSize, surface, widgetUpdatedAt, reloadKey, isDraft])

  useEffect(() => {
    setLoading(true)
    setErrors([])
    setContentHeight(null)
  }, [src])

  const post = useCallback((message) => {
    iframeRef.current?.contentWindow?.postMessage({ __flota: 1, ...message }, '*')
  }, [])

  const handleUiCall = useCallback(async (method, params) => {
    switch (method) {
      case 'ui.openNote':
        return openNoteByRef(params?.id)
      case 'ui.toast': {
        const message = String(params?.message || '').slice(0, 300)
        if (params?.type === 'error') notifyError(message)
        else if (params?.type === 'warning') notifyWarning(message)
        else if (params?.type === 'success') notifySuccess(message)
        else notifyInfo(message)
        return true
      }
      case 'ui.confirm':
        return confirmAction({ title: info?.widget?.name || '组件', message: String(params?.message || '').slice(0, 500) })
      default:
        return undefined
    }
  }, [info])

  const handleRpc = useCallback(async ({ id, method, params }) => {
    try {
      if (typeof method !== 'string') throw Object.assign(new Error('非法调用'), { code: 'INVALID' })
      if (method.startsWith('ui.')) {
        const result = await handleUiCall(method, params)
        if (result === undefined) throw Object.assign(new Error(`未知的组件调用：${method}`), { code: 'UNKNOWN_METHOD' })
        post({ type: 'rpc-result', id, result })
        return
      }
      const response = await window.electronAPI.widgets.rpc(instanceId, method, params, { placement: surface })
      post(response?.success
        ? { type: 'rpc-result', id, result: response.data }
        : { type: 'rpc-result', id, error: { message: response?.error || '调用失败', code: response?.code } })
    } catch (error) {
      post({ type: 'rpc-result', id, error: { message: error.message, code: error.code || 'ERROR' } })
    }
  }, [instanceId, surface, post, handleUiCall])

  useEffect(() => {
    const onMessage = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const message = event.data
      if (!message || message.__flota !== 1) return
      switch (message.type) {
        case 'rpc':
          handleRpc(message)
          break
        case 'ready':
          setLoading(false)
          post({ type: 'init', env: envRef.current })
          onEventRef.current?.({ type: 'ready' })
          break
        case 'resize':
          if (Number.isFinite(message.height)) setContentHeight(message.height)
          break
        case 'error': {
          const entry = { message: String(message.message || '未知错误').slice(0, 1000), stack: String(message.stack || '').slice(0, 4000), at: Date.now() }
          setErrors((list) => [...list, entry].slice(-MAX_ERRORS))
          onEventRef.current?.({ type: 'error', ...entry })
          break
        }
        case 'console':
          onEventRef.current?.({ type: 'console', level: message.level, text: message.text })
          break
        case 'health':
          onEventRef.current?.({ type: 'health', text: message.text, elements: message.elements, height: message.height })
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleRpc, post])

  // 主题、主色、实例名变化时推送给组件
  useEffect(() => {
    if (loading) return
    post({ type: 'event', event: 'env', payload: envRef.current })
  }, [mode, primaryColor, loading, post, info?.instance?.name])

  // 数据变化（其他放置位置、其他窗口、同步写入）推送给组件
  useEffect(() => {
    const unsubscribe = window.electronAPI?.widgets?.onDataChanged?.((payload) => {
      post({ type: 'event', event: 'data-changed', payload })
    })
    return () => unsubscribe?.()
  }, [post])

  if (info?.instance?.isDeleted) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary', ...sx }}>
        <Typography variant="body2" sx={{ mb: 1 }}>这个实例已删除，30 天内可以恢复。</Typography>
        <Button size="small" onClick={() => window.electronAPI.widgets.restoreInstance(instanceId)}>恢复实例</Button>
      </Box>
    )
  }

  if (info?.widget?.pendingApproval) {
    const permissions = info.widget.manifest?.permissions || []
    return (
      <Alert severity="warning" sx={{ m: 1, borderRadius: 2, ...sx }}
        action={<Button color="inherit" size="small" onClick={() => window.electronAPI.widgets.approve(info.widget.id)}>允许运行</Button>}>
        「{info.widget.name}」来自外部文件，请确认后再运行。它申请的权限：{permissions.length ? permissions.join('、') : '无'}
      </Alert>
    )
  }

  const isFull = resolvedSize === 'full'
  const frameHeight = isFull ? '100%' : Math.min(Math.max(contentHeight || minHeight, minHeight), maxHeight)

  return (
    <Box sx={{ position: 'relative', width: '100%', height: isFull ? '100%' : 'auto', display: 'flex', flexDirection: 'column', ...sx }}>
      <Box sx={{ position: 'relative', flex: isFull ? 1 : 'none', minHeight: isFull ? 0 : undefined }}>
        <iframe
          ref={iframeRef}
          key={src}
          src={src}
          title="Flota 组件"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ display: 'block', width: '100%', height: frameHeight, border: 0, background: 'transparent', colorScheme: mode }}
        />
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
            <CircularProgress size={20} />
          </Box>
        )}
      </Box>
      {showErrors && errors.length > 0 && (
        <Box sx={{ mt: 0.75, px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="error" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              组件出错：{errors[errors.length - 1].message}
            </Typography>
            <Button size="small" onClick={() => setErrorsOpen((open) => !open)}>{errorsOpen ? '收起' : `详情（${errors.length}）`}</Button>
            {onFixRequest && <Button size="small" variant="contained" onClick={() => onFixRequest(errors)}>让 AI 修复</Button>}
          </Box>
          <Collapse in={errorsOpen}>
            <Box component="pre" sx={{ m: 0, mt: 0.75, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
              {errors.map((error) => `${error.message}\n${error.stack}`).join('\n\n')}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  )
}
