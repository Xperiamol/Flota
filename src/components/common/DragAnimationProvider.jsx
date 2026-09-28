import { useState, useCallback, useMemo, useRef } from 'react';
import { DragAnimationContext } from '../../hooks/useDragAnimation';
import DragPreview from './DragPreview';
import dragManager from '../../utils/DragManager';
import logger from '../../utils/logger';

/**
 * 拖拽动画提供者组件
 * 管理全局的拖拽动画状态和视觉反馈
 */
// 预览卡宽度跟源行一致，但限制在可读范围内
const PREVIEW_MIN_WIDTH = 220;
const PREVIEW_MAX_WIDTH = 320;
// 松手后的收尾动画时长（放下缩小淡出 / 取消飞回原位），结束后卸载预览
const SETTLE_MS = 260;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const IDLE_STATE = {
  isDragging: false,
  // dragging：跟随鼠标；dropped：放到了落点，原地缩小淡出；returning：没放到落点，飞回源行
  phase: null,
  draggedItem: null,
  draggedItemType: null,
  // 预览卡左上角的初始位置（盖在源行上），之后由 rAF 直接改 transform
  origin: { x: 0, y: 0 },
  width: PREVIEW_MIN_WIDTH,
  grabOffset: { x: 0, y: 0 },
  isNearBoundary: false,
  boundaryPosition: null,
  // 当前悬停命中的落点（象限 / 日历日期格），驱动提示文案动态切换
  hoverTarget: null
};

/**
 * 拖拽动画提供者组件
 * 管理全局的拖拽动画状态和视觉反馈：从源行拿起 → 跟随鼠标 → 放下或飞回
 */
export const DragAnimationProvider = ({ children }) => {
  const [dragState, setDragState] = useState(IDLE_STATE);

  const animationFrameRef = useRef(null);
  // 预览元素：拖动中直接改它的 transform，不走 React 状态
  const previewElementRef = useRef(null);
  const grabOffsetRef = useRef({ x: 0, y: 0 });
  const latestPointRef = useRef({ x: 0, y: 0 });
  const settleTimerRef = useRef(null);
  // 被拖的源行：拖动时变淡，结束时恢复原来的内联样式
  const sourceRef = useRef(null);

  const restoreSource = () => {
    const source = sourceRef.current;
    sourceRef.current = null;
    if (!source) return;
    source.element.style.opacity = source.opacity;
    source.element.style.transition = source.transition;
  };

  // 配置拖拽管理器的动画回调
  const configureDragAnimations = useCallback((originalCallbacks = {}) => {
    return {
      ...originalCallbacks,
      onDragStart: (dragData) => {
        clearTimeout(settleTimerRef.current);
        restoreSource();

        const { startPosition, sourceRect, sourceElement } = dragData;
        const width = clamp(sourceRect?.width || PREVIEW_MIN_WIDTH, PREVIEW_MIN_WIDTH, PREVIEW_MAX_WIDTH);
        // 保持按下时鼠标在行里的相对位置，预览像是被“捏住”拿起来
        const grabOffset = sourceRect
          ? { x: clamp(startPosition.x - sourceRect.left, 16, width - 16), y: clamp(startPosition.y - sourceRect.top, 12, 36) }
          : { x: width / 2, y: 24 };
        grabOffsetRef.current = grabOffset;

        if (sourceElement?.style) {
          sourceRef.current = { element: sourceElement, opacity: sourceElement.style.opacity, transition: sourceElement.style.transition };
          sourceElement.style.transition = 'opacity 160ms ease';
          sourceElement.style.opacity = '0.35';
        }

        setDragState({
          ...IDLE_STATE,
          isDragging: true,
          phase: 'dragging',
          draggedItem: dragData.item,
          draggedItemType: dragData.itemType,
          origin: sourceRect ? { x: sourceRect.left, y: sourceRect.top } : { x: startPosition.x - grabOffset.x, y: startPosition.y - grabOffset.y },
          width,
          grabOffset
        });

        if (originalCallbacks.onDragStart) {
          originalCallbacks.onDragStart(dragData);
        }
      },
      onDragMove: (dragData) => {
        // 记下最新位置，每帧只写一次 transform（移动不触发布局）
        latestPointRef.current = dragData.currentPosition;
        if (!animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(() => {
            animationFrameRef.current = null;
            const preview = previewElementRef.current;
            const { x, y } = latestPointRef.current;
            const offset = grabOffsetRef.current;
            if (preview) preview.style.transform = `translate3d(${x - offset.x}px, ${y - offset.y}px, 0)`;
          });
        }

        if (originalCallbacks.onDragMove) {
          originalCallbacks.onDragMove(dragData);
        }
      },
      onDragEnd: (dragData) => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }

        // 落到象限 / 日历 / 窗口边缘算“放下”，否则飞回源行
        const accepted = Boolean(dragData.quadrant || dragData.calendarDay || dragData.shouldCreateWindow);
        restoreSource();
        setDragState(prev => ({ ...prev, phase: accepted ? 'dropped' : 'returning', isNearBoundary: false, hoverTarget: null }));
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = setTimeout(() => setDragState(IDLE_STATE), SETTLE_MS);

        if (originalCallbacks.onDragEnd) {
          originalCallbacks.onDragEnd(dragData);
        }
      },
      onHoverTargetChange: (hoverTarget) => {
        setDragState(prev => (prev.hoverTarget === hoverTarget ? prev : { ...prev, hoverTarget }));

        if (originalCallbacks.onHoverTargetChange) {
          originalCallbacks.onHoverTargetChange(hoverTarget);
        }
      },
      onBoundaryCheck: (boundaryData) => {
        setDragState(prev => {
          if (prev.phase !== 'dragging') return prev;
          if (prev.isNearBoundary === boundaryData.isNearBoundary && prev.boundaryPosition === boundaryData.boundaryPosition) return prev;
          return {
            ...prev,
            isNearBoundary: boundaryData.isNearBoundary,
            boundaryPosition: boundaryData.boundaryPosition
          };
        });

        if (originalCallbacks.onBoundaryCheck) {
          originalCallbacks.onBoundaryCheck(boundaryData);
        }
      }
    };
  }, []);

  // 增强的拖拽处理器创建函数
  const createAnimatedDragHandler = useCallback((itemType, createWindowCallback, customCallbacks = {}) => {
    const enhancedCallbacks = configureDragAnimations({
      onDragStart: (dragData) => {
        logger.log(`开始拖拽${itemType}:`, dragData.item);
        if (customCallbacks.onDragStart) {
          customCallbacks.onDragStart(dragData);
        }
      },
      onDragMove: (dragData) => {
        // 可以在这里添加自定义的拖拽移动逻辑
        if (customCallbacks.onDragMove) {
          customCallbacks.onDragMove(dragData);
        }
      },
      onDragEnd: (dragData) => {
        logger.log(`拖拽${itemType}结束:`, dragData);
        if (customCallbacks.onDragEnd) {
          customCallbacks.onDragEnd(dragData);
        }
      },
      onCreateWindow: async (dragData) => {
        try {
          await createWindowCallback(dragData.item, dragData.endPosition);
          if (itemType !== 'todo') logger.log(`创建${itemType}独立窗口成功`);
          if (customCallbacks.onCreateWindow) {
            customCallbacks.onCreateWindow(dragData);
          }
        } catch (error) {
          console.error(`${itemType === 'todo' ? '开始专注' : `创建${itemType}独立窗口`}失败:`, error);
          if (customCallbacks.onCreateWindowError) {
            customCallbacks.onCreateWindowError(error, dragData);
          }
        }
      }
    });

    return {
      handleDragStart: (event, item) => {
        dragManager.configure(enhancedCallbacks);
        dragManager.startDrag(event, item, itemType);
      },
      stopDrag: () => {
        dragManager.stopDrag();
      },
      getDragState: () => {
        return dragManager.getDragState();
      }
    };
  }, [configureDragAnimations]);

  // 拖拽状态只给下面的 DragPreview 用，不放进 context：否则拖动开始、悬停目标变化、
  // 靠近边界时，笔记/待办列表这些消费者都会整列表重渲染，拖起来一顿一顿的。
  const contextValue = useMemo(() => ({
    createAnimatedDragHandler,
    configureDragAnimations,
    previewElementRef
  }), [createAnimatedDragHandler, configureDragAnimations]);

  return (
    <DragAnimationContext.Provider value={contextValue}>
      {children}
      {/* 全局拖拽预览组件 */}
      <DragPreview state={dragState} previewRef={previewElementRef} />
    </DragAnimationContext.Provider>
  );
};

export default DragAnimationProvider;
