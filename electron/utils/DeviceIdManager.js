const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 尝试加载 Electron，如果失败则使用 null（独立运行模式）
let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {
  // 独立运行模式
}

const getUserDataPath = () => {
  if (app) return app.getPath('userData');
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (platform === 'win32') return path.join(process.env.APPDATA || homeDir, 'Flota');
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  return path.join(homeDir, '.config', 'Flota');
};

/**
 * 设备 ID 管理器
 * 为每个设备生成并持久化唯一标识符，用于多设备同步
 */
class DeviceIdManager {
  constructor() {
    this.deviceId = null;
    this.deviceIdPath = null;
  }

  /**
   * 获取设备 ID 文件路径
   */
  getDeviceIdPath() {
    if (!this.deviceIdPath) {
      this.deviceIdPath = path.join(getUserDataPath(), 'device-id.txt');
    }
    return this.deviceIdPath;
  }

  /**
   * 生成新的设备 ID
   * 格式: 8位随机字符 + 时间戳后4位
   */
  generateDeviceId() {
    const randomPart = crypto.randomBytes(4).toString('hex'); // 8位
    const timePart = Date.now().toString(36).slice(-4); // 时间戳后4位（base36）
    return `${randomPart}-${timePart}`;
  }

  /**
   * 获取或创建设备 ID
   * 如果已存在则读取，否则生成新的并保存
   */
  getDeviceId() {
    if (this.deviceId) {
      return this.deviceId;
    }

    const filePath = this.getDeviceIdPath();

    try {
      if (fs.existsSync(filePath)) {
        this.deviceId = fs.readFileSync(filePath, 'utf8').trim();
        if (this.deviceId && this.deviceId.length >= 8) {
          console.log('[DeviceIdManager] 已加载设备 ID:', this.deviceId);
          return this.deviceId;
        }
      }
    } catch (error) {
      console.warn('[DeviceIdManager] 读取设备 ID 失败:', error);
    }

    // 生成新的设备 ID
    this.deviceId = this.generateDeviceId();
    
    try {
      fs.writeFileSync(filePath, this.deviceId);
      console.log('[DeviceIdManager] 已生成并保存新设备 ID:', this.deviceId);
    } catch (error) {
      console.error('[DeviceIdManager] 保存设备 ID 失败:', error);
    }

    return this.deviceId;
  }

  /**
   * 获取设备 ID（短格式，用于文件名）
   * 返回设备 ID 的前8位
   */
  getShortDeviceId() {
    const fullId = this.getDeviceId();
    return fullId.split('-')[0] || fullId.slice(0, 8);
  }

  /**
   * 检查文件名是否由本设备生成
   * @param {string} filename - 变更文件名
   * @returns {boolean}
   */
  isOwnFile(filename) {
    const deviceId = this.getShortDeviceId();
    return filename.includes(`_${deviceId}_`) || filename.includes(`-${deviceId}-`);
  }
}

// 单例
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new DeviceIdManager();
  }
  return instance;
}

module.exports = {
  DeviceIdManager,
  getInstance
};
