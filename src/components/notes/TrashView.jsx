import { useEffect, useMemo, useState } from 'react'
import { Box, Button, IconButton, InputAdornment, TextField, Typography, alpha } from '@mui/material'
import AppContextMenu from '../common/AppContextMenu'
import PanelIconButton from '../common/PanelIconButton'
import { useShallow } from 'zustand/react/shallow'
import { zhCN as dateFnsZhCN } from 'date-fns/locale/zh-CN'
import { DeleteForever, DeleteSweepRounded, RestoreFromTrashRounded, Search, Close, MoreVert } from '../common/AppIcons'
import { FlotaWhiteboardIcon as WhiteboardIcon } from '../common/FlotaIcons'
import MarkdownPreview from '../editor/MarkdownPreview'
import { useStore } from '../../store/useStore'
import { confirmAction, notifyError, notifySuccess } from '../../utils/notify'
import { formatRelativeNoteTime } from '../../utils/noteDateUtils'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import { rowActionRevealSx, thinScrollbarSx } from '../../styles/commonStyles'

const noteTitle = (note) => note?.title?.trim() || (note?.note_type === 'whiteboard' ? '未命名画布' : '未命名笔记')

const deletedLabel = (note) => {
  const when = note?.deleted_at || note?.updated_at
  return when ? `删除于${formatRelativeNoteTime(when, { locale: dateFnsZhCN })}` : '已删除'
}

// SQLite 时间（UTC，'YYYY-MM-DD HH:MM:SS'）→ 毫秒
const sqliteTime = (value) => {
  if (!value) return 0
  const text = String(value)
  const time = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`).getTime()
  return Number.isFinite(time) ? time : 0
}

/** 距离自动永久删除还有几天；不自动清理时返回 null。与后端一致：从删除时间和启用清理的时间里取较晚的起算 */
const daysLeft = (note, policy) => {
  if (!policy?.days) return null
  const start = Math.max(sqliteTime(note?.deleted_at || note?.updated_at), sqliteTime(policy.since))
  return Math.max(0, Math.ceil((start + policy.days * 86400000 - Date.now()) / 86400000))
}

const leftLabel = (left) => (left <= 0 ? '即将清除' : left === 1 ? '明天清除' : `${left} 天后清除`)

const openTrashSettings = () => {
  const state = useStore.getState()
  state.setSettingsTabValue(8)
  state.setCurrentView('settings')
}

const notePreview = (note) => (note?.note_type === 'whiteboard' ? '画布' : stripMarkdownToPreviewText(note?.content || '').slice(0, 80))

/** 恢复 / 永久删除，列表和预览共用 */
export const useTrashActions = () => {
  const { restoreNote, permanentDeleteNote, emptyTrash, batchRestoreNotes } = useStore(useShallow((state) => ({
    restoreNote: state.restoreNote,
    permanentDeleteNote: state.permanentDeleteNote,
    emptyTrash: state.emptyTrash,
    batchRestoreNotes: state.batchRestoreNotes,
  })))

  const restore = async (note) => {
    const result = await restoreNote(note.id)
    if (result?.success) notifySuccess(`已恢复「${noteTitle(note)}」`)
    else notifyError(result?.error || '恢复失败')
  }

  const destroy = async (note) => {
    const ok = await confirmAction({
      title: '永久删除',
      message: `「${noteTitle(note)}」将被彻底删除，无法恢复。`,
      confirmText: '永久删除',
      danger: true,
    })
    if (!ok) return
    const result = await permanentDeleteNote(note.id)
    if (!result?.success) notifyError(result?.error || '删除失败')
  }

  const empty = async (count) => {
    const ok = await confirmAction({
      title: '清空回收站',
      message: `回收站中的 ${count} 篇笔记将被彻底删除，无法恢复。`,
      confirmText: '清空',
      danger: true,
    })
    if (!ok) return
    const result = await emptyTrash()
    if (result?.success) notifySuccess(`已清空回收站（${result.count} 篇）`)
    else notifyError(result?.error || '清空失败')
  }

  const restoreAll = async (notes) => {
    const result = await batchRestoreNotes(notes.map((note) => note.id))
    if (result?.success) notifySuccess(`已恢复 ${notes.length} 篇笔记`)
    else notifyError(result?.error || '恢复失败')
  }

  return { restore, destroy, empty, restoreAll }
}

/** 二级侧栏里的回收站列表 */
export function TrashList() {
  const { trashNotes, trashLoaded, loadTrash, selectedId, setSelectedId, policy } = useStore(useShallow((state) => ({
    policy: state.trashPolicy,
    trashNotes: state.trashNotes,
    trashLoaded: state.trashLoaded,
    loadTrash: state.loadTrash,
    selectedId: state.selectedTrashNoteId,
    setSelectedId: state.setSelectedTrashNoteId,
  })))
  const { restore, destroy, empty, restoreAll } = useTrashActions()
  const [query, setQuery] = useState('')
  // 行菜单：与笔记列表一致，行尾「⋮」或右键打开
  const [menu, setMenu] = useState(null) // { anchor, note }

  useEffect(() => { loadTrash() }, [loadTrash])

  const keyword = query.trim().toLowerCase()
  const visible = useMemo(() => (keyword
    ? trashNotes.filter((note) => `${note.title || ''}\n${note.content || ''}`.toLowerCase().includes(keyword))
    : trashNotes), [trashNotes, keyword])

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: '10px', pt: 1.25, pb: 0.75, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, px: 0.5 }}>
          {/* 标题栏已经显示「回收站」，这里只放数量和清理规则 */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              {trashNotes.length ? `${trashNotes.length} 篇 · ` : ''}
              <Box component="button" type="button" onClick={openTrashSettings}
                sx={{ p: 0, border: 0, background: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3, '&:hover': { color: 'primary.main' } }}>
                {policy?.days ? `删除 ${policy.days} 天后自动清除` : '不自动清除'}
              </Box>
            </Typography>
          </Box>
          {trashNotes.length > 0 && (
            <>
              <PanelIconButton title="全部恢复" onClick={() => restoreAll(trashNotes)} stopDrag={false}>
                <RestoreFromTrashRounded />
              </PanelIconButton>
              <PanelIconButton title="清空回收站" tone="danger" onClick={() => empty(trashNotes.length)} stopDrag={false}>
                <DeleteSweepRounded />
              </PanelIconButton>
            </>
          )}
        </Box>
        {trashNotes.length > 0 && (
          <TextField
            fullWidth
            size="small"
            value={query}
            placeholder="搜索回收站"
            onChange={(event) => setQuery(event.target.value)}
            // 与笔记列表的搜索框同尺寸同样式
            sx={{
              '& .MuiOutlinedInput-root': { height: 36, borderRadius: '10px', fontSize: '0.8125rem', paddingLeft: '8px', paddingRight: '4px' },
              '& .MuiOutlinedInput-input': { padding: '6px 4px' },
              '& .MuiInputAdornment-root': { marginRight: '4px' },
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><Search color="action" /></InputAdornment>,
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label="清除搜索" onClick={() => setQuery('')}><Close /></IconButton>
                  </InputAdornment>
                ) : null,
              },
              htmlInput: { 'aria-label': '搜索回收站' },
            }}
          />
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, px: '10px', pb: 1, ...thinScrollbarSx }}>
        {trashLoaded && trashNotes.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
            <DeleteSweepRounded sx={{ fontSize: 40, opacity: 0.35 }} />
            <Typography sx={{ fontSize: 14, mt: 1 }}>回收站是空的</Typography>
          </Box>
        )}
        {trashNotes.length > 0 && visible.length === 0 && (
          <Typography sx={{ py: 4, textAlign: 'center', fontSize: 13, color: 'text.secondary' }}>没有匹配的笔记</Typography>
        )}
        {visible.map((note) => {
          const selected = note.id === selectedId
          const left = daysLeft(note, policy)
          return (
            <Box
              key={note.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(note.id)}
              onKeyDown={(event) => { if (event.key === 'Enter') setSelectedId(note.id) }}
              onContextMenu={(event) => { event.preventDefault(); setMenu({ anchor: { x: event.clientX, y: event.clientY }, note }) }}
              data-menu-open={menu?.note?.id === note.id}
              sx={(theme) => ({
                ...rowActionRevealSx,
                position: 'relative',
                px: 1.25,
                py: 0.875,
                borderRadius: '10px',
                border: '1px solid transparent',
                cursor: 'pointer',
                outline: 'none',
                transition: 'background-color 160ms ease, border-color 160ms ease',
                '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
                ...(selected ? {
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.07),
                  borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.14),
                } : {}),
              })}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, pr: 3 }}>
                {note.note_type === 'whiteboard' && <WhiteboardIcon sx={{ fontSize: 14, color: 'text.secondary' }} />}
                <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: selected ? 600 : 500, color: 'text.secondary' }}>
                  {noteTitle(note)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, color: 'text.disabled' }}>{notePreview(note)}</Typography>
                <Typography sx={{ flexShrink: 0, fontSize: 11.5, color: left != null && left <= 3 ? 'warning.main' : 'text.secondary' }}>
                  {left == null ? deletedLabel(note) : leftLabel(left)}
                </Typography>
              </Box>
              {/* 行尾「⋮」：与笔记列表同一种悬停浮现的行内按钮 */}
              <IconButton
                aria-label="更多操作"
                size="small"
                className="row-inline-action"
                onClick={(event) => { event.stopPropagation(); setMenu({ anchor: { el: event.currentTarget }, note }) }}
                sx={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, zIndex: 3, padding: 0 }}
              >
                <MoreVert fontSize="small" />
              </IconButton>
            </Box>
          )
        })}
      </Box>
      <AppContextMenu anchor={menu?.anchor || null} onClose={() => setMenu(null)} items={menu ? [
        { label: '恢复', icon: <RestoreFromTrashRounded fontSize="small" />, onClick: () => restore(menu.note) },
        { divider: true },
        { label: '永久删除', icon: <DeleteForever fontSize="small" />, danger: true, onClick: () => destroy(menu.note) },
      ] : []} />
    </Box>
  )
}

/** 主内容区：回收站里的笔记只读预览（回收站中的笔记不能编辑，以前在这里编辑的内容会静默丢失） */
export function TrashNotePreview() {
  const note = useStore((state) => state.trashNotes.find((item) => item.id === state.selectedTrashNoteId) || null)
  const policy = useStore((state) => state.trashPolicy)
  const { restore, destroy } = useTrashActions()

  if (!note) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', gap: 1 }}>
        <DeleteSweepRounded sx={{ fontSize: 44, opacity: 0.3 }} />
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.primary' }}>回收站</Typography>
        <Typography sx={{ fontSize: 13 }}>选择一篇笔记查看内容，可以恢复或永久删除</Typography>
      </Box>
    )
  }

  const tags = Array.isArray(note.tags) ? note.tags : []
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={(theme) => ({
        display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.25, flexShrink: 0,
        borderBottom: `1px solid ${theme.palette.divider}`,
        bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.1 : 0.07),
      })}>
        <DeleteSweepRounded sx={{ fontSize: 20, color: 'warning.main' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>这篇笔记在回收站中</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {deletedLabel(note)}{daysLeft(note, policy) != null ? ` · ${leftLabel(daysLeft(note, policy)).replace('清除', '自动永久删除')}` : ''} · 恢复后才能编辑
          </Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<RestoreFromTrashRounded />} onClick={() => restore(note)}
          sx={{ borderRadius: '8px', flexShrink: 0 }}>
          恢复
        </Button>
        <Button size="small" color="error" startIcon={<DeleteForever />} onClick={() => destroy(note)}
          sx={{ borderRadius: '8px', flexShrink: 0 }}>
          永久删除
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 2.5, md: 5 }, py: 3, ...thinScrollbarSx }}>
        <Box sx={{ maxWidth: 820, mx: 'auto', opacity: 0.92 }}>
          <Typography component="h1" sx={{ fontSize: 26, fontWeight: 650, mb: tags.length ? 1 : 2 }}>{noteTitle(note)}</Typography>
          {tags.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              {tags.map((tag) => <Typography key={tag} sx={{ fontSize: 12.5, color: 'text.secondary' }}>#{tag}</Typography>)}
            </Box>
          )}
          {note.note_type === 'whiteboard' ? (
            <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>这是一张画布，恢复后可以查看和编辑。</Typography>
          ) : (
            <MarkdownPreview content={note.content || '（空笔记）'} showAudioTranscription={false} sx={{ backgroundColor: 'transparent', p: 0 }} />
          )}
        </Box>
      </Box>
    </Box>
  )
}
