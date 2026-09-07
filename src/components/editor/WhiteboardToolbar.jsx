import { useMemo, useState } from 'react'
import {
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  SvgIcon,
  Tooltip,
} from '@mui/material'
import {
  AccountTreeRounded,
  DataObjectRounded,
  FlashOnRounded,
  LanguageRounded,
  LockOpenRounded,
  LockRounded,
  MoreHorizRounded,
  Description,
} from '../common/AppIcons'
import { createWhiteboardSurfaceTokens } from '../../utils/whiteboardSurfaceTheme'

const StrokeIcon = ({ children, ...props }) => (
  <SvgIcon viewBox="0 0 24 24" {...props}>
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </g>
  </SvgIcon>
)

const CursorIcon = props => <StrokeIcon {...props}><path d="M5 3.5 18.5 11l-6 1.7-2.8 5.8L5 3.5Z" /></StrokeIcon>
const HandIcon = props => (
  <StrokeIcon {...props}>
    <path d="M7.2 12V7.8a1.35 1.35 0 0 1 2.7 0v2.7" />
    <path d="M9.9 10.5V5.9a1.35 1.35 0 0 1 2.7 0v4.4" />
    <path d="M12.6 10.3V6.8a1.35 1.35 0 0 1 2.7 0v4" />
    <path d="M15.3 10.8V8.5a1.35 1.35 0 0 1 2.7 0v5.1a6.4 6.4 0 0 1-6.4 6.4h-.7a5.5 5.5 0 0 1-4.4-2.2l-2.2-3a1.45 1.45 0 0 1 2.2-1.9l1.8 1.7" />
  </StrokeIcon>
)
const RectangleIcon = props => <StrokeIcon {...props}><rect x="4" y="5" width="16" height="14" rx="1.5" /></StrokeIcon>
const DiamondIcon = props => <StrokeIcon {...props}><path d="m12 3.8 8.2 8.2-8.2 8.2L3.8 12 12 3.8Z" /></StrokeIcon>
const EllipseIcon = props => <StrokeIcon {...props}><ellipse cx="12" cy="12" rx="8.5" ry="7.5" /></StrokeIcon>
const ArrowIcon = props => <StrokeIcon {...props}><path d="M4 12h15M14 7l5 5-5 5" /></StrokeIcon>
const LineIcon = props => <StrokeIcon {...props}><path d="m5 17 14-10" /></StrokeIcon>
const DrawIcon = props => <StrokeIcon {...props}><path d="M3.5 16.5c3.4-5.8 5.2-7.8 6.2-6.8 1.5 1.5-2.2 6.6-.4 7.3 1.6.6 4-4.3 5.3-3.6 1 .5-.1 3.2 1.1 3.6 1 .3 2.4-1.3 4.8-4.2" /></StrokeIcon>
const TextIcon = props => <StrokeIcon {...props}><path d="M5 6h14M12 6v12M8.5 18h7" /></StrokeIcon>
const ImageIcon = props => <StrokeIcon {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="8.3" cy="9" r="1.4" /><path d="m5.5 17 4.4-4.5 2.8 2.5 2.3-2.3 3.5 4.3" /></StrokeIcon>
const EraserIcon = props => <StrokeIcon {...props}><path d="m8.2 17.8-3-3a2 2 0 0 1 0-2.8l6.6-6.6a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8l-5.6 5.6H8.2Z" /><path d="m10 8 6 6M8 20h11" /></StrokeIcon>
const FrameIcon = props => <StrokeIcon {...props}><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></StrokeIcon>

const PRIMARY_TOOLS = [
  { type: 'hand', label: '抓手', shortcut: 'H', Icon: HandIcon },
  { type: 'selection', label: '选择', shortcut: 'V / 1', Icon: CursorIcon },
  { type: 'rectangle', label: '矩形', shortcut: 'R / 2', Icon: RectangleIcon },
  { type: 'diamond', label: '菱形', shortcut: 'D / 3', Icon: DiamondIcon },
  { type: 'ellipse', label: '椭圆', shortcut: 'O / 4', Icon: EllipseIcon },
  { type: 'arrow', label: '箭头', shortcut: 'A / 5', Icon: ArrowIcon },
  { type: 'line', label: '直线', shortcut: 'L / 6', Icon: LineIcon },
  { type: 'freedraw', label: '画笔', shortcut: 'P / 7', Icon: DrawIcon },
  { type: 'text', label: '文本', shortcut: 'T / 8', Icon: TextIcon },
  { type: 'image', label: '图片', shortcut: 'I / 9', Icon: ImageIcon },
  { type: 'eraser', label: '橡皮擦', shortcut: 'E / 0', Icon: EraserIcon },
]

const EXTRA_TOOLS = [
  { type: 'frame', label: '画框', shortcut: 'F', Icon: FrameIcon },
  { type: 'embeddable', label: '嵌入网页', Icon: LanguageRounded },
  { type: 'laser', label: '激光笔', shortcut: 'K', Icon: FlashOnRounded },
]

const EXTRA_TYPES = new Set(EXTRA_TOOLS.map(tool => tool.type))

const Shortcut = ({ children }) => children ? (
  <Box component="span" sx={{ ml: 'auto', pl: 2, color: 'text.disabled', fontSize: 11, fontWeight: 500 }}>
    {children}
  </Box>
) : null

const ToolButton = ({ active, open = false, label, shortcut, Icon, onClick }) => (
  <Tooltip title={`${label}${shortcut ? ` · ${shortcut}` : ''}`} placement="bottom" enterDelay={450}>
    <IconButton
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={[active && 'is-active', open && 'is-open'].filter(Boolean).join(' ') || undefined}
      size="small"
    >
      <Icon />
    </IconButton>
  </Tooltip>
)

export default function WhiteboardToolbar({
  api,
  activeTool = 'selection',
  locked = false,
  isDark = false,
  primaryColor,
  onMermaidCreate,
  onSvgCreate,
  onNoteReference,
}) {
  const [menuAnchor, setMenuAnchor] = useState(null)
  const menuOpen = Boolean(menuAnchor)
  const moreActive = menuOpen || EXTRA_TYPES.has(activeTool)
  const tokens = useMemo(
    () => createWhiteboardSurfaceTokens({ isDark, primaryColor }),
    [isDark, primaryColor],
  )

  const releaseToolbarFocus = (trigger) => {
    trigger?.blur?.()
  }

  const closeMenu = () => {
    const trigger = menuAnchor
    setMenuAnchor(null)
    requestAnimationFrame(() => releaseToolbarFocus(trigger))
  }

  const selectTool = (type, trigger) => {
    if (!api) return
    api.setActiveTool(type === 'image'
      ? { type, insertOnCanvasDirectly: false }
      : { type })
    setMenuAnchor(null)
    releaseToolbarFocus(trigger)
  }

  const toggleLock = (event) => {
    if (!api) return
    api.setActiveTool(locked
      ? { type: 'selection', locked: false }
      : { type: activeTool, locked: true })
    releaseToolbarFocus(event?.currentTarget)
  }

  const runCreateAction = (action) => {
    closeMenu()
    action?.()
  }

  const menuPaperSx = useMemo(() => ({
    mt: 0.75,
    minWidth: 224,
    borderRadius: '12px',
    color: tokens.text,
    backgroundColor: tokens.glassBackground,
    backgroundImage: tokens.glassBackgroundImage,
    backdropFilter: tokens.glassBlur,
    WebkitBackdropFilter: tokens.glassBlur,
    border: tokens.glassBorder,
    boxShadow: tokens.glassShadow,
    '& .MuiMenu-list': { py: 0.75 },
    '& .MuiMenuItem-root': {
      minHeight: 38,
      mx: 0.75,
      px: 1.25,
      borderRadius: '8px',
    },
    '& .MuiListItemIcon-root': { minWidth: 34, color: tokens.muted },
    '& .MuiMenuItem-root:hover': { backgroundColor: tokens.hover },
    '& .MuiMenuItem-root:active': { backgroundColor: tokens.pressed },
    '& .MuiMenuItem-root.Mui-selected': {
      color: tokens.accent,
      backgroundColor: tokens.selected,
    },
    '& .MuiDivider-root': { borderColor: isDark ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.08)' },
  }), [isDark, tokens])

  return (
    <Paper
      className="flota-whiteboard-toolbar"
      elevation={0}
      role="toolbar"
      aria-label="白板绘图工具"
      sx={() => ({
        display: 'flex',
        alignItems: 'center',
        maxWidth: 'calc(100vw - 156px)',
        height: 48,
        px: 0.5,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        borderRadius: '14px',
        backgroundColor: tokens.glassBackground,
        backgroundImage: tokens.glassBackgroundImage,
        backdropFilter: tokens.glassBlur,
        WebkitBackdropFilter: tokens.glassBlur,
        border: tokens.glassBorder,
        boxShadow: tokens.glassShadow,
        pointerEvents: 'auto',
        '&::-webkit-scrollbar': { display: 'none' },
        '& .MuiIconButton-root': {
          flex: '0 0 auto',
          width: 38,
          height: 38,
          mx: '1px',
          borderRadius: '10px',
          overflow: 'hidden',
          color: tokens.muted,
          transition: 'color 120ms ease, background-color 120ms ease, transform 80ms ease',
          '& svg': { width: 20, height: 20 },
          '&:hover': {
            color: tokens.text,
            backgroundColor: tokens.hover,
          },
          '&:active': {
            color: tokens.text,
            transform: 'scale(.94)',
          },
          '&.is-active': {
            color: tokens.accent,
            backgroundColor: tokens.selected,
          },
          '&.is-active:hover': {
            backgroundColor: tokens.selected,
          },
          '&:focus-visible': {
            outline: `2px solid ${tokens.accent}`,
            outlineOffset: -2,
          },
          '& .MuiTouchRipple-root': {
            inset: 0,
            borderRadius: 'inherit',
            overflow: 'hidden',
          },
          '& .MuiTouchRipple-child': {
            borderRadius: '10px !important',
          },
        },
        '& .flota-toolbar-divider': {
          height: 22,
          mx: 0.5,
          borderColor: isDark ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.08)',
        },
      })}
    >
      <ToolButton
        active={locked}
        label={locked ? '关闭连续绘制' : '开启连续绘制'}
        shortcut="Q"
        Icon={locked ? LockRounded : LockOpenRounded}
        onClick={toggleLock}
      />
      <Divider orientation="vertical" className="flota-toolbar-divider" />
      {PRIMARY_TOOLS.map(tool => (
        <ToolButton
          key={tool.type}
          {...tool}
          active={activeTool === tool.type}
          onClick={(event) => selectTool(tool.type, event.currentTarget)}
        />
      ))}
      <Divider orientation="vertical" className="flota-toolbar-divider" />
      <ToolButton
        active={moreActive}
        open={menuOpen}
        label="更多工具与成图"
        Icon={MoreHorizRounded}
        onClick={(event) => setMenuAnchor(current => current ? null : event.currentTarget)}
      />
      <Menu
        anchorEl={menuAnchor}
        open={menuOpen}
        onClose={closeMenu}
        disableRestoreFocus
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: menuPaperSx } }}
      >
        {EXTRA_TOOLS.map(({ type, label, shortcut, Icon }) => (
          <MenuItem key={type} selected={activeTool === type} onClick={(event) => selectTool(type, event.currentTarget)}>
            <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} />
            <Shortcut>{shortcut}</Shortcut>
          </MenuItem>
        ))}
        <Divider sx={{ my: 0.75 }} />
        <ListSubheader sx={{ bgcolor: 'transparent', color: tokens.muted, fontSize: 11, lineHeight: '28px', fontWeight: 700 }}>
          成图
        </ListSubheader>
        <MenuItem onClick={() => runCreateAction(onMermaidCreate)}>
          <ListItemIcon><AccountTreeRounded fontSize="small" /></ListItemIcon>
          <ListItemText primary="Mermaid 图表" />
        </MenuItem>
        <MenuItem onClick={() => runCreateAction(onSvgCreate)}>
          <ListItemIcon><DataObjectRounded fontSize="small" /></ListItemIcon>
          <ListItemText primary="SVG 源码" />
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => runCreateAction(onNoteReference)}><ListItemIcon><Description fontSize="small" /></ListItemIcon><ListItemText primary="引用笔记" /></MenuItem>
      </Menu>
    </Paper>
  )
}
