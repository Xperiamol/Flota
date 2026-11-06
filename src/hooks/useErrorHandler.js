import { useState, useCallback } from 'react';

/**
 * 全局错误处理钩子
 * 提供统一的错误提示机制
 */
export function useErrorHandler() {
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'error' // 'error' | 'warning' | 'info' | 'success'
  });

  const showError = useCallback((error, customMessage = null) => {
    // 只传提示文字（如全局 notifyError）时没有错误对象，不打印无意义的 null
    if (error) console.error(error);
    
    const message = customMessage || 
                   error?.message || 
                   error?.error || 
                   (typeof error === 'string' ? error : '操作失败');
    
    setSnackbar({
      open: true,
      message,
      severity: 'error'
    });
  }, []);

  const showWarning = useCallback((message) => {
    setSnackbar({
      open: true,
      message,
      severity: 'warning'
    });
  }, []);

  const showSuccess = useCallback((message) => {
    setSnackbar({
      open: true,
      message,
      severity: 'success'
    });
  }, []);

  const showInfo = useCallback((message) => {
    setSnackbar({
      open: true,
      message,
      severity: 'info'
    });
  }, []);

  const closeSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }));
  }, []);

  const handleError = useCallback((operation) => {
    return async (...args) => {
      try {
        return await operation(...args);
      } catch (error) {
        showError(error);
        throw error;
      }
    };
  }, [showError]);

  return {
    snackbar,
    showError,
    showWarning,
    showSuccess,
    showInfo,
    closeSnackbar,
    handleError
  };
}
