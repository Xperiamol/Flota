/**
 * IPC handler 注册的共享 helper。
 * 让各域 handler 模块复用同一套登记/兜底/透传模式。
 */

const { ipcMain } = require('electron');

const registerIpcHandlers = (handlers) => {
  for (const { channel, handler } of handlers) {
    ipcMain.handle(channel, handler);
  }
};

/**
 * 把 IPC 调用直接透传到某个 service 的方法上（自动丢弃 event 参数）。
 * 用于「方法签名等于 IPC 参数」的纯转发场景。
 */
const createServicePassthroughHandler = (getService, methodName) => {
  return async (_event, ...args) => {
    const service = getService();
    return service[methodName](...args);
  };
};

/**
 * 把 service 方法包装成带统一 try/catch 的 IPC handler。
 * 失败时打印 errorMsg 并返回 { success:false, error }。
 */
const createTryCatchHandler = (services, serviceName, methodName, errorMsg) => {
  return async (_event, ...args) => {
    try {
      const service = services[serviceName];
      return await service[methodName](...args);
    } catch (error) {
      console.error(`${errorMsg}:`, error);
      return { success: false, error: error.message };
    }
  };
};

module.exports = {
  registerIpcHandlers,
  createServicePassthroughHandler,
  createTryCatchHandler
};
