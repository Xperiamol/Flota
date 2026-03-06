import React, { useState, useEffect } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  CircularProgress,
  Popover,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Divider,
  Badge
} from '@mui/material';
import {
  Cloud as CloudIcon,
  CloudDone as CloudDoneIcon,
  CloudOff as CloudOffIcon,
  Sync as SyncIcon,
  StickyNote2 as NoteIcon,
  Image as ImageIcon,
  Settings as SettingsIcon,
  CheckBox as TodoIcon
} from '@mui/icons-material';
import { scrollbar } from '../styles/commonStyles';
import { useStore } from '../store/useStore';
import { useTranslation } from '../utils/i18n';

/**
 * 同步状态指示器组件 - 新版
 * 显示四个独立同步模块：笔记、图片、设置、待办
 */
const SyncStatusIndicator = () => {
  const { t, language } = useTranslation();
  const loadNotes = useStore(state => state.loadNotes);
  const loadTodos = useStore(state => state.loadTodos);
  
  // 四个模块的同步状态
  const [modules, setModules] = useState({
    notes: { enabled: false, syncing: false, lastSync: null, error: null },
    images: { enabled: false, syncing: false, lastSync: null, error: null },
    settings: { enabled: false, syncing: false, lastSync: null, error: null },
    todos: { enabled: false, syncing: false, lastSync: null, error: null, provider: null }
  });

  const [anchorEl, setAnchorEl] = useState(null);

  useEffect(() => {
    loadSyncStatus();

    // 监听坚果云同步事件
    const removeStartListener = window.electronAPI?.sync?.onSyncStart?.(() => {
      setModules(prev => ({
        ...prev,
        notes: prev.notes.enabled ? { ...prev.notes, syncing: true } : prev.notes,
        images: prev.images.enabled ? { ...prev.images, syncing: true } : prev.images,
        settings: prev.settings.enabled ? { ...prev.settings, syncing: true } : prev.settings,
        todos: prev.todos.provider === 'nutcloud' && prev.todos.enabled ? { ...prev.todos, syncing: true } : prev.todos,
      }));
    });

    const removeCompleteListener = window.electronAPI?.sync?.onSyncComplete?.((result) => {
      const now = new Date();
      setModules(prev => ({
        ...prev,
        notes: prev.notes.enabled ? { ...prev.notes, syncing: false, lastSync: now, error: null } : prev.notes,
        images: prev.images.enabled ? { ...prev.images, syncing: false, lastSync: now, error: null } : prev.images,
        settings: prev.settings.enabled ? { ...prev.settings, syncing: false, lastSync: now, error: null } : prev.settings,
        todos: prev.todos.provider === 'nutcloud' && prev.todos.enabled ? { ...prev.todos, syncing: false, lastSync: now, error: null } : prev.todos,
      }));

      if (result.downloaded > 0 || result.deleted > 0) {
        loadNotes?.();
        loadTodos?.();
      }
    });

    const removeErrorListener = window.electronAPI?.sync?.onSyncError?.((error) => {
      setModules(prev => ({
        ...prev,
        notes: prev.notes.enabled ? { ...prev.notes, syncing: false, error: error.message } : prev.notes,
        images: prev.images.enabled ? { ...prev.images, syncing: false, error: error.message } : prev.images,
        settings: prev.settings.enabled ? { ...prev.settings, syncing: false, error: error.message } : prev.settings,
        todos: prev.todos.provider === 'nutcloud' && prev.todos.enabled ? { ...prev.todos, syncing: false, error: error.message } : prev.todos,
      }));
    });

    // 监听 Google Calendar 同步状态变化
    const checkCalendarStatus = async () => {
      try {
        const googleStatus = await window.electronAPI?.invoke?.('google-calendar:get-status');
        if (googleStatus?.success) {
          setModules(prev => {
            if (prev.todos.provider === 'google-calendar') {
              return {
                ...prev,
                todos: {
                  ...prev.todos,
                  syncing: googleStatus.data?.syncing || false,
                  lastSync: googleStatus.data?.lastSync ? new Date(googleStatus.data.lastSync) : prev.todos.lastSync,
                  error: googleStatus.data?.error || null
                }
              };
            }
            return prev;
          });
        }
      } catch (error) {
        console.error('检查 Google Calendar 状态失败:', error);
      }
    };

    // 监听 CalDAV 同步状态变化
    const checkCaldavStatus = async () => {
      try {
        const caldavStatus = await window.electronAPI?.invoke?.('caldav:get-status');
        if (caldavStatus?.success) {
          setModules(prev => {
            if (prev.todos.provider === 'caldav') {
              return {
                ...prev,
                todos: {
                  ...prev.todos,
                  syncing: caldavStatus.data?.syncing || false,
                  lastSync: caldavStatus.data?.lastSync ? new Date(caldavStatus.data.lastSync) : prev.todos.lastSync,
                  error: caldavStatus.data?.error || null
                }
              };
            }
            return prev;
          });
        }
      } catch (error) {
        console.error('检查 CalDAV 状态失败:', error);
      }
    };

    // 定期检查状态（10秒间隔，更快响应）
    const interval = setInterval(() => {
      loadSyncStatus();
      checkCalendarStatus();
      checkCaldavStatus();
    }, 10000);

    return () => {
      removeStartListener?.();
      removeCompleteListener?.();
      removeErrorListener?.();
      clearInterval(interval);
    };
  }, [loadNotes, loadTodos]);

  const loadSyncStatus = async () => {
    try {
      const nutcloudStatus = await window.electronAPI?.sync?.getStatus?.();
      const googleCalConfig = await window.electronAPI?.invoke?.('google-calendar:get-config');
      const caldavConfig = await window.electronAPI?.invoke?.('caldav:get-config');
      
      const v3 = nutcloudStatus?.v3 || {};
      const syncCategories = v3.config?.syncCategories || [];
      
      // 确定待办的提供商
      let todosProvider = null;
      let todosEnabled = false;
      let todosLastSync = null;
      let todosError = null;
      let todosSyncing = false;
      
      if (syncCategories.includes('todos')) {
        todosProvider = 'nutcloud';
        todosEnabled = v3.enabled || false;
        todosLastSync = v3.lastSyncTime ? new Date(v3.lastSyncTime) : null;
        todosError = v3.lastError || null;
        todosSyncing = v3.status === 'syncing';
      } else if (googleCalConfig?.success && googleCalConfig.data?.enabled) {
        todosProvider = 'google-calendar';
        todosEnabled = true;
        const googleStatus = await window.electronAPI?.invoke?.('google-calendar:get-status');
        todosLastSync = googleStatus?.data?.lastSync ? new Date(googleStatus.data.lastSync) : null;
        todosError = googleStatus?.data?.error || null;
        todosSyncing = googleStatus?.data?.syncing || false;
      } else if (caldavConfig?.success && caldavConfig.data?.enabled) {
        todosProvider = 'caldav';
        todosEnabled = true;
        const caldavStatus = await window.electronAPI?.invoke?.('caldav:get-status');
        todosLastSync = caldavStatus?.data?.lastSync ? new Date(caldavStatus.data.lastSync) : null;
        todosError = caldavStatus?.data?.error || null;
        todosSyncing = caldavStatus?.data?.syncing || false;
      }

      setModules({
        notes: {
          enabled: v3.enabled && syncCategories.includes('notes'),
          syncing: v3.enabled && syncCategories.includes('notes') && v3.status === 'syncing',
          lastSync: v3.lastSyncTime ? new Date(v3.lastSyncTime) : null,
          error: v3.enabled && syncCategories.includes('notes') ? v3.lastError : null
        },
        images: {
          enabled: v3.enabled && syncCategories.includes('images'),
          syncing: v3.enabled && syncCategories.includes('images') && v3.status === 'syncing',
          lastSync: v3.lastSyncTime ? new Date(v3.lastSyncTime) : null,
          error: v3.enabled && syncCategories.includes('images') ? v3.lastError : null
        },
        settings: {
          enabled: v3.enabled && syncCategories.includes('settings'),
          syncing: v3.enabled && syncCategories.includes('settings') && v3.status === 'syncing',
          lastSync: v3.lastSyncTime ? new Date(v3.lastSyncTime) : null,
          error: v3.enabled && syncCategories.includes('settings') ? v3.lastError : null
        },
        todos: {
          enabled: todosEnabled,
          syncing: todosSyncing,
          lastSync: todosLastSync,
          error: todosError,
          provider: todosProvider
        }
      });
    } catch (error) {
      console.error('加载同步状态失败:', error);
    }
  };

  const handleManualSync = async () => {
    try {
      // 立即设置同步中状态
      setModules(prev => ({
        ...prev,
        notes: prev.notes.enabled ? { ...prev.notes, syncing: true } : prev.notes,
        images: prev.images.enabled ? { ...prev.images, syncing: true } : prev.images,
        settings: prev.settings.enabled ? { ...prev.settings, syncing: true } : prev.settings,
        todos: prev.todos.enabled ? { ...prev.todos, syncing: true } : prev.todos,
      }));

      // 触发坚果云同步
      const hasNutcloudModule = modules.notes.enabled || modules.images.enabled || modules.settings.enabled || (modules.todos.enabled && modules.todos.provider === 'nutcloud');
      if (hasNutcloudModule) {
        await window.electronAPI?.sync?.manualSync?.();
      }
      
      // 触发日历同步
      if (modules.todos.enabled && modules.todos.provider !== 'nutcloud') {
        if (modules.todos.provider === 'caldav') {
          await window.electronAPI?.invoke?.('caldav:sync');
        } else if (modules.todos.provider === 'google-calendar') {
          await window.electronAPI?.invoke?.('google-calendar:sync');
        }
      }

      // 同步完成后立即刷新状态（避免等待轮询）
      setTimeout(() => loadSyncStatus(), 500);
    } catch (error) {
      console.error('手动同步失败:', error);
      // 出错时也刷新状态，清除转圈
      loadSyncStatus();
    }
  };

  const getAggregateState = () => {
    const enabledModules = Object.values(modules).filter(m => m.enabled);
    if (enabledModules.length === 0) return 'disabled';
    
    const hasError = enabledModules.some(m => m.error);
    const allError = enabledModules.every(m => m.error);
    const anySyncing = enabledModules.some(m => m.syncing);
    
    if (anySyncing) return 'syncing';
    if (allError) return 'error';
    if (hasError) return 'warning';
    return 'success';
  };

  const renderMainIcon = () => {
    const state = getAggregateState();

    if (state === 'syncing') {
      return <CircularProgress size={20} color="inherit" />;
    }

    switch (state) {
      case 'success':
        return <CloudDoneIcon fontSize="small" sx={{ color: '#4caf50' }} />;
      case 'warning':
        return (
          <Badge badgeContent="!" color="warning" sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 14, height: 14 } }}>
            <CloudIcon fontSize="small" sx={{ color: '#ff9800' }} />
          </Badge>
        );
      case 'error':
        return (
          <Badge badgeContent="!" color="error" sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 14, height: 14 } }}>
            <CloudIcon fontSize="small" sx={{ color: '#f44336' }} />
          </Badge>
        );
      case 'disabled':
      default:
        return <CloudOffIcon fontSize="small" sx={{ color: 'text.disabled' }} />;
    }
  };

  const getTooltipText = () => {
    const enabledModules = [];
    if (modules.notes.enabled) enabledModules.push({ name: t('cloudSync.notes'), ...modules.notes });
    if (modules.images.enabled) enabledModules.push({ name: t('cloudSync.images'), ...modules.images });
    if (modules.settings.enabled) enabledModules.push({ name: t('cloudSync.settings'), ...modules.settings });
    if (modules.todos.enabled) enabledModules.push({ name: t('cloudSync.todos'), ...modules.todos });
    
    if (enabledModules.length === 0) return t('cloudSync.syncNotEnabled');
    
    // 检查是否全部正常
    const allNormal = enabledModules.every(m => !m.syncing && !m.error);
    if (allNormal) return t('cloudSync.allReady');
    
    // 有异常时才显示详情
    const parts = enabledModules.map(m => 
      `${m.name}: ${m.syncing ? t('cloudSync.syncing') : m.error ? t('cloudSync.error') : t('cloudSync.ready')}`
    );
    return parts.join(' | ');
  };

  const renderModuleStatus = (module, icon, name) => {
    if (!module.enabled) return null;
    
    return (
      <ListItem>
        <ListItemIcon sx={{ minWidth: 40 }}>
          {module.syncing ? <CircularProgress size={20} /> : icon}
        </ListItemIcon>
        <ListItemText
          primary={name}
          secondary={
            module.error 
              ? <Typography variant="caption" color="error">{module.error}</Typography>
              : module.lastSync 
                ? `${t('cloudSync.lastSync')}: ${new Date(module.lastSync).toLocaleTimeString(language)}`
                : t('cloudSync.waitingFirstSync')
          }
          secondaryTypographyProps={{ component: 'div' }}
        />
        <Chip
          label={module.syncing ? t('cloudSync.syncing') : module.error ? t('cloudSync.error') : t('cloudSync.ready')}
          size="small"
          color={module.syncing ? 'info' : module.error ? 'error' : 'success'}
          sx={{ ml: 1 }}
        />
      </ListItem>
    );
  };

  return (
    <>
      <Tooltip title={getTooltipText()}>
        <Box 
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            width: 32,
            height: 32,
            '&:hover': { bgcolor: 'action.hover' }
          }}
        >
          {renderMainIcon()}
        </Box>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: (theme) => ({
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(30, 41, 59, 0.85)'
              : 'rgba(255, 255, 255, 0.85)',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '8px',
            maxHeight: '80vh'
          })
        }}
      >
        <Box sx={{ p: 2, minWidth: 320, maxHeight: '70vh', overflow: 'auto', ...scrollbar.auto }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6">{t('cloudSync.syncStatus')}</Typography>
            <IconButton
              size="small"
              onClick={handleManualSync}
              disabled={!Object.values(modules).some(m => m.enabled) || Object.values(modules).some(m => m.syncing)}
              title={t('cloudSync.syncNow')}
            >
              <SyncIcon />
            </IconButton>
          </Box>

          <List dense disablePadding>
            {renderModuleStatus(modules.notes, <NoteIcon />, t('cloudSync.notes'))}
            {renderModuleStatus(modules.images, <ImageIcon />, t('cloudSync.images'))}
            {renderModuleStatus(modules.settings, <SettingsIcon />, t('cloudSync.settings'))}
            {modules.todos.enabled && (
              <>
                {Object.values(modules).filter(m => m.enabled).length > 1 && <Divider sx={{ my: 1 }} />}
                <ListItem>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {modules.todos.syncing ? <CircularProgress size={20} /> : <TodoIcon />}
                  </ListItemIcon>
                  <ListItemText
                    primary={`${t('cloudSync.todos')} (${modules.todos.provider === 'nutcloud' ? t('cloudSync.nutcloud') : modules.todos.provider === 'google-calendar' ? 'Google' : 'CalDAV'})`}
                    secondary={
                      modules.todos.error 
                        ? <Typography variant="caption" color="error">{modules.todos.error}</Typography>
                        : modules.todos.lastSync 
                          ? `${t('cloudSync.lastSync')}: ${new Date(modules.todos.lastSync).toLocaleTimeString(language)}`
                          : t('cloudSync.waitingFirstSync')
                    }
                    secondaryTypographyProps={{ component: 'div' }}
                  />
                  <Chip
                    label={modules.todos.syncing ? t('cloudSync.syncing') : modules.todos.error ? t('cloudSync.error') : t('cloudSync.ready')}
                    size="small"
                    color={modules.todos.syncing ? 'info' : modules.todos.error ? 'error' : 'success'}
                    sx={{ ml: 1 }}
                  />
                </ListItem>
              </>
            )}
          </List>

          {!Object.values(modules).some(m => m.enabled) && (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <CloudOffIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                {t('cloudSync.noModulesEnabled')}
              </Typography>
            </Box>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default SyncStatusIndicator;
