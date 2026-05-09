import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import {
  Box,
  Typography,
  TextField,
  Button,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Slider,
  CircularProgress,
  Link,
  ListItemText
} from '@mui/material';
import {
  Check as CheckIcon,
  Info as InfoIcon
} from '@mui/icons-material';
import { settingsFieldGroupSx, settingsRowSx, settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../styles/commonStyles';

const AISettings = ({ showSnackbar }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    enabled: false,
    provider: 'openai',
    apiKey: '',
    apiUrl: '',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 2000
  });

  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
    loadProviders();
  }, []);

  const loadConfig = async () => {
    try {
      if (window.electronAPI?.ai) {
        const result = await window.electronAPI.ai.getConfig();
        if (result?.success && result.data) {
          setConfig(result.data);
          updateSelectedProvider(result.data.provider);
        }
      }
    } catch (error) {
      console.error('加载AI配置失败:', error);
      if (showSnackbar) showSnackbar(t('ai.loadConfigFailed'), 'error');
    }
  };

  const loadProviders = async () => {
    try {
      if (window.electronAPI?.ai) {
        const result = await window.electronAPI.ai.getProviders();
        if (result?.success && result.data) {
          setProviders(result.data);
          if (result.data.length > 0) {
            updateSelectedProvider(config.provider);
          }
        }
      }
    } catch (error) {
      console.error('加载AI提供商列表失败:', error);
    }
  };

  const updateSelectedProvider = (providerId) => {
    const provider = providers.find(p => p.id === providerId);
    setSelectedProvider(provider);
  };

  const handleConfigChange = async (field, value) => {
    const newConfig = {
      ...config,
      [field]: value
    };
    setConfig(newConfig);

    // 自动保存逻辑：除了文本输入框外，其他修改立即保存
    // 文本输入框(apiKey, apiUrl)在 onBlur 时保存，避免频繁IO
    if (!['apiKey', 'apiUrl'].includes(field)) {
      await saveConfigToBackend(newConfig);
    }
  };

  const handleTextBlur = async () => {
    await saveConfigToBackend(config);
  };

  const saveConfigToBackend = async (configToSave) => {
    setSaving(true);
    try {
      const result = await window.electronAPI.ai.saveConfig(configToSave);
      if (!result?.success) {
        if (showSnackbar) showSnackbar(result.error || t('ai.saveFailed'), 'error');
      } else {
        if (showSnackbar) showSnackbar(t('ai.configSaved'), 'success');
      }
    } catch (error) {
      console.error('保存AI配置失败:', error);
      if (showSnackbar) showSnackbar(t('ai.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = (providerId) => {
    const provider = providers.find(p => p.id === providerId);
    setSelectedProvider(provider);

    const newConfig = {
      ...config,
      provider: providerId,
      // 切换提供商时，更新默认模型
      model: (provider && provider.models && provider.models.length > 0) ? provider.models[0] : config.model
    };

    setConfig(newConfig);
    saveConfigToBackend(newConfig);
  };

  const handleTestConnection = async () => {
    if (!config.apiKey) {
      if (showSnackbar) showSnackbar(t('ai.enterApiKey'), 'warning');
      return;
    }

    if (config.provider === 'custom' && !config.apiUrl) {
      if (showSnackbar) showSnackbar(t('ai.enterCustomApiUrl'), 'warning');
      return;
    }

    setTesting(true);

    try {
      const result = await window.electronAPI.ai.testConnection(config);
      if (result?.success) {
        if (showSnackbar) showSnackbar(result.message || t('ai.connectionTestSuccess'), 'success');
      } else {
        if (showSnackbar) showSnackbar(result.error || t('ai.connectionTestFailed'), 'error');
      }
    } catch (error) {
      if (showSnackbar) showSnackbar(error.message || t('ai.connectionTestFailed'), 'error');
    } finally {
      setTesting(false);
    }
  };

  const getProviderDocLink = (providerId) => {
    const links = {
      openai: 'https://platform.openai.com/api-keys',
      deepseek: 'https://platform.deepseek.com/api_keys',
      qwen: 'https://dashscope.console.aliyun.com/apiKey'
    };
    return links[providerId] || null;
  };

  return (
    <Box>
      <Box sx={settingsSectionSx}>
        <Typography variant="h6" sx={sectionTitleSx}>AI 助手</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          管理 AI 功能开关、模型服务和生成参数
        </Typography>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2 })}>
          <ListItemText
            primary={t('ai.enableAI')}
            secondary={t('ai.enableAIDesc')}
            primaryTypographyProps={{ sx: { fontWeight: 650 } }}
          />
          <Switch
            checked={config.enabled}
            onChange={(e) => handleConfigChange('enabled', e.target.checked)}
            color="primary"
          />
        </Box>
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>服务配置</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          选择模型服务，并填写访问凭据
        </Typography>
        <Box sx={settingsFieldGroupSx}>
          <FormControl fullWidth size="small">
            <InputLabel>{t('ai.provider')}</InputLabel>
            <Select value={config.provider} label={t('ai.provider')} onChange={(e) => handleProviderChange(e.target.value)}>
              {providers.map(provider => (
                <MenuItem key={provider.id} value={provider.id}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{provider.name}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{provider.description}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Box sx={settingsFieldGroupSx}>
          <TextField
            fullWidth
            size="small"
            label={t('ai.apiKey')}
            type="password"
            value={config.apiKey}
            onChange={(e) => handleConfigChange('apiKey', e.target.value)}
            onBlur={handleTextBlur}
            placeholder={t('ai.apiKeyPlaceholder')}
            helperText={selectedProvider && getProviderDocLink(config.provider) && (
              <Link
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (window.electronAPI?.system) {
                    window.electronAPI.system.openExternal(getProviderDocLink(config.provider));
                  }
                }}
              >
                {t('ai.howToGetApiKey')}
              </Link>
            )}
          />
        </Box>
        {config.provider === 'custom' && (
          <Box sx={settingsFieldGroupSx}>
            <TextField
              fullWidth
              size="small"
              label={t('ai.apiUrl')}
              value={config.apiUrl}
              onChange={(e) => handleConfigChange('apiUrl', e.target.value)}
              onBlur={handleTextBlur}
              placeholder={t('ai.apiUrlPlaceholder')}
              helperText={t('ai.apiUrlDesc')}
            />
          </Box>
        )}
        <Box sx={settingsFieldGroupSx}>
          {selectedProvider && selectedProvider.models && selectedProvider.models.length > 0 ? (
            <FormControl fullWidth size="small">
              <InputLabel>{t('ai.model')}</InputLabel>
              <Select value={config.model} label={t('ai.model')} onChange={(e) => handleConfigChange('model', e.target.value)}>
                {selectedProvider.models.map(model => (
                  <MenuItem key={model} value={model}>{model}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <TextField
              fullWidth
              size="small"
              label={t('ai.modelName')}
              value={config.model}
              onChange={(e) => handleConfigChange('model', e.target.value)}
              onBlur={handleTextBlur}
              placeholder={t('ai.modelPlaceholder')}
            />
          )}
        </Box>
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>生成参数</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          控制回答随机性和最大输出长度
        </Typography>
        <Box sx={settingsFieldGroupSx}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('ai.temperature')}: {typeof config.temperature === 'number' && !isNaN(config.temperature) ? config.temperature : 0.7}
          </Typography>
          <Slider
            value={typeof config.temperature === 'number' && !isNaN(config.temperature) ? config.temperature : 0.7}
            onChange={(e, value) => handleConfigChange('temperature', value)}
            min={0}
            max={2}
            step={0.1}
            marks={[{ value: 0, label: '0' }, { value: 1, label: '1' }, { value: 2, label: '2' }]}
            valueLabelDisplay="auto"
          />
          <Typography variant="caption" color="text.secondary">{t('ai.temperatureDesc')}</Typography>
        </Box>
        <Box sx={settingsFieldGroupSx}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('ai.maxTokens')}: {typeof config.maxTokens === 'number' && !isNaN(config.maxTokens) ? config.maxTokens : 2000}
          </Typography>
          <Slider
            value={typeof config.maxTokens === 'number' && !isNaN(config.maxTokens) ? config.maxTokens : 2000}
            onChange={(e, value) => handleConfigChange('maxTokens', value)}
            min={100}
            max={4000}
            step={100}
            marks={[{ value: 100, label: '100' }, { value: 2000, label: '2000' }, { value: 4000, label: '4000' }]}
            valueLabelDisplay="auto"
          />
          <Typography variant="caption" color="text.secondary">{t('ai.maxTokensDesc')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleTestConnection}
            disabled={!config.apiKey || testing}
            startIcon={testing ? <CircularProgress size={16} /> : <CheckIcon />}
          >
            {testing ? t('ai.testing') : t('ai.testConnection')}
          </Button>
        </Box>
      </Box>

      <Alert severity="info" icon={<InfoIcon />} sx={{ mt: 3 }}>
        <Typography variant="body2" gutterBottom>
          <strong>{t('ai.usageInstructions')}：</strong>
        </Typography>
        <Typography variant="body2" component="div">
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {t('ai.usageInstructionsList', { returnObjects: true }).map((item, index) => (
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

export default AISettings;
