let safeStorage = null;

try {
  safeStorage = require('electron').safeStorage;
} catch (error) {
  safeStorage = null;
}

const PREFIX = 'enc:v1:';

function canEncrypt() {
  return !!safeStorage?.isEncryptionAvailable?.();
}

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptValue(value) {
  if (!value || !canEncrypt()) return value || '';
  return `${PREFIX}${safeStorage.encryptString(String(value)).toString('base64')}`;
}

function decryptValue(value) {
  if (!value || !isEncryptedValue(value)) {
    return value || '';
  }

  if (!canEncrypt()) {
    return '';
  }

  try {
    return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'));
  } catch (error) {
    // safeStorage 密文与生成它的系统钥匙串绑定。旧版本曾错误地通过设置同步
    // 传播跨设备密文；遇到此类值必须安全清空，不能让整个设置加载失败。
    console.warn('[secureValue] 无法解密本机密文，已忽略该值:', error.message);
    return '';
  }
}

module.exports = {
  canEncrypt,
  encryptValue,
  decryptValue,
  isEncryptedValue
};
