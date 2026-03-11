const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// 尝试加载 Electron，如果失败则使用 null（独立运行模式）
let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {
  // 独立运行模式（如 MCP Server），不依赖 Electron
}

// 获取用户数据目录
const getUserDataPath = () => {
  if (app) {
    return app.getPath('userData');
  }
  // 独立运行模式：使用标准路径
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || homeDir, 'Flota');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  } else {
    return path.join(homeDir, '.config', 'Flota');
  }
};

/**
 * 图片存储服务
 * 用于管理白板和笔记中的图片文件
 * 将base64图片数据存储到文件系统，而非数据库
 */
class ImageStorageService {
  constructor() {
    // 图片存储目录
    this.storageDir = path.join(getUserDataPath(), 'images');
    this.whiteboardDir = path.join(this.storageDir, 'whiteboard');
    this.initialized = false;
  }

  /**
   * 初始化存储目录
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 创建存储目录
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(this.whiteboardDir, { recursive: true });
      
      console.log('图片存储服务初始化成功');
      console.log('- 存储目录:', this.storageDir);
      console.log('- 白板图片:', this.whiteboardDir);
      
      this.initialized = true;
    } catch (error) {
      console.error('初始化图片存储目录失败:', error);
      throw error;
    }
  }

  /**
   * 生成图片文件名（基于内容哈希）
   * @param {string} base64Data - base64编码的图片数据
   * @returns {string} 文件名
   */
  generateFileName(base64Data) {
    // 从base64中提取实际数据部分
    const base64Content = base64Data.split(',')[1] || base64Data;
    
    // 使用MD5生成哈希
    const hash = crypto.createHash('md5').update(base64Content).digest('hex');
    
    // 从base64头部提取文件扩展名
    const mimeMatch = base64Data.match(/^data:image\/(\w+);base64,/);
    const ext = mimeMatch ? mimeMatch[1] : 'png';
    
    return `${hash}.${ext}`;
  }

  /**
   * 保存白板图片
   * @param {string} fileId - Excalidraw的文件ID
   * @param {string} base64Data - base64编码的图片数据
   * @returns {Promise<string>} 返回图片文件路径
   */
  async saveWhiteboardImage(fileId, base64Data) {
    await this.initialize();

    try {
      // 生成文件名
      const fileName = this.generateFileName(base64Data);
      const filePath = path.join(this.whiteboardDir, fileName);

      // 检查文件是否已存在（去重）
      try {
        await fs.access(filePath);
        console.log(`图片已存在，跳过保存: ${fileName}`);
        return fileName; // 返回相对路径
      } catch (error) {
        // 文件不存在，继续保存
      }

      // 从base64中提取数据
      const base64Content = base64Data.split(',')[1] || base64Data;
      const buffer = Buffer.from(base64Content, 'base64');

      // 保存到文件系统
      await fs.writeFile(filePath, buffer);
      
      console.log(`白板图片已保存: ${fileName} (${(buffer.length / 1024).toFixed(2)} KB)`);
      
      return fileName; // 返回相对路径
    } catch (error) {
      console.error('保存白板图片失败:', error);
      throw error;
    }
  }

  /**
   * 批量保存白板图片
   * @param {Object} files - Excalidraw的files对象
   * @returns {Promise<Object>} 返回文件ID到文件路径的映射
   */
  async saveWhiteboardImages(files) {
    await this.initialize();

    const fileMap = {};
    const promises = [];

    for (const [fileId, fileData] of Object.entries(files)) {
      if (fileData.dataURL) {
        const promise = this.saveWhiteboardImage(fileId, fileData.dataURL)
          .then(fileName => {
            fileMap[fileId] = {
              fileName,
              mimeType: fileData.mimeType,
              created: fileData.created || Date.now()
            };
          })
          .catch(error => {
            console.error(`保存图片失败 (${fileId}):`, error);
            // 继续处理其他图片
          });
        promises.push(promise);
      }
    }

    await Promise.all(promises);
    
    console.log(`批量保存完成: ${Object.keys(fileMap).length} 个图片`);
    
    return fileMap;
  }

  /**
   * 加载白板图片
   * @param {string} fileName - 图片文件名
   * @returns {Promise<string>} 返回base64编码的图片数据
   */
  async loadWhiteboardImage(fileName) {
    await this.initialize();

    try {
      const filePath = path.join(this.whiteboardDir, fileName);
      
      // 读取文件
      const buffer = await fs.readFile(filePath);
      
      // 检测MIME类型
      const ext = path.extname(fileName).slice(1).toLowerCase();
      const mimeType = this.getMimeType(ext);
      
      // 转换为base64
      const base64Data = `data:${mimeType};base64,${buffer.toString('base64')}`;
      
      return base64Data;
    } catch (error) {
      console.error('加载白板图片失败:', fileName, error);
      throw error;
    }
  }

  /**
   * 批量加载白板图片
   * @param {Object} fileMap - 文件ID到文件路径的映射
   * @returns {Promise<Object>} 返回Excalidraw的files对象
   */
  async loadWhiteboardImages(fileMap) {
    await this.initialize();

    const files = {};
    const promises = [];

    for (const [fileId, fileInfo] of Object.entries(fileMap)) {
      const promise = this.loadWhiteboardImage(fileInfo.fileName)
        .then(base64Data => {
          files[fileId] = {
            mimeType: fileInfo.mimeType || this.getMimeType(path.extname(fileInfo.fileName).slice(1)),
            id: fileId,
            dataURL: base64Data,
            created: fileInfo.created || Date.now()
          };
        })
        .catch(error => {
          console.error(`加载图片失败 (${fileId}):`, error);
          // 继续处理其他图片
        });
      promises.push(promise);
    }

    await Promise.all(promises);
    
    console.log(`批量加载完成: ${Object.keys(files).length} 个图片`);
    
    return files;
  }

  /**
   * 删除白板图片
   * @param {string} fileName - 图片文件名
   */
  async deleteWhiteboardImage(fileName) {
    await this.initialize();

    try {
      const filePath = path.join(this.whiteboardDir, fileName);
      await fs.unlink(filePath);
      console.log(`图片已删除: ${fileName}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('删除图片失败:', fileName, error);
      }
    }
  }

  /**
   * 批量删除白板图片
   * @param {Object} fileMap - 文件ID到文件路径的映射
   */
  async deleteWhiteboardImages(fileMap) {
    await this.initialize();

    const promises = [];
    
    for (const fileInfo of Object.values(fileMap)) {
      promises.push(this.deleteWhiteboardImage(fileInfo.fileName));
    }

    await Promise.all(promises);
    console.log(`批量删除完成: ${promises.length} 个图片`);
  }

  /**
   * 清理未使用的图片（垃圾回收）
   * @param {Array<string>} usedFileNames - 正在使用的文件名列表
   */
  async cleanupUnusedImages(usedFileNames = []) {
    await this.initialize();

    try {
      const files = await fs.readdir(this.whiteboardDir);
      const usedSet = new Set(usedFileNames);
      
      let deletedCount = 0;
      
      for (const file of files) {
        if (!usedSet.has(file)) {
          await this.deleteWhiteboardImage(file);
          deletedCount++;
        }
      }
      
      console.log(`清理完成: 删除 ${deletedCount} 个未使用的图片`);
      
      return deletedCount;
    } catch (error) {
      console.error('清理未使用图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取存储统计信息
   */
  async getStorageStats() {
    await this.initialize();

    try {
      const files = await fs.readdir(this.whiteboardDir);
      let totalSize = 0;
      
      for (const file of files) {
        const filePath = path.join(this.whiteboardDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }
      
      return {
        totalFiles: files.length,
        totalSize, // bytes
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        storageDir: this.storageDir,
        whiteboardDir: this.whiteboardDir
      };
    } catch (error) {
      console.error('获取存储统计失败:', error);
      throw error;
    }
  }

  /**
   * 根据扩展名获取MIME类型
   */
  getMimeType(ext) {
    const mimeTypes = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };
    
    return mimeTypes[ext.toLowerCase()] || 'image/png';
  }
}

// 单例模式
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new ImageStorageService();
  }
  return instance;
}

module.exports = {
  ImageStorageService,
  getInstance
};
