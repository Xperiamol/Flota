import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import WaveOrb from './WaveOrb';
import { Refresh as RefreshIcon } from './AppIcons';

const UsageWaveCard = ({
  title,
  subtitle,
  valueLabel,
  metaLabel,
  percent = null,
  percentLabel = null,
  segments = [],
  hint = '',
  loading = false,
  error = '',
  onRefresh,
  refreshLabel = '刷新',
  compact = false,
  accentColor,
}) => {
  const theme = useTheme();
  const circleSize = compact ? 124 : 220;
  const sectionGap = compact ? 1.25 : 3;
  const bottomSpacing = compact ? 1.25 : 3.5;
  const contentMaxWidth = compact ? 320 : 480;
  const valueVariant = compact ? 'h6' : 'h5';
  // 水波球与首页「待办完成率」共用同一个组件
  const orb = <WaveOrb percent={percent} label={percentLabel || undefined} size={circleSize} accentColor={accentColor} />;

  if (compact) {
    return (
      <Box sx={{ py: 0.25, width: '100%' }}>
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', width: '100%' }}>
          {orb}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.02em' }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.3 }}>
                {subtitle}
              </Typography>
            ) : null}
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em', mt: 0.9, mb: 0.35 }}>
              {valueLabel}
            </Typography>
            {metaLabel ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75, fontSize: '0.82rem', lineHeight: 1.35 }}>
                {metaLabel}
              </Typography>
            ) : null}

            {error ? (
              <Alert severity="warning" sx={{ mb: 0.9, textAlign: 'left' }}>
                {error}
              </Alert>
            ) : null}

            {segments.length > 0 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: hint ? 0.55 : 0 }}>
                {segments.map((segment) => (
                  <Box
                    key={`${segment.label}-${segment.value}`}
                    sx={{
                      px: 0.9,
                      py: 0.4,
                      borderRadius: 999,
                      bgcolor: theme.custom?.surface?.inset,
                      border: '1px solid',
                      borderColor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : alpha('#d1d1d5', 0.7),
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.74rem', color: 'text.secondary' }}>
                      {segment.label} {segment.value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : null}

            {hint ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                {hint}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ py: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: sectionGap }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.02em' }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, lineHeight: 1.35 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {onRefresh ? (
          <Button
            size="small"
            variant="text"
            onClick={onRefresh}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
            sx={{ flexShrink: 0, textTransform: 'none' }}
          >
            {refreshLabel}
          </Button>
        ) : null}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <Box sx={{ mb: bottomSpacing }}>{orb}</Box>

        <Box sx={{ width: '100%', maxWidth: contentMaxWidth, textAlign: 'center' }}>
          <Typography variant={valueVariant} sx={{ fontWeight: 700, letterSpacing: '-0.02em', mb: 0.75 }}>
            {valueLabel}
          </Typography>
          {metaLabel ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.45 }}>
              {metaLabel}
            </Typography>
          ) : null}

          {error ? (
            <Alert severity="warning" sx={{ mb: 1.5, textAlign: 'left' }}>
              {error}
            </Alert>
          ) : null}

          {segments.length > 0 ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 1.25,
                mb: hint ? 1.5 : 0,
              }}
            >
              {segments.map((segment) => (
                <Box
                  key={`${segment.label}-${segment.value}`}
                  sx={{
                    px: 1.5,
                    py: 1.1,
                    borderRadius: 2,
                    bgcolor: theme.custom?.surface?.inset,
                    border: '1px solid',
                    borderColor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : alpha('#d1d1d5', 0.7),
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                    {segment.label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {segment.value}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : null}

          {hint ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
              {hint}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
};

export default UsageWaveCard;
