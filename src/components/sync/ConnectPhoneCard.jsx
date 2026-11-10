import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogContent, DialogTitle, FormControlLabel, IconButton, Paper, Typography,
} from '@mui/material';
import { Close } from '../common/AppIcons';
import { notifyError } from '../../utils/notify';

const SHOW_SECONDS = 60;

/**
 * 云同步 → 连接手机：把这台电脑的同步账号做成二维码，手机版「同步设置 → 扫码连接电脑」扫一下就配好。
 * 二维码里有同步密码（可选还有 AI Key），所以默认模糊，点一下才显示，一分钟后自动收起。
 */
export default function ConnectPhoneCard({ disabled, hideWhenUnavailable = false, sx, wrapperSx }) {
  const [open, setOpen] = useState(false);
  // 没传 disabled 时自己看同步账号有没有保存密码（同步总览页用）
  const [configured, setConfigured] = useState(disabled === undefined ? null : !disabled);
  useEffect(() => {
    if (disabled !== undefined) return setConfigured(!disabled);
    window.electronAPI?.sync?.getConfig?.().then((result) => {
      const status = result?.success === false ? null : (result?.data || result);
      setConfigured(Boolean(status?.config?.hasSavedPassword && status?.config?.username));
    });
    return undefined;
  }, [disabled]);
  if (hideWhenUnavailable && !configured) return null;
  if (wrapperSx) return <Box sx={wrapperSx}><ConnectPhoneCard disabled={!configured} sx={sx} /></Box>;

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>连接手机</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            手机版 Flota 扫一下二维码，同步账号就自动填好，不用再输入地址和密码
          </Typography>
        </Box>
        <Button size="small" variant="contained" disabled={!configured} onClick={() => setOpen(true)}>显示二维码</Button>
      </Box>
      {open && <ConnectPhoneDialog onClose={() => setOpen(false)} />}
    </Paper>
  );
}

function ConnectPhoneDialog({ onClose }) {
  const [includeAI, setIncludeAI] = useState(false);
  const [data, setData] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(SHOW_SECONDS);
  const timer = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    window.electronAPI.sync.connectQr({ includeAI }).then((result) => {
      if (cancelled) return;
      if (!result?.success) {
        notifyError(result?.error || '生成二维码失败');
        closeRef.current();
        return;
      }
      setData(result.data);
    });
    return () => { cancelled = true; };
  }, [includeAI]);

  // 显示后倒计时，到点自动模糊
  useEffect(() => {
    clearInterval(timer.current);
    if (!revealed) return undefined;
    setLeft(SHOW_SECONDS);
    timer.current = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          setRevealed(false);
          return SHOW_SECONDS;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer.current);
  }, [revealed]);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        连接手机
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          在手机版 Flota 打开 <b>设置 → 同步 → 扫码连接电脑</b>，对准下面的二维码。
        </Typography>

        <Box
          onClick={() => setRevealed(true)}
          sx={{
            position: 'relative', mx: 'auto', width: 240, height: 240, borderRadius: 2, overflow: 'hidden',
            bgcolor: '#fff', cursor: revealed ? 'default' : 'pointer', border: '1px solid', borderColor: 'divider',
          }}
        >
          {data && (
            <Box component="img" src={data.qr} alt="同步二维码"
              sx={{ width: '100%', height: '100%', display: 'block', filter: revealed ? 'none' : 'blur(14px)', transition: 'filter 200ms ease' }} />
          )}
          {!revealed && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: 'rgba(0,0,0,0.25)' }}>
              <Typography sx={{ color: '#fff', fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {data ? '点击显示二维码' : '正在生成…'}
              </Typography>
            </Box>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1, minHeight: 20 }}>
          {revealed ? `${left} 秒后自动隐藏` : data ? `账号：${data.username}` : ''}
        </Typography>

        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox size="small" checked={includeAI} onChange={(event) => { setRevealed(false); setIncludeAI(event.target.checked); }} />}
          label={<Typography variant="body2">同时带上 AI 设置（服务商、接口地址、API Key）</Typography>}
        />
        {includeAI && data?.aiSkippedReason && (
          <Alert severity="info" sx={{ mt: 1, borderRadius: 2 }}>AI 设置没有带上：{data.aiSkippedReason}。手机上需要单独填写。</Alert>
        )}
        <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 2 }}>
          二维码里包含同步密码{includeAI && data?.aiIncluded ? '和 AI Key' : ''}，只给自己的手机扫，不要截图或发给别人。
        </Alert>
      </DialogContent>
    </Dialog>
  );
}
