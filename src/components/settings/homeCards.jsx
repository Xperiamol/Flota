import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, ButtonBase, Checkbox, IconButton, InputBase, LinearProgress, Popover, Tooltip, Typography, alpha } from '@mui/material'
import {
  CalendarMonth, CheckCircle, Extension, Notes, PlayArrowRounded, Tag, Today, TrendingUp, Warning
} from '../common/AppIcons'
import { createTodo, fetchOverdueTodos, fetchTodosDueToday, toggleTodoComplete } from '../../api/todoAPI'
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

const thinBarSx = (theme) => ({
  height: 4,
  borderRadius: 99,
  bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.1 : 0.07),
  '& .MuiLinearProgress-bar': { borderRadius: 99 },
})

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

export function TodoRateCard({ stats, onOpen }) {
  const rate = Number.isFinite(stats.todayCompletionRate) ? stats.todayCompletionRate : null
  return (
    <HomeCard icon={CheckCircle} title="待办完成率" onOpen={onOpen}>
      <BigNumber value={rate == null ? '—' : `${rate}%`} unit={stats.todayWorkload > 0 ? `今天完成 ${stats.todayCompleted || 0} / ${stats.todayWorkload}` : '今天还没有待办'} />
      <LinearProgress variant="determinate" value={rate || 0} sx={(theme) => ({ ...thinBarSx(theme), mt: 1.5 })} />
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
              <Tooltip title="开始专注">
                <IconButton className="focus-button" size="small" aria-label={`专注「${todo.content}」`} onClick={() => startFocus(todo)}
                  sx={{ ml: 0.25, opacity: 0, transition: 'opacity 120ms ease', color: 'text.secondary', '&:focus-visible': { opacity: 1 } }}>
                  <PlayArrowRounded sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
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

const NoteLink = ({ note, meta }) => (
  <ButtonBase onClick={(event) => { stop(event); openNote(note) }}
    sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.75, px: 1, borderRadius: '8px', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}>
    <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 14 }}>{note.title || '未命名笔记'}</Typography>
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
