import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button
} from '@mui/material';
import TodoFormFields from './TodoFormFields';
import { todoSchema, extractValidationErrors } from '../../validators/todoValidation';
import { getTodoTagSuggestions } from '../../api/todoAPI';
import zhCN from '../../locales/zh-CN';

const CreateTodoModal = ({ todo, onChange, onSubmit, onCancel }) => {
  const [errors, setErrors] = useState({});
  const { todo: { dialog: todoDialog } } = zhCN;

  const handleFieldChange = (nextValue, meta) => {
    onChange(nextValue);
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

  const handleSubmit = async () => {
    try {
      await todoSchema.validate(todo, { abortEarly: false });
      setErrors({});
      onSubmit();
    } catch (error) {
      if (error.name === 'ValidationError') {
        setErrors(extractValidationErrors(error));
      } else {
        console.error('创建待办事项验证失败:', error);
      }
    }
  };

  const handleCancel = () => {
    setErrors({});
    onCancel();
  };

  return (
    <Dialog open={true} onClose={handleCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{todoDialog.createTitle}</DialogTitle>
      <DialogContent>
        <TodoFormFields
          value={todo}
          onChange={handleFieldChange}
          mode="create"
          errors={errors}
          getTagSuggestions={getTodoTagSuggestions}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>
          {todoDialog.cancel}
        </Button>
        <Button onClick={handleSubmit} variant="contained">
          {todoDialog.create}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateTodoModal;