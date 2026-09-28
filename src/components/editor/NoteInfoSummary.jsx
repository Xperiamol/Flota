import { useState } from 'react'
import { Box, Button, ButtonBase, Tooltip, Typography } from '@mui/material'
import { zhCN } from 'date-fns/locale/zh-CN'
import { Close as CloseIcon, EditRounded, LaunchRounded, AddRounded } from '../common/AppIcons'
import PanelIconButton from '../common/PanelIconButton'
import DateTimePicker from '../common/DateTimePicker'
import { useStore } from '../../store/useStore'
import { notifyError, notifySuccess } from '../../utils/notify'
import { formatRelativeNoteTime, parseNoteDate } from '../../utils/noteDateUtils'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad = (n) => String(n).padStart(2, '0')
const fullDate = (date) => (date
  ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  : '未知')

const clipSource = (note) => {
  try {
    const meta = typeof note?.meta === 'string' ? JSON.parse(note.meta) : note?.meta
    const source = meta?.source
    if (source?.type !== 'clip' || !source.url) return null
    let site = source.site
    if (!site) { try { site = new URL(source.url).hostname.replace(/^www\./, '') } catch { site = source.url } }
    return { url: source.url, site }
  } catch {
    return null
  }
}

function InfoRow({ label, children, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 32, px: 1.25 }}>
      <Typography sx={{ width: 36, flexShrink: 0, fontSize: 12.5, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>{children}</Box>
      {action}
    </Box>
  )
}

/**
 * 笔记详情顶部：类型 · 字数 · 阅读时长，创建时间（可修改，与日历拖动改的是同一个值）、
 * 修改时间、剪藏来源、标签。
 */
export default function NoteInfoSummary({ note, noteType, wordCount, tags, lastSaved, onEditTags, onClose }) {
  const [editing, setEditing] = useState(false)
  const created = parseNoteDate(note?.created_at)
  const updated = parseNoteDate(lastSaved || note?.updated_at)
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')
  const source = clipSource(note)
  const typeLabel = noteType === 'whiteboard' ? '画布' : source ? '剪藏' : '笔记'
  const minutes = Math.max(1, Math.round((wordCount || 0) / 400))

  const startEdit = () => {
    const base = created || new Date()
    setDateValue(`${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`)
    setTimeValue(`${pad(base.getHours())}:${pad(base.getMinutes())}`)
    setEditing(true)
  }

  const save = async () => {
    const next = new Date(`${dateValue}T${timeValue || '00:00'}:00`)
    if (Number.isNaN(next.getTime())) return notifyError('日期或时间不正确')
    if (next > new Date()) return notifyError('创建时间不能晚于现在')
    const result = await useStore.getState().updateNote(note.id, { created_at: next.toISOString() })
    if (!result?.success) return notifyError(result?.error || '修改失败')
    setEditing(false)
    notifySuccess(`创建时间已改为 ${fullDate(next)}`)
  }

  return (
    <Box sx={{ pt: 1, pb: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.25, pb: 0.75 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 15, fontWeight: 650 }}>{note?.title || '未命名'}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
            {typeLabel}
            {noteType !== 'whiteboard' && ` · ${wordCount} 字 · 约 ${minutes} 分钟读完`}
          </Typography>
        </Box>
        <PanelIconButton title="关闭详情" onClick={onClose}><CloseIcon /></PanelIconButton>
      </Box>

      {!editing ? (
        <InfoRow label="创建" action={(
          <PanelIconButton title="修改创建时间" size="sm" onClick={startEdit} stopDrag={false}><EditRounded /></PanelIconButton>
        )}>
          <Typography sx={{ fontSize: 13 }} noWrap>{fullDate(created)}</Typography>
        </InfoRow>
      ) : (
        <Box sx={{ px: 1.25, pt: 0.5, pb: 1 }}>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 0.75 }}>修改创建时间</Typography>
          <DateTimePicker dense clearable={false} dateValue={dateValue} timeValue={timeValue}
            onDateChange={setDateValue} onTimeChange={setTimeValue} />
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.5 }}>
            也可以在日历的笔记视图里，把笔记拖到另一天
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.75, mt: 0.75 }}>
            <Button size="small" color="inherit" onClick={() => setEditing(false)} sx={{ color: 'text.secondary' }}>取消</Button>
            <Button size="small" variant="contained" onClick={save} disabled={!dateValue}>保存</Button>
          </Box>
        </Box>
      )}
      <InfoRow label="修改">
        <Tooltip title={fullDate(updated)} placement="top-start" disableInteractive>
          <Typography component="span" sx={{ fontSize: 13 }}>
            {updated ? formatRelativeNoteTime(updated.toISOString(), { locale: zhCN, unknownText: '未知' }) : '未知'}
          </Typography>
        </Tooltip>
      </InfoRow>
      {source && (
        <InfoRow label="来源">
          <ButtonBase onClick={() => window.electronAPI?.system?.openExternal?.(source.url)}
            sx={{ gap: 0.5, fontSize: 13, color: 'primary.main', borderRadius: '6px', maxWidth: '100%', '&:hover': { textDecoration: 'underline' } }}>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.site}</Box>
            <LaunchRounded sx={{ fontSize: 14, flexShrink: 0 }} />
          </ButtonBase>
        </InfoRow>
      )}
      <InfoRow label="标签" action={onEditTags && (
        <PanelIconButton title="编辑标签" size="sm" onClick={onEditTags} stopDrag={false}><AddRounded /></PanelIconButton>
      )}>
        {tags.length ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.5 }}>
            {tags.slice(0, 10).map((tag) => (
              <Typography key={tag} component="span" sx={(theme) => ({
                fontSize: 12, px: 0.75, py: 0.125, borderRadius: '6px', color: 'text.secondary',
                bgcolor: theme.custom?.surface?.inset,
              })}>#{tag}</Typography>
            ))}
          </Box>
        ) : <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>没有标签</Typography>}
      </InfoRow>
    </Box>
  )
}
