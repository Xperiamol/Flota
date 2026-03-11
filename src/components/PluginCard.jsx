import React from 'react'
import {
  Box,
  Typography,
  Stack,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  Button,
  Chip,
  LinearProgress,
  Avatar
} from '@mui/material'
import {
  CloudDownloadRounded,
  DeleteRounded,
  PowerSettingsNewRounded,
  RocketLaunchRounded,
  CheckCircleOutline,
} from '@mui/icons-material'
import { getDisplayCategories } from './pluginUtils'

const PluginCard = ({
  plugin,
  isInstalled,
  isEnabled,
  hasUpdate,
  pendingAction,
  onInstall,
  onEnableToggle,
  onUninstall,
  onSelect,
  compact
}) => {
  if (!plugin) return null

  const categories = getDisplayCategories(plugin)
  const description = plugin.shortDescription || plugin.description || plugin.manifest?.description || '暂未提供描述'

  return (
    <Card
      variant="outlined"
      sx={(muiTheme) => ({
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: muiTheme.palette.mode === 'dark'
          ? 'rgba(30, 41, 59, 0.85)'
          : 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
        '&:hover': {
          borderColor: 'primary.main',
          boxShadow: muiTheme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.3)'
            : '0 8px 32px rgba(0, 0, 0, 0.1)',
          transform: 'translateY(-2px)',
          cursor: 'pointer'
        }
      })}
      onClick={() => onSelect(plugin.id)}
    >
      <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}>
        {isInstalled ? (
          <Chip
            size="small"
            color={isEnabled ? 'success' : 'default'}
            icon={isEnabled ? <CheckCircleOutline fontSize="small" /> : <PowerSettingsNewRounded fontSize="small" />}
            label={isEnabled ? '已启用' : '已禁用'}
            sx={{ fontWeight: 500, '& .MuiChip-icon': { fontSize: '0.9rem' } }}
          />
        ) : (
          <Chip size="small" color="primary" variant="outlined" label="未安装" sx={{ fontWeight: 500 }} />
        )}
      </Box>

      <CardContent sx={{ pb: 1.5, flex: 1, display: 'flex', flexDirection: 'column', pt: 2 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ mb: 2 }}>
          <Avatar
            variant="circular"
            src={plugin.icon || undefined}
            sx={{
              bgcolor: plugin.icon ? undefined : 'primary.main',
              color: plugin.icon ? undefined : 'primary.contrastText',
              width: 52, height: 52,
              fontSize: '1.25rem', fontWeight: 600,
              boxShadow: 1, flexShrink: 0, borderRadius: '50%'
            }}
          >
            {!plugin.icon && ((plugin.name || '').trim().slice(0, 2).toUpperCase() || 'P')}
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0, pr: 8 }}>
            <Typography variant="h6" component="div"
              sx={{ lineHeight: 1.3, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {plugin.manifest?.name || plugin.name || '未知插件'}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
              <Typography variant="caption"
                sx={{ color: 'text.secondary', fontWeight: 500,
                  backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                  px: 0.75, py: 0.25, borderRadius: 0.5 }}>
                v{plugin.manifest?.version || plugin.version || '0.0.0'}
              </Typography>
              {plugin.author?.name && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>by {plugin.author.name}</Typography>
              )}
            </Stack>
          </Box>
        </Stack>

        <Typography variant="body2" color="text.secondary"
          sx={{ minHeight: compact ? 'auto' : 54, overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: compact ? 2 : 3, WebkitBoxOrient: 'vertical', textOverflow: 'ellipsis', lineHeight: 1.5, mb: 1.5 }}>
          {description}
        </Typography>

        <Box sx={{ mt: 'auto' }}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, '& .MuiChip-root': { height: 22, fontSize: '0.7rem' } }}>
            {plugin.sourceType && (
              <Chip size="small"
                label={plugin.sourceType === 'development'
                  ? (plugin.sourceLabel === 'examples' ? '📦 示例' : '💻 本地')
                  : '☁️ 云端'}
                color={plugin.sourceType === 'development' ? 'secondary' : 'default'}
                variant="filled" sx={{ fontWeight: 500, opacity: 0.9 }} />
            )}
            {categories.slice(0, 2).map((category) => (
              <Chip key={category} size="small" label={category} variant="outlined" sx={{ opacity: 0.8 }} />
            ))}
            {categories.length > 2 && (
              <Chip size="small" label={`+${categories.length - 2}`} variant="outlined" sx={{ opacity: 0.6 }} />
            )}
            {hasUpdate && <Chip size="small" color="warning" label="🔄 可更新" sx={{ fontWeight: 500 }} />}
          </Stack>
        </Box>
      </CardContent>

      <Box sx={(muiTheme) => ({
        px: 2, py: 1.5,
        borderTop: `1px solid ${muiTheme.palette.divider}`,
        backgroundColor: muiTheme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.02)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      })}>
        <Button size="small" color="primary" startIcon={<RocketLaunchRounded fontSize="small" />}
          onClick={(e) => { e.stopPropagation(); onSelect(plugin.id) }}
          sx={{ textTransform: 'none', fontWeight: 500 }}>
          查看详情
        </Button>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {!isInstalled && (
            <Button size="small" variant="contained" startIcon={<CloudDownloadRounded fontSize="small" />}
              disabled={Boolean(pendingAction)}
              onClick={(e) => { e.stopPropagation(); onInstall(plugin.id) }}
              sx={{ textTransform: 'none', fontWeight: 500, boxShadow: 1 }}>
              安装
            </Button>
          )}
          {isInstalled && (
            <>
              <Button size="small" variant={isEnabled ? 'outlined' : 'contained'}
                color={isEnabled ? 'warning' : 'success'}
                disabled={Boolean(pendingAction)}
                startIcon={<PowerSettingsNewRounded fontSize="small" />}
                onClick={(e) => { e.stopPropagation(); onEnableToggle(plugin.id, !isEnabled) }}
                sx={{ textTransform: 'none', fontWeight: 500, minWidth: 72 }}>
                {isEnabled ? '禁用' : '启用'}
              </Button>
              <Tooltip title="卸载插件">
                <IconButton size="small" color="error" disabled={Boolean(pendingAction)}
                  onClick={(e) => { e.stopPropagation(); onUninstall(plugin.id) }}
                  sx={{ '&:hover': { backgroundColor: 'error.main', color: 'error.contrastText' } }}>
                  <DeleteRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      </Box>

      {pendingAction && (
        <LinearProgress sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '0 0 8px 8px' }} />
      )}
    </Card>
  )
}

export default PluginCard
