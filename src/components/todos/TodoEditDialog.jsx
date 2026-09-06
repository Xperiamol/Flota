import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Chip,
  TextField, IconButton, ListItemIcon, ListItemText, Checkbox,
  Menu, MenuItem, Divider, DialogContentText, LinearProgress, CircularProgress } from '@mui/material';
import { History as HistoryIcon, Close as CloseIcon, Add as AddIcon,
  CheckBoxOutlineBlank, CheckBox as CheckBoxIcon, MoreHoriz as MoreHorizIcon,
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
  CheckCircleOutline as CompleteIcon, UndoRounded as UndoIcon,
  DeleteOutlineRounded as DeleteIcon, ChecklistRounded as ChecklistIcon } from '../common/AppIcons';
import TodoFormFields from './TodoFormFields';
import TimeZoneUtils from '../../utils/timeZoneUtils';
import { updateTodo, getTodoTagSuggestions, fetchSubtasks, createTodo, deleteTodo, toggleTodoComplete } from '../../api/todoAPI';
import {
  getTodayStr,
  isFutureRecurringTodo,
  isRecurringTodo,
  isTodoCompleted,
  parseCompletions
} from '../../utils/todoDisplayUtils';
import zhCN from '../../locales/zh-CN';
import { todoSchema, extractValidationErrors } from '../../validators/todoValidation';

const AnimatedProgressValue = ({ value, color = 'text.primary', variant = 'body2' }) => {
  const previousValueRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const from = previousValueRef.current;
    previousValueRef.current = value;

    if (from === value || typeof window === 'undefined') {
      setDisplayValue(value);
      return undefined;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplayValue(value);
      return undefined;
    }

    let frameId;
    const startedAt = performance.now();
    const duration = 360;
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(from + (value - from) * eased));
      if (progress < 1) frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  return (
    <Typography
      key={value}
      component="span"
      variant={variant}
      aria-live="polite"
      sx={{
        color,
        fontWeight: 750,
        fontVariantNumeric: 'tabular-nums',
        minWidth: '3.4ch',
        textAlign: 'right',
        '@keyframes progress-number-pop': {
          '0%': { opacity: 0.72, transform: 'translateY(2px) scale(0.94)' },
          '100%': { opacity: 1, transform: 'translateY(0) scale(1)' }
        },
        animation: 'progress-number-pop 360ms cubic-bezier(0.32,0.72,0,1)'
      }}
    >
      {displayValue}%
    </Typography>
  );
};

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
  const [actionAnchorEl, setActionAnchorEl] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [subtaskBusyId, setSubtaskBusyId] = useState(null);
  const [parentCompletedOverride, setParentCompletedOverride] = useState(null);

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
    setActionAnchorEl(null);
    setActionBusy(false);
    setDeleteConfirmOpen(false);
    setSubtaskBusyId(null);
    setParentCompletedOverride(null);
    if (todo?.sync_id) loadSubtasks();
    else setSubtasks([]);
  }, [todo, loadSubtasks]);

  const completedSubtaskCount = useMemo(
    () => subtasks.filter((subtask) => Boolean(subtask.is_completed)).length,
    [subtasks]
  );
  const subtaskProgress = subtasks.length > 0
    ? Math.round((completedSubtaskCount / subtasks.length) * 100)
    : 0;
  const storedCompletedForOperation = todo && (isRecurringTodo(todo)
    ? parseCompletions(todo.completions).includes(getTodayStr())
    : isTodoCompleted(todo));
  const completedForOperation = parentCompletedOverride ?? Boolean(storedCompletedForOperation);
  const futureCompletionUnavailable = !completedForOperation && Boolean(todo) && isFutureRecurringTodo(todo);
  const hasIncompleteSubtasks = subtasks.length > 0 && completedSubtaskCount < subtasks.length;
  const completionUnavailable = futureCompletionUnavailable
    || (!completedForOperation && hasIncompleteSubtasks);

  if (!todo) {
    return null;
  }

  const syncParentCompletion = async (nextSubtasks, { showProgress = false } = {}) => {
    if (!nextSubtasks.length || futureCompletionUnavailable) return;

    const allCompleted = nextSubtasks.every((item) => Boolean(item.is_completed));
    if (allCompleted === completedForOperation) return;

    if (allCompleted && showProgress) {
      await new Promise((resolve) => setTimeout(resolve, 360));
    }

    const updatedParent = await toggleTodoComplete(todo.id);
    setParentCompletedOverride(allCompleted);
    onUpdated?.(updatedParent || todo, { keepOpen: true });
  };

  const handleAddSubtask = async () => {
    if (!newSubtask.trim()) return;
    try {
      const created = await createTodo({ content: newSubtask.trim(), parent_todo_id: todo.sync_id });
      setNewSubtask('');
      if (created) {
        const nextSubtasks = [...subtasks, created];
        setSubtasks(nextSubtasks);
        try {
          await syncParentCompletion(nextSubtasks);
        } catch (parentError) {
          console.error('同步主任务完成状态失败:', parentError);
        }
      } else {
        await loadSubtasks();
      }
    } catch (e) {
      console.error('创建子任务失败:', e);
    }
  };

  const handleToggleSubtask = async (subtask) => {
    if (subtaskBusyId !== null) return;
    const nextCompleted = !Boolean(subtask.is_completed);
    const nextSubtasks = subtasks.map((item) => (
      item.id === subtask.id ? { ...item, is_completed: nextCompleted ? 1 : 0 } : item
    ));
    setSubtaskBusyId(subtask.id);
    setSubtasks(nextSubtasks);
    try {
      const updated = await toggleTodoComplete(subtask.id);
      if (updated) {
        setSubtasks((current) => current.map((item) => (
          item.id === subtask.id ? { ...item, ...updated } : item
        )));
      }

      try {
        await syncParentCompletion(nextSubtasks, { showProgress: nextCompleted });
      } catch (parentError) {
        console.error('同步主任务完成状态失败:', parentError);
      }
    } catch (e) {
      setSubtasks((current) => current.map((item) => (
        item.id === subtask.id ? { ...item, is_completed: subtask.is_completed } : item
      )));
      console.error('切换子任务状态失败:', e);
    } finally {
      setSubtaskBusyId(null);
    }
  };

  const handleDeleteSubtask = async (subtask) => {
    try {
      await deleteTodo(subtask.id);
      const nextSubtasks = subtasks.filter((item) => item.id !== subtask.id);
      setSubtasks(nextSubtasks);
      try {
        await syncParentCompletion(nextSubtasks, { showProgress: true });
      } catch (parentError) {
        console.error('同步主任务完成状态失败:', parentError);
      }
    } catch (e) {
      console.error('删除子任务失败:', e);
    }
  };

  const handleToggleTodoState = async () => {
    if (completionUnavailable || actionBusy) return;
    setActionAnchorEl(null);
    setActionBusy(true);
    try {
      const updated = await toggleTodoComplete(todo.id);
      onUpdated?.(updated || todo);
      onClose?.();
    } catch (error) {
      console.error(completedForOperation ? '取消完成失败:' : '完成待办失败:', error);
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await deleteTodo(todo.id);
      setDeleteConfirmOpen(false);
      onUpdated?.();
      onClose?.();
    } catch (error) {
      console.error('删除待办失败:', error);
    } finally {
      setActionBusy(false);
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
        <Box
          sx={{
            mt: 2,
            p: 1.25,
            borderRadius: '12px',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: (theme) => theme.custom?.surface?.control || theme.palette.action.hover
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: subtasks.length > 0 ? 1 : 0.75 }}>
            <ChecklistIcon sx={{ fontSize: 18, color: subtasks.length > 0 ? 'primary.main' : 'text.secondary' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              子任务
            </Typography>
            {subtasks.length > 0 && (
              <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {completedSubtaskCount}/{subtasks.length}
                </Typography>
                <AnimatedProgressValue
                  value={subtaskProgress}
                  color={subtaskProgress === 100 ? 'success.main' : 'primary.main'}
                  variant="caption"
                />
              </Box>
            )}
          </Box>
          {subtasks.length > 0 && (
            <>
              <LinearProgress
                variant="determinate"
                value={subtaskProgress}
                sx={{
                  height: 5,
                  mb: 0.75,
                  borderRadius: 999,
                  bgcolor: 'action.selected',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 999,
                    bgcolor: subtaskProgress === 100 ? 'success.main' : 'primary.main',
                    transition: 'transform 360ms cubic-bezier(0.32,0.72,0,1), background-color 180ms ease'
                  }
                }}
              />
              <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.disabled', fontSize: '0.68rem' }}>
                点击复选框，或双击子任务文字快速切换状态
              </Typography>
              <Box sx={{ maxHeight: 180, overflowY: 'auto', pr: 0.25 }}>
                {subtasks.map(sub => (
                  <Box
                    key={sub.id}
                    onDoubleClick={(event) => {
                      if (!event.target.closest('button')) handleToggleSubtask(sub);
                    }}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '30px minmax(0, 1fr) 28px',
                      alignItems: 'center',
                      columnGap: 0.75,
                      minHeight: 38,
                      px: 0.5,
                      borderRadius: '8px',
                      transition: 'background-color 160ms ease',
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                  >
                    {subtaskBusyId === sub.id ? (
                      <Box sx={{ width: 30, display: 'grid', placeItems: 'center' }}>
                        <CircularProgress size={15} thickness={5} />
                      </Box>
                    ) : (
                      <Checkbox
                        size="small"
                        checked={Boolean(sub.is_completed)}
                        icon={<CheckBoxOutlineBlank sx={{ fontSize: 18 }} />}
                        checkedIcon={<CheckBoxIcon sx={{ fontSize: 18 }} />}
                        onChange={() => handleToggleSubtask(sub)}
                        sx={{ width: 30, height: 30, p: 0 }}
                      />
                    )}
                    <Typography
                      variant="body2"
                      title={sub.content}
                      sx={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: sub.is_completed ? 'line-through' : 'none',
                        color: sub.is_completed ? 'text.secondary' : 'text.primary',
                        opacity: sub.is_completed ? 0.62 : 1,
                        transition: 'opacity 180ms ease, color 180ms ease'
                      }}
                    >
                      {sub.content}
                    </Typography>
                      <IconButton
                        size="small"
                        aria-label={`删除子任务：${sub.content}`}
                        onClick={() => handleDeleteSubtask(sub)}
                        sx={{ width: 28, height: 28, opacity: 0.45, '&:hover': { opacity: 1, color: 'error.main' } }}
                      >
                        <CloseIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                  </Box>
                ))}
              </Box>
            </>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: subtasks.length > 0 ? 0.75 : 0 }}>
            <TextField
              size="small" fullWidth variant="outlined"
              placeholder="添加子任务..."
              value={newSubtask}
              onChange={e => setNewSubtask(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask(); } }}
              sx={{ minWidth: 0 }}
            />
            <IconButton size="small" onClick={handleAddSubtask} disabled={!newSubtask.trim()}
              aria-label="添加子任务"
              sx={{ bgcolor: 'action.selected', borderRadius: '10px', width: 36, height: 36 }}>
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
            <Box sx={{
              mt: 2,
              p: 1.5,
              borderRadius: '12px',
              bgcolor: (theme) => theme.custom?.surface?.control || theme.palette.action.hover,
              border: '1px solid',
              borderColor: 'divider'
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <HistoryIcon sx={{ fontSize: 16, color: 'success.main', opacity: 0.7 }} />
                <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 500 }}>
                  完成记录 ({completions.length}次)
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {recent.map(d => (
                  <Chip key={d} label={`✓ ${d}`} size="small"
                    sx={{ fontSize: '0.7rem', height: 22, bgcolor: 'success.main', color: '#fff', opacity: 0.82 }} />
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
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.25 }}>
        <Box sx={{ flex: 1 }}>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<MoreHorizIcon />}
            endIcon={actionAnchorEl ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            onClick={(event) => setActionAnchorEl(event.currentTarget)}
            disabled={saving || actionBusy}
            aria-haspopup="menu"
            aria-expanded={Boolean(actionAnchorEl)}
            sx={{
              borderRadius: '10px',
              borderColor: 'divider',
              color: 'text.secondary',
              textTransform: 'none',
              fontWeight: 650,
              px: 1.5,
              minWidth: 108,
              '&:hover': { borderColor: 'text.secondary', bgcolor: 'action.hover' }
            }}
          >
            操作
          </Button>
          <Menu
            anchorEl={actionAnchorEl}
            open={Boolean(actionAnchorEl)}
            onClose={() => setActionAnchorEl(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            slotProps={{
              paper: {
                sx: (theme) => ({
                  minWidth: 220,
                  maxWidth: 260,
                  mb: 1,
                  p: 0.625,
                  borderRadius: '12px',
                  overflow: 'visible',
                  backdropFilter: theme.custom?.glass?.backdropFilter,
                  WebkitBackdropFilter: theme.custom?.glass?.backdropFilter,
                  backgroundColor: theme.custom?.glass?.background,
                  backgroundImage: theme.custom?.glass?.backgroundImage,
                  border: theme.custom?.glass?.border,
                  boxShadow: theme.custom?.glass?.boxShadow
                })
              }
            }}
          >
            <MenuItem
              onClick={handleToggleTodoState}
              disabled={completionUnavailable || actionBusy}
              sx={{ borderRadius: '10px', minHeight: 44, px: 1.25 }}
            >
              <ListItemIcon sx={{ color: completedForOperation ? 'text.secondary' : 'success.main' }}>
                {completedForOperation ? <UndoIcon fontSize="small" /> : <CompleteIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={completedForOperation ? '取消完成' : '完成'}
                secondary={futureCompletionUnavailable
                  ? '下一周期尚未到达'
                  : (!completedForOperation && hasIncompleteSubtasks ? '请先完成全部子任务' : undefined)}
                slotProps={{
                  primary: { sx: { fontWeight: 600 } },
                  secondary: { sx: { fontSize: '0.72rem' } }
                }}
              />
            </MenuItem>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem
              onClick={() => {
                setActionAnchorEl(null);
                setDeleteConfirmOpen(true);
              }}
              disabled={actionBusy}
              sx={{ borderRadius: '10px', minHeight: 44, px: 1.25, color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>
                <DeleteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="删除" slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
            </MenuItem>
          </Menu>
        </Box>
        <Button onClick={onClose} disabled={saving || actionBusy}>{dialog.cancel}</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving || actionBusy}>
          {saving ? dialog.saving : dialog.save}
        </Button>
      </DialogActions>

      <Dialog
        open={deleteConfirmOpen}
        onClose={() => { if (!actionBusy) setDeleteConfirmOpen(false); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>删除待办？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            “{todo.content || '此待办'}”将被移入回收站，之后仍可恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={actionBusy}>取消</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" disabled={actionBusy}>
            {actionBusy ? '删除中…' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default TodoEditDialog;
