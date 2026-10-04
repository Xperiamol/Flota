/**
 * 图片清理服务
 *
 * 扫描并清理未被引用的图片文件
 */

const fs = require('fs');
const path = require('path');
const DatabaseManager = require('../dao/DatabaseManager');
const { collectReferencedImageNames, isImageReferenced } = require('./imageReferences');

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

class ImageCleanupService {
  constructor() {
    this.db = null;
    this.imagesDir = path.join(getUserDataPath(), 'images');
    this.whiteboardDir = path.join(this.imagesDir, 'whiteboard');
  }

  /**
   * 初始化服务
   */
  initialize() {
    const dbManager = DatabaseManager.getInstance();
    this.db = dbManager.getDatabase();
  }

  /**
   * 获取所有本地图片文件
   * @private
   */
  getAllLocalImages() {
    const images = [];

    // 扫描 images/ 目录（排除 whiteboard 子目录）
    if (fs.existsSync(this.imagesDir)) {
      const files = fs.readdirSync(this.imagesDir);
      for (const file of files) {
        const fullPath = path.join(this.imagesDir, file);
        const stat = fs.statSync(fullPath);

        // 跳过目录
        if (stat.isDirectory()) continue;

        // 只处理图片文件
        if (this.isImageFile(file)) {
          images.push({
            name: file,
            path: fullPath,
            relativePath: `images/${file}`,
            size: stat.size,
            mtime: stat.mtimeMs,
            directory: 'images'
          });
        }
      }
    }

    // 扫描 images/whiteboard/ 目录
    if (fs.existsSync(this.whiteboardDir)) {
      const files = fs.readdirSync(this.whiteboardDir);
      for (const file of files) {
        const fullPath = path.join(this.whiteboardDir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isFile() && this.isImageFile(file)) {
          images.push({
            name: file,
            path: fullPath,
            relativePath: `images/whiteboard/${file}`,
            size: stat.size,
            mtime: stat.mtimeMs,
            directory: 'whiteboard'
          });
        }
      }
    }

    return images;
  }

  /**
   * 判断是否为图片文件
   * @private
   */
  isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext);
  }

  /**
   * 获取所有被引用的图片
   * @private
   */
  getReferencedImages() {
    if (!this.db) {
      this.initialize();
    }
    // 含回收站里的笔记；按文件名在正文里查找，不依赖图片语法（见 imageReferences.js）
    const notes = this.db.prepare('SELECT content FROM notes').all();
    return collectReferencedImageNames(notes.map((note) => note.content));
  }

  /**
   * 扫描未使用的图片
   * @param {number} retentionDays - 保留天数（只清理超过此天数且未被引用的图片）
   * @returns {Promise<{unusedCount: number, totalSize: number, totalSizeMB: number, files: Array}>}
   */
  async scanUnusedImages(retentionDays = 30) {
    console.log(`[ImageCleanup] 开始扫描未使用的图片，保留天数: ${retentionDays}`);

    // 1. 获取所有本地图片
    const allImages = this.getAllLocalImages();
    console.log(`[ImageCleanup] 本地图片总数: ${allImages.length}`);

    // 2. 获取所有被引用的图片
    const referencedImages = this.getReferencedImages();

    // 3. 计算未引用的图片
    const now = Date.now();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    const unusedImages = allImages.filter(img => {
      // 检查是否被引用
      if (isImageReferenced(img.name, referencedImages)) {
        return false;
      }

      // 检查文件修改时间（保留期内的不清理）
      if (retentionDays > 0) {
        const age = now - img.mtime;
        if (age < retentionMs) {
          return false;
        }
      }

      return true;
    });

    const totalSize = unusedImages.reduce((sum, img) => sum + img.size, 0);
    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    console.log(`[ImageCleanup] 未使用图片: ${unusedImages.length} 个，总大小: ${totalSizeMB} MB`);

    return {
      unusedCount: unusedImages.length,
      totalSize,
      totalSizeMB: parseFloat(totalSizeMB),
      files: unusedImages
    };
  }

  /**
   * 清理未使用的图片
   * @param {Array} files - 要删除的文件列表（由 scanUnusedImages 返回）
   * @returns {Promise<{deletedCount: number, failedCount: number, totalSize: number, totalSizeMB: number}>}
   */
  async cleanupImages(files) {
    console.log(`[ImageCleanup] 开始清理 ${files.length} 个图片文件`);

    let deletedCount = 0;
    let failedCount = 0;
    let totalSize = 0;

    for (const file of files) {
      try {
        // 删除本地文件
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          deletedCount++;
          totalSize += file.size;
          console.log(`[ImageCleanup] 已删除: ${file.relativePath}`);
        }
      } catch (error) {
        console.error(`[ImageCleanup] 删除失败: ${file.relativePath}`, error);
        failedCount++;
      }
    }

    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    console.log(`[ImageCleanup] 清理完成，成功: ${deletedCount}，失败: ${failedCount}，释放空间: ${totalSizeMB} MB`);

    return {
      deletedCount,
      failedCount,
      totalSize,  // 返回字节数
      totalSizeMB: parseFloat(totalSizeMB)
    };
  }
}

module.exports = ImageCleanupService;
