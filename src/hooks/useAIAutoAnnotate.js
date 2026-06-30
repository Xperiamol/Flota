import { useEffect, useRef } from 'react'
import { parseTags, formatTags } from '../utils/tagUtils'
import logger from '../utils/logger'

const UNTITLED_TITLES = new Set(['', '未命名', '无标题', '新建笔记', 'Untitled', 'New Note'])
const isEmptyTitle = (title) => UNTITLED_TITLES.has(String(title || '').trim())

/**
 * 切换笔记时自动调用 AI 生成标题与标签「建议」（均不静默写入，交给 UI 层供用户采纳），
 * 跳过画布笔记、内容过短、AI 关闭、设置未开启的情况。
 *
 * 标题：成功后通过 onSuggestTitle 回调交给 UI 层展示建议条（不再直接 updateNote 覆盖）
 * 标签：通过 onSuggestTags 回调交给 UI 层展示建议条
 * 加载/错误：通过 onStateChange 回调上报，UI 可显示 loading 与错误提示
 */
const useAIAutoAnnotate = ({ selectedNoteId, notes, onSuggestTitle, onSuggestTags, onStateChange }) => {
  const prevNoteIdRef = useRef(null)
  const inFlightRef = useRef(new Set())
  const lastAnnotateRef = useRef(new Map()) // noteId -> { contentHash, ts }

  // 用 ref 持有最新的依赖，避免 useEffect 因依赖变更被重复 cleanup 取消 timer
  const notesRef = useRef(notes)
  const onSuggestTitleRef = useRef(onSuggestTitle)
  const onSuggestTagsRef = useRef(onSuggestTags)
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { onSuggestTitleRef.current = onSuggestTitle }, [onSuggestTitle])
  useEffect(() => { onSuggestTagsRef.current = onSuggestTags }, [onSuggestTags])
  useEffect(() => { onStateChangeRef.current = onStateChange }, [onStateChange])

  const annotateNote = async (noteId) => {
    if (!noteId) return
    const key = String(noteId)
    if (inFlightRef.current.has(key)) return
    const note = (notesRef.current || []).find((n) => String(n.id) === key)
    if (!note) return
    if ((note.note_type || 'markdown') === 'whiteboard') return

    try {
      const api = window.electronAPI?.ai
      if (!api?.getConfig || !api?.autoAnnotate) return
      const cfg = await api.getConfig()
      if (!cfg?.success) return
      const { enabled, autoTitleEnabled, autoTagsEnabled } = cfg.data || {}
      if (!enabled) return

      const wantTitle = Boolean(autoTitleEnabled) && isEmptyTitle(note.title)
      const wantTags = Boolean(autoTagsEnabled)
      if (!wantTitle && !wantTags) return

      const content = String(note.content || '')
      if (content.trim().length < 30) return

      const contentHash = `${content.length}:${content.slice(0, 64)}:${content.slice(-64)}`
      const last = lastAnnotateRef.current.get(key)
      if (last && last.contentHash === contentHash && Date.now() - last.ts < 60_000) return

      inFlightRef.current.add(key)
      onStateChangeRef.current?.(noteId, { loading: true, error: null })
      const existingTags = parseTags(note.tags)
      // 全局标签库：所有笔记出现过的标签去重，供模型优先复用
      const librarySet = new Set()
      for (const n of (notesRef.current || [])) {
        for (const t of parseTags(n.tags)) {
          const v = String(t || '').trim()
          if (v) librarySet.add(v)
        }
      }
      const result = await api.autoAnnotate({
        title: note.title || '',
        content,
        existingTags,
        libraryTags: Array.from(librarySet)
      })
      if (!result?.success) {
        onStateChangeRef.current?.(noteId, { loading: false, error: result?.error || 'AI 整理失败' })
        return
      }

      const data = result.data || {}
      lastAnnotateRef.current.set(key, { contentHash, ts: Date.now() })

      if (wantTitle && data.title && isEmptyTitle(note.title)) {
        onSuggestTitleRef.current?.(noteId, String(data.title).trim())
      }
      if (wantTags && Array.isArray(data.tags) && data.tags.length > 0) {
        onSuggestTagsRef.current?.(noteId, data.tags)
      }
      onStateChangeRef.current?.(noteId, { loading: false, error: null })
    } catch (error) {
      logger.warn('[useAIAutoAnnotate] failed', error?.message)
      onStateChangeRef.current?.(noteId, { loading: false, error: error?.message || 'AI 整理失败' })
    } finally {
      inFlightRef.current.delete(key)
    }
  }

  // 切换笔记时为「上一份」笔记触发自动标注。
  // 依赖只放 selectedNoteId，避免 notes 变化导致 timer 被反复 cleanup 取消。
  useEffect(() => {
    const prev = prevNoteIdRef.current
    prevNoteIdRef.current = selectedNoteId
    if (!prev || prev === selectedNoteId) return
    // 1.5s：让切换前的保存（saveQueue.add）有时间把最新 content 写回 store
    const id = window.setTimeout(() => annotateNote(prev), 1500)
    return () => window.clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoteId])

  return { annotateNote }
}

export { formatTags }
export default useAIAutoAnnotate
