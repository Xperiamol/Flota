import React, { useState, useEffect, useRef } from 'react';
import { ButtonBase, Chip, LinearProgress, MenuItem, alpha } from '@mui/material';
import { CloudOutlined, MemoryRounded, ShieldOutlined, AudioFileOutlined, DownloadRounded, CheckCircleRounded } from '@mui/icons-material';
import { blobToWav } from '../../utils/audioCodec';
import { useTranslation } from '../../utils/i18n';
import {
  Box,
  Typography,
  TextField,
  Button,
  Switch,
  Alert,
  CircularProgress,
  Link
} from '@mui/material';
import {
  Check as CheckIcon,
  Info as InfoIcon,
  GraphicEq as TranscribeIcon
} from '../common/AppIcons';
import { settingsFieldGroupSx, sectionTitleSx } from '../../styles/commonStyles';

const speechCardSx = theme => ({
  p: { xs: 2, sm: 3 },
  borderRadius: '20px',
  border: `1px solid ${alpha(theme.palette.text.primary, 0.09)}`,
  bgcolor: alpha(theme.palette.background.paper, 0.42),
  backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.035 : 0.5)}, transparent 65%)`,
  boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.05 : 0.8)}`,
});

const STTSettings = ({ showSnackbar }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    enabled: false,
    provider: 'volcengine',
    language: 'auto',
    volcAppId: '',
    volcToken: '',
    volcResourceId: 'volcengine_short_sentence'
  });

  const [testing, setTesting] = useState(false);
  const [testingTranscribe, setTestingTranscribe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [modelStatus, setModelStatus] = useState('');
  const [modelError, setModelError] = useState(false);
  const fileInput = useRef(null);
  useEffect(() => window.electronAPI?.stt?.onModelProgress?.(() => setModelStatus('正在下载并加载模型，请保持网络连接…')), []);
  const prepareOffline = async () => {
    setPreparing(true); setModelError(false); setModelStatus('正在准备离线模型…');
    try {
      const result = await window.electronAPI.stt.prepareOffline();
      if (!result.success) throw new Error(result.error);
      await loadConfig(); setModelStatus('模型已就绪，现在可以断网转写。');
    } catch (e) { setModelError(true); setModelStatus(e.message); }
    finally { setPreparing(false); }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      if (window.electronAPI?.stt) {
        const result = await window.electronAPI.stt.getConfig();
        if (result?.success && result.data) {
          setConfig(result.data);
        }
      }
    } catch (error) {
      console.error('加载STT配置失败:', error);
      if (showSnackbar) showSnackbar(t('stt.loadConfigFailed'), 'error');
    }
  };

  const handleConfigChange = async (field, value) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
    if (['enabled', 'provider', 'language'].includes(field)) {
      await saveConfigToBackend(newConfig);
    }
  };

  const handleTextBlur = async () => {
    await saveConfigToBackend(config);
  };

  const saveConfigToBackend = async (configToSave) => {
    setSaving(true);
    try {
      const result = await window.electronAPI.stt.saveConfig(configToSave);
      if (!result?.success) {
        if (showSnackbar) showSnackbar(result.error || t('stt.saveFailed'), 'error');
      } else {
        if (showSnackbar) showSnackbar(t('stt.configSaved'), 'success');
      }
    } catch (error) {
      console.error('保存STT配置失败:', error);
      if (showSnackbar) showSnackbar(t('stt.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config.volcAppId || !config.volcToken) {
      if (showSnackbar) showSnackbar('请填写 App ID 和 Access Token', 'warning');
      return;
    }
    setTesting(true);
    try {
      const result = await window.electronAPI.stt.testConnection(config);
      if (result?.success) {
        if (showSnackbar) showSnackbar(result.message || t('stt.connectionTestSuccess'), 'success');
      } else {
        if (showSnackbar) showSnackbar(result.error || t('stt.connectionTestFailed'), 'error');
      }
    } catch (error) {
      if (showSnackbar) showSnackbar(error.message || t('stt.connectionTestFailed'), 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleTestTranscribe = async () => {
    if (config.provider === 'offline') { fileInput.current.click(); return; }
    try {
      const result = await window.electronAPI.system.showOpenDialog({
        title: '选择音频文件进行识别测试',
        filters: [{ name: '音频文件', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'webm'] }],
        properties: ['openFile']
      });
      if (result?.canceled || !result?.filePaths?.length) return;
      setTestingTranscribe(true);
      const transcribeResult = await window.electronAPI.stt.transcribe(result.filePaths[0], {});
      if (transcribeResult?.success) {
        const text = transcribeResult.data?.text;
        if (showSnackbar) showSnackbar(text ? `识别结果：${text}` : '识别完成，结果为空', 'success');
      } else {
        if (showSnackbar) showSnackbar(`识别失败：${transcribeResult?.error || '未知错误'}`, 'error');
      }
    } catch (error) {
      if (showSnackbar) showSnackbar(`识别出错：${error.message}`, 'error');
    } finally {
      setTestingTranscribe(false);
    }
  };

  const offline = config.provider === 'offline';
  const ready = config.offline?.ready;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={theme => ({ ...speechCardSx(theme), position: 'relative', overflow: 'hidden',
        backgroundImage: `radial-gradient(ellipse at 100% 0%, ${alpha(theme.palette.primary.main, 0.12)}, transparent 65%)`,
      })}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Box aria-hidden="true" sx={{ display: 'flex', alignItems: 'center', gap: '3px', height: 32, mb: 2, color: 'primary.main' }}>
              {[10, 18, 28, 16, 32, 22, 12, 26, 18, 8, 16, 24, 12].map((height, i) => <Box key={i} sx={{ width: 4, height, borderRadius: 2, bgcolor: 'currentColor', opacity: 0.4 + (i % 3) * 0.25 }} />)}
            </Box>
            <Typography variant="h5" sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 750, letterSpacing: '-0.04em' }}>让声音，成为文字。</Typography>

          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <Typography variant="caption" color="text.secondary">{config.enabled ? '已开启' : '未开启'}</Typography>
            <Switch checked={config.enabled} onChange={e => handleConfigChange('enabled', e.target.checked)} slotProps={{ input: { 'aria-label': '启用语音转文字' } }} />
          </Box>
        </Box>
      </Box>

      <Box>
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontWeight: 650, mb: 1 }}>识别方式</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          {[
            { value: 'offline', title: '本机离线', description: '无需密钥 · 音频留在本机', icon: <MemoryRounded /> },
            { value: 'volcengine', title: '云端识别', description: '火山引擎 · 使用你的服务凭据', icon: <CloudOutlined /> },
          ].map(mode => {
            const selected = (config.provider || 'volcengine') === mode.value;
            return <ButtonBase key={mode.value} aria-pressed={selected} onClick={() => handleConfigChange('provider', mode.value)} sx={theme => ({
              ...speechCardSx(theme), p: 2, display: 'flex', justifyContent: 'flex-start', textAlign: 'left', gap: 1.5,
              borderRadius: '16px', borderColor: selected ? alpha(theme.palette.primary.main, 0.45) : alpha(theme.palette.text.primary, 0.09),
              bgcolor: selected ? alpha(theme.palette.primary.main, 0.07) : 'transparent',
              transition: 'background-color 160ms, border-color 160ms',
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, selected ? 0.11 : 0.04) },
              '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 3 },
            })}>
              <Box sx={{ display: 'flex', p: 1, borderRadius: '12px', bgcolor: selected ? 'primary.main' : 'action.hover', color: selected ? 'primary.contrastText' : 'text.secondary' }}>{mode.icon}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontSize: 14, fontWeight: 700 }}>{mode.title}</Typography><Typography sx={{ mt: 0.5, fontSize: 12, color: 'text.secondary' }}>{mode.description}</Typography></Box>
              {selected && <CheckCircleRounded sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />}
            </ButtonBase>;
          })}
        </Box>
      </Box>

      {offline && <Box sx={speechCardSx}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
          <Box><Typography sx={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.025em' }}>Whisper</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>轻量离线语音模型</Typography></Box>
          <Chip size="small" icon={ready ? <CheckCircleRounded /> : <DownloadRounded />} label={preparing ? '正在准备' : ready ? '模型已就绪' : '等待下载'} color={ready ? 'success' : 'default'} sx={{ borderRadius: '8px', fontSize: 11, height: 26 }} />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2, lineHeight: 1.8 }}>支持中文、英文等语言。首次从 Hugging Face 下载模型，之后即可断网识别。</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, color: 'text.secondary' }}><ShieldOutlined sx={{ fontSize: 15 }} /><Typography variant="caption">录音不上传，也不会自动切换到云端。</Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', my: 2.5, py: 2, borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Box><Typography sx={{ fontSize: 13, fontWeight: 650 }}>识别语言</Typography><Typography variant="caption" color="text.secondary">选择录音中使用的语言</Typography></Box>
          <TextField select size="small" value={config.language || 'auto'} onChange={e => handleConfigChange('language', e.target.value)} sx={{ minWidth: 156 }} slotProps={{ select: { inputProps: { 'aria-label': '识别语言' } } }}>
            <MenuItem value="auto">自动识别</MenuItem><MenuItem value="chinese">中文</MenuItem><MenuItem value="english">English</MenuItem>
          </TextField>
        </Box>
        {preparing && <LinearProgress sx={{ mb: 1.5, borderRadius: 2 }} />}
        {modelStatus && <Alert severity={modelError ? 'error' : preparing ? 'info' : 'success'} sx={{ mb: 2 }} role="status">{modelStatus}</Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">{!config.enabled ? '开启上方开关后即可转写' : ready ? '一切就绪，选一段录音试试' : '下载完成后即可离线使用'}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant={ready ? 'text' : 'contained'} disableElevation startIcon={preparing ? <CircularProgress size={15} color="inherit" /> : !ready ? <DownloadRounded /> : undefined} onClick={prepareOffline} disabled={preparing}>{preparing ? '准备中…' : ready ? '检查模型' : '下载离线模型'}</Button>
            {ready && <Button variant="contained" disableElevation startIcon={testingTranscribe ? <CircularProgress size={15} color="inherit" /> : <AudioFileOutlined />} onClick={handleTestTranscribe} disabled={!config.enabled || preparing || testingTranscribe}>{testingTranscribe ? '识别中…' : '选择音频试一试'}</Button>}
          </Box>
        </Box>
        <input hidden type="file" accept="audio/*" ref={fileInput} onChange={async e => {
          const file = e.target.files[0]; e.target.value = ''; if (!file) return;
          setTestingTranscribe(true);
          try {
            const result = await window.electronAPI.stt.transcribe(await blobToWav(file));
            showSnackbar?.(result.success ? result.data.text || '未识别到语音' : result.error, result.success ? 'success' : 'error');
          } catch (err) { showSnackbar?.(err.message, 'error'); }
          finally { setTestingTranscribe(false); }
        }} />
      </Box>}

      {!offline && <>
      <Box sx={speechCardSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}><CloudOutlined color="primary" /><Typography variant="subtitle1" sx={{ ...sectionTitleSx, mb: 0 }}>火山引擎配置</Typography></Box>

        <Box sx={settingsFieldGroupSx}>
          <TextField
            fullWidth
            size="small"
            label="App ID"
            value={config.volcAppId}
            onChange={(e) => handleConfigChange('volcAppId', e.target.value)}
            onBlur={handleTextBlur}
            placeholder="控制台获取的应用 ID"
            helperText={(
              <Link
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (window.electronAPI?.system) {
                    window.electronAPI.system.openExternal('https://console.volcengine.com/speech/service/8');
                  }
                }}
              >
                前往火山引擎控制台获取
              </Link>
            )}
          />
        </Box>
        <Box sx={settingsFieldGroupSx}>
          <TextField
            fullWidth
            size="small"
            label="Access Token"
            type="password"
            value={config.volcToken}
            onChange={(e) => handleConfigChange('volcToken', e.target.value)}
            onBlur={handleTextBlur}
            placeholder="控制台获取的令牌"
          />
        </Box>
        <Box sx={settingsFieldGroupSx}>
          <TextField
            fullWidth
            size="small"
            label="Cluster ID"
            value={config.volcResourceId}
            onChange={(e) => handleConfigChange('volcResourceId', e.target.value)}
            onBlur={handleTextBlur}
            placeholder="volcengine_short_sentence"
            helperText="在控制台开通「一句话识别」服务后获取的 Cluster ID（如 volcengine_short_sentence）"
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, pt: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleTestTranscribe}
            disabled={!config.volcAppId || !config.volcToken || testingTranscribe}
            startIcon={testingTranscribe ? <CircularProgress size={16} /> : <TranscribeIcon />}
          >
            {testingTranscribe ? '识别中...' : '测试识别'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={handleTestConnection}
            disabled={!config.volcAppId || !config.volcToken || testing}
            startIcon={testing ? <CircularProgress size={16} /> : <CheckIcon />}
          >
            {testing ? t('stt.testing') : t('stt.testConnection')}
          </Button>
        </Box>
      </Box>

      <Alert severity="info" icon={<InfoIcon />} sx={{ borderRadius: '16px' }}>
        <Typography variant="body2" gutterBottom>
          <strong>{t('stt.usageInstructions')}：</strong>
        </Typography>
        <Typography variant="body2" component="div">
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {t('stt.usageInstructionsList', { returnObjects: true }).map((item, index) => (
              <Box component="li" key={index}>
                {item}
              </Box>
            ))}
          </Box>
        </Typography>
      </Alert>
      </>}
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }} aria-live="polite">{saving ? '正在保存…' : '更改自动保存'}</Typography>
    </Box>
  );
};

export default STTSettings;
