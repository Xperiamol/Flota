import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Chip,
  InputBase,
  IconButton,
  CircularProgress,
  Tooltip,
  Typography
} from '@mui/material';
import { Clear as ClearIcon, Add as AddIcon } from './AppIcons';
import { FlotaTagIcon as TagIcon } from './FlotaIcons';
import { parseTags, formatTags, validateTags, getTagColor } from '../../utils/tagUtils';
import { usePluginExtensions } from '../../hooks/usePluginExtensions';
import logger from '../../utils/logger';
import FlotaAIIcon from './FlotaAIIcon';

/**
 * 标签输入组件
 * 现代化布局：带边框字段内 chip 自动换行 + 输入框内联生长，下方常驻可点击建议云。
 * 支持自动完成、标签建议、验证、键盘操作、插件扩展。
 */
const TagInput = ({
  value = '',
  onChange,
  placeholder = '添加标签…',
  disabled = false,
  maxTags = 10,
  showSuggestions = true,
  getSuggestions, // 自定义获取建议的函数
  noteContent = '', // 笔记内容，用于插件上下文
  noteId = null, // 笔记ID，用于插件上下文
  sx = {}
}) => {
  const [inputValue, setInputValue] = useState('');
  const [tags, setTags] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [executingExtension, setExecutingExtension] = useState(null);

  const inputRef = useRef(null);
  const suggestionTimeoutRef = useRef(null);

  const { extensions, executeExtension } = usePluginExtensions('tag-input', {
    currentTags: tags,
    noteContent,
    noteId
  });

  useEffect(() => {
    setTags(parseTags(value));
  }, [value]);

  const fetchSuggestions = async (query) => {
    if (!showSuggestions) return;
    try {
      let next = [];
      if (getSuggestions) {
        next = await getSuggestions(query);
      } else if (window.electronAPI?.tags) {
        if (!query || !query.trim()) {
          await window.electronAPI.tags.recalculateUsage();
        }
        const result = await window.electronAPI.tags.getSuggestions(query, 12);
        if (result?.success) next = result.data;
      }
      setSuggestions((next || []).filter((s) => !tags.includes(s)));
    } catch (error) {
      logger.warn('[TagInput] fetch suggestions failed', error?.message);
    }
  };

  const debouncedFetchSuggestions = (query) => {
    if (suggestionTimeoutRef.current) clearTimeout(suggestionTimeoutRef.current);
    suggestionTimeoutRef.current = setTimeout(() => fetchSuggestions(query), 250);
  };

  const addTags = (newTags) => {
    const validation = validateTags(newTags);
    const unique = [...new Set([...tags, ...validation.validTags])];
    if (unique.length > maxTags) return;
    setTags(unique);
    onChange?.(formatTags(unique));
  };

  const removeTag = (tagToRemove) => {
    const next = tags.filter((tag) => tag !== tagToRemove);
    setTags(next);
    onChange?.(formatTags(next));
  };

  const clearAllTags = () => {
    setTags([]);
    onChange?.('');
    inputRef.current?.focus();
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    if (newValue.includes(',')) {
      const parts = newValue.split(',').map((t) => t.trim()).filter(Boolean);
      if (parts.length > 0) addTags(parts);
      setInputValue('');
      return;
    }
    setInputValue(newValue);
    setSelectedSuggestionIndex(-1);
    if (newValue.trim()) debouncedFetchSuggestions(newValue.trim());
    else fetchSuggestions('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
        addTags([suggestions[selectedSuggestionIndex]]);
      } else if (inputValue.trim()) {
        addTags([inputValue.trim()]);
      }
      setInputValue('');
      setSelectedSuggestionIndex(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Escape') {
      setSelectedSuggestionIndex(-1);
      inputRef.current?.blur();
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const handleFocus = () => {
    setFocused(true);
    if (showSuggestions && suggestions.length === 0) fetchSuggestions('');
  };

  const handleExtensionClick = async (extension) => {
    if (disabled || executingExtension) return;
    try {
      setExecutingExtension(extension.commandId);
      const result = await executeExtension(extension, { currentTags: tags, noteContent, noteId });
      if (result?.data?.allTags && Array.isArray(result.data.allTags)) {
        const merged = [...new Set([...tags, ...result.data.allTags])].slice(0, maxTags);
        setTags(merged);
        onChange?.(formatTags(merged));
      }
      if (result?.data?.applied && noteId) {
        window.dispatchEvent(new CustomEvent('plugin-note-updated', { detail: { noteId, result: result.data } }));
      }
    } catch (error) {
      logger.warn('[TagInput] extension failed', error?.message);
    } finally {
      setExecutingExtension(null);
    }
  };

  const atLimit = tags.length >= maxTags;
  const visibleSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <Box sx={{ position: 'relative', ...sx }}>
      {/* 标签字段：chip 自动换行 + 内联输入 */}
      <Box
        onClick={() => inputRef.current?.focus()}
        sx={(theme) => ({
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 0.6,
          minHeight: 42,
          px: 1,
          py: 0.6,
          borderRadius: '12px',
          cursor: disabled ? 'default' : 'text',
          border: '1px solid',
          borderColor: focused
            ? theme.palette.primary.main
            : theme.palette.mode === 'dark'
              ? 'rgba(148, 163, 184, 0.22)'
              : 'rgba(148, 163, 184, 0.32)',
          bgcolor: theme.custom?.surface?.control,
          transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
          boxShadow: focused ? `0 0 0 2px ${theme.palette.primary.main}1f` : 'none',
          '&:hover': {
            bgcolor: theme.custom?.surface?.controlHover || theme.palette.action.hover
          }
        })}
      >
        <TagIcon sx={{ fontSize: 18, color: 'action.active', ml: 0.25, flexShrink: 0 }} />

        {tags.map((tag) => {
          const color = getTagColor(tag);
          return (
            <Chip
              key={tag}
              label={tag}
              size="small"
              onDelete={disabled ? undefined : () => removeTag(tag)}
              sx={{
                height: 24,
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: color,
                '& .MuiChip-deleteIcon': {
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 16,
                  '&:hover': { color: '#fff' }
                }
              }}
            />
          );
        })}

        <InputBase
          inputRef={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={() => setFocused(false)}
          disabled={disabled || atLimit}
          placeholder={tags.length === 0 ? placeholder : (atLimit ? '' : '继续添加…')}
          sx={{
            flex: 1,
            minWidth: 80,
            fontSize: '0.8125rem',
            '& input': { p: 0.25 }
          }}
        />

        {extensions.map((extension) => {
          const isExecuting = executingExtension === extension.commandId;
          return (
            <Tooltip key={extension.commandId} title={extension.description || extension.title}>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={(e) => { e.stopPropagation(); handleExtensionClick(extension); }}
                  disabled={disabled || !!executingExtension}
                  sx={{ p: 0.4 }}
                >
                  {isExecuting ? <CircularProgress size={15} /> : <FlotaAIIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
          );
        })}

        {tags.length > 0 && !disabled && (
          <Tooltip title="清空标签">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); clearAllTags(); }}
              sx={{ p: 0.4 }}
            >
              <ClearIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* 建议云：聚焦时常驻展示，点击即添加 */}
      {showSuggestions && focused && visibleSuggestions.length > 0 && !atLimit && (
        <Box sx={{ mt: 0.85 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: 'text.disabled', letterSpacing: '0.05em', mb: 0.5 }}>
            建议标签
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
            {visibleSuggestions.map((suggestion, index) => (
              <Chip
                key={suggestion}
                icon={<AddIcon sx={{ fontSize: 14 }} />}
                label={suggestion}
                size="small"
                variant="outlined"
                // 用 onMouseDown 抢在 input blur 前触发，避免点击丢失
                onMouseDown={(e) => { e.preventDefault(); addTags([suggestion]); }}
                sx={(theme) => ({
                  height: 26,
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  borderStyle: 'dashed',
                  borderColor: index === selectedSuggestionIndex
                    ? theme.palette.primary.main
                    : 'divider',
                  color: 'text.secondary',
                  bgcolor: index === selectedSuggestionIndex
                    ? `${theme.palette.primary.main}14`
                    : 'transparent',
                  '& .MuiChip-icon': { color: theme.palette.primary.main, ml: 0.5 },
                  '&:hover': { borderColor: theme.palette.primary.main, color: 'text.primary' }
                })}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default TagInput;
