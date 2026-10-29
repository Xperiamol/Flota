import { Flag, PriorityHigh } from '../common/AppIcons';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import TodoDescription from './TodoDescription';
import { Box, TextField, ButtonBase, FormHelperText } from '@mui/material';
import TagInput from '../common/TagInput';
import RepeatSettings from './RepeatSettings';
import DateTimePicker from '../common/DateTimePicker';
import TimeZoneUtils from '../../utils/timeZoneUtils';
import zhCN from '../../locales/zh-CN';

const {
  todo: { fields }
} = zhCN;

const TodoFormFields = forwardRef(({
  value,
  onChange,
  mode = 'create',
  errors = {},
  getTagSuggestions,
  identity = 'new'
}, ref) => {
  const descriptionRef = useRef(null);
  const latestValue = useRef(value);
  latestValue.current = value;
  useImperativeHandle(ref, () => ({ getValue: async () => { const description = await descriptionRef.current?.getMarkdown(); return { ...latestValue.current, description: description ?? latestValue.current.description }; } }));
  const emitChange = (nextValue, changedFields) => {
    if (typeof onChange === 'function') {
      onChange(nextValue, { fields: changedFields });
    }
  };

  const handleFieldChange = (field, next) => {
    const nextValue = { ...value, [field]: next };

    if (field === 'due_date' && !next) {
      nextValue.due_time = '';
    }

    emitChange(nextValue, [field, field === 'due_date' ? 'due_time' : undefined].filter(Boolean));
  };

  const handleTagChange = (tags) => emitChange({ ...value, tags }, ['tags']);

  const handleRepeatSettingsChange = (repeatSettings) => {
    const nextValue = { ...value, ...repeatSettings };

    if (repeatSettings.repeat_type && repeatSettings.repeat_type !== 'none' && !nextValue.due_date) {
      nextValue.due_date = TimeZoneUtils.getTodayDateString();
    }

    emitChange(nextValue, [...Object.keys(repeatSettings), 'due_date']);
  };

  const handleDateChange = (date) => {
    handleFieldChange('due_date', date);
  };

  const handleTimeChange = (time) => {
    handleFieldChange('due_time', time);
  };

  return (
    <Box>
      <TextField
        autoFocus={mode === 'create'}
        margin="dense"
        label={fields.contentLabel}
        placeholder={fields.contentPlaceholder}
        fullWidth
        variant="outlined"
        value={value.content || ''}
        onChange={(e) => handleFieldChange('content', e.target.value)}
        sx={{ mb: 2 }}
        error={Boolean(errors.content)}
        helperText={errors.content}
      />

      <TodoDescription ref={descriptionRef} identity={identity} value={value.description || ''} onChange={text => handleFieldChange('description', text)} />
      {errors.description && <FormHelperText error>{errors.description}</FormHelperText>}

      <Box sx={{ display: 'grid', gap: 0.75, mt: 0.5, mb: 1.5 }}>
        <Box data-todo-properties="priority-tags" sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 0.75, alignItems: 'center', minHeight: 46, px: 0.625, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            {[['is_important', fields.importantLabel, Flag, 'primary'], ['is_urgent', fields.urgentLabel, PriorityHigh, 'error']].map(([field, label, Icon, tone]) => <ButtonBase key={field} aria-label={label} aria-pressed={Boolean(value[field])}
              onClick={() => handleFieldChange(field, !value[field])}
              sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1, px: 1, height: 34, width: 'fit-content', flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 1.25, fontSize: 12.5, fontWeight: value[field] ? 600 : 400, color: value[field] ? `${tone}.main` : 'text.secondary', bgcolor: theme => value[field] ? theme.palette[tone].main + '14' : 'transparent', '&:hover': { bgcolor: theme => theme.palette[tone].main + '1f' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
              <Icon sx={{ fontSize: 18 }} />{label}
            </ButtonBase>)}
          </Box>
          <TagInput compact value={value.tags || ''} onChange={handleTagChange} getSuggestions={getTagSuggestions} placeholder="添加标签"
            noteContent={`${value.content || ''}\n${value.description || ''}`.trim()} noteId={value.id || null} sx={{ minWidth: 0, borderLeft: '1px solid', borderColor: 'divider' }} />
        </Box>
        {errors.tags && <FormHelperText error>{errors.tags}</FormHelperText>}
        <Box data-todo-properties="schedule" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignItems: 'center', minHeight: 46, px: 0.625, py: 0.75, borderRadius: 2, bgcolor: 'action.hover' }}>
          <DateTimePicker dense compact dateValue={value.due_date || ''} timeValue={value.due_time || ''} onDateChange={handleDateChange} onTimeChange={handleTimeChange}
            dateLabel={fields.dateLabel} timeLabel={fields.timeLabel} disableDate={value.repeat_type && value.repeat_type !== 'none'}
            sx={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0 }} />
          <Box sx={{ minWidth: 0, borderLeft: '1px solid', borderColor: 'divider', pl: 0 }}>
            <RepeatSettings compact value={{ repeat_type: value.repeat_type, repeat_interval: value.repeat_interval, repeat_days: value.repeat_days }} onChange={handleRepeatSettingsChange} />
          </Box>
        </Box>
      </Box>

      {(errors.due_date || errors.due_time) && (
        <FormHelperText error sx={{ mt: -1, mb: 1 }}>
          {errors.due_date || errors.due_time}
        </FormHelperText>
      )}
    </Box>
  );
});

export default TodoFormFields;
