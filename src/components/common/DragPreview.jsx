import { useState, useEffect, useLayoutEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Note as NoteIcon } from './AppIcons';
import { Checklist as ChecklistIcon } from './AppIcons';
import { Launch as LaunchIcon } from './AppIcons';
import { CenterFocusStrong as FocusIcon } from './AppIcons';
import { getFrostedSx } from './FloatingGlassSurface';
import { useStore } from '../../store/useStore';
import { isPlaceholderOnlyPreview, stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'

// 四象限文案，与待办页四象限视图（TodoView）的标题保持一致
const QUADRANT_DROP_LABELS = {
  urgent_important: '重要且紧急',
  not_urgent_important: '重要不紧急',
  urgent_not_important: '紧急不重要',
  not_urgent_not_important: '不紧急不重要',
};

// data-calendar-day 是 "YYYY-MM-DD"（本地日期），这里只做展示，不需要处理时区
const formatCalendarDayLabel = (isoDate) => {
  // match() 返回 [完整匹配, 年, 月, 日]，前面漏跳了一位导致"年"被当成"月"显示
  const [, , month, day] = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  return month && day ? `${Number(month)}月${Number(day)}日` : '';
};

const hasRealTitle = (note) => note.title && note.title !== '无标题' && note.title !== 'Untitled';

const getItemTitle = (item, type) => {
  if (type === 'note') {
    if (hasRealTitle(item)) return item.title;
    if (item.content) {
      if (item.note_type === 'whiteboard') return '画布笔记';
      const clean = stripMarkdownToPreviewText(item.content)
      if (isPlaceholderOnlyPreview(clean)) return '';
      if (clean) return clean.substring(0, 9) + (clean.length > 9 ? '...' : '');
    }
    return '';
  }
  if (type === 'todo') {
    if (Array.isArray(item)) return `多选待办 (${item.length}项)`;
    return item.content || item.title || '未命名待办';
  }
  return '未知项目';
};

const getItemSubtitle = (item, type) => {
  if (type === 'note') {
    const content = item.content || '';
    if (item.note_type === 'whiteboard') {
      try {
        const count = JSON.parse(content).elements?.filter(e => !e.isDeleted)?.length || 0;
        return count > 0 ? `画布笔记 · ${count} 个元素` : '画布笔记';
      } catch {
        return '画布笔记';
      }
    }
    let clean = stripMarkdownToPreviewText(content)
    // 没有标题时标题就是正文开头，副标题跳过这部分
    if (!hasRealTitle(item)) clean = clean.substring(9).trim();
    return clean ? clean.substring(0, 50) + (clean.length > 50 ? '...' : '') : '';
  }
  if (type === 'todo') {
    if (Array.isArray(item)) return '拖拽选中项...';
    return item.description ? item.description.substring(0, 30) : '';
  }
  return '';
};

// 提示文案跟着鼠标当前悬停的落点变化：
// 待办依次判断"边缘专注" > "悬停在象限上" > "悬停在日历日期格上" > 默认引导语
const getDropHint = (type, isNearBoundary, hoverTarget) => {
  if (type === 'todo') {
    if (isNearBoundary) return '释放并开始专注';
    if (hoverTarget?.quadrant) return `释放设为${QUADRANT_DROP_LABELS[hoverTarget.quadrant] || ''}`;
    if (hoverTarget?.calendarDay) {
      const dayLabel = formatCalendarDayLabel(hoverTarget.calendarDay)
      return dayLabel ? `释放移到 ${dayLabel}` : '释放以更改日期';
    }
    return '拖到象限调整优先级';
  }
  return isNearBoundary ? '释放创建独立窗口' : '拖动到屏幕边缘创建独立窗口';
};

const PRIORITY_LABELS = { high: '高优先级', medium: '中优先级', low: '低优先级' };
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * 拖拽预览：从源行拿起（放大、微倾、加深投影）→ 跟随鼠标 → 放到落点时缩小淡出，没放到落点时飞回源行。
 * 位置由 DragAnimationProvider 每帧直接写外层的 transform；这里只负责卡片本身的外观与状态动画。
 */
const DragPreview = ({ state, previewRef }) => {
  const {
    isDragging, phase, draggedItem, draggedItemType, origin, width, grabOffset,
    isNearBoundary, boundaryPosition, hoverTarget,
  } = state;
  const primaryColor = useStore((s) => s.primaryColor);
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const [lifted, setLifted] = useState(false);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [showBoundaryIndicator, setShowBoundaryIndicator] = useState(false);

  // 挂载时卡片盖在源行上，下一帧再“拿起”，让放大和倾斜有过渡
  useEffect(() => {
    if (phase !== 'dragging') return undefined;
    setLifted(false);
    const frame = requestAnimationFrame(() => setLifted(true));
    return () => cancelAnimationFrame(frame);
  }, [phase, draggedItem]);

  // 外层位置不写进 style prop，避免重渲染时覆盖拖动中逐帧写入的 transform
  useLayoutEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const toOrigin = `translate3d(${origin.x}px, ${origin.y}px, 0)`;
    if (phase === 'dragging') {
      node.style.transition = 'none';
      node.style.transform = toOrigin;
    } else if (phase === 'returning') {
      node.style.transition = reducedMotion ? 'none' : `transform 240ms ${EASE_OUT}`;
      node.style.transform = toOrigin;
    }
  }, [phase, draggedItem, origin, previewRef, reducedMotion]);

  useEffect(() => {
    if (isNearBoundary) {
      setShowBoundaryIndicator(true);
      return undefined;
    }
    const timer = setTimeout(() => setShowBoundaryIndicator(false), 350);
    return () => clearTimeout(timer);
  }, [isNearBoundary]);

  if (!isDragging || !draggedItem) return null;

  const overTarget = isNearBoundary || Boolean(hoverTarget?.quadrant) || Boolean(hoverTarget?.calendarDay);
  const isSingleTodo = draggedItemType === 'todo' && !Array.isArray(draggedItem);
  const itemTitle = getItemTitle(draggedItem, draggedItemType);
  const itemSubtitle = getItemSubtitle(draggedItem, draggedItemType);

  let cardTransform = 'none';
  let cardOpacity = 1;
  if (!reducedMotion) {
    if (phase === 'dropped') cardTransform = 'scale(0.88)';
    else if (phase === 'dragging' && lifted) cardTransform = overTarget ? 'scale(0.97)' : 'scale(1.03) rotate(-1.2deg)';
  }
  if (phase === 'dropped' || phase === 'returning') cardOpacity = 0;

  const liftedShadow = isDarkMode
    ? '0 18px 40px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)'
    : '0 18px 40px rgba(20,20,24,0.16), 0 2px 8px rgba(20,20,24,0.06)';

  return (
    <>
      <div
        ref={previewRef}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width,
          pointerEvents: 'none',
          zIndex: 99999,
          willChange: 'transform',
        }}
      >
        <Box
          sx={(t) => ({
            ...getFrostedSx(t),
            borderRadius: '12px',
            px: 1.75,
            py: 1.25,
            transformOrigin: `${grabOffset.x}px ${grabOffset.y}px`,
            transform: cardTransform,
            opacity: cardOpacity,
            boxShadow: lifted ? liftedShadow : getFrostedSx(t).boxShadow,
            borderColor: overTarget ? alpha(primaryColor, 0.9) : undefined,
            transition: reducedMotion
              ? 'opacity 120ms linear'
              : [
                `transform ${phase === 'dropped' ? 180 : 200}ms ${EASE_OUT}`,
                `box-shadow 200ms ${EASE_OUT}`,
                'border-color 160ms ease',
                // 飞回时先走一段再淡出，能看出回到了哪一行
                `opacity ${phase === 'returning' ? '160ms ease 90ms' : '180ms ease'}`,
              ].join(', '),
          })}
        >
          <Box sx={{ display: 'flex', alignItems: isSingleTodo ? 'flex-start' : 'center', gap: 1.25 }}>
            {isSingleTodo ? (
              <Box sx={{
                mt: '2px',
                width: 16,
                height: 16,
                flexShrink: 0,
                borderRadius: '50%',
                border: `1.5px solid ${alpha(theme.palette.text.primary, 0.3)}`,
              }} />
            ) : Array.isArray(draggedItem) ? (
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: '8px', flexShrink: 0,
                bgcolor: alpha(primaryColor, 0.12),
              }}>
                <ChecklistIcon sx={{ fontSize: 18, color: primaryColor }} />
              </Box>
            ) : null}

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {draggedItemType === 'note' && draggedItem?.note_type === 'whiteboard' && (
                  <NoteIcon sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
                )}
                {itemTitle && (
                  <Typography sx={{
                    flex: 1,
                    fontSize: '0.875rem',
                    fontWeight: draggedItemType === 'note' ? 500 : 400,
                    lineHeight: 1.3,
                    color: 'text.primary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {itemTitle}
                  </Typography>
                )}
              </Box>

              {isSingleTodo ? (
                (draggedItem.priority || itemSubtitle) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, overflow: 'hidden' }}>
                    {draggedItem.priority && (
                      <Box sx={{
                        px: 0.75, py: 0.125, borderRadius: '4px', whiteSpace: 'nowrap',
                        fontSize: '0.7rem', color: primaryColor, bgcolor: alpha(primaryColor, 0.1),
                      }}>
                        {PRIORITY_LABELS[draggedItem.priority] || '优先级'}
                      </Box>
                    )}
                    {itemSubtitle && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {itemSubtitle}
                      </Typography>
                    )}
                  </Box>
                )
              ) : itemSubtitle && (
                <Typography sx={{
                  mt: 0.375,
                  fontSize: '0.8125rem',
                  lineHeight: 1.4,
                  color: 'text.secondary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {itemSubtitle}
                </Typography>
              )}
            </Box>

            {isNearBoundary && (
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: '7px', flexShrink: 0,
                bgcolor: alpha(primaryColor, 0.14),
              }}>
                {draggedItemType === 'todo'
                  ? <FocusIcon sx={{ fontSize: 16, color: primaryColor }} />
                  : <LaunchIcon sx={{ fontSize: 16, color: primaryColor }} />}
              </Box>
            )}
          </Box>

          {/* 释放提示 */}
          <Box sx={{
            mt: 1,
            pt: 0.75,
            borderTop: `1px solid ${alpha(theme.palette.text.primary, isDarkMode ? 0.1 : 0.07)}`,
          }}>
            <Typography sx={{
              fontSize: '0.7rem',
              fontWeight: overTarget ? 600 : 500,
              color: overTarget ? primaryColor : 'text.secondary',
              transition: 'color 160ms ease',
            }}>
              {getDropHint(draggedItemType, isNearBoundary, hoverTarget)}
            </Typography>
          </Box>
        </Box>
      </div>

      {/* 边界光晕指示器 */}
      {showBoundaryIndicator && boundaryPosition && phase === 'dragging' && (
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
