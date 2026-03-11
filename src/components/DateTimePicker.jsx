import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Popover,
  Paper,
  Typography,
  Button,
  Grid,
  Divider,
  useTheme,
  Fade,
  ClickAwayListener
} from '@mui/material';
import {
  CalendarToday as CalendarIcon,
  Schedule as TimeIcon,
  Clear as ClearIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import { format, parseISO, isValid, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import TimeZoneUtils from '../utils/timeZoneUtils';

// 自定义日期选择器组件
const CustomDatePicker = ({ value, onChange, onClose, anchorEl }) => {
  const theme = useTheme();
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) {
      try {
        const date = typeof value === 'string' ? parseISO(value) : value;
        return isValid(date) ? date : new Date();
      } catch {
        return new Date();
      }
    }
    return new Date();
  });

  const [selectedDate, setSelectedDate] = useState(() => {
    if (value) {
      try {
        const date = typeof value === 'string' ? parseISO(value) : value;
        return isValid(date) ? date : null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 }); // 周日开始
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const handleDateClick = (date) => {
    setSelectedDate(date);
    onChange(format(date, 'yyyy-MM-dd'));
    onClose();
  };

  const handlePrevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(today);
    onChange(format(today, 'yyyy-MM-dd'));
    onClose();
  };

  const handleClear = () => {
    setSelectedDate(null);
    onChange('');
    onClose();
  };

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
      TransitionComponent={Fade}
      TransitionProps={{ timeout: 200 }}
    >
      <Paper
        sx={{
          p: 2,
          minWidth: 320,
          borderRadius: 1, // Match theme's borderRadius
          boxShadow: theme.shadows[8],
        }}
      >
        {/* 月份导航 */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <IconButton
            onClick={handlePrevMonth}
            size="small"
            aria-label="上个月"
            sx={{
              borderRadius: 1, // Match smaller button radius
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              }
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {format(currentMonth, 'yyyy年MM月', { locale: zhCN })}
          </Typography>
          <IconButton
            onClick={handleNextMonth}
            size="small"
            aria-label="下个月"
            sx={{
              borderRadius: 1, // Match smaller button radius
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              }
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Box>

        {/* 星期标题 */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, mb: 1 }}>
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
            <Box
              key={day}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 32,
                fontSize: '0.875rem',
                fontWeight: 500,
                color: theme.palette.text.secondary,
              }}
            >
              {day}
            </Box>
          ))}
        </Box>

        {/* 日期网格 */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
          {days.map((day) => {
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date());
            const isCurrentMonth = isSameMonth(day, currentMonth);

            return (
              <Button
                key={day.toString()}
                onClick={() => handleDateClick(day)}
                sx={{
                  minWidth: 0,
                  width: '100%',
                  height: 36,
                  borderRadius: 8, // Smaller radius for date buttons
                  fontSize: '0.875rem',
                  backgroundColor: isSelected ? theme.palette.primary.main : 'transparent',
                  color: isSelected ? theme.palette.primary.contrastText : 
                         isToday ? theme.palette.primary.main : 
                         isCurrentMonth ? theme.palette.text.primary : theme.palette.text.disabled,
                  fontWeight: isToday ? 600 : 400,
                  '&:hover': {
                    backgroundColor: isSelected ? theme.palette.primary.dark : theme.palette.action.hover,
                  },
                }}
              >
                {format(day, 'd')}
              </Button>
            );
          })}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* 操作按钮 */}
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button
            onClick={handleClear}
            size="small"
            sx={{
              borderRadius: 8, // Match smaller button radius
              textTransform: 'none',
              color: theme.palette.text.secondary,
            }}
          >
            清除
          </Button>
          <Button
            onClick={handleToday}
            size="small"
            variant="outlined"
            sx={{
              borderRadius: 8, // Match smaller button radius
              textTransform: 'none',
            }}
          >
            今天
          </Button>
        </Box>
      </Paper>
    </Popover>
  );
};

// 自定义时间选择器组件
const CustomTimePicker = ({ value, onChange, onClose, anchorEl }) => {
  const theme = useTheme();
  const [hours, setHours] = useState(() => {
    if (value) {
      const [h] = value.split(':');
      return parseInt(h, 10) || 0;
    }
    return 9; // 默认上午9点
  });
  const [minutes, setMinutes] = useState(() => {
    if (value) {
      const [, m] = value.split(':');
      return parseInt(m, 10) || 0;
    }
    return 0;
  });

  const handleConfirm = () => {
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    onChange(timeString);
    onClose();
  };

  const handleClear = () => {
    onChange('');
    onClose();
  };

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
      TransitionComponent={Fade}
      TransitionProps={{ timeout: 200 }}
    >
      <Paper
        sx={{
          p: 3,
          minWidth: 280,
          borderRadius: 1, // Match theme's borderRadius
          boxShadow: theme.shadows[8],
        }}
      >
        <Typography variant="h6" sx={{ mb: 3, fontWeight: 600, textAlign: 'center' }}>
          选择时间
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, mb: 3 }}>
          {/* 小时选择 */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ mb: 1, color: theme.palette.text.secondary }}>
              时
            </Typography>
            <TextField
              type="number"
              value={hours}
              onChange={(e) => {
                const val = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0));
                setHours(val);
              }}
              inputProps={{
                min: 0,
                max: 23,
                style: { textAlign: 'center', fontSize: '1.25rem', fontWeight: 600 }
              }}
              sx={{
                width: 80,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1, // Match theme's borderRadius
                },
              }}
            />
          </Box>

          <Typography variant="h4" sx={{ color: theme.palette.text.secondary, mt: 3 }}>
            :
          </Typography>

          {/* 分钟选择 */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ mb: 1, color: theme.palette.text.secondary }}>
              分
            </Typography>
            <TextField
              type="number"
              value={minutes}
              onChange={(e) => {
                const val = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                setMinutes(val);
              }}
              inputProps={{
                min: 0,
                max: 59,
                step: 5,
                style: { textAlign: 'center', fontSize: '1.25rem', fontWeight: 600 }
              }}
              sx={{
                width: 80,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1, // Match theme's borderRadius
                },
              }}
            />
          </Box>
        </Box>

        {/* 快捷时间按钮 */}
        <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { label: '09:00', h: 9, m: 0 },
            { label: '12:00', h: 12, m: 0 },
            { label: '14:00', h: 14, m: 0 },
            { label: '18:00', h: 18, m: 0 },
          ].map(({ label, h, m }) => (
            <Button
              key={label}
              size="small"
              variant="outlined"
              onClick={() => {
                setHours(h);
                setMinutes(m);
              }}
              sx={{
                borderRadius: 8, // Match smaller button radius
                textTransform: 'none',
                minWidth: 60,
              }}
            >
              {label}
            </Button>
          ))}
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* 操作按钮 */}
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button
            onClick={handleClear}
            size="small"
            sx={{
              borderRadius: 8, // Match smaller button radius
              textTransform: 'none',
              color: theme.palette.text.secondary,
            }}
          >
            清除
          </Button>
          <Button
            onClick={handleConfirm}
            size="small"
            variant="contained"
            sx={{
              borderRadius: 8, // Match smaller button radius
              textTransform: 'none',
            }}
          >
            确定
          </Button>
        </Box>
      </Paper>
    </Popover>
  );
};

// 主要的日期时间选择器组件
const DateTimePicker = ({ 
  dateValue, 
  timeValue, 
  onDateChange, 
  onTimeChange, 
  dateLabel = '截止日期',
  timeLabel = '截止时间',
  disableDate = false,
  sx = {} 
}) => {
  const theme = useTheme();
  const [dateAnchorEl, setDateAnchorEl] = useState(null);
  const [timeAnchorEl, setTimeAnchorEl] = useState(null);
  const dateButtonRef = useRef(null);
  const timeButtonRef = useRef(null);

  const handleDateClick = () => {
    if (!disableDate) {
      setDateAnchorEl(dateButtonRef.current);
    }
  };

  const handleTimeClick = () => {
    if (dateValue) {
      setTimeAnchorEl(timeButtonRef.current);
    }
  };

  const handleDateClose = () => {
    setDateAnchorEl(null);
  };

  const handleTimeClose = () => {
    setTimeAnchorEl(null);
  };

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '选择日期';
    try {
      const date = parseISO(dateStr);
      return format(date, 'yyyy年MM月dd日', { locale: zhCN });
    } catch {
      return '选择日期';
    }
  };

  const formatDisplayTime = (timeStr) => {
    if (!timeStr) return '选择时间';
    return timeStr;
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, ...sx }}>
      {/* 日期选择按钮 */}
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" sx={{ mb: 1, color: theme.palette.text.secondary }}>
          {dateLabel}
        </Typography>
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Button
            ref={dateButtonRef}
            onClick={handleDateClick}
            variant="outlined"
            disabled={disableDate}
            startIcon={<CalendarIcon />}
            sx={{
              width: '100%',
              justifyContent: 'flex-start',
              textTransform: 'none',
              borderRadius: 12, // Match theme's borderRadius
              py: 1.5,
              px: 2,
              pr: dateValue ? 6 : 2,
              color: dateValue ? theme.palette.text.primary : theme.palette.text.secondary,
              borderColor: theme.palette.divider,
              '&:hover': {
                borderColor: !disableDate ? theme.palette.primary.main : theme.palette.divider,
                backgroundColor: !disableDate ? theme.palette.action.hover : 'transparent',
              },
              '&.Mui-disabled': {
                color: theme.palette.text.disabled,
                borderColor: theme.palette.action.disabled,
              },
            }}
          >
            {formatDisplayDate(dateValue)}
          </Button>
          {dateValue && !disableDate && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onDateChange('');
                onTimeChange('');
              }}
              aria-label="清除日期"
              sx={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                p: 0.5,
                color: theme.palette.text.secondary,
                '&:hover': {
                  color: theme.palette.text.primary,
                },
              }}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* 时间选择按钮 */}
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" sx={{ mb: 1, color: theme.palette.text.secondary }}>
          {timeLabel}
        </Typography>
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Button
            ref={timeButtonRef}
            onClick={handleTimeClick}
            variant="outlined"
            disabled={!dateValue && !disableDate}
            startIcon={<TimeIcon />}
            sx={{
              width: '100%',
              justifyContent: 'flex-start',
              textTransform: 'none',
              borderRadius: 12, // Match theme's borderRadius
              py: 1.5,
              px: 2,
              pr: timeValue ? 6 : 2,
              color: timeValue ? theme.palette.text.primary : theme.palette.text.secondary,
              borderColor: theme.palette.divider,
              '&:hover': {
                borderColor: dateValue ? theme.palette.primary.main : theme.palette.divider,
                backgroundColor: dateValue ? theme.palette.action.hover : 'transparent',
              },
              '&.Mui-disabled': {
                color: theme.palette.text.disabled,
                borderColor: theme.palette.action.disabled,
              },
            }}
          >
            {formatDisplayTime(timeValue)}
          </Button>
          {timeValue && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onTimeChange('');
              }}
              aria-label="清除时间"
              sx={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                p: 0.5,
                color: theme.palette.text.secondary,
                '&:hover': {
                  color: theme.palette.text.primary,
                },
              }}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* 日期选择器弹窗 */}
      <CustomDatePicker
        value={dateValue}
        onChange={onDateChange}
        onClose={handleDateClose}
        anchorEl={dateAnchorEl}
      />

      {/* 时间选择器弹窗 */}
      <CustomTimePicker
        value={timeValue}
        onChange={onTimeChange}
        onClose={handleTimeClose}
        anchorEl={timeAnchorEl}
      />
    </Box>
  );
};

export default DateTimePicker;