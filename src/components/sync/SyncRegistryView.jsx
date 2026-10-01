import { useState, useEffect } from 'react';
import { useError } from '../common/ErrorProvider';
import {
  Box,
  Typography,
  List,
  ListItem,
  Switch,
  Select,
  MenuItem,
  FormControl,
  Button,
  alpha,
} from '@mui/material';
import {
  CheckBox as TodoIcon,
  Settings as SettingsIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  CloudOff as CloudOffIcon,
  Image as ImageIcon,
  Tune as TuneIcon,
  Description as DescriptionIcon,
  AttachFile as AttachFileIcon,
  WidgetsRounded as WidgetIcon,
} from '../common/AppIcons';
import { iconWithColor, flex, settingsRowSx } from '../../styles/commonStyles';
import PanelIconButton from '../common/PanelIconButton';
import { NUTSTORE_BASE_URL, getWebdavProviderName } from './webdavProvider';

const SyncRegistryView = ({ onOpenSettings }) => {
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
    const nutcloudV3 = nutcloud?.v3;
    const nutcloudServiceEnabled = !!nutcloudV3?.enabled;
    const nutcloudAccountConfigured = !!nutcloudV3?.accountConfigured;
    const webdavName = getWebdavProviderName(nutcloudV3?.config?.baseUrl || NUTSTORE_BASE_URL);

    const buildNutcloudCategory = ({ id, name, icon, category }) => {
      const categoryEnabled = nutcloudV3?.config?.syncCategories?.includes(category) || false;
      return {
        id,
        name,
        icon,
        type: 'nutcloud-category',
        category,
        selectedProvider: 'nutcloud',
        availableProviders: [
          { id: 'nutcloud', name: webdavName },
        ],
        enabled: nutcloudServiceEnabled && categoryEnabled,
        categoryEnabled,
        serviceEnabled: nutcloudServiceEnabled,
        accountConfigured: nutcloudAccountConfigured,
        controlDisabled: !nutcloudServiceEnabled,
        status: nutcloudV3?.status || 'idle',
        lastSync: nutcloudV3?.lastSyncTime || null,
        error: nutcloudV3?.lastError || null,
      };
    };
    
    const registry = [
      buildNutcloudCategory({
        id: 'notes',
        name: '笔记',
        icon: <DescriptionIcon />,
        category: 'notes',
      }),
      buildNutcloudCategory({
        id: 'images',
        name: '图片',
        icon: <ImageIcon />,
        category: 'images',
      }),
      buildNutcloudCategory({
        id: 'attachments',
        name: '附件',
        icon: <AttachFileIcon />,
        category: 'attachments',
      }),
      buildNutcloudCategory({
        id: 'settings',
        name: '设置项',
        icon: <TuneIcon />,
        category: 'settings',
      }),
      buildNutcloudCategory({
        id: 'widgets',
        name: '组件与组件数据',
        icon: <WidgetIcon />,
        category: 'widgets',
      }),
      {
        id: 'todos',
        name: '待办',
        icon: <TodoIcon />,
        type: 'calendar',
        selectedProvider: providerSelections.todos,
        availableProviders: [
          { id: 'nutcloud', name: webdavName },
          { id: 'google-calendar', name: 'Google Calendar' },
          { id: 'caldav', name: 'CalDAV' },
        ],
        category: 'todos',
        // 显示当前选中服务的状态
        enabled: providerSelections.todos === 'nutcloud'
          ? (nutcloudServiceEnabled && (nutcloudV3?.config?.syncCategories?.includes('todos') || false))
          : providerSelections.todos === 'google-calendar' 
          ? (googleCal?.data?.enabled || false)
          : (caldav?.data?.enabled || false),
        categoryEnabled: providerSelections.todos === 'nutcloud'
          ? (nutcloudV3?.config?.syncCategories?.includes('todos') || false)
          : undefined,
        serviceEnabled: providerSelections.todos === 'nutcloud' ? nutcloudServiceEnabled : true,
        accountConfigured: providerSelections.todos === 'nutcloud' ? nutcloudAccountConfigured : true,
        controlDisabled: providerSelections.todos === 'nutcloud' && !nutcloudServiceEnabled,
        connected: providerSelections.todos === 'google-calendar' ? googleCal?.data?.connected : undefined,
        status: providerSelections.todos === 'nutcloud'
          ? (nutcloudV3?.status || 'idle')
          : providerSelections.todos === 'google-calendar'
          ? (googleCalStatus?.data?.syncing ? 'syncing' : 'idle')
          : (caldavStatus?.data?.syncing ? 'syncing' : 'idle'),
        lastSync: providerSelections.todos === 'nutcloud'
          ? nutcloudV3?.lastSyncTime
          : providerSelections.todos === 'google-calendar' 
          ? googleCalStatus?.data?.lastSync 
          : caldavStatus?.data?.lastSync,
        error: providerSelections.todos === 'nutcloud'
          ? (nutcloudV3?.lastError || null)
          : providerSelections.todos === 'google-calendar'
          ? (googleCalStatus?.data?.error || null)
          : (caldavStatus?.data?.error || null),
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
    if (item.selectedProvider === 'nutcloud' && !item.serviceEnabled) {
      return <CloudOffIcon sx={item.accountConfigured ? iconWithColor.warning : iconWithColor.disabled} />;
    }

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
    if (item.selectedProvider === 'nutcloud' && !item.serviceEnabled) {
      const name = item.availableProviders?.find((p) => p.id === 'nutcloud')?.name || 'WebDAV';
      return item.accountConfigured ? `${name}已停用` : `${name}未配置`;
    }

    if (!item.enabled) {
      return '未参与同步';
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

  // 所有数据类型都还没有可用的同步服务时，给一个明确的入口，而不是一排「未配置」
  const nothingConfigured = syncRegistry.length > 0 && syncRegistry.every((item) => (
    item.selectedProvider === 'nutcloud' ? !item.accountConfigured : !item.connected && !item.enabled
  ));

  return (
    <Box sx={{ px: 1 }}>
      {nothingConfigured && (
        <Box sx={(theme) => ({
          display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, px: 2, py: 1.5, borderRadius: '12px',
          bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.07),
        })}>
          <CloudOffIcon sx={{ color: 'primary.main', fontSize: 20 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>还没有配置同步服务</Typography>
            <Typography variant="caption" color="text.secondary">配置坚果云或自建 WebDAV 后，笔记、图片、待办等会在设备之间同步</Typography>
          </Box>
          <Button size="small" variant="contained" onClick={() => onOpenSettings('nutcloud')} sx={{ flexShrink: 0, borderRadius: '8px' }}>
            配置同步
          </Button>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        开关只控制各类数据是否参与同步；账号、自动同步和密码在对应服务的设置里。
      </Typography>

      {/* 一行一个数据类型，行之间用细分割线，与其他设置页一致（不再每行一块白底） */}
      <List disablePadding>
        {syncRegistry.map((item) => (
          <ListItem
            key={item.id}
            disableGutters
            sx={(theme) => ({
              ...settingsRowSx(theme),
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 0.5,
            })}
          >
            <Box sx={(theme) => ({
              width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'primary.main', bgcolor: theme.custom?.surface?.inset,
              '& .MuiSvgIcon-root': { fontSize: 18 },
            })}>
              {item.icon}
            </Box>

            {/* 名称 + 状态 */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{item.name}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, '& .MuiSvgIcon-root': { fontSize: 14 } }}>
                {getStatusIcon(item)}
                <Typography variant="caption" color="text.secondary" noWrap>{getStatusText(item)}</Typography>
              </Box>
            </Box>

            {/* 服务：只有一个可选时直接显示名称 */}
            {item.availableProviders.length > 1 ? (
              <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
                <Select
                  value={item.selectedProvider}
                  onChange={(e) => handleProviderChange(item, e.target.value)}
                  sx={{ fontSize: '0.8125rem', '& .MuiSelect-select': { py: 0.625 } }}
                >
                  {item.availableProviders.map((provider) => (
                    <MenuItem key={provider.id} value={provider.id}>{provider.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, minWidth: 64, textAlign: 'right' }}>
                {item.availableProviders[0]?.name}
              </Typography>
            )}

            <Box sx={{ ...flex.rowGap1, flexShrink: 0 }}>
              {/* 数据类型同步开关，不是账号总开关 */}
              <Switch
                checked={item.enabled}
                onChange={() => handleToggleEnabled(item)}
                disabled={item.controlDisabled}
                inputProps={{ 'aria-label': `${item.name}参与同步` }}
              />
              <PanelIconButton title={`${item.availableProviders.find((p) => p.id === item.selectedProvider)?.name || ''}设置`}
                onClick={() => onOpenSettings(item.selectedProvider)} stopDrag={false}>
                <SettingsIcon />
              </PanelIconButton>
            </Box>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

export default SyncRegistryView;
