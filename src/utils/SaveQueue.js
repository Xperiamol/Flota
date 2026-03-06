/**
 * 保存队列管理器
 * 防止并发保存冲突，确保保存操作按顺序执行
 * 遵循SOLID原则中的单一职责原则
 */
import logger from './logger';

class SaveQueue {
  constructor() {
    this.queue = [];
    this.isSaving = false;
    this.saveInProgress = new Map(); // 记录正在保存的项目ID
  }

  /**
   * 添加保存任务到队列
   * @param {string} id - 项目ID（笔记ID或待办ID）
   * @param {Function} saveFunc - 保存函数
   * @returns {Promise} 保存完成的Promise
   */
  async add(id, saveFunc) {
    // 如果该ID已经在队列中，移除旧的任务
    this.queue = this.queue.filter(task => task.id !== id);

    // 创建新的保存任务
    const task = {
      id,
      saveFunc,
      promise: null,
      resolve: null,
      reject: null
    };

    // 创建Promise
    task.promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });

    // 添加到队列
    this.queue.push(task);

    // 如果当前没有正在执行的保存，立即开始处理
    if (!this.isSaving) {
      this.processQueue();
    }

    return task.promise;
  }

  /**
   * 处理队列中的保存任务
   */
  async processQueue() {
    if (this.isSaving || this.queue.length === 0) {
      return;
    }

    this.isSaving = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();

      // 检查是否已经在保存中（防止重复保存）
      if (this.saveInProgress.has(task.id)) {
        logger.log(`[SaveQueue] 跳过重复保存: ${task.id}`);
        task.resolve();
        continue;
      }

      try {
        this.saveInProgress.set(task.id, true);
        logger.log(`[SaveQueue] 开始保存: ${task.id}`);
        
        await task.saveFunc();
        
        logger.log(`[SaveQueue] 保存成功: ${task.id}`);
        task.resolve();
      } catch (error) {
        console.error(`[SaveQueue] 保存失败: ${task.id}`, error);
        task.reject(error);
      } finally {
        this.saveInProgress.delete(task.id);
      }
    }

    this.isSaving = false;
  }

  /**
   * 立即保存指定ID的项目
   * @param {string} id - 项目ID
   * @returns {Promise} 保存完成的Promise
   */
  async saveNow(id) {
    // 查找队列中的任务
    const taskIndex = this.queue.findIndex(task => task.id === id);
    if (taskIndex === -1) {
      return Promise.resolve(); // 没有待保存的任务
    }

    // 将任务移到队列前面
    const task = this.queue.splice(taskIndex, 1)[0];
    this.queue.unshift(task);

    // 如果当前没有正在执行的保存，立即开始处理
    if (!this.isSaving) {
      this.processQueue();
    }

    return task.promise;
  }

  /**
   * 取消指定ID的保存任务
   * @param {string} id - 项目ID
   */
  cancel(id) {
    this.queue = this.queue.filter(task => {
      if (task.id === id) {
        task.resolve(); // 取消也算成功
        return false;
      }
      return true;
    });
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue.forEach(task => task.resolve());
    this.queue = [];
  }

  /**
   * 获取队列长度
   */
  get length() {
    return this.queue.length;
  }

  /**
   * 检查是否有待保存的任务
   */
  hasPendingSave(id) {
    return this.queue.some(task => task.id === id) || this.saveInProgress.has(id);
  }
}

// 导出单例实例
export const saveQueue = new SaveQueue();

export default SaveQueue;
