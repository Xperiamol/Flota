import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  Alert,
  Divider,
  Chip,
  Stack
} from '@mui/material';
import {
  Warning as WarningIcon,
  Schedule as ScheduleIcon,
  Computer as LocalIcon,
  Cloud as CloudIcon,
  CompareArrows as CompareIcon
} from '@mui/icons-material';

/**
 * 冲突解决对话框组件
 * 当同步时检测到冲突（本地和远程都有修改）时显示
 */
const ConflictResolutionDialog = ({ open, conflict, onResolve, onCancel }) => {
  const [selectedTab, setSelectedTab] = useState(0);

  if (!conflict) return null;

  const {
    fileId,
    fileName,
    fileType,
    localVersion,
    remoteVersion,
    localTime,
    remoteTime
  } = conflict;

  // 格式化时间
  const formatTime = (timestamp) => {
    if (!timestamp) return '未知';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 格式化文件类型
  const getFileTypeLabel = (type) => {
    switch (type) {
      case 'note':
        return '笔记';
      case 'whiteboard':
        return '白板';
      case 'todos':
        return '待办事项';
      case 'settings':
        return '设置';
      default:
        return '文件';
    }
  };

  // 渲染内容预览
  const renderContentPreview = (content, label, time) => {
    if (!content) {
      return (
        <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
          无内容
        </Box>
      );
    }

    // 对于 JSON 数据，美化显示
    let displayContent = content;
    if (typeof content === 'object') {
      try {
        displayContent = JSON.stringify(content, null, 2);
      } catch (e) {
        displayContent = String(content);
      }
    }

    return (
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">
            {label}
          </Typography>
          <Chip
            icon={<ScheduleIcon />}
            label={formatTime(time)}
            size="small"
            variant="outlined"
          />
        </Stack>
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            maxHeight: 300,
            overflow: 'auto',
            bgcolor: 'background.default',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {displayContent}
        </Paper>
      </Box>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: { minHeight: '60vh' }
        }
      }}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <WarningIcon color="warning" />
          <Typography variant="h6">
            检测到同步冲突
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2">
            <strong>{getFileTypeLabel(fileType)}</strong> "{fileName || fileId}"
            在本地和云端都有修改。请选择要保留的版本。
          </Typography>
        </Alert>

        <Tabs
          value={selectedTab}
          onChange={(_, newValue) => setSelectedTab(newValue)}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            icon={<LocalIcon />}
            label="本地版本"
            iconPosition="start"
          />
          <Tab
            icon={<CloudIcon />}
            label="远程版本"
            iconPosition="start"
          />
          <Tab
            icon={<CompareIcon />}
            label="对比"
            iconPosition="start"
          />
        </Tabs>

        {/* 本地版本 */}
        {selectedTab === 0 && (
          <Box>
            {renderContentPreview(localVersion, '本地版本', localTime)}
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              最后修改：{formatTime(localTime)}
            </Typography>
          </Box>
        )}

        {/* 远程版本 */}
        {selectedTab === 1 && (
          <Box>
            {renderContentPreview(remoteVersion, '远程版本', remoteTime)}
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              最后修改：{formatTime(remoteTime)}
            </Typography>
          </Box>
        )}

        {/* 对比视图 */}
        {selectedTab === 2 && (
          <Stack spacing={2}>
            {renderContentPreview(localVersion, '本地版本', localTime)}
            <Divider>
              <Chip label="VS" size="small" />
            </Divider>
            {renderContentPreview(remoteVersion, '远程版本', remoteTime)}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onCancel} color="inherit">
          取消同步
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={() => onResolve('local')}
          variant="outlined"
          startIcon={<LocalIcon />}
          color="primary"
        >
          使用本地版本
        </Button>
        <Button
          onClick={() => onResolve('remote')}
          variant="contained"
          startIcon={<CloudIcon />}
          color="primary"
        >
          使用远程版本
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConflictResolutionDialog;
