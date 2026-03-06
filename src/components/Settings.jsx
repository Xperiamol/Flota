import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import {
    Box,
    Typography,
    Paper,
    Tabs,
    Tab,
    Switch,
    FormControlLabel,
    Button,
    TextField,
    Alert,
    Snackbar,
    Divider,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    LinearProgress,
    Chip,
    Tooltip
} from '@mui/material';
import {
    Settings as SettingsIcon,
    Palette as PaletteIcon,
    GetApp as ImportIcon,
    Keyboard as KeyboardIcon,
    Brightness4,
    Brightness7,
    Computer,
    Launch,
    AccountCircle,
    PhotoCamera,
    Delete,
    Restore,
    Warning as WarningIcon,
    Info as InfoIcon,
    Cloud as CloudIcon,
    Psychology as AIIcon,
    Memory as MemoryIcon,
    CalendarToday as CalendarIcon,
    Wifi as WifiIcon,
    Code as CodeIcon,
    Visibility as VisibilityIcon,
    Language as LanguageIcon
} from '@mui/icons-material';
import { useStore } from '../store/useStore';
import ShortcutInput from './ShortcutInput';
import CloudSyncSettings from './CloudSyncSettings';
import AISettings from './AISettings';
import STTSettings from './STTSettings';
import Mem0Settings from './Mem0Settings';
import ProxySettings from './ProxySettings';
import MCPSettings from './MCPSettings';
import ObsidianImportExport from './ObsidianImportExport/ObsidianImportExport';
import { SUPPORTED_LANGUAGES, t, initI18n } from '../utils/i18n';
import {
    DEFAULT_SHORTCUTS,
    SHORTCUT_CATEGORIES,
    getShortcutsByCategory,
    checkShortcutConflict,
    resetShortcutsToDefault
} from '../utils/shortcutUtils';
import shortcutManager from '../utils/ShortcutManager';
import { useError } from './ErrorProvider';

function TabPanel({ children, value, index, ...other }) {
    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`settings-tabpanel-${index}`}
            aria-labelledby={`settings-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

function SettingRow({ primary, secondary, action }) {
    return (
        <ListItem>
            <ListItemText primary={primary} secondary={secondary} />
            <ListItemSecondaryAction>
                {action}
            </ListItemSecondaryAction>
        </ListItem>
    );
}

function SettingFullRow({ children }) {
    return (
        <ListItem>
            <Box sx={{ width: '100%' }}>
                {children}
            </Box>
        </ListItem>
    );
}

const Settings = () => {
    const { showError, showSuccess } = useError();
    const { theme, setTheme, setPrimaryColor, setUserAvatar, setUserName, titleBarStyle, setTitleBarStyle, editorMode, setEditorMode, language, setLanguage, defaultMinibarMode, setDefaultMinibarMode, maskOpacity, setMaskOpacity, christmasMode, setChristmasMode } = useStore();
    const settingsTabValue = useStore((state) => state.settingsTabValue);
    const [settings, setSettings] = useState({
        theme: 'system',
        customThemeColor: '#1976d2',
        autoLaunch: false,
        userAvatar: '',
        userName: '',
        titleBarStyle: 'windows',
        language: 'zh-CN',
        defaultMinibarMode: false,
        maskOpacity: 'medium',
        christmasMode: false,
        mcpEnabled: false
    });
    const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
    const [shortcutConflicts, setShortcutConflicts] = useState({});
    const [importDialog, setImportDialog] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [importStatus, setImportStatus] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    useEffect(() => {
        // 加载设置
        loadSettings();
        loadShortcuts();
    }, []);

    const loadSettings = async () => {
        try {
            if (window.electronAPI?.settings) {
                const result = await window.electronAPI.settings.getAll();
                if (result && result.success && result.data) {
                    // 确保布尔值类型正确
                    const normalizedData = { ...result.data };
                    if (normalizedData.autoLaunch !== undefined) {
                        normalizedData.autoLaunch = Boolean(normalizedData.autoLaunch);
                    }
                    if (normalizedData.christmasMode !== undefined) {
                        normalizedData.christmasMode = Boolean(normalizedData.christmasMode);
                    }
                    if (normalizedData.mcpEnabled !== undefined) {
                        normalizedData.mcpEnabled = Boolean(normalizedData.mcpEnabled);
                    }
                    setSettings(prev => ({ ...prev, ...normalizedData }));
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            showError(error, '加载设置失败');
        }
    };

    const loadShortcuts = async () => {
        try {
            // 如果ShortcutManager已经初始化且有配置，直接使用
            if (shortcutManager.isInitialized && shortcutManager.shortcuts && Object.keys(shortcutManager.shortcuts).length > 0) {
                console.log('使用已初始化的快捷键配置');
                setShortcuts(shortcutManager.shortcuts);
                return;
            }

            // 否则才初始化
            await shortcutManager.initialize();
            // 确保shortcuts不为空对象
            if (shortcutManager.shortcuts && Object.keys(shortcutManager.shortcuts).length > 0) {
                setShortcuts(shortcutManager.shortcuts);
            } else {
                console.warn('ShortcutManager shortcuts is empty, using default shortcuts');
                setShortcuts(DEFAULT_SHORTCUTS);
            }
        } catch (error) {
            console.error('Failed to load shortcuts:', error);
            showError(error, '加载快捷键失败');
            setShortcuts(DEFAULT_SHORTCUTS);
        }
    };

    // 设置处理器配置 - 遵循开闭原则（OCP）
    const settingHandlers = {
        language: {
            syncGlobalState: setLanguage,
            beforeSave: async (value) => {
                initI18n(value); // 更新i18n系统
            }
        },
        autoLaunch: {
            customSave: async (value) => {
                const result = await window.electronAPI.settings.setAutoLaunch(value);
                if (!result.success) {
                    throw new Error(t('settings.autoLaunchFailed') + result.error);
                }
            }
        },
        defaultMinibarMode: {
            syncGlobalState: setDefaultMinibarMode
        },
        maskOpacity: {
            syncGlobalState: setMaskOpacity
        },
        christmasMode: {
            syncGlobalState: setChristmasMode
        },
        theme: {
            syncGlobalState: setTheme
        },
        customThemeColor: {
            syncGlobalState: setPrimaryColor
        },
        titleBarStyle: {
            syncGlobalState: setTitleBarStyle
        },
        userName: {
            syncGlobalState: setUserName
        },
        userAvatar: {
            syncGlobalState: setUserAvatar
        }
    };

    // 统一的设置更改处理器 - 遵循单一职责原则（SRP）
    const handleSettingChange = async (key, value) => {
        try {
            // 1. 更新本地状态
            setSettings(prev => ({ ...prev, [key]: value }));

            const handler = settingHandlers[key] || {};

            // 2. 执行前置钩子
            if (handler.beforeSave) {
                await handler.beforeSave(value);
            }

            // 3. 保存设置（自定义保存或默认保存）
            if (handler.customSave) {
                await handler.customSave(value);
            } else if (window.electronAPI?.settings) {
                await window.electronAPI.settings.set(key, value);
            }

            // 4. 同步到全局状态
            if (handler.syncGlobalState) {
                handler.syncGlobalState(value);
            }

            // 5. 显示成功提示
            showSnackbar(t('settings.settingsSaved'), 'success');
        } catch (error) {
            console.error('Failed to save setting:', error);
            showError(error, '保存设置失败');
            // 恢复原状态
            setSettings(prev => ({ ...prev, [key]: !value }));
            showSnackbar(error.message || t('settings.saveSettingsFailed'), 'error');
        }
    };

    const handleImportData = async () => {
        try {
            setImportDialog(true);
            setImportProgress(0);
            setImportStatus('选择文件...');

            if (window.electronAPI?.dataImport) {
                const filePath = await window.electronAPI.dataImport.selectFile();
                if (!filePath) {
                    setImportDialog(false);
                    return;
                }

                setImportStatus('正在导入数据...');
                setImportProgress(25);

                const result = await window.electronAPI.dataImport.importNotes({ filePath });

                setImportProgress(100);
                setImportStatus(`导入完成！成功导入 ${result.count} 条笔记`);

                setTimeout(() => {
                    setImportDialog(false);
                    showSnackbar(t('settings.importSuccess', { count: result.count }), 'success');
                }, 2000);
            }
        } catch (error) {
            console.error('Import failed:', error);
            showError(error, '导入失败');
            setImportStatus('导入失败：' + error.message);
            setImportProgress(0);
            showSnackbar(t('settings.importFailed'), 'error');
        }
    };



    const showSnackbar = (message, severity = 'info') => {
        setSnackbar({ open: true, message, severity });
    };

    const closeSnackbar = () => {
        setSnackbar(prev => ({ ...prev, open: false }));
    };

    // 头像管理 - 遵循单一职责原则
    const handleAvatarChange = async () => {
        try {
            if (!window.electronAPI?.system) return;

            const result = await window.electronAPI.system.showOpenDialog({
                title: '选择头像图片',
                filters: [
                    { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
                ],
                properties: ['openFile']
            });

            if (result && !result.canceled && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                const base64Image = await window.electronAPI.system.readImageAsBase64(filePath);
                await handleSettingChange('userAvatar', base64Image);
                showSnackbar(t('settings.avatarUpdateSuccess'), 'success');
            }
        } catch (error) {
            console.error('Failed to change avatar:', error);
            showSnackbar(t('settings.avatarUpdateFailed'), 'error');
        }
    };

    const handleAvatarDelete = async () => {
        try {
            await handleSettingChange('userAvatar', '');
            showSnackbar(t('settings.avatarDeleted'), 'success');
        } catch (error) {
            console.error('Failed to delete avatar:', error);
            showSnackbar(t('settings.avatarDeleteFailed'), 'error');
        }
    };

    // 快捷键管理 - 提取公共逻辑，遵循DRY原则
    const saveShortcut = async (shortcutId, updatedShortcuts) => {
        try {
            // 1. 通过ShortcutManager更新前端配置
            shortcutManager.updateShortcuts(updatedShortcuts);

            // 2. 通知主进程更新快捷键配置（主进程会保存完整配置到数据库）
            const shortcut = updatedShortcuts[shortcutId];
            if (window.electronAPI?.shortcuts) {
                // 调用 shortcut:update IPC handler，传递完整配置
                const result = await window.electronAPI.shortcuts.update(
                    shortcutId,
                    shortcut.currentKey,
                    shortcut.action,
                    updatedShortcuts // 传递完整配置，让主进程保存
                );

                if (!result.success) {
                    console.error(`更新快捷键 ${shortcutId} 失败:`, result.error);
                    throw new Error(result.error || '更新快捷键失败');
                }

                console.log(`快捷键 ${shortcutId} 已成功更新并保存`);
            }
        } catch (error) {
            console.error(`保存快捷键 ${shortcutId} 失败:`, error);
            showError(error, `保存快捷键失败`);
            throw error;
        }
    };

    const handleShortcutChange = async (shortcutId, newKey) => {
        try {
            // 1. 检查冲突
            const conflicts = checkShortcutConflict(newKey, shortcuts, shortcutId);
            if (conflicts.length > 0) {
                setShortcutConflicts(prev => ({ ...prev, [shortcutId]: conflicts }));
                showSnackbar(t('settings.shortcutConflict', { name: conflicts[0].name }), 'warning');
                return;
            }

            // 2. 清除冲突状态
            setShortcutConflicts(prev => {
                const newConflicts = { ...prev };
                delete newConflicts[shortcutId];
                return newConflicts;
            });

            // 3. 更新快捷键
            const updatedShortcuts = {
                ...shortcuts,
                [shortcutId]: {
                    ...shortcuts[shortcutId],
                    currentKey: newKey
                }
            };

            // 4. 保存快捷键（先保存再更新UI，确保数据一致性）
            await saveShortcut(shortcutId, updatedShortcuts);

            // 5. 保存成功后才更新UI状态
            setShortcuts(updatedShortcuts);

            showSnackbar(t('settings.shortcutUpdated'), 'success');
        } catch (error) {
            console.error('Failed to update shortcut:', error);
            showSnackbar(t('settings.shortcutUpdateFailed'), 'error');
            // 保存失败，重新加载以恢复正确状态
            await loadShortcuts();
        }
    };

    const handleResetAllShortcuts = async () => {
        try {
            const defaultShortcuts = resetShortcutsToDefault();
            setShortcuts(defaultShortcuts);
            setShortcutConflicts({});

            if (window.electronAPI?.settings) {
                await window.electronAPI.settings.set('shortcuts', defaultShortcuts);
            }

            // 通知主进程重置所有全局快捷键
            if (window.electronAPI?.shortcuts) {
                await window.electronAPI.shortcuts.resetAll();
            }

            showSnackbar(t('settings.shortcutsReset'), 'success');
        } catch (error) {
            console.error('Failed to reset shortcuts:', error);
            showSnackbar(t('settings.shortcutsResetFailed'), 'error');
        }
    };

    const chipRowSx = { display: 'flex', gap: 1 };
    const themeOptions = [
        { value: 'light', icon: <Brightness7 />, label: t('settings.themeLight') },
        { value: 'dark', icon: <Brightness4 />, label: t('settings.themeDark') },
        { value: 'system', icon: <Computer />, label: t('settings.themeSystem') },
    ];
    const editorModeOptions = [
        { value: 'markdown', icon: <CodeIcon />, label: t('settings.editorMarkdown') },
        { value: 'wysiwyg', icon: <VisibilityIcon />, label: t('settings.editorWysiwyg') },
    ];

    const themeColorPresets = [
        { name: '经典蓝', color: '#0F4C81' },
        { name: '珊瑚橙', color: '#FF6F61' },
        { name: '紫外光', color: '#5F4B8B' },
        { name: '草木绿', color: '#88B04B' },
        { name: '水晶粉', color: '#F7CAC9' },
        { name: '宁静蓝', color: '#91A8D0' },
        { name: '活力橙', color: '#DD4124' },
        { name: '辐射兰', color: '#9B1B30' },
    ];
    const maskOpacityOptions = [
        { value: 'none', label: '无遮罩' },
        { value: 'light', label: '轻度' },
        { value: 'medium', label: '中度' },
        { value: 'heavy', label: '重度' },
    ];
    const titleBarOptions = [
        { value: 'mac', label: t('settings.titleBarMac') },
        { value: 'windows', label: t('settings.titleBarWindows') },
    ];

    const getColorPresetSx = (presetColor) => {
        const selected = settings.customThemeColor === presetColor;
        return {
            width: 36,
            height: 36,
            borderRadius: 1,
            backgroundColor: presetColor,
            cursor: 'pointer',
            border: selected ? '3px solid' : '2px solid',
            borderColor: selected ? 'primary.main' : 'divider',
        };
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'row' }}>
            {/* 内容区域 */}
            <Box sx={{ flex: 1, overflow: 'auto' }}>
                {/* 通用设置 */}
                <TabPanel value={settingsTabValue} index={0}>
                    <List>
                        <SettingRow
                            primary={t('settings.autoLaunch')}
                            secondary={t('settings.autoLaunchDesc')}
                            action={(
                                <Switch
                                    checked={settings.autoLaunch}
                                    onChange={(e) => handleSettingChange('autoLaunch', e.target.checked)}
                                />
                            )}
                        />

                        <Divider />

                        <SettingRow
                            primary={t('settings.theme')}
                            secondary={t('settings.themeDesc')}
                            action={(
                                <Box sx={chipRowSx}>
                                    {themeOptions.map((opt) => (
                                        <Chip
                                            key={opt.value}
                                            icon={opt.icon}
                                            label={opt.label}
                                            variant={settings.theme === opt.value ? 'filled' : 'outlined'}
                                            onClick={() => handleSettingChange('theme', opt.value)}
                                            size="small"
                                            color={settings.theme === opt.value ? 'primary' : 'default'}
                                        />
                                    ))}
                                </Box>
                            )}
                        />

                        <Divider />

                        <SettingRow
                            primary={t('settings.editorMode')}
                            secondary={t('settings.editorModeDesc')}
                            action={(
                                <Box sx={chipRowSx}>
                                    {editorModeOptions.map((opt) => (
                                        <Chip
                                            key={opt.value}
                                            icon={opt.icon}
                                            label={opt.label}
                                            variant={editorMode === opt.value ? 'filled' : 'outlined'}
                                            onClick={() => setEditorMode(opt.value)}
                                            size="small"
                                            color={editorMode === opt.value ? 'primary' : 'default'}
                                        />
                                    ))}
                                </Box>
                            )}
                        />

                        <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
                            <Typography variant="caption">
                                {t('settings.editorWarning')}
                            </Typography>
                        </Alert>

                        <Divider />

                        <SettingRow
                            primary={t('settings.language')}
                            secondary={t('settings.languageDesc')}
                            action={(
                                <Box sx={chipRowSx}>
                                    {SUPPORTED_LANGUAGES.map(lang => (
                                        <Chip
                                            key={lang.code}
                                            icon={<LanguageIcon />}
                                            label={lang.nativeName}
                                            variant={settings.language === lang.code ? 'filled' : 'outlined'}
                                            onClick={() => handleSettingChange('language', lang.code)}
                                            size="small"
                                            color={settings.language === lang.code ? 'primary' : 'default'}
                                        />
                                    ))}
                                </Box>
                            )}
                        />

                        <Divider />

                        <SettingRow
                            primary={t('settings.defaultMinibarMode')}
                            secondary={t('settings.defaultMinibarModeDesc')}
                            action={(
                                <Switch
                                    checked={settings.defaultMinibarMode}
                                    onChange={(e) => handleSettingChange('defaultMinibarMode', e.target.checked)}
                                />
                            )}
                        />

                    </List>
                </TabPanel>

                {/* 外观设置 */}
                <TabPanel value={settingsTabValue} index={1}>
                    <List>
                        {/* 头像设置 */}
                        <ListItem>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                                <Box sx={{ position: 'relative' }}>
                                    {settings.userAvatar ? (
                                        <Box
                                            component="img"
                                            src={settings.userAvatar}
                                            alt={t('settings.userAvatar')}
                                            sx={{
                                                width: 60,
                                                height: 60,
                                                borderRadius: '50%',
                                                objectFit: 'cover',
                                                border: '2px solid',
                                                borderColor: 'primary.main'
                                            }}
                                        />
                                    ) : (
                                        <AccountCircle
                                            sx={{
                                                fontSize: 60,
                                                color: 'text.secondary'
                                            }}
                                        />
                                    )}
                                </Box>
                                <Box sx={{ flex: 1 }}>
                                    <ListItemText
                                        primary={t('settings.userAvatar')}
                                        secondary={settings.userAvatar ? t('settings.avatarChangeDesc') : t('settings.avatarSelectDesc')}
                                    />
                                </Box>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        startIcon={<PhotoCamera />}
                                        onClick={handleAvatarChange}
                                    >
                                        {settings.userAvatar ? t('settings.change') : t('settings.select')}
                                    </Button>
                                    {settings.userAvatar && (
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            startIcon={<Delete />}
                                            onClick={handleAvatarDelete}
                                            color="error"
                                        >
                                            {t('settings.delete')}
                                        </Button>
                                    )}
                                </Box>
                            </Box>
                        </ListItem>

                        <Divider />

                        {/* 用户名设置 */}
                        <SettingFullRow>
                            <TextField
                                fullWidth
                                size="small"
                                label={t('settings.userName')}
                                value={settings.userName}
                                onChange={(e) => {
                                    const newName = e.target.value;
                                    setSettings(prev => ({ ...prev, userName: newName }));
                                }}
                                onBlur={(e) => {
                                    const newName = e.target.value;
                                    handleSettingChange('userName', newName);
                                    setUserName(newName);
                                }}
                                placeholder={t('settings.userNamePlaceholder')}
                                helperText={t('settings.userNameHelper')}
                            />
                        </SettingFullRow>

                        <Divider />

                        <SettingFullRow>
                            <ListItemText
                                primary={t('settings.themeColor')}
                                secondary={t('settings.themeColorDesc')}
                                sx={{ mb: 2 }}
                            />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                    {themeColorPresets.map((preset) => (
                                        <Tooltip key={preset.color} title={preset.name}>
                                            <Box
                                                onClick={() => handleSettingChange('customThemeColor', preset.color)}
                                                sx={getColorPresetSx(preset.color)}
                                            />
                                        </Tooltip>
                                    ))}
                                </Box>

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        {t('settings.customColor')}
                                    </Typography>
                                    <TextField
                                        type="color"
                                        value={settings.customThemeColor}
                                        onChange={(e) => handleSettingChange('customThemeColor', e.target.value)}
                                        size="small"
                                        sx={{ width: 60 }}
                                    />
                                </Box>
                            </Box>
                        </SettingFullRow>

                        <Divider />

                        {/* 背景遮罩透明度 */}
                        <SettingFullRow>
                            <ListItemText
                                primary="背景遮罩"
                                secondary="调节内容区域的背景遮罩强度"
                                sx={{ mb: 2 }}
                            />
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {maskOpacityOptions.map((option) => (
                                    <Chip
                                        key={option.value}
                                        label={option.label}
                                        variant={settings.maskOpacity === option.value ? 'filled' : 'outlined'}
                                        color={settings.maskOpacity === option.value ? 'primary' : 'default'}
                                        onClick={() => handleSettingChange('maskOpacity', option.value)}
                                        sx={{ minWidth: 80 }}
                                    />
                                ))}
                            </Box>
                        </SettingFullRow>

                        <Divider />

                        <SettingRow
                            primary="圣诞模式"
                            secondary="来点惊喜如何？（不可与主题外观插件同时开启）"
                            action={(
                                <Switch
                                    checked={settings.christmasMode || false}
                                    onChange={(e) => handleSettingChange('christmasMode', e.target.checked)}
                                />
                            )}
                        />

                        <Divider />

                        <SettingRow
                            primary={t('settings.titleBarStyle')}
                            secondary={t('settings.titleBarStyleDesc')}
                            action={(
                                <Box sx={chipRowSx}>
                                    {titleBarOptions.map((opt) => (
                                        <Chip
                                            key={opt.value}
                                            label={opt.label}
                                            variant={titleBarStyle === opt.value ? 'filled' : 'outlined'}
                                            onClick={() => {
                                                setTitleBarStyle(opt.value);
                                                handleSettingChange('titleBarStyle', opt.value);
                                            }}
                                            size="small"
                                        />
                                    ))}
                                </Box>
                            )}
                        />

                    </List>
                </TabPanel>

                {/* 快捷键设置 */}
                <TabPanel value={settingsTabValue} index={2}>
                    <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6">{t('settings.shortcuts')}</Typography>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Restore />}
                            onClick={handleResetAllShortcuts}
                        >
                            {t('settings.resetAll')}
                        </Button>
                    </Box>

                    {(() => {
                        const currentShortcuts = shortcuts && Object.keys(shortcuts).length > 0 ? shortcuts : DEFAULT_SHORTCUTS;
                        const grouped = getShortcutsByCategory(currentShortcuts);

                        return Object.entries(SHORTCUT_CATEGORIES).map(([categoryKey, category]) => {
                            const categoryShortcuts = grouped[categoryKey] || [];
                            if (categoryShortcuts.length === 0) return null;

                            return (
                                <Box key={categoryKey} sx={{ mb: 3 }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>
                                        {category.name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                                        {category.description}
                                    </Typography>

                                    <List>
                                        {categoryShortcuts.map((config, index) => (
                                            <ListItem key={config.id} sx={{ px: 0 }} divider={index < categoryShortcuts.length - 1}>
                                                <Box sx={{ flex: 1 }}>
                                                    <ListItemText primary={config.name} secondary={config.description} />
                                                    {shortcutConflicts[config.id] && (
                                                        <Alert severity="warning" sx={{ mt: 1, py: 0.5 }} icon={<WarningIcon />}>
                                                            {t('settings.shortcutConflict', { name: shortcutConflicts[config.id][0].name })}
                                                        </Alert>
                                                    )}
                                                </Box>
                                                <Box sx={{ minWidth: 200, ml: 2 }}>
                                                    <ShortcutInput
                                                        value={config.currentKey}
                                                        defaultValue={config.defaultKey}
                                                        onChange={(newKey) => handleShortcutChange(config.id, newKey)}
                                                        onValidationChange={() => {}}
                                                        disabled={false}
                                                        label=""
                                                        placeholder={t('settings.clickToSetShortcut')}
                                                    />
                                                </Box>
                                            </ListItem>
                                        ))}
                                    </List>
                                </Box>
                            );
                        });
                    })()}
                </TabPanel>

                {/* AI 功能设置 */}
                <TabPanel value={settingsTabValue} index={3}>
                    <AISettings showSnackbar={showSnackbar} />
                </TabPanel>

                {/* 语音转文字设置 */}
                <TabPanel value={settingsTabValue} index={4}>
                    <STTSettings showSnackbar={showSnackbar} />
                </TabPanel>

                {/* 知识记忆管理 */}
                <TabPanel value={settingsTabValue} index={5}>
                    <Mem0Settings />
                </TabPanel>

                {/* 云同步设置 */}
                <TabPanel value={settingsTabValue} index={6}>
                    <CloudSyncSettings />
                </TabPanel>

                {/* 网络代理设置 */}
                <TabPanel value={settingsTabValue} index={7}>
                    <ProxySettings showSnackbar={showSnackbar} />
                </TabPanel>

                {/* 数据管理 */}
                <TabPanel value={settingsTabValue} index={8}>
                    <Box sx={{ mb: 4 }}>
                        <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
                            本地备份与恢复
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            将所有数据（笔记、待办、图片、音频）打包为 ZIP 备份文件，或从备份恢复
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={async () => {
                                    const res = await window.electronAPI?.backup?.create();
                                    if (res?.success) {
                                        showSnackbar(`备份成功：${(res.data.size / 1024 / 1024).toFixed(1)} MB`);
                                    } else if (res?.error && res.error !== '用户取消') {
                                        showSnackbar(`备份失败：${res.error}`);
                                    }
                                }}
                            >
                                创建备份
                            </Button>
                            <Button
                                variant="outlined"
                                size="small"
                                color="warning"
                                onClick={async () => {
                                    const res = await window.electronAPI?.backup?.restore();
                                    if (res?.success) {
                                        showSnackbar(`恢复成功：${res.data.restoredItems.join('、')}，重启后生效`);
                                    } else if (res?.error && res.error !== '用户取消') {
                                        showSnackbar(`恢复失败：${res.error}`);
                                    }
                                }}
                            >
                                从备份恢复
                            </Button>
                        </Box>
                    </Box>

                    <Divider sx={{ my: 4 }} />

                    <Box sx={{ mb: 4 }}>
                        <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
                            Obsidian 导入导出
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            从 Obsidian 导入笔记或导出笔记到 Obsidian 格式(.md)

                        </Typography>
                        <ObsidianImportExport />
                    </Box>

                    <Divider sx={{ my: 4 }} />

                    <List>
                        <SettingRow
                            primary={t('settings.importLegacyData')}
                            secondary={t('settings.importLegacyDataDesc')}
                            action={(
                                <Button
                                    variant="contained"
                                    size="small"
                                    startIcon={<ImportIcon />}
                                    onClick={handleImportData}
                                >
                                    {t('settings.importData')}
                                </Button>
                            )}
                        />

                        <Divider />

                        <SettingRow
                            primary={t('settings.databaseLocation')}
                            secondary="notes.db"
                            action={(
                                <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<Launch />}
                                    onClick={() => window.electronAPI?.system?.openDataFolder?.()}
                                >
                                    {t('settings.openFolder')}
                                </Button>
                            )}
                        />
                    </List>
                </TabPanel>

                {/* MCP 服务 */}
                <TabPanel value={settingsTabValue} index={9}>
                    <MCPSettings
                        enabled={settings.mcpEnabled}
                        onEnabledChange={(value) => handleSettingChange('mcpEnabled', value)}
                    />
                </TabPanel>

                {/* 关于 */}
                <TabPanel value={settingsTabValue} index={10}>
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                        <Typography variant="h4" gutterBottom>
                            {t('about.appName')}
                        </Typography>
                        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                            {t('about.description')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                            {t('about.version')}
                        </Typography>

                        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<Launch />}
                                onClick={() => {
                                    if (window.electronAPI?.system) {
                                        window.electronAPI.system.openExternal('https://github.com/Xperiamol/FlashNote');
                                    }
                                }}
                            >
                                {t('about.githubRepo')}
                            </Button>
                        </Box>

                        <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
                            {t('about.copyright')}
                        </Typography>
                    </Box>
                </TabPanel>
            </Box>

            {/* 导入对话框 */}
            <Dialog open={importDialog} maxWidth="sm" fullWidth>
                <DialogTitle>{t('dialog.importData')}</DialogTitle>
                <DialogContent>
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            {importStatus}
                        </Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={importProgress} />
                </DialogContent>
                <DialogActions>
                    <Button size="small" onClick={() => setImportDialog(false)} disabled={importProgress > 0 && importProgress < 100}>
                        {importProgress === 100 ? t('dialog.done') : t('dialog.cancel')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 提示消息 */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={3000}
                onClose={closeSnackbar}
            >
                <Alert severity={snackbar.severity} onClose={closeSnackbar}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default Settings;