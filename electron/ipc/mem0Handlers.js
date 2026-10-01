/**
 * Mem0 记忆管理 IPC handler。
 *   - mem0:add / search / get / update / delete / clear / stats / is-available
 *   - mem0:status / retry-init（引擎状态与重试）
 *   - mem0:download-model / cancel-download / set-model（向量模型）
 *   - mem0:set-setting（自动记忆开关等）
 *   - mem0:revert-changes（撤销自动记忆）
 *   - mem0:cleanup（生命周期治理）
 *   - mem0:migrate-historical（索引笔记和待办）
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
      channel: 'mem0:update',
      handler: async (_event, { memoryId, content }) => {
        try {
          if (!String(content || '').trim()) return { success: false, error: '记忆内容不能为空' };
          return await services.mem0Service.updateMemory(memoryId, String(content).trim());
        } catch (error) {
          console.error('更新记忆失败:', error);
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:status',
      handler: async () => services.mem0Service.getStatus()
    },
    {
      channel: 'mem0:retry-init',
      handler: async () => {
        const result = await services.mem0Service.initialize();
        if (result.success) services.migrationService?.startAutoMigration('current_user');
        return result;
      }
    },
    {
      channel: 'mem0:download-model',
      handler: async (_event, { modelId }) => {
        try {
          const result = await services.mem0Service.downloadModel(modelId);
          if (!result.success) return result;
          // 下载完直接切换，后台重算已有记忆的向量
          await services.mem0Service.setActiveModel(modelId);
          if (services.migrationService && !services.migrationService.autoMigrateTimer) {
            services.migrationService.startAutoMigration('current_user');
          }
          return { success: true };
        } catch (error) {
          console.error('[Mem0] 下载模型失败:', error);
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:cancel-download',
      handler: async () => {
        services.mem0Service.cancelDownload();
        return { success: true };
      }
    },
    {
      channel: 'mem0:set-model',
      handler: async (_event, { modelId }) => {
        try {
          return await services.mem0Service.setActiveModel(modelId);
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:set-setting',
      handler: async (_event, { key, value }) => {
        // 只开放界面上有的开关
        if (!['auto_memory'].includes(key)) return { success: false, error: '不支持的设置项' };
        try {
          services.mem0Service.setSetting(key, value);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    },
    {
      channel: 'mem0:revert-changes',
      handler: async (_event, { changes }) => {
        try {
          return { success: true, ...services.mem0Service.revertChanges(Array.isArray(changes) ? changes : []) };
        } catch (error) {
          console.error('[Mem0] 撤销记忆变更失败:', error);
          return { success: false, error: error.message };
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
          return await services.migrationService.migrateAll('current_user');
        } catch (error) {
          console.error('[Mem0] 迁移历史数据失败:', error);
          return { success: false, error: error.message, memoryCount: 0, skippedCount: 0 };
        }
      }
    }
  ]);
};

module.exports = { registerMem0Handlers };
