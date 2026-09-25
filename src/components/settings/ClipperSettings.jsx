import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, ListItemText, MenuItem, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import { CheckCircle, DeleteOutline, FolderOpenRounded, WifiOff } from '../common/AppIcons';
import { notifyError, notifySuccess, confirmAction, promptInput } from '../../utils/notify';
import { settingsRowSx, settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../../styles/commonStyles';

const formatTime = (value) => (value ? new Date(value).toLocaleString() : '—');

const Row = ({ primary, secondary, children }) => (
  <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2 })}>
    <ListItemText primary={primary} secondary={secondary} sx={{ minWidth: 0 }}
      slotProps={{ primary: { sx: { fontWeight: 650 } }, secondary: { sx: { wordBreak: 'break-all' } } }} />
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, whiteSpace: 'nowrap' }}>{children}</Box>
  </Box>
);

/**
 * 设置 → 网页剪藏：本地接收服务状态、浏览器扩展配对、剪藏偏好。
 */
export default function ClipperSettings() {
  const [status, setStatus] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const result = await window.electronAPI?.clipper?.status();
    if (result?.success) {
      setStatus(result.data);
      if (result.data.pairing) setPairing(result.data.pairing);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 配对码倒计时；配对成功后设备列表会变化，定时刷新状态
  useEffect(() => {
    if (!pairing) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
      load();
    }, 2000);
    return () => clearInterval(timer);
  }, [pairing, load]);

  useEffect(() => {
    if (pairing && pairing.expiresAt <= now) setPairing(null);
  }, [pairing, now]);

  const createCode = async () => {
    const result = await window.electronAPI.clipper.createPairingCode();
    if (!result?.success) return notifyError(result?.error || '生成配对码失败');
    setPairing(result.data);
    setNow(Date.now());
  };

  const revoke = async (client) => {
    const ok = await confirmAction({ title: '取消配对', message: `取消与「${client.name}」的配对？该设备需要重新配对才能继续剪藏。`, confirmText: '取消配对' });
    if (!ok) return;
    await window.electronAPI.clipper.revokeClient(client.id);
    load();
  };

  const saveSetting = async (patch) => {
    const result = await window.electronAPI.clipper.saveSettings(patch);
    if (!result?.success) return notifyError(result?.error || '保存失败');
    setStatus((current) => ({ ...current, settings: result.data }));
  };

  const openExtensionFolder = async () => {
    const result = await window.electronAPI.clipper.openExtensionFolder();
    if (!result?.success) notifyError(result?.error || '打开目录失败');
  };

  if (!status) return null;
  const settings = status.settings || {};
  const secondsLeft = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;
  const categoryNames = [...new Set([settings.defaultCategory, '剪藏', ...(status.categories || [])].filter(Boolean))];

  return (
    <Box>
      <Box sx={settingsSectionSx}>
        <Typography variant="h6" sx={sectionTitleSx}>网页剪藏</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          通过 Flota 浏览器扩展，把网页全文、选中内容或书签剪藏为笔记。图片会下载到本地，同一链接不会重复保存。
        </Typography>
        {!status.pluginEnabled && (
          <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2 }}>
            “网页剪藏”插件未启用，浏览器扩展暂时无法发送内容。请在插件中心启用它。
          </Alert>
        )}
        <Row
          primary="本地接收服务"
          secondary={status.running ? `运行中 · 127.0.0.1:${status.port}（只接受本机的浏览器扩展）` : '未启动：端口 47831–47835 可能都被占用'}
        >
          {status.running ? <CheckCircle color="success" /> : <WifiOff color="disabled" />}
        </Row>
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>安装浏览器扩展</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 1.5 }}>
          支持 Chrome、Edge 等 Chromium 浏览器：打开 chrome://extensions，开启“开发者模式”，点击“加载已解压的扩展程序”，选择下面的扩展目录。
        </Typography>
        <Row primary="扩展目录" secondary={status.extensionDir}>
          <Button size="small" startIcon={<FolderOpenRounded />} onClick={openExtensionFolder}>打开目录</Button>
        </Row>
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>配对</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 1.5 }}>
          在扩展弹窗中输入配对码。配对码 5 分钟内有效，只能使用一次。
        </Typography>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2 })}>
          {pairing ? (
            <>
              <Typography sx={{ fontSize: 30, fontWeight: 700, letterSpacing: 8, fontFamily: 'ui-monospace, Menlo, monospace', color: 'primary.main' }}>
                {pairing.code}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{secondsLeft} 秒后失效</Typography>
              <Button size="small" onClick={createCode}>重新生成</Button>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>生成一个配对码，在浏览器扩展中输入完成配对</Typography>
              <Button variant="contained" size="small" disabled={!status.running} onClick={createCode}>生成配对码</Button>
            </>
          )}
        </Box>
        {(status.clients || []).map((client) => (
          <Row key={client.id} primary={client.name} secondary={`配对于 ${formatTime(client.createdAt)} · 最近使用 ${formatTime(client.lastUsedAt)}`}>
            <Chip size="small" color="success" variant="outlined" label="已配对" />
            <Tooltip title="取消配对">
              <IconButton size="small" onClick={() => revoke(client)}><DeleteOutline fontSize="small" /></IconButton>
            </Tooltip>
          </Row>
        ))}
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>剪藏偏好</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 1.5 }}>
          扩展中没有单独指定时，使用这里的默认设置。
        </Typography>
        <Row primary="默认分类" secondary="剪藏的笔记放到这个分类，可以随时移动">
          <TextField select size="small" value={settings.defaultCategory || '剪藏'} sx={{ minWidth: 160 }}
            onChange={(event) => saveSetting({ defaultCategory: event.target.value })}>
            {categoryNames.map((name) => <MenuItem key={name} value={name}>{name === 'default' ? '默认' : name}</MenuItem>)}
          </TextField>
        </Row>
        <Row primary="AI 摘要" secondary="在笔记开头生成 3–5 条要点（需要已配置 AI，会消耗额度）">
          <Switch checked={Boolean(settings.aiSummary)} onChange={(event) => saveSetting({ aiSummary: event.target.checked })} />
        </Row>
        <Row primary="AI 自动标签" secondary="根据内容补充标签，优先复用已有标签">
          <Switch checked={Boolean(settings.aiTags)} onChange={(event) => saveSetting({ aiTags: event.target.checked })} />
        </Row>
        <Row primary="创建阅读待办" secondary="每次剪藏同时创建一条“阅读：标题”待办">
          <Switch checked={Boolean(settings.createTodo)} onChange={(event) => saveSetting({ createTodo: event.target.checked })} />
        </Row>
      </Box>
    </Box>
  );
}

/** 应用内剪藏：命令面板“剪藏网页链接”调用 */
export const clipUrlFromApp = async () => {
  const url = await promptInput({ title: '剪藏网页链接', message: '粘贴网页链接，Flota 会抓取正文并保存为笔记（公众号等需要登录的页面建议用浏览器扩展）。', placeholder: 'https://', confirmText: '剪藏' });
  if (!url) return null;
  const result = await window.electronAPI.clipper.clipUrl(url.trim());
  if (!result?.success) {
    notifyError(result?.error || '剪藏失败');
    return null;
  }
  const { data } = result;
  notifySuccess(data.duplicate ? `这个链接已经剪藏过：${data.title}` : `已剪藏：${data.title}`);
  return data;
};
