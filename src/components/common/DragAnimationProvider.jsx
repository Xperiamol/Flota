import { createContext, useContext, useState, useCallback, useRef } from 'react';
import DragPreview from './DragPreview';
import dragManager from '../../utils/DragManager';
import logger from '../../utils/logger';

// 创建拖拽动画上下文
const DragAnimationContext = createContext();

/**
 * 拖拽动画提供者组件
 * 管理全局的拖拽动画状态和视觉反馈
 */
export const DragAnimationProvider = ({ children }) => {
  const [dragState, setDragState] = useState({
    isDragging: false,
    draggedItem: null,
    draggedItemType: null,
    currentPosition: { x: 0, y: 0 },
    isNearBoundary: false,
    boundaryPosition: null
  });

  // 使用 ref 来存储动画帧 ID
  const animationFrameRef = useRef(null);
  // 使用 ref 来存储预览元素，避免频繁查询 DOM
  const previewElementRef = useRef(null);
  // 使用 ref 来存储当前位置，避免频繁状态更新
  const currentPositionRef = useRef({ x: 0, y: 0 });

  // 配置拖拽管理器的动画回调
  const configureDragAnimations = useCallback((originalCallbacks = {}) => {
    return {
      ...originalCallbacks,
      onDragStart: (dragData) => {
        setDragState(prev => ({
          ...prev,
          isDragging: true,
          draggedItem: dragData.item,
          draggedItemType: dragData.itemType,
          currentPosition: dragData.startPosition
        }));

        // 调用原始回调
        if (originalCallbacks.onDragStart) {
          originalCallbacks.onDragStart(dragData);
        }
      },
      onDragMove: (dragData) => {
        // 使用 ref 直接更新位置，避免频繁的状态更新
        currentPositionRef.current = dragData.currentPosition;

        // 使用 requestAnimationFrame 来优化 DOM 更新
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        animationFrameRef.current = requestAnimationFrame(() => {
          // 直接更新 DOM 而不是 React 状态
          if (previewElementRef.current) {
            previewElementRef.current.style.left = `${dragData.currentPosition.x}px`;
            previewElementRef.current.style.top = `${dragData.currentPosition.y}px`;
          }
        });

        // 调用原始回调
        if (originalCallbacks.onDragMove) {
          originalCallbacks.onDragMove(dragData);
        }
      },
      onDragEnd: (dragData) => {
        // 清理动画帧
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }

        // 延迟重置状态，让动画完成
        setTimeout(() => {
          setDragState(prev => ({
            ...prev,
            isDragging: false,
            draggedItem: null,
            draggedItemType: null,
            isNearBoundary: false,
            boundaryPosition: null
          }));
        }, 100);

        // 调用原始回调
        if (originalCallbacks.onDragEnd) {
          originalCallbacks.onDragEnd(dragData);
        }
      },
      onBoundaryCheck: (boundaryData) => {
        // 使用 ref 来避免频繁的状态更新
        const shouldUpdate =
          dragState.isNearBoundary !== boundaryData.isNearBoundary ||
          dragState.boundaryPosition !== boundaryData.boundaryPosition;

        if (shouldUpdate) {
          setDragState(prev => ({
            ...prev,
            isNearBoundary: boundaryData.isNearBoundary,
            boundaryPosition: boundaryData.boundaryPosition,
            currentPosition: boundaryData.currentPosition
          }));
        } else {
          // 只更新位置，不触发重新渲染
          setDragState(prev => ({
            ...prev,
            currentPosition: boundaryData.currentPosition
          }));
        }

        // 调用原始回调
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
          // 传递结束位置用于窗口定位
          await createWindowCallback(dragData.item, dragData.endPosition);
          logger.log(`创建${itemType}独立窗口成功`);
          if (customCallbacks.onCreateWindow) {
            customCallbacks.onCreateWindow(dragData);
          }
        } catch (error) {
          console.error(`创建${itemType}独立窗口失败:`, error);
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

  const contextValue = {
    dragState,
    createAnimatedDragHandler,
    configureDragAnimations,
    previewElementRef  // 暴露 ref 给 DragPreview 使用
  };

  return (
    <DragAnimationContext.Provider value={contextValue}>
      {children}
      {/* 全局拖拽预览组件 */}
      <DragPreview
        isDragging={dragState.isDragging}
        draggedItem={dragState.draggedItem}
        draggedItemType={dragState.draggedItemType}
        currentPosition={dragState.currentPosition}
        isNearBoundary={dragState.isNearBoundary}
        boundaryPosition={dragState.boundaryPosition}
        previewRef={previewElementRef}
      />
    </DragAnimationContext.Provider>
  );
};

/**
 * 使用拖拽动画的Hook
 */
export const useDragAnimation = () => {
  const context = useContext(DragAnimationContext);
  if (!context) {
    throw new Error('useDragAnimation must be used within a DragAnimationProvider');
  }
  return context;
};

export default DragAnimationProvider;
