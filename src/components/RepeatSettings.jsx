import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Typography,
  Popover,
  Paper,
  Grid,
  IconButton,
  TextField,
  useTheme,
  Fade
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Repeat as RepeatIcon,
  CalendarToday as CalendarIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';

const RepeatSettings = ({ value = {}, onChange }) => {
  const [repeatType, setRepeatType] = useState(value.repeat_type || 'none');
  const [repeatInterval, setRepeatInterval] = useState(value.repeat_interval || 1);
  const [repeatDays, setRepeatDays] = useState(value.repeat_days || '');
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setRepeatType(value.repeat_type || 'none');
    setRepeatInterval(value.repeat_interval || 1);
    setRepeatDays(value.repeat_days || '');
  }, [value]);

  const handleRepeatTypeChange = (type) => {
    setRepeatType(type);
    const newValue = {
      repeat_type: type,
      repeat_interval: type === 'none' ? null : repeatInterval,
      repeat_days: type === 'weekly' ? repeatDays : ''
    };
    onChange(newValue);
  };

  const handleIntervalChange = (interval) => {
    setRepeatInterval(interval);
    const newValue = {
      repeat_type: repeatType,
      repeat_interval: interval,
      repeat_days: repeatType === 'weekly' ? repeatDays : ''
    };
    onChange(newValue);
  };

  const handleDaysChange = (days) => {
    setRepeatDays(days);
    const newValue = {
      repeat_type: repeatType,
      repeat_interval: repeatInterval,
      repeat_days: days
    };
    onChange(newValue);
  };

  const toggleDay = (dayNumber) => {
    const currentDays = repeatDays ? repeatDays.split(',').map(d => parseInt(d)) : [];
    let newDays;
    
    if (currentDays.includes(dayNumber)) {
      newDays = currentDays.filter(d => d !== dayNumber);
    } else {
      newDays = [...currentDays, dayNumber].sort((a, b) => a - b);
    }
    
    handleDaysChange(newDays.join(','));
  };

  const getRepeatDisplayText = () => {
    if (repeatType === 'none') return '不重复';
    
    const intervalText = repeatInterval > 1 ? `每${repeatInterval}` : '每';
    
    switch (repeatType) {
      case 'daily':
        return `${intervalText}天`;
      case 'weekly':
        if (repeatDays) {
          const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
          const days = repeatDays.split(',').map(d => parseInt(d));
          const dayTexts = days.map(d => dayNames[d]).join('、');
          return `${intervalText}周的${dayTexts}`;
        }
        return `${intervalText}周`;
      case 'monthly':
        return `${intervalText}月`;
      case 'yearly':
        return `${intervalText}年`;
      default:
        return '自定义';
    }
  };

  const dayNames = [
    { number: 1, name: '周一', short: '一' },
    { number: 2, name: '周二', short: '二' },
    { number: 3, name: '周三', short: '三' },
    { number: 4, name: '周四', short: '四' },
    { number: 5, name: '周五', short: '五' },
    { number: 6, name: '周六', short: '六' },
    { number: 7, name: '周日', short: '日' }
  ];

  const selectedDays = repeatDays ? repeatDays.split(',').map(d => parseInt(d)) : [];

  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState(null);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
    setIsExpanded(true);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setIsExpanded(false);
  };

  return (
    <Box sx={{ flex: 1, mb: 3 }}>
      <Typography variant="body2" sx={{ mb: 1, color: theme.palette.text.secondary }}>
        重复设置
      </Typography>
      <Button
        onClick={handleClick}
        variant="outlined"
        startIcon={<RepeatIcon />}
        endIcon={<ExpandMoreIcon sx={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />}
        sx={{
          width: '100%',
          justifyContent: 'space-between',
          textTransform: 'none',
          borderRadius: 2,
          py: 1.5,
          px: 2,
          color: repeatType !== 'none' ? theme.palette.text.primary : theme.palette.text.secondary,
          borderColor: theme.palette.divider,
          '&:hover': {
            borderColor: theme.palette.primary.main,
            backgroundColor: theme.palette.action.hover,
          },
        }}
      >
        {getRepeatDisplayText()}
      </Button>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        TransitionComponent={Fade}
        PaperProps={{
          sx: {
            mt: 1,
            minWidth: 320,
            maxWidth: 400,
            borderRadius: 2,
            boxShadow: theme.shadows[8],
          }
        }}
      >
        <Paper sx={{ p: 3 }}>
          {/* 重复类型选择 */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: theme.palette.text.primary }}>
              重复类型
            </Typography>
            <Grid container spacing={1}>
              {[
                { value: 'none', label: '不重复' },
                { value: 'daily', label: '每天' },
                { value: 'weekly', label: '每周' },
                { value: 'monthly', label: '每月' },
                { value: 'yearly', label: '每年' }
              ].map(option => (
                <Grid item xs={6} key={option.value}>
                  <Button
                    variant={repeatType === option.value ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => handleRepeatTypeChange(option.value)}
                    sx={{
                      width: '100%',
                      textTransform: 'none',
                      borderRadius: 1.5,
                      py: 1,
                    }}
                  >
                    {option.label}
                  </Button>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* 重复间隔 */}
          {repeatType !== 'none' && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: theme.palette.text.primary }}>
                重复间隔
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                  每
                </Typography>
                <TextField
                  type="number"
                  size="small"
                  value={repeatInterval}
                  onChange={(e) => handleIntervalChange(parseInt(e.target.value) || 1)}
                  inputProps={{ min: 1, max: 365, inputMode: 'numeric' }}
                  sx={{ width: 96 }}
                  aria-label="重复间隔"
                />
                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                  {repeatType === 'daily' && '天'}
                  {repeatType === 'weekly' && '周'}
                  {repeatType === 'monthly' && '月'}
                  {repeatType === 'yearly' && '年'}
                </Typography>
              </Box>
            </Box>
          )}

          {/* 周重复的天数选择 */}
          {repeatType === 'weekly' && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: theme.palette.text.primary }}>
                重复日期
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {dayNames.map(day => (
                  <IconButton
                    key={day.number}
                    size="small"
                    onClick={() => toggleDay(day.number)}
                    title={day.name}
                    sx={{
                      width: 32,
                      height: 32,
                      fontSize: '12px',
                      borderRadius: '50%',
                      border: `1px solid ${selectedDays.includes(day.number) ? theme.palette.primary.main : theme.palette.divider}`,
                      backgroundColor: selectedDays.includes(day.number) ? theme.palette.primary.main : 'transparent',
                      color: selectedDays.includes(day.number) ? theme.palette.primary.contrastText : theme.palette.text.primary,
                      '&:hover': {
                        backgroundColor: selectedDays.includes(day.number) ? theme.palette.primary.dark : theme.palette.action.hover,
                      },
                    }}
                  >
                    {day.short}
                  </IconButton>
                ))}
              </Box>
              {selectedDays.length === 0 && (
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary, mt: 1 }}>
                  请选择至少一天
                </Typography>
              )}
            </Box>
          )}

          {/* 重复说明 */}
          {repeatType !== 'none' && (
            <Box sx={{ 
              p: 2, 
              borderRadius: 2, 
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarIcon sx={{ fontSize: 16, color: theme.palette.primary.main }} />
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                  任务完成后将自动创建下次重复任务
                </Typography>
              </Box>
            </Box>
          )}
        </Paper>
      </Popover>
    </Box>
  );
};

export default RepeatSettings;