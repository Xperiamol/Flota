import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Paper, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { notifyError } from '../../utils/notify';
import { settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../../styles/commonStyles';

const SHOW_SECONDS = 60;
const PARTS = [
  { id: 'sync', title: '同步账号', hint: '连上后笔记、待办和组件会自动同步' },
  { id: 'ai', title: 'AI 设置', hint: '服务商、接口地址、API Key 和模型' },
  { id: 'stt', title: '语音转文字', hint: '火山引擎语音识别' },
];

function QrBox({ src, revealed, onReveal, size = 220, placeholder }) {
  return (
    <Box
      onClick={onReveal}
      sx={{
        position: 'relative', width: size, height: size, borderRadius: 2, overflow: 'hidden', flexShrink: 0,
        bgcolor: '#fff', border: '1px solid', borderColor: 'divider', cursor: revealed ? 'default' : 'pointer',
      }}
    >
      {src && (
        <Box component="img" src={src} alt="二维码"
          sx={{ width: '100%', height: '100%', display: 'block', filter: revealed ? 'none' : 'blur(14px)', transition: 'filter 200ms ease' }} />
      )}
      {!revealed && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: src ? 'rgba(0,0,0,0.25)' : 'transparent', p: 2, textAlign: 'center' }}>
          <Typography sx={{ color: src ? '#fff' : 'text.secondary', fontWeight: 600, fontSize: 14, textShadow: src ? '0 1px 4px rgba(0,0,0,0.5)' : 'none' }}>
            {placeholder}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

const StepTitle = ({ index, children }) => (
  <Typography variant="subtitle1" sx={{ ...sectionTitleSx, display: 'flex', alignItems: 'center', gap: 1 }}>
    <Box component="span" sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>
      {index}
    </Box>
    {children}
  </Typography>
);

/**
 * 设置 → 连接手机：两步把电脑上的 Flota 搬到手机。
 *   1. 扫码下载手机版；
 *   2. 手机版「设置 → 同步 → 扫码连接电脑」扫这里的二维码，勾选的设置（同步账号 / AI / 语音转文字）自动填好。
 * 普通偏好会随同步自动过去，这里只带同步不会传的账号和密钥。二维码默认模糊，点开一分钟后自动隐藏。
 */
export default function ConnectPhoneSettings() {
  const [download, setDownload] = useState(null);
  const [options, setOptions] = useState(null);
  const [selected, setSelected] = useState({ sync: true, ai: false, stt: false });
  const [qr, setQr] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(SHOW_SECONDS);
  const timer = useRef(null);

  const loadOptions = useCallback(async () => {
    const result = await window.electronAPI?.sync?.connectOptions?.();
    if (result?.success) setOptions(result.data);
  }, []);

  useEffect(() => {
    window.electronAPI?.sync?.phoneDownloadQr?.().then((result) => result?.success && setDownload(result.data));
    loadOptions();
    window.addEventListener('focus', loadOptions);
    return () => window.removeEventListener('focus', loadOptions);
  }, [loadOptions]);

  const chosen = (id) => Boolean(selected[id] && options?.[id]?.available);
  const key = PARTS.map((part) => (chosen(part.id) ? part.id : '')).join(',');

  useEffect(() => {
    if (!options) return undefined;
    let cancelled = false;
    setRevealed(false);
    window.electronAPI.sync.connectQr({ sync: chosen('sync'), ai: chosen('ai'), stt: chosen('stt') }).then((result) => {
      if (cancelled) return;
      if (!result?.success) return notifyError(result?.error || '生成二维码失败');
      setQr(result.data.qr);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, Boolean(options)]);

  // 显示后倒计时，到点自动模糊；离开页面也不留着
  useEffect(() => {
    clearInterval(timer.current);
    if (!revealed) return undefined;
    setLeft(SHOW_SECONDS);
    timer.current = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) { setRevealed(false); return SHOW_SECONDS; }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer.current);
  }, [revealed]);

  const goToCloudSync = () => useStore.getState().setSettingsTabValue?.(6);
  const anyChosen = PARTS.some((part) => chosen(part.id));

  return (
    <Box>
      <Box sx={settingsSectionSx}>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx }}>
          装上安卓版 Flota，扫码就能把这台电脑的同步账号和 AI 设置填进手机。
        </Typography>
      </Box>

      <Box sx={settingsSectionSx}>
        <StepTitle index={1}>下载手机版</StepTitle>
        <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'center', mt: 1 }}>
          <QrBox src={download?.qr} revealed size={150} placeholder="正在生成…" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2">用手机扫一扫下载安卓安装包。</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, wordBreak: 'break-all' }}>{download?.url}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              微信里打不开的话，点右上角「在浏览器中打开」。
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={settingsSectionSx}>
        <StepTitle index={2}>扫码连接</StepTitle>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 1 }}>
          在手机版打开 <b>设置 → 同步 → 扫码连接电脑</b>，勾选要带过去的项：
        </Typography>

        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Box sx={{ flex: '1 1 300px', minWidth: 0 }}>
            {PARTS.map((part) => {
              const option = options?.[part.id];
              const available = Boolean(option?.available);
              return (
                <Paper key={part.id} elevation={0}
                  onClick={() => available && setSelected((value) => ({ ...value, [part.id]: !value[part.id] }))}
                  sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1.25, mb: 1, borderRadius: 1.5, border: '1px solid', borderColor: chosen(part.id) ? 'primary.main' : 'divider', cursor: available ? 'pointer' : 'default', opacity: available ? 1 : 0.6 }}
                >
                  <Checkbox size="small" checked={chosen(part.id)} disabled={!available} sx={{ p: 0.25, mt: '-1px' }} tabIndex={-1} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {part.title}
                      {available && (option.username || option.label) && (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{option.username || option.label}</Typography>
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {available ? part.hint : option?.reason || '正在检查…'}
                    </Typography>
                    {!available && part.id === 'sync' && options && (
                      <Button size="small" sx={{ mt: 0.5, px: 0 }} onClick={(event) => { event.stopPropagation(); goToCloudSync(); }}>去设置云同步</Button>
                    )}
                  </Box>
                </Paper>
              );
            })}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <QrBox
              src={anyChosen ? qr : null}
              revealed={revealed && anyChosen && Boolean(qr)}
              onReveal={() => anyChosen && qr && setRevealed(true)}
              placeholder={!anyChosen ? '至少选择一项' : qr ? '点击显示二维码' : '正在生成…'}
            />
            <Typography variant="caption" color="text.secondary" sx={{ minHeight: 20 }}>
              {revealed && anyChosen ? `${left} 秒后自动隐藏` : ''}
            </Typography>
          </Box>
        </Box>

        <Alert severity="warning" sx={{ mt: 1, borderRadius: 2 }}>
          二维码里有密码和密钥，不要截图发给别人。主题等其他设置连上同步后会自动同步。
        </Alert>
      </Box>
    </Box>
  );
}
