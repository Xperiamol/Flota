import { useState, useEffect } from 'react';
import { Box, ButtonBase, Typography, IconButton, Tooltip, alpha } from '@mui/material';
import { Clear as ClearIcon, Refresh as ResetIcon } from './AppIcons';
import { validateShortcut, formatShortcutDisplay } from '../../utils/shortcutUtils';

const ShortcutInput = ({ value = '', defaultValue = '', onChange, onValidationChange, disabled = false, label = '快捷键', placeholder = '设置快捷键' }) => {
  const [recording, setRecording] = useState(false);
  const [currentKeys, setCurrentKeys] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    // 空值表示未设置，清除快捷键不属于格式错误。
    const result = value ? validateShortcut(value) : { valid: true };
    setError(result.valid ? '' : result.error);
    onValidationChange?.(result.valid);
  }, [value, onValidationChange]);

  const stopRecording = () => { setRecording(false); setCurrentKeys([]); };
  const handleKeyDown = event => {
    if (!recording || disabled) return;
    if (event.key === 'Escape' || (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      stopRecording();
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const modifiers = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    const key = event.key === ' ' ? 'Space' : /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : event.key;
    const mainKey = ['Control', 'Meta', 'Alt', 'Shift'].includes(key) ? '' : key;
    const keys = [...modifiers, ...(mainKey ? [mainKey] : [])];
    setCurrentKeys(keys);
    if (!mainKey || (!modifiers.length && mainKey !== 'Enter')) return;
    const next = keys.join('+');
    const result = validateShortcut(next);
    if (!result.valid) { setError(result.error); return; }
    onChange?.(next);
    stopRecording();
    event.currentTarget.blur();
  };
  const keys = recording ? currentKeys : formatShortcutDisplay(value).split('+').map(key => key.trim()).filter(Boolean);

  return <Box sx={{ minWidth: 0 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
      <Tooltip title={disabled ? '由编辑器内置' : recording ? 'Esc 取消' : '点击后按下新的快捷键'}>
        <Box component="span" sx={{ minWidth: 0 }}>
          <ButtonBase
            aria-label={`${label}：${value ? formatShortcutDisplay(value) : '未设置'}`}
            aria-pressed={recording}
            disabled={disabled}
            onClick={() => { setRecording(true); setCurrentKeys([]); setError(''); }}
            onBlur={stopRecording}
            onKeyDown={handleKeyDown}
            sx={theme => ({
              minHeight: 36, px: 1, py: 0.5, borderRadius: '10px', display: 'flex', gap: 0.5, flexWrap: 'wrap',
              border: '1px solid', borderColor: recording ? 'primary.main' : 'transparent',
              bgcolor: recording ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
              '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.04) },
              '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
              '&.Mui-disabled': { opacity: 0.65 },
            })}
          >
            {keys.length ? keys.map((key, index) => <Box component="kbd" key={index} sx={theme => ({
              minWidth: 27, height: 28, px: 0.75, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '6px', bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.09 : 0.055),
              border: `1px solid ${alpha(theme.palette.text.primary, 0.07)}`,
              boxShadow: `0 1px 0 ${alpha(theme.palette.text.primary, 0.12)}`,
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'text.primary',
            })}>{key}</Box>) : <Typography sx={{ fontSize: 12, color: recording ? 'primary.main' : 'text.disabled', px: 0.5 }}>{recording ? '请按下组合键…' : placeholder}</Typography>}
          </ButtonBase>
        </Box>
      </Tooltip>
      {!disabled && <Box sx={{ display: 'flex', width: 60, flexShrink: 0 }}>
        <Tooltip title="清除快捷键"><span><IconButton aria-label={`清除${label}`} size="small" disabled={!value} onClick={() => { stopRecording(); onChange?.(''); }} sx={{ width: 28, height: 28 }}><ClearIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
        <Tooltip title="恢复默认快捷键"><span><IconButton aria-label={`恢复${label}默认值`} size="small" disabled={!defaultValue || value === defaultValue} onClick={() => { stopRecording(); onChange?.(defaultValue); }} sx={{ width: 28, height: 28 }}><ResetIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
      </Box>}
    </Box>
    {error && <Typography role="alert" variant="caption" color="error" sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}>{error}</Typography>}
  </Box>;
};

export default ShortcutInput;
