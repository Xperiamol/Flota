/**
 * Mem0 记忆管理 IPC handler。
 *   - mem0:add / search / get / delete / clear / stats / is-available
 *   - mem0:cleanup（生命周期治理）
 *   - mem0:migrate-historical（历史数据迁移）
 */

const { registerIpcHandlers } = require('./helpers');

const registerMem0Handlers = (services) => {
  registerIpcHandlers([
    {
      channel: 'mem0:add',
      handler: async (_event, { userId, content, options }) => {
        try {
          return await services.mem0Service.addMemory(userId, content, options);
        } catch (error) {
          console.error('添加记忆失败:', error);
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:search',
      handler: async (_event, { userId, query, options }) => {
        try {
          const results = await services.mem0Service.searchMemories(userId, query, options);
          return { success: true, results };
        } catch (error) {
          console.error('搜索记忆失败:', error);
          return { success: false, error: error.message, results: [] };
        }
      }
    },
    {
      channel: 'mem0:get',
      handler: async (_event, { userId, options }) => {
        try {
          const memories = await services.mem0Service.getMemories(userId, options);
          return { success: true, memories };
        } catch (error) {
          console.error('获取记忆列表失败:', error);
          return { success: false, error: error.message, memories: [] };
        }
      }
    },
    {
      channel: 'mem0:delete',
      handler: async (_event, { memoryId }) => {
        try {
          const deleted = await services.mem0Service.deleteMemory(memoryId);
          return { success: deleted };
        } catch (error) {
          console.error('删除记忆失败:', error);
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:clear',
      handler: async (_event, { userId }) => {
        try {
          const count = await services.mem0Service.clearUserMemories(userId);
          return { success: true, count };
        } catch (error) {
          console.error('清除记忆失败:', error);
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:stats',
      handler: async (_event, { userId }) => {
        try {
          const stats = await services.mem0Service.getStats(userId);
          return { success: true, stats };
        } catch (error) {
          console.error('获取统计信息失败:', error);
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:is-available',
      handler: async () => {
        try {
          return { available: services.mem0Service.isAvailable() };
        } catch (_) {
          return { available: false };
        }
      }
    },
    {
      channel: 'mem0:cleanup',
      handler: async () => {
        try {
          if (!services.mem0Service?.isAvailable()) {
            return { success: false, error: 'Mem0 未初始化' };
          }
          const result = await services.mem0Service.cleanupMemories('current_user');
          return { success: true, ...result };
        } catch (error) {
          console.error('[Mem0] cleanup 失败:', error);
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:migrate-historical',
      handler: async () => {
        try {
          console.log('[Mem0] 开始迁移历史数据(使用去重服务)...');
          const result = await services.migrationService.migrateAll('current_user');
          console.log('[Mem0] 迁移完成:', result);
          return result;
        } catch (error) {
          console.error('[Mem0] 迁移历史数据失败:', error);
          return { success: false, error: error.message, memoryCount: 0, skippedCount: 0 };
        }
      }
    }
  ]);
};

module.exports = { registerMem0Handlers };
