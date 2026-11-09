// 首页内置卡片的数据与渲染：首页和桌面上的卡片共用，保证两处显示一致。
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { fetchTodoStats } from '../../api/todoAPI'
import { fetchActivityHeatmap } from '../../api/noteAPI'
import { fetchInstalledPlugins } from '../../api/pluginAPI'
import {
  FocusCard, HeatmapCard, NotesOverviewCard, OverdueCard, PinnedNotesCard, PluginsCard, QuickNoteCard, RecentClipsCard, RecentNotesCard,
  ReviewCard, TagsCard, TodayTodosCard, TodoRateCard, TopWordsCard, UpcomingCard,
} from './homeCards'

export const DEFAULT_TODO_STATS = {
  total: 0,
  completed: 0,
  pending: 0,
  overdue: 0,
  dueToday: 0,
  completedOnTime: 0,
  completedWithDueDate: 0,
  onTimeRate: 0,
  todayCompleted: 0,
  todayWorkload: 0,
  todayCompletionRate: null,
  totalFocusTime: 0,
  todayFocusTime: 0,
  weekFocusTime: 0,
  monthFocusTime: 0,
}

const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很',
  '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '这个', '那个',
  '可以', '因为', '所以', '如果', '然后', '已经', '已有', '复制', '链接', '广告', '联系',
  // 网页剪藏在每篇笔记开头写的来源行
  '来源', '剪藏', '剪藏于', '原文',
])

// 热力图最多显示半年，实际显示多少周由卡片宽度决定
const HEATMAP_DAYS = 182

const formatLocalDateKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
)

/**
 * 内置卡片需要的数据。refreshKey 变化时重新拉取统计（桌面卡片在待办变化、窗口获得焦点时刷新）。
 * @returns {{ loading, error, todoStatsDisplay, refreshTodoStats, installedPlugins, noteStats, heatmapDays, topWords, notes }}
 */
export function useHomeCardData({ refreshKey = 0 } = {}) {
  const notes = useStore((state) => state.notes)
  const trashCount = useStore((state) => state.trashNotes.length)
  const [todoStats, setTodoStats] = useState(null)
  const [activityCounts, setActivityCounts] = useState(null)
  const [installedPlugins, setInstalledPlugins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refreshTodoStats = async () => {
    try {
      const result = await fetchTodoStats()
      if (result && typeof result === 'object') setTodoStats(result)
    } catch (err) {
      console.error('[首页] 刷新待办统计失败:', err)
    }
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (!refreshKey) setLoading(true)
        setError(null)
        const todoStatsResult = await fetchTodoStats()
        if (cancelled) return
        setTodoStats(todoStatsResult && typeof todoStatsResult === 'object' ? todoStatsResult : DEFAULT_TODO_STATS)
        const pluginsResult = await fetchInstalledPlugins()
        if (!cancelled && Array.isArray(pluginsResult)) setInstalledPlugins(pluginsResult)
        // 基于变更日志的真实活动数据（精确到每天的编辑次数）
        const heatmapResult = await fetchActivityHeatmap(HEATMAP_DAYS)
        if (!cancelled && heatmapResult?.success && heatmapResult.data) setActivityCounts(heatmapResult.data)
      } catch (err) {
        console.error('[首页] 加载统计数据失败:', err)
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [refreshKey])

  useEffect(() => { useStore.getState().loadTrash?.() }, [refreshKey])

  const noteStats = useMemo(() => ({
    total: notes.length,
    deleted: trashCount,
    pinned: notes.filter((note) => note.is_pinned && !note.is_deleted).length,
    active: notes.filter((note) => !note.is_deleted).length,
  }), [notes, trashCount])

  const todoStatsDisplay = useMemo(() => ({ ...DEFAULT_TODO_STATS, ...(todoStats || {}) }), [todoStats])

  // 过去半年每天的活动次数：优先用变更日志，没有时按笔记时间戳估算
  const heatmapDays = useMemo(() => {
    const counts = {}
    if (activityCounts) {
      Object.assign(counts, activityCounts)
    } else {
      notes.forEach((note) => {
        if (note.is_deleted) return
        if (note.created_at) {
          const key = formatLocalDateKey(new Date(note.created_at))
          counts[key] = (counts[key] || 0) + 1
        }
        if (note.updated_at && note.updated_at !== note.created_at) {
          const key = formatLocalDateKey(new Date(note.updated_at))
          counts[key] = (counts[key] || 0) + 1
        }
      })
    }
    const today = new Date()
    return Array.from({ length: HEATMAP_DAYS }, (_, index) => {
      const date = new Date(today)
      date.setDate(date.getDate() - (HEATMAP_DAYS - 1 - index))
      const key = formatLocalDateKey(date)
      return { date: key, count: counts[key] || 0 }
    })
  }, [notes, activityCounts])

  const topWords = useMemo(() => {
    const wordMap = {}
    notes.forEach((note) => {
      if (note.is_deleted || !note.content) return
      // 简单的中文分词（匹配 2-4 个连续的中文字符）
      ;(note.content.match(/[一-龥]{2,4}/g) || []).forEach((word) => {
        if (!STOP_WORDS.has(word)) wordMap[word] = (wordMap[word] || 0) + 1
      })
    })
    return Object.entries(wordMap).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count }))
  }, [notes])

  return { loading, error, todoStatsDisplay, refreshTodoStats, installedPlugins, noteStats, heatmapDays, topWords, notes, refreshKey }
}

/**
 * 点卡片后去往的页面：{ view, filterBy?, pluginStore? }；没有去处时返回 null。
 * 首页直接切换页面，桌面卡片则让主窗口打开对应页面。
 */
export const homeCardTarget = (cardId) => {
  switch (cardId) {
    case 'todo-rate':
    case 'todo-today':
      return { view: 'todo', filterBy: 'today' }
    case 'upcoming':
    case 'focus':
      return { view: 'todo', filterBy: 'all' }
    case 'recent-clips':
    case 'pinned-notes':
    case 'tags':
    case 'todo-overdue':
      return { view: 'todo', filterBy: 'overdue' }
    case 'notes-overview':
    case 'recent-notes':
    case 'top-words':
      return { view: 'notes' }
    case 'heatmap':
      return { view: 'timeline' }
    case 'plugins':
      return { view: 'plugins', pluginStore: true }
    default:
      return null
  }
}

/** 渲染一张内置卡片 */
export const renderBuiltinHomeCard = (cardId, data, open) => {
  switch (cardId) {
    case 'todo-rate': return <TodoRateCard stats={data.todoStatsDisplay} onOpen={open} />
    case 'todo-today': return <TodayTodosCard onOpen={open} onChanged={data.refreshTodoStats} refreshKey={data.refreshKey} />
    case 'todo-overdue': return <OverdueCard stats={data.todoStatsDisplay} onOpen={open} />
    case 'recent-notes': return <RecentNotesCard onOpen={open} />
    case 'notes-overview': return <NotesOverviewCard noteStats={data.noteStats} onOpen={open} />
    case 'focus': return <FocusCard stats={data.todoStatsDisplay} onOpen={open} />
    case 'heatmap': return <HeatmapCard days={data.heatmapDays} notes={data.notes} onOpen={open} />
    case 'top-words': return <TopWordsCard words={data.topWords} onOpen={open} />
    case 'plugins': return <PluginsCard plugins={data.installedPlugins} onOpen={open} />
    case 'quick-note': return <QuickNoteCard />
    case 'upcoming': return <UpcomingCard onOpen={open} refreshKey={data.refreshKey} />
    case 'recent-clips': return <RecentClipsCard onOpen={open} />
    case 'pinned-notes': return <PinnedNotesCard onOpen={open} />
    case 'review': return <ReviewCard />
    case 'tags': return <TagsCard onOpen={open} />
    default: return null
  }
}
