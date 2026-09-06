import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';
import { Note as NoteIcon } from './AppIcons';
import { Checklist as ChecklistIcon } from './AppIcons';
import { Launch as LaunchIcon } from './AppIcons';
import { useStore } from '../../store/useStore';
import { isPlaceholderOnlyPreview, stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'

// 优雅的浮动动画 - 更轻柔的幅度
const elegantFloat = keyframes`
  0%, 100% {
    transform: translate(-50%, -50%) translateY(0px) scale(1);
  }
  50% {
    transform: translate(-50%, -50%) translateY(-3px) scale(1.01);
  }
`;

// 呼吸光晕动画 - 用于边界提示
const glowPulse = keyframes`
  0%, 100% {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 0 var(--glow-color);
  }
  50% {
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16), 0 0 24px 4px var(--glow-color);
  }
`;

// 图标弹跳动画
const iconBounce = keyframes`
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
`;

/**
 * 拖拽预览组件
 * 显示拖拽过程中的视觉反馈和动画效果
 * 采用毛玻璃风格，与应用整体设计语言一致
 */
const DragPreview = ({ 
  isDragging, 
  draggedItem, 
  draggedItemType, 
  currentPosition, 
  isNearBoundary,
  boundaryPosition,
  previewRef
}) => {
  const { primaryColor } = useStore();
  const muiTheme = useTheme();
  const isDarkMode = muiTheme.palette.mode === 'dark';
  const [showPreview, setShowPreview] = useState(false);
  const [showBoundaryIndicator, setShowBoundaryIndicator] = useState(false);

  useEffect(() => {
    if (isDragging) {
      setShowPreview(true);
    } else {
      const timer = setTimeout(() => setShowPreview(false), 250);
      return () => clearTimeout(timer);
    }
  }, [isDragging, draggedItem]);

  useEffect(() => {
    if (isNearBoundary) {
      setShowBoundaryIndicator(true);
    } else {
      const timer = setTimeout(() => setShowBoundaryIndicator(false), 350);
      return () => clearTimeout(timer);
    }
  }, [isNearBoundary]);

  if (!showPreview || !draggedItem) {
    return null;
  }

  const getItemIcon = () => {
    const iconStyle = {
      fontSize: 20,
      color: primaryColor,
      animation: isNearBoundary ? `${iconBounce} 0.6s ease-in-out infinite` : 'none',
      transition: 'color 0.3s ease'
    };
    
    switch (draggedItemType) {
      case 'note':
        return <NoteIcon sx={iconStyle} />;
      case 'todo':
        return <ChecklistIcon sx={iconStyle} />;
      default:
        return <NoteIcon sx={iconStyle} />;
    }
  };

  const getItemTitle = () => {
    if (draggedItemType === 'note') {
      if (draggedItem.title && draggedItem.title !== '无标题' && draggedItem.title !== 'Untitled') {
        return draggedItem.title;
      }
      if (draggedItem.content) {
        if (draggedItem.note_type === 'whiteboard') return '画布笔记';
        const clean = stripMarkdownToPreviewText(draggedItem.content)
        if (isPlaceholderOnlyPreview(clean)) return '';
        if (clean) return clean.substring(0, 9) + (clean.length > 9 ? '...' : '');
      }
      return '';
    } else if (draggedItemType === 'todo') {
      if (Array.isArray(draggedItem)) {
        return `多选待办 (${draggedItem.length}项)`;
      } else {
        return draggedItem.content || draggedItem.title || '未命名待办';
      }
    }
    return '未知项目';
  };

  const getItemSubtitle = () => {
    if (draggedItemType === 'note') {
      const content = draggedItem.content || '';
      
      if (draggedItem.note_type === 'whiteboard') {
        try {
          const wData = JSON.parse(content);
          const count = wData.elements?.filter(e => !e.isDeleted)?.length || 0;
          return count > 0 ? `画布笔记 · ${count} 个元素` : '画布笔记';
        } catch { 
           return '画布笔记'; 
        }
      }

      // Simple markdown stripper logic identical to NoteList
      let clean = stripMarkdownToPreviewText(content)
      
      // If the title is just the start of the content, skip the first 9 chars for the subtitle
      const hasRealTitle = draggedItem.title && draggedItem.title !== '无标题' && draggedItem.title !== 'Untitled';
      const skipChars = hasRealTitle ? 0 : 9;
      if (skipChars > 0) {
         clean = clean.substring(skipChars).trim();
      }
      return clean ? clean.substring(0, 50) + (clean.length > 50 ? '...' : '') : '';

    } else if (draggedItemType === 'todo') {
      if (Array.isArray(draggedItem)) {
        return '拖拽选中项...';
      }
      return draggedItem.description ? draggedItem.description.substring(0, 30) : '';
    }
    return '';
  };

  const itemTitle = getItemTitle();
  const itemSubtitle = getItemSubtitle();

  return (
    <>
      {/* 拖拽预览卡片 - 毛玻璃风格 */}
      <div
        ref={previewRef}
        style={{
          '--glow-color': `${primaryColor}40`,
          position: 'fixed',
          left: currentPosition.x,
          top: currentPosition.y,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 99999,
          opacity: isDragging ? 1 : 0,
          transition: 'opacity 0.24s cubic-bezier(0.32, 0.72, 0, 1), background-color 0.24s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
          padding: draggedItemType === 'note' ? '8px 16px' : '10px 16px',
          minWidth: '240px',
          maxWidth: '320px',
          // 毛玻璃背景
          backgroundColor: isDarkMode 
            ? (isNearBoundary ? `${primaryColor}18` : 'rgba(30, 41, 59, 0.95)')
            : (isNearBoundary ? `${primaryColor}12` : 'rgba(255, 255, 255, 0.98)'),
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          // 边框
          border: isNearBoundary 
            ? `1.5px solid ${primaryColor}` 
            : `1px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'}`,
          borderRadius: '12px',
          // 阴影
          boxShadow: isNearBoundary
            ? `0 12px 40px rgba(0, 0, 0, ${isDarkMode ? '0.3' : '0.15'}), 0 0 20px ${primaryColor}30`
            : `0 8px 32px rgba(0, 0, 0, ${isDarkMode ? '0.25' : '0.1'})`,
          // 动画
          animation: isDragging 
            ? (isNearBoundary ? `${glowPulse} 1.5s ease-in-out infinite` : `${elegantFloat} 2.5s ease-in-out infinite`)
            : 'none',
          willChange: 'left, top, transform',
        }}
      >
        {/* 内容区域 */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: (draggedItemType === 'todo' && !Array.isArray(draggedItem)) ? 'flex-start' : 'center', 
          gap: 1.5 
        }}>
          {/* 图标/前缀指示器 */}
          {(draggedItemType === 'todo' && !Array.isArray(draggedItem)) ? (
            <Box sx={{ mt: 0.2, display: 'flex', alignItems: 'center' }}>
              <Box sx={{ 
                width: 18, 
                height: 18, 
                borderRadius: '50%', 
                border: `2px solid ${isDarkMode ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'}`,
                animation: isNearBoundary ? `${iconBounce} 0.6s ease-in-out infinite` : 'none'
              }} />
            </Box>
          ) : Array.isArray(draggedItem) ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '8px',
                backgroundColor: `${primaryColor}15`,
                flexShrink: 0,
                ...(isNearBoundary && { backgroundColor: `${primaryColor}25` })
              }}
            >
              {getItemIcon()}
            </Box>
          ) : null}
          
          {/* 文字内容 */}
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
               {draggedItemType === 'note' && draggedItem?.note_type === 'whiteboard' && (
                 <NoteIcon sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
               )}
               {itemTitle && (
                 <Typography 
                   variant={draggedItemType === 'note' ? "subtitle2" : "body2"} 
                   sx={{ 
                     fontWeight: draggedItemType === 'note' ? 500 : 400,
                     fontSize: draggedItemType === 'note' ? '0.875rem' : '0.875rem',
                     color: isDarkMode ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.87)',
                     overflow: 'hidden',
                     textOverflow: 'ellipsis',
                     whiteSpace: 'nowrap',
                     lineHeight: 1.3,
                     flex: 1
                   }}
                 >
                   {itemTitle}
                 </Typography>
               )}
            </Box>
            
            {(draggedItemType === 'note' || Array.isArray(draggedItem)) ? (
              <Typography 
                variant="body2" 
                sx={{
                  display: 'block',
                  fontSize: '0.85rem',
                  color: isDarkMode ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.5)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                  mt: 0.5,
                }}
              >
                {itemSubtitle}
              </Typography>
            ) : (
               <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, flexWrap: 'nowrap', overflow: 'hidden' }}>
                  {draggedItem?.priority && (
                     <Box sx={{ 
                       px: 0.8, py: 0.2, 
                       borderRadius: '4px', 
                       backgroundColor: `${primaryColor}15`, 
                       color: primaryColor, 
                       fontSize: '0.7rem',
                       whiteSpace: 'nowrap'
                     }}>
                       {draggedItem.priority === 'high' ? '高优先级' : 
                        draggedItem.priority === 'medium' ? '中优先级' : 
                        draggedItem.priority === 'low' ? '低优先级' : '优先级'}
                     </Box>
                  )}
                  {itemSubtitle && (
                     <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {itemSubtitle}
                     </Typography>
                  )}
               </Box>
            )}
          </Box>
          
          {/* 独立窗口图标 */}
          {isNearBoundary && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: '8px',
                backgroundColor: `${primaryColor}20`,
                animation: `${iconBounce} 0.8s ease-in-out infinite`,
                flexShrink: 0
              }}
            >
              <LaunchIcon sx={{ fontSize: 16, color: primaryColor }} />
            </Box>
          )}
        </Box>
        
        {/* 释放提示 */}
        <Box
          sx={{
            mt: 1.5,
            pt: 1,
            borderTop: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'}`,
            textAlign: 'center',
            transition: 'all 0.3s ease'
          }}
        >
          <Typography 
            variant="caption" 
            sx={{ 
              fontWeight: isNearBoundary ? 600 : 500,
              fontSize: '0.7rem',
              color: isNearBoundary ? primaryColor : 'text.secondary',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
              transition: 'color 0.3s ease, font-weight 0.3s ease'
            }}
          >
            {isNearBoundary ? '释放创建独立窗口' : '拖动到屏幕边缘创建独立窗口'}
          </Typography>
        </Box>
      </div>

      {/* 边界光晕指示器 */}
      {showBoundaryIndicator && boundaryPosition && (
        <div
          style={{
            position: 'fixed',
            background: `linear-gradient(${
              boundaryPosition === 'top' ? '180deg' :
              boundaryPosition === 'bottom' ? '0deg' :
              boundaryPosition === 'left' ? '90deg' : '270deg'
            }, ${primaryColor}60 0%, transparent 100%)`,
            opacity: isNearBoundary ? 1 : 0,
            zIndex: 99998,
            transition: 'opacity 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
            pointerEvents: 'none',
            ...(boundaryPosition === 'top' && { top: 0, left: 0, right: 0, height: '60px' }),
            ...(boundaryPosition === 'bottom' && { bottom: 0, left: 0, right: 0, height: '60px' }),
            ...(boundaryPosition === 'left' && { top: 0, left: 0, bottom: 0, width: '60px' }),
            ...(boundaryPosition === 'right' && { top: 0, right: 0, bottom: 0, width: '60px' }),
          }}
        />
      )}
    </>
  );
};

export default DragPreview;
