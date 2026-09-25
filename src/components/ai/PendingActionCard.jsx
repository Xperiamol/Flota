import { useState } from 'react'
import { Box, Button, Chip, CircularProgress, Paper, Typography, alpha, useTheme } from '@mui/material'
import { useStore } from '../../store/useStore'
import WidgetHost from '../widgets/WidgetHost'
import { openWidgetInstance } from '../../store/useWidgetStore'
import { useWidgetActionProgress } from '../../utils/widgets/widgetActionProgress'
import { insertInstanceIntoNote } from '../../utils/widgets/widgetActions'
import { askAI } from '../../utils/widgets/askAI'
import { notifyError, notifySuccess } from '../../utils/notify'

// AI 待确认动作卡（AI 功能页与「问 AI」小窗共用）。
//
// 用户视角的状态流：
//   pending   —— 待你确认：可「确认」或「忽略」；批量卡可勾选后提交
//   running   —— 执行中
//   done      —— 已完成：单篇笔记 / 画布可「查看」，待办可「去待办」
//   failed    —— 执行失败：显示原因，可「重试」
//   dismissed —— 已忽略（折叠成一行）
//   superseded—— AI 给出了新方案，旧卡自动失效（折叠成一行）

export const ACTION_LABELS = {
  create_note: '创建笔记',
  edit_note: '编辑笔记',
  edit_notes: '批量编辑笔记',
  create_whiteboard: '创建画布',
  update_whiteboard: '修改画布',
  create_todo: '创建待办',
  create_todos: '批量创建待办',
  add_memory: '保存记忆',
  update_memory: '更新记忆',
  write_long_document: '生成并保存长文档',
  create_widget: '生成组件',
  update_widget: '修改组件',
  create_widget_instance: '新建组件实例',
  add_widget_records: '写入组件数据'
}

const TODO_ACTIONS = new Set(['create_todo', 'create_todos'])

const STATUS_META = {
  pending: { palette: 'warning', title: '待你确认' },
  running: { palette: 'warning', title: '执行中' },
  done: { palette: 'success', title: '已完成' },
  failed: { palette: 'error', title: '执行失败' },
  dismissed: { palette: null, title: '已忽略' },
  superseded: { palette: null, title: '已被新方案替代' }
}

const getStatus = (action, executing) => {
  if (executing) return 'running'
  return STATUS_META[action.status] ? action.status : 'pending'
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

const cardSx = (theme, paletteKey, compact) => ({
  mt: 0.75,
  px: compact ? 1.1 : 1.25,
  py: compact ? 0.85 : 1,
  maxWidth: compact ? undefined : 480,
  borderRadius: compact ? '12px' : '14px',
  border: '1px solid',
  borderColor: alpha(theme.palette[paletteKey].main, theme.palette.mode === 'dark' ? 0.28 : 0.26),
  bgcolor: theme.palette.mode === 'dark'
    ? alpha(theme.palette[paletteKey].dark, 0.12)
    : alpha(theme.palette[paletteKey].light, 0.15),
  ...(compact ? {} : {
    boxShadow: `0 10px 28px ${alpha(theme.palette[paletteKey].main, 0.08)}`,
    backdropFilter: 'blur(10px)'
  })
})

const pillSx = (compact) => ({
  flexShrink: 0,
  minWidth: 0,
  height: compact ? 26 : 30,
  px: compact ? 1.25 : 1.5,
  borderRadius: '999px',
  textTransform: 'none',
  fontWeight: 700,
  whiteSpace: 'nowrap'
})

// ─── 已忽略 / 已替代：收成一行，不再抢注意力 ───
const InactiveActionRow = ({ action, status }) => (
  <Box
    sx={(theme) => ({
      mt: 0.75,
      px: 1,
      py: 0.5,
      borderRadius: '10px',
      display: 'flex',
      alignItems: 'center',
      gap: 0.75,
      color: 'text.disabled',
      bgcolor: alpha(theme.palette.text.primary, 0.035)
    })}
  >
    <Typography variant="caption" sx={{ fontWeight: 700, flexShrink: 0 }}>
      {STATUS_META[status].title}
    </Typography>
    <Typography variant="caption" noWrap sx={{ minWidth: 0, textDecoration: 'line-through' }}>
      {getDetail(action)}
    </Typography>
  </Box>
)

// ─── 卡片底部的操作按钮（按状态给出下一步） ───
const ActionButtons = ({ action, status, compact, confirmLabel = '确认', confirmDisabled, onConfirm, onDismiss }) => {
  const setSelectedNoteId = useStore((state) => state.setSelectedNoteId)
  const setCurrentView = useStore((state) => state.setCurrentView)

  if (status === 'done') {
    const canOpenNote = action.resultNoteId != null
    const canOpenTodos = TODO_ACTIONS.has(action.name)
    if (!canOpenNote && !canOpenTodos) return null
    return (
      <Button
        size="small"
        variant="text"
        color="success"
        onClick={() => {
          if (canOpenNote) {
            setSelectedNoteId?.(action.resultNoteId)
            setCurrentView?.('notes')
          } else {
            setCurrentView?.('todo')
          }
        }}
        sx={pillSx(compact)}
      >
        {canOpenNote ? '查看' : '去待办'}
      </Button>
    )
  }

  if (status === 'failed') {
    return (
      <Button size="small" variant="outlined" color="error" onClick={onConfirm} sx={pillSx(compact)}>
        重试
      </Button>
    )
  }

  const running = status === 'running'
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
      {!running && onDismiss && (
        <Button
          size="small"
          variant="text"
          color="inherit"
          onClick={onDismiss}
          sx={{ ...pillSx(compact), color: 'text.secondary' }}
        >
          忽略
        </Button>
      )}
      <Button
        size="small"
        variant="contained"
        color="warning"
        onClick={onConfirm}
        disabled={running || confirmDisabled}
        sx={pillSx(compact)}
      >
        {running ? '执行中…' : confirmLabel}
      </Button>
    </Box>
  )
}

// ─── 单个动作卡 ───
const SimpleActionCard = ({ action, executing, onExecute, onDismiss, compact }) => {
  const theme = useTheme()
  const status = getStatus(action, executing)
  if (!STATUS_META[status].palette) return <InactiveActionRow action={action} status={status} />

  const paletteKey = STATUS_META[status].palette
  const isFinished = status === 'done' || status === 'failed'
  const detail = status === 'done' ? (action.resultMessage || getDetail(action)) : getDetail(action)

  return (
    <Paper elevation={0} sx={cardSx(theme, paletteKey, compact)}>
      <Typography variant="caption" sx={{ display: 'block', color: `${paletteKey}.main`, fontWeight: 800, mb: 0.25 }}>
        {STATUS_META[status].title}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.45, fontSize: compact ? 12.5 : undefined, wordBreak: 'break-word' }}>
        {detail}
      </Typography>
      {status === 'failed' && action.error && (
        <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.25, wordBreak: 'break-word' }}>
          {action.error}
        </Typography>
      )}
      {!isFinished && action.name === 'update_widget' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          修改会作用于这个组件的所有实例，数据保留；完成后可以撤销。
        </Typography>
      )}
      {!isFinished && action.name === 'create_widget' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          生成后会先在预览中运行检查，有问题自动修复，完成后固定到侧边栏。
        </Typography>
      )}
      {!isFinished && action.name === 'create_todo' && Array.isArray(action.args?.subtasks) && action.args.subtasks.length > 0 && (
        <Box sx={{ mt: 0.4 }}>
          {action.args.subtasks.map((subtask, index) => (
            <Typography key={`${subtask.content}-${index}`} variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: compact ? 11 : undefined }}>
              • {subtask.content}
            </Typography>
          ))}
        </Box>
      )}
      {!isFinished && action.memoryReview?.summary && (
        <Box sx={{ mt: 0.75, pt: 0.75, borderTop: `1px solid ${alpha(theme.palette.warning.main, 0.16)}` }}>
          <Typography variant="caption" color={action.memoryReview.level === 'warning' ? 'warning.main' : 'text.secondary'} sx={{ display: 'block' }}>
            {action.memoryReview.summary}
          </Typography>
          {action.memoryReview.candidates?.slice(0, 2).map((candidate) => (
            <Typography key={candidate.id || candidate.content} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1, mt: 0.25 }}>
              相似记忆：{candidate.content}
            </Typography>
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.75 }}>
        <ActionButtons
          action={action}
          status={status}
          compact={compact}
          onConfirm={() => onExecute?.(action)}
          onDismiss={onDismiss ? () => onDismiss(action) : undefined}
        />
      </Box>
    </Paper>
  )
}

// ─── 批量卡：勾选后提交；整行可点，支持全选 ───
const BatchActionCard = ({
  action, executing, onExecute, onDismiss, compact,
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
    return <SimpleActionCard action={action} executing={executing} onExecute={onExecute} onDismiss={onDismiss} compact={compact} />
  }

  const running = status === 'running'
  const failed = status === 'failed'
  const paletteKey = STATUS_META[status].palette
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

  return (
    <Paper elevation={0} sx={cardSx(theme, paletteKey, compact)}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" sx={{ flex: 1, color: `${paletteKey}.main`, fontWeight: 800 }}>
          {failed ? `执行失败 · ${title(items.length)}` : title(items.length)}
        </Typography>
        {items.length > 1 && !running && (
          <Button size="small" variant="text" color="inherit" onClick={toggleAll} sx={{ minWidth: 0, height: 22, px: 0.75, fontSize: 11, textTransform: 'none', color: 'text.secondary' }}>
            {allSelected ? '全不选' : '全选'}
          </Button>
        )}
      </Box>
      {failed && action.error && (
        <Typography variant="caption" color="error.main" sx={{ display: 'block', mb: 0.5, wordBreak: 'break-word' }}>
          {action.error}
        </Typography>
      )}
      {intro && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.75, lineHeight: 1.5, fontSize: compact ? 12 : undefined }}>
          {intro}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: compact ? 220 : 280, overflowY: 'auto', pr: 0.5 }}>
        {items.map((it) => (
          <Box
            key={it._key}
            role="checkbox"
            aria-checked={it._selected}
            onClick={() => toggle(it._key)}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.75,
              px: 0.75,
              py: 0.6,
              borderRadius: '10px',
              cursor: running ? 'default' : 'pointer',
              userSelect: 'none',
              bgcolor: it._selected
                ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.1 : 0.08)
                : alpha(theme.palette.action.disabledBackground, 0.4),
              opacity: it._selected ? 1 : 0.55,
              transition: 'background-color 120ms, opacity 120ms'
            }}
          >
            <Box
              component="input"
              type="checkbox"
              checked={it._selected}
              disabled={running}
              readOnly
              tabIndex={-1}
              sx={{ mt: 0.4, pointerEvents: 'none', accentColor: theme.palette.warning.main }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>{renderItem(it, compact)}</Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.75 }}>
        <ActionButtons
          action={action}
          status={status}
          compact={compact}
          confirmLabel={submitLabel(selectedCount)}
          confirmDisabled={selectedCount === 0}
          onConfirm={submit}
          onDismiss={onDismiss ? () => onDismiss(action) : undefined}
        />
      </Box>
    </Paper>
  )
}

const chipSx = (compact) => ({ height: compact ? 16 : 18, fontSize: compact ? '0.65rem' : '0.68rem' })

const renderTodoItem = (t, compact) => (
  <>
    <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.4, fontSize: compact ? 12.5 : undefined, wordBreak: 'break-word' }}>
      {t.content}
    </Typography>
    {t.description && (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.4 }}>
        {t.description}
      </Typography>
    )}
    {Array.isArray(t.subtasks) && t.subtasks.length > 0 && (
      <Box sx={{ mt: 0.4, pl: 0.5 }}>
        {t.subtasks.map((subtask, index) => (
          <Typography key={`${subtask.content}-${index}`} variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.45 }}>
            • {subtask.content}
          </Typography>
        ))}
      </Box>
    )}
    <Box sx={{ display: 'flex', gap: 0.4, mt: 0.4, flexWrap: 'wrap' }}>
      {t.parent_id != null && <Chip size="small" label={`父待办 #${t.parent_id}`} variant="outlined" sx={chipSx(compact)} />}
      {t.due_date && <Chip size="small" label={formatTodoDue(t.due_date)} sx={chipSx(compact)} />}
      {formatRepeat(t) && <Chip size="small" label={formatRepeat(t)} color="primary" variant="outlined" sx={chipSx(compact)} />}
      {t.is_important && <Chip size="small" label="重要" color="error" sx={chipSx(compact)} />}
      {t.is_urgent && <Chip size="small" label="紧急" color="warning" sx={chipSx(compact)} />}
    </Box>
  </>
)

const renderNoteEditItem = (e, compact) => (
  <>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
      #{e.id}
    </Typography>
    {e.title !== undefined && (
      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.4, fontSize: compact ? 12.5 : undefined, wordBreak: 'break-word' }}>
        标题 → {e.title || '（清空）'}
      </Typography>
    )}
    <Box sx={{ display: 'flex', gap: 0.4, mt: 0.4, flexWrap: 'wrap', alignItems: 'center' }}>
      {e.tags !== undefined && String(e.tags).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).map((tag, i) => (
        <Chip key={`${tag}-${i}`} size="small" label={tag} sx={chipSx(compact)} />
      ))}
    </Box>
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, mt: 0.5 }}>
      {WIDGET_STEPS.map((step, index) => {
        const active = index === currentIndex
        const done = currentIndex > index && !(step.stage === 'fixing' && !progress?.round)
        const skipped = step.stage === 'fixing' && currentIndex > index && !progress?.round
        let label = step.label
        if (step.stage === 'writing' && active && progress?.chars) label = `编写组件（${progress.chars} 字）`
        if (step.stage === 'fixing' && progress?.round) label = `自动修复（第 ${progress.round} 轮）${active && progress?.chars ? ` · ${progress.chars} 字` : ''}`
        return (
          <Box key={step.stage} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: active ? 'text.primary' : 'text.secondary', opacity: skipped ? 0.45 : 1 }}>
            <Box sx={{ width: 14, display: 'grid', placeItems: 'center' }}>
              {active ? <CircularProgress size={11} /> : <Typography variant="caption">{done ? '✓' : skipped ? '–' : '·'}</Typography>}
            </Box>
            <Typography variant="caption" sx={{ fontWeight: active ? 700 : 500 }}>{label}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

const WidgetActionCard = (props) => {
  const { action, executing, compact } = props
  const theme = useTheme()
  const status = getStatus(action, executing)
  const progress = useWidgetActionProgress((state) => state.byAction[action.actionId])
  const selectedNote = useStore((state) => state.notes.find((note) => note.id === state.selectedNoteId))
  const [undone, setUndone] = useState(false)
  const [busy, setBusy] = useState(false)
  if (status !== 'running' && status !== 'done') return <SimpleActionCard {...props} />

  const paletteKey = STATUS_META[status].palette
  const data = action.resultData || {}
  const isUpdate = action.name === 'update_widget'

  if (status === 'running') {
    return (
      <Paper elevation={0} sx={cardSx(theme, paletteKey, compact)}>
        <Typography variant="caption" sx={{ display: 'block', color: `${paletteKey}.main`, fontWeight: 800, mb: 0.25 }}>
          {isUpdate ? '正在修改组件' : '正在生成组件'}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.45, fontSize: compact ? 12.5 : undefined, wordBreak: 'break-word' }}>
          {getDetail(action)}
        </Typography>
        <WidgetProgressSteps progress={progress} />
      </Paper>
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

  return (
    <Paper elevation={0} sx={cardSx(theme, undone ? 'warning' : paletteKey, compact)}>
      <Typography variant="caption" sx={{ display: 'block', color: undone ? 'text.secondary' : `${paletteKey}.main`, fontWeight: 800, mb: 0.25 }}>
        {undone ? '已撤销' : STATUS_META.done.title}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.45, fontSize: compact ? 12.5 : undefined, wordBreak: 'break-word' }}>
        {action.resultMessage || getDetail(action)}
      </Typography>
      {!undone && data.remainingProblems?.length > 0 && (
        <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>仍有问题：{data.remainingProblems[0]}</Typography>
      )}
      {!undone && data.instanceId && (
        <Box sx={{ mt: 0.75, borderRadius: '10px', border: '1px solid', borderColor: 'divider', overflow: 'hidden', bgcolor: 'background.paper' }}>
          <WidgetHost instanceId={data.instanceId} size="medium" surface="preview" maxHeight={compact ? 220 : 320} minHeight={48} showErrors={false} />
        </Box>
      )}
      {!undone && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
          {data.remainingProblems?.length > 0 && (
            <Button size="small" variant="text" color="inherit" sx={pillSx(compact)}
              onClick={() => askAI(`组件「${data.widgetName}」（组件 ID：${data.widgetId}，实例 ID：${data.instanceId}）还有问题，请继续修复：${data.remainingProblems.join('；')}`, { autoSend: true })}>
              继续修复
            </Button>
          )}
          <Button size="small" variant="text" color="inherit" disabled={busy} onClick={undo} sx={{ ...pillSx(compact), color: 'text.secondary' }}>撤销</Button>
          {canInsert && <Button size="small" variant="outlined" onClick={insertIntoNote} sx={pillSx(compact)}>插入到当前笔记</Button>}
          {data.instanceId && <Button size="small" variant="contained" color="success" onClick={() => openWidgetInstance(data.instanceId)} sx={pillSx(compact)}>打开</Button>}
        </Box>
      )}
    </Paper>
  )
}

/**
 * 统一入口：按动作类型选择卡片样式。
 * @param {object} props
 * @param {object} props.action      待确认动作
 * @param {boolean} props.executing  是否正在执行
 * @param {Function} props.onExecute (action, overrides?) => void，确认 / 重试
 * @param {Function} [props.onDismiss] (action) => void，忽略
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
        title={(n) => `AI 为你规划了 ${n} 条待办`}
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
        title={(n) => `AI 想批量整理 ${n} 条笔记`}
        submitLabel={(n) => `应用 ${n} 条`}
        renderItem={renderNoteEditItem}
      />
    )
  }
  return <SimpleActionCard {...props} />
}

export default PendingActionCard
