import { Box, ListItem, ListItemText, Typography } from '@mui/material'
import { settingsRowSx } from '../../styles/commonStyles'

/** 设置里的一行：左边名称和说明，右边控件。所有设置页共用，保证行高、字号、分割线一致 */
export function SettingRow({ primary, secondary, action, disabled = false }) {
  return (
    <ListItem
      sx={(theme) => ({
        ...settingsRowSx(theme),
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        opacity: disabled ? 0.45 : 1,
        transition: 'opacity 160ms ease',
      })}
    >
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{
          primary: { sx: { fontWeight: 500, fontSize: '0.9rem' } },
          secondary: { sx: { mt: 0.25 } },
        }}
        sx={{ flex: '1 1 auto', minWidth: 0, mr: 1 }}
      />
      <Box sx={{ flex: '0 0 auto' }}>{action}</Box>
    </ListItem>
  )
}

/** 设置页里的小分组标题（启动、窗口、笔记列表……） */
export function SettingGroupLabel({ children, first = false }) {
  return (
    <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', letterSpacing: '0.02em', mt: first ? 0.5 : 2.5, mb: 0.25, px: 0.5 }}>
      {children}
    </Typography>
  )
}
