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
  Extension,
  Computer,
  Cloud,
} from '../common/AppIcons'
import { getDisplayCategories } from './pluginUtils'
import { createSoftGlassCardSx } from '../../styles/commonStyles'

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
  compact,
  // 以下用于组件等非插件条目：替换头像内容、状态标签与底部操作，其余布局保持一致
  avatarContent,
  statusChip,
  actions,
  detailLabel = '查看详情', // null：不显示（整张卡片可点）
  metaLabel, // null：不显示版本
  hideCategories = false
}) => {
  if (!plugin) return null

  const categories = getDisplayCategories(plugin)
  const description = plugin.shortDescription || plugin.description || plugin.manifest?.description || '暂未提供描述'

  return (
    <Card
      sx={(muiTheme) => ({
        // 复用个人中心同款 soft-glass 卡片样式（含 hover 反馈与顶部渐变细条）
        ...createSoftGlassCardSx(muiTheme.palette.primary.main)(muiTheme),
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
      })}
      onClick={() => onSelect(plugin.id)}
    >
      <CardContent sx={{ pb: 1.5, flex: 1, display: 'flex', flexDirection: 'column', pt: 2 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ mb: 2 }}>
          <Avatar
            variant="circular"
            src={plugin.icon || undefined}
            sx={{
              bgcolor: avatarContent ? 'action.hover' : plugin.icon ? undefined : 'primary.main',
              color: plugin.icon ? undefined : 'primary.contrastText',
              width: 48, height: 48,
              fontSize: '1.15rem', fontWeight: 600,
              flexShrink: 0, borderRadius: '12px'
            }}
          >
            {avatarContent || (!plugin.icon && ((plugin.name || '').trim().slice(0, 2).toUpperCase() || 'P'))}
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" component="div"
              title={plugin.manifest?.name || plugin.name || '未知插件'}
              sx={{ fontSize: '1.05rem', lineHeight: 1.35, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {plugin.manifest?.name || plugin.name || '未知插件'}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
              {metaLabel !== null && (
                <Typography variant="caption"
                  sx={{ color: 'text.secondary', fontWeight: 500,
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                    px: 0.75, py: 0.25, borderRadius: 0.5 }}>
                  {metaLabel || `v${plugin.manifest?.version || plugin.version || '0.0.0'}`}
                </Typography>
              )}
              {plugin.author?.name && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>by {plugin.author.name}</Typography>
              )}
              {/* 状态标签放在元信息行，不再绝对定位压住标题 */}
              {statusChip !== undefined ? statusChip : isInstalled ? (
                <Chip
                  size="small"
                  color={isEnabled ? 'success' : 'default'}
                  icon={isEnabled ? <CheckCircleOutline fontSize="small" /> : <PowerSettingsNewRounded fontSize="small" />}
                  label={isEnabled ? '已启用' : '已禁用'}
                  sx={{ height: 20, fontSize: 11, fontWeight: 600, '& .MuiChip-icon': { fontSize: '0.8rem' } }}
                />
              ) : (
                <Chip size="small" color="primary" variant="outlined" label="未安装" sx={{ height: 20, fontSize: 11, fontWeight: 600 }} />
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
                icon={plugin.sourceType === 'development'
                  ? (plugin.sourceLabel === 'examples' ? <Extension /> : <Computer />)
                  : <Cloud />}
                label={plugin.sourceType === 'development'
                  ? (plugin.sourceLabel === 'examples' ? '示例' : '本地')
                  : '云端'}
                color={plugin.sourceType === 'development' ? 'secondary' : 'default'}
                variant="filled" sx={{ fontWeight: 500, opacity: 0.9 }} />
            )}
            {!hideCategories && categories.slice(0, 2).map((category) => (
              <Chip key={category} size="small" label={category} variant="outlined" sx={{ opacity: 0.8 }} />
            ))}
            {!hideCategories && categories.length > 2 && (
              <Chip size="small" label={`+${categories.length - 2}`} variant="outlined" sx={{ opacity: 0.6 }} />
            )}
            {hasUpdate && <Chip size="small" color="warning" label="🔄 可更新" sx={{ fontWeight: 500 }} />}
          </Stack>
        </Box>
      </CardContent>

      <Box sx={(muiTheme) => ({
        px: 2, py: 1.5,
        borderTop: `1px solid ${muiTheme.palette.divider}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      })}>
        {detailLabel ? (
          <Button size="small" color="primary" startIcon={<RocketLaunchRounded fontSize="small" />}
            onClick={(e) => { e.stopPropagation(); onSelect(plugin.id) }}
            sx={{ textTransform: 'none', fontWeight: 500 }}>
            {detailLabel}
          </Button>
        ) : <span />}
        <Stack direction="row" spacing={0.75} alignItems="center" onClick={(e) => e.stopPropagation()}>
          {actions}
          {!actions && !isInstalled && (
            <Button size="small" variant="contained" startIcon={<CloudDownloadRounded fontSize="small" />}
              disabled={Boolean(pendingAction)}
              onClick={(e) => { e.stopPropagation(); onInstall(plugin.id) }}
              sx={{ textTransform: 'none', fontWeight: 500 }}>
              安装
            </Button>
          )}
          {!actions && isInstalled && (
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
