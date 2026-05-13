import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Refresh as RefreshIcon } from '@mui/icons-material';

const clampPercent = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
};

const fallbackPercent = 38;

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
  const resolvedPercent = clampPercent(percent);
  const visualPercent = resolvedPercent ?? fallbackPercent;
  const displayPercent = percentLabel || (resolvedPercent == null ? '--' : `${Math.round(resolvedPercent)}%`);
  const waveTop = `${100 - visualPercent}%`;
  const resolvedAccentColor = accentColor || theme.palette.primary.main;
  const textOnWater = visualPercent >= 50;
  const containerBackground = theme.palette.mode === 'dark' ? '#0f172a' : '#f3f4f6';
  const borderColor = theme.palette.mode === 'dark'
    ? alpha(resolvedAccentColor, 0.18)
    : alpha('#ffffff', 0.92);
  const textColor = textOnWater ? '#ffffff' : resolvedAccentColor;
  const textShadow = textOnWater
    ? '0 2px 10px rgba(0, 0, 0, 0.2)'
    : '0 2px 10px rgba(255, 255, 255, 0.8)';
  const circleSize = compact ? 124 : 240;
  const borderWidth = compact ? 5 : 8;
  const percentFontSize = compact ? '1.85rem' : '3.5rem';
  const sectionGap = compact ? 1.25 : 3;
  const bottomSpacing = compact ? 1.25 : 3.5;
  const contentMaxWidth = compact ? 320 : 480;
  const valueVariant = compact ? 'h6' : 'h5';
  const compactCircleBoxSx = {
    width: circleSize,
    height: circleSize,
    borderRadius: '50%',
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
    bgcolor: containerBackground,
    boxShadow: 'inset 0 0 20px rgba(0,0,0,0.05), 0 10px 30px rgba(0,0,0,0.08)',
    border: `${borderWidth}px solid`,
    borderColor,
  };
  const waveLayers = (
    <>
      <Box
        sx={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          top: waveTop,
          left: 0,
          transition: 'top 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          width: '200%',
          height: '200%',
          left: '-50%',
          top: waveTop,
          borderRadius: '40%',
          background: alpha(resolvedAccentColor, 0.34),
          animation: 'usage-wave-spin-back 6s linear infinite',
          '@keyframes usage-wave-spin-back': {
            '0%': { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' },
          }
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          width: '200%',
          height: '200%',
          left: '-50%',
          top: waveTop,
          borderRadius: '42%',
          background: alpha(resolvedAccentColor, 0.56),
          animation: 'usage-wave-spin-middle 8s linear infinite',
          '@keyframes usage-wave-spin-middle': {
            '0%': { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' },
          }
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          width: '200%',
          height: '200%',
          left: '-50%',
          top: waveTop,
          borderRadius: '39%',
          background: `linear-gradient(180deg, ${alpha(resolvedAccentColor, 0.92)} 0%, ${alpha(resolvedAccentColor, 0.72)} 100%)`,
          animation: 'usage-wave-spin-front 5s linear infinite',
          '@keyframes usage-wave-spin-front': {
            '0%': { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' },
          }
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          zIndex: 10,
        }}
      >
        <Typography
          sx={{
            fontSize: percentFontSize,
            fontWeight: 700,
            lineHeight: 1,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            color: textColor,
            textShadow,
            transition: 'color 0.4s ease, text-shadow 0.4s ease',
          }}
        >
          {displayPercent}
        </Typography>
      </Box>
    </>
  );

  if (compact) {
    return (
      <Box sx={{ py: 0.25, width: '100%' }}>
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', width: '100%' }}>
          <Box sx={compactCircleBoxSx}>
            {waveLayers}
          </Box>

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
                      bgcolor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.04) : alpha('#ffffff', 0.82),
                      border: '1px solid',
                      borderColor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : alpha('#cbd5e1', 0.7),
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
    <Box sx={{ py: compact ? 0.25 : 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: sectionGap }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.02em' }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: compact ? 0.35 : 0.75, lineHeight: 1.35 }}>
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
        <Box sx={{ ...compactCircleBoxSx, mb: bottomSpacing }}>
          {waveLayers}
        </Box>

        <Box sx={{ width: '100%', maxWidth: contentMaxWidth, textAlign: 'center' }}>
          <Typography variant={valueVariant} sx={{ fontWeight: 700, letterSpacing: '-0.02em', mb: compact ? 0.35 : 0.75 }}>
            {valueLabel}
          </Typography>
          {metaLabel ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: compact ? 0.9 : 1.5, fontSize: compact ? '0.84rem' : undefined, lineHeight: 1.45 }}>
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
              sx={compact ? {
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 0.75,
                mb: hint ? 0.9 : 0,
              } : {
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
                    px: compact ? 1 : 1.5,
                    py: compact ? 0.55 : 1.1,
                    borderRadius: 2,
                    bgcolor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.04) : alpha('#ffffff', 0.8),
                    border: '1px solid',
                    borderColor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : alpha('#cbd5e1', 0.7),
                    minWidth: compact ? 'auto' : undefined,
                  }}
                >
                  {compact ? (
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.78rem', color: 'text.secondary' }}>
                      {segment.label} {segment.value}
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                        {segment.label}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {segment.value}
                      </Typography>
                    </>
                  )}
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
