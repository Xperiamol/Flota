const EventEmitter = require('events');
const TimeZoneUtils = require('../utils/timeZoneUtils');

/**
 * 通知服务类
 * 负责管理待办事项到期提醒
 */
class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.isEnabled = true;
    this.checkInterval = 60000; // 每分钟检查一次
    this.intervalId = null;
    this.notifiedTodos = new Set(); // 记录已通知的待办事项ID，避免重复通知
    this.snoozedTodos = new Map();
    this.windowManager = null;
    this.pendingTodos = [];
  }

  setWindowManager(windowManager) {
    this.windowManager = windowManager;
    if (!windowManager || this.pendingTodos.length === 0) return;
    const pending = this.pendingTodos.splice(0);
    pending.forEach((todo) => this.showTodoNotification(todo));
  }

  /**
   * 启动通知服务
   */
  start() {
    if (this.intervalId) {
      this.stop();
    }

    console.log('启动通知服务，检查间隔:', this.checkInterval + 'ms');
    
    // 立即执行一次检查
    this.checkDueTodos();
    
    // 设置定时检查
    this.intervalId = setInterval(() => {
      this.checkDueTodos();
    }, this.checkInterval);
  }

  /**
   * 停止通知服务
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('通知服务已停止');
    }
  }

  /**
   * 设置检查间隔
   * @param {number} interval - 检查间隔（毫秒）
   */
  setCheckInterval(interval) {
    this.checkInterval = interval;
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }

  /**
   * 启用/禁用通知
   * @param {boolean} enabled - 是否启用
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled && this.intervalId) {
      this.stop();
    } else if (enabled && !this.intervalId) {
      this.start();
    }
  }

  /**
   * 检查到期的待办事项
   */
  async checkDueTodos() {
    if (!this.isEnabled) {
      console.log('通知服务未启用，跳过检查');
      return;
    }

    try {
      console.log('检查到期的待办事项...');
      console.log(`[NotificationService] 当前时间: ${TimeZoneUtils.nowUTC()}`);
      // 触发事件，让TodoService提供到期的待办事项
      this.emit('check-due-todos');
    } catch (error) {
      console.error('检查到期待办事项时出错:', error);
    }
  }

  /**
   * 处理到期的待办事项列表
   * @param {Array} dueTodos - 到期的待办事项列表
   */
  handleDueTodos(dueTodos) {
    if (!this.isEnabled || !Array.isArray(dueTodos)) {
      return;
    }

    dueTodos.forEach(todo => {
      const snoozedUntil = this.snoozedTodos.get(todo.id);
      if (snoozedUntil && snoozedUntil > Date.now()) return;
      if (snoozedUntil) {
        this.snoozedTodos.delete(todo.id);
        this.notifiedTodos.delete(todo.id);
      }

      // 避免重复通知同一个待办事项
      if (!this.notifiedTodos.has(todo.id)) {
        this.showTodoNotification(todo);
        this.notifiedTodos.add(todo.id);
      }
    });

    // 清理已完成或删除的待办事项的通知记录
    this.cleanupNotifiedTodos(dueTodos);
  }

  /**
   * 显示待办事项通知
   * @param {Object} todo - 待办事项对象
   */
  showTodoNotification(todo) {
    if (!this.isEnabled) {
      console.log('通知功能未启用，跳过通知显示');
      return;
    }

    if (!this.windowManager) {
      if (!this.pendingTodos.some((item) => String(item.id) === String(todo.id))) {
        this.pendingTodos.push(todo);
      }
      return;
    }

    this.windowManager.showTodoReminder(todo).catch((error) => {
      console.error('显示待办提醒窗口时出错:', error);
    });
  }

  snoozeTodo(todoId, minutes = 10) {
    const safeMinutes = Math.max(1, Number(minutes) || 10);
    this.notifiedTodos.delete(todoId);
    this.snoozedTodos.set(todoId, Date.now() + safeMinutes * 60 * 1000);
    console.log(`待办 ${todoId} 已延后提醒 ${safeMinutes} 分钟`);
  }

  /**
   * 格式化通知内容
   * @param {Object} todo - 待办事项对象
   * @returns {string} 格式化后的通知内容
   */
  formatNotificationBody(todo) {
    let body = todo.content;
    
    if (todo.due_date) {
      const isOverdue = TimeZoneUtils.isOverdue(todo.due_date);
      const displayTime = TimeZoneUtils.formatForDisplay(todo.due_date);
      
      if (isOverdue) {
        body += ` (已逾期 - ${displayTime})`;
      } else {
        body += ` (截止时间: ${displayTime})`;
      }
    }

    // 添加优先级标识
    if (todo.is_important && todo.is_urgent) {
      body = '🔴 ' + body;
    } else if (todo.is_important) {
      body = '🟡 ' + body;
    } else if (todo.is_urgent) {
      body = '🟠 ' + body;
    }

    return body;
  }

  /**
   * 格式化日期时间
   * @param {Date} date - 日期对象
   * @returns {string} 格式化后的日期时间字符串
   */
  formatDateTime(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todoDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const timeStr = date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    if (todoDate.getTime() === today.getTime()) {
      return `今天 ${timeStr}`;
    } else if (todoDate.getTime() === today.getTime() + 24 * 60 * 60 * 1000) {
      return `明天 ${timeStr}`;
    } else if (todoDate.getTime() === today.getTime() - 24 * 60 * 60 * 1000) {
      return `昨天 ${timeStr}`;
    } else {
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }

  /**
   * 清理已通知的待办事项记录
   * @param {Array} currentDueTodos - 当前到期的待办事项列表
   */
  cleanupNotifiedTodos(currentDueTodos) {
    const currentTodoIds = new Set(currentDueTodos.map(todo => todo.id));
    
    // 移除不再到期的待办事项的通知记录
    for (const todoId of this.notifiedTodos) {
      if (!currentTodoIds.has(todoId)) {
        this.notifiedTodos.delete(todoId);
      }
    }
  }





  /**
   * 重置通知记录
   */
  resetNotificationHistory() {
    this.notifiedTodos.clear();
    this.snoozedTodos.clear();
    console.log('通知记录已重置');
  }

  /**
   * 获取服务状态
   * @returns {Object} 服务状态信息
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isRunning: !!this.intervalId,
      checkInterval: this.checkInterval,
      notifiedCount: this.notifiedTodos.size
    };
  }
}

module.exports = NotificationService;
