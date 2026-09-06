import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    Switch,
    Button,
    TextField,
    Alert,
    Snackbar,
    Divider,
    List,
    ListItem,
    ListItemText,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    LinearProgress,
    Chip,
    Tooltip,
    IconButton,
    Portal,
    Slider,
    useTheme
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
    GetApp as ImportIcon,
    MoreVert,
    EditNote,
    AutoAwesome,
    Brightness4,
    Brightness7,
    Computer,
    Launch,
    AccountCircle,
    PhotoCamera,
    Delete,
    Restore,
    Warning as WarningIcon,
    Code as CodeIcon,
    Visibility as VisibilityIcon,
    Language as LanguageIcon,
    Image as ImageIcon,
    ContentCopy as ContentCopyIcon,
    Check as CheckIcon,
    ArrowOutward as ArrowOutwardIcon,
    Autorenew as AutorenewIcon
} from '../common/AppIcons';
import { useStore } from '../../store/useStore';
import ShortcutInput from '../common/ShortcutInput';
import CloudSyncSettings from '../sync/CloudSyncSettings';
import AISettings from '../ai/AISettings';
import STTSettings from './STTSettings';
import Mem0Settings from './Mem0Settings';
import ProxySettings from './ProxySettings';
import MCPSettings from './MCPSettings';
import UsageWaveCard from '../common/UsageWaveCard';
import ObsidianImportExport from '../ObsidianImportExport/ObsidianImportExport';
import { SUPPORTED_LANGUAGES, t, initI18n } from '../../utils/i18n';
import {
    DEFAULT_SHORTCUTS,
    SHORTCUT_CATEGORIES,
    getShortcutsByCategory,
    checkShortcutConflict,
    resetShortcutsToDefault,
    formatShortcutDisplay
} from '../../utils/shortcutUtils';
import shortcutManager from '../../utils/ShortcutManager';
import { useError } from '../common/ErrorProvider';
import { ALL_TOOLBAR_ITEMS, DEFAULT_TOOLBAR_ORDER, DEFAULT_FLOATING_ORDER } from '../editor/MarkdownToolbar';
import { ALL_CONTEXT_MENU_ITEMS, CONTEXT_MENU_ITEM_LABELS, DEFAULT_CONTEXT_MENU_ITEMS } from '../editor/contextMenuConfig';
import { PATTERN_STYLES, hexToRgb } from '../../utils/patternStyles';
import { sectionTitleSx, sectionDescriptionSx, settingsRowSx, settingsSectionSx, colorPresetSwatchSx } from '../../styles/commonStyles';
import logger from '../../utils/logger';

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
                <Box sx={{ p: 3, maxWidth: 980, mx: 'auto' }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

function SettingRow({ primary, secondary, action }) {
    return (
        <ListItem
            sx={(theme) => ({
                ...settingsRowSx(theme),
                display: 'flex',
                alignItems: 'center',
                gap: 2,
            })}
        >
            <ListItemText
                primary={primary}
                secondary={secondary}
                slotProps={{
                    primary: { sx: { fontWeight: 650, letterSpacing: '-0.01em' } },
                    secondary: { sx: { mt: 0.25 } },
                }}
                sx={{ flex: '1 1 auto', minWidth: 0, mr: 1 }}
            />
            <Box sx={{ flex: '0 0 auto' }}>
                {action}
            </Box>
        </ListItem>
    );
}

/* ── 编辑器设置面板（指针拖拽） ── */
function EditorSettingsPanel({ aiPanelMode, setAiPanelMode, toolbarOrder, setToolbarOrder, floatingPanelItems, setFloatingPanelItems, contextMenuItems, setContextMenuItems }) {
    const allItemIds = Object.keys(ALL_TOOLBAR_ITEMS)

    const [localToolbar, setLocalToolbar] = React.useState(toolbarOrder || DEFAULT_TOOLBAR_ORDER)
    const [localFloating, setLocalFloating] = React.useState(floatingPanelItems || DEFAULT_FLOATING_ORDER)
    const enabledContextItems = contextMenuItems || DEFAULT_CONTEXT_MENU_ITEMS

    /* ── 指针拖拽状态 ── */
    const [drag, setDrag] = React.useState(null)         // { id, source } | null
    const [pointer, setPointer] = React.useState(null)   // { x, y } | null
    const [hoverZone, setHoverZone] = React.useState(null)
    const [tbInsertIdx, setTbInsertIdx] = React.useState(-1)
    const [fpInsertIdx, setFpInsertIdx] = React.useState(-1)

    const toolbarZoneRef = React.useRef(null)
    const floatingZoneRef = React.useRef(null)
    const recycleZoneRef = React.useRef(null)

    // 用 ref 镜像可变状态，避免 pointermove/pointerup 闭包陈旧
    const dragRef = React.useRef(null)
    const tbInsertIdxRef = React.useRef(-1)
    const fpInsertIdxRef = React.useRef(-1)
    const localToolbarRef = React.useRef(localToolbar)
    const localFloatingRef = React.useRef(localFloating)
    React.useEffect(() => { localToolbarRef.current = localToolbar }, [localToolbar])
    React.useEffect(() => { localFloatingRef.current = localFloating }, [localFloating])

    React.useEffect(() => { setLocalToolbar(toolbarOrder || DEFAULT_TOOLBAR_ORDER) }, [toolbarOrder])
    React.useEffect(() => { setLocalFloating(floatingPanelItems || DEFAULT_FLOATING_ORDER) }, [floatingPanelItems])

    const toolbarIds = localToolbar.filter(id => id !== '|')
    const recycleIds = allItemIds.filter(id => !toolbarIds.includes(id) && !localFloating.includes(id))

    const persistEditorSettings = React.useCallback((updates) => {
        const payload = Object.fromEntries(Object.entries(updates).map(([key, value]) => [
            key,
            {
                value,
                type: value === null ? 'json' : Array.isArray(value) ? 'array' : typeof value,
            },
        ]))
        const request = window.electronAPI?.settings?.setMultiple?.(payload)
        request?.catch?.((error) => {
            console.error('Failed to persist editor settings:', error)
        })
    }, [])

    const save = React.useCallback((tb, fp) => {
        setToolbarOrder(tb)
        const isDefault = JSON.stringify(fp) === JSON.stringify(DEFAULT_FLOATING_ORDER)
        const nextFloating = isDefault ? null : fp
        setFloatingPanelItems(nextFloating)
        persistEditorSettings({
            toolbarOrder: tb,
            floatingPanelItems: nextFloating,
        })
    }, [persistEditorSettings, setToolbarOrder, setFloatingPanelItems])

    /* ── 区域检测 ── */
    const getZoneAtPoint = React.useCallback((x, y) => {
        for (const [zone, ref] of [['toolbar', toolbarZoneRef], ['floating', floatingZoneRef], ['recycle', recycleZoneRef]]) {
            const el = ref.current
            if (!el) continue
            const r = el.getBoundingClientRect()
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return zone
        }
        return null
    }, [])

    /* 计算工具栏插入位置 */
    const computeTbInsertIdx = React.useCallback((x, y) => {
        const el = toolbarZoneRef.current
        if (!el) return -1
        const chips = el.querySelectorAll('[data-tb-idx]')
        if (chips.length === 0) return 0
        for (let i = 0; i < chips.length; i++) {
            const r = chips[i].getBoundingClientRect()
            if (y >= r.top - 4 && y <= r.bottom + 4 && x < r.left + r.width / 2) {
                return parseInt(chips[i].dataset.tbIdx)
            }
        }
        return localToolbarRef.current.length
    }, [])

    /* 计算浮动面板插入位置 */
    const computeFpInsertIdx = React.useCallback((x, y) => {
        const el = floatingZoneRef.current
        if (!el) return -1
        const chips = el.querySelectorAll('[data-fp-idx]')
        if (chips.length === 0) return 0
        for (let i = 0; i < chips.length; i++) {
            const r = chips[i].getBoundingClientRect()
            if (y >= r.top - 4 && y <= r.bottom + 4 && x < r.left + r.width / 2) {
                return parseInt(chips[i].dataset.fpIdx)
            }
        }
        return localFloatingRef.current.length
    }, [])

    /* ── 指针事件（document 级别监听） ── */
    React.useEffect(() => {
        if (!drag) return
        dragRef.current = drag

        const onMove = (e) => {
            e.preventDefault()
            const { clientX: x, clientY: y } = e
            setPointer({ x, y })
            const zone = getZoneAtPoint(x, y)
            setHoverZone(zone)
            if (zone === 'toolbar') {
                const idx = computeTbInsertIdx(x, y)
                tbInsertIdxRef.current = idx
                setTbInsertIdx(idx)
                fpInsertIdxRef.current = -1
                setFpInsertIdx(-1)
            } else if (zone === 'floating') {
                const idx = computeFpInsertIdx(x, y)
                fpInsertIdxRef.current = idx
                setFpInsertIdx(idx)
                tbInsertIdxRef.current = -1
                setTbInsertIdx(-1)
            } else {
                tbInsertIdxRef.current = -1
                setTbInsertIdx(-1)
                fpInsertIdxRef.current = -1
                setFpInsertIdx(-1)
            }
        }

        const onUp = (e) => {
            const targetZone = getZoneAtPoint(e.clientX, e.clientY)
            const d = dragRef.current
            if (d && targetZone) {
                let tb = [...localToolbarRef.current]
                let fp = [...localFloatingRef.current]
                const { id, source } = d

                // 从原位置移除
                if (source === 'toolbar') tb = tb.filter(v => v !== id)
                if (source === 'floating') fp = fp.filter(v => v !== id)

                // 添加到目标
                if (targetZone === 'toolbar') {
                    let idx = tbInsertIdxRef.current
                    if (source === 'toolbar') {
                        const origIdx = localToolbarRef.current.indexOf(id)
                        if (origIdx >= 0 && idx > origIdx) idx = Math.max(0, idx - 1)
                    }
                    if (idx >= 0 && idx < tb.length) tb.splice(idx, 0, id)
                    else tb.push(id)
                } else if (targetZone === 'floating') {
                    let idx = fpInsertIdxRef.current
                    if (source === 'floating') {
                        const origIdx = localFloatingRef.current.indexOf(id)
                        if (origIdx >= 0 && idx > origIdx) idx = Math.max(0, idx - 1)
                    }
                    if (idx >= 0 && idx < fp.length) fp.splice(idx, 0, id)
                    else fp.push(id)
                }
                // recycle: 只要从原位置移除即可

                tb = cleanSeps(tb)
                localToolbarRef.current = tb
                localFloatingRef.current = fp
                setLocalToolbar(tb)
                setLocalFloating(fp)
                save(tb, fp)
            }
            setDrag(null)
            setPointer(null)
            setHoverZone(null)
            setTbInsertIdx(-1)
            setFpInsertIdx(-1)
            dragRef.current = null
            tbInsertIdxRef.current = -1
            fpInsertIdxRef.current = -1
        }

        window.addEventListener('pointermove', onMove, { passive: false })
        window.addEventListener('pointerup', onUp)
        return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
    }, [drag, getZoneAtPoint, computeTbInsertIdx, computeFpInsertIdx, save])

    const startDrag = React.useCallback((e, id, source) => {
        e.preventDefault()
        setDrag({ id, source })
        setPointer({ x: e.clientX, y: e.clientY })
    }, [])

    const handleReset = () => {
        setLocalToolbar(DEFAULT_TOOLBAR_ORDER)
        setLocalFloating(DEFAULT_FLOATING_ORDER)
        setToolbarOrder(null)
        setFloatingPanelItems(null)
        setContextMenuItems(null)
        persistEditorSettings({
            toolbarOrder: null,
            floatingPanelItems: null,
            contextMenuItems: null,
        })
    }

    const toggleContextItem = (id) => {
        const next = enabledContextItems.includes(id)
            ? enabledContextItems.filter(item => item !== id)
            : ALL_CONTEXT_MENU_ITEMS.filter(item => item === id || enabledContextItems.includes(item))
        const isDefault = JSON.stringify(next) === JSON.stringify(DEFAULT_CONTEXT_MENU_ITEMS)
        const nextItems = isDefault ? null : next
        setContextMenuItems(nextItems)
        persistEditorSettings({ contextMenuItems: nextItems })
    }

    const changeAiPanelMode = (mode) => {
        setAiPanelMode(mode)
        persistEditorSettings({ aiPanelMode: mode })
    }

    const aiModeChips = [
        { value: 'selection', label: '右键选中文本' },
        { value: 'always', label: '始终显示' },
        { value: 'disabled', label: '禁用' },
    ]

    /* ── 渲染单个 chip ── */
    const renderChip = (id, source, tbIdx, fpIdx) => {
        const def = ALL_TOOLBAR_ITEMS[id]
        if (!def) return null
        const Icon = def.icon
        const isDragged = drag?.id === id
        return (
            <Tooltip title={def.label} placement="top" enterDelay={400} disableInteractive
                open={drag ? false : undefined}>
                <Box
                    data-tb-idx={tbIdx != null ? tbIdx : undefined}
                    data-fp-idx={fpIdx != null ? fpIdx : undefined}
                    onPointerDown={(e) => startDrag(e, id, source)}
                    sx={{
                        width: 32, height: 32, borderRadius: '8px',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        bgcolor: 'action.hover', color: 'text.secondary',
                        cursor: drag ? 'grabbing' : 'grab',
                        transition: isDragged ? 'none' : 'all 0.15s ease',
                        '&:hover': drag ? {} : { bgcolor: 'action.focus' },
                        '& .MuiSvgIcon-root': { fontSize: 16 },
                        opacity: isDragged ? 0.25 : 1,
                        userSelect: 'none', touchAction: 'none',
                    }}
                >
                    {Icon ? <Icon /> : <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{def.label?.[0]}</Typography>}
                </Box>
            </Tooltip>
        )
    }

    /* ── 拖拽幽灵（Portal 到 body，避免 overflow 裁剪 / transform 偏移） ── */
    const renderGhost = () => {
        if (!drag || !pointer) return null
        const def = ALL_TOOLBAR_ITEMS[drag.id]
        if (!def) return null
        const Icon = def.icon
        return (
            <Portal>
                <Box sx={{
                    position: 'fixed', zIndex: 99999, pointerEvents: 'none',
                    left: pointer.x - 16, top: pointer.y - 16,
                }}>
                    <Box sx={{
                        width: 32, height: 32, borderRadius: '6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        bgcolor: 'primary.main', color: 'primary.contrastText',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.26)',
                        '& .MuiSvgIcon-root': { fontSize: 16 },
                    }}>
                        {Icon ? <Icon /> : <Box sx={{ fontSize: 11, fontWeight: 700 }}>{def.label?.[0]}</Box>}
                    </Box>
                </Box>
            </Portal>
        )
    }

    /* ── 插入位置指示条 ── */
    const InsertBar = () => <Box sx={{ width: 3, height: 24, bgcolor: 'primary.main', borderRadius: 2, flexShrink: 0, mx: '-1px' }} />

    const zoneSx = (zone) => ({
        p: 1.5, borderRadius: '6px', display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', minHeight: 44,
        border: '2px dashed',
        borderColor: hoverZone === zone ? (zone === 'recycle' ? 'error.main' : 'primary.main') : 'divider',
        bgcolor: hoverZone === zone
            ? (zone === 'recycle'
                ? (t) => t.palette.mode === 'dark' ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)'
                : (t) => t.palette.mode === 'dark' ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)')
            : 'background.paper',
        transition: 'border-color 0.2s, background-color 0.2s',
    })
    const labelSx = { mt: 2.5, mb: 0.75, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' }

    return (
        <Box>
            <Typography variant="h6" gutterBottom>浮动面板</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                控制富文本编辑器中浮动面板的显示方式
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                {aiModeChips.map(o => (
                    <Chip key={o.value} label={o.label}
                        variant={aiPanelMode === o.value ? 'filled' : 'outlined'}
                        color={aiPanelMode === o.value ? 'primary' : 'default'}
                        onClick={() => changeAiPanelMode(o.value)} size="small" />
                ))}
            </Box>

            <Divider sx={{ my: 3 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6">工具栏与浮动面板</Typography>
                <Button size="small" variant="text" onClick={handleReset}>恢复默认</Button>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                拖拽按钮在三个区域间移动 · 工具栏内可拖拽排序
            </Typography>

            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                <MoreVert sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.75 }} />右键菜单
            </Typography>
            <Box sx={zoneSx('context')}>
                {ALL_CONTEXT_MENU_ITEMS.map(id => {
                    const enabled = enabledContextItems.includes(id)
                    return (
                        <Chip
                            key={id}
                            size="small"
                            label={CONTEXT_MENU_ITEM_LABELS[id] || id}
                            color={enabled ? 'primary' : 'default'}
                            variant={enabled ? 'filled' : 'outlined'}
                            onClick={() => toggleContextItem(id)}
                            sx={{ fontWeight: 600 }}
                        />
                    )
                })}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, mb: 2 }}>
                默认仅启用高频编辑项；高级块操作可手动开启，且只会在对应上下文中显示。
            </Typography>

            {/* ── 工具栏 ── */}
            <Typography variant="subtitle2" color="text.secondary" sx={labelSx} style={{ marginTop: 0 }}>
                <EditNote sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.75 }} />工具栏
            </Typography>
            <Box ref={toolbarZoneRef} sx={zoneSx('toolbar')}>
                {localToolbar.map((id, idx) => {
                    if (id === '|') return (
                        <React.Fragment key={`sep-${idx}`}>
                            {drag && hoverZone === 'toolbar' && tbInsertIdx === idx && <InsertBar />}
                            <Box data-tb-idx={idx} sx={{ width: 1, height: 20, bgcolor: 'divider', mx: 0.5 }} />
                        </React.Fragment>
                    )
                    return (
                        <React.Fragment key={id}>
                            {drag && hoverZone === 'toolbar' && tbInsertIdx === idx && <InsertBar />}
                            {renderChip(id, 'toolbar', idx)}
                        </React.Fragment>
                    )
                })}
                {drag && hoverZone === 'toolbar' && tbInsertIdx >= localToolbar.length && <InsertBar />}
                {toolbarIds.length === 0 && <Typography variant="body2" color="text.disabled" sx={{ px: 1 }}>拖拽项目到此处</Typography>}
            </Box>

            {/* ── 浮动面板 ── */}
            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                <AutoAwesome sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.75 }} />浮动面板（选中文字时出现）
            </Typography>
            <Box ref={floatingZoneRef} sx={zoneSx('floating')}>
                {localFloating.map((id, idx) => (
                    <React.Fragment key={id}>
                        {drag && hoverZone === 'floating' && fpInsertIdx === idx && <InsertBar />}
                        {renderChip(id, 'floating', undefined, idx)}
                    </React.Fragment>
                ))}
                {drag && hoverZone === 'floating' && fpInsertIdx >= localFloating.length && <InsertBar />}
                {localFloating.length === 0 && <Typography variant="body2" color="text.disabled" sx={{ px: 1 }}>拖拽项目到此处</Typography>}
            </Box>

            {/* ── 回收站 ── */}
            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                <Delete sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.75 }} />回收站（隐藏的项目）
            </Typography>
            <Box ref={recycleZoneRef} sx={zoneSx('recycle')}>
                {recycleIds.map(id => <React.Fragment key={id}>{renderChip(id, 'recycle')}</React.Fragment>)}
                {recycleIds.length === 0 && <Typography variant="body2" color="text.disabled" sx={{ px: 1 }}>所有项目已启用</Typography>}
            </Box>

            {/* ── 拖拽幽灵 ── */}
            {renderGhost()}
        </Box>
    )
}

function cleanSeps(arr) {
    let result = arr.filter((id, i, a) => !(id === '|' && (i === 0 || a[i - 1] === '|')))
    if (result.length && result[result.length - 1] === '|') result.pop()
    return result
}

function formatUsageBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const display = value / (1024 ** exponent);
    const fractionDigits = display >= 100 || exponent === 0 ? 0 : display >= 10 ? 1 : 2;
    return `${display.toFixed(fractionDigits)} ${units[exponent]}`;
}

function formatUsagePercent(ratio) {
    if (!Number.isFinite(ratio) || ratio < 0) return '--';
    const percent = ratio * 100;
    if (percent > 0 && percent < 0.1) return '<0.1%';
    if (percent < 10) return `${percent.toFixed(1)}%`;
    return `${Math.round(percent)}%`;
}

function buildTopUsageSegments(categories = [], limit = 4) {
    return [...categories]
        .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
        .filter((item) => (item.sizeBytes || 0) > 0)
        .slice(0, limit)
        .map((item) => ({
            label: item.label,
            value: formatUsageBytes(item.sizeBytes),
        }));
}

const Settings = () => {
    const { showError } = useError();
    const muiTheme = useTheme();
    const isDark = muiTheme.palette.mode === 'dark';
    const { theme, setTheme, primaryColor, setPrimaryColor, setUserAvatar, setUserName, titleBarStyle, setTitleBarStyle, editorMode, setEditorMode, language, setLanguage, setDefaultMinibarMode, maskOpacity, setMaskOpacity, christmasMode, setChristmasMode, aiPanelMode, setAiPanelMode, toolbarOrder, setToolbarOrder, floatingPanelItems, setFloatingPanelItems, contextMenuItems, setContextMenuItems, backgroundPattern, setBackgroundPattern, patternOpacity, setPatternOpacity, wallpaperPath, setWallpaperPath, whiteboardStyle, setWhiteboardStyle } = useStore();
    const settingsTabValue = useStore((state) => state.settingsTabValue);
    const appVersion = useStore((state) => state.appVersion);
    const updateInfo = useStore((state) => state.appUpdateInfo);
    const checkForUpdates = useStore((state) => state.checkForUpdates);
    const [settings, setSettings] = useState({
        autoLaunch: false,
        userAvatar: '',
        userName: '',
        language: 'zh-CN',
        defaultMinibarMode: false,
        hiddenMode: false,
        mcpEnabled: false,
        attachmentMaxSizeMB: 50
    });
    const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
    const [shortcutConflicts, setShortcutConflicts] = useState({});
    const [importDialog, setImportDialog] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [importStatus, setImportStatus] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [appPlatform, setAppPlatform] = useState('unknown');
    const [selectingWallpaper, setSelectingWallpaper] = useState(false);
    const [localUsage, setLocalUsage] = useState(null);
    const [localUsageLoading, setLocalUsageLoading] = useState(false);
    const [localUsageError, setLocalUsageError] = useState('');

    useEffect(() => {
        // 加载设置
        loadSettings();
        loadShortcuts();
        const platformRequest = window.electronAPI?.system?.getPlatform?.();
        platformRequest?.then?.(p => setAppPlatform(p || 'unknown'))?.catch?.(() => {});
        loadLocalUsage();
    }, []);

    const handleCheckForUpdates = async () => { await checkForUpdates({ silent: false }); };

    const loadLocalUsage = async () => {
        setLocalUsageLoading(true);
        try {
            const data = await window.electronAPI?.system?.getStorageUsage?.();
            setLocalUsage(data || null);
            setLocalUsageError('');
        } catch (error) {
            console.error('Failed to load local storage usage:', error);
            setLocalUsageError(error?.message || '本地使用量读取失败');
        } finally {
            setLocalUsageLoading(false);
        }
    };

    const handleCopyDebugInfo = async () => {
        const debugInfo = [
            '# Flota Debug Info',
            `time: ${new Date().toISOString()}`,
            `version: ${appVersion || 'unknown'}`,
            `platform: ${appPlatform}`,
            `language: ${language || settings.language || 'unknown'}`,
            `theme: ${theme || 'unknown'}`,
            `editorMode: ${editorMode || 'unknown'}`,
            `titleBarStyle: ${titleBarStyle || 'unknown'}`,
            `mcpEnabled: ${settings?.mcpEnabled ? 'true' : 'false'}`,
            `defaultMinibarMode: ${settings?.defaultMinibarMode ? 'true' : 'false'}`,
            `hiddenMode: ${settings?.hiddenMode ? 'true' : 'false'}`,
            `userAgent: ${navigator.userAgent}`,
        ].join('\n');

        try {
            if (window.electronAPI?.system?.writeText) {
                await window.electronAPI.system.writeText(debugInfo);
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(debugInfo);
            } else {
                throw new Error('Clipboard API not available');
            }
            setSnackbar({ open: true, message: t('about.copyDebugInfoSuccess') || '调试信息已复制', severity: 'success' });
        } catch (error) {
            setSnackbar({ open: true, message: t('about.copyDebugInfoFailed') || '复制失败', severity: 'error' });
        }
    };

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
                    if (normalizedData.hiddenMode !== undefined) {
                        normalizedData.hiddenMode = Boolean(normalizedData.hiddenMode);
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
        whiteboardStyle: {
            syncGlobalState: setWhiteboardStyle
        },
        theme: {
            syncGlobalState: setTheme
        },
        customThemeColor: {
            syncGlobalState: setPrimaryColor,
            storeKey: 'primaryColor'
        },
        titleBarStyle: {
            syncGlobalState: setTitleBarStyle
        },
        editorMode: {
            syncGlobalState: setEditorMode
        },
        userName: {
            syncGlobalState: setUserName
        },
        userAvatar: {
            syncGlobalState: setUserAvatar
        }
    };

    // 统一的设置更改处理器
    const handleSettingChange = async (key, value) => {
        const handler = settingHandlers[key] || {};
        // 记住旧值用于回滚：本地 state → store (用 storeKey 映射不同命名)
        const storeKey = handler.storeKey || key;
        const storeValues = useStore.getState();
        const prevValue = settings[key] !== undefined ? settings[key] : storeValues[storeKey];
        try {
            // 1. 更新本地状态
            setSettings(prev => ({ ...prev, [key]: value }));

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
            setSettings(prev => ({ ...prev, [key]: prevValue }));
            if (handler?.syncGlobalState) handler.syncGlobalState(prevValue);
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

    // 主题壁纸 - 原子化切换，直接使用 store actions
    const applyBackground = async (id) => {
        const prev = backgroundPattern;
        setBackgroundPattern(id);
        try {
            await window.electronAPI.settings.set('backgroundPattern', id);
        } catch {
            setBackgroundPattern(prev);
            showSnackbar('背景样式切换失败', 'error');
        }
    };

    const handleSelectWallpaper = async () => {
        try {
            setSelectingWallpaper(true);
            const result = await window.electronAPI?.settings?.selectWallpaper?.();
            if (!result?.success || !result.data) {
                if (result?.error && result.error !== '用户取消选择') {
                    showSnackbar(result.error, 'error');
                }
                return;
            }
            const url = result.data;
            const prevBg = backgroundPattern;
            const prevPath = wallpaperPath;
            // 先更新 store（立即生效），再写后端
            setBackgroundPattern('custom');
            setWallpaperPath(url);
            try {
                await window.electronAPI.settings.setMultiple({
                    backgroundPattern: 'custom',
                    wallpaperPath: url,
                });
                showSnackbar('壁纸已更新', 'success');
            } catch {
                setBackgroundPattern(prevBg);
                setWallpaperPath(prevPath);
                showSnackbar('壁纸保存失败', 'error');
            }
        } catch (error) {
            showSnackbar(error?.message || '选择壁纸失败', 'error');
        } finally {
            setSelectingWallpaper(false);
        }
    };

    const handleClearWallpaper = async () => {
        const prevBg = backgroundPattern;
        const prevPath = wallpaperPath;
        const nextPattern = backgroundPattern === 'custom' ? 'none' : backgroundPattern;
        setBackgroundPattern(nextPattern);
        setWallpaperPath('');
        try {
            await window.electronAPI.settings.setMultiple({
                backgroundPattern: nextPattern,
                wallpaperPath: '',
            });
            showSnackbar('壁纸已移除', 'success');
        } catch {
            setBackgroundPattern(prevBg);
            setWallpaperPath(prevPath);
            showSnackbar('移除壁纸失败', 'error');
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

                logger.log(`快捷键 ${shortcutId} 已成功更新并保存`);
            }
        } catch (error) {
            console.error(`保存快捷键 ${shortcutId} 失败:`, error);
            showError(error, `保存快捷键失败`);
            throw error;
        }
    };

    const handleShortcutChange = async (shortcutId, newKey) => {
        try {
            // 0. 防御：标记为只读的快捷键不允许修改
            if (shortcuts[shortcutId]?.readOnly) {
                return;
            }
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

            // 同步前端单例，避免重启前 App.jsx / NoteEditor 仍按旧 currentKey 触发
            shortcutManager.updateShortcuts(defaultShortcuts);

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
    /** 通用 Chip 选择器 */
    const ChipSelector = ({ options, value, onChange, getKey = o => o.value, getLabel = o => o.label, getIcon }) => (
        <Box sx={chipRowSx}>
            {options.map((o) => {
                const k = getKey(o)
                return (
                    <Chip key={k} icon={getIcon?.(o)} label={getLabel(o)}
                        variant={value === k ? 'filled' : 'outlined'}
                        onClick={() => onChange(k)} size="small"
                        color={value === k ? 'primary' : 'default'} />
                )
            })}
        </Box>
    );
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
        { name: '经典蓝', color: '#1976d2' },
        { name: '远黛', color: '#4F90A0' },
        { name: '松烟', color: '#5A8E72' },
        { name: '琥珀', color: '#C99151' },
        { name: '朱砂', color: '#D6604F' },
        { name: '海棠', color: '#D17B8E' },
        { name: '紫藤', color: '#8B6FD4' },
        { name: '玄铁', color: '#6B7280' },
    ];
    const maskOpacityOptions = [
        { value: 'none', label: '无遮罩' },
        { value: 'light', label: '轻度' },
        { value: 'medium', label: '中度' },
        { value: 'heavy', label: '重度' },
    ];
    const whiteboardStyleOptions = [
        { value: 'neat', label: '规整' },
        { value: 'sketchy', label: '手绘' },
    ];
    const isMacOS =
        typeof navigator !== 'undefined' &&
        String(navigator.userAgentData?.platform || Reflect.get(navigator, 'platform') || '')
            .toLowerCase()
            .includes('mac');
    const titleBarOptions = [
        { value: 'mac', label: t('settings.titleBarMac') },
        { value: 'windows', label: t('settings.titleBarWindows') },
    ];

    const getColorPresetSx = (presetColor) =>
        colorPresetSwatchSx({
            color: presetColor,
            selected: primaryColor === presetColor,
            isDark,
            alpha,
        });

    const settingsSurfaceSx = settingsSectionSx(muiTheme);
    const backgroundMode = backgroundPattern === 'custom'
        ? 'wallpaper'
        : backgroundPattern === 'none'
            ? 'none'
            : 'pattern';
    const backgroundModeOptions = [
        { value: 'none', label: '无背景' },
        { value: 'pattern', label: '几何花纹' },
        { value: 'wallpaper', label: '自定义壁纸' },
    ];
    const patternEntries = Object.entries(PATTERN_STYLES);
    const fallbackPatternId = patternEntries[0]?.[0] || 'dots';
    const activePatternId = backgroundMode === 'pattern' && PATTERN_STYLES[backgroundPattern]
        ? backgroundPattern
        : fallbackPatternId;
    const backgroundEffectLabel = backgroundMode === 'wallpaper' ? '壁纸显现' : '花纹强度';
    const effectSliderMin = backgroundMode === 'wallpaper' ? 0.15 : 0.2;
    const effectSliderMax = backgroundMode === 'wallpaper' ? 1 : 2;
    const effectSliderStep = 0.05;
    const displayEffectValue = backgroundMode === 'wallpaper'
        ? Math.round(Math.max(0, Math.min(1, patternOpacity)) * 100)
        : Math.round(patternOpacity * 100);
    const backgroundPanelRadius = 1.25;
    const backgroundPanelSx = {
        borderRadius: backgroundPanelRadius,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: isDark ? 'rgba(15,23,42,0.18)' : 'rgba(248,250,252,0.72)',
    };

    const buildPatternPreviewStyle = (style) => {
        const rgb = hexToRgb(primaryColor);
        const previewCss = style.css
            .replace(/rgba\(99,\s*102,\s*241,\s*([\d.]+)\)/g, (_, a) =>
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(parseFloat(a) * 4).toFixed(2)})`
            );
        const previewStyle = {};
        previewCss.split(';').forEach(rule => {
            const colonIdx = rule.indexOf(':');
            if (colonIdx === -1) return;
            const prop = rule.slice(0, colonIdx).trim();
            const val = rule.slice(colonIdx + 1).trim();
            if (prop && val) {
                previewStyle[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
            }
        });
        return previewStyle;
    };

    const handleBackgroundModeChange = async (mode) => {
        if (mode === 'none') {
            await applyBackground('none');
            return;
        }
        if (mode === 'pattern') {
            await applyBackground(activePatternId);
            return;
        }
        if (wallpaperPath) {
            await applyBackground('custom');
            return;
        }
        await handleSelectWallpaper();
    };

    return (
        <Box
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'row',
                background: isDark
                    ? 'radial-gradient(circle at top right, rgba(99,102,241,0.10), transparent 32%), transparent'
                    : 'radial-gradient(circle at top right, rgba(99,102,241,0.08), transparent 34%), transparent',
            }}
        >
            {/* 内容区域 */}
            <Box sx={{ flex: 1, overflow: 'auto' }}>
                {/* 通用设置 */}
                <TabPanel value={settingsTabValue} index={0}>
                    <Paper elevation={0} sx={{ ...settingsSurfaceSx, p: 2 }}>
                    <Typography variant="h6" sx={sectionTitleSx}>通用设置</Typography>
                    <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
                        应用启动、语言与窗口行为
                    </Typography>
                    <List disablePadding>
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
                        <SettingRow
                            primary={t('settings.hiddenMode')}
                            secondary={t('settings.hiddenModeDesc')}
                            action={(
                                <Switch
                                    checked={settings.hiddenMode}
                                    onChange={(e) => handleSettingChange('hiddenMode', e.target.checked)}
                                />
                            )}
                        />
                        <SettingRow
                            primary={t('settings.language')}
                            secondary={t('settings.languageDesc')}
                            action={<ChipSelector options={SUPPORTED_LANGUAGES} value={settings.language}
                                onChange={v => handleSettingChange('language', v)}
                                getKey={o => o.code} getLabel={o => o.nativeName} getIcon={() => <LanguageIcon />} />}
                        />
                        <SettingRow
                            primary="附件最大大小 (MB)"
                            secondary="超过此大小的文件无法添加为附件，0 表示不限制"
                            action={(
                                <TextField
                                    size="small"
                                    type="number"
                                    inputProps={{ min: 0, step: 1, style: { textAlign: 'right', width: 80 } }}
                                    value={Number.isFinite(Number(settings.attachmentMaxSizeMB)) ? Number(settings.attachmentMaxSizeMB) : 50}
                                    onChange={(e) => setSettings(prev => ({ ...prev, attachmentMaxSizeMB: e.target.value }))}
                                    onBlur={(e) => {
                                        const raw = Number(e.target.value)
                                        const value = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50
                                        handleSettingChange('attachmentMaxSizeMB', value)
                                    }}
                                />
                            )}
                        />
                    </List>
                    </Paper>
                </TabPanel>

                {/* 外观设置 */}
                <TabPanel value={settingsTabValue} index={1}>
                    <Paper elevation={0} sx={{ ...settingsSurfaceSx, p: 2 }}>
                    <Typography variant="h6" sx={sectionTitleSx}>外观与个性化</Typography>
                    <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
                        主题、头像、背景和界面显示方式
                    </Typography>
                    {/* 主题 */}
                    <List disablePadding>
                        <SettingRow
                            primary={t('settings.theme')}
                            secondary={t('settings.themeDesc')}
                            action={<ChipSelector options={themeOptions} value={theme}
                                onChange={v => handleSettingChange('theme', v)} getIcon={o => o.icon} />}
                        />
                    </List>

                    <Divider sx={{ my: 2 }} />

                    {/* 个人信息 */}
                    <List disablePadding>
                        <ListItem sx={{ py: 1.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                                <Box>
                                    {settings.userAvatar ? (
                                        <Box
                                            component="img"
                                            src={settings.userAvatar}
                                            alt={t('settings.userAvatar')}
                                            sx={{
                                                width: 52,
                                                height: 52,
                                                borderRadius: '50%',
                                                objectFit: 'cover',
                                                border: '2px solid',
                                                borderColor: 'primary.main'
                                            }}
                                        />
                                    ) : (
                                        <AccountCircle sx={{ fontSize: 52, color: 'text.secondary' }} />
                                    )}
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="standard"
                                        placeholder={t('settings.userNamePlaceholder')}
                                        value={settings.userName}
                                        onChange={(e) => setSettings(prev => ({ ...prev, userName: e.target.value }))}
                                        onBlur={(e) => {
                                            handleSettingChange('userName', e.target.value);
                                            setUserName(e.target.value);
                                        }}
                                        slotProps={{ input: { disableUnderline: true } }}
                                        sx={{ '& .MuiInput-input': { fontSize: '1rem', fontWeight: 500 } }}
                                    />
                                    <Typography variant="caption" color="text.secondary">
                                        {t('settings.userNameHelper')}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                                    <Button variant="outlined" size="small" startIcon={<PhotoCamera />} onClick={handleAvatarChange}>
                                        {settings.userAvatar ? t('settings.change') : t('settings.select')}
                                    </Button>
                                    {settings.userAvatar && (
                                        <Button variant="outlined" size="small" startIcon={<Delete />} onClick={handleAvatarDelete} color="error">
                                            {t('settings.delete')}
                                        </Button>
                                    )}
                                </Box>
                            </Box>
                        </ListItem>
                    </List>

                    <Divider sx={{ my: 2 }} />

                    {/* 主题色 */}
                    <Box sx={{ px: 2, mb: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>{t('settings.themeColor')}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                            {t('settings.themeColorDesc')}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
                            {themeColorPresets.map((preset) => (
                                <Tooltip key={preset.color} title={preset.name}>
                                    <Box
                                        onClick={() => handleSettingChange('customThemeColor', preset.color)}
                                        sx={getColorPresetSx(preset.color)}
                                    />
                                </Tooltip>
                            ))}
                            <Tooltip title="自定义颜色">
                                <Box
                                    component="label"
                                    sx={{
                                        position: 'relative',
                                        width: 30,
                                        height: 30,
                                        borderRadius: '50%',
                                        cursor: 'pointer',
                                        background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #ef4444)',
                                        boxShadow: `inset 0 0 0 2px ${isDark ? '#1e293b' : '#ffffff'}, inset 0 0 0 3px ${alpha('#000', isDark ? 0.35 : 0.12)}, 0 1px 2px ${alpha('#000', isDark ? 0.32 : 0.08)}`,
                                        transition: 'transform 160ms ease, box-shadow 200ms ease',
                                        '&:hover': {
                                            transform: 'translateY(-1px)',
                                            boxShadow: `inset 0 0 0 2px ${isDark ? '#1e293b' : '#ffffff'}, inset 0 0 0 3px ${alpha('#000', isDark ? 0.35 : 0.12)}, 0 4px 12px ${alpha('#000', isDark ? 0.5 : 0.18)}`,
                                        },
                                        '& input[type="color"]': {
                                            position: 'absolute',
                                            inset: 0,
                                            opacity: 0,
                                            width: '100%',
                                            height: '100%',
                                            cursor: 'pointer',
                                            border: 0,
                                            padding: 0,
                                        },
                                    }}
                                    aria-label="自定义主题颜色"
                                >
                                    <input
                                        type="color"
                                        value={primaryColor}
                                        onChange={(e) => setPrimaryColor(e.target.value)}
                                        onBlur={(e) => handleSettingChange('customThemeColor', e.target.value)}
                                    />
                                </Box>
                            </Tooltip>
                        </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    {/* 主题壁纸 */}
                    <Box sx={{ px: 2, mb: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>主题壁纸</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                            把背景模式拆开管理，花纹和照片壁纸分别预览与调节，减少误操作
                        </Typography>
                        <Box sx={{ mb: 2 }}>
                            <ChipSelector
                                options={backgroundModeOptions}
                                value={backgroundMode}
                                onChange={handleBackgroundModeChange}
                            />
                        </Box>

                        {backgroundMode === 'none' && (
                            <Box
                                sx={{
                                    ...backgroundPanelSx,
                                    px: 1.5,
                                    py: 1.25,
                                    bgcolor: isDark ? 'rgba(15,23,42,0.24)' : 'rgba(248,250,252,0.88)',
                                }}
                            >
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                                    当前不使用背景
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    适合专注写作。若想增强个性化，可以切换到几何花纹或自定义壁纸。
                                </Typography>
                            </Box>
                        )}

                        {backgroundMode === 'pattern' && (
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 1.25, mb: 2 }}>
                                {patternEntries.map(([id, style]) => {
                                    const selected = backgroundPattern === id;
                                    return (
                                        <Box
                                            key={id}
                                            onClick={() => applyBackground(id)}
                                            sx={{
                                                borderRadius: backgroundPanelRadius,
                                                border: '1px solid',
                                                borderColor: selected ? 'primary.main' : 'divider',
                                                bgcolor: isDark ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.88)',
                                                cursor: 'pointer',
                                                overflow: 'hidden',
                                                transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                                                boxShadow: selected ? '0 0 0 1px rgba(59,130,246,0.18) inset' : 'none',
                                                '&:hover': { borderColor: 'primary.main' },
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    height: 72,
                                                    bgcolor: isDark ? 'rgba(30,41,59,0.5)' : 'rgba(248,250,252,0.95)',
                                                }}
                                                style={buildPatternPreviewStyle(style)}
                                            />
                                            <Box sx={{ px: 1.25, py: 1 }}>
                                                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                    {style.name}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                        )}

                        {backgroundMode === 'wallpaper' && (
                            <Box
                                sx={{
                                    ...backgroundPanelSx,
                                    border: '1px solid',
                                    borderColor: backgroundPattern === 'custom' ? 'primary.main' : 'divider',
                                    mb: 2,
                                    px: 1.5,
                                    pt: 1.5,
                                    pb: 1.25,
                                    bgcolor: isDark ? 'rgba(15,23,42,0.24)' : 'rgba(255,255,255,0.88)',
                                }}
                            >
                                <Box
                                    sx={{
                                        height: 164,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: 1,
                                        bgcolor: isDark ? 'rgba(30,41,59,0.6)' : 'rgba(241,245,249,0.95)',
                                        overflow: 'hidden',
                                        mb: 1.25,
                                    }}
                                >
                                    {wallpaperPath ? (
                                        <Box
                                            component="img"
                                            src={wallpaperPath}
                                            alt="当前壁纸"
                                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                                            <ImageIcon sx={{ fontSize: 28, mb: 1 }} />
                                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                还没有选择壁纸
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                建议选择较暗或留白较多的图片，内容更易读
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                                <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                                        {wallpaperPath ? '当前已使用自定义壁纸' : '选择一张壁纸'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
                                        壁纸只作为底层氛围背景，内容可读性主要受下方“背景遮罩”和“壁纸显现”影响。
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        <Button
                                            variant="contained"
                                            size="small"
                                            startIcon={<PhotoCamera />}
                                            onClick={handleSelectWallpaper}
                                            disabled={selectingWallpaper}
                                        >
                                            {wallpaperPath ? '重新选择' : '选择图片'}
                                        </Button>
                                        {wallpaperPath && (
                                            <Button
                                                variant="outlined"
                                                size="small"
                                                startIcon={<Delete />}
                                                onClick={handleClearWallpaper}
                                            >
                                                移除壁纸
                                            </Button>
                                        )}
                                    </Box>
                                </Box>
                            </Box>
                        )}

                        {backgroundMode !== 'none' && (
                            <Box
                                sx={{
                                    ...backgroundPanelSx,
                                    px: 1.5,
                                    py: 1.25,
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
                                    <Box>
                                        <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                                            {backgroundEffectLabel}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {backgroundMode === 'wallpaper' ? '降低显现能减少干扰，适合文字阅读。' : '提高强度会让花纹更明显。'}
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36, textAlign: 'right' }}>
                                        {displayEffectValue}%
                                    </Typography>
                                </Box>
                                <Slider
                                    size="small"
                                    value={Math.max(effectSliderMin, Math.min(effectSliderMax, patternOpacity))}
                                    min={effectSliderMin}
                                    max={effectSliderMax}
                                    step={effectSliderStep}
                                    onChange={(_, v) => setPatternOpacity(v)}
                                    onChangeCommitted={(_, v) => {
                                        setPatternOpacity(v);
                                        window.electronAPI?.settings?.set('patternOpacity', v);
                                    }}
                                    sx={{ px: 0.5 }}
                                />
                            </Box>
                        )}
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    {/* 界面选项 */}
                    <List disablePadding>
                        <SettingRow
                            primary="背景遮罩"
                            secondary="调节内容区域的背景遮罩强度"
                            action={<ChipSelector options={maskOpacityOptions} value={maskOpacity}
                                onChange={v => handleSettingChange('maskOpacity', v)} />}
                        />
                        <SettingRow
                            primary="画布风格"
                            secondary="规整：使用规范字体与直线；手绘：使用 Excalidraw 默认手绘风格（同时影响 Mermaid 生成的图表）"
                            action={<ChipSelector options={whiteboardStyleOptions} value={whiteboardStyle || 'neat'}
                                onChange={v => handleSettingChange('whiteboardStyle', v)} />}
                        />
                        {!isMacOS && (
                            <SettingRow
                                primary={t('settings.titleBarStyle')}
                                secondary={t('settings.titleBarStyleDesc')}
                                action={(
                                    <ChipSelector options={titleBarOptions} value={titleBarStyle}
                                        onChange={v => handleSettingChange('titleBarStyle', v)} />
                                )}
                            />
                        )}
                        <SettingRow
                            primary="圣诞模式"
                            secondary="来点惊喜如何？"
                            action={(
                                <Switch
                                    checked={christmasMode || false}
                                    onChange={(e) => handleSettingChange('christmasMode', e.target.checked)}
                                />
                            )}
                        />
                    </List>
                    </Paper>
                </TabPanel>

                {/* 快捷键设置 */}
                <TabPanel value={settingsTabValue} index={2}>
                    <Paper elevation={0} sx={settingsSurfaceSx}>
                    <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                        <Box>
                            <Typography variant="h6" sx={sectionTitleSx}>{t('settings.shortcuts')}</Typography>
                            <Typography variant="caption" sx={sectionDescriptionSx}>
                                管理全局快捷键和输入行为
                            </Typography>
                        </Box>
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
                                <Paper
                                    key={categoryKey}
                                    variant="outlined"
                                    sx={(theme) => ({
                                        ...settingsRowSx(theme),
                                        p: 0,
                                        overflow: 'hidden',
                                    })}
                                >
                                    {/* 分类标题栏 */}
                                    <Box sx={(theme) => ({
                                        px: 2, py: 1.25,
                                        bgcolor: theme.palette.mode === 'dark'
                                            ? 'rgba(255,255,255,0.03)'
                                            : 'rgba(0,0,0,0.02)',
                                        borderBottom: '1px solid',
                                        borderColor: theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)',
                                        display: 'flex', alignItems: 'baseline', gap: 1,
                                    })}>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                            {category.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {category.description}
                                        </Typography>
                                    </Box>

                                    {/* 快捷键列表 */}
                                    <List disablePadding>
                                        {categoryShortcuts.map((config, index) => (
                                            <ListItem
                                                key={config.id}
                                                divider={index < categoryShortcuts.length - 1}
                                                sx={{ px: 2, py: 1 }}
                                            >
                                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                        {config.name}
                                                        {config.readOnly && (
                                                            <Typography
                                                                component="span"
                                                                variant="caption"
                                                                color="text.secondary"
                                                                sx={{ ml: 1, fontWeight: 400, fontStyle: 'italic' }}
                                                            >
                                                                · 由编辑器内置，不可修改
                                                            </Typography>
                                                        )}
                                                    </Typography>
                                                    {shortcutConflicts[config.id] && (
                                                        <Alert severity="warning" sx={{ mt: 0.5, py: 0 }} icon={<WarningIcon sx={{ fontSize: 16 }} />}>
                                                            {t('settings.shortcutConflict', { name: shortcutConflicts[config.id][0].name })}
                                                        </Alert>
                                                    )}
                                                </Box>
                                                <Box sx={{ minWidth: 200, ml: 2, display: 'flex', alignItems: 'center', gap: 1, opacity: config.readOnly ? 0.55 : 1 }}>
                                                    <ShortcutInput
                                                        value={config.currentKey}
                                                        defaultValue={config.defaultKey}
                                                        onChange={(newKey) => handleShortcutChange(config.id, newKey)}
                                                        onValidationChange={() => {}}
                                                        disabled={!!config.readOnly}
                                                        label=""
                                                        placeholder={t('settings.clickToSetShortcut')}
                                                    />
                                                    {config.defaultKey && config.currentKey !== config.defaultKey && (
                                                        <Chip
                                                            label={formatShortcutDisplay(config.defaultKey)}
                                                            size="small"
                                                            variant="outlined"
                                                            sx={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.5, flexShrink: 0 }}
                                                        />
                                                    )}
                                                </Box>
                                            </ListItem>
                                        ))}
                                    </List>
                                </Paper>
                            );
                        });
                    })()}
                    </Paper>
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
                    <Paper elevation={0} sx={settingsSurfaceSx}>
                    <Box sx={{ mb: 3 }}>
                        <UsageWaveCard
                            title="本地使用量"
                            subtitle="统计 Flota 在当前设备上的本地占用，便于判断是否需要清理图片、音频和插件数据。"
                            valueLabel={formatUsageBytes(localUsage?.totalBytes)}
                            metaLabel={
                                localUsage?.diskTotalBytes
                                    ? `占所在磁盘 ${formatUsagePercent(localUsage.usageRatio)} · 可用 ${formatUsageBytes(localUsage.diskAvailableBytes)}`
                                    : `数据目录：${localUsage?.userDataPath || '读取中'}`
                            }
                            percent={Number.isFinite(localUsage?.usageRatio) ? localUsage.usageRatio * 100 : null}
                            percentLabel={formatUsagePercent(localUsage?.usageRatio)}
                            segments={buildTopUsageSegments(localUsage?.categories)}
                            hint="统计范围包含数据库、图片与壁纸、音频、插件、同步缓存和日志状态文件。"
                            loading={localUsageLoading}
                            error={localUsageError}
                            onRefresh={loadLocalUsage}
                            refreshLabel="刷新统计"
                        />
                    </Box>

                    <Divider sx={{ my: 3 }} />

                    <Box sx={{ mb: 3 }}>
                        <Typography variant="h6" sx={sectionTitleSx}>
                            本地备份与恢复
                        </Typography>
                        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
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

                    <Divider sx={{ my: 3 }} />

                    <Box sx={{ mb: 3 }}>
                        <Typography variant="h6" sx={sectionTitleSx}>
                            Obsidian 导入导出
                        </Typography>
                        <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
                            从 Obsidian 导入笔记或导出笔记到 Obsidian 格式(.md)

                        </Typography>
                        <ObsidianImportExport />
                    </Box>

                    <Divider sx={{ my: 3 }} />

                    <List disablePadding>
                        <SettingRow
                            primary={t('settings.importLegacyData')}
                            secondary={t('settings.importLegacyDataDesc')}
                            action={(
                                <Button variant="contained" size="small" startIcon={<ImportIcon />} onClick={handleImportData}>
                                    {t('settings.importData')}
                                </Button>
                            )}
                        />
                        <SettingRow
                            primary={t('settings.databaseLocation')}
                            secondary="notes.db"
                            action={(
                                <Button variant="outlined" size="small" startIcon={<Launch />}
                                    onClick={() => window.electronAPI?.system?.openDataFolder?.()}>
                                    {t('settings.openFolder')}
                                </Button>
                            )}
                        />
                    </List>
                    </Paper>
                </TabPanel>

                {/* MCP 服务 */}
                <TabPanel value={settingsTabValue} index={9}>
                    <MCPSettings
                        enabled={settings.mcpEnabled}
                        onEnabledChange={(value) => handleSettingChange('mcpEnabled', value)}
                    />
                </TabPanel>

                {/* 编辑器设置 */}
                <TabPanel value={settingsTabValue} index={10}>
                    <Paper elevation={0} sx={settingsSurfaceSx}>
                    <Typography variant="h6" sx={sectionTitleSx}>编辑器</Typography>
                    <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 2 }}>
                        管理编辑模式、浮动面板和工具栏顺序
                    </Typography>
                    <List disablePadding sx={{ mb: 1 }}>
                        <SettingRow
                            primary={t('settings.editorMode')}
                            secondary={t('settings.editorModeDesc')}
                            action={<ChipSelector options={editorModeOptions} value={editorMode}
                                onChange={(value) => handleSettingChange('editorMode', value)} getIcon={o => o.icon} />}
                        />
                    </List>
                    <Alert severity="info" sx={{ mb: 3 }}>
                        <Typography variant="caption">
                            {t('settings.editorWarning')}
                        </Typography>
                    </Alert>
                    <Divider sx={{ mb: 3 }} />
                    <EditorSettingsPanel
                        aiPanelMode={aiPanelMode}
                        setAiPanelMode={setAiPanelMode}
                        toolbarOrder={toolbarOrder}
                        setToolbarOrder={setToolbarOrder}
                        floatingPanelItems={floatingPanelItems}
                        setFloatingPanelItems={setFloatingPanelItems}
                        contextMenuItems={contextMenuItems}
                        setContextMenuItems={setContextMenuItems}
                    />
                    </Paper>
                </TabPanel>

                {/* 关于 */}
                <TabPanel value={settingsTabValue} index={11}>
                    <Paper elevation={0} sx={{ ...settingsSurfaceSx, textAlign: 'center' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                            <img
                                src={isDark ? './about_darkmode.png' : './about_lightmode.png'}
                                alt="Flota"
                                style={{ maxWidth: '100%', width: 360, borderRadius: 12 }}
                            />
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 4 }}>
                            <Typography variant="body2" color="text.secondary">
                                {t('about.version')}{` v${appVersion || 'unknown'}`}
                            </Typography>
                            {updateInfo.checking ? (
                                <Tooltip title="正在检查更新">
                                    <span>
                                        <IconButton size="small" disabled sx={{ color: 'text.secondary' }}>
                                            <AutorenewIcon sx={{ fontSize: 16, animation: 'spin 1s linear infinite', '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } }} />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            ) : updateInfo.hasUpdate ? (
                                <Tooltip title={`发现新版本 v${updateInfo.latestVersion}，点击跳转下载`}>
                                    <IconButton
                                        size="small"
                                        onClick={() => window.electronAPI?.system?.openExternal?.(updateInfo.downloadUrl)}
                                        sx={{ color: 'warning.main' }}
                                    >
                                        <ArrowOutwardIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </Tooltip>
                            ) : (
                                <Tooltip title={updateInfo.error ? `检查失败，点击重试` : '已是最新版本，点击手动检查更新'}>
                                    <IconButton
                                        size="small"
                                        onClick={handleCheckForUpdates}
                                        sx={{ color: updateInfo.error ? 'text.secondary' : 'success.main' }}
                                    >
                                        <CheckIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>

                        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={<ContentCopyIcon />}
                                onClick={handleCopyDebugInfo}
                                sx={{
                                    borderRadius: 2,
                                    textTransform: 'none',
                                    px: 1.8,
                                    background: 'linear-gradient(135deg, rgba(25,118,210,0.95), rgba(66,165,245,0.9))',
                                    boxShadow: '0 6px 16px rgba(25,118,210,0.25)'
                                }}
                            >
                                {t('about.copyDebugInfo') || '复制调试信息'}
                            </Button>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<Launch />}
                                onClick={() => {
                                    if (window.electronAPI?.system) {
                                        window.electronAPI.system.openExternal('https://github.com/Xperiamol/Flota');
                                    }
                                }}
                            >
                                {t('about.githubRepo')}
                            </Button>
                        </Box>

                        <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
                            {t('about.copyright')}
                        </Typography>

                        <Divider sx={{ my: 4 }} />

                        <Typography variant="h6" gutterBottom>
                            {t('about.openSourceLicenses')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {t('about.openSourceDesc')}
                        </Typography>

                        <Box sx={{ textAlign: 'left', maxWidth: 540, mx: 'auto' }}>
                            {[
                                { title: 'MIT License', libs: [
                                    ['Electron', 'Copyright (c) 2013–2024 GitHub Inc.'],
                                    ['React', 'Copyright (c) Meta Platforms, Inc. and affiliates'],
                                    ['MUI (Material UI)', 'Copyright (c) 2014 Call-Em-All'],
                                    ['TipTap', 'Copyright (c) 2021 Übermind GmbH'],
                                    ['Excalidraw', 'Copyright (c) 2020 Excalidraw team'],
                                    ['Vite', 'Copyright (c) 2019–present Evan You'],
                                    ['better-sqlite3', 'Copyright (c) 2017–2024 Joshua Wise'],
                                    ['axios', 'Copyright (c) 2014–present Matt Zabriskie & Collaborators'],
                                    ['zustand', 'Copyright (c) 2019 Paul Henschel'],
                                    ['i18next', 'Copyright (c) 2012–present i18next'],
                                    ['markdown-it', 'Copyright (c) 2014 Vitaly Puzrin and Alex Kocharin'],
                                    ['date-fns', 'Copyright (c) 2021 The date-fns contributors'],
                                    ['ws', 'Copyright (c) 2011 Einar Otto Stangvik'],
                                    ['tsdav', 'Copyright (c) 2021 Nate Wang'],
                                    ['MCP SDK', 'Copyright (c) 2024 Anthropic, PBC'],
                                ]},
                                { title: 'Apache License 2.0', libs: [
                                    ['Transformers.js', 'Copyright (c) 2022 The HuggingFace Inc. team'],
                                    ['@googleapis/calendar', 'Copyright (c) 2012 Google LLC'],
                                ]},
                                { title: 'ISC License', libs: [
                                    ['lucide-react', 'Copyright (c) 2022 Lucide Contributors'],
                                ]},
                            ].map(group => (
                                <Box key={group.title} sx={{ mb: 2.5 }}>
                                    <Chip label={group.title} size="small" color="primary" variant="outlined" sx={{ mb: 1 }} />
                                    {group.libs.map(([name, copyright]) => (
                                        <Box key={name} sx={{ pl: 1, py: 0.5, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid', borderColor: 'divider' }}>
                                            <Box>
                                                <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', lineHeight: 1.4 }}>{name}</Typography>
                                                <Typography variant="caption" color="text.secondary">{copyright}</Typography>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            ))}
                        </Box>
                    </Paper>
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
