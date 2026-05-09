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

function encryptValue(value) {
  if (!value || !canEncrypt()) return value || '';
  return `${PREFIX}${safeStorage.encryptString(String(value)).toString('base64')}`;
}

function decryptValue(value) {
  if (!value || typeof value !== 'string' || !value.startsWith(PREFIX)) {
    return value || '';
  }

  if (!canEncrypt()) {
    return '';
  }

  return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'));
}

module.exports = {
  canEncrypt,
  encryptValue,
  decryptValue
};
