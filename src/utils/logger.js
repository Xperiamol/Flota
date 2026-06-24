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

/**
 * AI 请求结构化日志：统一携带 requestId/conversationId/actionId/noteId 等关联字段，
 * 便于和主进程日志对齐，快速定位“哪个请求写错了哪个画布”。
 * info 级别走 debug 通道（默认静默，可用 localStorage.debug=true 打开），warn/error 始终输出。
 */
export const aiLog = {
  info: (event, fields = {}) => logger.debug(`[ai] ${event}`, fields),
  warn: (event, fields = {}) => logger.warn(`[ai] ${event}`, fields),
  error: (event, fields = {}) => logger.error(`[ai] ${event}`, fields),
};

export default logger;
