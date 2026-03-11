import React from 'react'
import {
  Box,
  Typography,
  Stack,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Alert,
  Avatar
} from '@mui/material'
import {
  CloudDownloadRounded,
  DeleteRounded,
  PowerSettingsNewRounded,
  RocketLaunchRounded,
  ErrorOutline,
  FolderOpenRounded
} from '@mui/icons-material'
import { getDisplayCategories, formatPermissions, permissionDescriptions } from './pluginUtils'

const PluginDetailDrawer = ({
  plugin,
  open,
  onClose,
  onInstall,
  onEnableToggle,
  onUninstall,
  pendingAction,
  onExecuteCommand,
  commandPending,
  onOpenFolder
}) => {
  if (!plugin) return null

  const permissions = formatPermissions(plugin.permissions)
  const categories = getDisplayCategories(plugin)
  const commands = Array.isArray(plugin.commands) ? plugin.commands : []

  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ '& .MuiDrawer-paper': { width: 400, p: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar variant="circular"
            src={plugin.icon || undefined}
            sx={{
              bgcolor: plugin.icon ? undefined : 'primary.main',
              color: plugin.icon ? undefined : 'primary.contrastText',
              width: 56, height: 56, borderRadius: '50%'
            }}>
            {!plugin.icon && ((plugin.name || '').trim().slice(0, 2).toUpperCase() || 'P')}
          </Avatar>
          <Box>
            <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
              {plugin.manifest?.name || plugin.name || '未知插件'}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <Chip size="small" label={`版本 ${plugin.manifest?.version || plugin.version || '未知'}`} />
              {plugin.manifest?.minAppVersion && (
                <Chip size="small" variant="outlined" label={`最低版本 ${plugin.manifest.minAppVersion}`} />
              )}
            </Stack>
          </Box>
        </Stack>

        <Typography variant="body1" color="text.secondary">
          {plugin.shortDescription || plugin.description || plugin.manifest?.description || '暂无详细描述'}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          {categories.map((category) => (
            <Chip key={category} label={category} variant="outlined" />
          ))}
        </Stack>

        <Divider />

        <Stack direction="row" spacing={1}>
          <Button variant="contained" startIcon={<CloudDownloadRounded />}
            disabled={pendingAction === 'install'} onClick={() => onInstall(plugin.id)}>
            {plugin.installed ? '重新安装' : '安装插件'}
          </Button>
          <Button variant={plugin.enabled ? 'outlined' : 'contained'}
            color={plugin.enabled ? 'warning' : 'primary'}
            startIcon={<PowerSettingsNewRounded />}
            disabled={pendingAction === 'toggle'}
            onClick={() => onEnableToggle(plugin.id, !plugin.enabled)}>
            {plugin.enabled ? '禁用' : '启用'}
          </Button>
          {plugin.installed && (
            <>
              <Tooltip title="打开插件位置">
                <IconButton color="primary" onClick={() => onOpenFolder(plugin.id)}>
                  <FolderOpenRounded />
                </IconButton>
              </Tooltip>
              <Button color="error" variant="text" startIcon={<DeleteRounded />}
                disabled={pendingAction === 'uninstall'} onClick={() => onUninstall(plugin.id)}>
                卸载
              </Button>
            </>
          )}
        </Stack>

        {permissions.length > 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>权限需求</Typography>
            <List dense>
              {permissions.map((permission) => (
                <ListItem key={permission} disableGutters>
                  <ListItemText primary={permission} primaryTypographyProps={{ variant: 'body2' }}
                    secondary={permissionDescriptions[permission] || '自定义权限'} />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {commands.length > 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>可用命令</Typography>
            <Stack spacing={1}>
              {commands.map((command) => (
                <Card key={command.id} variant="outlined">
                  <CardContent sx={{ pb: 1 }}>
                    <Typography variant="subtitle2">{command.title || command.id}</Typography>
                    {command.description && (
                      <Typography variant="body2" color="text.secondary">{command.description}</Typography>
                    )}
                  </CardContent>
                  <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                    <Button size="small" variant="contained" startIcon={<RocketLaunchRounded />}
                      disabled={commandPending === command.id}
                      onClick={() => onExecuteCommand(plugin.id, command.id)}>
                      运行
                    </Button>
                  </CardActions>
                </Card>
              ))}
            </Stack>
          </Box>
        )}

        {plugin.lastError && (
          <Alert severity="error" icon={<ErrorOutline />}>{plugin.lastError}</Alert>
        )}
      </Stack>
    </Drawer>
  )
}

export default PluginDetailDrawer
