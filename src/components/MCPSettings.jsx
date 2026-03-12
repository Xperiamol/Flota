import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Button,
    Alert,
    LinearProgress,
    Chip,
    Card,
    CardContent,
    CardActions,
    Link,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions
} from '@mui/material';
import {
    Download as DownloadIcon,
    CheckCircle as CheckCircleIcon,
    Delete as DeleteIcon,
    Info as InfoIcon,
    Storage as StorageIcon,
    Code as CodeIcon,
    ContentCopy as CopyIcon
} from '@mui/icons-material';
import mcpAPI from '../api/mcpAPI';

export default function MCPSettings({ enabled, onEnabledChange }) {
    const [installed, setInstalled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [installInfo, setInstallInfo] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [copySuccess, setCopySuccess] = useState(false);
    const [uninstallDialog, setUninstallDialog] = useState(false);
    const [errorDialog, setErrorDialog] = useState({ open: false, message: '' });
    const [downloadConfirmDialog, setDownloadConfirmDialog] = useState(false);

    // 生成 Claude Desktop 配置 JSON
    const generateClaudeConfig = () => {
        if (!installInfo?.path) return null;
        
        // JSON.stringify 会自动转义反斜杠，所以这里直接使用原始路径
        const launcherPath = `${installInfo.path}\\mcp-server-launcher.js`;
        
        return {
            mcpServers: {
                Flota: {
                    command: 'node',
                    args: [launcherPath]
                }
            }
        };
    };

    // 复制配置到剪贴板
    const handleCopyConfig = async () => {
        const config = generateClaudeConfig();
        if (!config) return;

        try {
            const jsonText = JSON.stringify(config, null, 2);
            await navigator.clipboard.writeText(jsonText);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (error) {
            console.error('复制失败:', error);
            setErrorDialog({ open: true, message: '复制失败，请手动复制' });
        }
    };

    // 检查安装状态
    const checkInstallStatus = async () => {
        setLoading(true);
        try {
            const result = await mcpAPI.checkMCPInstalled();
            if (result.success) {
                setInstalled(result.data);
                if (result.data) {
                    const infoResult = await mcpAPI.getMCPInstallInfo();
                    if (infoResult.success) {
                        setInstallInfo(infoResult.data);
                    }
                }
            }
        } catch (error) {
            console.error('检查 MCP 安装状态失败:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkInstallStatus();
    }, []);

    // 显示下载确认对话框
    const handleInstallClick = () => {
        setDownloadConfirmDialog(true);
    };

    // 确认下载并开始安装
    const confirmInstall = async () => {
        setDownloadConfirmDialog(false);
        await handleInstall();
    };

    // 处理安装
    const handleInstall = async () => {
        setInstalling(true);
        setProgress(0);
        setStatusMessage('正在连接服务器...');

        try {
            // 监听进度事件
            const removeProgressListener = window.electronAPI.mcp.onProgress?.((data) => {
                setProgress(data.percent || 0);
                if (data.status === 'downloading') {
                    setStatusMessage(`下载中... ${data.percent}%`);
                } else if (data.status === 'extracting') {
                    setStatusMessage('正在解压...');
                }
            });

            const result = await mcpAPI.installMCPServer();
            
            if (removeProgressListener) removeProgressListener();

            if (result.success) {
                setStatusMessage('安装成功！');
                await checkInstallStatus();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('安装 MCP Server 失败:', error);
            setStatusMessage(`安装失败: ${error.message}`);
            setErrorDialog({ open: true, message: `安装失败: ${error.message}\n\n请检查网络连接或稍后重试。` });
        } finally {
            setInstalling(false);
            setProgress(0);
            setTimeout(() => setStatusMessage(''), 3000);
        }
    };

    // 处理卸载
    const handleUninstall = async () => {
        setUninstallDialog(true);
    };

    const confirmUninstall = async () => {
        setUninstallDialog(false);
        setLoading(true);
        try {
            const result = await mcpAPI.uninstallMCPServer();
            if (result.success) {
                setInstalled(false);
                setInstallInfo(null);
                if (enabled) {
                    onEnabledChange(false);
                }
            }
        } catch (error) {
            console.error('卸载 MCP Server 失败:', error);
        } finally {
            setLoading(false);
        }
    };

    // 处理启用/禁用
    const handleToggle = async (newValue) => {
        if (newValue && !installed) {
            // 需要先安装
            setErrorDialog({ open: true, message: '请先安装 MCP Server' });
            return;
        }
        onEnabledChange(newValue);
    };

    if (loading && !installing) {
        return <LinearProgress />;
    }

    return (
        <Box>
            {/* 状态卡片 */}
            <Card variant="outlined" sx={(theme) => ({
                mb: 2,
                borderRadius: 1,
                borderColor: theme.palette.divider,
                bgcolor: theme.palette.mode === 'dark'
                    ? 'rgba(255,255,255,0.02)'
                    : 'rgba(0,0,0,0.01)',
            })}>
                <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <CodeIcon color="primary" fontSize="large" />
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="h6">
                                Model Context Protocol Server
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                允许其他 AI 应用（如 Claude Desktop）调用 Flota 功能
                            </Typography>
                        </Box>
                        <Chip
                            icon={installed ? <CheckCircleIcon /> : <InfoIcon />}
                            label={installed ? '已安装' : '未安装'}
                            color={installed ? 'success' : 'default'}
                            size="small"
                        />
                    </Box>

                    {/* 安装信息 */}
                    {installed && installInfo && (
                        <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                            <Typography variant="caption" display="block" gutterBottom>
                                <StorageIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                                <strong>版本:</strong> {installInfo.version}
                            </Typography>
                            <Typography variant="caption" display="block" gutterBottom>
                                <strong>大小:</strong> {installInfo.size}
                            </Typography>
                            <Typography variant="caption" display="block" sx={{ wordBreak: 'break-all' }}>
                                <strong>路径:</strong> {installInfo.path}
                            </Typography>
                        </Box>
                    )}

                    {/* 安装进度 */}
                    {installing && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2" gutterBottom>
                                {statusMessage || `正在下载并安装... ${progress}%`}
                            </Typography>
                            <LinearProgress variant="determinate" value={progress} />
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                下载 78MB，请保持网络连接稳定
                            </Typography>
                        </Box>
                    )}
                </CardContent>

                <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
                    <Box>
                        {!installed ? (
                            <Button
                                variant="contained"
                                startIcon={<DownloadIcon />}
                                onClick={handleInstallClick}
                                disabled={installing}
                            >
                                {installing ? '安装中...' : '下载并安装 (~104MB)'}
                            </Button>
                        ) : (
                            <Button
                                variant="outlined"
                                color="error"
                                startIcon={<DeleteIcon />}
                                onClick={handleUninstall}
                                disabled={loading}
                            >
                                卸载
                            </Button>
                        )}
                    </Box>
                </CardActions>
            </Card>

            {/* 使用说明 */}
            {installed && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body2" gutterBottom sx={{ fontWeight: 600 }}>
                            配置 Claude Desktop:
                        </Typography>
                        <Button
                            fullWidth
                            size="small"
                            variant="contained"
                            startIcon={copySuccess ? <CheckCircleIcon /> : <CopyIcon />}
                            onClick={handleCopyConfig}
                            disabled={!installInfo}
                            color={copySuccess ? 'success' : 'primary'}
                            sx={{ mt: 1 }}
                        >
                            {copySuccess ? '已复制' : '复制配置'}
                        </Button>
                    </Box>
                    <Typography variant="caption" component="div" sx={{ mt: 1, color: 'text.secondary' }}>
                        1. 点击上方按钮复制配置 JSON<br />
                        2. 打开 Claude Desktop 配置文件<br />
                        &nbsp;&nbsp;&nbsp;• Windows: <code>%APPDATA%\Claude\claude_desktop_config.json</code><br />
                        &nbsp;&nbsp;&nbsp;• macOS: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code><br />
                        3. 将复制的配置粘贴到 <code>mcpServers</code> 对象中<br />
                        4. 保存文件并重启 Claude Desktop
                    </Typography>
                    
                    {installInfo && (
                        <Box sx={{ mt: 2, p: 1.5, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {JSON.stringify(generateClaudeConfig(), null, 2)}
                            </Typography>
                        </Box>
                    )}
                </Alert>
            )}

            {/* 卸载确认对话框 */}
            <Dialog open={uninstallDialog} onClose={() => setUninstallDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle>确认卸载</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        确定要卸载 MCP Server？卸载后需要重新下载才能使用。
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUninstallDialog(false)}>取消</Button>
                    <Button onClick={confirmUninstall} color="error" variant="contained">确认卸载</Button>
                </DialogActions>
            </Dialog>

            {/* 下载确认对话框 */}
            <Dialog open={downloadConfirmDialog} onClose={() => setDownloadConfirmDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle>MCP Server 未安装</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        首次使用 MCP 功能需要下载组件
                    </DialogContentText>
                    <DialogContentText sx={{ mt: 1, color: 'text.secondary' }}>
                        组件大小约 104 MB
                    </DialogContentText>
                    <DialogContentText sx={{ mt: 2 }}>
                        是否立即下载？
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDownloadConfirmDialog(false)}>取消</Button>
                    <Button onClick={confirmInstall} color="primary" variant="contained" startIcon={<DownloadIcon />}>
                        立即下载
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 错误提示对话框 */}
            <Dialog open={errorDialog.open} onClose={() => setErrorDialog({ open: false, message: '' })} maxWidth="xs" fullWidth>
                <DialogTitle>提示</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ whiteSpace: 'pre-wrap' }}>
                        {errorDialog.message}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setErrorDialog({ open: false, message: '' })} variant="contained">确定</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
