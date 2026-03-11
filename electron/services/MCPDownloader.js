const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const AdmZip = require('adm-zip');
const { EventEmitter } = require('events');
const { HttpsProxyAgent } = require('https-proxy-agent');
const ProxyService = require('./ProxyService');

/**
 * MCP Server 下载和管理服务
 * 实现按需下载 MCP Server 组件
 */
class MCPDownloader extends EventEmitter {
  constructor() {
    super();
    
    // MCP Server 存储路径
    this.mcpDir = path.join(app.getPath('userData'), 'mcp-server');
    this.downloadUrl = 'https://github.com/Xperiamol/Flota/releases/download/v2.3.1/mcp-server.zip';
    
    // 备用 CDN 地址（可以配置为你的 CDN）
    this.cdnUrls = [
      // 'https://cdn.example.com/Flota/mcp-server.zip',
    ];
    
    this.isDownloading = false;
    this.downloadProgress = 0;
    this.proxyService = new ProxyService();
  }

  /**
   * 检查 MCP Server 是否已安装
   */
  async isInstalled() {
    try {
      const launcherPath = path.join(this.mcpDir, 'mcp-server-launcher.js');
      await fs.access(launcherPath);
      
      // 检查 node_modules 是否存在
      const nodeModulesPath = path.join(this.mcpDir, 'node_modules');
      await fs.access(nodeModulesPath);
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 MCP Server 安装路径
   */
  getInstallPath() {
    return this.mcpDir;
  }

  /**
   * 获取 MCP Server 启动器路径
   */
  getLauncherPath() {
    return path.join(this.mcpDir, 'mcp-server-launcher.js');
  }

  /**
   * 下载 MCP Server
   * @param {string} [url] - 下载地址，默认使用 GitHub Releases
   * @returns {Promise<void>}
   */
  async download(url) {
    if (this.isDownloading) {
      console.log('[MCPDownloader] 检测到正在下载，强制重置状态');
      this.isDownloading = false;
    }

    this.isDownloading = true;
    this.downloadProgress = 0;
    this.emit('download-start');

    const downloadUrl = url || this.downloadUrl;
    // 使用用户数据目录而不是临时目录，避免退出后被清理
    const userDataDir = app.getPath('userData');
    const tempZipPath = path.join(userDataDir, 'mcp-server-temp.zip');

    try {
      // 清理旧的临时文件
      try {
        await fs.unlink(tempZipPath);
        console.log('[MCPDownloader] 清理旧的临时文件');
      } catch (error) {
        // 文件可能不存在，忽略
      }

      // 下载 ZIP 文件（带重试）
      let retryCount = 0;
      const maxRetries = 3;
      let lastError;
      
      while (retryCount < maxRetries) {
        try {
          await this._downloadFile(downloadUrl, tempZipPath);
          break; // 下载成功，跳出重试循环
        } catch (error) {
          lastError = error;
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(`[MCPDownloader] 下载失败，${retryCount}/${maxRetries}次重试...`);
            this.emit('download-retry', { attempt: retryCount, maxRetries, error: error.message });
            // 等待2秒后重试
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            throw new Error(`下载失败（已重试${maxRetries}次）: ${error.message}`);
          }
        }
      }

      this.emit('download-complete');
      this.emit('extract-start');

      // 解压
      await this._extractZip(tempZipPath, this.mcpDir);

      this.emit('extract-complete');
      this.emit('install-complete');

      // 清理临时文件
      await fs.unlink(tempZipPath).catch(() => {});

      return { success: true };
    } catch (error) {
      this.emit('install-error', error);
      // 清理失败的临时文件
      await fs.unlink(tempZipPath).catch(() => {});
      console.error('[MCPDownloader] 下载失败:', error);
      throw error;
    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * 下载文件
   * @private
   */
  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(destPath);
      
      // 获取代理配置
      const proxyConfig = this.proxyService.getConfig();
      const requestOptions = { timeout: 300000 };
      
      // 如果启用了代理，添加代理 agent
      if (proxyConfig.enabled) {
        const proxyUrl = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`;
        console.log('[MCPDownloader] 使用代理下载:', proxyUrl);
        requestOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
      
      const request = https.get(url, requestOptions, (response) => {
        // 处理重定向
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          file.close();
          fs.unlink(destPath).catch(() => {});
          return this._downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath).catch(() => {});
          return reject(new Error(`下载失败: HTTP ${response.statusCode}`));
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            this.downloadProgress = Math.round((downloadedSize / totalSize) * 100);
            this.emit('download-progress', {
              percent: this.downloadProgress,
              downloaded: downloadedSize,
              total: totalSize,
              status: 'downloading'
            });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (error) => {
        file.close();
        fs.unlink(destPath).catch(() => {});
        reject(error);
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        fs.unlink(destPath).catch(() => {});
        reject(new Error('下载超时（5分钟）- 请检查网络连接或代理设置'));
      });
    });
  }

  /**
   * 解压 ZIP 文件
   * @private
   */
  async _extractZip(zipPath, destDir) {
    // 创建目标目录（如果不存在）
    await fs.mkdir(destDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    
    return new Promise((resolve, reject) => {
      try {
        // extractAllTo 的第二个参数表示是否覆盖存在的文件
        zip.extractAllTo(destDir, true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 卸载 MCP Server
   */
  async uninstall() {
    try {
      // 使用简单的同步删除，避免阻塞
      const { rmSync } = require('fs');
      try {
        rmSync(this.mcpDir, { recursive: true, force: true });
      } catch (error) {
        // 如果同步删除失败，尝试异步删除
        await fs.rm(this.mcpDir, { recursive: true, force: true });
      }
      this.emit('uninstall-complete');
      return { success: true };
    } catch (error) {
      this.emit('uninstall-error', error);
      throw error;
    }
  }

  /**
   * 清理临时文件
   */
  async cleanTempFiles() {
    const userDataDir = app.getPath('userData');
    const tempZipPath = path.join(userDataDir, 'mcp-server-temp.zip');
    try {
      await fs.unlink(tempZipPath);
      console.log('[MCPDownloader] 临时文件已清理');
    } catch (error) {
      // 文件可能不存在，忽略错误
      console.log('[MCPDownloader] 无需清理临时文件');
    }
  }

  /**
   * 重置下载状态（用于处理卡住的情况）
   */
  resetDownloadState() {
    console.log('[MCPDownloader] 重置下载状态');
    this.isDownloading = false;
    this.downloadProgress = 0;
  }

  /**
   * 获取安装信息
   */
  async getInstallInfo() {
    const installed = await this.isInstalled();
    
    if (!installed) {
      return {
        installed: false,
        version: null,
        size: null,
        path: null
      };
    }

    try {
      // 读取 package.json 获取版本
      const packagePath = path.join(this.mcpDir, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
      
      // 计算目录大小
      const size = await this._getDirectorySize(this.mcpDir);

      return {
        installed: true,
        version: packageJson.version,
        size: size,
        path: this.mcpDir
      };
    } catch (error) {
      return {
        installed: true,
        version: 'unknown',
        size: null,
        path: this.mcpDir
      };
    }
  }

  /**
   * 计算目录大小
   * @private
   */
  async _getDirectorySize(dirPath) {
    let totalSize = 0;

    async function traverse(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
    }

    await traverse(dirPath);
    return totalSize;
  }

  /**
   * 显示下载对话框（已废弃 - 由前端 MCPSettings 组件处理）
   * @deprecated 此方法已不再使用，确认对话框由前端组件显示
   */
  async showDownloadDialog(mainWindow) {
    // 前端组件会在安装前显示确认对话框
    // 这里直接返回 true，不再使用 Electron 原生对话框
    return true;
  }

  /**
   * 显示下载进度对话框
   */
  showProgressDialog(mainWindow) {
    // 创建一个简单的进度窗口或使用通知
    // 这里简化处理，实际可以创建专门的进度窗口
    let lastNotifiedProgress = 0;

    this.on('download-progress', (progress) => {
      if (progress - lastNotifiedProgress >= 10) {
        console.log(`[MCP Download] 下载进度: ${progress}%`);
        lastNotifiedProgress = progress;
      }
    });

    this.on('download-complete', () => {
      console.log('[MCP Download] 下载完成，正在解压...');
    });

    this.on('extract-complete', () => {
      console.log('[MCP Download] 解压完成');
    });

    this.on('install-complete', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'MCP Server 安装完成',
          message: 'MCP Server 已成功安装',
          detail: '现在可以在设置中启用 MCP 功能了',
          buttons: ['确定']
        });
      }
    });

    this.on('install-error', (error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'MCP Server 安装失败',
          message: '安装过程中出现错误',
          detail: error.message,
          buttons: ['确定']
        });
      }
    });
  }
}

module.exports = MCPDownloader;
