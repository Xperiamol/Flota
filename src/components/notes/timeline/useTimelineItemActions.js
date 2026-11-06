import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store/useStore'
import { createTodo, deleteTodo, updateTodo } from '../../../api/todoAPI'
import { notifyError, notifyWithAction } from '../../../utils/notify'
import {
  buildMergedDayContent,
  buildMergedDayTitle,
  joinEditableContent,
  splitEditableContent,
  toTodoText,
} from './timelineContent'

// 时间轴上对单条记录 / 某一天的写操作。
//
// 约定：
// - 所有写操作都检查结果，失败时提示，不让界面“看起来成功了”。
// - 删除不再弹确认框，改为「已删除 · 撤销」：
//     笔记 → 立即移到回收站，撤销 = 从回收站恢复；
//     待办 → 没有回收站，先在界面上隐藏，撤销窗口过后才真正删除（离开页面时立即提交）。

const UNDO_WINDOW_MS = 6500 // 比撤销提示（6s）多一点，确保点「撤销」时删除还没提交

// store 的笔记操作失败时返回 { success: false }，这里统一变成异常
const ensureOk = (result, fallback) => {
  if (result?.success === false || !result) throw new Error(result?.error || fallback)
  return result
}

const errorText = (error) => error?.message || '未知原因'

const recordLabel = (item) => {
  const text = item.title || item.body || ''
  return text.length > 14 ? `${text.slice(0, 14)}…` : text || '这条记录'
}

export default function useTimelineItemActions({ refreshTodos, onTodoUpdated }) {
  const createNote = useStore((state) => state.createNote)
  const updateNote = useStore((state) => state.updateNote)
  const deleteNote = useStore((state) => state.deleteNote)
  const restoreNote = useStore((state) => state.restoreNote)

  // 等待提交删除的待办：id → timer；界面先隐藏它们
  const [hiddenTodoIds, setHiddenTodoIds] = useState(() => new Set())
  const pendingTodoDeletes = useRef(new Map())

  const todosChanged = useCallback(async () => {
    await refreshTodos()
    onTodoUpdated?.()
  }, [onTodoUpdated, refreshTodos])

  const unhideTodo = useCallback((id) => {
    setHiddenTodoIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const commitTodoDelete = useCallback(async (id) => {
    const timer = pendingTodoDeletes.current.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    pendingTodoDeletes.current.delete(id)
    try {
      await deleteTodo(id)
      await todosChanged()
    } catch (error) {
      notifyError(`删除失败：${errorText(error)}`)
    } finally {
      unhideTodo(id)
    }
  }, [todosChanged, unhideTodo])

  // 离开时间轴：还在撤销窗口里的删除立即提交，不会因为切页面而“删了又回来”
  const commitRef = useRef(commitTodoDelete)
  commitRef.current = commitTodoDelete
  useEffect(() => () => {
    ;[...pendingTodoDeletes.current.keys()].forEach((id) => commitRef.current(id))
  }, [])

  const deleteItem = useCallback(async (item) => {
    if (!item) return
    const label = recordLabel(item)
    if (item.type === 'todo') {
      const id = item.rawId
      setHiddenTodoIds((prev) => new Set(prev).add(id))
      pendingTodoDeletes.current.set(id, window.setTimeout(() => commitTodoDelete(id), UNDO_WINDOW_MS))
      notifyWithAction(`已删除「${label}」`, {
        label: '撤销',
        onClick: () => {
          window.clearTimeout(pendingTodoDeletes.current.get(id))
          pendingTodoDeletes.current.delete(id)
          unhideTodo(id)
        },
      })
      return
    }
    try {
      ensureOk(await deleteNote(item.rawId), '删除失败')
      notifyWithAction(`已删除「${label}」，可在回收站找回`, {
        label: '撤销',
        onClick: async () => {
          try { ensureOk(await restoreNote(item.rawId), '恢复失败') } catch (error) { notifyError(`撤销失败：${errorText(error)}`) }
        },
      })
    } catch (error) {
      notifyError(`删除失败：${errorText(error)}`)
    }
  }, [commitTodoDelete, deleteNote, restoreNote, unhideTodo])

  // 只有纯文字记录能转待办：带图片 / 录音 / 附件的转过去会丢东西
  const canConvertToTodo = (item) => item?.type === 'note'
    && !item.images?.length && !item.audios?.length && !item.files?.length
    && Boolean(toTodoText(item.title || item.fullBody || item.body))

  const convertToTodo = useCallback(async (item) => {
    if (!canConvertToTodo(item)) return
    const content = toTodoText(item.title || item.fullBody || item.body)
    const tags = (item.tags || []).join(',')
    try {
      const todo = await createTodo({ content, tags })
      try {
        ensureOk(await deleteNote(item.rawId), '原记录删除失败')
      } catch (error) {
        // 待办已经建好，只是原记录还在：告诉用户，不回滚
        notifyError(`已建好待办，但原记录没删掉：${errorText(error)}`)
        await todosChanged()
        return
      }
      await todosChanged()
      notifyWithAction(`已转为待办「${toTodoText(content).slice(0, 14)}」`, {
        label: '撤销',
        onClick: async () => {
          try {
            ensureOk(await restoreNote(item.rawId), '恢复原记录失败')
            if (todo?.id != null) await deleteTodo(todo.id)
            await todosChanged()
          } catch (error) {
            notifyError(`撤销失败：${errorText(error)}`)
          }
        },
      })
    } catch (error) {
      notifyError(`转为待办失败：${errorText(error)}`)
    }
  }, [deleteNote, restoreNote, todosChanged])

  // 标签弹层每次增删都会触发保存；同一条记录的保存串行执行，后一次不会被前一次覆盖
  const tagSaveChain = useRef(Promise.resolve())
  const saveTags = useCallback((item, value) => {
    if (!item) return
    tagSaveChain.current = tagSaveChain.current.then(async () => {
      try {
        if (item.type === 'todo') {
          await updateTodo(item.rawId, { tags: value })
          await todosChanged()
        } else {
          // 与笔记编辑器一致：保存逗号分隔的标签字符串
          ensureOk(await updateNote(item.rawId, { tags: value }), '保存标签失败')
        }
      } catch (error) {
        notifyError(`保存标签失败：${errorText(error)}`)
      }
    })
  }, [todosChanged, updateNote])

  /** 原地编辑：只改文字，图片 / 录音 / 附件原样保留。成功返回 true */
  const saveNoteText = useCallback(async (item, text) => {
    const raw = item?.raw
    if (!raw) return false
    const { media } = splitEditableContent(raw.content)
    const content = joinEditableContent(text, media)
    if (content === raw.content) return true
    if (!content.trim()) {
      notifyError('内容不能为空；想删掉这条记录可以用右键菜单里的「删除」')
      return false
    }
    try {
      ensureOk(await updateNote(item.rawId, { content }), '保存失败')
      return true
    } catch (error) {
      notifyError(`保存失败：${errorText(error)}`)
      return false
    }
  }, [updateNote])

  // 可以合并的记录：普通笔记（画布不合并）
  const mergeableNotesOf = (items = []) => items.filter((item) => item.type === 'note' && item.raw)

  /** 把一天里的记录合并成一篇笔记，原记录移到回收站；可撤销 */
  const mergeDay = useCallback(async (items) => {
    const records = mergeableNotesOf(items).sort((a, b) => a.time - b.time)
    if (records.length < 2) return
    const tags = [...new Set(records.flatMap((item) => item.tags || []))]
    try {
      const created = ensureOk(await createNote({
        title: buildMergedDayTitle(records[0].time),
        content: buildMergedDayContent(records.map((item) => ({ time: item.time, content: item.raw.content }))),
        tags,
        selectAfterCreate: false,
      }), '新建笔记失败')
      const deleted = []
      for (const item of records) {
        const result = await deleteNote(item.rawId)
        if (result?.success) deleted.push(item.rawId)
      }
      if (deleted.length < records.length) {
        notifyError(`已合并，但有 ${records.length - deleted.length} 条原记录没能移到回收站`)
      }
      notifyWithAction(`已把 ${records.length} 条记录合并成「${created.data?.title || '新笔记'}」`, {
        label: '撤销',
        onClick: async () => {
          try {
            for (const id of deleted) ensureOk(await restoreNote(id), '恢复原记录失败')
            if (created.data?.id != null) ensureOk(await deleteNote(created.data.id), '删除合并笔记失败')
          } catch (error) {
            notifyError(`撤销失败：${errorText(error)}`)
          }
        },
      })
    } catch (error) {
      notifyError(`合并失败：${errorText(error)}`)
    }
  }, [createNote, deleteNote, restoreNote])

  return {
    hiddenTodoIds,
    deleteItem,
    canConvertToTodo,
    convertToTodo,
    saveTags,
    saveNoteText,
    mergeableCount: (items) => mergeableNotesOf(items).length,
    mergeDay,
  }
}
