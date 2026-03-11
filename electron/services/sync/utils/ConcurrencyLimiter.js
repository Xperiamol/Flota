/**
 * Flota v3.0 原子化同步系统 - 并发控制器
 *
 * 简单的并发限制实现，替代 p-limit
 */

class ConcurrencyLimiter {
  /**
   * 创建并发限制器
   * @param {number} concurrency - 最大并发数
   */
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  /**
   * 执行函数，限制并发
   * @param {Function} fn - 要执行的函数（返回 Promise）
   * @returns {Promise} 函数执行结果
   */
  async run(fn) {
    // 如果达到并发限制，则排队等待
    while (this.running >= this.concurrency) {
      await new Promise(resolve => {
        this.queue.push(resolve);
      });
    }

    this.running++;

    try {
      return await fn();
    } finally {
      this.running--;

      // 从队列中取出下一个任务
      if (this.queue.length > 0) {
        const resolve = this.queue.shift();
        resolve();
      }
    }
  }

  /**
   * 获取当前运行数
   */
  get activeCount() {
    return this.running;
  }

  /**
   * 获取队列长度
   */
  get pendingCount() {
    return this.queue.length;
  }

  /**
   * 清空队列
   */
  clearQueue() {
    this.queue = [];
  }
}

module.exports = ConcurrencyLimiter;
