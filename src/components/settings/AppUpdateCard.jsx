import { Box, Button, CircularProgress, Switch, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Autorenew as AutorenewRounded, CheckRounded, Download as DownloadRounded, ErrorOutline, RocketLaunchRounded } from '../common/AppIcons'

const statusOf = (info, managedByStore) => {
  if (managedByStore) return { key: 'store', text: '由 Microsoft Store 自动更新', color: 'success', Icon: CheckRounded }
  if (info.checking) return { key: 'checking', text: '正在检查更新…', color: 'primary' }
  if (info.hasUpdate) return { key: 'update', text: `新版本 ${info.latestVersion} 已发布`, color: 'primary', Icon: RocketLaunchRounded }
  if (info.error) return { key: 'error', text: info.error, color: 'warning', Icon: ErrorOutline }
  if (info.checked) return { key: 'latest', text: '已是最新版本', color: 'success', Icon: CheckRounded }
  return { key: 'idle', text: '还没有检查过更新', color: null, Icon: AutorenewRounded }
}

/**
 * 设置 → 关于：当前版本、更新状态、手动检查，以及「启动时自动检查更新」开关。
 * 商店版（managedByStore）只显示版本，按钮打开商店的「下载和更新」。
 */
export default function AppUpdateCard({ version, info, autoCheck, onAutoCheckChange, onCheck, managedByStore = false }) {
  const status = statusOf(info || {}, managedByStore)
  const openDownload = () => window.electronAPI?.system?.openExternal?.(info.downloadUrl)

  return (
    <Box sx={(theme) => ({
      maxWidth: 460, mx: 'auto', mb: 4, textAlign: 'left', borderRadius: '16px',
      bgcolor: theme.custom?.surface?.inset || 'action.hover',
      border: `1px solid ${theme.palette.divider}`,
    })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75 }}>
        <Box sx={(theme) => {
          const tone = status.color ? theme.palette[status.color].main : theme.palette.text.secondary
          return {
            width: 40, height: 40, borderRadius: '12px', flexShrink: 0,
            display: 'grid', placeItems: 'center',
            color: tone, bgcolor: alpha(tone, theme.palette.mode === 'dark' ? 0.18 : 0.1),
            transition: 'background-color 200ms ease, color 200ms ease',
          }
        }}>
          {status.key === 'checking'
            ? <CircularProgress size={18} thickness={5} color="inherit" />
            : <status.Icon sx={{ fontSize: 22 }} />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 650, lineHeight: 1.35 }}>
            Flota {version ? `v${version}` : ''}
          </Typography>
          <Typography noWrap title={status.text}
            sx={{ fontSize: 12.5, mt: 0.125, color: status.key === 'update' ? 'primary.main' : 'text.secondary' }}>
            {status.text}
          </Typography>
        </Box>
        {status.key === 'store' ? (
          <Button variant="outlined" size="small" sx={{ flexShrink: 0 }}
            onClick={() => window.electronAPI?.system?.openSystemPage?.('store-updates')}>
            打开商店
          </Button>
        ) : status.key === 'update' ? (
          <Button variant="contained" size="small" disableElevation startIcon={<DownloadRounded />}
            onClick={openDownload} sx={{ flexShrink: 0 }}>
            前往下载
          </Button>
        ) : (
          <Button variant="outlined" size="small" disabled={status.key === 'checking'}
            onClick={onCheck} sx={{ flexShrink: 0 }}>
            {status.key === 'error' ? '重试' : '检查更新'}
          </Button>
        )}
      </Box>
      {!managedByStore && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.25, borderTop: 1, borderColor: 'divider' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>启动时自动检查更新</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.125 }}>有新版本时提醒你，不会自动下载</Typography>
          </Box>
          <Switch checked={autoCheck} onChange={(event) => onAutoCheckChange(event.target.checked)}
            inputProps={{ 'aria-label': '启动时自动检查更新' }} />
        </Box>
      )}
    </Box>
  )
}
