import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material'
import { AddRounded, CloudOutlined, DownloadRounded, EditOutlined, DeleteOutlineRounded, BackupOutlined } from '@mui/icons-material'
import { settingsSectionSx, sectionTitleSx, sectionDescriptionSx } from '../../styles/commonStyles'

const empty = { name: '', baseUrl: '', username: '', password: '', rootPath: '/Flota-backups/', auto: false }
export default function CloudBackupSettings() {
  const [targets, setTargets] = useState([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const load = useCallback(async () => {
    const result = await window.electronAPI.backup.cloudConfig()
    if (!result.success) throw new Error(result.error)
    setTargets(result.data.targets); setBusy(result.data.busy)
  }, [])
  useEffect(() => {
    let active = true
    const refresh = () => { if (active) load().catch(e => setMessage({ severity: 'error', text: e.message })) }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [load])
  const run = async (ids) => {
    setBusy(true); setMessage(null)
    try {
      const result = await window.electronAPI.backup.runCloud(ids)
      setMessage({ severity: result.success ? 'success' : 'warning', text: result.success ? '备份已完成，每个网盘各保留一份。' : result.error })
    } catch (e) { setMessage({ severity: 'error', text: e.message }) }
    finally { await load(); }
  }
  const save = async () => {
    setSaving(true)
    try {
      const { password, ...fields } = draft
      const result = await window.electronAPI.backup.saveCloud({ ...fields, ...(password || !draft.hasPassword ? { password } : {}) })
      if (!result.success) throw new Error(result.error)
      setTargets(result.data.targets); setDraft(null)
    } catch (e) { setMessage({ severity: 'error', text: e.message }) }
    finally { setSaving(false) }
  }
  const act = async (action) => {
    try { const result = await action(); if (!result.success) throw new Error(result.error); await load() }
    catch (e) { setMessage({ severity: 'error', text: e.message }) }
  }
  return <Box sx={settingsSectionSx}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}><BackupOutlined color="primary" /><Typography variant="subtitle1" sx={{ ...sectionTitleSx, mb: 0, flex: 1 }}>多网盘备份</Typography>
      <Button size="small" startIcon={<AddRounded />} onClick={() => { setMessage(null); setDraft({ ...empty }) }} disabled={busy}>添加网盘</Button>
    </Box>
    <Typography variant="body2" sx={sectionDescriptionSx}>在主同步之外，把笔记、历史版本和附件完整备份到其他 WebDAV 网盘。每个网盘保留本设备最近 5 份备份。</Typography>
    {message && <Alert severity={message.severity} sx={{ my: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
    <Stack spacing={1.5} sx={{ mt: 2 }}>
      {!targets.length && <Box sx={{ p: 3, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 3 }}><CloudOutlined sx={{ color: 'text.disabled', fontSize: 32 }} /><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>再添一个网盘，多留一份安心。</Typography><Typography variant="caption" color="text.secondary">支持坚果云、NAS 和其他 WebDAV 服务。</Typography></Box>}
      {targets.map(target => <Box key={target.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 3, p: 2, bgcolor: 'action.hover' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}><Box sx={{ color: 'primary.main', bgcolor: 'action.selected', borderRadius: 2, p: 1, display: 'flex' }}><CloudOutlined /></Box>
          <Box sx={{ minWidth: 0, flex: 1 }}><Typography fontWeight={600}>{target.name}</Typography><Typography variant="caption" color="text.secondary" noWrap component="div">{target.baseUrl}</Typography></Box>
          <Chip size="small" variant="outlined" label={target.auto ? '每天自动备份' : '手动备份'} />
          <Tooltip title="编辑网盘"><IconButton size="small" disabled={busy} onClick={() => setDraft({ ...target, password: '' })}><EditOutlined fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="移除连接（保留云端备份）"><IconButton size="small" disabled={busy} onClick={() => act(() => window.electronAPI.backup.removeCloud(target.id))}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
        </Box>
        <Typography variant="caption" color={target.error ? 'error.main' : 'text.secondary'} sx={{ display: 'block', mt: 1.5 }}>{target.error || target.warning || (target.lastSuccess ? `上次完成 · ${new Date(target.lastSuccess).toLocaleString()}` : '尚未备份 · 保存连接后即可开始')}</Typography>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}><Button size="small" startIcon={<DownloadRounded />} disabled={!target.lastFile || busy} onClick={() => act(() => window.electronAPI.backup.downloadCloud(target.id))}>下载最近备份</Button><Button size="small" disabled={busy} onClick={() => run([target.id])}>立即备份</Button></Box>
      </Box>)}
    </Stack>
    {targets.length > 0 && <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', gap: 2, alignItems: { xs: 'stretch', sm: 'center' }, mt: 2 }}><Typography variant="caption" color="text.secondary">下载 ZIP 后，可在「数据管理」恢复。自动备份在应用运行时执行。</Typography><Button variant="contained" disableElevation onClick={() => run()} disabled={busy} sx={{ whiteSpace: 'nowrap', flexShrink: 0, alignSelf: 'flex-end' }} startIcon={busy ? <CircularProgress size={16} /> : <BackupOutlined />}>{busy ? '正在备份…' : '备份到所有网盘'}</Button></Box>}
    <Dialog open={Boolean(draft)} onClose={saving ? undefined : () => setDraft(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 4 } }}>
      <DialogTitle>{draft?.id ? '编辑备份网盘' : '添加备份网盘'}</DialogTitle>
      <DialogContent><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>备份独立保存，不会改动主网盘的同步内容。</Typography>
        {draft && <Stack spacing={2} sx={{ pt: .5 }}>{[['name', '网盘名称'], ['baseUrl', 'WebDAV 地址'], ['username', '用户名'], ['password', draft.hasPassword ? '应用密码（留空保留）' : '应用密码'], ['rootPath', '备份文件夹']].map(([key, label]) => <TextField key={key} label={label} size="small" value={draft[key]} type={key === 'password' ? 'password' : 'text'} onChange={e => setDraft({ ...draft, [key]: e.target.value })} fullWidth />)}
          <FormControlLabel control={<Switch checked={draft.auto} onChange={e => setDraft({ ...draft, auto: e.target.checked })} />} label="每天自动备份" />
        </Stack>}
        {message?.severity === 'error' && <Alert severity="error" sx={{ mt: 2 }}>{message.text}</Alert>}
      </DialogContent><DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setDraft(null)} disabled={saving}>取消</Button><Button variant="contained" disableElevation onClick={save} disabled={saving}>{saving ? '保存中…' : '保存连接'}</Button></DialogActions>
    </Dialog>
  </Box>
}
