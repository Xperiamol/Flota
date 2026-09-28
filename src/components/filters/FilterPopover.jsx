import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Close as CloseIcon } from '../common/AppIcons';
import FloatingGlassSurface from '../common/FloatingGlassSurface';
import PanelIconButton from '../common/PanelIconButton';
import useDraggableFloatingPanel from '../../hooks/useDraggableFloatingPanel';

// 只记住用户拖过的位置；没拖过就一直贴在搜索框下面
const DRAG_POSITION_KEY = 'flota.filterPopover.dragPosition';
const readDragged = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(DRAG_POSITION_KEY) || 'null');
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? value : null;
  } catch { return null; }
};
const writeDragged = (value) => {
  try {
    if (value) window.localStorage.setItem(DRAG_POSITION_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(DRAG_POSITION_KEY);
  } catch { /* 存不了就只在本次生效 */ }
};

const MIN_WIDTH = 272;
const MAX_WIDTH = 340;
const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 12;
const ESTIMATED_HEIGHT = 380;

/**
 * 面板贴在搜索框正下方、和搜索框左右对齐（搜索框太窄时按最小宽度、右对齐）。
 * anchor 是搜索框里的筛选按钮，向上找到整个输入框作为对齐基准。
 */
const computeLayout = (anchorRef) => {
  const node = anchorRef?.current;
  if (!node || typeof node.getBoundingClientRect !== 'function') {
    return { x: window.innerWidth - MIN_WIDTH - VIEWPORT_MARGIN, y: VIEWPORT_MARGIN, width: MIN_WIDTH };
  }
  const base = (node.closest?.('.MuiInputBase-root') || node).getBoundingClientRect();
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, base.width)));
  let x = base.right - width;
  let y = base.bottom + PANEL_GAP;
  x = Math.min(Math.max(VIEWPORT_MARGIN, x), window.innerWidth - width - VIEWPORT_MARGIN);
  if (y + ESTIMATED_HEIGHT > window.innerHeight - VIEWPORT_MARGIN) {
    y = Math.max(VIEWPORT_MARGIN, window.innerHeight - ESTIMATED_HEIGHT - VIEWPORT_MARGIN);
  }
  return { x, y, width };
};

/**
 * 笔记 / 待办共用的筛选面板：标题 + 关闭，中间是各个分组，底部是结果数和「全部清除」。
 * 拖标题栏可以移动（位置会记住），双击标题栏回到搜索框下面；按 Esc 或再点一次筛选按钮收起。
 */
const FilterPopover = ({
  open,
  anchorRef,
  onClose,
  title = '筛选',
  totalSelected = 0,
  onClearAll,
  resultText,
  maxHeight = 'min(480px, calc(100vh - 120px))',
  portalContainer,
  children
}) => {
  const panelRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const [dragPosition, setDragPosition] = useState(() => readDragged());

  const { dragging, handleDragStart, clampPosition } = useDraggableFloatingPanel({
    panelRef,
    position: dragPosition,
    setPosition: setDragPosition,
    estimatedWidth: MAX_WIDTH,
    estimatedHeight: ESTIMATED_HEIGHT,
  });

  // 拖完才记住位置
  const wasDraggingRef = useRef(false);
  useEffect(() => {
    if (wasDraggingRef.current && !dragging) writeDragged(dragPosition);
    wasDraggingRef.current = dragging;
  }, [dragging, dragPosition]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => setLayout(computeLayout(anchorRef));
    update();
    setDragPosition((prev) => (prev ? clampPosition(prev.x, prev.y) : prev));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open, anchorRef, clampPosition]);

  const resetPosition = () => {
    setDragPosition(null);
    writeDragged(null);
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const current = layout || computeLayout(anchorRef);
  const position = dragPosition || current;
  const showFooter = Boolean(resultText) || (totalSelected > 0 && onClearAll);

  return (
    <FloatingGlassSurface
      ref={panelRef}
      open={open}
      layer="selectionPanel"
      ariaLabel={title}
      position={position}
      width={current.width}
      maxHeight={maxHeight}
      density="compact"
      portalContainer={portalContainer}
      material="frosted"
      sx={{ display: 'flex', flexDirection: 'column', borderRadius: '14px' }}
    >
      <Box
        onMouseDown={handleDragStart}
        onDoubleClick={resetPosition}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, pl: 1.75, pr: 0.75, pt: 0.875, pb: 0.25,
          cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none',
        }}
      >
        <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 650 }}>{title}</Typography>
        <PanelIconButton title="关闭" onClick={onClose}>
          <CloseIcon />
        </PanelIconButton>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 1.75,
          pt: 0.75,
          pb: showFooter ? 1.25 : 1.75,
        }}
      >
        {children}
      </Box>

      {showFooter && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, pl: 1.75, pr: 1, py: 0.75,
          borderTop: 1, borderColor: 'divider',
        }}>
          <Typography sx={{ flex: 1, fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {resultText}
          </Typography>
          {totalSelected > 0 && onClearAll && (
            <Button size="small" onClick={onClearAll} sx={{ minWidth: 0, height: 28, px: 1.25, fontSize: 12.5 }}>
              全部清除
            </Button>
          )}
        </Box>
      )}
    </FloatingGlassSurface>
  );
};

export default FilterPopover;
