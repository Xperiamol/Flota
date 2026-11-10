import { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, Chip, Collapse, Typography } from '@mui/material';
import { CheckCircle, ContentCopy, ExpandMore, FolderOpenRounded, OpenInNew } from '../common/AppIcons';
import { notifyError, notifySuccess } from '../../utils/notify';
import { sectionDescriptionSx, sectionTitleSx } from '../../styles/commonStyles';

const OPEN_KEY = 'flota.clipper.installGuideOpen';
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
const fileManager = isMac ? '访达' : '文件夹';

/**
 * 扩展上架应用商店后填这里，指引最上面会出现「一键安装」按钮（商店页点「添加」即可，不需要开发者模式）。
 * 例：{ chrome: 'https://chromewebstore.google.com/detail/...', edge: 'https://microsoftedge.microsoft.com/addons/detail/...' }
 */
const STORE_URLS = {};

function Step({ index, done, title, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, py: 1.25 }}>
      <Box sx={(theme) => ({
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, mt: '1px',
        display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
        color: done ? theme.palette.success.contrastText : theme.palette.text.secondary,
        bgcolor: done ? theme.palette.success.main : theme.palette.action.selected,
      })}
      >
        {done ? <CheckCircle sx={{ fontSize: 16 }} /> : index}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 650, mb: children ? 0.5 : 0 }}>{title}</Typography>
        {children}
      </Box>
    </Box>
  );
}

const Hint = ({ children }) => (
  <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.6 }}>{children}</Typography>
);

/**
 * 设置 → 网页剪藏 → 安装浏览器扩展：可以收起的分步指引。
 * 还没配对时默认展开；配对成功后显示「已连接」并默认收起，需要时可以再展开（在别的浏览器里也装一个）。
 */
export default function ClipperInstallGuide({ status, onPairClick }) {
  const paired = (status.clients || []).length > 0;
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(OPEN_KEY);
    return saved == null ? !paired : saved === '1';
  });
  const [browsers, setBrowsers] = useState(null);
  const [opened, setOpened] = useState(null);

  useEffect(() => {
    window.electronAPI?.clipper?.listBrowsers?.().then((result) => setBrowsers(result?.success ? result.data : []));
  }, []);

  const toggle = () => setOpen((value) => {
    localStorage.setItem(OPEN_KEY, value ? '0' : '1');
    return !value;
  });

  const openIn = async (browser) => {
    const result = await window.electronAPI.clipper.openBrowserExtensions(browser.id);
    if (!result?.success) return notifyError(result?.error || `打不开 ${browser.name}`);
    setOpened(browser);
    notifySuccess(`已在 ${browser.name} 打开扩展页，文件夹路径已复制`);
  };
  const copyPath = async () => {
    const result = await window.electronAPI.clipper.copyExtensionPath();
    if (result?.success) notifySuccess('路径已复制');
  };
  const copyUrl = (url) => navigator.clipboard?.writeText(url).then(() => notifySuccess(`已复制 ${url}，粘贴到浏览器地址栏打开`));
  const openFolder = async () => {
    const result = await window.electronAPI.clipper.openExtensionFolder();
    if (!result?.success) notifyError(result?.error || '打开文件夹失败');
  };

  const stores = Object.entries(STORE_URLS).filter(([, url]) => url);
  const pageUrl = opened?.url || browsers?.[0]?.url || 'chrome://extensions';

  return (
    <Box>
      <ButtonBase onClick={toggle} sx={{ width: '100%', justifyContent: 'flex-start', borderRadius: 1.5, py: 0.5, gap: 1 }}>
        <Typography variant="subtitle1" sx={{ ...sectionTitleSx, mb: 0, flex: 'none' }}>安装浏览器扩展</Typography>
        {paired
          ? <Chip size="small" color="success" variant="outlined" icon={<CheckCircle />} label="已连接" />
          : <Chip size="small" variant="outlined" label="约 1 分钟" />}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">{open ? '收起' : '展开指引'}</Typography>
        <ExpandMore sx={{ fontSize: 20, color: 'text.secondary', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
      </ButtonBase>
      {!open && (
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mt: 0.5 }}>
          {paired ? '已连接。要在其他浏览器安装，展开查看步骤。' : '支持 Chrome、Edge 等浏览器，展开查看安装步骤。'}
        </Typography>
      )}

      <Collapse in={open} unmountOnExit>

        {stores.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {stores.map(([id, url]) => (
              <Button key={id} variant="contained" size="small" startIcon={<OpenInNew />} onClick={() => window.open(url, '_blank')}>
                一键安装（{id === 'edge' ? 'Edge' : 'Chrome'} 商店）
              </Button>
            ))}
          </Box>
        )}

        <Box sx={{ mt: 0.5 }}>
          <Step index={1} done={Boolean(opened)} title="在浏览器里打开扩展管理页">
            {browsers?.length ? (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', my: 0.5 }}>
                  {browsers.map((browser) => (
                    <Button key={browser.id} size="small" variant={opened?.id === browser.id ? 'contained' : 'outlined'} onClick={() => openIn(browser)}>
                      在 {browser.name} 中打开
                    </Button>
                  ))}
                </Box>
                <Hint>没反应的话，在浏览器地址栏输入 <b>{pageUrl}</b> 回车。<Box component="span" onClick={() => copyUrl(pageUrl)} sx={{ color: 'primary.main', cursor: 'pointer', ml: 0.5 }}>复制地址</Box></Hint>
              </>
            ) : (
              <Hint>
                在浏览器地址栏输入 <b>chrome://extensions</b>（Edge 是 edge://extensions）回车。
                <Box component="span" onClick={() => copyUrl('chrome://extensions')} sx={{ color: 'primary.main', cursor: 'pointer', ml: 0.5 }}>复制地址</Box>
              </Hint>
            )}
          </Step>

          <Step index={2} title="打开「开发者模式」">
            <Hint>Chrome 在扩展页右上角，Edge 在左侧栏底部。打开后页面上会多出「加载已解压的扩展程序」按钮。</Hint>
          </Step>

          <Step index={3} title="拖入扩展文件夹">
            <Hint>
              点「在{fileManager}中显示」，把 <b>flota-clipper</b> 文件夹拖到扩展页即可；或点「加载已解压的扩展程序」，{isMac ? '按 ⌘⇧G 粘贴路径' : '在地址栏粘贴路径'}选择。
            </Hint>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
              <Button size="small" startIcon={<FolderOpenRounded />} onClick={openFolder}>在{fileManager}中显示</Button>
              <Button size="small" startIcon={<ContentCopy />} onClick={copyPath}>复制路径</Button>
            </Box>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5, wordBreak: 'break-all' }}>{status.extensionDir}</Typography>
          </Step>

          <Step index={4} done={paired} title={paired ? '已连接 Flota' : '和 Flota 配对'}>
            <Hint>
              {paired
                ? '在网页上点工具栏的 Flota 图标或右键即可剪藏。'
                : '点浏览器工具栏的 Flota 图标（在拼图图标里可以固定出来），输入配对码。'}
            </Hint>
            {!paired && onPairClick && (
              <Button size="small" variant="contained" sx={{ mt: 0.75 }} disabled={!status.running} onClick={onPairClick}>生成配对码</Button>
            )}
          </Step>
        </Box>
      </Collapse>
    </Box>
  );
}
