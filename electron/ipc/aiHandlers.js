/**
 * AI 相关 IPC handler：
 *   - ai:get-config / save-config / test-connection / test-web-search / get-providers / chat
 *   - ai:execute-pending-action / ai:consume-pending-action
 *   - ai:session-*：会话由主进程持有（发送、停止、重新生成、确认卡状态），结果广播给所有窗口
 */

const { registerIpcHandlers, createTryCatchHandler } = require('./helpers');
const { getInstance: getLogger } = require('../services/LoggerService');

const registerAIHandlers = (services) => {
  const logger = getLogger();
  const activeGenerations = new Map();
  const runningActions = new Map(); // 正在执行的确认卡：sender:actionId → AbortController
  registerIpcHandlers([
    { channel: 'ai:get-config', handler: createTryCatchHandler(services, 'aiService', 'getConfig', '获取AI配置失败') },
    { channel: 'ai:save-config', handler: createTryCatchHandler(services, 'aiService', 'saveConfig', '保存AI配置失败') },
    { channel: 'ai:test-connection', handler: createTryCatchHandler(services, 'aiService', 'testConnection', '测试AI连接失败') },
    { channel: 'ai:test-web-search', handler: createTryCatchHandler(services, 'webSearchService', 'testConnection', '测试联网搜索失败') },
    { channel: 'ai:get-providers', handler: createTryCatchHandler(services, 'aiService', 'getProviders', '获取AI提供商列表失败') },
    { channel: 'ai:chat', handler: async (event, messages, options = {}) => {
      const key = options.requestId ? `${event.sender.id}:${options.requestId}` : null;
      if (key && activeGenerations.has(key)) return { success: false, error: '请求正在执行' };
      const controller = new AbortController();
      if (key) activeGenerations.set(key, controller);
      try {
        return await services.aiService.chat(messages, { ...options, signal: controller.signal });
      } catch (error) {
        return { success: false, error: error.message };
      } finally {
        if (key) activeGenerations.delete(key);
      }
    } },
    { channel: 'ai:cancel-chat', handler: async (event, requestId) => {
      activeGenerations.get(`${event.sender.id}:${requestId}`)?.abort();
      return { success: true };
    } },
    {
      channel: 'ai:auto-annotate',
      handler: async (_event, payload) => {
        try {
          if (!services.aiChatService) {
            return { success: false, error: 'AI助手服务尚未初始化，请稍后重试' };
          }
          return await services.aiChatService.autoAnnotate(payload || {});
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'ai:execute-pending-action',
      handler: async (event, actionId, overrides, fallback) => {
        try {
          if (!services.aiChatService) {
            return { success: false, error: 'AI助手服务尚未初始化，请稍后重试' };
          }
          // 确认后执行的动作（如长文写作）把步骤进度推给发起确认的窗口，卡片上实时显示
          const sender = event.sender;
          const onChunk = (chunk) => {
            if (!chunk || typeof chunk.type !== 'string' || !chunk.type.startsWith('step_')) return;
            if (!sender.isDestroyed()) sender.send('ai:action-progress', { actionId, chunk });
          };
          // 卡片上的「停止」通过 ai:cancel-pending-action 中止；同一张卡同时只会执行一次
          const key = `${sender.id}:${actionId}`;
          const controller = new AbortController();
          runningActions.set(key, controller);
          let result;
          try {
            result = await services.aiChatService.executePendingAction(actionId, overrides, fallback, { onChunk, abortSignal: controller.signal });
          } finally {
            if (runningActions.get(key) === controller) runningActions.delete(key);
          }
          logger.info('AIChatService', 'execute-pending-action', {
            actionId,
            name: result?.action?.name,
            success: result?.success,
            noteId: result?.result?.noteId ?? result?.result?.note_id ?? null,
            error: result?.error,
          });
          return result;
        } catch (error) {
          logger.error('AIChatService', 'execute-pending-action failed', { actionId, error: error.message });
          return { success: false, error: error.message };
        }
      }
    },
    { channel: 'ai:automations-list', handler: async () => {
      const scheduler = services.automationScheduler;
      return scheduler ? { success: true, data: scheduler.list() } : { success: false, error: '定时任务服务尚未就绪' };
    } },
    { channel: 'ai:automations-remove', handler: async (_event, id) => {
      const scheduler = services.automationScheduler;
      if (!scheduler) return { success: false, error: '定时任务服务尚未就绪' };
      return scheduler.remove(String(id || '')) ? { success: true } : { success: false, error: '没有找到这个定时任务' };
    } },
    { channel: 'ai:cancel-pending-action', handler: async (event, actionId) => {
      const controller = runningActions.get(`${event.sender.id}:${actionId}`);
      controller?.abort();
      return { success: Boolean(controller) };
    } },
    {
      channel: 'ai:consume-pending-action',
      handler: async (_event, actionId, fallback) => {
        try {
          if (!services.aiChatService) {
            return { success: false, error: 'AI助手服务尚未初始化，请稍后重试' };
          }
          const result = services.aiChatService.consumePendingAction(actionId, fallback);
          logger.info('AIChatService', 'consume-pending-action', {
            actionId,
            name: result?.action?.name,
            success: result?.success,
            error: result?.error,
          });
          return result;
        } catch (error) {
          logger.error('AIChatService', 'consume-pending-action failed', { actionId, error: error.message });
          return { success: false, error: error.message };
        }
      }
    },
    ...sessionHandlers(services, logger),
  ]);
};

// 会话服务在 AI 服务初始化完成后才创建；未就绪时统一返回提示
const sessionHandlers = (services, logger) => {
  const call = (name, method) => ({
    channel: name,
    handler: async (_event, ...args) => {
      const sessions = services.conversationSessions;
      if (!sessions) return { success: false, error: 'AI助手服务尚未初始化，请稍后重试' };
      try {
        return await method(sessions, ...args);
      } catch (error) {
        logger.error('ConversationSessions', `${name} failed`, { error: error.message });
        return { success: false, error: error.message };
      }
    },
  });
  return [
    call('ai:session-send', (sessions, payload) => sessions.send(payload || {})),
    call('ai:session-cancel', (sessions, conversationId) => sessions.cancel(conversationId)),
    call('ai:session-retry', (sessions, payload) => sessions.retry(payload || {})),
    call('ai:session-active-streams', (sessions) => ({ success: true, data: sessions.activeStreams() })),
    call('ai:session-action-begin', (sessions, conversationId, actionId) => sessions.beginAction(conversationId, actionId)),
    call('ai:session-action-finish', (sessions, conversationId, actionId, outcome) => sessions.finishAction(conversationId, actionId, outcome)),
    call('ai:session-action-dismiss', (sessions, conversationId, actionId) => {
      const result = sessions.dismissAction(conversationId, actionId);
      // 同时丢弃后端暂存的动作；恢复后执行时会用卡片里保存的参数重建
      if (result.success) services.aiChatService?.consumePendingAction?.(actionId);
      return result;
    }),
    call('ai:session-action-restore', (sessions, conversationId, actionId) => sessions.restoreAction(conversationId, actionId)),
    call('ai:session-memory-reverted', (sessions, conversationId, requestId) => sessions.markMemoryReverted(conversationId, requestId)),
  ];
};

module.exports = { registerAIHandlers };
