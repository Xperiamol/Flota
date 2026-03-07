/**
 * PathValidator - 路径验证工具
 * 防止路径遍历攻击和文件名注入
 * 
 * @version 1.0.0
 * @security CWE-22: Path Traversal
 * @security CWE-73: External Control of File Name
 */

const path = require('path');

class PathValidator {
  /**
   * 检查文件名是否包含危险字符
   * @param {string} fileName - 文件名
   * @returns {boolean}
   */
  static isValidFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
      return false;
    }

    // 检查文件名中的危险字符
    // Windows: < > : " / \ | ? *
    // Unix: / \0
    const dangerousChars = /[<>:"/\\|?*\x00-\x1f]/g;
    if (dangerousChars.test(fileName)) {
      return false;
    }

    // 检查路径遍历
    const normalized = path.normalize(fileName);
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      return false;
    }

    // 检查保留名称 (Windows)
    const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    const baseName = path.parse(fileName).name;
    if (reservedNames.test(baseName)) {
      return false;
    }

    // 检查以点开头（隐藏文件）
    // 允许某些已知的安全文件
    const allowedDotFiles = ['.gitignore', '.env', '.editorconfig'];
    if (fileName.startsWith('.') && !allowedDotFiles.includes(fileName)) {
      return false;
    }

    // 检查长度
    if (fileName.length > 255) {
      return false;
    }

    return true;
  }

  /**
   * 清理文件名，移除危险字符
   * @param {string} fileName - 原始文件名
   * @returns {string} 清理后的文件名
   */
  static sanitizeFileName(fileName) {
    if (!fileName) {
      return 'unnamed';
    }

    // 移除危险字符
    let sanitized = fileName
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/^\.+/, '_')  // 移除开头的点
      .trim();

    // 限制长度
    if (sanitized.length > 255) {
      const ext = path.extname(sanitized);
      const name = path.basename(sanitized, ext);
      sanitized = name.substring(0, 255 - ext.length) + ext;
    }

    // 如果清理后为空，使用默认名称
    if (!sanitized) {
      sanitized = 'unnamed';
    }

    return sanitized;
  }

  /**
   * 验证路径是否在允许的目录内
   * @param {string} fullPath - 完整路径
   * @param {string} baseDir - 基础目录
   * @returns {boolean}
   */
  static isPathWithinBase(fullPath, baseDir) {
    const normalized = path.normalize(fullPath);
    const base = path.normalize(baseDir);
    
    // 确保路径在基础目录内
    return normalized.startsWith(base) && !normalized.includes('..');
  }

  /**
   * 安全地拼接路径
   * @param {string} baseDir - 基础目录
   * @param {string} fileName - 文件名
   * @returns {string} 安全的完整路径
   * @throws {Error} 如果路径不安全
   */
  static safejoin(baseDir, fileName) {
    // 验证文件名
    if (!this.isValidFileName(fileName)) {
      throw new Error('非法文件名');  // 不泄露具体文件名
    }

    // 清理文件名
    const sanitized = this.sanitizeFileName(fileName);
    
    // 拼接路径
    const fullPath = path.join(baseDir, sanitized);
    
    // 验证最终路径
    if (!this.isPathWithinBase(fullPath, baseDir)) {
      throw new Error('路径遍历攻击检测: ' + fileName);
    }

    return fullPath;
  }

  /**
   * 验证文件扩展名是否允许
   * @param {string} fileName - 文件名
   * @param {string[]} allowedExts - 允许的扩展名列表（小写，不含点）
   * @returns {boolean}
   */
  static hasAllowedExtension(fileName, allowedExts = []) {
    if (!fileName || !allowedExts.length) {
      return false;
    }

    const ext = path.extname(fileName).toLowerCase().substring(1);
    return allowedExts.includes(ext);
  }

  /**
   * 验证是否为图片文件
   * @param {string} fileName - 文件名
   * @returns {boolean}
   */
  static isImageFile(fileName) {
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    return this.hasAllowedExtension(fileName, imageExts);
  }

  /**
   * 生成安全的唯一文件名
   * @param {string} originalName - 原始文件名
   * @param {string} prefix - 前缀（可选）
   * @returns {string} 安全的唯一文件名
   */
  static generateSafeFileName(originalName, prefix = '') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const sanitized = this.sanitizeFileName(baseName);
    
    return `${prefix}${sanitized}_${timestamp}_${random}${ext}`;
  }
}

module.exports = PathValidator;
