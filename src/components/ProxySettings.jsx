import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import { useError } from './ErrorProvider';
import {
  Box,
  Typography,
  TextField,
  Button,
  Switch,
  Alert,
  ListItemText,
  Chip,
} from '@mui/material';
import { CheckCircle, WifiOff } from '@mui/icons-material';
import { flex, settingsFieldGroupSx, settingsRowSx, settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../styles/commonStyles';
import logger from '../utils/logger';

const ProxySettings = ({ showSnackbar }) => {
  const { t } = useTranslation();
  const { showError, showSuccess } = useError();
  const [config, setConfig] = useState({
    enabled: false,
    host: '127.0.0.1',
    port: '7890',
    protocol: 'http',
  });

  const [testing, setTesting] = useState(false);

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const result = await window.electronAPI.invoke('proxy:get-config');
      logger.log('[ProxySettings] 收到配置:', result);
      if (result.success && result.data) {
        // 确保 protocol 是字符串
        const normalizedConfig = {
          ...result.data,
          protocol: typeof result.data.protocol === 'string' 
            ? result.data.protocol 
            : 'http'
        };
        logger.log('[ProxySettings] 标准化配置:', normalizedConfig);
        setConfig(normalizedConfig);
      }
    } catch (error) {
      console.error('加载代理配置失败:', error);
      showError(error, '加载代理配置失败');
    }
  };

  // 保存配置
  const handleSave = async () => {
    try {
      // 确保发送的数据格式正确
      const configToSave = {
        enabled: config.enabled,
        protocol: typeof config.protocol === 'string' ? config.protocol : 'http',
        host: config.host,
        port: config.port
      };
      logger.log('[ProxySettings] 保存配置:', configToSave);
      
      const result = await window.electronAPI.invoke('proxy:save-config', configToSave);

      if (result.success) {
        if (showSnackbar) showSnackbar(t('proxy.configSaved'), 'success');
      } else {
        if (showSnackbar) showSnackbar(result.error || t('proxy.saveFailed'), 'error');
      }
    } catch (error) {
      if (showSnackbar) showSnackbar(error.message, 'error');
    }
  };

  // 测试代理
  const handleTest = async () => {
    setTesting(true);
    if (showSnackbar) showSnackbar(t('proxy.testingConnection'), 'info');

    try {
      // 确保发送的数据格式正确
      const configToTest = {
        enabled: config.enabled,
        protocol: typeof config.protocol === 'string' ? config.protocol : 'http',
        host: config.host,
        port: config.port
      };
      logger.log('[ProxySettings] 测试配置:', configToTest);
      
      const result = await window.electronAPI.invoke('proxy:test', configToTest);

      if (result.success) {
        if (showSnackbar) showSnackbar(`${t('proxy.testConfig')} ${t('common.success')}! ${t('common.latency')}: ${result.data.latency}ms`, 'success');
      } else {
        if (showSnackbar) showSnackbar(result.error || t('proxy.connectionFailed'), 'error');
      }
    } catch (error) {
      if (showSnackbar) showSnackbar(`${t('proxy.testFailed')}: ${error.message}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  // 获取当前代理状态
  const getProxyUrl = () => {
    if (!config.enabled) return t('proxy.notEnabled');
    return `${config.protocol}://${config.host}:${config.port}`;
  };

  return (
    <Box>
      <Box sx={settingsSectionSx}>
        <Typography variant="h6" sx={sectionTitleSx}>网络代理</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          配置应用访问网络时使用的本地代理
        </Typography>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2 })}>
          <ListItemText
            primary={t('proxy.proxyStatus')}
            secondary={config.enabled ? t('proxy.enabledWithUrl', { url: getProxyUrl() }) : t('proxy.disabled')}
            primaryTypographyProps={{ sx: { fontWeight: 650 } }}
          />
          {config.enabled ? <CheckCircle color="success" /> : <WifiOff color="disabled" />}
        </Box>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2 })}>
          <ListItemText
            primary={t('proxy.enableProxy')}
            secondary={t('proxy.enableProxyDesc')}
            primaryTypographyProps={{ sx: { fontWeight: 650 } }}
          />
          <Switch checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
        </Box>
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>{t('proxy.hostAddress')}</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          {t('proxy.hostAddressDesc')}
        </Typography>
        <Box sx={settingsFieldGroupSx}>
          <Box sx={{ ...flex.rowGap2, flexWrap: 'wrap' }}>
            <TextField
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })}
              placeholder="127.0.0.1"
              disabled={!config.enabled}
              size="small"
              label={t('proxy.hostAddress')}
              sx={{ flex: '1 1 220px' }}
            />
            <TextField
              value={config.port}
              onChange={(e) => setConfig({ ...config, port: e.target.value })}
              placeholder="7890"
              disabled={!config.enabled}
              size="small"
              label={t('proxy.port')}
              sx={{ flex: '0 0 140px' }}
            />
          </Box>
        </Box>
        <Box sx={settingsFieldGroupSx}>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>{t('proxy.commonConfigs')}</Typography>
          <Box sx={{ ...flex.rowGap1, flexWrap: 'wrap' }}>
            <Chip label={t('proxy.clashPort')} size="small" onClick={() => setConfig({ ...config, host: '127.0.0.1', port: '7890' })} sx={{ cursor: 'pointer' }} />
            <Chip label={t('proxy.v2raynPort')} size="small" onClick={() => setConfig({ ...config, host: '127.0.0.1', port: '10809' })} sx={{ cursor: 'pointer' }} />
            <Chip label={t('proxy.shadowsocksPort')} size="small" onClick={() => setConfig({ ...config, host: '127.0.0.1', port: '1080' })} sx={{ cursor: 'pointer' }} />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, pt: 1 }}>
          <Button variant="contained" size="small" onClick={handleSave}>{t('proxy.saveConfig')}</Button>
          <Button variant="outlined" size="small" onClick={handleTest} disabled={!config.enabled || testing}>
            {testing ? t('proxy.testing') : t('proxy.testProxy')}
          </Button>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mt: 3 }}>
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 700 }}>{t('proxy.usageInstructions')}</Typography>
        <Typography variant="body2" component="div">
          {t('proxy.usageInstructionsList', { returnObjects: true }).map((item, index) => (
            <Box key={index}>{index + 1}. {item}</Box>
          ))}
        </Typography>
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2, fontWeight: 700 }}>{t('proxy.importantNotes')}</Typography>
        <Typography variant="body2" component="div">
          {t('proxy.importantNotesList', { returnObjects: true }).map((item, index) => (
            <Box key={index}>• {item}</Box>
          ))}
        </Typography>
      </Alert>
    </Box>
  );
};

export default ProxySettings;
