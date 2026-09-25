import { Divider, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material'

// 与笔记列表右键菜单一致的玻璃质感
const paperSx = (theme) => ({
  backdropFilter: theme?.custom?.glass?.backdropFilter || 'blur(6px)',
  backgroundColor: theme?.custom?.glass?.background || (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.4)'),
  border: theme?.custom?.glass?.border || `1px solid ${theme.palette.divider}`,
  borderRadius: 1,
  minWidth: 180,
})

/**
 * 应用内统一的上下文菜单（右键或“···”按钮）。
 * @param {object} props
 * @param {{ el?: Element, x?: number, y?: number } | null} props.anchor 按元素或鼠标位置弹出
 * @param {() => void} props.onClose
 * @param {Array<{ key?: string, label?: string, icon?: React.ReactNode, onClick?: () => void, danger?: boolean, disabled?: boolean, divider?: boolean, hidden?: boolean }>} props.items
 */
export default function AppContextMenu({ anchor, onClose, items }) {
  const byPosition = anchor && typeof anchor.x === 'number'
  return (
    <Menu
      open={Boolean(anchor)}
      onClose={onClose}
      anchorEl={byPosition ? undefined : anchor?.el}
      anchorReference={byPosition ? 'anchorPosition' : 'anchorEl'}
      anchorPosition={byPosition ? { top: anchor.y, left: anchor.x } : undefined}
      transformOrigin={byPosition ? undefined : { horizontal: 'right', vertical: 'top' }}
      anchorOrigin={byPosition ? undefined : { horizontal: 'right', vertical: 'bottom' }}
      slotProps={{ paper: { sx: paperSx } }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.filter((item) => !item.hidden).map((item, index) => (item.divider
        ? <Divider key={item.key || `divider-${index}`} />
        : (
          <MenuItem
            key={item.key || item.label}
            disabled={item.disabled}
            onClick={() => {
              onClose?.()
              item.onClick?.()
            }}
            sx={item.danger ? { color: 'error.main' } : undefined}
          >
            {item.icon && <ListItemIcon sx={item.danger ? { color: 'error.main' } : undefined}>{item.icon}</ListItemIcon>}
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        )))}
    </Menu>
  )
}
