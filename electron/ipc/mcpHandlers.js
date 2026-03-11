const { ipcMain } = require('electron');

/** 简单 IPC handler 工厂 */
function wrap(ch, fn) {
  ipcMain.handle(ch, async () => {
    try { return { success: true, data: await fn() } }
    catch (e) { return { success: false, error: e.message } }
  })
}

/**
 * MCP 相关 IPC 处理器
 */
function setupMCPHandlers(mcpDownloader, mainWindow) {
  wrap('mcp:isInstalled', () => mcpDownloader.isInstalled());
  wrap('mcp:getInstallInfo', () => mcpDownloader.getInstallInfo());

  // 下载并安装 MCP Server
  ipcMain.handle('mcp:install', async () => {
    try {
      // 检查是否已安装
      const installed = await mcpDownloader.isInstalled();
      if (installed) {
        return { success: false, error: 'MCP Server 已安装' };
      }

      // 显示下载对话框
      const shouldDownload = await mcpDownloader.showDownloadDialog(mainWindow);
      if (!shouldDownload) {
        return { success: false, error: '用户取消下载' };
      }

      // 监听进度事件并转发给渲染进程
      const progressListener = (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mcp:install-progress', data);
        }
      };

      const retryListener = (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mcp:download-retry', data);
        }
      };

      mcpDownloader.on('download-progress', progressListener);
      mcpDownloader.on('download-retry', retryListener);
      mcpDownloader.on('extract-start', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mcp:install-progress', { 
            percent: 90, 
            status: 'extracting' 
          });
        }
      });

      try {
        // 开始下载
        await mcpDownloader.download();
        return { success: true, data: { message: 'MCP Server 安装成功' } };
      } finally {
        // 清理监听器
        mcpDownloader.removeListener('download-progress', progressListener);
        mcpDownloader.removeListener('download-retry', retryListener);
      }
    } catch (error) {
      console.error('[MCP Install] 安装失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 卸载 MCP Server
  wrap('mcp:uninstall', () => mcpDownloader.uninstall().then(() => ({ message: 'MCP Server 已卸载' })));

  // 获取 MCP Server 配置路径
  ipcMain.handle('mcp:getConfigPath', async () => {
    try {
      const installed = await mcpDownloader.isInstalled();
      if (!installed) {
        return { success: false, error: 'MCP Server 未安装' };
      }

      const launcherPath = mcpDownloader.getLauncherPath();
      return { success: true, data: { launcherPath } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 清理临时文件
  wrap('mcp:cleanTemp', () => mcpDownloader.cleanTempFiles().then(() => ({ message: '临时文件已清理' })));
}

module.exports = { setupMCPHandlers };
