import { subscribeGenerationTasks, getGenerationTaskPhase, cancelGenerationTask } from '../../utils/aiCore/generationTask'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Box, Button, Checkbox, CircularProgress, Radio, Typography, alpha, useTheme } from '@mui/material'
import {
  AddTask as TodoIcon,
  Checklist as TodosIcon,
  NoteAdd as NoteAddIcon,
  EditNote as EditNoteIcon,
  Brush as WhiteboardIcon,
  Psychology as MemoryIcon,
  Settings as SettingsIcon,
  Extension as WidgetIcon,
  Article as DocIcon,
  CheckRounded as DoneIcon,
  ErrorOutline as ErrorIcon,
  ChevronRight as ChevronIcon,
} from '../common/AppIcons'
import { useStore } from '../../store/useStore'
import WidgetHost from '../widgets/WidgetHost'
import { openWidgetInstance } from '../../store/useWidgetStore'
import { useWidgetActionProgress } from '../../utils/widgets/widgetActionProgress'
import { insertInstanceIntoNote } from '../../utils/widgets/widgetActions'
import { askAI } from '../../utils/widgets/askAI'
import { notifyError, notifySuccess } from '../../utils/notify'
import { useActionSteps } from '../../utils/aiCore/actionProgress'

// AI 待确认动作卡（AI 功能页与「问 AI」小窗共用）。
//
// 用户视角的状态流：
//   pending   —— 待你确认：「确认」「修改」「忽略」；批量卡可勾选后提交
//   running   —— 执行中：进度 + 用时，可停止的任务带「停止」
//   done      —— 已完成：收成一行，单篇笔记 / 画布可「查看」，待办可「去待办」
//   failed    —— 没有成功：显示原因，可「重试」或「修改」
//   dismissed —— 已忽略（一行，可「恢复」）
//   superseded—— AI 给出了新方案，旧卡自动失效（一行）
//
// 视觉上刻意保持安静：中性底色、细描边、一个主按钮，不用渐变 / 光晕 / 彩色底。

export const ACTION_LABELS = {
  update_settings: '修改设置',
  create_note: '新建笔记',
  edit_note: '编辑笔记',
  edit_notes: '批量编辑笔记',
  create_whiteboard: '新建画布',
  update_whiteboard: '修改画布',
  create_todo: '新建待办',
  create_todos: '新建待办',
  add_memory: '记住',
  update_memory: '更新记忆',
  write_long_document: '写长文档',
  save_document: '保存长文',
  create_widget: '生成组件',
  update_widget: '修改组件',
  create_widget_instance: '新建组件实例',
  add_widget_records: '写入组件数据'
}

const ACTION_ICONS = {
  update_settings: SettingsIcon,
  create_note: NoteAddIcon,
  edit_note: EditNoteIcon,
  edit_notes: EditNoteIcon,
  create_whiteboard: WhiteboardIcon,
  update_whiteboard: WhiteboardIcon,
  create_todo: TodoIcon,
  create_todos: TodosIcon,
  add_memory: MemoryIcon,
  update_memory: MemoryIcon,
  write_long_document: DocIcon,
  save_document: DocIcon,
  create_widget: WidgetIcon,
  update_widget: WidgetIcon,
  create_widget_instance: WidgetIcon,
  add_widget_records: WidgetIcon
}

const TODO_ACTIONS = new Set(['create_todo', 'create_todos'])
const KNOWN_STATUSES = new Set(['pending', 'running', 'done', 'failed', 'cancelled', 'dismissed', 'superseded'])

const getStatus = (action, executing) => {
  if (executing) return 'running'
  return KNOWN_STATUSES.has(action.status) ? action.status : 'pending'
}

const getDetail = (action) =>
  action.summary || action.label || ACTION_LABELS[action.name] || action.name

const formatTodoDue = (s) => {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const formatRepeat = (todo) => {
  if (!todo.repeat_type || todo.repeat_type === 'none') return ''
  const interval = Number(todo.repeat_interval) > 1 ? Number(todo.repeat_interval) : 1
  const prefix = interval > 1 ? `每${interval}` : '每'
  const unit = { daily: '天', weekly: '周', monthly: '月', yearly: '年' }[todo.repeat_type]
  return unit ? `${prefix}${unit}` : ''
}

const formatElapsed = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// ─── 基础样式 ───

const surfaceSx = (theme, compact, tone) => {
  const dark = theme.palette.mode === 'dark'
  return {
    mt: 0.75,
    maxWidth: compact ? undefined : 480,
    borderRadius: compact ? '10px' : '12px',
    border: '1px solid',
    borderColor: tone === 'error'
      ? alpha(theme.palette.error.main, dark ? 0.4 : 0.3)
      : alpha(theme.palette.text.primary, dark ? 0.12 : 0.1),
    bgcolor: dark ? alpha('#fff', 0.035) : theme.palette.background.paper,
    overflow: 'hidden'
  }
}

const btnSx = (compact) => ({
  flexShrink: 0,
  minWidth: 0,
  height: compact ? 26 : 28,
  px: compact ? 1.1 : 1.25,
  borderRadius: '8px',
  textTransform: 'none',
  fontSize: compact ? 12 : 12.5,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  boxShadow: 'none',
  '&:hover': { boxShadow: 'none' }
})

const ghostBtnSx = (compact) => ({ ...btnSx(compact), color: 'text.secondary' })

const PrimaryButton = ({ compact, children, ...props }) => (
  <Button size="small" variant="contained" color="primary" disableElevation sx={btnSx(compact)} {...props}>
    {children}
  </Button>
)

const GhostButton = ({ compact, children, ...props }) => (
  <Button size="small" variant="text" color="inherit" sx={ghostBtnSx(compact)} {...props}>
    {children}
  </Button>
)

// 卡片顶部：类型图标 + 动作名；右侧放状态或附加信息
const CardHeader = ({ action, compact, right, label }) => {
  const Icon = ACTION_ICONS[action.name] || EditNoteIcon
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, px: compact ? 1.1 : 1.25, pt: compact ? 0.85 : 1, minHeight: 20 }}>
      <Icon sx={{ fontSize: 15, color: 'text.secondary', flexShrink: 0 }} />
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'text.secondary' }} noWrap>
        {label || ACTION_LABELS[action.name] || '操作'}
      </Typography>
      {right}
    </Box>
  )
}

const CardBody = ({ compact, children, sx }) => (
  <Box sx={{ px: compact ? 1.1 : 1.25, pt: 0.4, ...sx }}>{children}</Box>
)

const CardFooter = ({ compact, left, children }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: compact ? 0.85 : 1, pt: 0.75, pb: compact ? 0.75 : 0.85 }}>
    <Box sx={{ flex: 1, minWidth: 0, pl: 0.25 }}>{left}</Box>
    {children}
  </Box>
)

const Summary = ({ compact, children }) => (
  <Typography sx={{ fontSize: compact ? 13 : 13.5, fontWeight: 600, lineHeight: 1.5, color: 'text.primary', wordBreak: 'break-word' }}>
    {children}
  </Typography>
)

const Note = ({ children, color = 'text.secondary', sx }) => (
  <Typography sx={{ display: 'block', mt: 0.4, fontSize: 12, lineHeight: 1.55, color, wordBreak: 'break-word', ...sx }}>
    {children}
  </Typography>
)

const ErrorBadge = ({ children = '没有成功' }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35, color: 'error.main', flexShrink: 0 }}>
    <ErrorIcon sx={{ fontSize: 14 }} />
    <Typography sx={{ fontSize: 11.5, fontWeight: 600 }}>{children}</Typography>
  </Box>
)

// ─── 一行式：已完成 / 已忽略 / 已替代 ───

const useOpenResult = (action) => {
  const setSelectedNoteId = useStore((state) => state.setSelectedNoteId)
  const setCurrentView = useStore((state) => state.setCurrentView)
  if (action.resultNoteId != null) {
    return { label: '查看', open: () => { setSelectedNoteId?.(action.resultNoteId); setCurrentView?.('notes') } }
  }
  if (TODO_ACTIONS.has(action.name)) {
    return { label: '去待办', open: () => setCurrentView?.('todo') }
  }
  return null
}

// 停止后仍保存了部分结果（如长文已写完的章节）时可以直接打开
const OpenPartialResult = ({ action, compact }) => {
  const result = useOpenResult(action)
  return result ? <GhostButton compact={compact} onClick={result.open}>{result.label}</GhostButton> : null
}

const rowSx = (theme) => ({
  mt: 0.75,
  pl: 1,
  pr: 0.5,
  minHeight: 30,
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  border: '1px solid',
  borderColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.1 : 0.08),
})

const DoneRow = ({ action }) => {
  const result = useOpenResult(action)
  const text = action.resultMessage || getDetail(action)
  return (
    <Box sx={rowSx}>
      <DoneIcon sx={{ fontSize: 15, color: 'success.main', flexShrink: 0 }} />
      <Typography noWrap title={text} sx={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'text.primary' }}>
        {text}
      </Typography>
      {result ? (
        <Button size="small" color="primary" onClick={result.open} endIcon={<ChevronIcon sx={{ fontSize: '16px !important', ml: -0.5 }} />}
          sx={{ ...btnSx(true), height: 24, px: 0.75 }}>
          {result.label}
        </Button>
      ) : <Box sx={{ width: 4 }} />}
    </Box>
  )
}

const InactiveRow = ({ action, status, onRestore }) => (
  <Box sx={(theme) => ({ ...rowSx(theme), borderStyle: 'dashed', color: 'text.disabled' })}>
    <Typography sx={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
      {status === 'dismissed' ? '已忽略' : '已被新方案替代'}
    </Typography>
    <Typography noWrap title={getDetail(action)} sx={{ flex: 1, minWidth: 0, fontSize: 12 }}>
      {getDetail(action)}
    </Typography>
    {status === 'dismissed' && onRestore ? (
      <Button size="small" color="primary" onClick={() => onRestore(action)} sx={{ ...btnSx(true), height: 24, px: 0.75 }}>
        恢复
      </Button>
    ) : <Box sx={{ width: 4 }} />}
  </Box>
)

// ─── 笔记修改前后对比：局部修改逐处显示，整篇改写只显示中间真正变化的部分 ───
const NoteEditPreview = ({ preview, compact }) => {
  const theme = useTheme()
  if (!preview?.changes?.length) return null
  const dark = theme.palette.mode === 'dark'
  const lineSx = (color) => ({
    display: 'flex', gap: 0.75, px: 0.75, py: 0.25, borderRadius: '4px',
    bgcolor: alpha(theme.palette[color].main, dark ? 0.16 : 0.07),
  })
  const textSx = { fontSize: compact ? 11.5 : 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 0 }
  const markSx = (color) => ({ ...textSx, color: `${color}.main`, fontWeight: 700, flexShrink: 0, width: 10 })
  // 上下文只取紧挨着的一行，帮助定位改的是哪里
  const contextLine = (text, end) => {
    const lines = String(text || '').split('\n')
    const line = (end ? lines[lines.length - 1] : lines[0]).trim()
    return line ? <Typography sx={{ ...textSx, color: 'text.secondary', px: 0.75 }}>{end ? `…${line}` : `${line}…`}</Typography> : null
  }
  return (
    <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.75, maxHeight: compact ? 240 : 340, overflowY: 'auto' }}>
      {preview.mode === 'rewrite' && (
        <Note sx={{ mt: 0 }}>整篇改写，约 {preview.changedLines} 行有变化，下面是改动的部分</Note>
      )}
      {preview.changes.map((change, index) => (
        <Box key={index} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, py: 0.5, borderRadius: '8px', bgcolor: alpha(theme.palette.text.primary, dark ? 0.04 : 0.025) }}>
          {contextLine(change.contextBefore, true)}
          {change.before && (
            <Box sx={lineSx('error')}>
              <Typography sx={markSx('error')}>−</Typography>
              <Typography sx={{ ...textSx, textDecoration: 'line-through', textDecorationColor: alpha(theme.palette.error.main, 0.5) }}>{change.before}</Typography>
            </Box>
          )}
          {change.after && (
            <Box sx={lineSx('success')}>
              <Typography sx={markSx('success')}>+</Typography>
              <Typography sx={textSx}>{change.after}</Typography>
            </Box>
          )}
          {contextLine(change.contextAfter, false)}
        </Box>
      ))}
      {preview.total > preview.changes.length && (
        <Note sx={{ mt: 0 }}>还有 {preview.total - preview.changes.length} 处修改</Note>
      )}
    </Box>
  )
}

// ─── 进度条：有总数时是真实进度，否则来回移动的不定进度 ───
const ProgressBar = ({ value }) => {
  const theme = useTheme()
  const track = alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.12 : 0.08)
  return (
    <Box sx={{ mt: 0.9, height: 3, borderRadius: 99, overflow: 'hidden', position: 'relative', bgcolor: track }}>
      {value != null ? (
        <Box sx={{ height: '100%', width: `${Math.max(value, 3)}%`, borderRadius: 99, bgcolor: 'primary.main', transition: 'width 500ms ease' }} />
      ) : (
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0, width: '30%', borderRadius: 99, bgcolor: 'primary.main', opacity: 0.8,
          animation: 'flotaActionSweep 1.4s ease-in-out infinite',
          '@keyframes flotaActionSweep': { from: { left: '-30%' }, to: { left: '100%' } },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none', left: 0, width: '100%', opacity: 0.35 },
        }} />
      )}
    </Box>
  )
}

const useElapsed = () => {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const tick = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(tick)
  }, [])
  return elapsed
}

const StopButton = ({ actionId, phase, compact }) => phase ? (
  <GhostButton compact={compact} disabled={phase !== 'generating'} onClick={() => cancelGenerationTask(actionId)}>
    {phase === 'committing' ? '正在保存' : phase === 'cancelling' ? '正在停止' : '停止'}
  </GhostButton>
) : null

// ─── 执行中 ───
const RunningActionCard = ({ action, compact }) => {
  const theme = useTheme()
  const phase = useSyncExternalStore(subscribeGenerationTasks, () => getGenerationTaskPhase(action.actionId))
  const steps = useActionSteps((state) => state.byAction[action.actionId]) || []
  const elapsed = useElapsed()

  // 长文写作的步骤：规划 → 第 N 章 → 归并；用章节完成数算进度
  const root = steps.find((step) => step.stepType === 'root')
  const sections = steps.filter((step) => step.stepType === 'section')
  const total = root?.meta?.total || 0
  const doneSections = sections.filter((step) => step.status === 'done').length
  const current = [...steps].reverse().find((step) => step.status === 'running' && step.stepType !== 'root')
  const words = current?.meta?.words
  const progress = total > 0 ? Math.min(100, Math.round((doneSections / total) * 100)) : null
  const currentLabel = current ? `${current.title}${words ? ` · ${words.toLocaleString()} 字` : ''}` : null

  return (
    <Box aria-live="polite" sx={surfaceSx(theme, compact)}>
      <CardHeader action={action} compact={compact} right={
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {total > 0 ? `${doneSections}/${total} 章 · ` : ''}{formatElapsed(elapsed)}
        </Typography>
      } />
      <CardBody compact={compact} sx={{ pb: phase ? 0 : (compact ? 1 : 1.1) }}>
        <Summary compact={compact}>{getDetail(action)}</Summary>
        <ProgressBar value={progress} />
        <Note>{currentLabel || '正在处理，可以继续聊别的'}</Note>
      </CardBody>
      {phase && (
        <CardFooter compact={compact}>
          <StopButton actionId={action.actionId} phase={phase} compact={compact} />
        </CardFooter>
      )}
    </Box>
  )
}

// ─── 普通卡 ───
const SimpleActionCard = ({ action, executing, onExecute, onDismiss, onRestore, onRevise, compact }) => {
  const theme = useTheme()
  const status = getStatus(action, executing)
  if (status === 'dismissed' || status === 'superseded') return <InactiveRow action={action} status={status} onRestore={onRestore} />
  if (status === 'running') return <RunningActionCard action={action} compact={compact} />
  if (status === 'done') return <DoneRow action={action} />

  const failed = status === 'failed'
  const cancelled = status === 'cancelled'
  const retryable = failed || cancelled

  return (
    <Box sx={surfaceSx(theme, compact, failed ? 'error' : null)}>
      <CardHeader action={action} compact={compact} right={
        failed ? <ErrorBadge /> : cancelled ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>已停止</Typography> : null
      } />
      <CardBody compact={compact}>
        <Summary compact={compact}>{getDetail(action)}</Summary>
        {failed && action.error && <Note color="error.main">{action.error}</Note>}
        {cancelled && action.error && action.error !== '已停止' && <Note>{action.error}</Note>}
        {!retryable && action.name === 'edit_note' && <NoteEditPreview preview={action.preview} compact={compact} />}
        {!retryable && action.name === 'update_widget' && (
          <Note>会作用于这个组件的所有实例，数据保留，完成后可以撤销。</Note>
        )}
        {!retryable && action.name === 'save_document' && Array.isArray(action.args?.headings) && action.args.headings.length > 0 && (
          <Box component="ul" sx={{ m: 0, mt: 0.4, pl: 2.25, color: 'text.secondary' }}>
            {action.args.headings.slice(0, 8).map((heading, index) => (
              <Typography component="li" key={`${heading}-${index}`} sx={{ fontSize: 12, lineHeight: 1.6 }}>{heading.replace(/^#+\s*/, '')}</Typography>
            ))}
            {action.args.headings.length > 8 && <Typography component="li" sx={{ fontSize: 12, lineHeight: 1.6, listStyle: 'none' }}>…</Typography>}
          </Box>
        )}
        {!retryable && action.name === 'create_widget' && (
          <Note>{action.args?.code ? '已在沙箱里预跑通过，确认后固定到侧边栏。' : '生成后会先预览检查，有问题自动修复，完成后固定到侧边栏。'}</Note>
        )}
        {!retryable && action.name === 'create_todo' && Array.isArray(action.args?.subtasks) && action.args.subtasks.length > 0 && (
          <Box component="ul" sx={{ m: 0, mt: 0.4, pl: 2.25, color: 'text.secondary' }}>
            {action.args.subtasks.map((subtask, index) => (
              <Typography component="li" key={`${subtask.content}-${index}`} sx={{ fontSize: 12, lineHeight: 1.6 }}>
                {subtask.content}
              </Typography>
            ))}
          </Box>
        )}
        {!retryable && action.memoryReview?.summary && (
          <Box sx={{ mt: 0.75, pt: 0.75, borderTop: 1, borderColor: 'divider' }}>
            <Note sx={{ mt: 0 }} color={action.memoryReview.level === 'warning' ? 'warning.main' : 'text.secondary'}>
              {action.memoryReview.summary}
            </Note>
            {action.memoryReview.candidates?.slice(0, 2).map((candidate) => (
              <Note key={candidate.id || candidate.content} sx={{ mt: 0.25 }}>相似记忆：{candidate.content}</Note>
            ))}
          </Box>
        )}
      </CardBody>
      <CardFooter compact={compact}>
        {!retryable && onDismiss && <GhostButton compact={compact} onClick={() => onDismiss(action)}>忽略</GhostButton>}
        {onRevise && <GhostButton compact={compact} onClick={() => onRevise(action)}>修改</GhostButton>}
        {cancelled && action.resultNoteId != null && <OpenPartialResult action={action} compact={compact} />}
        <PrimaryButton compact={compact} onClick={() => onExecute?.(action)}>{retryable ? '重试' : '确认'}</PrimaryButton>
      </CardFooter>
    </Box>
  )
}

// ─── 批量卡：勾选后提交；整行可点，支持全选 ───
const BatchActionCard = ({
  action, executing, onExecute, onDismiss, onRestore, onRevise, compact,
  itemsKey, makeKey, title, intro = '', submitLabel, renderItem
}) => {
  const theme = useTheme()
  const [items, setItems] = useState(() => {
    const initial = Array.isArray(action.args?.[itemsKey]) ? action.args[itemsKey] : []
    return initial.map((it, i) => ({ ...it, _key: makeKey(it, i), _selected: true }))
  })
  const status = getStatus(action, executing)
  // 失败时保留勾选列表，重试只提交用户当时选中的条目
  if (!['pending', 'running', 'failed'].includes(status)) {
    return <SimpleActionCard action={action} executing={executing} onExecute={onExecute} onDismiss={onDismiss} onRestore={onRestore} compact={compact} />
  }

  const running = status === 'running'
  const failed = status === 'failed'
  const selectedCount = items.filter((it) => it._selected).length
  const allSelected = selectedCount === items.length
  const toggle = (key) => {
    if (running) return
    setItems((prev) => prev.map((it) => it._key === key ? { ...it, _selected: !it._selected } : it))
  }
  const toggleAll = () => setItems((prev) => prev.map((it) => ({ ...it, _selected: !allSelected })))
  const submit = () => {
    const final = items.filter((it) => it._selected).map(({ _key, _selected, ...rest }) => rest)
    if (final.length === 0) return
    onExecute?.(action, { [itemsKey]: final })
  }
  const dark = theme.palette.mode === 'dark'

  return (
    <Box sx={surfaceSx(theme, compact, failed ? 'error' : null)}>
      <CardHeader action={action} compact={compact} label={title(items.length)} right={
        failed ? <ErrorBadge /> : running ? <CircularProgress size={12} thickness={5} /> : null
      } />
      <CardBody compact={compact}>
        {failed && action.error && <Note color="error.main" sx={{ mt: 0, mb: 0.5 }}>{action.error}</Note>}
        {intro && <Note sx={{ mt: 0, mb: 0.5 }}>{intro}</Note>}
      </CardBody>
      <Box sx={{ mx: compact ? 0.6 : 0.75, maxHeight: compact ? 240 : 300, overflowY: 'auto' }}>
        {items.map((it) => (
          <Box
            key={it._key}
            role="checkbox"
            aria-checked={it._selected}
            tabIndex={running ? -1 : 0}
            onClick={() => toggle(it._key)}
            onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(it._key) } }}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.9,
              px: 0.6,
              py: 0.7,
              borderRadius: '8px',
              cursor: running ? 'default' : 'pointer',
              userSelect: 'none',
              opacity: it._selected ? 1 : 0.45,
              transition: 'opacity 120ms, background-color 120ms',
              '&:hover': running ? {} : { bgcolor: alpha(theme.palette.text.primary, dark ? 0.06 : 0.04) },
              '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
              '& + &': { borderTop: '1px solid', borderTopColor: 'divider', borderTopLeftRadius: 0, borderTopRightRadius: 0 },
            }}
          >
            {/* 与全应用一致的主题勾选框；整行可点，勾选框只负责显示 */}
            <Checkbox
              checked={it._selected}
              disabled={running}
              tabIndex={-1}
              inputProps={{ 'aria-hidden': true }}
              sx={{ p: 0, mt: '1px', flexShrink: 0, pointerEvents: 'none' }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>{renderItem(it, compact)}</Box>
          </Box>
        ))}
      </Box>
      <CardFooter compact={compact} left={!running && items.length > 1 && (
        <Button size="small" color="inherit" onClick={toggleAll} sx={{ ...ghostBtnSx(compact), px: 0.75, fontWeight: 500 }}>
          {allSelected ? '全不选' : '全选'}
          <Box component="span" sx={{ ml: 0.5, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>{selectedCount}/{items.length}</Box>
        </Button>
      )}>
        {!running && !failed && onDismiss && <GhostButton compact={compact} onClick={() => onDismiss(action)}>忽略</GhostButton>}
        {!running && onRevise && <GhostButton compact={compact} onClick={() => onRevise(action)}>修改</GhostButton>}
        <PrimaryButton compact={compact} onClick={submit} disabled={running || selectedCount === 0}
          startIcon={running ? <CircularProgress size={11} thickness={5} color="inherit" /> : null}>
          {running ? '正在执行' : failed ? `重试 ${selectedCount} 条` : submitLabel(selectedCount)}
        </PrimaryButton>
      </CardFooter>
    </Box>
  )
}

// 待办 / 笔记条目里的小标签：中性描边，只有「重要」「紧急」用文字颜色区分
const Tag = ({ children, color = 'text.secondary' }) => (
  <Box component="span" sx={(theme) => ({
    display: 'inline-flex', alignItems: 'center', height: 18, px: 0.6, borderRadius: '5px',
    fontSize: 11, fontWeight: 500, lineHeight: 1, color, whiteSpace: 'nowrap',
    border: '1px solid', borderColor: alpha(theme.palette.text.primary, 0.12),
  })}>
    {children}
  </Box>
)

const renderTodoItem = (t, compact) => {
  const repeat = formatRepeat(t)
  const hasTags = t.parent_id != null || t.due_date || repeat || t.is_important || t.is_urgent
  return (
    <>
      <Typography sx={{ fontSize: compact ? 12.5 : 13, fontWeight: 500, lineHeight: 1.45, wordBreak: 'break-word' }}>
        {t.content}
      </Typography>
      {t.description && <Note sx={{ mt: 0.2 }}>{t.description}</Note>}
      {Array.isArray(t.subtasks) && t.subtasks.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.25, pl: 2, color: 'text.secondary' }}>
          {t.subtasks.map((subtask, index) => (
            <Typography component="li" key={`${subtask.content}-${index}`} sx={{ fontSize: 11.5, lineHeight: 1.55 }}>
              {subtask.content}
            </Typography>
          ))}
        </Box>
      )}
      {hasTags && (
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
          {t.due_date && <Tag>{formatTodoDue(t.due_date)}</Tag>}
          {repeat && <Tag>{repeat}</Tag>}
          {t.is_important && <Tag color="error.main">重要</Tag>}
          {t.is_urgent && <Tag color="warning.main">紧急</Tag>}
          {t.parent_id != null && <Tag>父待办 #{t.parent_id}</Tag>}
        </Box>
      )}
    </>
  )
}

const renderNoteEditItem = (e, compact) => (
  <>
    <Typography sx={{ fontSize: 11, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>#{e.id}</Typography>
    {e.title !== undefined && (
      <Typography sx={{ fontSize: compact ? 12.5 : 13, fontWeight: 500, lineHeight: 1.45, wordBreak: 'break-word' }}>
        标题改为「{e.title || '（空）'}」
      </Typography>
    )}
    {e.tags !== undefined && (
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.4, flexWrap: 'wrap' }}>
        {String(e.tags).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).map((tag, i) => (
          <Tag key={`${tag}-${i}`}>{tag}</Tag>
        ))}
      </Box>
    )}
  </>
)

// ─── 组件生成 / 修改：执行中显示步骤，完成后显示可操作的预览 ───
const WIDGET_ACTIONS = new Set(['create_widget', 'update_widget'])

const WIDGET_STEPS = [
  { stage: 'writing', label: '编写组件' },
  { stage: 'testing', label: '预览检查' },
  { stage: 'fixing', label: '自动修复' },
  { stage: 'saving', label: '保存' },
]

const WidgetProgressSteps = ({ progress }) => {
  const currentIndex = WIDGET_STEPS.findIndex((step) => step.stage === progress?.stage)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, mt: 0.75 }}>
      {WIDGET_STEPS.map((step, index) => {
        const active = index === currentIndex
        const skipped = step.stage === 'fixing' && currentIndex > index && !progress?.round
        const done = currentIndex > index && !skipped
        let label = step.label
        if (step.stage === 'writing' && active && progress?.chars) label = `编写组件 · ${progress.chars} 字`
        if (step.stage === 'fixing' && progress?.round) label = `自动修复 · 第 ${progress.round} 轮${active && progress?.chars ? ` · ${progress.chars} 字` : ''}`
        return (
          <Box key={step.stage} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: active ? 'text.primary' : 'text.secondary', opacity: skipped || (!active && !done) ? 0.5 : 1 }}>
            <Box sx={{ width: 14, height: 14, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              {active
                ? <CircularProgress size={11} thickness={5} />
                : done
                  ? <DoneIcon sx={{ fontSize: 14, color: 'success.main' }} />
                  : <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'currentColor', opacity: 0.6 }} />}
            </Box>
            <Typography sx={{ fontSize: 12, fontWeight: active ? 600 : 400 }}>{skipped ? `${label}（不需要）` : label}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// AI 给出的设计方向：用户点选一个再生成。只在新建组件、需求开放时出现。
const designOptionsOf = (action) => (action.name === 'create_widget' && Array.isArray(action.args?.design_options)
  ? action.args.design_options.filter((option) => option && typeof option.title === 'string').slice(0, 3)
  : [])

const WidgetDesignCard = ({ action, executing, onExecute, onDismiss, onRevise, compact }) => {
  const theme = useTheme()
  const status = getStatus(action, executing)
  const failed = status === 'failed'
  const options = designOptionsOf(action)
  const [chosen, setChosen] = useState(() => (Number.isInteger(action.resultData?.designOption) ? action.resultData.designOption : 0))
  const primary = theme.palette.primary.main
  return (
    <Box sx={surfaceSx(theme, compact, failed ? 'error' : null)}>
      <CardHeader action={action} compact={compact} label="选一个设计方向" right={failed ? <ErrorBadge>没有成功，可以换个方向</ErrorBadge> : null} />
      <CardBody compact={compact}>
        <Summary compact={compact}>{getDetail(action)}</Summary>
        {failed && action.error && <Note color="error.main">{action.error}</Note>}
        <Box role="radiogroup" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.75 }}>
          {options.map((option, index) => {
            const selected = chosen === index
            return (
              <Box
                key={`${index}-${option.title}`}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => setChosen(index)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setChosen(index) } }}
                sx={{
                  display: 'flex', gap: 0.9, alignItems: 'flex-start',
                  px: 0.9, py: 0.75, borderRadius: '8px', cursor: 'pointer', userSelect: 'none',
                  border: '1px solid',
                  borderColor: selected ? primary : 'divider',
                  bgcolor: selected ? alpha(primary, theme.palette.mode === 'dark' ? 0.1 : 0.04) : 'transparent',
                  transition: 'border-color 120ms, background-color 120ms',
                  '&:hover': selected ? {} : { borderColor: alpha(theme.palette.text.primary, 0.25) },
                  '&:focus-visible': { outline: `2px solid ${primary}`, outlineOffset: 1 },
                }}
              >
                {/* 与全应用一致的主题单选框；整行可点，单选框只负责显示 */}
                <Radio
                  checked={selected}
                  tabIndex={-1}
                  inputProps={{ 'aria-hidden': true }}
                  sx={{ p: 0, mt: '1px', flexShrink: 0, pointerEvents: 'none' }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: compact ? 12.5 : 13, fontWeight: 600 }}>{option.title}</Typography>
                  {option.summary && <Note sx={{ mt: 0.15 }}>{option.summary}</Note>}
                </Box>
              </Box>
            )
          })}
        </Box>
      </CardBody>
      <CardFooter compact={compact}>
        {!failed && onDismiss && <GhostButton compact={compact} onClick={() => onDismiss(action)}>忽略</GhostButton>}
        {onRevise && <GhostButton compact={compact} onClick={() => onRevise(action)}>修改</GhostButton>}
        <PrimaryButton compact={compact} onClick={() => onExecute?.(action, { design_option: chosen })}>
          {failed ? '按这个方向重试' : '按这个方向生成'}
        </PrimaryButton>
      </CardFooter>
    </Box>
  )
}

const WidgetActionCard = (props) => {
  const { action, executing, compact } = props
  const theme = useTheme()
  const status = getStatus(action, executing)
  const progress = useWidgetActionProgress((state) => state.byAction[action.actionId])
  const phase = useSyncExternalStore(subscribeGenerationTasks, () => getGenerationTaskPhase(action.actionId))
  const selectedNote = useStore((state) => state.notes.find((note) => note.id === state.selectedNoteId))
  const [undone, setUndone] = useState(false)
  const [showDraft, setShowDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  if ((status === 'pending' || status === 'failed') && designOptionsOf(action).length >= 2) return <WidgetDesignCard {...props} />
  if (status !== 'running' && status !== 'done') return <>
    <SimpleActionCard {...props} />
    {status === 'failed' && action.resultData?.draftId && <Box sx={{ mt: 0.5 }}>
      <GhostButton compact={compact} onClick={() => setShowDraft(value => !value)}>{showDraft ? '收起未发布的预览' : '看看未发布的预览'}</GhostButton>
      {showDraft && <WidgetHost instanceId={action.resultData.draftId} size="medium" surface="probe" maxHeight={420} />}
    </Box>}
  </>

  const data = action.resultData || {}
  const isUpdate = action.name === 'update_widget'

  if (status === 'running') {
    return (
      <Box aria-live="polite" sx={surfaceSx(theme, compact)}>
        <CardHeader action={action} compact={compact} label={isUpdate ? '正在修改组件' : '正在生成组件'} />
        <CardBody compact={compact} sx={{ pb: phase ? 0 : (compact ? 1 : 1.1) }}>
          <Summary compact={compact}>{getDetail(action)}</Summary>
          <WidgetProgressSteps progress={progress} />
        </CardBody>
        {phase && (
          <CardFooter compact={compact}>
            <StopButton actionId={action.actionId} phase={phase} compact={compact} />
          </CardFooter>
        )}
      </Box>
    )
  }

  const undo = async () => {
    setBusy(true)
    const result = isUpdate
      ? await window.electronAPI.widgets.rollback(data.widgetId, data.previousVersion)
      : await window.electronAPI.widgets.delete(data.widgetId)
    setBusy(false)
    if (!result?.success) return notifyError(result?.error || '撤销失败')
    setUndone(true)
    notifySuccess(isUpdate ? '已恢复到修改前的版本' : '已撤销，组件移到了“最近删除”')
  }

  const insertIntoNote = async () => {
    try {
      const instance = await window.electronAPI.widgets.getInstance(data.instanceId)
      if (!instance?.success) throw new Error(instance?.error || '实例不存在')
      await insertInstanceIntoNote(selectedNote, data.widgetName, instance.data.instance)
    } catch (error) {
      notifyError(error.message)
    }
  }

  const canInsert = !isUpdate && selectedNote && (selectedNote.note_type || 'markdown') === 'markdown'

  if (undone) {
    return <InactiveRowText text={`已撤销 · ${action.resultMessage || getDetail(action)}`} />
  }

  return (
    <Box sx={surfaceSx(theme, compact)}>
      <CardHeader action={action} compact={compact} right={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35, color: 'success.main', flexShrink: 0 }}>
          <DoneIcon sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: 11.5, fontWeight: 600 }}>完成</Typography>
        </Box>
      } />
      <CardBody compact={compact}>
        <Summary compact={compact}>{action.resultMessage || getDetail(action)}</Summary>
        {data.remainingProblems?.length > 0 && (
          <Note color="error.main">还有问题：{data.remainingProblems[0]}</Note>
        )}
        {data.instanceId && (
          <Box sx={{ mt: 0.75, borderRadius: '8px', border: '1px solid', borderColor: 'divider', overflow: 'hidden', bgcolor: 'background.paper' }}>
            <WidgetHost instanceId={data.instanceId} size="medium" surface="preview" maxHeight={compact ? 220 : 320} minHeight={48} showErrors={false} />
          </Box>
        )}
      </CardBody>
      <CardFooter compact={compact} left={
        <GhostButton compact={compact} disabled={busy} onClick={undo}>撤销</GhostButton>
      }>
        {data.remainingProblems?.length > 0 && (
          <GhostButton compact={compact}
            onClick={() => askAI(`组件「${data.widgetName}」（组件 ID：${data.widgetId}，实例 ID：${data.instanceId}）还有问题，请继续修复：${data.remainingProblems.join('；')}`, { autoSend: true })}>
            继续修复
          </GhostButton>
        )}
        {canInsert && <GhostButton compact={compact} onClick={insertIntoNote}>插入当前笔记</GhostButton>}
        {data.instanceId && <PrimaryButton compact={compact} onClick={() => openWidgetInstance(data.instanceId)}>打开</PrimaryButton>}
      </CardFooter>
    </Box>
  )
}

const InactiveRowText = ({ text }) => (
  <Box sx={(theme) => ({ ...rowSx(theme), borderStyle: 'dashed', color: 'text.disabled' })}>
    <Typography noWrap title={text} sx={{ flex: 1, minWidth: 0, fontSize: 12 }}>{text}</Typography>
  </Box>
)

/**
 * 统一入口：按动作类型选择卡片样式。
 * @param {object} props
 * @param {object} props.action      待确认动作
 * @param {boolean} props.executing  是否正在执行
 * @param {Function} props.onExecute (action, overrides?) => void，确认 / 重试
 * @param {Function} [props.onDismiss] (action) => void，忽略
 * @param {Function} [props.onRestore] (action) => void，恢复误触忽略的卡片
 * @param {Function} [props.onRevise] (action) => void，「修改」：把焦点交给输入框，让用户说要改哪里
 * @param {boolean} [props.compact]  小窗使用的紧凑尺寸
 */
const PendingActionCard = (props) => {
  const { action } = props
  if (WIDGET_ACTIONS.has(action.name)) return <WidgetActionCard {...props} />
  if (action.name === 'create_todos') {
    return (
      <BatchActionCard
        {...props}
        itemsKey="todos"
        makeKey={(t, i) => `${i}-${t.content || ''}`}
        title={(n) => `新建 ${n} 条待办`}
        intro={action.args?.intro || ''}
        submitLabel={(n) => `添加 ${n} 条`}
        renderItem={renderTodoItem}
      />
    )
  }
  if (action.name === 'edit_notes') {
    return (
      <BatchActionCard
        {...props}
        itemsKey="edits"
        makeKey={(e, i) => `${i}-${e.id}`}
        title={(n) => `整理 ${n} 篇笔记`}
        submitLabel={(n) => `应用 ${n} 处`}
        renderItem={renderNoteEditItem}
      />
    )
  }
  return <SimpleActionCard {...props} />
}

export default PendingActionCard
