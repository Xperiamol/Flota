/**
 * SecureStorage - 安全存储敏感数据
 * 使用 Electron safeStorage API 加密敏感信息
 * 
 * @version 1.0.0
 * @security CWE-312: Cleartext Storage of Sensitive Information
 */

const { safeStorage, app } = require('electron');

class SecureStorage {
  /**
   * 检查加密是否可用
   * @returns {boolean}
   */
  static isEncryptionAvailable() {
    // 确保 app 已准备就绪
    if (!app.isReady()) {
      console.warn('[SecureStorage] App 未就绪，加密不可用');
      return false;
    }
    
    try {
      return safeStorage.isEncryptionAvailable();
    } catch (error) {
      console.error('[SecureStorage] 检查加密可用性失败:', error);
      return false;
    }
  }

  /**
   * 加密字符串
   * @param {string} plainText - 明文
   * @returns {string} Base64 编码的加密文本
   */
  static encrypt(plainText) {
    if (!plainText) {
      return '';
    }

    if (!this.isEncryptionAvailable()) {
      console.warn('[SecureStorage] 加密不可用，使用明文存储（不推荐）');
      console.warn('[SecureStorage] 建议在生产环境中启用加密');
      // 在开发环境下允许明文存储
      if (process.env.NODE_ENV === 'development') {
        return `PLAIN:${plainText}`;
      }
      throw new Error('加密不可用');
    }

    try {
      const buffer = safeStorage.encryptString(plainText);
      return `ENCRYPTED:${buffer.toString('base64')}`;
    } catch (error) {
      console.error('[SecureStorage] 加密失败:', error);
      throw new Error('加密失败: ' + error.message);
    }
  }

  /**
   * 解密字符串
   * @param {string} encryptedText - 加密文本（Base64）
   * @returns {string} 明文
   */
  static decrypt(encryptedText) {
    if (!encryptedText) {
      return '';
    }

    // 检查是否为明文（开发模式）
    if (encryptedText.startsWith('PLAIN:')) {
      const plainText = encryptedText.substring(6);
      // 安全提示: 避免记录具体的数据类型，防止信息泄露
      if (process.env.NODE_ENV === 'development') {
        console.warn('[SecureStorage] 检测到未加密数据');
      }
      return plainText;
    }

    // 检查是否为加密数据
    if (!encryptedText.startsWith('ENCRYPTED:')) {
      console.error('[SecureStorage] 数据格式错误');
      throw new Error('数据格式错误');
    }

    if (!this.isEncryptionAvailable()) {
      throw new Error('加密不可用，无法解密数据');
    }

    try {
      const base64Data = encryptedText.substring(10);
      const buffer = Buffer.from(base64Data, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('[SecureStorage] 解密失败:', error);
      throw new Error('解密失败: ' + error.message);
    }
  }

  /**
   * 批量加密对象中的敏感字段
   * @param {Object} obj - 对象
   * @param {string[]} sensitiveFields - 需要加密的字段名
   * @returns {Object} 加密后的对象
   */
  static encryptFields(obj, sensitiveFields = []) {
    const encrypted = { ...obj };
    
    for (const field of sensitiveFields) {
      if (obj[field]) {
        encrypted[field] = this.encrypt(obj[field]);
      }
    }
    
    return encrypted;
  }

  /**
   * 批量解密对象中的敏感字段
   * @param {Object} obj - 对象
   * @param {string[]} sensitiveFields - 需要解密的字段名
   * @returns {Object} 解密后的对象
   */
  static decryptFields(obj, sensitiveFields = []) {
    const decrypted = { ...obj };
    
    for (const field of sensitiveFields) {
      if (obj[field]) {
        try {
          decrypted[field] = this.decrypt(obj[field]);
        } catch (error) {
          console.error(`[SecureStorage] 解密字段 ${field} 失败:`, error);
          decrypted[field] = null;
        }
      }
    }
    
    return decrypted;
  }

  /**
   * 验证数据是否已加密
   * @param {string} data - 数据
   * @returns {boolean}
   */
  static isEncrypted(data) {
    return data && data.startsWith('ENCRYPTED:');
  }

  /**
   * 迁移明文数据到加密存储
   * @param {string} plainText - 明文
   * @returns {string} 加密文本
   */
  static migrateToEncrypted(plainText) {
    // 如果已经加密，直接返回
    if (this.isEncrypted(plainText)) {
      return plainText;
    }
    
    // 如果是开发模式的明文标记，提取原始数据
    if (plainText.startsWith('PLAIN:')) {
      plainText = plainText.substring(6);
    }
    
    // 加密并返回
    return this.encrypt(plainText);
  }
}

module.exports = SecureStorage;
