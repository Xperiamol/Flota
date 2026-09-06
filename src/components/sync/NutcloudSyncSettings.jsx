import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  AlertTitle,
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
  Stepper,
  Step,
  StepLabel,
  Avatar,
  IconButton,
  Chip,
  Divider,
  Collapse,
  Tooltip,
  CircularProgress,
  LinearProgress,
  Link as MuiLink,
  Paper,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  CloudDone as CloudDoneIcon,
  CloudOff as CloudOffIcon,
  CloudSync as CloudSyncIcon,
  CloudQueue as CloudQueueIcon,
  ErrorOutline as ErrorOutlineIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  CheckCircle as CheckCircleIcon,
  HelpOutline as HelpOutlineIcon,
  PlayArrow as PlayArrowIcon,
  Logout as LogoutIcon,
} from '../common/AppIcons';
import { spacing } from '../../styles/commonStyles';
import { useError } from '../common/ErrorProvider';

const DEFAULT_BASE_URL = 'https://dav.jianguoyun.com/dav';
const DEFAULT_ROOT_PATH = '/Flota/';

const SYNC_INTERVAL_OPTIONS = [
  { value: 1, label: '每 1 分钟' },
  { value: 5, label: '每 5 分钟' },
  { value: 10, label: '每 10 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每 1 小时' },
];

const ERROR_HINT_MAP = {
  auth: {
    title: '账号或应用密码不正确',
    advice: '请确认坚果云用户名（邮箱）正确，且使用的是「应用密码」而不是登录密码。',
  },
  network: {
    title: '无法连接到坚果云',
    advice: '请检查网络连接，必要时尝试切换到代理或更稳定的网络。',
  },
  quota: {
    title: '坚果云空间不足',
    advice: '请前往坚果云释放空间，或升级套餐后再试。',
  },
  server: {
    title: '坚果云服务暂时不可用',
    advice: '稍后再试一次；若长时间无响应可以查看坚果云官方状态页。',
  },
  unknown: {
    title: '同步失败',
    advice: '请稍后重试。如果问题持续存在，可点击「测试连接」获取更详细的诊断信息。',
  },
};

const createEmptyDraft = () => ({
  username: '',
  password: '',
  baseUrl: DEFAULT_BASE_URL,
  rootPath: DEFAULT_ROOT_PATH,
});

const buildConfigPayload = (draft, hasSavedPassword) => {
  const payload = {
    username: draft.username,
    baseUrl: draft.baseUrl,
    rootPath: draft.rootPath,
  };

  // 密码框为空且已有保存密码时，省略 password 字段，让后端复用已保存凭据。
  // 只有用户显式输入新密码时，才更新保存的应用密码。
  if (draft.password || !hasSavedPassword) {
    payload.password = draft.password;
  }

  return payload;
};

const formatRelativeTime = (timestamp) => {
  if (!timestamp) return '从未同步';
  const diff = Date.now() - timestamp;
  if (diff < 0) return '刚刚';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleString();
};

const formatCountdown = (timestamp) => {
  if (!timestamp) return null;
  const diff = timestamp - Date.now();
  if (diff <= 0) return '即将同步';
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `约 ${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  return `约 ${hours} 小时后`;
};

const initialOf = (name) => {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed[0].toUpperCase();
};

/* =========================================================
 * 顶部状态卡片
 * ========================================================= */
const StatusHero = ({ syncStatus, syncing, onSyncNow }) => {
  const isEnabled = !!syncStatus?.enabled;
  const isError = syncStatus?.status === 'error' || !!syncStatus?.lastError;
  const lastSyncTime = syncStatus?.lastSyncTime;

  let palette = 'info';
  let Icon = CloudQueueIcon;
  let title = '尚未连接坚果云';
  let subtitle = '配置 WebDAV 账户后即可在多端同步笔记、图片、待办与设置。';

  if (syncing) {
    palette = 'info';
    Icon = CloudSyncIcon;
    title = '正在同步…';
    subtitle = '请保持网络畅通，过程中可继续编辑笔记。';
  } else if (isError && isEnabled) {
    palette = 'error';
    Icon = ErrorOutlineIcon;
    title = '上次同步未成功';
    subtitle = syncStatus?.lastError || '请查看下方错误说明并重试。';
  } else if (isEnabled) {
    palette = 'success';
    Icon = CloudDoneIcon;
    title = '云端已是最新';
    subtitle = `上次同步：${formatRelativeTime(lastSyncTime)}`;
  } else if (syncStatus?.accountConfigured) {
    palette = 'warning';
    Icon = CloudOffIcon;
    title = '同步已停用';
    subtitle = '账户和应用密码已保存；当前不会自动同步，也不能手动同步。';
  }

  const bg = {
    info: 'rgba(33, 150, 243, 0.08)',
    success: 'rgba(46, 125, 50, 0.10)',
    warning: 'rgba(237, 108, 2, 0.10)',
    error: 'rgba(211, 47, 47, 0.10)',
  }[palette];

  const fg = {
    info: 'info.main',
    success: 'success.main',
    warning: 'warning.main',
    error: 'error.main',
  }[palette];

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        mb: 2,
        borderRadius: 1.5,
        bgcolor: bg,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Avatar sx={{ bgcolor: fg, width: 44, height: 44 }}>
          <Icon />
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
          {isEnabled && syncStatus?.config?.autoSync && syncStatus?.nextAutoSyncTime ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              下次自动同步：{formatCountdown(syncStatus.nextAutoSyncTime) || '—'}
            </Typography>
          ) : null}
        </Box>
        {isEnabled && (
          <Button
            variant="contained"
            size="small"
            startIcon={syncing ? <CircularProgress color="inherit" size={14} /> : <RefreshIcon />}
            onClick={onSyncNow}
            disabled={syncing}
            sx={{ alignSelf: 'center' }}
          >
            {syncing ? '同步中' : '立即同步'}
          </Button>
        )}
      </Box>
      {syncing && (
        <LinearProgress sx={{ mt: 1.5, borderRadius: 1 }} />
      )}
    </Paper>
  );
};

/* =========================================================
 * 错误指引
 * ========================================================= */
const ErrorGuide = ({ syncStatus, onRetry }) => {
  if (!syncStatus?.lastError) return null;
  const category = syncStatus.lastErrorCategory || 'unknown';
  const hint = ERROR_HINT_MAP[category] || ERROR_HINT_MAP.unknown;

  return (
    <Alert
      severity="error"
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          重试同步
        </Button>
      }
    >
      <AlertTitle>{hint.title}</AlertTitle>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {hint.advice}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        详情：{syncStatus.lastError}
      </Typography>
    </Alert>
  );
};

/* =========================================================
 * 空态：尚未配置任何账户
 * ========================================================= */
const EmptyState = ({ onStart }) => (
  <Paper
    elevation={0}
    sx={{
      p: 4,
      textAlign: 'center',
      borderRadius: 1.5,
      border: '1px dashed',
      borderColor: 'divider',
    }}
  >
    <Avatar
      sx={{
        width: 56,
        height: 56,
        bgcolor: 'primary.main',
        mx: 'auto',
        mb: 2,
      }}
    >
      <CloudQueueIcon fontSize="large" />
    </Avatar>
    <Typography variant="h6" sx={{ mb: 1 }}>
      连接坚果云，开始多端同步
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 420, mx: 'auto' }}>
      使用坚果云的 WebDAV 协议，把你的笔记、图片、设置和待办安全地保存在云端，
      并在所有设备上保持一致。
    </Typography>
    <Button variant="contained" size="large" startIcon={<PlayArrowIcon />} onClick={onStart}>
      开始配置
    </Button>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
      没有应用密码？{' '}
      <MuiLink
        href="https://help.jianguoyun.com/?p=2064"
        target="_blank"
        rel="noopener noreferrer"
        underline="hover"
      >
        查看如何在坚果云生成
      </MuiLink>
    </Typography>
  </Paper>
);

/* =========================================================
 * 引导式 Setup Wizard
 * ========================================================= */
const SetupWizard = ({
  draft,
  setDraft,
  testing,
  saving,
  testResult,
  onTest,
  onFinish,
  onCancel,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  // 当外部 onFinish 失败把 testResult 置为 error 时，回退到「验证连接」步
  useEffect(() => {
    if (testResult?.type === 'error' && activeStep === 2) {
      setActiveStep(1);
    }
  }, [testResult, activeStep]);

  const steps = ['填写账户信息', '验证连接', '启用同步'];

  const goNext = () => setActiveStep((s) => Math.min(s + 1, steps.length - 1));
  const goBack = () => setActiveStep((s) => Math.max(s - 1, 0));

  // 必须显式输入用户名 + 密码（不再有"已保存密码"的隐式兜底）
  const canNextFromAccount =
    !!draft.username.trim() && !!draft.password;

  const handleTest = async () => {
    const ok = await onTest();
    if (ok) {
      setActiveStep(2);
    }
  };

  return (
    <Paper
      elevation={0}
      sx={{ p: 3, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}
    >
      <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {activeStep === 0 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            登录{' '}
            <MuiLink
              href="https://www.jianguoyun.com/d/home"
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
            >
              坚果云网页版
            </MuiLink>
            ，进入「账户信息 → 安全选项 → 添加应用」生成一个应用密码。
          </Typography>
          <TextField
            fullWidth
            autoFocus
            label="坚果云账号（邮箱）"
            value={draft.username}
            onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
            placeholder="example@domain.com"
            size="small"
          />
          <TextField
            fullWidth
            label="应用密码"
            type={showPassword ? 'text' : 'password'}
            value={draft.password}
            onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
            placeholder="坚果云生成的应用密码"
            helperText="首次配置或更换账号时需要输入完整的坚果云应用密码"
            size="small"
            slotProps={{
              input: {
              endAdornment: (
                <IconButton size="small" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              ),
              },
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
            <Button onClick={onCancel}>取消</Button>
            <Button variant="contained" onClick={goNext} disabled={!canNextFromAccount}>
              下一步
            </Button>
          </Box>
        </Stack>
      )}

      {activeStep === 1 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            我们会用刚才填写的信息访问一次你的坚果云，确认账户可以正常连接。
            此过程不会修改任何数据。
          </Typography>
          <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">将测试以下连接：</Typography>
              <Typography variant="body2"><strong>账号：</strong>{draft.username}</Typography>
              <Typography variant="body2"><strong>WebDAV：</strong>{draft.baseUrl}</Typography>
              <Typography variant="body2"><strong>目录：</strong>{draft.rootPath}</Typography>
            </Stack>
          </Box>
          {testResult?.type === 'success' && (
            <Alert severity="success" icon={<CheckCircleIcon />}>
              连接成功！正在为你跳转到「启用同步」步骤…
            </Alert>
          )}
          {testResult?.type === 'error' && (
            <Alert severity="error">
              {testResult.text}
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  如果你已确认账号和应用密码无误但仍然失败，可能是之前残留的错误配置在干扰，
                  请返回上一步重新填写完整的密码。
                </Typography>
              </Box>
            </Alert>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={goBack}>上一步</Button>
            <Button
              variant="contained"
              onClick={handleTest}
              disabled={testing || !draft.username.trim() || !draft.password}
              startIcon={testing ? <CircularProgress size={14} /> : null}
            >
              {testing ? '测试中…' : (testResult?.type === 'error' ? '重新测试连接' : '测试连接并继续')}
            </Button>
          </Box>
        </Stack>
      )}

      {activeStep === 2 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            一切就绪！点击下方按钮启用同步，Flota 会立即执行一次首轮同步，
            随后保持自动同步。
          </Typography>
          <Alert severity="info">
            首轮同步可能需要较长时间，具体取决于你的笔记和图片数量。
          </Alert>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={goBack}>上一步</Button>
            <Button
              variant="contained"
              onClick={onFinish}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={14} /> : <CloudDoneIcon />}
            >
              {saving ? '启用中…' : '启用同步'}
            </Button>
          </Box>
        </Stack>
      )}
    </Paper>
  );
};

/* =========================================================
 * 已配置后的管理视图
 * ========================================================= */
const ManageView = ({
  syncStatus,
  draft,
  setDraft,
  loading,
  testing,
  syncing,
  cleaningImages,
  retentionDays,
  setRetentionDays,
  advancedMessage,
  handlers,
  showAdvanced,
  setShowAdvanced,
  showDanger,
  setShowDanger,
}) => {
  const isEnabled = !!syncStatus?.enabled;
  const username = syncStatus?.config?.username || draft.username;
  const hasSavedPassword = !!syncStatus?.config?.hasSavedPassword;
  const autoSync = !!syncStatus?.config?.autoSync;
  const intervalMinutes = Math.round(syncStatus?.config?.autoSyncInterval || 5);
  const savedBaseUrl = syncStatus?.config?.baseUrl || DEFAULT_BASE_URL;
  const savedRootPath = syncStatus?.config?.rootPath || DEFAULT_ROOT_PATH;
  const hasAdvancedChanges = draft.baseUrl !== savedBaseUrl || draft.rootPath !== savedRootPath || !!draft.password;
  const saveAdvancedIfChanged = () => {
    if (hasAdvancedChanges) handlers.onSave();
  };

  return (
    <Stack spacing={2}>
      {/* 账户卡片 */}
      <Paper
        elevation={0}
        sx={{ p: 2, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 44, height: 44 }}>
            {initialOf(username)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                {username || '未命名账户'}
              </Typography>
              <Chip
                size="small"
                label={isEnabled ? '同步运行中' : '同步已停用'}
                color={isEnabled ? 'success' : 'default'}
                variant={isEnabled ? 'filled' : 'outlined'}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {syncStatus?.config?.baseUrl || DEFAULT_BASE_URL}
            </Typography>
          </Box>
          {isEnabled ? (
            <Button
              size="small"
              variant="outlined"
              onClick={handlers.onDisable}
              disabled={loading}
            >
              停用同步
            </Button>
          ) : (
            <Button
              size="small"
              variant="contained"
              onClick={handlers.onEnable}
              disabled={loading}
            >
              恢复同步
            </Button>
          )}
          <Tooltip title="断开账户">
            <IconButton onClick={handlers.onDisconnect} disabled={loading}>
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>

      {/* 自动同步 */}
      <Paper
        elevation={0}
        sx={{ p: 2, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
          自动同步
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            px: 0.5,
            py: 0.25,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0, pr: 1 }}>
            <Typography variant="body2">在后台定时同步</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              {isEnabled ? '应用运行时按指定间隔自动同步' : '同步停用时不会后台同步'}
            </Typography>
          </Box>
          <Switch
            checked={autoSync}
            onChange={(e) => handlers.onToggleAutoSync(e.target.checked)}
            disabled={!isEnabled}
          />
        </Box>
        <Collapse in={autoSync && isEnabled}>
          <FormControl size="small" sx={{ mt: 2, minWidth: 200, ml: 0.5 }}>
            <InputLabel>同步频率</InputLabel>
            <Select
              value={intervalMinutes}
              label="同步频率"
              onChange={(e) => handlers.onSetInterval(Number(e.target.value))}
            >
              {SYNC_INTERVAL_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Collapse>
      </Paper>

      {/* 维护 */}
      {isEnabled && (
        <Paper
          elevation={0}
          sx={{ p: 2, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
            存储维护
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            清理云端中已不再被任何笔记引用的图片，释放空间。
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControl size="small">
              <RadioGroup
                row
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
              >
                <FormControlLabel value={0} control={<Radio size="small" />} label="全部" />
                <FormControlLabel value={7} control={<Radio size="small" />} label="超过 7 天" />
                <FormControlLabel value={30} control={<Radio size="small" />} label="超过 30 天" />
                <FormControlLabel value={90} control={<Radio size="small" />} label="超过 90 天" />
              </RadioGroup>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              onClick={handlers.onCleanup}
              disabled={syncing || cleaningImages}
              startIcon={cleaningImages ? <CircularProgress size={14} /> : <DeleteIcon />}
            >
              清理未引用图片
            </Button>
          </Box>
        </Paper>
      )}

      {/* 高级 */}
      <Paper
        elevation={0}
        sx={{ borderRadius: 1.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}
      >
        <Box
          onClick={() => setShowAdvanced((v) => !v)}
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>高级设置</Typography>
            <Typography variant="caption" color="text.secondary">
              修改 WebDAV 地址、远程目录或更新应用密码
            </Typography>
          </Box>
          {showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </Box>
        <Collapse in={showAdvanced}>
          <Divider />
          <Box sx={{ p: 2 }}>
            <Stack spacing={2}>
              {advancedMessage && (
                <Alert severity={advancedMessage.type}>
                  {advancedMessage.text}
                </Alert>
              )}
              <TextField
                fullWidth
                size="small"
                label="WebDAV 地址"
                value={draft.baseUrl}
                onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                onBlur={saveAdvancedIfChanged}
                helperText="修改后离开输入框自动保存"
              />
              <TextField
                fullWidth
                size="small"
                label="远程根目录"
                value={draft.rootPath}
                onChange={(e) => setDraft((d) => ({ ...d, rootPath: e.target.value }))}
                onBlur={saveAdvancedIfChanged}
                helperText="同步数据保存在 WebDAV 的哪个目录下，修改后会自动保存"
              />
              <TextField
                fullWidth
                size="small"
                type="password"
                label="更新应用密码"
                value={draft.password}
                onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
                onBlur={saveAdvancedIfChanged}
                placeholder={hasSavedPassword ? '留空表示继续使用已保存密码' : '请输入完整的应用密码'}
                helperText={hasSavedPassword ? '留空不会清除旧密码；输入新密码并离开输入框后自动更新。' : '首次配置必须填写完整的坚果云应用密码。'}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button size="small" variant="outlined" onClick={handlers.onTest} disabled={loading || testing}>
                  {testing ? '测试中…' : '测试连接'}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Collapse>
      </Paper>

      {/* 危险区 */}
      <Paper
        elevation={0}
        sx={{ borderRadius: 1.5, border: '1px solid', borderColor: 'error.light', overflow: 'hidden' }}
      >
        <Box
          onClick={() => setShowDanger((v) => !v)}
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box>
            <Typography variant="subtitle2" color="error" sx={{ fontWeight: 600 }}>
              危险操作
            </Typography>
            <Typography variant="caption" color="text.secondary">
              这些操作不可恢复，请谨慎使用
            </Typography>
          </Box>
          {showDanger ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </Box>
        <Collapse in={showDanger}>
          <Divider />
          <Box sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              {isEnabled && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                  <Box>
                    <Typography variant="body2">重建同步索引</Typography>
                    <Typography variant="caption" color="text.secondary">
                      仅用于修复 manifest 异常，不代表“本机覆盖云端”或“云端覆盖本机”
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    color="warning"
                    onClick={handlers.onForceFull}
                    disabled={syncing}
                  >
                    重建
                  </Button>
                </Box>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography variant="body2">清除所有同步配置和缓存</Typography>
                  <Typography variant="caption" color="text.secondary">
                    将本地保存的账户、密码和同步缓存全部清空
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  onClick={handlers.onClearAll}
                  disabled={loading}
                >
                  清除
                </Button>
              </Box>
            </Stack>
          </Box>
        </Collapse>
      </Paper>
    </Stack>
  );
};

/* =========================================================
 * 主组件
 * ========================================================= */
const NutcloudSyncSettings = () => {
  const { showError } = useError();

  // 远端状态
  const [syncStatus, setSyncStatus] = useState(null);

  // 草稿（用户输入）
  const [draft, setDraft] = useState(createEmptyDraft());

  // UI 状态
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleaningImages, setCleaningImages] = useState(false);
  const [message, setMessage] = useState(null);
  const [testResult, setTestResult] = useState(null);

  // 视图模式：auto | setup
  const [viewMode, setViewMode] = useState('auto');

  // 折叠区
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDanger, setShowDanger] = useState(false);

  // 维护
  const [retentionDays, setRetentionDays] = useState(30);

  // 各种确认弹窗
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [forceFullSyncDialog, setForceFullSyncDialog] = useState(false);
  const [clearAllDialog, setClearAllDialog] = useState(false);
  const [cleanupStats, setCleanupStats] = useState({ orphanedCount: 0, totalSizeMB: 0 });

  const accountConfigured = !!syncStatus?.accountConfigured;

  const stage = useMemo(() => {
    if (viewMode === 'setup') return 'SETUP';
    if (!accountConfigured) return 'EMPTY';
    return 'MANAGE';
  }, [viewMode, accountConfigured]);

  /* ------------- 数据加载 ------------- */
  const loadStatus = useCallback(async ({ keepPassword = false } = {}) => {
    try {
      const status = await window.electronAPI.sync.getConfig();
      setSyncStatus(status);
      setDraft((prev) => ({
        username: status?.config?.username || '',
        password: keepPassword ? prev.password : '',
        baseUrl: status?.config?.baseUrl || DEFAULT_BASE_URL,
        rootPath: status?.config?.rootPath || DEFAULT_ROOT_PATH,
      }));
    } catch (error) {
      console.error('加载同步状态失败:', error);
      showError(error, '加载同步状态失败');
    }
  }, [showError]);

  useEffect(() => {
    loadStatus();
    const unsubs = [
      window.electronAPI.sync.onSyncStart?.(() => {
        setSyncing(true);
        loadStatus({ keepPassword: true });
      }),
      window.electronAPI.sync.onSyncComplete?.(() => {
        setSyncing(false);
        loadStatus({ keepPassword: true });
      }),
      window.electronAPI.sync.onSyncError?.(() => {
        setSyncing(false);
        loadStatus({ keepPassword: true });
      }),
    ].filter(Boolean);
    return () => unsubs.forEach((u) => u());
  }, [loadStatus]);

  /* ------------- 校验 ------------- */
  const hasSavedPassword = !!syncStatus?.config?.hasSavedPassword;
  const canReuseSavedPassword = hasSavedPassword &&
    draft.username.trim() === (syncStatus?.config?.username || '').trim();
  const advancedMessage = stage === 'MANAGE' && showAdvanced
    ? (
      message?.scope === 'advanced'
        ? message
        : testResult
          ? { ...testResult, scope: 'advanced' }
          : null
    )
    : null;

  const ensureFormValid = ({ allowSavedPassword = false } = {}) => {
    if (!draft.username.trim()) {
      setMessage({ type: 'error', text: '请填写坚果云账号' });
      return false;
    }
    if (!draft.password && !(allowSavedPassword && canReuseSavedPassword)) {
      setMessage({ type: 'error', text: '请填写完整的应用密码' });
      return false;
    }
    return true;
  };

  /* ------------- 操作 ------------- */
  const handleTest = async () => {
    if (!draft.username.trim() || (!draft.password && !canReuseSavedPassword)) {
      const nextMessage = { type: 'error', text: '请先填写账号和完整的应用密码', scope: 'advanced' };
      setTestResult(nextMessage);
      if (stage === 'MANAGE') setMessage(nextMessage);
      return false;
    }
    setTesting(true);
    setTestResult(null);
    if (stage === 'MANAGE') setMessage(null);
    try {
      await window.electronAPI.sync.testConnection('Flota-v3', buildConfigPayload(draft, canReuseSavedPassword));
      const nextMessage = { type: 'success', text: '连接成功', scope: 'advanced' };
      setTestResult(nextMessage);
      if (stage === 'MANAGE') setMessage(nextMessage);
      return true;
    } catch (error) {
      const nextMessage = { type: 'error', text: `连接失败：${error.message}`, scope: 'advanced' };
      setTestResult(nextMessage);
      if (stage === 'MANAGE') setMessage(nextMessage);
      return false;
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!ensureFormValid({ allowSavedPassword: true })) return;
    setLoading(true);
    setMessage(null);
    setTestResult(null);
    try {
      await window.electronAPI.sync.saveConfig(buildConfigPayload(draft, canReuseSavedPassword));
      setMessage({ type: 'success', text: '账户已保存', scope: 'advanced' });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `保存失败：${error.message}`, scope: 'advanced' });
    } finally {
      setLoading(false);
    }
  };

  const handleEnable = async () => {
    if (!ensureFormValid({ allowSavedPassword: true })) return;
    setSaving(true);
    setLoading(true);
    setMessage(null);
    try {
      await window.electronAPI.sync.switchService('Flota-v3', buildConfigPayload(draft, canReuseSavedPassword));
      setMessage({ type: 'success', text: '坚果云同步已恢复' });
      setViewMode('auto');
      setTestResult(null);
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `恢复失败：${error.message}` });
      // 恢复过程中失败（多半是密码错），把测试结果重置为错误，让 wizard 回到验证步骤
      setTestResult({ type: 'error', text: `连接被拒绝：${error.message}` });
    } finally {
      setSaving(false);
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await window.electronAPI.sync.disable();
      setMessage({ type: 'success', text: '同步已停用，账户和应用密码仍会保留' });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `停用失败：${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setShowDisconnectDialog(false);
    setLoading(true);
    setMessage(null);
    try {
      if (syncStatus?.enabled) {
        await window.electronAPI.sync.disable();
      }
      await window.electronAPI.sync.disconnect();
      setMessage({ type: 'success', text: '账户已断开' });
      setSyncStatus(null);
      setDraft(createEmptyDraft());
      setViewMode('auto');
    } catch (error) {
      setMessage({ type: 'error', text: `断开失败：${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.sync.manualSync();
      setMessage({
        type: 'success',
        text: `同步完成：上传 ${result.uploaded || 0}，下载 ${result.downloaded || 0}，跳过 ${result.skipped || 0}`,
      });
      await loadStatus({ keepPassword: true });
    } catch (error) {
      setMessage({ type: 'error', text: `同步失败：${error.message}` });
    } finally {
      setSyncing(false);
    }
  };

  const confirmForceFullSync = async () => {
    setForceFullSyncDialog(false);
    setSyncing(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.sync.forceFullSync();
      setMessage({
        type: 'success',
        text: `同步索引已重建：上传 ${result.uploaded || 0}`,
      });
      await loadStatus({ keepPassword: true });
    } catch (error) {
      setMessage({ type: 'error', text: `重建同步索引失败：${error.message}` });
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleAutoSync = async (enabled) => {
    try {
      await window.electronAPI.sync.toggleAutoSync(enabled);
      setMessage({ type: 'success', text: `自动同步已${enabled ? '启用' : '关闭'}` });
      await loadStatus({ keepPassword: true });
    } catch (error) {
      setMessage({ type: 'error', text: `切换失败：${error.message}` });
    }
  };

  const handleSetInterval = async (minutes) => {
    try {
      await window.electronAPI.sync.setAutoSyncInterval(minutes);
      setMessage({ type: 'success', text: `同步频率已更新为每 ${minutes} 分钟` });
      await loadStatus({ keepPassword: true });
    } catch (error) {
      setMessage({ type: 'error', text: `设置失败：${error.message}` });
    }
  };

  const handleCleanup = async () => {
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
      showError(error, '清理图片失败');
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
        const sizeMB = (result.data.totalSize / 1024 / 1024).toFixed(2);
        setMessage({
          type: 'success',
          text: `已清理 ${result.data.deletedCount} 个文件，释放 ${sizeMB} MB`,
        });
      } else {
        setMessage({ type: 'error', text: result.error || '清理失败' });
      }
    } catch (error) {
      showError(error, '清理图片失败');
    } finally {
      setCleaningImages(false);
    }
  };

  const confirmClearAll = async () => {
    setClearAllDialog(false);
    setLoading(true);
    try {
      await window.electronAPI.sync.clearAll();
      setMessage({ type: 'success', text: '所有配置和缓存已清除，请重新配置' });
      setSyncStatus(null);
      setDraft(createEmptyDraft());
      setTestResult(null);
      setViewMode('auto');
      // 主动刷新一次，确保 stage 落回 EMPTY
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `清除失败：${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  /* ------------- 渲染 ------------- */
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6">坚果云同步</Typography>
          <Typography variant="caption" color="text.secondary">
            通过 WebDAV 协议在多设备间安全同步你的数据
          </Typography>
        </Box>
        <Tooltip title="查看坚果云帮助">
          <IconButton
            size="small"
            component="a"
            href="https://help.jianguoyun.com/?p=2064"
            target="_blank"
            rel="noopener noreferrer"
          >
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {message && (
        <Alert
          severity={message.type}
          sx={spacing.mb2}
          onClose={() => setMessage(null)}
          action={
            message.type === 'error' && /认证|密码|401|403|未授权|凭据|连接失败/.test(message.text || '') ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => setClearAllDialog(true)}
              >
                清除残留配置
              </Button>
            ) : null
          }
        >
          {message.text}
        </Alert>
      )}

      {stage !== 'EMPTY' && stage !== 'SETUP' && (
        <>
          <StatusHero
            syncStatus={syncStatus}
            syncing={syncing || syncStatus?.syncing}
            onSyncNow={handleSyncNow}
          />
          <ErrorGuide syncStatus={syncStatus} onRetry={handleSyncNow} />
        </>
      )}

      {stage === 'EMPTY' && (
        <EmptyState onStart={() => { setViewMode('setup'); setTestResult(null); }} />
      )}

      {stage === 'SETUP' && (
        <>
          {accountConfigured && (
            <Alert
              severity="info"
              sx={spacing.mb2}
              action={
                <Button color="inherit" size="small" onClick={() => setClearAllDialog(true)}>
                  清除残留配置
                </Button>
              }
            >
              检测到本地仍保留上次的同步配置（账号：{syncStatus?.config?.username}）。
              如果要彻底重新配置，请先清除残留。
            </Alert>
          )}
          <SetupWizard
            draft={draft}
            setDraft={setDraft}
            testing={testing}
            saving={saving}
            testResult={testResult}
            onTest={handleTest}
            onFinish={handleEnable}
            onCancel={() => { setViewMode('auto'); setTestResult(null); }}
          />
        </>
      )}

      {stage === 'MANAGE' && (
        <ManageView
          syncStatus={syncStatus}
          draft={draft}
          setDraft={setDraft}
          loading={loading}
          syncing={syncing || syncStatus?.syncing}
          cleaningImages={cleaningImages}
          testing={testing}
          retentionDays={retentionDays}
          setRetentionDays={setRetentionDays}
          advancedMessage={advancedMessage}
          showAdvanced={showAdvanced}
          setShowAdvanced={setShowAdvanced}
          showDanger={showDanger}
          setShowDanger={setShowDanger}
          handlers={{
            onEnable: handleEnable,
            onDisable: handleDisable,
            onDisconnect: () => setShowDisconnectDialog(true),
            onSyncNow: handleSyncNow,
            onForceFull: () => setForceFullSyncDialog(true),
            onToggleAutoSync: handleToggleAutoSync,
            onSetInterval: handleSetInterval,
            onCleanup: handleCleanup,
            onTest: handleTest,
            onSave: handleSave,
            onClearAll: () => setClearAllDialog(true),
          }}
        />
      )}

      {/* ------------ 弹窗 ------------ */}
      <Dialog open={showCleanupDialog} onClose={() => setShowCleanupDialog(false)}>
        <DialogTitle>清理未引用图片</DialogTitle>
        <DialogContent>
          <Typography>
            发现 {cleanupStats.orphanedCount} 个未引用图片，共 {cleanupStats.totalSizeMB.toFixed(2)} MB
            {retentionDays > 0 && `，超过 ${retentionDays} 天未被使用`}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            此操作不可恢复，确定继续吗？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCleanupDialog(false)}>取消</Button>
          <Button onClick={handleConfirmCleanup} variant="contained" color="error">
            确认删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={forceFullSyncDialog} onClose={() => setForceFullSyncDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>确认重建同步索引</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将备份并重建云端 manifest，用于修复同步索引损坏。它不会表达“本机覆盖云端”或“云端覆盖本机”，建议仅在同步索引明显异常时使用。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForceFullSyncDialog(false)}>取消</Button>
          <Button onClick={confirmForceFullSync} variant="contained" color="warning">
            确认重建
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={clearAllDialog} onClose={() => setClearAllDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>确认清除全部配置</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将清除本地保存的账户、密码和同步缓存，下次需要重新配置。是否继续？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearAllDialog(false)}>取消</Button>
          <Button onClick={confirmClearAll} variant="contained" color="error">
            确认清除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showDisconnectDialog} onClose={() => setShowDisconnectDialog(false)}>
        <DialogTitle>断开坚果云账户</DialogTitle>
        <DialogContent>
          <Typography>断开后将停止同步并清除已保存的应用密码。</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            本地数据不会受到影响，下次仍可重新配置。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDisconnectDialog(false)}>取消</Button>
          <Button onClick={handleConfirmDisconnect} variant="contained" color="error">
            确认断开
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NutcloudSyncSettings;
