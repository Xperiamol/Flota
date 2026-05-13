import { useState, useEffect, useRef } from 'react';
import {
  Box,
  TextField,
  Chip,
  Typography,
  Alert,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Clear as ClearIcon,
  Refresh as ResetIcon
} from '@mui/icons-material';
import { validateShortcut, formatShortcutDisplay } from '../utils/shortcutUtils';

const ShortcutInput = ({ 
  value = '', 
  defaultValue = '',
  onChange, 
  onValidationChange,
  disabled = false,
  label = '快捷键',
  placeholder = '点击输入框并按下快捷键组合'
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [currentKeys, setCurrentKeys] = useState([]);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const keysPressed = useRef(new Set());

  useEffect(() => {
    const validation = validateShortcut(value);
    setError(validation.valid ? '' : validation.error);
    onValidationChange?.(validation.valid);
  }, [value, onValidationChange]);

  const handleFocus = () => {
    if (disabled) return;
    setIsRecording(true);
    setCurrentKeys([]);
    keysPressed.current.clear();
  };

  const handleBlur = () => {
    setIsRecording(false);
    setCurrentKeys([]);
    keysPressed.current.clear();
  };

  const handleKeyDown = (e) => {
    if (!isRecording || disabled) return;
    
    e.preventDefault();
    e.stopPropagation();

    const key = e.key;
    // 添加按下的键到集合中
    keysPressed.current.add(key);
    
    // 构建快捷键字符串
    const modifiers = [];
    
    if (e.ctrlKey || e.metaKey) {
      modifiers.push('Ctrl');
    }
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    
    // 处理特殊键
    let mainKey = '';
    if (key === 'Tab') mainKey = 'Tab';
    else if (key === 'Enter') mainKey = 'Enter';
    else if (key === 'Escape') mainKey = 'Escape';
    else if (key === 'Backspace') mainKey = 'Backspace';
    else if (key === 'Delete') mainKey = 'Delete';
    else if (key === ' ') mainKey = 'Space';
    else if (key.startsWith('F') && /^F([1-9]|1[0-2])$/.test(key)) mainKey = key;
    else if (key.startsWith('Arrow')) mainKey = key;
    else if (key === 'Home') mainKey = 'Home';
    else if (key === 'End') mainKey = 'End';
    else if (key === 'PageUp') mainKey = 'PageUp';
    else if (key === 'PageDown') mainKey = 'PageDown';
    else if (/^[a-zA-Z0-9]$/.test(key)) mainKey = key.toUpperCase();
    
    // 更新当前按键显示
    const currentKeyArray = [...modifiers];
    if (mainKey) currentKeyArray.push(mainKey);
    setCurrentKeys(currentKeyArray);
    
    // 如果有主键，构建完整的快捷键
    if (mainKey && (modifiers.length > 0 || ['Tab', 'Enter', 'Escape'].includes(mainKey))) {
      const shortcut = currentKeyArray.join('+');
      onChange?.(shortcut);
    }
  };

  const handleKeyUp = (e) => {
    if (!isRecording || disabled) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    keysPressed.current.delete(e.key);
    
    // 如果所有键都释放了，结束录制
    if (keysPressed.current.size === 0) {
      setIsRecording(false);
      inputRef.current?.blur();
    }
  };

  const handleClear = () => {
    onChange?.('');
    setCurrentKeys([]);
    setError('');
  };

  const handleReset = () => {
    onChange?.(defaultValue);
    setCurrentKeys([]);
  };

  const displayValue = isRecording 
    ? currentKeys.join(' + ') 
    : formatShortcutDisplay(value);

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          ref={inputRef}
          label={label}
          value={displayValue}
          placeholder={placeholder}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          disabled={disabled}
          error={!!error}
          helperText={error}
          slotProps={{
            input: {
              readOnly: true,
              sx: {
                cursor: disabled ? 'not-allowed' : 'pointer',
                backgroundColor: isRecording ? 'action.selected' : 'inherit'
              }
            }
          }}
          sx={{ flex: 1 }}
        />
        
        {value && (
          <Tooltip title="清除快捷键">
            <IconButton 
              onClick={handleClear} 
              disabled={disabled}
              size="small"
            >
              <ClearIcon />
            </IconButton>
          </Tooltip>
        )}
        
        {defaultValue && value !== defaultValue && (
          <Tooltip title="重置为默认值">
            <IconButton 
              onClick={handleReset} 
              disabled={disabled}
              size="small"
            >
              <ResetIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      
      {isRecording && (
        <Box sx={{ mt: 1 }}>
          <Alert severity="info" sx={{ py: 0.5 }}>
            <Typography variant="body2">
              正在录制快捷键... 请按下您想要的按键组合
            </Typography>
          </Alert>
        </Box>
      )}
      
      {currentKeys.length > 0 && isRecording && (
        <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {currentKeys.map((key, index) => (
            <Chip 
              key={index} 
              label={key} 
              size="small" 
              color="primary" 
              variant="outlined"
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

export default ShortcutInput;
