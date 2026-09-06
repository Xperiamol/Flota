import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Typography, IconButton, Chip, Button, alpha } from '@mui/material';
import {
  Close as CloseIcon,
  FilterList as FilterIcon,
  DragIndicator as DragIcon
} from '../common/AppIcons';
import FloatingGlassSurface from '../common/FloatingGlassSurface';
import useDraggableFloatingPanel from '../../hooks/useDraggableFloatingPanel';

const PANEL_WIDTH = 320;
const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 12;
const ESTIMATED_HEIGHT = 360;

const computeAnchorPosition = (anchorRef, width = PANEL_WIDTH, estimatedHeight = ESTIMATED_HEIGHT) => {
  const node = anchorRef?.current;
  if (!node || typeof node.getBoundingClientRect !== 'function') {
    return { x: window.innerWidth - width - VIEWPORT_MARGIN, y: VIEWPORT_MARGIN };
  }
  const rect = node.getBoundingClientRect();
  let x = rect.right - width;
  let y = rect.bottom + PANEL_GAP;
  x = Math.min(Math.max(VIEWPORT_MARGIN, x), window.innerWidth - width - VIEWPORT_MARGIN);
  if (y + estimatedHeight > window.innerHeight - VIEWPORT_MARGIN) {
    y = Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - PANEL_GAP);
  }
  return { x, y };
};

const FilterPopover = ({
  open,
  anchorRef,
  onClose,
  title = '筛选',
  totalSelected = 0,
  onClearAll,
  width = PANEL_WIDTH,
  maxHeight = 'min(440px, calc(100vh - 96px))',
  portalContainer,
  persistKey = 'flota.filterPopover.position',
  children
}) => {
  const panelRef = useRef(null);
  const [position, setPosition] = useState(null);

  const { dragging, handleDragStart, restorePosition } = useDraggableFloatingPanel({
    panelRef,
    position,
    setPosition,
    estimatedWidth: width,
    estimatedHeight: ESTIMATED_HEIGHT,
    persistKey
  });

  // 打开时初始化位置：优先取持久化的位置，否则按 anchor 计算
  useLayoutEffect(() => {
    if (!open) return;
    const fallback = computeAnchorPosition(anchorRef, width);
    setPosition((prev) => prev || restorePosition(fallback));
  }, [open, anchorRef, width, restorePosition]);

  // anchor 移动 / 视口变化时仅在用户尚未手动拖过的情况下才跟随 anchor
  // 一旦用户拖动过，由 useDraggableFloatingPanel 的 resize 监听负责夹回视口内
  useEffect(() => {
    if (!open) return;
    const handleScroll = () => {
      // 滚动只在 anchor 视口内的常规位置场景使用，不强行覆盖用户的拖拽位置
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <FloatingGlassSurface
      ref={panelRef}
      open={open}
      layer="selectionPanel"
      ariaLabel={title}
      position={position || computeAnchorPosition(anchorRef, width)}
      width={width}
      maxHeight={maxHeight}
      density="compact"
      portalContainer={portalContainer}
      sx={{ display: 'flex', flexDirection: 'column' }}
    >
      <Box
        onMouseDown={handleDragStart}
        sx={(theme) => ({
          px: 1.25,
          py: 0.75,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          boxShadow: `inset 0 -1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.32)}`,
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.08 : 0.1)
        })}
      >
        <DragIcon sx={{ fontSize: 15, color: 'text.disabled', opacity: 0.55 }} />
        <FilterIcon sx={{ fontSize: 15, color: 'primary.main' }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{title}</Typography>
        {totalSelected > 0 && (
          <Chip
            size="small"
            label={totalSelected}
            sx={(theme) => ({
              height: 18,
              fontSize: 10.5,
              fontWeight: 600,
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              '& .MuiChip-label': { px: 0.75 }
            })}
          />
        )}
        <Box sx={{ flex: 1 }} />
        {totalSelected > 0 && onClearAll && (
          <Button
            size="small"
            onClick={onClearAll}
            onMouseDown={(event) => event.stopPropagation()}
            aria-label="清空筛选"
            disableRipple
            sx={(theme) => ({
              minWidth: 0,
              height: 22,
              px: 0.875,
              fontSize: 11.5,
              fontWeight: 500,
              lineHeight: 1.2,
              borderRadius: 1,
              color: 'text.secondary',
              textTransform: 'none',
              '&:hover': {
                color: 'error.main',
                bgcolor: alpha(theme.palette.error.main, 0.08)
              }
            })}
          >
            清空
          </Button>
        )}
        <IconButton
          size="small"
          onClick={onClose}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label="关闭"
          sx={(theme) => ({
            width: 24,
            height: 24,
            borderRadius: 1,
            color: 'text.secondary',
            '&:hover': { color: 'text.primary', bgcolor: alpha(theme.palette.text.primary, 0.06) }
          })}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>

      <Box
        onMouseDown={(event) => event.stopPropagation()}
        sx={(theme) => ({
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 1.25,
          py: 0.75,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.03 : 0.04)
        })}
      >
        {children}
      </Box>
    </FloatingGlassSurface>
  );
};

export default FilterPopover;
