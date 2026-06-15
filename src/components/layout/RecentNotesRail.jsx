import { useMemo, useState } from 'react'
import { Box, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText, Typography, ButtonBase } from '@mui/material'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import CloseIcon from '@mui/icons-material/Close'
import { useTheme } from '@mui/material/styles'
import { useStore } from '../../store/useStore'
import { useRecentNotes } from '../../store/useRecentNotes'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import { EASING, DURATION_MS } from '../../utils/animationConfig'

const NAV_EASING = EASING.standard
const NAV_DURATION = DURATION_MS.normal
const NAV_DURATION_FAST = DURATION_MS.fast

// 派生显示标题：保持与 NoteList 一致
// 1) 真实标题（非空、非 "无标题"/"Untitled"）→ 直接用
// 2) 白板 → "画布笔记"
// 3) 普通笔记内容 → 取 stripMarkdown 后前 9 个字
// 4) 全空 → "无标题"
const deriveDisplayTitle = (note) => {
  if (!note) return '无标题'
  const t = note.title
  if (t && t !== '无标题' && t !== 'Untitled') return t
  if (note.note_type === 'whiteboard') return '画布笔记'
  if (note.content) {
    try {
      const clean = stripMarkdownToPreviewText(note.content) || ''
      const trimmed = clean.trim()
      if (trimmed) {
        const arr = Array.from(trimmed)
        return arr.slice(0, 9).join('') + (arr.length > 9 ? '...' : '')
      }
    } catch {}
  }
  return '无标题'
}

// 取笔记标题首字符（支持中英文，emoji 可能占位但不解析）
const firstChar = (title) => {
  if (!title) return '·'
  const trimmed = String(title).trim()
  if (!trimmed) return '·'
  // Array.from 处理多字节字符（emoji / 中文 surrogate pair）
  return Array.from(trimmed)[0] || '·'
}

// 一级侧边栏的"最近笔记"
// 视觉：与 NavItem 完全对齐 — 36×36 圆角方块 + 标题首字
// 颜色：主题色（primary / text.secondary），不再用每笔记的 hue
// 顺序：稳定，不重排
// 数量：不限，外层 sidebar 已可滚
const RecentNotesRail = () => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const recents = useRecentNotes((s) => s.recents)
  const togglePin = useRecentNotes((s) => s.togglePin)
  const remove = useRecentNotes((s) => s.remove)

  const notes = useStore((s) => s.notes)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const setSelectedNoteId = useStore((s) => s.setSelectedNoteId)
  const currentView = useStore((s) => s.currentView)
  const setCurrentView = useStore((s) => s.setCurrentView)

  const [menu, setMenu] = useState({ anchor: null, id: null })

  const items = useMemo(() => {
    return recents
      .map((r) => {
        const note = notes.find((n) => n.id === r.id)
        if (!note) return null
        return { ...r, note }
      })
      .filter(Boolean)
  }, [recents, notes])

  if (items.length === 0) return null

  const onPick = (id) => {
    if (currentView !== 'notes') setCurrentView('notes')
    setSelectedNoteId(id)
  }

  const handleContextMenu = (e, id) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ anchor: e.currentTarget, id })
  }

  const closeMenu = () => setMenu({ anchor: null, id: null })

  const menuItem = items.find((i) => i.id === menu.id)
  const dimmed = currentView !== 'notes'

  const hoverBg = theme.palette.action.hover
  const activeBg = theme.palette.action.selected
  const pressBg = theme.custom?.surface?.pressed || (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)')

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'visible',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        marginTop: '6px',
        paddingTop: '8px',
        paddingBottom: '4px',
        opacity: dimmed ? 0.55 : 1,
        transition: `opacity ${NAV_DURATION}ms ${NAV_EASING}`,
        position: 'relative',
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: '20px',
          height: '1px',
          backgroundColor: theme.palette.divider,
          opacity: 0.4,
          flexShrink: 0,
          marginBottom: '4px',
        }}
      />
      {items.map((item) => {
        const active = item.id === selectedNoteId && currentView === 'notes'
        const title = deriveDisplayTitle(item.note)
        const ch = firstChar(title)
        const percent = Math.max(0, Math.min(1, item.scrollPercent || 0))

        return (
          <Tooltip
            key={item.id}
            title={
              <Box sx={{ minWidth: 120 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                  {title}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.7, fontSize: 10 }}>
                  阅读 {Math.round(percent * 100)}% · 右键固定/移除
                </Typography>
              </Box>
            }
            placement="right"
            enterDelay={350}
            enterNextDelay={150}
          >
            <Box sx={{ position: 'relative', width: '36px', height: '36px', flexShrink: 0 }}>
              <ButtonBase
                onClick={() => onPick(item.id)}
                onContextMenu={(e) => handleContextMenu(e, item.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    remove(item.id)
                  }
                }}
                focusRipple={false}
                disableRipple
                sx={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  color: active ? theme.palette.primary.main : theme.palette.text.secondary,
                  backgroundColor: active ? activeBg : 'transparent',
                  transition: `background-color ${NAV_DURATION}ms ${NAV_EASING}, color ${NAV_DURATION}ms ${NAV_EASING}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: '14px',
                  lineHeight: 1,
                  '&:hover': {
                    backgroundColor: active ? activeBg : hoverBg,
                    color: active ? theme.palette.primary.main : theme.palette.text.primary,
                  },
                  '&:active': {
                    backgroundColor: pressBg,
                    transition: `background-color ${NAV_DURATION_FAST}ms ${NAV_EASING}, color ${NAV_DURATION_FAST}ms ${NAV_EASING}`,
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: '2px',
                  },
                }}
              >
                {/* 首字 */}
                <Box component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
                  {ch}
                </Box>

                {/* 阅读进度条：底边 2px */}
                {percent > 0.01 && (
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      left: '6px',
                      right: '6px',
                      bottom: '4px',
                      height: '2px',
                      borderRadius: '1px',
                      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        width: `${percent * 100}%`,
                        height: '100%',
                        backgroundColor: active ? theme.palette.primary.main : theme.palette.text.secondary,
                        opacity: active ? 0.9 : 0.5,
                        transition: `width 240ms ${NAV_EASING}`,
                      }}
                    />
                  </Box>
                )}

                {/* pin 角标：右上角小图钉 */}
                {item.pinned && (
                  <PushPinIcon
                    sx={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      fontSize: '10px',
                      color: theme.palette.primary.main,
                      transform: 'rotate(35deg)',
                    }}
                  />
                )}
              </ButtonBase>
            </Box>
          </Tooltip>
        )
      })}

      <Menu
        anchorEl={menu.anchor}
        open={Boolean(menu.anchor)}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
        transformOrigin={{ vertical: 'center', horizontal: 'left' }}
        slotProps={{ paper: { sx: { ml: 1, minWidth: 160 } } }}
      >
        {menuItem && (
          <MenuItem
            onClick={() => {
              togglePin(menuItem.id)
              closeMenu()
            }}
          >
            <ListItemIcon>
              {menuItem.pinned ? (
                <PushPinIcon fontSize="small" />
              ) : (
                <PushPinOutlinedIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText primary={menuItem.pinned ? '取消固定' : '固定'} />
          </MenuItem>
        )}
        {menuItem && (
          <MenuItem
            onClick={() => {
              remove(menuItem.id)
              closeMenu()
            }}
          >
            <ListItemIcon>
              <CloseIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="关闭" />
          </MenuItem>
        )}
      </Menu>
    </Box>
  )
}

export default RecentNotesRail
