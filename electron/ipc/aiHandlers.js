/**
 * AI 相关 IPC handler：
 *   - ai:get-config / save-config / test-connection / test-web-search / get-providers / chat
 *   - ai:execute-pending-action
 *   - ai:chat-stream / ai:cancel-stream（流式 + 取消）
 */

const { BrowserWindow } = require('electron');
const { registerIpcHandlers, createTryCatchHandler } = require('./helpers');
const { getInstance: getLogger } = require('../services/LoggerService');

const registerAIHandlers = (services, activeAIStreams) => {
  const logger = getLogger();
  registerIpcHandlers([
    { channel: 'ai:get-config', handler: createTryCatchHandler(services, 'aiService', 'getConfig', '获取AI配置失败') },
    { channel: 'ai:save-config', handler: createTryCatchHandler(services, 'aiService', 'saveConfig', '保存AI配置失败') },
    { channel: 'ai:test-connection', handler: createTryCatchHandler(services, 'aiService', 'testConnection', '测试AI连接失败') },
    { channel: 'ai:test-web-search', handler: createTryCatchHandler(services, 'webSearchService', 'testConnection', '测试联网搜索失败') },
    { channel: 'ai:get-providers', handler: createTryCatchHandler(services, 'aiService', 'getProviders', '获取AI提供商列表失败') },
    { channel: 'ai:chat', handler: createTryCatchHandler(services, 'aiService', 'chat', 'AI聊天失败') },
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
      handler: async (_event, actionId, overrides) => {
        try {
          if (!services.aiChatService) {
            return { success: false, error: 'AI助手服务尚未初始化，请稍后重试' };
          }
          const result = await services.aiChatService.executePendingAction(actionId, overrides);
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
    {
      channel: 'ai:consume-pending-action',
      handler: async (_event, actionId) => {
        try {
          if (!services.aiChatService) {
            return { success: false, error: 'AI助手服务尚未初始化，请稍后重试' };
          }
          const result = services.aiChatService.consumePendingAction(actionId);
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
    {
      channel: 'ai:chat-stream',
      handler: async (event, { messages, options }) => {
        const requestId = options?.requestId || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const conversationId = options?.conversationId || null;
        const abortController = new AbortController();
        activeAIStreams.set(requestId, abortController);
        const startedAt = Date.now();
        logger.info('AIChatService', 'chat-stream start', {
          requestId,
          conversationId,
          scene: options?.scene || null,
          messageCount: Array.isArray(messages) ? messages.length : 0,
        });

        try {
          if (!services.aiChatService) {
            return { success: false, error: 'AI助手服务尚未初始化，请稍后重试' };
          }

          const win = BrowserWindow.fromWebContents(event.sender);
          const result = await services.aiChatService.chatStream(
            messages,
            (chunk) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send('ai:chat-chunk', { ...chunk, requestId, conversationId });
              }
            },
            { ...options, requestId, conversationId, abortSignal: abortController.signal }
          );

          if (abortController.signal.aborted && !result?.success) {
            logger.info('AIChatService', 'chat-stream cancelled', { requestId, conversationId, durationMs: Date.now() - startedAt });
            return { success: false, cancelled: true, requestId, error: '已取消生成' };
          }

          logger.info('AIChatService', 'chat-stream done', {
            requestId,
            conversationId,
            success: result?.success,
            durationMs: Date.now() - startedAt,
            truncated: result?.truncated,
          });
          return { ...result, requestId };
        } catch (error) {
          if (abortController.signal.aborted) {
            return { success: false, cancelled: true, requestId, error: '已取消生成' };
          }
          logger.error('AIChatService', 'chat-stream failed', { requestId, conversationId, error: error.message });
          return { success: false, requestId, error: error.message };
        } finally {
          activeAIStreams.delete(requestId);
        }
      }
    },
    {
      channel: 'ai:cancel-stream',
      handler: async (_event, requestId) => {
        try {
          const controller = activeAIStreams.get(requestId);
          if (!controller) return { success: false, error: '请求不存在或已结束' };
          controller.abort();
          logger.info('AIChatService', 'cancel-stream', { requestId });
          return { success: true, requestId };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    }
  ]);
};

module.exports = { registerAIHandlers };
