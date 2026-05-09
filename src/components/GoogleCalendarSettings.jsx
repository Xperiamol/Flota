import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import {
  Box,
  Typography,
  Button,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Chip,
} from '@mui/material';
import { Sync, CheckCircle, CloudSync, Google as GoogleIcon, LinkOff } from '@mui/icons-material';
import { spacing, flex, settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../styles/commonStyles';

const GoogleCalendarSettings = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    enabled: false,
    connected: false,
    calendarId: '',
    syncInterval: '30',
    syncDirection: 'bidirectional',
  });

  const [status, setStatus] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [message, setMessage] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  // 加载配置
  useEffect(() => {
    loadConfig();
    loadStatus();
  }, []);

  const loadConfig = async () => {
    const result = await window.electronAPI.invoke('google-calendar:get-config');
    if (result.success) {
      setConfig(result.data);
      
      // 如果已连接,加载日历列表
      if (result.data.connected) {
        loadCalendars();
      }
    }
  };

  const loadStatus = async () => {
    const result = await window.electronAPI.invoke('google-calendar:get-status');
    if (result.success) {
      setStatus(result.data);
      setLastSync(result.data.lastSync);
    }
  };

  const loadCalendars = async () => {
    try {
      const result = await window.electronAPI.invoke('google-calendar:list-calendars');
      if (result.success) {
        setCalendars(result.data.calendars);
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } catch (error) {
      console.error('加载日历列表失败:', error);
    }
  };

  // 开始 OAuth 授权 (使用本地服务器自动接收)
  const handleStartAuth = async () => {
    setAuthorizing(true);
    setMessage({ type: 'info', text: t('googleCalendar.startAuthInfo') });
    
    try {
      // 新版本:本地服务器自动接收授权,无需手动输入授权码
      const result = await window.electronAPI.invoke('google-calendar:start-auth');
      
      if (result.success) {
        // 授权成功,直接获得日历列表
        setCalendars(result.data.calendars);
        setConfig({ ...config, connected: true });
        setMessage({
          type: 'success',
          text: t('googleCalendar.authSuccess', { count: result.data.calendars.length })
        });
      } else {
        // 显示详细错误信息
        console.error('[GoogleCalendar] 授权失败:', result.error);
        
        // 解析错误信息
        const errorMsg = result.error || '授权失败';
        const isInvalidRequest = errorMsg.toLowerCase().includes('invalid');
        
        // 构建用户友好的错误提示
        let displayMsg = errorMsg;
        if (isInvalidRequest) {
          displayMsg = '授权请求无效。这通常是因为：\n\n' +
            '1. 重定向 URI 未在 Google Cloud Console 中配置\n' +
            '2. 客户端 ID 或密钥配置错误\n' +
            '3. 网络连接问题\n\n' +
            '请查看文档 docs/GOOGLE_CALENDAR_OAUTH_SETUP.md 了解详细配置步骤。\n\n' +
            '或者按 Ctrl+Shift+I 打开开发者工具查看详细日志。';
        }
        
        setMessage({ 
          type: 'error', 
          text: displayMsg
        });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setAuthorizing(false);
    }
  };

  // 断开连接
  const handleDisconnect = async () => {
    try {
      const result = await window.electronAPI.invoke('google-calendar:disconnect');
      
      if (result.success) {
        setConfig({ ...config, enabled: false, connected: false, calendarId: '' });
        setCalendars([]);
        setMessage({ type: 'success', text: t('googleCalendar.disconnectSuccess') });
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  // 保存配置
  const handleSave = async () => {
    try {
      const result = await window.electronAPI.invoke('google-calendar:save-config', config);

      if (result.success) {
        setMessage({ type: 'success', text: t('googleCalendar.saveSuccess') });
        await loadStatus();
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  // 立即同步
  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.invoke('google-calendar:sync');

      if (result.success) {
        setMessage({
          type: 'success',
          text: t('googleCalendar.syncComplete', {
            up: result.data.localToRemote,
            down: result.data.remoteToLocal
          })
        });
        await loadStatus();
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setSyncing(false);
    }
  };

  // 选择日历
  const handleSelectCalendar = async (calendarId) => {
    setConfig({ ...config, calendarId });
    // 立即保存以保持与 SyncStatusIndicator 同步
    try {
      const result = await window.electronAPI.invoke('google-calendar:save-config', {
        ...config,
        calendarId
      });
      if (result.success) {
        await loadStatus();
      }
    } catch (error) {
      console.error('保存配置失败:', error);
    }
  };

  return (
    <Box>
      <Box sx={settingsSectionSx}>
        <Typography variant="h6" sx={sectionTitleSx}>Google Calendar 设置</Typography>
        <Typography variant="caption" sx={sectionDescriptionSx}>
          连接 Google 账号，并配置日历同步规则
        </Typography>
      </Box>

      {message && (
        <Alert severity={message.type} sx={spacing.mb2} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Box sx={settingsSectionSx}>
        {/* 账号连接 */}
        <Typography variant="subtitle2" sx={spacing.mb1}>
          账号连接
        </Typography>
        
        {!config.connected ? (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={spacing.mb2}>
              使用 OAuth 2.0 安全授权
            </Typography>
            
            {authorizing ? (
              <Box sx={{ ...flex.column, alignItems: 'center' }}>
                <CircularProgress size={24} sx={spacing.mb1} />
                <Typography variant="caption" color="text.secondary">
                  授权中，请在浏览器中完成...
                </Typography>
              </Box>
            ) : (
              <Button
                variant="contained"
                size="small"
                startIcon={<GoogleIcon />}
                onClick={handleStartAuth}
              >
                连接 Google 账号
              </Button>
            )}
          </Box>
        ) : (
          <Box sx={{ ...flex.spaceBetween, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: '14px' }}>
            <Box sx={{ ...flex.row }}>
              <CheckCircle color="success" sx={{ mr: 1 }} />
              <Typography variant="body2">已连接</Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              color="error"
              startIcon={<LinkOff />}
              onClick={handleDisconnect}
            >
              断开连接
            </Button>
          </Box>
        )}
      </Box>


      {/* 日历选择 */}
      {config.connected && calendars.length > 0 && (
        <Box sx={settingsSectionSx}>
          <Typography variant="subtitle2" sx={spacing.mb1}>
            选择日历
          </Typography>
          <List disablePadding>
            {calendars.map((cal) => (
              <ListItem
                key={cal.id}
                disablePadding
                sx={spacing.mb1}
              >
                <ListItemButton
                  selected={config.calendarId === cal.id}
                  onClick={() => handleSelectCalendar(cal.id)}
                  sx={{
                    border: '1px solid',
                    borderColor: config.calendarId === cal.id ? 'primary.main' : 'divider',
                    borderRadius: '12px',
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ ...flex.rowGap1 }}>
                        {cal.displayName}
                        {cal.primary && <Chip label="主日历" size="small" color="primary" />}
                      </Box>
                    }
                    primaryTypographyProps={{ component: 'div' }}
                    secondary={cal.description || `访问权限: ${cal.accessRole}`}
                  />
                  {config.calendarId === cal.id && <CheckCircle color="primary" />}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {/* 同步选项 */}
      {config.connected && (
        <Box sx={settingsSectionSx}>
          <Typography variant="subtitle2" sx={spacing.mb1}>
            同步选项
          </Typography>
          <FormControl fullWidth sx={spacing.mb2} size="small">
            <InputLabel>同步方向</InputLabel>
            <Select
              value={config.syncDirection}
              label="同步方向"
              onChange={async (e) => {
                const newDirection = e.target.value;
                setConfig({ ...config, syncDirection: newDirection });
                try {
                  const result = await window.electronAPI.invoke('google-calendar:save-config', {
                    ...config,
                    syncDirection: newDirection
                  });
                  if (result.success) {
                    await loadStatus();
                  }
                } catch (error) {
                  console.error('保存配置失败:', error);
                }
              }}
            >
              <MenuItem value="bidirectional">双向同步</MenuItem>
              <MenuItem value="upload">仅上传</MenuItem>
              <MenuItem value="download">仅下载</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }} size="small">
            <InputLabel>同步间隔</InputLabel>
            <Select
              value={config.syncInterval}
              label="同步间隔"
              onChange={async (e) => {
                const newInterval = e.target.value;
                setConfig({ ...config, syncInterval: newInterval });
                try {
                  const result = await window.electronAPI.invoke('google-calendar:save-config', {
                    ...config,
                    syncInterval: newInterval
                  });
                  if (result.success) {
                    await loadStatus();
                  }
                } catch (error) {
                  console.error('保存配置失败:', error);
                }
              }}
            >
              <MenuItem value="15">15 分钟</MenuItem>
              <MenuItem value="30">30 分钟</MenuItem>
              <MenuItem value="60">1 小时</MenuItem>
              <MenuItem value="180">3 小时</MenuItem>
              <MenuItem value="360">6 小时</MenuItem>
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={config.enabled}
                onChange={async (e) => {
                  const newEnabled = e.target.checked;
                  setConfig({ ...config, enabled: newEnabled });
                  try {
                    const result = await window.electronAPI.invoke('google-calendar:save-config', {
                      ...config,
                      enabled: newEnabled
                    });
                    if (result.success) {
                      await loadStatus();
                    }
                  } catch (error) {
                    console.error('保存配置失败:', error);
                  }
                }}
              />
            }
            label="启用同步"
          />
        </Box>
      )}

      {/* 操作按钮 */}
      {config.connected && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<CheckCircle />}
            onClick={handleSave}
          >
            保存配置
          </Button>

          <Button
            variant="outlined"
            size="small"
            startIcon={syncing ? <CircularProgress size={16} /> : <Sync />}
            onClick={handleSyncNow}
            disabled={!config.enabled || syncing || !config.calendarId}
          >
            立即同步
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default GoogleCalendarSettings;
