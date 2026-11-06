import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import usePendingActionExecution from './usePendingActionExecution'
import { buildContext } from '../utils/aiCore/contextBuilder'
import { getAppSettingsSnapshot } from '../utils/aiCore/appSettings'
import {
  getDisplayMessages,
  getLatestConfirmableActions,
  getMessagePendingActions,
  isExplicitPendingActionConfirmation,
} from '../utils/aiCore/pendingActions'
import { messageText } from '../utils/aiCore/messageModel'
import { pickThinkingPhrase } from '../components/ai/thinking'
import { notifyError } from '../utils/notify'

// AI 页面（AIChatView）与「问 AI」小窗（AICommandCenter）共用的会话逻辑。
//
// 会话由主进程持有：发送、流式生成、保存（展示消息 + 完整记录）、确认卡状态都在主进程完成，
// 结果广播给所有窗口（见 useAISessionSync），这里直接从 store 读会话和生成中的草稿。
// 渲染层只负责：组装本轮上下文（需要界面状态）、把消息交给主进程、文字确认、执行确认卡。

const ACTIVE_TOOL_MIN_DURATION = 1500 // 工具执行可能只有几毫秒，图标至少显示这么久
const THINKING_ROTATE_MS = 3500
const EMPTY_DRAFT = { streamContent: '', toolCalls: [], steps: [], activeTool: null }
const EMPTY_MESSAGES = []

// 工具图标至少显示一段时间，避免一闪而过
const useStickyActiveTool = (activeTool) => {
  const [shown, setShown] = useState(activeTool)
  const shownAtRef = useRef(0)
  useEffect(() => {
    if (activeTool) {
      shownAtRef.current = Date.now()
      setShown(activeTool)
      return undefined
    }
    const remaining = Math.max(0, ACTIVE_TOOL_MIN_DURATION - (Date.now() - shownAtRef.current))
    const timer = window.setTimeout(() => setShown(null), remaining)
    return () => window.clearTimeout(timer)
  }, [activeTool])
  return shown
}

/**
 * @param {object} options
 * @param {string|null} options.conversationId   当前显示的会话
 * @param {string|number|null} options.noteId     会话归属的笔记（通用聊天为 null）
 * @param {string} options.scene                  'chat_panel' | 'floating_panel'
 * @param {string} options.requestPrefix          请求 id 前缀，便于日志区分入口
 * @param {() => object} options.getLocation      发送时用户所在的界面位置
 * @param {string} [options.defaultTitle]         还没有用户消息时的会话标题
 * @param {object} options.actionDeps             确认卡执行与上下文检索所需能力（含 notes / loadNotes）
 * @param {Function} [options.onTodoUpdated]
 * @param {(conversationId) => void} [options.onConversationSwitched] 切换会话后，组件重置自己的输入状态
 * @param {() => void} [options.onSendAccepted]   消息已被接受（含文字确认），组件清空输入框
 * @param {() => void} [options.onSendSettled]    请求结束，组件把焦点还给输入框
 */
export default function useAIChatSession({
  conversationId,
  noteId,
  scene,
  requestPrefix,
  getLocation,
  defaultTitle = '新对话',
  actionDeps,
  onTodoUpdated,
  onConversationSwitched,
  onSendAccepted,
  onSendSettled,
}) {
  const conversation = useStore((state) => state.aiConversations.find((item) => item.id === conversationId) || null)
  const streams = useStore((state) => state.aiStreams)
  const messages = conversation?.messages || EMPTY_MESSAGES
  const stream = conversationId ? streams[conversationId] : null
  // 组装上下文期间主进程还不知道这一轮：本地先标记为生成中，界面立即显示「思考中」
  const [preparing, setPreparing] = useState(() => new Set())
  const preparingCancelledRef = useRef(new Set())
  const loading = Boolean(stream) || preparing.has(conversationId)
  const draft = stream?.draft || EMPTY_DRAFT
  const activeTool = useStickyActiveTool(draft.activeTool)
  const [thinkingPhrase, setThinkingPhrase] = useState('Thinking… 思考中')

  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId
  const callbacksRef = useRef({})
  callbacksRef.current = { onConversationSwitched, onSendAccepted, onSendSettled, getLocation, actionDeps }

  const noteScope = useMemo(() => (
    noteId == null ? { noteId: null, source: 'general' } : { noteId: String(noteId), source: 'note' }
  ), [noteId])

  // 切换会话：组件重置自己的输入状态
  const previousConversationIdRef = useRef(conversationId)
  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) return
    previousConversationIdRef.current = conversationId
    callbacksRef.current.onConversationSwitched?.(conversationId)
  }, [conversationId])

  // 生成期间轮换「思考中」短语，间隔较长避免视觉抖动
  useEffect(() => {
    if (!loading) return undefined
    setThinkingPhrase(pickThinkingPhrase())
    const id = window.setInterval(() => setThinkingPhrase(pickThinkingPhrase()), THINKING_ROTATE_MS)
    return () => window.clearInterval(id)
  }, [loading])

  // ── 待确认动作 ──
  const { execute: executeAction, dismiss: dismissAction, restore: restoreAction } = usePendingActionExecution({
    conversationIdRef, deps: actionDeps, onTodoUpdated,
  })
  const undoMemory = useCallback(async (message) => {
    const changes = message?.memoryUpdates?.changes
    if (!conversationIdRef.current || !Array.isArray(changes)) return
    const result = await window.electronAPI?.mem0?.revertChanges?.({ changes })
    if (!result?.success) {
      notifyError(`撤销失败：${result?.error || '未知原因'}`)
      return
    }
    await window.electronAPI?.ai?.session?.markMemoryReverted(conversationIdRef.current, message.metadata?.requestId)
  }, [])

  const displayMessages = useMemo(() => new Set(getDisplayMessages(messages)), [messages])
  const executingActionIds = useMemo(() => new Set(messages.flatMap(getMessagePendingActions)
    .filter((action) => action.status === 'running').map((action) => action.actionId)), [messages])
  // 最后一条回复里有可以用文字确认的卡：输入框可以提示「回复好的即可确认」
  const awaitingConfirm = useMemo(
    () => !loading && executingActionIds.size === 0 && getLatestConfirmableActions(messages).length > 0,
    [executingActionIds, loading, messages]
  )

  const ensureConversation = useCallback(() => {
    const store = useStore.getState()
    if (conversationId) {
      // 只高亮当前会话，绝不联动编辑器正在显示的笔记
      store.aiSetActiveConv(conversationId)
      return conversationId
    }
    return noteScope.noteId == null
      ? store.aiNewChat()
      : store.aiEnsureNoteChat(noteScope.noteId, { title: defaultTitle })
  }, [conversationId, defaultTitle, noteScope.noteId])

  // 主进程开始广播这一轮之后，本地的「准备中」就交给它（不在请求发出时撤，否则会闪一下）
  useEffect(() => {
    if (!preparing.size) return
    const started = [...preparing].filter((id) => streams[id])
    if (started.length) setPreparing((current) => new Set([...current].filter((id) => !streams[id])))
  }, [preparing, streams])

  const markPreparing = (id, on) => setPreparing((current) => {
    const next = new Set(current)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  // 组装本轮上下文（当前笔记、相关笔记、界面位置、应用设置），再交给主进程
  const dispatch = useCallback(async (id, query, request) => {
    markPreparing(id, true)
    preparingCancelledRef.current.delete(id)
    try {
      const location = callbacksRef.current.getLocation?.()
      const contextPackage = await buildContext({
        notes: callbacksRef.current.actionDeps?.notes || [], selectedNoteId: noteScope.noteId, query, scene, location,
      })
      if (preparingCancelledRef.current.has(id)) return { success: false, cancelled: true }
      const options = {
        scene,
        requestPrefix,
        defaultTitle,
        requireConfirmation: true,
        contextPackage: { ...contextPackage, appSettings: getAppSettingsSnapshot() },
      }
      const result = await request(options)
      if (result && result.success === false && !result.cancelled && result.error && !result.requestId) notifyError(result.error)
      return result
    } finally {
      markPreparing(id, false)
      preparingCancelledRef.current.delete(id)
      if (conversationIdRef.current === id) callbacksRef.current.onSendSettled?.()
    }
  }, [defaultTitle, noteScope.noteId, requestPrefix, scene])

  /**
   * 发送一条消息。
   * @param {object} params
   * @param {string} params.text          用户输入的文字（用于检索、记忆、标题）
   * @param {string|Array} [params.content] 消息内容；带图片 / 附件时传多模态 content，默认等于 text
   * @returns {Promise<boolean>} 消息是否被接受
   */
  const send = useCallback(async ({ text = '', content } = {}) => {
    const trimmed = String(text || '').trim()
    const messageContent = content ?? trimmed
    const hasContent = Array.isArray(messageContent) ? messageContent.length > 0 : Boolean(String(messageContent).trim())
    if (!hasContent || loading) return false

    // 文字确认：只有纯文字才可能是「好的 / 确认」；最后一条回复里待确认的简单卡依次执行
    const confirmable = typeof messageContent === 'string' && isExplicitPendingActionConfirmation(trimmed)
      ? getLatestConfirmableActions(messagesRef.current)
      : []
    if (confirmable.length > 0) {
      callbacksRef.current.onSendAccepted?.()
      for (const action of confirmable) await executeAction(action)
      callbacksRef.current.onSendSettled?.()
      return true
    }

    const id = ensureConversation()
    conversationIdRef.current = id
    callbacksRef.current.onSendAccepted?.()
    const meta = { title: defaultTitle, ...noteScope }
    await dispatch(id, trimmed, (options) => window.electronAPI.ai.session.send({ conversationId: id, meta, content: messageContent, text: trimmed, options }))
    return true
  }, [defaultTitle, dispatch, ensureConversation, executeAction, loading, noteScope])

  /** 停止当前会话的生成（组装上下文阶段也能停，不会稍后偷偷发出请求） */
  const cancel = useCallback(() => {
    if (!conversationId) return
    if (preparing.has(conversationId) && !stream) {
      // 还在组装上下文：不再发出请求；请求若刚好已经发出，主进程那边也一并停止
      preparingCancelledRef.current.add(conversationId)
      markPreparing(conversationId, false)
    }
    window.electronAPI?.ai?.session?.cancel(conversationId)
  }, [conversationId, preparing, stream])

  const cancelConversation = useCallback((id) => {
    if (id) window.electronAPI?.ai?.session?.cancel(id)
  }, [])

  /** 重新生成最后一条回复：主进程去掉最后一轮，用同一条用户消息（含图片）再问一次 */
  const retryLast = useCallback(() => {
    if (loading || !conversationId) return
    const lastUser = [...messagesRef.current].reverse().find((message) => message.role === 'user')
    if (!lastUser) return
    dispatch(conversationId, messageText(lastUser.content), (options) => window.electronAPI.ai.session.retry({ conversationId, options }))
  }, [conversationId, dispatch, loading])

  /** 正在后台生成、但不是当前显示的会话（AI 页面用来提示「另一个对话仍在生成」） */
  const backgroundStreamingId = Object.keys(streams).find((id) => id !== conversationId) || null

  return {
    messages,
    messagesRef,
    displayMessages,
    executingActionIds,
    awaitingConfirm,
    loading,
    backgroundStreamingId,
    streamContent: draft.streamContent,
    toolCalls: draft.toolCalls,
    steps: draft.steps,
    activeTool,
    thinkingPhrase,
    send,
    cancel,
    cancelConversation,
    retryLast,
    executeAction,
    dismissAction,
    restoreAction,
    undoMemory,
  }
}
