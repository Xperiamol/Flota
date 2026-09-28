import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, ButtonBase, Checkbox, InputBase, Popover, Tooltip, Typography, alpha } from '@mui/material'
import {
  AutoStoriesRounded, BookmarkBorder, CalendarMonth, CheckCircle, EditNote, EventRounded, Extension, Notes, PlayArrowRounded,
  PushPinRounded, RefreshRounded, SellRounded, Tag, Today, TrendingUp, Warning
} from '../common/AppIcons'
import { createTodo, fetchOverdueTodos, fetchTodosByDueDate, fetchTodosDueToday, toggleTodoComplete } from '../../api/todoAPI'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import PanelIconButton from '../common/PanelIconButton'
import WaveOrb from '../common/WaveOrb'
import { useStore } from '../../store/useStore'
import { notifyError } from '../../utils/notify'
import { formatRelativeNoteTime, parseNoteDate } from '../../utils/noteDateUtils'
import { zhCN as dateFnsZhCN } from 'date-fns/locale/zh-CN'

// ---------- 卡片外壳：细边框、无投影；标题是小号灰字，数字才是主角 ----------

export const homeCardSx = (clickable) => (theme) => ({
  height: '100%',
  boxSizing: 'border-box',
  p: '16px 18px 16px',
  borderRadius: '14px',
  // 放在白色主面板里：用略深的分组底色，不加边框
  bgcolor: theme.custom?.surface?.inset,
  transition: 'background-color 150ms ease',
  ...(clickable ? {
    cursor: 'pointer',
    '&:hover': { bgcolor: theme.custom?.surface?.insetHover },
  } : {}),
})

export function HomeCardHeader({ icon: Icon, title, meta, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875, minHeight: 24, mb: 1.5 }}>
      {Icon && <Icon sx={{ fontSize: 15, color: 'text.secondary' }} />}
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'text.secondary', letterSpacing: '0.01em' }} noWrap>
        {title}
      </Typography>
      {meta != null && <Typography sx={{ fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{meta}</Typography>}
      {action}
    </Box>
  )
}

export function HomeCard({ icon, title, meta, action, onOpen, children, sx }) {
  return (
    <Box onClick={onOpen} sx={[homeCardSx(Boolean(onOpen)), ...(Array.isArray(sx) ? sx : [sx])]}>
      <HomeCardHeader icon={icon} title={title} meta={meta} action={action} />
      {children}
    </Box>
  )
}

const BigNumber = ({ value, unit, color = 'text.primary' }) => (
  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
    <Typography component="span" sx={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </Typography>
    {unit && <Typography component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>{unit}</Typography>}
  </Box>
)

const StatRow = ({ label, value, color = 'text.primary' }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', py: 0.5, fontSize: 13 }}>
    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{label}</Typography>
    <Typography sx={{ fontSize: 13, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
  </Box>
)

const Rows = ({ children }) => (
  <Box sx={(theme) => ({ mt: 1.5, pt: 1, borderTop: `1px solid ${theme.palette.divider}` })}>{children}</Box>
)


const stop = (event) => event.stopPropagation()

const localDateKey = (date = new Date()) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
)

/** 秒数 → 「1 小时 25 分」 */
const formatDuration = (seconds = 0) => {
  const minutes = Math.round((Number(seconds) || 0) / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

/** 进入待办的专注模式；传入待办时直接开始计时 */
export const startFocus = (todo) => {
  const state = useStore.getState()
  state.setTodoNavigationRequest({ viewMode: 'focus', filterBy: 'all', todoId: todo?.id || null, autoStart: Boolean(todo) })
  state.setCurrentView('todo')
}

// ---------- 待办 ----------

/** 待办完成率：水波球显示今天的完成度（与设置里「本地使用量」同一个组件），右侧是具体数字 */
export function TodoRateCard({ stats, onOpen }) {
  const rate = Number.isFinite(stats.todayCompletionRate) ? stats.todayCompletionRate : null
  const workload = stats.todayWorkload || 0
  const done = stats.todayCompleted || 0
  const caption = workload === 0 ? '今天还没有待办' : done >= workload ? '今天的都完成了' : `还差 ${workload - done} 项`
  return (
    <HomeCard icon={CheckCircle} title="待办完成率" onOpen={onOpen}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <WaveOrb percent={rate} size={96} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>今天</Typography>
          <Typography sx={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
            {done}<Box component="span" sx={{ fontSize: 15, color: 'text.secondary', fontWeight: 500 }}> / {workload}</Box>
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>{caption}</Typography>
        </Box>
      </Box>
      <Rows>
        <StatRow label="按时完成率" value={stats.completedWithDueDate > 0 ? `${stats.onTimeRate || 0}%` : '—'} />
        <StatRow label="待完成" value={stats.pending || 0} />
      </Rows>
    </HomeCard>
  )
}

export function OverdueCard({ stats, onOpen }) {
  const overdue = stats.overdue || 0
  return (
    <HomeCard icon={Warning} title="逾期待办" onOpen={onOpen}>
      <BigNumber value={overdue} unit={overdue > 0 ? '项需要处理' : '没有逾期'} color={overdue > 0 ? 'error.main' : 'text.primary'} />
    </HomeCard>
  )
}

// 定时待办显示时间，逾期的显示日期，全天的不显示
const dueLabel = (todo, overdue) => {
  if (!todo.due_date) return ''
  const value = String(todo.due_date)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return overdue ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}` : ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (overdue && localDateKey(date) !== localDateKey()) return `${date.getMonth() + 1}/${date.getDate()}`
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const MAX_TODOS = 6

/** 今日待办：逾期 + 今天到期，可直接勾选完成、开始专注、添加今天的待办 */
export function TodayTodosCard({ onOpen, onChanged }) {
  const [items, setItems] = useState(null)
  const [done, setDone] = useState([])
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try {
      const [overdue, today] = await Promise.all([fetchOverdueTodos(), fetchTodosDueToday()])
      const overdueIds = new Set((overdue || []).map((todo) => todo.id))
      setItems([
        ...(overdue || []).map((todo) => ({ ...todo, overdue: true })),
        ...(today || []).filter((todo) => !overdueIds.has(todo.id)),
      ])
    } catch (error) {
      console.error('[首页] 加载今日待办失败', error)
      setItems([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const complete = async (todo) => {
    setDone((list) => [...list, todo.id])
    try {
      await toggleTodoComplete(todo.id)
    } catch (error) {
      notifyError(error.message || '操作失败')
    }
    // 留一下划线的完成效果再移出列表
    setTimeout(() => {
      setDone((list) => list.filter((id) => id !== todo.id))
      load()
      onChanged?.()
    }, 600)
  }

  const add = async () => {
    const content = draft.trim()
    if (!content) return
    setDraft('')
    try {
      await createTodo({ content, due_date: localDateKey() })
      load()
      onChanged?.()
    } catch (error) {
      notifyError(error.message || '添加失败')
    }
  }

  const visible = (items || []).slice(0, MAX_TODOS)
  const more = (items?.length || 0) - visible.length

  return (
    <HomeCard icon={Today} title="今日待办" meta={items?.length || null} onOpen={onOpen}>
      {items && !items.length && <Typography sx={{ fontSize: 14, color: 'text.secondary', pb: 1 }}>今天没有待办</Typography>}
      <Box sx={{ mx: -1 }}>
        {visible.map((todo) => {
          const checked = done.includes(todo.id)
          const due = dueLabel(todo, todo.overdue)
          return (
            <Box key={todo.id} onClick={stop}
              sx={{ display: 'flex', alignItems: 'center', minHeight: 34, borderRadius: '8px', pr: 0.5, '&:hover': { bgcolor: 'action.hover' }, '&:hover .focus-button': { opacity: 1 } }}>
              <Checkbox size="small" checked={checked} disabled={checked} onChange={() => complete(todo)}
                inputProps={{ 'aria-label': `完成「${todo.content}」` }} sx={{ p: 0.75 }} />
              <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 14, color: checked ? 'text.disabled' : 'text.primary', textDecoration: checked ? 'line-through' : 'none' }}>
                {todo.content}
              </Typography>
              {due && <Typography sx={{ fontSize: 12, ml: 1, color: todo.overdue ? 'error.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{due}</Typography>}
              <PanelIconButton title="开始专注" size="sm" className="focus-button" aria-label={`专注「${todo.content}」`} onClick={() => startFocus(todo)}
                sx={{ ml: 0.5, opacity: 0, '&:focus-visible': { opacity: 1 } }}>
                <PlayArrowRounded />
              </PanelIconButton>
            </Box>
          )
        })}
      </Box>
      {more > 0 && (
        <ButtonBase onClick={(event) => { stop(event); onOpen() }} sx={{ mt: 0.5, fontSize: 13, color: 'text.secondary', borderRadius: 1, '&:hover': { color: 'text.primary' } }}>
          还有 {more} 项
        </ButtonBase>
      )}
      <Box onClick={stop} sx={(theme) => ({ mt: 1, pt: 1, borderTop: `1px solid ${theme.palette.divider}` })}>
        <InputBase fullWidth value={draft} placeholder="＋ 添加今天的待办" onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) add() }}
          inputProps={{ 'aria-label': '添加今天的待办' }} sx={{ fontSize: 14, py: 0.25 }} />
      </Box>
    </HomeCard>
  )
}

export function FocusCard({ stats, onOpen }) {
  const begin = async (event) => {
    stop(event)
    // 优先专注逾期或今天的第一项待办
    try {
      const [overdue, today] = await Promise.all([fetchOverdueTodos(), fetchTodosDueToday()])
      startFocus([...(overdue || []), ...(today || [])][0] || null)
    } catch {
      startFocus(null)
    }
  }
  return (
    <HomeCard icon={TrendingUp} title="专注时长" onOpen={onOpen}
      action={(
        <ButtonBase onClick={begin} sx={(theme) => ({ height: 26, px: 1.25, borderRadius: '8px', fontSize: 12.5, fontWeight: 600, color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.1), '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) } })}>
          <PlayArrowRounded sx={{ fontSize: 16, mr: 0.25 }} />开始专注
        </ButtonBase>
      )}>
      <BigNumber value={formatDuration(stats.todayFocusTime)} unit="今天" />
      <Rows>
        <StatRow label="本周" value={formatDuration(stats.weekFocusTime)} />
        <StatRow label="本月" value={formatDuration(stats.monthFocusTime)} />
        <StatRow label="累计" value={formatDuration(stats.totalFocusTime)} />
      </Rows>
    </HomeCard>
  )
}

// ---------- 笔记 ----------

const openNote = (note) => {
  const state = useStore.getState()
  state.setCurrentView('notes')
  state.setSelectedNoteId(note.id)
}

// 没有标题的笔记（随手记等）用正文开头代替，不再一律显示「未命名笔记」
const noteDisplayTitle = (note) => {
  const title = String(note?.title || '').trim()
  if (title && title !== '无标题' && title !== 'Untitled') return title
  if (note?.note_type === 'whiteboard') return '画布笔记'
  const preview = stripMarkdownToPreviewText(note?.content || '').trim()
  return preview ? preview.slice(0, 40) : '未命名笔记'
}

const NoteLink = ({ note, meta }) => (
  <ButtonBase onClick={(event) => { stop(event); openNote(note) }}
    sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.75, px: 1, borderRadius: '8px', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}>
    <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 14 }}>{noteDisplayTitle(note)}</Typography>
    {meta && <Typography sx={{ flexShrink: 0, fontSize: 12, color: 'text.secondary' }}>{meta}</Typography>}
  </ButtonBase>
)

/** 最近笔记：最近编辑的几篇，点击直接打开 */
export function RecentNotesCard({ onOpen }) {
  const notes = useStore((state) => state.notes)
  const recent = useMemo(() => notes
    .filter((note) => !note.is_deleted)
    .sort((a, b) => (parseNoteDate(b.updated_at)?.getTime() || 0) - (parseNoteDate(a.updated_at)?.getTime() || 0))
    .slice(0, 5), [notes])
  return (
    <HomeCard icon={Notes} title="最近笔记" onOpen={onOpen}>
      {!recent.length && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>还没有笔记</Typography>}
      <Box sx={{ mx: -1 }}>
        {recent.map((note) => (
          <NoteLink key={note.id} note={note} meta={formatRelativeNoteTime(note.updated_at || note.created_at, { locale: dateFnsZhCN })} />
        ))}
      </Box>
    </HomeCard>
  )
}

export function NotesOverviewCard({ noteStats, onOpen }) {
  return (
    <HomeCard icon={Notes} title="笔记概览" onOpen={onOpen}>
      <BigNumber value={noteStats.active} unit="篇笔记" />
      <Rows>
        <StatRow label="置顶" value={noteStats.pinned} />
        <StatRow label="回收站" value={noteStats.deleted} />
      </Rows>
    </HomeCard>
  )
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const HEAT_CELL = 14
const HEAT_GAP = 3

/** 热力图：列 = 周、行 = 星期，格子大小固定，卡片多宽就显示多少周；点某一天看当天编辑过的笔记 */
export function HeatmapCard({ days, notes, onOpen }) {
  const [picked, setPicked] = useState(null) // { el, day }
  const [width, setWidth] = useState(0)
  const gridRef = useRef(null)
  useLayoutEffect(() => {
    const element = gridRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  // 能放下的周数（最少 8 周），最后一列是本周
  const weekCount = Math.min(Math.floor(days.length / 7), Math.max(8, Math.floor((width + HEAT_GAP) / (HEAT_CELL + HEAT_GAP)) || 13))
  const todayIndex = days.length - 1
  const todayWeekday = days.length ? new Date(`${days[todayIndex].date}T00:00:00`).getDay() : 6
  const shown = days.slice(Math.max(0, days.length - ((weekCount - 1) * 7 + todayWeekday + 1)))
  const lead = shown.length ? new Date(`${shown[0].date}T00:00:00`).getDay() : 0
  const cells = [...Array(lead).fill(null), ...shown]
  const max = Math.max(1, ...shown.map((day) => day.count))
  const total = shown.reduce((sum, day) => sum + day.count, 0)
  const weeks = Math.ceil(cells.length / 7)

  const notesOfDay = useMemo(() => {
    if (!picked) return []
    return notes.filter((note) => !note.is_deleted && [note.created_at, note.updated_at]
      .some((value) => { const date = parseNoteDate(value); return date && localDateKey(date) === picked.day.date }))
  }, [picked, notes])

  return (
    <HomeCard icon={CalendarMonth} title="笔记热力图" meta={`近 ${weeks} 周 ${total} 次编辑`} onOpen={onOpen}>
      <Box ref={gridRef} onClick={stop}
        sx={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, ${HEAT_CELL}px)`, gridTemplateRows: `repeat(7, ${HEAT_CELL}px)`, gridAutoFlow: 'column', gap: `${HEAT_GAP}px`, justifyContent: 'space-between' }}>
        {cells.map((day, index) => (day ? (
          <Tooltip key={day.date} title={`${day.date} · ${day.count} 次编辑`} placement="top" disableInteractive>
            <Box component="button" aria-label={`${day.date}，${day.count} 次编辑`} onClick={(event) => setPicked({ el: event.currentTarget, day })}
              sx={(theme) => ({
                width: HEAT_CELL, height: HEAT_CELL, p: 0, border: 0, borderRadius: '3px', cursor: 'pointer',
                bgcolor: day.count === 0
                  ? alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06)
                  : alpha(theme.palette.primary.main, 0.25 + 0.75 * (day.count / max)),
                outline: index === cells.length - 1 ? `1.5px solid ${alpha(theme.palette.text.primary, 0.45)}` : 'none',
                outlineOffset: 1,
                '&:hover': { filter: 'brightness(1.15)' },
              })} />
          </Tooltip>
        ) : <Box key={`pad-${index}`} />))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{shown[0] ? `${Number(shown[0].date.slice(5, 7))}/${Number(shown[0].date.slice(8))}` : ''}</Typography>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>今天</Typography>
      </Box>
      <Popover open={Boolean(picked)} anchorEl={picked?.el} onClose={() => setPicked(null)} onClick={stop}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { width: 280, p: 1, borderRadius: '12px' } } }}>
        {picked && (
          <>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', px: 1, pt: 0.5, pb: 0.75 }}>
              {Number(picked.day.date.slice(5, 7))} 月 {Number(picked.day.date.slice(8))} 日 周{WEEKDAYS[new Date(`${picked.day.date}T00:00:00`).getDay()]} · {picked.day.count} 次编辑
            </Typography>
            {notesOfDay.map((note) => <NoteLink key={note.id} note={note} />)}
            {!notesOfDay.length && <Typography sx={{ fontSize: 13, color: 'text.secondary', px: 1, pb: 0.75 }}>这天编辑过的笔记已删除，或之后又被修改过</Typography>}
          </>
        )}
      </Popover>
    </HomeCard>
  )
}

/** 高频词：点一个词搜索相关笔记 */
export function TopWordsCard({ words, onOpen }) {
  const search = (event, word) => {
    stop(event)
    useStore.getState().openNoteSearch(word)
  }
  return (
    <HomeCard icon={Tag} title="高频词" onOpen={onOpen}>
      {!words.length && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>笔记还不够多</Typography>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {words.slice(0, 12).map((item, index) => (
          <ButtonBase key={item.word} onClick={(event) => search(event, item.word)}
            sx={{ fontSize: index < 3 ? 15 : 14, fontWeight: index < 3 ? 600 : 400, color: 'text.primary', borderRadius: '6px', px: 0.25, '&:hover': { color: 'primary.main' } }}>
            {item.word}
            <Box component="span" sx={{ ml: 0.5, fontSize: 11.5, color: 'text.secondary', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>{item.count}</Box>
          </ButtonBase>
        ))}
      </Box>
    </HomeCard>
  )
}

export function PluginsCard({ plugins, onOpen }) {
  return (
    <HomeCard icon={Extension} title="插件" meta={plugins.length || null} onOpen={onOpen}>
      {!plugins.length && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>还没有安装插件</Typography>}
      {plugins.slice(0, 5).map((plugin) => (
        <Box key={plugin.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: 99, flexShrink: 0, bgcolor: plugin.enabled === false ? 'text.disabled' : 'success.main' }} />
          <Typography noWrap sx={{ fontSize: 14, flex: 1, minWidth: 0 }}>{(plugin.manifest?.name || plugin.id).replace(/\s*\(Built-in\)$/i, '')}</Typography>
        </Box>
      ))}
      {plugins.length > 5 && <Typography sx={{ fontSize: 13, color: 'text.secondary', pt: 0.5 }}>还有 {plugins.length - 5} 个</Typography>}
    </HomeCard>
  )
}

// ---------- 新增卡片 ----------

/** 快速记录：写一句话直接存成笔记，不用离开首页；Ctrl/⌘ + Enter 保存 */
export function QuickNoteCard() {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(null)
  const save = async () => {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    const result = await useStore.getState().createNote({ content, selectAfterCreate: false })
    setSaving(false)
    if (!result?.success) return notifyError(result?.error || '保存失败')
    setDraft('')
    setSaved(result.data)
  }
  useEffect(() => {
    if (!saved) return undefined
    const timer = setTimeout(() => setSaved(null), 4000)
    return () => clearTimeout(timer)
  }, [saved])
  return (
    <HomeCard icon={EditNote} title="快速记录" meta={saved ? (
      <ButtonBase onClick={() => openNote(saved)} sx={{ fontSize: 12, color: 'success.main', borderRadius: 1 }}>已保存 · 打开</ButtonBase>
    ) : null}>
      <Box onClick={stop} sx={(theme) => ({
        borderRadius: '10px', px: 1.25, py: 0.75, bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.06 : 0.7),
        border: `1px solid ${theme.palette.divider}`, transition: 'border-color 150ms ease, box-shadow 150ms ease',
        '&:focus-within': { borderColor: alpha(theme.palette.primary.main, 0.55), boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.1)}` },
      })}>
        <InputBase fullWidth multiline minRows={2} maxRows={8} value={draft} placeholder="记下一个想法…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); save() }
          }}
          inputProps={{ 'aria-label': '快速记录' }} sx={{ fontSize: 14, lineHeight: 1.6 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'} + Enter 保存</Typography>
          <ButtonBase onClick={save} disabled={!draft.trim() || saving}
            sx={(theme) => ({
              height: 26, px: 1.25, borderRadius: '8px', fontSize: 12.5, fontWeight: 600,
              color: draft.trim() ? 'primary.contrastText' : 'text.disabled',
              bgcolor: draft.trim() ? 'primary.main' : alpha(theme.palette.text.primary, 0.06),
              transition: 'background-color 150ms ease',
            })}>
            {saving ? '保存中…' : '保存为笔记'}
          </ButtonBase>
        </Box>
      </Box>
    </HomeCard>
  )
}

const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 未来 7 天：按天列出即将到期的待办，提前看到这周要做什么 */
export function UpcomingCard({ onOpen }) {
  const [groups, setGroups] = useState(null)
  useEffect(() => {
    let alive = true
    fetchTodosByDueDate().then((todos) => {
      if (!alive) return
      const today = new Date()
      const start = localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))
      const end = localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7))
      const byDay = new Map()
      ;(Array.isArray(todos) ? todos : []).forEach((todo) => {
        if (todo.is_completed || !todo.due_date) return
        const key = String(todo.due_date).slice(0, 10)
        if (key < start || key > end) return
        if (!byDay.has(key)) byDay.set(key, [])
        byDay.get(key).push(todo)
      })
      setGroups([...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)))
    }).catch(() => alive && setGroups([]))
    return () => { alive = false }
  }, [])
  const total = (groups || []).reduce((sum, [, list]) => sum + list.length, 0)
  const tomorrow = localDateKey(new Date(Date.now() + 86400000))
  return (
    <HomeCard icon={EventRounded} title="未来 7 天" meta={total || null} onOpen={onOpen}>
      {groups && !groups.length && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>接下来一周没有安排</Typography>}
      {(groups || []).slice(0, 4).map(([day, list]) => {
        const date = new Date(`${day}T00:00:00`)
        return (
          <Box key={day} sx={{ display: 'flex', gap: 1.5, py: 0.5 }}>
            <Typography sx={{ width: 44, flexShrink: 0, fontSize: 12, color: 'text.secondary', pt: '2px', fontVariantNumeric: 'tabular-nums' }}>
              {day === tomorrow ? '明天' : WEEKDAY_SHORT[date.getDay()]}
              <Box component="span" sx={{ display: 'block', fontSize: 11, color: 'text.disabled' }}>{date.getMonth() + 1}/{date.getDate()}</Box>
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {list.slice(0, 3).map((todo) => (
                <Typography key={todo.id} noWrap sx={{ fontSize: 13.5, lineHeight: 1.7 }}>{todo.content}</Typography>
              ))}
              {list.length > 3 && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>还有 {list.length - 3} 项</Typography>}
            </Box>
          </Box>
        )
      })}
    </HomeCard>
  )
}

const isClipNote = (note) => typeof note.meta === 'string' ? note.meta.includes('"type":"clip"') : note.meta?.source?.type === 'clip'
const clipSite = (note) => {
  try {
    const meta = typeof note.meta === 'string' ? JSON.parse(note.meta) : note.meta
    return meta?.source?.site || new URL(meta?.source?.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** 最近剪藏：网页剪藏进来的文章，方便回头读 */
export function RecentClipsCard({ onOpen }) {
  const notes = useStore((state) => state.notes)
  const clips = useMemo(() => notes
    .filter((note) => !note.is_deleted && isClipNote(note))
    .sort((a, b) => (parseNoteDate(b.created_at)?.getTime() || 0) - (parseNoteDate(a.created_at)?.getTime() || 0))
    .slice(0, 5), [notes])
  return (
    <HomeCard icon={BookmarkBorder} title="最近剪藏" onOpen={onOpen}>
      {!clips.length && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>用浏览器扩展剪藏网页后会出现在这里</Typography>}
      <Box sx={{ mx: -1 }}>
        {clips.map((note) => <NoteLink key={note.id} note={note} meta={clipSite(note)} />)}
      </Box>
    </HomeCard>
  )
}

/** 置顶笔记：常用笔记的快捷入口 */
export function PinnedNotesCard({ onOpen }) {
  const notes = useStore((state) => state.notes)
  const pinned = useMemo(() => notes.filter((note) => note.is_pinned && !note.is_deleted).slice(0, 6), [notes])
  return (
    <HomeCard icon={PushPinRounded} title="置顶笔记" meta={pinned.length || null} onOpen={onOpen}>
      {!pinned.length && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>在笔记菜单里选择「置顶」，常用笔记会出现在这里</Typography>}
      <Box sx={{ mx: -1 }}>
        {pinned.map((note) => <NoteLink key={note.id} note={note} />)}
      </Box>
    </HomeCard>
  )
}

/** 温故：每天随机翻出一篇一周前的笔记，点「换一篇」再抽 */
export function ReviewCard() {
  const notes = useStore((state) => state.notes)
  const [offset, setOffset] = useState(0)
  const candidates = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000
    return notes.filter((note) => !note.is_deleted && note.note_type !== 'whiteboard'
      && (parseNoteDate(note.updated_at || note.created_at)?.getTime() || 0) < cutoff
      && stripMarkdownToPreviewText(note.content || '').trim().length > 20)
  }, [notes])
  // 以日期做种子：同一天里刷新首页看到的是同一篇
  const daySeed = Math.floor(Date.now() / 86400000)
  const note = candidates.length ? candidates[(daySeed * 7919 + offset) % candidates.length] : null
  const age = note ? formatRelativeNoteTime(note.created_at || note.updated_at, { locale: dateFnsZhCN }) : ''
  return (
    <HomeCard icon={AutoStoriesRounded} title="温故" onOpen={note ? () => openNote(note) : undefined}
      action={candidates.length > 1 ? (
        <PanelIconButton title="换一篇" size="sm" onClick={(event) => { stop(event); setOffset((value) => value + 1) }}>
          <RefreshRounded />
        </PanelIconButton>
      ) : null}>
      {!note && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>笔记攒多一些后，这里会帮你翻出旧笔记重读</Typography>}
      {note && (
        <>
          <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 0.5 }} noWrap>{noteDisplayTitle(note)}</Typography>
          <Typography sx={{
            fontSize: 13.5, color: 'text.secondary', lineHeight: 1.65,
            display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {stripMarkdownToPreviewText(note.content || '').slice(0, 240)}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 1 }}>写于{age}</Typography>
        </>
      )}
    </HomeCard>
  )
}

/** 常用标签：点标签在笔记页里搜索 */
export function TagsCard({ onOpen }) {
  const notes = useStore((state) => state.notes)
  // 直接按当前笔记统计，已删除笔记的标签不会出现
  const tags = useMemo(() => {
    const counts = new Map()
    notes.forEach((note) => {
      if (note.is_deleted) return
      ;(Array.isArray(note.tags) ? note.tags : []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)
  }, [notes])
  return (
    <HomeCard icon={SellRounded} title="常用标签" meta={tags.length || null} onOpen={onOpen}>
      {!tags.length && <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>给笔记加上标签后，可以从这里快速筛选</Typography>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {tags.map(([tag, count]) => (
          <ButtonBase key={tag} onClick={(event) => { stop(event); useStore.getState().openNoteSearch(tag) }}
            sx={(theme) => ({
              height: 26, px: 1, gap: 0.5, borderRadius: '8px', fontSize: 13,
              bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.07 : 0.05),
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main' },
            })}>
            #{tag}
            <Box component="span" sx={{ fontSize: 11, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{count}</Box>
          </ButtonBase>
        ))}
      </Box>
    </HomeCard>
  )
}
