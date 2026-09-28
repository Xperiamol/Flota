import { useMemo } from 'react'
import { Box, ButtonBase, Chip, Typography } from '@mui/material'
import { format, isToday } from 'date-fns'
import { zhCN } from 'date-fns/locale/zh-CN'
import { EditNoteOutlined, NotesRounded } from '../common/AppIcons'
import { FlotaWhiteboardIcon as WhiteboardIcon } from '../common/FlotaIcons'
import { useStore } from '../../store/useStore'
import { compactGlassPanelSx, thinScrollbarSx } from '../../styles/commonStyles'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import { buildNoteDayIndex, dayKey, formatClock, noteCreatedDate, useNoteActivity } from '../../utils/noteCalendar'

const noteTitle = (note) => note.title?.trim() || (note.note_type === 'whiteboard' ? '未命名画布' : stripMarkdownToPreviewText(note.content || '').slice(0, 24) || '未命名笔记')

/** 日历「笔记视图」的左侧栏：选中那天写的笔记（带时刻）和改过的笔记；点击打开笔记 */
export default function CalendarNotesPanel({ selectedDate }) {
  const notes = useStore((state) => state.notes)
  const activity = useNoteActivity((state) => state.byDay)
  const targetDate = selectedDate || new Date()
  const day = useMemo(() => buildNoteDayIndex(notes, activity)[dayKey(targetDate)] || { created: [], edited: [] },
    [notes, activity, targetDate])

  const open = (note) => {
    const state = useStore.getState()
    state.setCurrentView('notes')
    state.setSelectedNoteId(note.id)
  }

  const renderRow = (note, kind) => {
    const created = noteCreatedDate(note)
    return (
      <ButtonBase key={`${kind}-${note.id}`} onClick={() => open(note)}
        sx={{
          width: '100%', justifyContent: 'flex-start', alignItems: 'flex-start', gap: 1, px: 1, py: 0.75,
          borderRadius: '10px', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' },
        }}>
        <Typography sx={{ width: 38, flexShrink: 0, pt: '1px', fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {kind === 'created' ? formatClock(created) : <EditNoteOutlined sx={{ fontSize: 15, color: 'text.disabled' }} />}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {note.note_type === 'whiteboard' && <WhiteboardIcon sx={{ fontSize: 14, color: 'text.secondary' }} />}
            <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 500 }}>{noteTitle(note)}</Typography>
          </Box>
          <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', mt: 0.125 }}>
            {kind === 'edited' && created
              ? `写于 ${created.getMonth() + 1}月${created.getDate()}日`
              : note.note_type === 'whiteboard' ? '画布' : stripMarkdownToPreviewText(note.content || '').slice(0, 60) || '空白笔记'}
          </Typography>
        </Box>
      </ButtonBase>
    )
  }

  const sectionLabel = (text, count) => (
    <Typography sx={{ px: 1, pt: 1.25, pb: 0.25, fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>
      {text}{count ? ` · ${count}` : ''}
    </Typography>
  )

  const empty = !day.created.length && !day.edited.length
  return (
    <Box sx={(theme) => ({ ...compactGlassPanelSx(theme), p: 0 })}>
      {/* 头部：与待办视图的「我的一天」同一种样式 */}
      <Box sx={{ px: 1.25, pt: 1, pb: 0.875, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 15, fontWeight: 750, lineHeight: 1.3, mb: 0.75 }}>
          {format(targetDate, 'MM月dd日', { locale: zhCN })}{isToday(targetDate) ? ' - 今天' : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.625, flexWrap: 'wrap' }}>
          <Chip icon={<NotesRounded />} label={`写了 ${day.created.length}`} size="small" color="primary" variant="outlined"
            sx={{ height: 24, borderRadius: '8px', fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 15 } }} />
          <Chip icon={<EditNoteOutlined />} label={`改过 ${day.edited.length}`} size="small" variant="outlined"
            sx={{ height: 24, borderRadius: '8px', fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 15 } }} />
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, px: 0.75, pb: 1, ...thinScrollbarSx }}>
        {empty && (
          <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
            <NotesRounded sx={{ fontSize: 40, opacity: 0.3 }} />
            <Typography sx={{ fontSize: 14, mt: 1 }}>这天没有写笔记</Typography>
            <Typography sx={{ fontSize: 12.5, mt: 0.5, color: 'text.disabled' }}>把日历里的笔记拖到这一天，可以修改它的创建日期</Typography>
          </Box>
        )}
        {day.created.length > 0 && sectionLabel('这天写的', day.created.length)}
        {day.created.map((note) => renderRow(note, 'created'))}
        {day.edited.length > 0 && sectionLabel('这天改过的', day.edited.length)}
        {day.edited.map((note) => renderRow(note, 'edited'))}
      </Box>
    </Box>
  )
}
