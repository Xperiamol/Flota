import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import { useError } from './ErrorProvider';
import {
  Box,
  Typography,
  List,
  ListItem,
  Switch,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  Alert,
} from '@mui/material';
import {
  Cloud as CloudIcon,
  CheckBox as TodoIcon,
  Settings as SettingsIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  CloudOff as CloudOffIcon,
  Image as ImageIcon,
  Tune as TuneIcon,
  Extension as ExtensionIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';
import { iconWithColor, combo, flex, spacing } from '../styles/commonStyles';

const SyncRegistryView = ({ onOpenSettings }) => {
  const { t } = useTranslation();
  const { showError } = useError();
  const [syncRegistry, setSyncRegistry] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false); // 标记是否已初始化
  
  // 后端状态数据
  const [backendStatus, setBackendStatus] = useState({
    nutcloud: null,
    googleCal: null,
    googleCalStatus: null,
    caldav: null,
    caldavStatus: null,
  });
  
  // 保存用户在下拉菜单中的选择
  const [providerSelections, setProviderSelections] = useState({
    todos: 'nutcloud',
  });

  // 加载后端状态
  useEffect(() => {
    loadBackendStatus(true); // 首次加载
    const interval = setInterval(() => loadBackendStatus(false), 5000); // 后续刷新
    return () => clearInterval(interval);
  }, []);
  
  // 当后端状态或用户选择变化时，重新构建 registry
  useEffect(() => {
    buildSyncRegistry();
  }, [backendStatus, providerSelections]);

  const loadBackendStatus = async (isInitialLoad = false) => {
    try {
      // 加载坚果云同步状态
      const nutcloudStatus = await window.electronAPI.sync.getStatus();
      
      // 加载Google日历状态
      const googleCalResult = await window.electronAPI.invoke('google-calendar:get-config');
      const googleCalStatus = await window.electronAPI.invoke('google-calendar:get-status');
      
      // 加载CalDAV状态
      const caldavResult = await window.electronAPI.invoke('caldav:get-config');
      const caldavStatus = await window.electronAPI.invoke('caldav:get-status');
      
      setBackendStatus({
        nutcloud: nutcloudStatus,
        googleCal: googleCalResult,
        googleCalStatus: googleCalStatus,
        caldav: caldavResult,
        caldavStatus: caldavStatus,
      });
      
      // 只在首次加载时根据后端状态初始化 providerSelections
      if (isInitialLoad && !isInitialized) {
        setProviderSelections(prev => {
          const newSelections = { ...prev };
          
          // 对于待办（日历），检查哪个服务的 todos 类别实际启用了
          if (nutcloudStatus?.v3?.config?.syncCategories?.includes('todos')) {
            newSelections.todos = 'nutcloud';
          } else if (googleCalResult?.data?.enabled) {
            newSelections.todos = 'google-calendar';
          } else if (caldavResult?.data?.enabled) {
            newSelections.todos = 'caldav';
          }
          // 如果都没启用，保持默认选择
          
          return newSelections;
        });
        setIsInitialized(true);
      }
    } catch (error) {
      console.error('加载后端状态失败:', error);
      showError(error, '加载同步状态失败');
    }
  };
  
  const buildSyncRegistry = () => {
    const { nutcloud, googleCal, googleCalStatus, caldav, caldavStatus } = backendStatus;
    
    const registry = [
      {
        id: 'notes',
        name: '笔记',
        icon: <DescriptionIcon />,
        type: 'nutcloud-category',
        category: 'notes',
        selectedProvider: 'nutcloud',
        availableProviders: [
          { id: 'nutcloud', name: '坚果云' },
        ],
        enabled: nutcloud?.v3?.config?.syncCategories?.includes('notes') || false,
        status: nutcloud?.v3?.status || 'idle',
        lastSync: nutcloud?.v3?.lastSyncTime || null,
        error: nutcloud?.v3?.lastError || null,
      },
      {
        id: 'images',
        name: '图片',
        icon: <ImageIcon />,
        type: 'nutcloud-category',
        category: 'images',
        selectedProvider: 'nutcloud',
        availableProviders: [
          { id: 'nutcloud', name: '坚果云' },
        ],
        enabled: nutcloud?.v3?.config?.syncCategories?.includes('images') || false,
        status: nutcloud?.v3?.status || 'idle',
        lastSync: nutcloud?.v3?.lastSyncTime || null,
      },
      {
        id: 'settings',
        name: '设置项',
        icon: <TuneIcon />,
        type: 'nutcloud-category',
        category: 'settings',
        selectedProvider: 'nutcloud',
        availableProviders: [
          { id: 'nutcloud', name: '坚果云' },
        ],
        enabled: nutcloud?.v3?.config?.syncCategories?.includes('settings') || false,
        status: nutcloud?.v3?.status || 'idle',
        lastSync: nutcloud?.v3?.lastSyncTime || null,
      },
      {
        id: 'todos',
        name: '待办',
        icon: <TodoIcon />,
        type: 'calendar',
        selectedProvider: providerSelections.todos,
        availableProviders: [
          { id: 'nutcloud', name: '坚果云' },
          { id: 'google-calendar', name: 'Google Calendar' },
          { id: 'caldav', name: 'CalDAV' },
        ],
        category: 'todos',
        // 显示当前选中服务的状态
        enabled: providerSelections.todos === 'nutcloud'
          ? (nutcloud?.v3?.config?.syncCategories?.includes('todos') || false)
          : providerSelections.todos === 'google-calendar' 
          ? (googleCal?.data?.enabled || false)
          : (caldav?.data?.enabled || false),
        connected: providerSelections.todos === 'google-calendar' ? googleCal?.data?.connected : undefined,
        status: providerSelections.todos === 'nutcloud'
          ? (nutcloud?.v3?.status || 'idle')
          : providerSelections.todos === 'google-calendar'
          ? (googleCalStatus?.data?.syncing ? 'syncing' : 'idle')
          : (caldavStatus?.data?.syncing ? 'syncing' : 'idle'),
        lastSync: providerSelections.todos === 'nutcloud'
          ? nutcloud?.v3?.lastSyncTime
          : providerSelections.todos === 'google-calendar' 
          ? googleCalStatus?.data?.lastSync 
          : caldavStatus?.data?.lastSync,
      },
    ];

    setSyncRegistry(registry);
  };

  const handleProviderChange = (item, newProvider) => {
    // 更新用户选择的服务提供商
    setProviderSelections(prev => ({
      ...prev,
      [item.id]: newProvider
    }));
    // buildSyncRegistry 会通过 useEffect 自动触发
  };

  const handleToggleEnabled = async (item) => {
    try {
      const selectedProvider = item.selectedProvider;

      const setGoogleCalendarEnabled = async (enabled) => {
        const configResult = await window.electronAPI.invoke('google-calendar:get-config');
        if (configResult?.success) {
          await window.electronAPI.invoke('google-calendar:save-config', {
            ...configResult.data,
            enabled,
          });
        }
      };

      const setCaldavEnabled = async (enabled) => {
        const configResult = await window.electronAPI.invoke('caldav:get-config');
        if (configResult?.success) {
          await window.electronAPI.invoke('caldav:save-config', {
            ...configResult.data,
            enabled,
          });
        }
      };
      
      if (item.enabled) {
        // ========== 禁用当前服务 ==========
        if (selectedProvider === 'nutcloud') {
          // 禁用特定类别
          await window.electronAPI.sync.disableCategory(item.category);
        } else if (selectedProvider === 'google-calendar') {
          await setGoogleCalendarEnabled(false);
        } else if (selectedProvider === 'caldav') {
          await setCaldavEnabled(false);
        }
      } else {
        // ========== 启用当前服务 ==========

        // 待办：多服务互斥（启用一个时，自动关闭另外两个）
        if (item.id === 'todos') {
          if (selectedProvider === 'nutcloud') {
            await Promise.all([
              setGoogleCalendarEnabled(false),
              setCaldavEnabled(false),
            ]);
          } else if (selectedProvider === 'google-calendar') {
            await Promise.all([
              window.electronAPI.sync.disableCategory('todos'),
              setCaldavEnabled(false),
            ]);
          } else if (selectedProvider === 'caldav') {
            await Promise.all([
              window.electronAPI.sync.disableCategory('todos'),
              setGoogleCalendarEnabled(false),
            ]);
          }
        }
        
        // 启用选中的服务
        if (selectedProvider === 'nutcloud') {
          const status = await window.electronAPI.sync.getStatus();
          if (status.v3?.config?.username) {
            // 已配置过，启用特定类别
            await window.electronAPI.sync.enableCategory(item.category);
          } else {
            // 未配置，引导用户去配置
            onOpenSettings('nutcloud');
            return;
          }
        } else if (selectedProvider === 'google-calendar') {
          const configResult = await window.electronAPI.invoke('google-calendar:get-config');
          if (!configResult.success) {
            console.error('获取 Google Calendar 配置失败');
            return;
          }
          const currentConfig = configResult.data;
          if (currentConfig.connected && currentConfig.calendarId) {
            await window.electronAPI.invoke('google-calendar:save-config', {
              ...currentConfig,
              enabled: true,
            });
          } else {
            onOpenSettings('google-calendar');
            return;
          }
        } else if (selectedProvider === 'caldav') {
          const configResult = await window.electronAPI.invoke('caldav:get-config');
          if (!configResult.success) {
            console.error('获取 CalDAV 配置失败');
            return;
          }
          const currentConfig = configResult.data;
          if (currentConfig.serverUrl && currentConfig.username && currentConfig.calendarUrl) {
            await window.electronAPI.invoke('caldav:save-config', {
              ...currentConfig,
              enabled: true,
            });
          } else {
            onOpenSettings('caldav');
            return;
          }
        }
      }
      
      // 重新加载状态
      await loadBackendStatus();
    } catch (error) {
      console.error('切换同步状态失败:', error);
      showError(error, '切换同步状态失败');
    }
  };

  const getStatusIcon = (item) => {
    if (!item.enabled) {
      return <CloudOffIcon sx={iconWithColor.disabled} />;
    }
    
    if (item.selectedProvider === 'google-calendar' && !item.connected) {
      return <CloudOffIcon sx={iconWithColor.warning} />;
    }

    if (item.status === 'syncing') {
      return <CheckCircleIcon sx={iconWithColor.primary} />;
    }

    if (item.error) {
      return <ErrorIcon sx={iconWithColor.error} />;
    }

    return <CheckCircleIcon sx={iconWithColor.success} />;
  };

  const getStatusText = (item) => {
    if (!item.enabled) {
      return '未启用';
    }

    if (item.selectedProvider === 'google-calendar' && !item.connected) {
      return '未连接';
    }

    if (item.status === 'syncing') {
      return '同步中...';
    }

    if (item.error) {
      return '同步失败';
    }

    if (!item.lastSync) {
      return '从未同步';
    }

    const lastSync = new Date(item.lastSync);
    const now = new Date();
    const diffMinutes = Math.floor((now - lastSync) / (1000 * 60));

    if (diffMinutes < 1) return '刚刚';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}小时前`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}天前`;
  };

  return (
    <Box>
      <Typography variant="h6" sx={spacing.mb3}>
        同步总览
      </Typography>
      
      <List disablePadding>
        {syncRegistry.map((item, index) => (
          <ListItem
            key={item.id}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              mb: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              py: 2,
              px: 2.5,
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            {/* 图标 */}
            <Box 
              sx={{ 
                color: 'primary.main',
                ...flex.row,
                minWidth: 24,
              }}
            >
              {item.icon}
            </Box>

            {/* 功能模块名 */}
            <Box sx={combo.col80}>
              <Typography variant="body2" fontWeight="medium">
                {item.name}
              </Typography>
            </Box>

            {/* 服务选择器 */}
            <FormControl size="small" sx={combo.col160}>
              <Select
                value={item.selectedProvider}
                onChange={(e) => handleProviderChange(item, e.target.value)}
                sx={{ 
                  fontSize: '0.875rem',
                  '& .MuiSelect-select': {
                    py: 0.75,
                  }
                }}
              >
                {item.availableProviders.map((provider) => (
                  <MenuItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* 状态 */}
            <Box 
              sx={{ 
                ...flex.rowGap1,
                minWidth: 120,
                flex: 1,
              }}
            >
              {getStatusIcon(item)}
              <Typography variant="caption" color="text.secondary">
                {getStatusText(item)}
              </Typography>
            </Box>

            {/* 右侧操作 */}
            <Box 
              sx={{ 
                ...flex.rowGap1,
                ml: 'auto',
              }}
            >
              {/* 启用开关 */}
              <Switch
                size="small"
                checked={item.enabled}
                onChange={() => handleToggleEnabled(item)}
              />

              {/* 设置按钮 */}
              <IconButton
                size="small"
                onClick={() => onOpenSettings(item.selectedProvider)}
                aria-label="设置"
                sx={{
                  '&:hover': {
                    bgcolor: 'action.selected',
                  }
                }}
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Box>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

export default SyncRegistryView;
