import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
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
} from '@mui/material';
import { Sync, CheckCircle } from '@mui/icons-material';
import { spacing, settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../styles/commonStyles';

const DEFAULT_CALDAV_CONFIG = {
  enabled: false,
  serverUrl: '',
  username: '',
  password: '',
  calendarUrl: '',
  syncInterval: '30',
  syncDirection: 'bidirectional',
};

const CalendarSyncSettings = () => {
  const [config, setConfig] = useState({
    ...DEFAULT_CALDAV_CONFIG,
  });

  const [status, setStatus] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const loadedRef = useRef(false);
  const lastSavedRef = useRef('');
  const saveTimerRef = useRef(null);

  useEffect(() => {
    loadConfig();
    loadStatus();
  }, []);

  const loadConfig = async () => {
    const result = await window.electronAPI.invoke('caldav:get-config');
    if (result.success) {
      const nextConfig = { ...DEFAULT_CALDAV_CONFIG, ...(result.data || {}) };
      setConfig(nextConfig);
      lastSavedRef.current = JSON.stringify(nextConfig);
      loadedRef.current = true;
    }
  };

  const loadStatus = async () => {
    const result = await window.electronAPI.invoke('caldav:get-status');
    if (result.success) {
      setStatus(result.data);
      setLastSync(result.data.lastSync);
    }
  };

  const handleTestConnection = async () => {
    if (!config.serverUrl || !config.username || !config.password) {
      setMessage({ type: 'error', text: '请填写服务器地址、用户名和密码' });
      return;
    }

    setTesting(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.invoke('caldav:test-connection', config);

      if (result.success) {
        setCalendars(result.data.calendars);
        setMessage({ type: 'success', text: `连接成功！找到 ${result.data.calendars.length} 个日历` });
      } else {
        const errorLines = result.error.split('\n');
        setMessage({ 
          type: 'error', 
          text: errorLines.map((line, i) => <div key={i}>{line}</div>)
        });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setTesting(false);
    }
  };

  const saveConfig = useCallback(async (configToSave) => {
    try {
      const result = await window.electronAPI.invoke('caldav:save-config', configToSave);

      if (result.success) {
        lastSavedRef.current = JSON.stringify(configToSave);
        await loadStatus();
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return undefined;
    const serialized = JSON.stringify(config);
    if (serialized === lastSavedRef.current) return undefined;

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveConfig(config);
    }, 600);

    return () => clearTimeout(saveTimerRef.current);
  }, [config, saveConfig]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.invoke('caldav:sync');

      if (result.success) {
        setMessage({
          type: 'success',
          text: `同步完成！上传: ${result.data.localToRemote}, 下载: ${result.data.remoteToLocal}`,
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

  const handleSelectCalendar = (calendarUrl) => {
    setConfig({ ...config, calendarUrl });
  };

  return (
    <Box>
      <Box sx={settingsSectionSx}>
        <Typography variant="h6" sx={sectionTitleSx}>CalDAV 日历同步</Typography>
        <Typography variant="caption" sx={sectionDescriptionSx}>
          配置私有或第三方 CalDAV 日历服务
        </Typography>
      </Box>

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Box sx={settingsSectionSx}>
        <FormControlLabel
          control={
            <Switch
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
          }
          label="启用日历同步"
        />
        {status && config.enabled && lastSync && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 5 }}>
            上次同步: {new Date(lastSync).toLocaleString('zh-CN')}
          </Typography>
        )}
      </Box>

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle2" sx={spacing.mb1}>服务器配置</Typography>
        <TextField
          fullWidth
          label="CalDAV 服务器地址"
          placeholder="https://caldav.example.com"
          value={config.serverUrl}
          onChange={(e) => setConfig({ ...config, serverUrl: e.target.value })}
          sx={spacing.mb2}
          size="small"
        />
        <TextField
          fullWidth
          label="用户名"
          value={config.username}
          onChange={(e) => setConfig({ ...config, username: e.target.value })}
          sx={spacing.mb2}
          size="small"
        />
        <TextField
          fullWidth
          label="密码/应用专用密码"
          type="password"
          value={config.password}
          onChange={(e) => setConfig({ ...config, password: e.target.value })}
          sx={spacing.mb2}
          size="small"
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={testing ? <CircularProgress size={16} /> : <CheckCircle />}
          onClick={handleTestConnection}
          disabled={testing}
        >
          测试连接
        </Button>
      </Box>

      {calendars.length > 0 && (
        <Box sx={settingsSectionSx}>
          <Typography variant="subtitle2" sx={spacing.mb1}>选择日历</Typography>
          <List disablePadding>
            {calendars.map((cal, index) => (
              <ListItem
                key={index}
                disablePadding
                sx={spacing.mb1}
              >
                <ListItemButton
                  selected={config.calendarUrl === cal.url}
                  onClick={() => handleSelectCalendar(cal.url)}
                  sx={{
                    border: '1px solid',
                    borderColor: config.calendarUrl === cal.url ? 'primary.main' : 'divider',
                    borderRadius: '12px',
                  }}
                >
                  <ListItemText
                    primary={cal.displayName}
                    secondary={cal.description || cal.url}
                  />
                  {config.calendarUrl === cal.url && <CheckCircle color="primary" />}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      <Box sx={settingsSectionSx}>
        <Typography variant="subtitle2" sx={spacing.mb1}>同步选项</Typography>
        <FormControl fullWidth sx={spacing.mb2} size="small">
          <InputLabel>同步方向</InputLabel>
          <Select
            value={config.syncDirection}
            label="同步方向"
            onChange={(e) => setConfig({ ...config, syncDirection: e.target.value })}
          >
            <MenuItem value="bidirectional">双向同步</MenuItem>
            <MenuItem value="upload">仅上传</MenuItem>
            <MenuItem value="download">仅下载</MenuItem>
          </Select>
        </FormControl>

        <FormControl fullWidth size="small">
          <InputLabel>自动同步间隔</InputLabel>
          <Select
            value={config.syncInterval}
            label="自动同步间隔"
            onChange={(e) => setConfig({ ...config, syncInterval: e.target.value })}
          >
            <MenuItem value="15">15 分钟</MenuItem>
            <MenuItem value="30">30 分钟</MenuItem>
            <MenuItem value="60">1 小时</MenuItem>
            <MenuItem value="180">3 小时</MenuItem>
            <MenuItem value="360">6 小时</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={syncing ? <CircularProgress size={16} /> : <Sync />}
          onClick={handleSyncNow}
          disabled={!config.enabled || syncing}
        >
          立即同步
        </Button>
      </Box>
    </Box>
  );
};

export default CalendarSyncSettings;
