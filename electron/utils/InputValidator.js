/**
 * InputValidator - 输入验证工具
 * 验证和清理用户输入，防止注入攻击
 * 
 * @version 1.0.0
 * @security CWE-20: Improper Input Validation
 * @security CWE-79: Cross-site Scripting (XSS)
 */

class InputValidator {
  /**
   * 验证并清理搜索查询
   * @param {string} query - 搜索查询
   * @param {number} maxLength - 最大长度
   * @returns {string} 清理后的查询
   */
  static sanitizeSearchQuery(query, maxLength = 500) {
    if (!query || typeof query !== 'string') {
      return '';
    }

    // 移除 FTS5 特殊字符，只保留安全字符
    // 默认字符集: 字母、数字、空格、中文（U+4E00-U+9FA5）、
    // 日文假名（U+3040-U+309F, U+30A0-U+30FF）、
    // 韩文（U+AC00-U+D7AF）、标点（U+3000-U+303F, U+FF00-U+FFEF）
    let sanitized = query
      .substring(0, maxLength)
      .replace(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FA5\uAC00-\uD7AF\u3000-\u303F\uFF00-\uFFEF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 防止 FTS5 语法注入
    sanitized = sanitized.replace(/[(){}[\]"*^]/g, '');

    return sanitized;
  }

  /**
   * 验证标签名称
   * @param {string} tagName - 标签名称
   * @param {number} maxLength - 最大长度
   * @returns {Object} { valid: boolean, sanitized: string, error: string }
   */
  static validateTagName(tagName, maxLength = 50) {
    if (!tagName || typeof tagName !== 'string') {
      return { valid: false, sanitized: '', error: '标签名称不能为空' };
    }

    // 清理标签
    let sanitized = tagName
      .trim()
      .substring(0, maxLength);

    // 移除特殊字符（仅保留字母、数字、中文、连字符、下划线）
    sanitized = sanitized.replace(/[^\w\u4e00-\u9fa5-]/g, '_');

    if (sanitized.length === 0) {
      return { valid: false, sanitized: '', error: '标签名称无效' };
    }

    if (sanitized.length < 2) {
      return { valid: false, sanitized, error: '标签名称至少 2 个字符' };
    }

    return { valid: true, sanitized, error: null };
  }

  /**
   * 验证笔记内容大小
   * @param {string} content - 笔记内容
   * @param {number} maxBytes - 最大字节数
   * @returns {Object} { valid: boolean, size: number, error: string }
   */
  static validateContentSize(content, maxBytes = 10 * 1024 * 1024) {
    if (!content) {
      return { valid: true, size: 0, error: null };
    }

    const size = Buffer.byteLength(content, 'utf8');
    
    if (size > maxBytes) {
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      const maxMB = (maxBytes / 1024 / 1024).toFixed(2);
      return {
        valid: false,
        size,
        error: `内容过大 (${sizeMB}MB)，最大支持 ${maxMB}MB`
      };
    }

    return { valid: true, size, error: null };
  }

  /**
   * 验证 URL 格式和协议
   * @param {string} url - URL 字符串
   * @param {string[]} allowedProtocols - 允许的协议列表
   * @returns {Object} { valid: boolean, parsed: URL, error: string }
   */
  static validateURL(url, allowedProtocols = ['http:', 'https:']) {
    if (!url || typeof url !== 'string') {
      return { valid: false, parsed: null, error: 'URL 不能为空' };
    }

    try {
      const parsed = new URL(url);

      // 检查协议
      if (!allowedProtocols.includes(parsed.protocol)) {
        return {
          valid: false,
          parsed,
          error: `不支持的协议: ${parsed.protocol}`
        };
      }

      // 检查主机名黑名单（精确匹配和IP范围）
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::]'];
      const hostname = parsed.hostname.toLowerCase();
      
      // 精确匹配
      if (blockedHosts.includes(hostname)) {
        return { valid: false, parsed, error: '禁止访问本地地址' };
      }
      
      // 检查localhost变体
      if (hostname.endsWith('.localhost') || hostname === '127.0.0.1' || 
          hostname.startsWith('127.') || hostname.startsWith('10.') ||
          hostname.startsWith('192.168.') || hostname.startsWith('172.')) {
        return { valid: false, parsed, error: '禁止访问本地或内网地址' };
      }

      return { valid: true, parsed, error: null };
    } catch (error) {
      return { valid: false, parsed: null, error: 'URL 格式错误' };
    }
  }

  /**
   * 验证 API 密钥格式
   * @param {string} apiKey - API 密钥
   * @param {Object} options - 选项
   * @returns {Object} { valid: boolean, error: string }
   */
  static validateApiKey(apiKey, options = {}) {
    const {
      minLength = 10,
      maxLength = 500,
      pattern = null
    } = options;

    if (!apiKey || typeof apiKey !== 'string') {
      return { valid: false, error: 'API 密钥不能为空' };
    }

    const trimmed = apiKey.trim();

    if (trimmed.length < minLength) {
      return { valid: false, error: `API 密钥至少 ${minLength} 个字符` };
    }

    if (trimmed.length > maxLength) {
      return { valid: false, error: `API 密钥最多 ${maxLength} 个字符` };
    }

    if (pattern && !pattern.test(trimmed)) {
      return { valid: false, error: 'API 密钥格式错误' };
    }

    return { valid: true, error: null };
  }

  /**
   * 验证邮箱格式
   * @param {string} email - 邮箱地址
   * @returns {Object} { valid: boolean, error: string }
   */
  static validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: '邮箱不能为空' };
    }

    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const valid = emailPattern.test(email.trim());

    return {
      valid,
      error: valid ? null : '邮箱格式错误'
    };
  }

  /**
   * 清理 HTML 标签（基础清理）
   * 注意: 这是基础清理方法，对于复杂场景请使用 DOMPurify
   * @param {string} text - 文本
   * @returns {string} 清理后的文本
   */
  static stripHTML(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // 警告: 基础清理不能完全防止XSS，应使用DOMPurify进行完整清理
    // 此方法仅用于简单的标签移除
    return text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 验证整数范围
   * @param {number} value - 值
   * @param {number} min - 最小值
   * @param {number} max - 最大值
   * @returns {Object} { valid: boolean, value: number, error: string }
   */
  static validateIntRange(value, min, max) {
    const num = parseInt(value, 10);

    if (!Number.isInteger(num)) {
      return { valid: false, value: null, error: '必须是整数' };
    }

    if (num < min || num > max) {
      return {
        valid: false,
        value: num,
        error: `值必须在 ${min} 到 ${max} 之间`
      };
    }

    return { valid: true, value: num, error: null };
  }

  /**
   * 批量验证对象字段
   * @param {Object} data - 数据对象
   * @param {Object} rules - 验证规则
   * @returns {Object} { valid: boolean, errors: Object }
   */
  static validateObject(data, rules) {
    const errors = {};
    let valid = true;

    for (const [field, rule] of Object.entries(rules)) {
      const value = data[field];

      // 检查必填
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors[field] = `${field} 是必填项`;
        valid = false;
        continue;
      }

      // 跳过非必填且为空的字段
      if (!rule.required && !value) {
        continue;
      }

      // 类型验证
      if (rule.type && typeof value !== rule.type) {
        errors[field] = `${field} 类型错误，期望 ${rule.type}`;
        valid = false;
        continue;
      }

      // 自定义验证函数
      if (rule.validator) {
        const result = rule.validator(value);
        if (!result.valid) {
          errors[field] = result.error;
          valid = false;
        }
      }
    }

    return { valid, errors };
  }
}

module.exports = InputValidator;
