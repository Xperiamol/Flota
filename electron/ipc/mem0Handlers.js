/**
 * Mem0 记忆管理 IPC Handlers
 * 遵循 SOLID 和 DRY 原则
 * - 单一职责：只负责 Mem0 相关的 IPC 通信
 * - DRY：使用 IpcHandlerFactory 消除重复代码
 */

const { ipcMain } = require('electron');
const IpcHandlerFactory = require('../utils/ipcHandlerFactory');

/**
 * 注册所有 Mem0 相关的 IPC handlers
 * @param {object} services - 服务实例集合
 */
function registerMem0Handlers(services) {
  const { mem0Service, migrationService } = services;

  // 添加记忆
  ipcMain.handle('mem0:add', 
    IpcHandlerFactory.createServiceHandler(
      mem0Service, 
      'addMemory', 
      '添加记忆失败'
    )
  );

  // 搜索记忆
  ipcMain.handle('mem0:search',
    IpcHandlerFactory.createWrappedServiceHandler(
      mem0Service,
      'searchMemories',
      'results',
      '搜索记忆失败',
      []
    )
  );

  // 获取记忆列表（带详细日志）
  ipcMain.handle('mem0:get',
    IpcHandlerFactory.createHandler(
      async (event, { userId, options }) => {
        console.log('[Mem0] 获取记忆请求:', { userId, options });
        const memories = await mem0Service.getMemories(userId, options);
        console.log(`[Mem0] 返回 ${memories.length} 条记忆`);
        
        if (memories.length > 0) {
          console.log('[Mem0] 第一条记忆类别:', memories[0].category);
        }
        
        return { success: true, memories };
      },
      '获取记忆列表失败',
      { memories: [] }
    )
  );

  // 删除记忆
  ipcMain.handle('mem0:delete',
    IpcHandlerFactory.createHandler(
      async (event, { memoryId }) => {
        const deleted = await mem0Service.deleteMemory(memoryId);
        return { success: deleted };
      },
      '删除记忆失败'
    )
  );

  // 清除用户记忆
  ipcMain.handle('mem0:clear',
    IpcHandlerFactory.createWrappedServiceHandler(
      mem0Service,
      'clearUserMemories',
      'count',
      '清除记忆失败',
      0
    )
  );

  // 获取统计信息
  ipcMain.handle('mem0:stats',
    IpcHandlerFactory.createWrappedServiceHandler(
      mem0Service,
      'getStats',
      'stats',
      '获取统计信息失败',
      {}
    )
  );

  // 检查服务可用性
  ipcMain.handle('mem0:is-available', 
    IpcHandlerFactory.createHandler(
      async () => {
        return { available: mem0Service.isAvailable() };
      },
      'Mem0 可用性检查失败',
      { available: false }
    )
  );

  // 历史数据迁移（使用专门的迁移服务）
  ipcMain.handle('mem0:migrate-historical',
    IpcHandlerFactory.createHandler(
      async () => {
        const userId = 'current_user';
        return await migrationService.migrateAll(userId);
      },
      '历史数据迁移失败',
      { success: false, memoryCount: 0, errors: [] }
    )
  );

  // v2: 手动触发记忆清理
  ipcMain.handle('mem0:cleanup',
    IpcHandlerFactory.createHandler(
      async () => {
        const userId = 'current_user';
        return await mem0Service.cleanupMemories(userId);
      },
      '记忆清理失败',
      { removed: 0, merged: 0 }
    )
  );
}

module.exports = { registerMem0Handlers };
