import { create } from 'zustand'
import { parseNoteDate } from './noteDateUtils'
import { fetchNoteActivityRange } from '../api/noteAPI'
import { useStore } from '../store/useStore'
import { notifyError, notifyWithAction } from './notify'

/**
 * 日历「笔记视图」的规则（格子与左侧栏共用）：
 * - 「写的」：按创建时间归到那一天，显示具体时刻；可以拖到别的日子（= 修改创建日期）
 * - 「改过的」：那天编辑过、但不是那天写的笔记（来自变更日志，外加最后修改时间兜底）
 * 所有时间先按 UTC 解析（数据库存的是 UTC），再按本地日期归类。
 */

export const dayKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
)

export const noteCreatedDate = (note) => parseNoteDate(note?.created_at) || parseNoteDate(note?.updated_at)

export const formatClock = (date) => (date
  ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  : '')

/** 可见日期范围内每天改过的笔记（sync_id 列表） */
export const useNoteActivity = create((set, get) => ({
  byDay: {},
  rangeKey: '',
  load: async (startDay, endDay, { force = false } = {}) => {
    const rangeKey = `${startDay}~${endDay}`
    if (!force && get().rangeKey === rangeKey) return
    try {
      const byDay = await fetchNoteActivityRange(startDay, endDay)
      set({ byDay: byDay || {}, rangeKey })
    } catch (error) {
      console.warn('[日历] 读取笔记活动失败:', error)
    }
  },
}))

/**
 * 把笔记分到每一天：{ [YYYY-MM-DD]: { created: note[], edited: note[] } }
 * created 按时刻排序；edited 排除当天写的那些
 */
export const buildNoteDayIndex = (notes, activityByDay = {}) => {
  const index = {}
  const bucket = (key) => {
    if (!index[key]) index[key] = { created: [], edited: [] }
    return index[key]
  }
  const bySyncId = new Map()
  const createdKeyById = new Map()
  notes.forEach((note) => {
    if (!note || note.is_deleted) return
    if (note.sync_id) bySyncId.set(String(note.sync_id), note)
    const created = noteCreatedDate(note)
    if (!created) return
    const key = dayKey(created)
    createdKeyById.set(note.id, key)
    bucket(key).created.push(note)
  })
  const addEdited = (key, note) => {
    if (!note || createdKeyById.get(note.id) === key) return
    const target = bucket(key)
    if (!target.edited.some((item) => item.id === note.id)) target.edited.push(note)
  }
  Object.entries(activityByDay).forEach(([key, syncIds]) => {
    (syncIds || []).forEach((syncId) => addEdited(key, bySyncId.get(String(syncId))))
  })
  // 变更日志只保留近期记录：最后一次修改的那天总是算作「改过」
  notes.forEach((note) => {
    if (!note || note.is_deleted) return
    const updated = parseNoteDate(note.updated_at)
    if (updated) addEdited(dayKey(updated), note)
  })
  Object.values(index).forEach((day) => {
    day.created.sort((a, b) => (noteCreatedDate(a)?.getTime() || 0) - (noteCreatedDate(b)?.getTime() || 0))
  })
  return index
}

const setCreatedAt = (note, date) => useStore.getState().updateNote(note.id, { created_at: date.toISOString() })

/**
 * 把笔记的创建日期改到 targetDate 那天，保留原来的时刻（不能晚于现在）。
 * 完成后提示「已移到 X 月 X 日」，可以撤销。
 */
export const moveNoteToDay = async (note, targetDate) => {
  const original = noteCreatedDate(note)
  if (!original) return false
  const next = new Date(targetDate)
  next.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), 0)
  const now = new Date()
  if (next > now) {
    if (dayKey(next) !== dayKey(now)) {
      notifyError('不能把笔记移到未来的日子')
      return false
    }
    next.setTime(now.getTime())
  }
  if (dayKey(next) === dayKey(original)) return false
  const result = await setCreatedAt(note, next)
  if (!result?.success) {
    notifyError(result?.error || '修改创建日期失败')
    return false
  }
  notifyWithAction(`已把「${note.title || '未命名笔记'}」移到 ${next.getMonth() + 1} 月 ${next.getDate()} 日`, {
    label: '撤销',
    onClick: () => { setCreatedAt(note, original) },
  })
  return true
}
