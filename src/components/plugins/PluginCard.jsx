import React, { useState } from 'react'
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
  Avatar,
  Switch
} from '@mui/material'
import {
  CloudDownloadRounded,
  DeleteRounded,
  MoreHoriz,
  Extension,
  Computer,
  Cloud,
} from '../common/AppIcons'
import { getDisplayCategories, isBuiltinPlugin, pluginDisplayName } from './pluginUtils'
import AppContextMenu from '../common/AppContextMenu'
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
  const [menuAnchor, setMenuAnchor] = useState(null)
  if (!plugin) return null

  const name = pluginDisplayName(plugin)
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
              flexShrink: 0, borderRadius: 1.5
            }}
          >
            {avatarContent || (!plugin.icon && (name.trim().slice(0, 2).toUpperCase() || 'P'))}
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" component="div"
              title={name}
              sx={{ fontSize: '1.05rem', lineHeight: 1.35, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
              {/* 版本 · 作者，一行安静的灰字；启用状态看底部的开关，这里不再重复 */}
              <Typography variant="caption" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>
                {[metaLabel === null ? null : (metaLabel || `v${plugin.manifest?.version || plugin.version || '0.0.0'}`), plugin.author?.name].filter(Boolean).join(' · ')}
              </Typography>
              {statusChip !== undefined ? statusChip : isBuiltinPlugin(plugin) ? (
                <Chip size="small" label="内置" sx={{ height: 20, fontSize: 11, fontWeight: 600 }} />
              ) : null}
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
          <Button size="small" color="primary"
            onClick={(e) => { e.stopPropagation(); onSelect(plugin.id) }}
            sx={{ textTransform: 'none', fontWeight: 500, ml: -0.75 }}>
            {detailLabel}
          </Button>
        ) : <span />}
        <Stack direction="row" spacing={0.5} alignItems="center" onClick={(e) => e.stopPropagation()}>
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
              {/* 启用 / 停用用开关；卸载这种不常用又危险的操作收进「更多」 */}
              <Typography component="label" htmlFor={`plugin-enable-${plugin.id}`} variant="caption" sx={{ color: 'text.secondary', cursor: 'pointer' }}>
                {isEnabled ? '已启用' : '已停用'}
              </Typography>
              <Switch size="small" checked={Boolean(isEnabled)} disabled={Boolean(pendingAction)}
                inputProps={{ id: `plugin-enable-${plugin.id}`, 'aria-label': `启用「${name}」` }}
                onChange={(e) => onEnableToggle(plugin.id, e.target.checked)} />
              <Tooltip title="更多">
                <IconButton size="small" aria-label={`「${name}」的更多操作`} disabled={Boolean(pendingAction)}
                  onClick={(e) => setMenuAnchor({ el: e.currentTarget })}>
                  <MoreHoriz fontSize="small" />
                </IconButton>
              </Tooltip>
              <AppContextMenu
                anchor={menuAnchor}
                onClose={() => setMenuAnchor(null)}
                items={[{ key: 'uninstall', label: '卸载', icon: <DeleteRounded fontSize="small" />, danger: true, onClick: () => onUninstall(plugin.id) }]}
              />
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
