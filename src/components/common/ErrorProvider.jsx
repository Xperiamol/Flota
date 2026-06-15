import React, { createContext, useContext } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { useErrorHandler } from '../../hooks/useErrorHandler';

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

  return (
    <ErrorContext.Provider
      value={{
        showError,
        showWarning,
        showSuccess,
        showInfo,
        handleError
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
    </ErrorContext.Provider>
  );
}
