/**
 * 拖拽管理器 - 通用拖拽功能实现
 * 遵循SOLID和DRY原则，避免重复代码
 */
import logger from './logger';

class DragManager {
  constructor() {
    this.dragState = {
      isDragging: false,
      draggedItem: null,
      draggedItemType: null,
      startPosition: { x: 0, y: 0 },
      currentPosition: { x: 0, y: 0 },
      dragThreshold: 10, // 拖拽阈值，超过此距离才开始拖拽
      windowBoundaryThreshold: 50 // 窗口边界阈值，拖拽到边界附近时触发独立窗口
    };

    this.callbacks = {
      onDragStart: null,
      onDragMove: null,
      onDragEnd: null,
      onCreateWindow: null
    };

    this.boundHandlers = {
      handleMouseMove: this.handleMouseMove.bind(this),
      handleMouseUp: this.handleMouseUp.bind(this)
    };

    // 添加防抖相关属性
    this.lastBoundaryState = {
      isNearBoundary: false,
      boundaryPosition: null
    };
    this.boundaryCheckThrottle = null;
  }

  /**
   * 配置拖拽管理器
   * @param {Object} options 配置选项
   * @param {Function} options.onDragStart 拖拽开始回调
   * @param {Function} options.onDragMove 拖拽移动回调
   * @param {Function} options.onDragEnd 拖拽结束回调
   * @param {Function} options.onCreateWindow 创建独立窗口回调
   * @param {number} options.dragThreshold 拖拽阈值
   * @param {number} options.windowBoundaryThreshold 窗口边界阈值
   */
  configure(options = {}) {
    this.callbacks = {
      ...this.callbacks,
      ...options
    };

    if (options.dragThreshold !== undefined) {
      this.dragState.dragThreshold = options.dragThreshold;
    }

    if (options.windowBoundaryThreshold !== undefined) {
      this.dragState.windowBoundaryThreshold = options.windowBoundaryThreshold;
    }
  }

  /**
   * 开始拖拽
   * @param {MouseEvent} event 鼠标事件
   * @param {Object} item 被拖拽的项目
   * @param {string} itemType 项目类型 ('note' | 'todo')
   */
  startDrag(event, item, itemType) {
    if (this.dragState.isDragging) {
      return;
    }

    this.dragState.draggedItem = item;
    this.dragState.draggedItemType = itemType;
    this.dragState.startPosition = {
      x: event.clientX,
      y: event.clientY
    };
    this.dragState.currentPosition = {
      x: event.clientX,
      y: event.clientY
    };

    // 添加全局事件监听器
    document.addEventListener('mousemove', this.boundHandlers.handleMouseMove);
    document.addEventListener('mouseup', this.boundHandlers.handleMouseUp);

    // 阻止默认行为
    event.preventDefault();
  }

  /**
   * 处理鼠标移动
   * @param {MouseEvent} event 鼠标事件
   */
  handleMouseMove(event) {
    if (!this.dragState.draggedItem) {
      return;
    }

    this.dragState.currentPosition = {
      x: event.clientX,
      y: event.clientY
    };

    const deltaX = event.clientX - this.dragState.startPosition.x;
    const deltaY = event.clientY - this.dragState.startPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 检查是否超过拖拽阈值
    if (!this.dragState.isDragging && distance > this.dragState.dragThreshold) {
      this.dragState.isDragging = true;

      // 触发拖拽开始回调
      if (this.callbacks.onDragStart) {
        this.callbacks.onDragStart({
          item: this.dragState.draggedItem,
          itemType: this.dragState.draggedItemType,
          startPosition: this.dragState.startPosition
        });
      }
    }

    // 如果正在拖拽，触发移动回调
    if (this.dragState.isDragging) {
      if (this.callbacks.onDragMove) {
        this.callbacks.onDragMove({
          item: this.dragState.draggedItem,
          itemType: this.dragState.draggedItemType,
          currentPosition: this.dragState.currentPosition,
          deltaX,
          deltaY,
          distance
        });
      }

      // 检查是否接近窗口边界
      this.checkWindowBoundary(event);
    }
  }

  /**
   * 处理鼠标释放
   * @param {MouseEvent} event 鼠标事件
   */
  handleMouseUp(event) {
    const wasDragging = this.dragState.isDragging;
    const draggedItem = this.dragState.draggedItem;
    const draggedItemType = this.dragState.draggedItemType;

    // 检查是否在窗口边界释放
    const shouldCreateWindow = wasDragging && this.isNearWindowBoundary(event);

    // 清理拖拽状态
    this.cleanup();

    // 触发拖拽结束回调
    if (wasDragging && this.callbacks.onDragEnd) {
      this.callbacks.onDragEnd({
        item: draggedItem,
        itemType: draggedItemType,
        endPosition: { x: event.clientX, y: event.clientY },
        shouldCreateWindow
      });
    }

    // 如果需要创建独立窗口
    if (shouldCreateWindow && this.callbacks.onCreateWindow) {
      this.callbacks.onCreateWindow({
        item: draggedItem,
        itemType: draggedItemType,
        // 传递结束位置用于窗口定位
        endPosition: { x: event.screenX, y: event.screenY }
      });
    }
  }

  /**
   * 检查窗口边界
   * @param {MouseEvent} event 鼠标事件
   */
  checkWindowBoundary(event) {
    const isNearBoundary = this.isNearWindowBoundary(event);
    const boundaryPosition = this.getBoundaryPosition(event);

    // 更新光标样式
    if (isNearBoundary) {
      document.body.style.cursor = 'copy';
    } else {
      document.body.style.cursor = 'grabbing';
    }

    // 只有当边界状态发生变化时才触发回调，避免频繁更新
    const stateChanged =
      this.lastBoundaryState.isNearBoundary !== isNearBoundary ||
      this.lastBoundaryState.boundaryPosition !== boundaryPosition;

    if (stateChanged || !this.boundaryCheckThrottle) {
      // 清除之前的节流
      if (this.boundaryCheckThrottle) {
        clearTimeout(this.boundaryCheckThrottle);
      }

      // 使用节流来减少频繁调用
      this.boundaryCheckThrottle = setTimeout(() => {
        if (this.callbacks.onBoundaryCheck) {
          this.callbacks.onBoundaryCheck({
            isNearBoundary,
            boundaryPosition,
            currentPosition: this.dragState.currentPosition
          });
        }
        this.boundaryCheckThrottle = null;
      }, 16); // 约60fps的更新频率

      // 更新最后的边界状态
      this.lastBoundaryState = {
        isNearBoundary,
        boundaryPosition
      };
    }
  }

  /**
   * 检查是否接近窗口边界
   * @param {MouseEvent} event 鼠标事件
   * @returns {boolean} 是否接近边界
   */
  isNearWindowBoundary(event) {
    const threshold = this.dragState.windowBoundaryThreshold;
    const { clientX, clientY } = event;
    const { innerWidth, innerHeight } = window;

    return (
      clientX < threshold || // 左边界
      clientX > innerWidth - threshold || // 右边界
      clientY < threshold || // 上边界
      clientY > innerHeight - threshold // 下边界
    );
  }

  /**
   * 获取边界位置
   * @param {MouseEvent} event 鼠标事件
   * @returns {string|null} 边界位置 ('top', 'bottom', 'left', 'right')
   */
  getBoundaryPosition(event) {
    const threshold = this.dragState.windowBoundaryThreshold;
    const { clientX, clientY } = event;
    const { innerWidth, innerHeight } = window;

    if (clientY < threshold) return 'top';
    if (clientY > innerHeight - threshold) return 'bottom';
    if (clientX < threshold) return 'left';
    if (clientX > innerWidth - threshold) return 'right';

    return null;
  }

  /**
   * 清理拖拽状态
   */
  cleanup() {
    // 移除事件监听器
    document.removeEventListener('mousemove', this.boundHandlers.handleMouseMove);
    document.removeEventListener('mouseup', this.boundHandlers.handleMouseUp);

    // 清理节流定时器
    if (this.boundaryCheckThrottle) {
      clearTimeout(this.boundaryCheckThrottle);
      this.boundaryCheckThrottle = null;
    }

    // 重置状态
    this.dragState.isDragging = false;
    this.dragState.draggedItem = null;
    this.dragState.draggedItemType = null;

    // 重置边界状态
    this.lastBoundaryState = {
      isNearBoundary: false,
      boundaryPosition: null
    };

    // 重置光标
    document.body.style.cursor = '';
  }

  /**
   * 强制停止拖拽
   */
  stopDrag() {
    this.cleanup();
  }

  /**
   * 获取当前拖拽状态
   * @returns {Object} 拖拽状态
   */
  getDragState() {
    return { ...this.dragState };
  }

  /**
   * 检查是否正在拖拽
   * @returns {boolean} 是否正在拖拽
   */
  isDragging() {
    return this.dragState.isDragging;
  }
}

// 创建单例实例
const dragManager = new DragManager();

export default dragManager;

/**
 * 创建拖拽处理器的工厂函数
 * @param {string} itemType 项目类型
 * @param {Function} createWindowCallback 创建窗口的回调函数
 * @returns {Object} 拖拽处理器对象
 */
export function createDragHandler(itemType, createWindowCallback) {
  return {
    /**
     * 处理拖拽开始
     * @param {MouseEvent} event 鼠标事件
     * @param {Object} item 被拖拽的项目
     */
    handleDragStart: (event, item) => {
      dragManager.configure({
        onDragStart: (dragData) => {
          logger.log(`开始拖拽${itemType}:`, dragData.item);
        },
        onDragMove: (dragData) => {
          // 可以在这里添加拖拽过程中的视觉反馈
        },
        onDragEnd: (dragData) => {
          logger.log(`拖拽${itemType}结束:`, dragData);
        },
        onCreateWindow: async (dragData) => {
          try {
            await createWindowCallback(dragData.item);
            logger.log(`创建${itemType}独立窗口成功`);
          } catch (error) {
            console.error(`创建${itemType}独立窗口失败:`, error);
          }
        }
      });

      dragManager.startDrag(event, item, itemType);
    },

    /**
     * 停止拖拽
     */
    stopDrag: () => {
      dragManager.stopDrag();
    },

    /**
     * 获取拖拽状态
     */
    getDragState: () => {
      return dragManager.getDragState();
    }
  };
}