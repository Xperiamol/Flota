import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Snackbar,
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField
} from '@mui/material';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { confirmAction, promptInput, subscribeNotify } from '../../utils/notify';

const ErrorContext = createContext(null);

export function useError() {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within ErrorProvider');
  }
  return context;
}

export function ErrorProvider({ children }) {
  const {
    snackbar,
    showError,
    showWarning,
    showSuccess,
    showInfo,
    closeSnackbar,
    handleError
  } = useErrorHandler();

  // 确认框队列：同时来多个确认请求时依次弹出，不互相覆盖
  const [confirmQueue, setConfirmQueue] = useState([]);
  const current = confirmQueue[0] || null;
  const isPrompt = current?.type === 'prompt';
  const [inputValue, setInputValue] = useState('');
  useEffect(() => {
    if (current?.type === 'prompt') setInputValue(current.defaultValue || '');
  }, [current]);
  const toastRef = useRef({ showError, showWarning, showSuccess, showInfo });
  toastRef.current = { showError, showWarning, showSuccess, showInfo };

  // 接住组件外（utils/notify）发出的提示与确认请求
  useEffect(() => subscribeNotify((payload) => {
    if (payload.type === 'confirm' || payload.type === 'prompt') {
      setConfirmQueue((queue) => [...queue, payload]);
      return;
    }
    const toast = toastRef.current;
    if (payload.severity === 'error') toast.showError(null, payload.message);
    else if (payload.severity === 'warning') toast.showWarning(payload.message);
    else if (payload.severity === 'success') toast.showSuccess(payload.message);
    else toast.showInfo(payload.message);
  }), []);

  // 确认框返回 true/false；输入框确认时返回文本、取消时返回 null
  const settleConfirm = useCallback((accepted) => {
    if (!current) return;
    const result = current.type === 'prompt'
      ? (accepted ? inputValue.trim() : null)
      : accepted;
    current.resolve?.(result);
    setConfirmQueue((queue) => (queue[0] === current ? queue.slice(1) : queue));
  }, [current, inputValue]);

  return (
    <ErrorContext.Provider
      value={{
        showError,
        showWarning,
        showSuccess,
        showInfo,
        handleError,
        confirm: confirmAction,
        prompt: promptInput
      }}
    >
      {children}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={closeSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={closeSnackbar}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
      <Dialog
        open={Boolean(current)}
        onClose={() => settleConfirm(false)}
        maxWidth="xs"
        fullWidth
      >
        {current && (
          <>
            <DialogTitle sx={{ fontSize: 16, fontWeight: 700, pb: 1 }}>{current.title}</DialogTitle>
            {(current.message || isPrompt) && (
              <DialogContent sx={{ pb: 1 }}>
                {current.message && (
                  <DialogContentText sx={{ fontSize: 14, whiteSpace: 'pre-line', mb: isPrompt ? 1.5 : 0 }}>
                    {current.message}
                  </DialogContentText>
                )}
                {isPrompt && (
                  <TextField
                    autoFocus
                    fullWidth
                    size="small"
                    label={current.label || undefined}
                    placeholder={current.placeholder}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing && inputValue.trim()) {
                        event.preventDefault();
                        settleConfirm(true);
                      }
                    }}
                    sx={{ mt: current.message ? 0 : 0.5 }}
                  />
                )}
              </DialogContent>
            )}
            <DialogActions sx={{ px: 3, pb: 2 }}>
              {/* 危险操作默认聚焦"取消"，避免误按回车直接删除 */}
              <Button onClick={() => settleConfirm(false)} color="inherit" sx={{ color: 'text.secondary' }} autoFocus={Boolean(current.danger) && !isPrompt}>
                {current.cancelText}
              </Button>
              <Button
                onClick={() => settleConfirm(true)}
                variant="contained"
                disableElevation
                color={current.danger ? 'error' : 'primary'}
                autoFocus={!isPrompt && !current.danger}
                disabled={isPrompt && !inputValue.trim()}
              >
                {current.confirmText}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </ErrorContext.Provider>
  );
}
