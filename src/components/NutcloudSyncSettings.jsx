import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Stack,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Radio,
  RadioGroup,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { spacing, flex, combo } from '../styles/commonStyles';
import { useError } from './ErrorProvider';

const NutcloudSyncSettings = () => {
  const { showError, showSuccess } = useError();
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cleaningImages, setCleaningImages] = useState(false);
  const [message, setMessage] = useState(null);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [cleanupStats, setCleanupStats] = useState({ orphanedCount: 0, totalSizeMB: 0 });
  const [retentionDays, setRetentionDays] = useState(30);
  const [forceFullSyncDialog, setForceFullSyncDialog] = useState(false);
  const [clearAllDialog, setClearAllDialog] = useState(false);

  const [config, setConfig] = useState({
    username: '',
    password: '',
    baseUrl: 'https://dav.jianguoyun.com/dav',
  });

  const [syncStatus, setSyncStatus] = useState(null);
  const [autoSync, setAutoSync] = useState(false);
  const [autoSyncInterval, setAutoSyncInterval] = useState(5);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const status = await window.electronAPI.sync.getStatus();
      if (status.v3) {
        setSyncStatus(status.v3);
        setAutoSync(status.v3.config?.autoSync || false);
        setAutoSyncInterval(status.v3.config?.autoSyncInterval || 5);

        // 只要有配置就加载，不管是否启用
        if (status.v3.config?.username) {
          setConfig({
            username: status.v3.config.username,
            password: '',
            baseUrl: status.v3.config.baseUrl || 'https://dav.jianguoyun.com/dav',
          });
        }
      }
    } catch (error) {
      console.error('加载同步状态失败:', error);
      showError(error, '加载同步状态失败');
    }
  };

  const handleTestConnection = async () => {
    if (!config.username || !config.password) {
      setMessage({ type: 'error', text: '请填写用户名和密码' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.sync.testConnection('Flota-v3', config);
      if (result) {
        setMessage({ type: 'success', text: 'WebDAV 连接测试成功！' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `连接测试失败: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleEnableSync = async () => {
    if (!config.username || !config.password) {
      setMessage({ type: 'error', text: '请填写用户名和密码' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      await window.electronAPI.sync.switchService('Flota-v3', config);
      setMessage({ type: 'success', text: '坚果云同步已启用！' });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `启用失败: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleDisableSync = async () => {
    setLoading(true);
    setMessage(null);

    try {
      await window.electronAPI.sync.disable();
      setMessage({ type: 'success', text: '同步已禁用' });
      // 不清空配置，保持用户已保存的配置信息
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `禁用失败: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleClearAccount = () => {
    setShowDisconnectDialog(true);
  };

  const handleConfirmDisconnect = async () => {
    setShowDisconnectDialog(false);
    setLoading(true);
    setMessage(null);

    try {
      // 先禁用同步
      if (syncStatus?.enabled) {
        await window.electronAPI.sync.disable();
      }
      // 清除配置
      await window.electronAPI.sync.clearAll();
      setMessage({ type: 'success', text: '账户已断开' });
      setSyncStatus(null);
      setConfig({ username: '', password: '', baseUrl: 'https://dav.jianguoyun.com/dav' });
    } catch (error) {
      setMessage({ type: 'error', text: `断开失败: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.sync.manualSync();
      setMessage({
        type: 'success',
        text: `同步完成！上传: ${result.uploaded || 0}, 下载: ${result.downloaded || 0}, 跳过: ${result.skipped || 0}`,
      });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `同步失败: ${error.message}` });
    } finally {
      setSyncing(false);
    }
  };

  const handleForceFullSync = async () => {
    setForceFullSyncDialog(true);
  };

  const confirmForceFullSync = async () => {
    setForceFullSyncDialog(false);
    setSyncing(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.sync.forceFullSync();
      setMessage({
        type: 'success',
        text: `强制全量同步完成！上传: ${result.uploaded || 0}`,
      });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `强制全量同步失败: ${error.message}` });
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleAutoSync = async (enabled) => {
    try {
      await window.electronAPI.sync.toggleAutoSync(enabled);
      setAutoSync(enabled);
      setMessage({ type: 'success', text: `自动同步已${enabled ? '启用' : '禁用'}` });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `切换自动同步失败: ${error.message}` });
    }
  };

  const handleSetAutoSyncInterval = async (minutes) => {
    try {
      await window.electronAPI.sync.setAutoSyncInterval(minutes);
      setAutoSyncInterval(minutes);
      setMessage({ type: 'success', text: `自动同步间隔已设置为 ${minutes} 分钟` });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `设置失败: ${error.message}` });
    }
  };

  const handleCleanupImages = async () => {
    if (!window.electronAPI?.sync?.cleanupUnusedImages) {
      setMessage({ type: 'error', text: '清理功能不可用' });
      return;
    }

    try {
      setCleaningImages(true);
      const statsResult = await window.electronAPI.sync.getUnusedImagesStats(retentionDays);

      if (!statsResult.success) {
        setMessage({ type: 'error', text: statsResult.error || '获取统计信息失败' });
        return;
      }

      const { orphanedCount, totalSizeMB } = statsResult.data;

      if (orphanedCount === 0) {
        setMessage({ type: 'info', text: '没有需要清理的未引用图片' });
        return;
      }

      setCleanupStats({ orphanedCount, totalSizeMB });
      setShowCleanupDialog(true);
    } catch (error) {
      console.error('清理图片失败:', error);
      showError(error, '清理图片失败');
      setMessage({ type: 'error', text: '清理失败: ' + error.message });
    } finally {
      setCleaningImages(false);
    }
  };

  const handleConfirmCleanup = async () => {
    setShowCleanupDialog(false);
    setCleaningImages(true);

    try {
      const result = await window.electronAPI.sync.cleanupUnusedImages(retentionDays);

      if (result.success) {
        const { deletedCount, totalSize } = result.data;
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        setMessage({
          type: 'success',
          text: `清理成功！删除 ${deletedCount} 个文件，释放 ${sizeMB} MB 空间`
        });
      } else {
        setMessage({ type: 'error', text: result.error || '清理失败' });
      }
    } catch (error) {
      console.error('清理图片失败:', error);
      showError(error, '清理图片失败');
      setMessage({ type: 'error', text: '清理失败: ' + error.message });
    } finally {
      setCleaningImages(false);
    }
  };

  const handleClearAll = async () => {
    setClearAllDialog(true);
  };

  const confirmClearAll = async () => {
    setClearAllDialog(false);
    setLoading(true);
    try {
      await window.electronAPI.sync.clearAll();
      setMessage({ type: 'success', text: '所有配置和缓存已清除' });
      setSyncStatus(null);
      setConfig({ username: '', password: '', baseUrl: 'https://dav.jianguoyun.com/dav' });
    } catch (error) {
      setMessage({ type: 'error', text: `清除失败: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" sx={spacing.mb2}>
        坚果云同步设置
      </Typography>

      {message && (
        <Alert
          severity={message.type}
          sx={spacing.mb2}
          onClose={() => setMessage(null)}
        >
          {message.text}
        </Alert>
      )}

      {!syncStatus?.config?.username ? (
        <Box>
          <Alert severity="info" sx={spacing.mb2}>
            使用坚果云WebDAV同步笔记数据。请在坚果云设置中获取应用密码。
          </Alert>

          <Stack spacing={2}>
            <TextField
              fullWidth
              label="WebDAV 地址"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              size="small"
            />
            <TextField
              fullWidth
              label="用户名"
              value={config.username}
              onChange={(e) => setConfig({ ...config, username: e.target.value })}
              size="small"
              placeholder="您的坚果云账号"
            />
            <TextField
              fullWidth
              label="应用密码"
              type="password"
              value={config.password}
              onChange={(e) => setConfig({ ...config, password: e.target.value })}
              size="small"
              placeholder="在坚果云设置中生成"
              helperText="前往坚果云网页版 > 账户信息 > 安全选项 > 添加应用"
            />

            <Box display="flex" gap={1}>
              <Button
                variant="outlined"
                onClick={handleTestConnection}
                disabled={loading}
                size="small"
              >
                测试连接
              </Button>
              <Button
                variant="contained"
                onClick={handleEnableSync}
                disabled={loading}
              >
                启用同步
              </Button>
            </Box>
          </Stack>
        </Box>
      ) : (
        <Box>
          {syncStatus && syncStatus.lastError && (
            <Alert severity="error" sx={spacing.mb2}>
              {syncStatus.lastError}
            </Alert>
          )}

          {/* 账户管理 */}
          <Box sx={combo.section}>
            <Typography variant="subtitle2" sx={spacing.mb1}>账户</Typography>
            <Typography variant="body2" color="text.secondary" sx={spacing.mb1}>
              已配置账户: {config.username}
            </Typography>
            <Box display="flex" gap={1}>
              {syncStatus && syncStatus.enabled ? (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleDisableSync}
                  disabled={loading}
                >
                  禁用同步
                </Button>
              ) : (
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleEnableSync}
                  disabled={loading}
                >
                  启用同步
                </Button>
              )}
              <Button
                variant="outlined"
                size="small"
                color="error"
                onClick={handleClearAccount}
                disabled={loading}
              >
                断开账户
              </Button>
            </Box>
          </Box>

          {/* 只有启用状态才显示以下功能 */}
          {syncStatus && syncStatus.enabled && (
            <>
              {/* 自动同步 */}
              <Box sx={combo.section}>
                <Typography variant="subtitle2" sx={spacing.mb1}>自动同步</Typography>
                <Stack spacing={2}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoSync}
                        onChange={(e) => handleToggleAutoSync(e.target.checked)}
                      />
                    }
                    label="启用自动同步"
                  />
                  {autoSync && (
                    <FormControl size="small" fullWidth>
                      <InputLabel>同步间隔</InputLabel>
                      <Select
                        value={autoSyncInterval}
                        label="同步间隔"
                        onChange={(e) => handleSetAutoSyncInterval(e.target.value)}
                      >
                        <MenuItem value={1}>1 分钟</MenuItem>
                        <MenuItem value={5}>5 分钟</MenuItem>
                        <MenuItem value={10}>10 分钟</MenuItem>
                        <MenuItem value={30}>30 分钟</MenuItem>
                        <MenuItem value={60}>1 小时</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                </Stack>
              </Box>

              {/* 同步操作 */}
              <Box sx={combo.section}>
                <Typography variant="subtitle2" sx={spacing.mb1}>同步操作</Typography>
                <Box sx={{ ...flex.rowGap1, flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleManualSync}
                    disabled={syncing}
                    startIcon={<RefreshIcon />}
                  >
                    立即同步
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    color="warning"
                    onClick={handleForceFullSync}
                    disabled={syncing}
                  >
                    强制全量同步
                  </Button>
                </Box>
              </Box>

              {/* 维护 */}
              <Box sx={combo.section}>
                <Typography variant="subtitle2" sx={spacing.mb1}>维护</Typography>
                <Box sx={{ ...flex.rowGap2, flexWrap: 'wrap' }}>
                  <FormControl size="small">
                    <RadioGroup
                      row
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(Number(e.target.value))}
                    >
                      <FormControlLabel value={0} control={<Radio size="small" />} label="0天" />
                      <FormControlLabel value={7} control={<Radio size="small" />} label="7天" />
                      <FormControlLabel value={30} control={<Radio size="small" />} label="30天" />
                      <FormControlLabel value={90} control={<Radio size="small" />} label="90天" />
                    </RadioGroup>
                  </FormControl>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleCleanupImages}
                    disabled={syncing || cleaningImages}
                    startIcon={<DeleteIcon />}
                  >
                    清理未使用图片
                  </Button>
                </Box>
              </Box>

              {/* 危险操作 */}
              <Box>
                <Typography variant="subtitle2" gutterBottom color="error">
                  危险操作
                </Typography>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={handleClearAll}
                  disabled={loading}
                  size="small"
                >
                  清除所有配置和缓存
                </Button>
              </Box>
            </>
          )}
        </Box>
      )}

      {/* 清理确认对话框 */}
      <Dialog open={showCleanupDialog} onClose={() => setShowCleanupDialog(false)}>
        <DialogTitle>清理未使用图片</DialogTitle>
        <DialogContent>
          <Typography>
            发现 {cleanupStats.orphanedCount} 个未引用图片，共 {cleanupStats.totalSizeMB.toFixed(2)} MB
            {retentionDays > 0 && `，超过 ${retentionDays} 天未被使用`}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            此操作不可恢复，确定要删除吗？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setShowCleanupDialog(false)}>
            取消
          </Button>
          <Button size="small" onClick={handleConfirmCleanup} variant="contained" color="error">
            确认删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 强制全量同步确认对话框 */}
      <Dialog open={forceFullSyncDialog} onClose={() => setForceFullSyncDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>确认强制全量同步</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要强制全量同步吗？这将清空云端并重新上传所有数据。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setForceFullSyncDialog(false)}>取消</Button>
          <Button size="small" onClick={confirmForceFullSync} variant="contained" color="warning">确认同步</Button>
        </DialogActions>
      </Dialog>

      {/* 清除所有配置确认对话框 */}
      <Dialog open={clearAllDialog} onClose={() => setClearAllDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>确认清除配置</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要清除所有同步配置和缓存吗？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setClearAllDialog(false)}>取消</Button>
          <Button size="small" onClick={confirmClearAll} variant="contained" color="error">确认清除</Button>
        </DialogActions>
      </Dialog>

      {/* 断开账户确认对话框 */}
      <Dialog open={showDisconnectDialog} onClose={() => setShowDisconnectDialog(false)}>
        <DialogTitle>断开账户</DialogTitle>
        <DialogContent>
          <Typography>
            确定要断开坚果云账户吗？
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            这将清除所有配置信息，下次使用需要重新配置。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setShowDisconnectDialog(false)}>
            取消
          </Button>
          <Button size="small" onClick={handleConfirmDisconnect} variant="contained" color="error">
            确认断开
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NutcloudSyncSettings;
