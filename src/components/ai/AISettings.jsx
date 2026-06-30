import React, { useState, useEffect } from 'react';
import { useTranslation } from '../../utils/i18n';
import {
  Box,
  Typography,
  TextField,
  Button,
  Switch,
  Accordion,
  AccordionSummary,
  AccordionDetails,
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
  ExpandMore as ExpandMoreIcon,
  Info as InfoIcon
} from '@mui/icons-material';
import { settingsFieldGroupSx, settingsRowSx, settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../../styles/commonStyles';

const isEnabledSetting = (value) => value === true || value === 'true' || value === 1 || value === '1';

const AISettings = ({ showSnackbar }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    enabled: false,
    provider: 'openai',
    apiKey: '',
    apiUrl: '',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    limitMaxTokens: false,
    maxTokens: 2000,
    visionEnabled: false,
    autoTitleEnabled: false,
    autoTagsEnabled: false,
    webSearchEnabled: false,
    webSearchProvider: 'feedcoop',
    webSearchApiKey: '',
    webSearchApiUrl: '',
    webSearchCount: 5
  });

  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testingWebSearch, setTestingWebSearch] = useState(false);
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
    if (!['apiKey', 'apiUrl', 'webSearchApiKey', 'webSearchApiUrl'].includes(field)) {
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

  const handleTestWebSearch = async () => {
    if (!isEnabledSetting(config.webSearchEnabled)) {
      if (showSnackbar) showSnackbar('请先开启联网搜索', 'warning');
      return;
    }
    if (!config.webSearchApiKey) {
      if (showSnackbar) showSnackbar('请先填写联网搜索 API Key', 'warning');
      return;
    }
    if (config.webSearchProvider === 'custom' && !config.webSearchApiUrl) {
      if (showSnackbar) showSnackbar('请先填写自定义搜索端点', 'warning');
      return;
    }

    setTestingWebSearch(true);
    try {
      const result = await window.electronAPI.ai.testWebSearch(config);
      if (result?.success) {
        if (showSnackbar) showSnackbar(result.message || '联网搜索测试成功', 'success');
      } else {
        if (showSnackbar) showSnackbar(result?.error || '联网搜索测试失败', 'error');
      }
    } catch (error) {
      if (showSnackbar) showSnackbar(error.message || '联网搜索测试失败', 'error');
    } finally {
      setTestingWebSearch(false);
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
            slotProps={{ primary: { sx: { fontWeight: 650 } } }}
          />
          <Switch
            checked={config.enabled}
            onChange={(e) => handleConfigChange('enabled', e.target.checked)}
            color="primary"
          />
        </Box>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2, mt: 1, opacity: config.enabled ? 1 : 0.45 })}>
          <ListItemText
            primary="自动 AI 标题"
            secondary="切换笔记时，仅当笔记标题为空（或为「未命名」）时调用 AI 自动生成简洁标题。"
            slotProps={{ primary: { sx: { fontWeight: 650 } } }}
          />
          <Switch
            checked={isEnabledSetting(config.autoTitleEnabled)}
            onChange={(e) => handleConfigChange('autoTitleEnabled', e.target.checked)}
            color="primary"
            disabled={!config.enabled}
          />
        </Box>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2, mt: 1, opacity: config.enabled ? 1 : 0.45 })}>
          <ListItemText
            primary="自动 AI 标签"
            secondary="切换笔记时，AI 根据正文推荐标签；保留你已有的标签，只追加新建议供你点击采纳。"
            slotProps={{ primary: { sx: { fontWeight: 650 } } }}
          />
          <Switch
            checked={isEnabledSetting(config.autoTagsEnabled)}
            onChange={(e) => handleConfigChange('autoTagsEnabled', e.target.checked)}
            color="primary"
            disabled={!config.enabled}
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

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>联网搜索</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          开启后，AI 对话与长文档生成可调用联网搜索获取实时信息
        </Typography>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2, mb: 2 })}>
          <ListItemText
            primary="启用联网搜索"
            secondary="需要配置搜索服务的 API 密钥后生效"
            slotProps={{ primary: { sx: { fontWeight: 650 } } }}
          />
          <Switch
            checked={isEnabledSetting(config.webSearchEnabled)}
            onChange={(e) => handleConfigChange('webSearchEnabled', e.target.checked)}
            color="primary"
          />
        </Box>
        <Box sx={{ ...settingsFieldGroupSx, opacity: isEnabledSetting(config.webSearchEnabled) ? 1 : 0.45 }}>
          <FormControl fullWidth size="small">
            <InputLabel>搜索服务商</InputLabel>
            <Select
              value={config.webSearchProvider || 'feedcoop'}
              label="搜索服务商"
              onChange={(e) => handleConfigChange('webSearchProvider', e.target.value)}
              disabled={!isEnabledSetting(config.webSearchEnabled)}
            >
              <MenuItem value="feedcoop">官方联网搜索</MenuItem>
              <MenuItem value="custom">自定义端点</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ ...settingsFieldGroupSx, opacity: isEnabledSetting(config.webSearchEnabled) ? 1 : 0.45 }}>
          <TextField
            fullWidth
            size="small"
            label="搜索 API 密钥"
            type="password"
            value={config.webSearchApiKey || ''}
            onChange={(e) => handleConfigChange('webSearchApiKey', e.target.value)}
            onBlur={handleTextBlur}
            placeholder="填写联网搜索服务的 API Key"
            disabled={!isEnabledSetting(config.webSearchEnabled)}
          />
        </Box>
        {config.webSearchProvider === 'custom' && (
          <Box sx={{ ...settingsFieldGroupSx, opacity: isEnabledSetting(config.webSearchEnabled) ? 1 : 0.45 }}>
            <TextField
              fullWidth
              size="small"
              label="自定义搜索端点"
              value={config.webSearchApiUrl || ''}
              onChange={(e) => handleConfigChange('webSearchApiUrl', e.target.value)}
              onBlur={handleTextBlur}
              placeholder="https://.../web-search"
              helperText="需兼容官方联网搜索接口的请求/响应结构"
              disabled={!isEnabledSetting(config.webSearchEnabled)}
            />
          </Box>
        )}
        <Box sx={{ ...settingsFieldGroupSx, opacity: isEnabledSetting(config.webSearchEnabled) ? 1 : 0.45 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            单次返回结果数：{typeof config.webSearchCount === 'number' && !isNaN(config.webSearchCount) ? config.webSearchCount : 5}
          </Typography>
          <Slider
            value={typeof config.webSearchCount === 'number' && !isNaN(config.webSearchCount) ? config.webSearchCount : 5}
            onChange={(_, value) => handleConfigChange('webSearchCount', value)}
            min={1}
            max={20}
            step={1}
            marks={[{ value: 1, label: '1' }, { value: 10, label: '10' }, { value: 20, label: '20' }]}
            valueLabelDisplay="auto"
            disabled={!isEnabledSetting(config.webSearchEnabled)}
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleTestWebSearch}
            disabled={!isEnabledSetting(config.webSearchEnabled) || !config.webSearchApiKey || testingWebSearch}
            startIcon={testingWebSearch ? <CircularProgress size={16} /> : <CheckIcon />}
          >
            {testingWebSearch ? '测试中...' : '测试联网搜索'}
          </Button>
        </Box>
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>图片理解</Typography>
        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
          开启后 AI 可读取笔记内图片，聊天框也支持粘贴/拖拽图片
        </Typography>
        <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2 })}>
          <ListItemText
            primary="启用图片理解（多模态）"
            secondary="开启后聊天框可粘贴或拖拽图片发送给模型；请确保所选模型支持视觉输入。"
            slotProps={{ primary: { sx: { fontWeight: 650 } } }}
          />
          <Switch
            checked={isEnabledSetting(config.visionEnabled)}
            onChange={(e) => handleConfigChange('visionEnabled', e.target.checked)}
            color="primary"
          />
        </Box>
      </Box>

      <Box sx={settingsSectionSx}>
        <Accordion
          disableGutters
          elevation={0}
          sx={(theme) => ({
            bgcolor: 'transparent',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
            '&:before': { display: 'none' },
          })}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
            <Box>
              <Typography variant="subtitle1" sx={sectionTitleSx}>高级设置</Typography>
              <Typography variant="caption" sx={sectionDescriptionSx}>
                调整随机性；默认使用较大的输出预算
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Box sx={settingsFieldGroupSx}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {t('ai.temperature')}: {typeof config.temperature === 'number' && !isNaN(config.temperature) ? config.temperature : 0.7}
              </Typography>
              <Slider
                value={typeof config.temperature === 'number' && !isNaN(config.temperature) ? config.temperature : 0.7}
                onChange={(_, value) => handleConfigChange('temperature', value)}
                min={0}
                max={2}
                step={0.1}
                marks={[{ value: 0, label: '0' }, { value: 1, label: '1' }, { value: 2, label: '2' }]}
                valueLabelDisplay="auto"
              />
              <Typography variant="caption" color="text.secondary">{t('ai.temperatureDesc')}</Typography>
            </Box>
            <Box sx={(theme) => ({ ...settingsRowSx(theme), display: 'flex', alignItems: 'center', gap: 2, mb: 2 })}>
              <ListItemText
                primary="限制最大输出长度"
                secondary="默认关闭；关闭时不传最大输出长度限制，仅在开启后使用下面的自定义值。"
                slotProps={{ primary: { sx: { fontWeight: 650 } } }}
              />
              <Switch
                checked={isEnabledSetting(config.limitMaxTokens)}
                onChange={(e) => handleConfigChange('limitMaxTokens', e.target.checked)}
                color="primary"
              />
            </Box>
            <Box sx={{ ...settingsFieldGroupSx, opacity: isEnabledSetting(config.limitMaxTokens) ? 1 : 0.45 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {t('ai.maxTokens')}: {typeof config.maxTokens === 'number' && !isNaN(config.maxTokens) ? config.maxTokens : 2000}
              </Typography>
              <Slider
                value={typeof config.maxTokens === 'number' && !isNaN(config.maxTokens) ? config.maxTokens : 2000}
                onChange={(_, value) => handleConfigChange('maxTokens', value)}
                min={100}
                max={128000}
                step={1000}
                marks={[{ value: 100, label: '100' }, { value: 32000, label: '32K' }, { value: 128000, label: '128K' }]}
                valueLabelDisplay="auto"
                disabled={!isEnabledSetting(config.limitMaxTokens)}
              />
              <Typography variant="caption" color="text.secondary">
                {isEnabledSetting(config.limitMaxTokens) ? t('ai.maxTokensDesc') : '当前关闭：不会向模型传 max_tokens，仅在开启后使用这里的自定义限制。'}
              </Typography>
            </Box>
          </AccordionDetails>
        </Accordion>
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
