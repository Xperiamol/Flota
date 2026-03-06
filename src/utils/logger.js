/**
 * 统一日志工具
 *
 * 通过 localStorage.getItem('debug') === 'true' 控制 debug 级别日志的输出。
 * console.error / console.warn 始终保留，debug 日志默认静默。
 * 在 DevTools Console 中执行 localStorage.setItem('debug','true') 即可开启。
 */

const isDebug = () => {
  try {
    return localStorage.getItem('debug') === 'true';
  } catch {
    return false;
  }
};

const noop = () => {};

const logger = {
  /** 调试信息，生产默认静默 */
  debug: (...args) => { if (isDebug()) console.log('[DEBUG]', ...args); },
  /** 一般信息，生产默认静默 */
  log: (...args) => { if (isDebug()) console.log(...args); },
  /** 警告，始终输出 */
  warn: console.warn.bind(console),
  /** 错误，始终输出 */
  error: console.error.bind(console),
};

export default logger;
