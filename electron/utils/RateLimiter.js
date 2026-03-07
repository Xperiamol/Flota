/**
 * RateLimiter - 速率限制器
 * 防止 API 滥用和资源耗尽攻击
 * 
 * @version 1.0.0
 * @security CWE-770: Allocation of Resources Without Limits
 * @security CWE-400: Uncontrolled Resource Consumption
 */

class RateLimiter {
  constructor(options = {}) {
    this.limits = new Map(); // key -> { count, resetTime, violations }
    this.maxRequestsPerWindow = options.maxRequests || 100;
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.maxViolations = options.maxViolations || 3;
    this.blockDurationMs = options.blockDurationMs || 300000; // 5 minutes
    this.blockedClients = new Map(); // key -> blockUntil

    // 定期清理过期数据
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * 检查是否允许请求
   * @param {string} key - 客户端标识（如 pluginId, IP, userId）
   * @returns {Object} { allowed: boolean, remaining: number, resetTime: number, error: string }
   */
  checkLimit(key) {
    const now = Date.now();

    // 检查是否被封禁
    const blockUntil = this.blockedClients.get(key);
    if (blockUntil && now < blockUntil) {
      const remainingSeconds = Math.ceil((blockUntil - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetTime: blockUntil,
        error: `已被临时封禁，请在 ${remainingSeconds} 秒后重试`
      };
    } else if (blockUntil) {
      // 封禁期已过，移除封禁
      this.blockedClients.delete(key);
    }

    // 获取或创建限制记录
    let limit = this.limits.get(key);
    if (!limit || now > limit.resetTime) {
      limit = {
        count: 0,
        resetTime: now + this.windowMs,
        violations: limit?.violations || 0
      };
      this.limits.set(key, limit);
    }

    // 检查是否超出限制
    if (limit.count >= this.maxRequestsPerWindow) {
      limit.violations++;
      
      // 多次违规则封禁
      if (limit.violations >= this.maxViolations) {
        const blockUntil = now + this.blockDurationMs;
        this.blockedClients.set(key, blockUntil);
        
        // 安全日志: 使用哈希避免泄露客户端标识
        const hashedKey = this.hashKey(key);
        console.warn(`[RateLimiter] 封禁客户端: ${hashedKey}, 直到 ${new Date(blockUntil)}`);
        
        return {
          allowed: false,
          remaining: 0,
          resetTime: limit.resetTime,
          error: `超出速率限制并已被封禁`
        };
      }

      const remainingSeconds = Math.ceil((limit.resetTime - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetTime: limit.resetTime,
        error: `超出速率限制，请在 ${remainingSeconds} 秒后重试`
      };
    }

    // 允许请求
    limit.count++;
    const remaining = this.maxRequestsPerWindow - limit.count;

    return {
      allowed: true,
      remaining,
      resetTime: limit.resetTime,
      error: null
    };
  }

  /**
   * 重置客户端限制
   * @param {string} key - 客户端标识
   */
  reset(key) {
    this.limits.delete(key);
    this.blockedClients.delete(key);
  }

  /**
   * 获取客户端统计信息
   * @param {string} key - 客户端标识
   * @returns {Object}
   */
  getStats(key) {
    const limit = this.limits.get(key);
    const blockUntil = this.blockedClients.get(key);
    const now = Date.now();

    return {
      count: limit?.count || 0,
      remaining: limit ? this.maxRequestsPerWindow - limit.count : this.maxRequestsPerWindow,
      resetTime: limit?.resetTime || now + this.windowMs,
      violations: limit?.violations || 0,
      blocked: blockUntil && now < blockUntil,
      blockUntil: blockUntil || null
    };
  }

  /**
   * 哈希客户端标识（用于日志）
   * @private
   */
  hashKey(key) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 8);
  }

  /**
   * 清理过期数据
   * @private
   */
  cleanup() {
    const now = Date.now();
    
    // 清理过期限制记录
    for (const [key, limit] of this.limits.entries()) {
      if (now > limit.resetTime + this.windowMs) {
        this.limits.delete(key);
      }
    }

    // 清理过期封禁
    for (const [key, blockUntil] of this.blockedClients.entries()) {
      if (now > blockUntil) {
        this.blockedClients.delete(key);
      }
    }
  }

  /**
   * 销毁限制器
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.limits.clear();
    this.blockedClients.clear();
  }

  /**
   * 获取全局统计
   * @returns {Object}
   */
  getGlobalStats() {
    return {
      totalClients: this.limits.size,
      blockedClients: this.blockedClients.size,
      maxRequestsPerWindow: this.maxRequestsPerWindow,
      windowMs: this.windowMs
    };
  }
}

/**
 * 资源配额管理器
 * 管理存储、内存等资源的使用配额
 */
class ResourceQuotaManager {
  constructor(options = {}) {
    this.quotas = new Map(); // resourceType -> { used, limit }
    this.defaultLimits = {
      storage: options.storageLimit || 500 * 1024 * 1024, // 500MB
      noteSize: options.noteSizeLimit || 10 * 1024 * 1024, // 10MB
      imageSize: options.imageSizeLimit || 20 * 1024 * 1024, // 20MB
      pluginApiCalls: options.pluginApiCallsLimit || 1000 // per hour
    };
  }

  /**
   * 格式化字节为MB（工具方法）
   * @private
   */
  static formatBytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(2);
  }

  /**
   * 检查资源配额
   * @param {string} resourceType - 资源类型
   * @param {number} requestedAmount - 请求的资源量
   * @returns {Object} { allowed: boolean, used: number, limit: number, available: number, error: string }
   */
  checkQuota(resourceType, requestedAmount = 0) {
    const limit = this.defaultLimits[resourceType];
    if (!limit) {
      return {
        allowed: true,
        used: 0,
        limit: Infinity,
        available: Infinity,
        error: null
      };
    }

    const quota = this.quotas.get(resourceType) || { used: 0 };
    const newUsed = quota.used + requestedAmount;

    if (newUsed > limit) {
      const usedMB = ResourceQuotaManager.formatBytes(quota.used);
      const limitMB = ResourceQuotaManager.formatBytes(limit);
      const requestedMB = ResourceQuotaManager.formatBytes(requestedAmount);

      return {
        allowed: false,
        used: quota.used,
        limit,
        available: limit - quota.used,
        error: `配额不足: 已使用 ${usedMB}MB / ${limitMB}MB, 请求 ${requestedMB}MB`
      };
    }

    return {
      allowed: true,
      used: quota.used,
      limit,
      available: limit - quota.used,
      error: null
    };
  }

  /**
   * 消费资源
   * @param {string} resourceType - 资源类型
   * @param {number} amount - 消费量
   */
  consume(resourceType, amount) {
    const quota = this.quotas.get(resourceType) || { used: 0 };
    quota.used += amount;
    this.quotas.set(resourceType, quota);
  }

  /**
   * 释放资源
   * @param {string} resourceType - 资源类型
   * @param {number} amount - 释放量
   */
  release(resourceType, amount) {
    const quota = this.quotas.get(resourceType);
    if (quota) {
      quota.used = Math.max(0, quota.used - amount);
    }
  }

  /**
   * 重置资源使用
   * @param {string} resourceType - 资源类型
   */
  reset(resourceType) {
    this.quotas.delete(resourceType);
  }

  /**
   * 获取资源统计
   * @param {string} resourceType - 资源类型
   * @returns {Object}
   */
  getStats(resourceType) {
    const quota = this.quotas.get(resourceType) || { used: 0 };
    const limit = this.defaultLimits[resourceType] || Infinity;

    return {
      used: quota.used,
      limit,
      available: limit - quota.used,
      percentage: limit !== Infinity ? (quota.used / limit) * 100 : 0
    };
  }

  /**
   * 获取所有资源统计
   * @returns {Object}
   */
  getAllStats() {
    const stats = {};
    for (const resourceType of Object.keys(this.defaultLimits)) {
      stats[resourceType] = this.getStats(resourceType);
    }
    return stats;
  }
}

module.exports = {
  RateLimiter,
  ResourceQuotaManager
};
