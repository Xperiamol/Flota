/**
 * 集中式日志服务 - 支持文件输出、日志分级和自动轮转
 */

const fs = require('fs');
const path = require('path');

let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {
  // 独立运行模式
}

const getUserDataPath = () => {
  if (app) return app.getPath('userData');
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || homeDir, 'Flota');
  if (process.platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  return path.join(homeDir, '.config', 'Flota');
};

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 3;

class LoggerService {
  constructor() {
    this.logDir = path.join(getUserDataPath(), 'logs');
    this.logFile = path.join(this.logDir, 'app.log');
    this.level = LEVELS.info;
    this._ensureDir();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (e) { /* ignore */ }
  }

  setLevel(level) {
    if (LEVELS[level] !== undefined) this.level = LEVELS[level];
  }

  _rotate() {
    try {
      const stat = fs.statSync(this.logFile);
      if (stat.size < MAX_FILE_SIZE) return;
    } catch (e) {
      return; // 文件不存在
    }
    try {
      // 删除最旧的
      const oldest = `${this.logFile}.${MAX_FILES}`;
      if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
      // 依次重命名
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const from = `${this.logFile}.${i}`;
        const to = `${this.logFile}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(this.logFile, `${this.logFile}.1`);
    } catch (e) { /* ignore rotation errors */ }
  }

  _write(levelName, tag, message, extra) {
    if (LEVELS[levelName] < this.level) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${levelName.toUpperCase()}] [${tag}]`;
    let line = `${prefix} ${message}`;
    if (extra) {
      const detail = extra instanceof Error
        ? (extra.stack || extra.message)
        : (typeof extra === 'object' ? JSON.stringify(extra) : String(extra));
      line += ` ${detail}`;
    }

    // console 输出
    const consoleFn = levelName === 'error' ? console.error
      : levelName === 'warn' ? console.warn : console.log;
    consoleFn(`[${tag}]`, message, extra || '');

    // 文件输出
    try {
      this._rotate();
      fs.appendFileSync(this.logFile, line + '\n');
    } catch (e) { /* ignore */ }
  }

  debug(tag, message, extra) { this._write('debug', tag, message, extra); }
  info(tag, message, extra)  { this._write('info', tag, message, extra); }
  warn(tag, message, extra)  { this._write('warn', tag, message, extra); }
  error(tag, message, extra) { this._write('error', tag, message, extra); }

  /**
   * 获取日志文件路径（供设置页查看）
   */
  getLogPath() { return this.logDir; }
}

// 单例
let instance = null;
function getInstance() {
  if (!instance) instance = new LoggerService();
  return instance;
}

module.exports = { getInstance, LoggerService };
