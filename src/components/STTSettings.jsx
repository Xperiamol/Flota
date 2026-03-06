import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import {
  Box,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Alert,
  Divider,
  CircularProgress,
  Link,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction
} from '@mui/material';
import {
  Check as CheckIcon,
  Info as InfoIcon,
  GraphicEq as TranscribeIcon
} from '@mui/icons-material';

const STTSettings = ({ showSnackbar }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    enabled: false,
    volcAppId: '',
    volcToken: '',
    volcResourceId: 'volcengine_short_sentence'
  });

  const [testing, setTesting] = useState(false);
  const [testingTranscribe, setTestingTranscribe] = useState(false);
  const [saving, setSaving] = useState(false);

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
    if (field === 'enabled') {
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

  return (
    <Box>
      <List>
        {/* STT 功能开关 */}
        <ListItem>
          <ListItemText
            primary={t('stt.speechToTextFeature')}
            secondary={t('stt.speechToTextDesc')}
          />
          <ListItemSecondaryAction>
            <Switch
              checked={config.enabled}
              onChange={(e) => handleConfigChange('enabled', e.target.checked)}
              color="primary"
            />
          </ListItemSecondaryAction>
        </ListItem>

        <Divider />

        {/* 火山引擎配置 */}
        <ListItem>
          <Box sx={{ width: '100%', pt: 1, pb: 1 }}>
            <TextField
              fullWidth
              size="small"
              label="App ID"
              value={config.volcAppId}
              onChange={(e) => handleConfigChange('volcAppId', e.target.value)}
              onBlur={handleTextBlur}
              placeholder="控制台获取的应用 ID"
              helperText={
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
              }
            />
          </Box>
        </ListItem>
        <Divider />
        <ListItem>
          <Box sx={{ width: '100%', pt: 1, pb: 1 }}>
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
        </ListItem>
        <Divider />
        <ListItem>
          <Box sx={{ width: '100%', pt: 1, pb: 1 }}>
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
        </ListItem>

        <Divider />

        {/* 操作按钮 */}
        <ListItem>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, pt: 1, pb: 1, width: '100%' }}>
            <Box sx={{ flex: 1 }} />
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
        </ListItem>
      </List>

      {/* 使用说明 */}
      <Alert severity="info" icon={<InfoIcon />} sx={{ mt: 3 }}>
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
    </Box>
  );
};

export default STTSettings;
