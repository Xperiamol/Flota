import React, { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Chip,
  TextField, IconButton, List, ListItem, ListItemIcon, ListItemText, Checkbox } from '@mui/material';
import { History as HistoryIcon, Close as CloseIcon, Add as AddIcon,
  CheckBoxOutlineBlank, CheckBox as CheckBoxIcon } from '@mui/icons-material';
import TodoFormFields from './TodoFormFields';
import TimeZoneUtils from '../utils/timeZoneUtils';
import { updateTodo, getTodoTagSuggestions, fetchSubtasks, createTodo, deleteTodo, toggleTodoComplete } from '../api/todoAPI';
import { parseCompletions, isRecurringTodo } from '../utils/todoDisplayUtils';
import zhCN from '../locales/zh-CN';
import { todoSchema, extractValidationErrors } from '../validators/todoValidation';

const mapTodoToForm = (todo) => {
  if (!todo) {
    return {
      content: '',
      description: '',
      tags: '',
      is_important: false,
      is_urgent: false,
      due_date: '',
      due_time: '',
      repeat_type: 'none',
      repeat_interval: 1,
      repeat_days: ''
    };
  }

  const { date: localDate, time: localTime } = TimeZoneUtils.fromUTC(todo.due_date);

  return {
    content: todo.content || '',
    description: todo.description || '',
    tags: todo.tags || '',
    is_important: Boolean(todo.is_important),
    is_urgent: Boolean(todo.is_urgent),
    due_date: localDate,
    due_time: localTime,
    repeat_type: todo.repeat_type || 'none',
    repeat_interval: todo.repeat_interval || 1,
    repeat_days: todo.repeat_days || ''
  };
};

const TodoEditDialog = ({ todo, open, onClose, onUpdated }) => {
  const [formData, setFormData] = useState(mapTodoToForm(todo));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [subtasks, setSubtasks] = useState([]);
  const [newSubtask, setNewSubtask] = useState('');

  const {
    todo: { dialog }
  } = zhCN;

  const loadSubtasks = useCallback(async () => {
    if (!todo?.sync_id) return;
    try {
      const result = await fetchSubtasks(todo.sync_id);
      setSubtasks(result || []);
    } catch (e) {
      console.error('获取子任务失败:', e);
    }
  }, [todo?.sync_id]);

  useEffect(() => {
    setFormData(mapTodoToForm(todo));
    setErrors({});
    setNewSubtask('');
    if (todo?.sync_id) loadSubtasks();
    else setSubtasks([]);
  }, [todo, loadSubtasks]);

  if (!todo) {
    return null;
  }

  const handleAddSubtask = async () => {
    if (!newSubtask.trim()) return;
    try {
      await createTodo({ content: newSubtask.trim(), parent_todo_id: todo.sync_id });
      setNewSubtask('');
      loadSubtasks();
    } catch (e) {
      console.error('创建子任务失败:', e);
    }
  };

  const handleToggleSubtask = async (subtask) => {
    try {
      await toggleTodoComplete(subtask.id);
      loadSubtasks();
    } catch (e) {
      console.error('切换子任务状态失败:', e);
    }
  };

  const handleDeleteSubtask = async (subtask) => {
    try {
      await deleteTodo(subtask.id);
      loadSubtasks();
    } catch (e) {
      console.error('删除子任务失败:', e);
    }
  };

  const buildUpdatePayload = () => {
    const { due_date, due_time, ...rest } = formData;
    return {
      ...rest,
      due_date: due_date ? TimeZoneUtils.toUTC(due_date, due_time) : null
    };
  };

  const handleSubmit = async () => {
    try {
      const validated = await todoSchema.validate(formData, { abortEarly: false });
      setErrors({});
      setSaving(true);
      const payload = buildUpdatePayload();
      const updated = await updateTodo(todo.id, payload);

      if (onUpdated) {
        onUpdated(updated || { ...todo, ...payload });
      }
      if (onClose) {
        onClose();
      }
    } catch (error) {
      if (error.name === 'ValidationError') {
        setErrors(extractValidationErrors(error));
      } else {
        console.error('更新待办事项失败:', error);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (nextValue, meta) => {
    setFormData(nextValue);

    if (meta?.fields?.length) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        meta.fields.forEach((field) => {
          if (field) {
            delete nextErrors[field];
          }
        });
        return nextErrors;
      });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{dialog.editTitle}</DialogTitle>
      <DialogContent>
        <TodoFormFields
          value={formData}
          onChange={handleFieldChange}
          mode="edit"
          errors={errors}
          getTagSuggestions={getTodoTagSuggestions}
        />
        {/* 子任务 */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, mb: 0.5, display: 'block' }}>
            子任务
          </Typography>
          {subtasks.length > 0 && (
            <List dense disablePadding>
              {subtasks.map(sub => (
                <ListItem key={sub.id} disablePadding
                  secondaryAction={
                    <IconButton edge="end" size="small" onClick={() => handleDeleteSubtask(sub)}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  }
                  sx={{ pr: 5 }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Checkbox
                      edge="start" size="small"
                      checked={Boolean(sub.is_completed)}
                      icon={<CheckBoxOutlineBlank sx={{ fontSize: 18 }} />}
                      checkedIcon={<CheckBoxIcon sx={{ fontSize: 18 }} />}
                      onChange={() => handleToggleSubtask(sub)}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={sub.content}
                    primaryTypographyProps={{
                      variant: 'body2',
                      sx: {
                        textDecoration: sub.is_completed ? 'line-through' : 'none',
                        opacity: sub.is_completed ? 0.5 : 1
                      }
                    }}
                  />
                </ListItem>
              ))}
            </List>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <TextField
              size="small" fullWidth variant="outlined"
              placeholder="添加子任务..."
              value={newSubtask}
              onChange={e => setNewSubtask(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask(); } }}
            />
            <IconButton size="small" onClick={handleAddSubtask} disabled={!newSubtask.trim()}
              sx={{ bgcolor: 'action.hover', borderRadius: 1 }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        {/* 重复待办完成记录 */}
        {isRecurringTodo(todo) && (() => {
          const completions = parseCompletions(todo.completions);
          if (completions.length === 0) return null;
          const recent = completions.slice().reverse().slice(0, 10);
          return (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <HistoryIcon sx={{ fontSize: 16, color: 'success.main', opacity: 0.7 }} />
                <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 500 }}>
                  完成记录 ({completions.length}次)
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {recent.map(d => (
                  <Chip key={d} label={`✓ ${d}`} size="small"
                    sx={{ fontSize: '0.7rem', height: 22, bgcolor: 'success.main', color: '#fff', opacity: 0.7 }} />
                ))}
                {completions.length > 10 && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', alignSelf: 'center', ml: 0.5 }}>
                    … 还有 {completions.length - 10} 条更早的记录
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })()}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{dialog.cancel}</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? dialog.saving : dialog.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TodoEditDialog;
