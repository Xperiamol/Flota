import { memo } from 'react'
import { Box, Checkbox, IconButton, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { MoreVert as MoreVertIcon } from '../common/AppIcons'
import { FlotaPinIcon as PinIcon, FlotaWhiteboardIcon as WhiteboardIcon } from '../common/FlotaIcons'
import { rowActionRevealSx } from '../../styles/commonStyles'

export const NOTE_LIST_GUTTER = '10px'
const NOTE_ITEM_RADIUS = '12px'

/**
 * 笔记列表的一行（笔记列表与回收站共用）。memo：选中别的笔记、搜索框输入、后台刷新时，内容没变的行不重渲染
 * （行里样式多，笔记一多整列表重渲染要几百毫秒）。文案由列表算好传入，事件经 actions 转给列表。
 */
const NoteRow = memo(function NoteRow({
  note, title, preview, timeLabel, selected, isCurrent, menuOpen, multiSelectMode = false, checked = false, actions,
  // 回收站：文字整体淡一些；时间文案可换颜色（快到期时用警告色）
  muted = false, timeColor
}) {
  return (
    <ListItem
      disablePadding
      data-menu-open={menuOpen}
      sx={{
        mb: 0.5,
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        display: 'block',
        borderRadius: NOTE_ITEM_RADIUS,
        ...rowActionRevealSx,
      }}
    >
      <ListItemButton
        selected={selected}
        onClick={(e) => actions.onClick(e, note)}
        onContextMenu={(e) => actions.onContextMenu(e, note)}
        onMouseDown={actions.onMouseDown ? (e) => actions.onMouseDown(e, note) : undefined}
        sx={(theme) => ({
          position: 'relative',
          width: '100%',
          maxWidth: 'none',
          boxSizing: 'border-box',
          m: '0 !important',
          borderRadius: NOTE_ITEM_RADIUS,
          overflow: 'hidden',
          backgroundClip: 'padding-box',
          border: '1px solid',
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          transition: 'background-color 160ms ease, border-color 160ms ease',
          minHeight: 58,
          py: 0.875,
          px: 1.25,
          '& .MuiTouchRipple-root': {
            borderRadius: 'inherit'
          },
          '&:hover': {
            backgroundColor: theme.palette.action.hover,
          },
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.07),
            borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.14),
            '&:hover': {
              backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.1),
            }
          },
          ...(multiSelectMode && checked && {
            backgroundColor: 'action.selected',
            borderColor: theme.palette.primary.main,
            '&:hover': {
              backgroundColor: 'action.selected'
            }
          })
        })}
      >
        {multiSelectMode && (
          <ListItemIcon sx={{ minWidth: 30 }}>
            <Checkbox
              checked={checked}
              size="small"
              sx={{ p: 0.5 }}
            />
          </ListItemIcon>
        )}
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              {!!note.is_pinned && <PinIcon sx={{ fontSize: 13, color: 'primary.main', flexShrink: 0 }} />}
              {!!note.note_type && note.note_type === 'whiteboard' && (
                <WhiteboardIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              )}
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: note.is_pinned || isCurrent ? 600 : 500,
                  color: muted ? 'text.secondary' : undefined,
                  fontSize: '0.875rem',
                  letterSpacing: 0,
                  lineHeight: 1.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0
                }}
              >
                {title}
              </Typography>
            </Box>
          }
          secondary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, mt: 0.25 }}>
              {preview && (
                <Typography
                  component="span"
                  variant="body2"
                  color={muted ? 'text.disabled' : 'text.secondary'}
                  sx={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                    fontSize: '0.75rem',
                    lineHeight: 1.4,
                    flex: 1,
                    minWidth: 0
                  }}
                >
                  {preview}
                </Typography>
              )}
              <Typography
                component="span"
                variant="caption"
                color={timeColor || 'text.secondary'}
                sx={{
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  fontSize: '0.7rem',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.35,
                  ml: preview ? 0 : 'auto',
                }}
              >
                {timeLabel}
              </Typography>
            </Box>
          }
          sx={{ my: 0, minWidth: 0 }}
          slotProps={{
            primary: { component: 'div' },
            secondary: { component: 'div' }
          }}
        />
      </ListItemButton>
        {/* 视觉上嵌入行内，事件不冒泡到笔记选择按钮 */}
        {!multiSelectMode && (
          <IconButton
            onClick={(e) => actions.onMenuClick(e, note)}
            aria-label="更多操作"
            size="small"
            className="note-menu-button row-inline-action"
            sx={{
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 28,
              height: 28,
              zIndex: 3,
              padding: 0,
            }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
    </ListItem>
  )
})

export default NoteRow
