const BaseProcessor = require('./BaseProcessor');
const fs = require('fs').promises;
const path = require('path');

class BaseImporter extends BaseProcessor {
  async import(options) {
    throw new Error('子类必须实现 import 方法');
  }

  isSupportedFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ['.md', '.markdown', '.txt'].includes(ext);
  }

  async parseFile(content, filePath) {
    throw new Error('子类必须实现 parseFile 方法');
  }

  async importFolder(folderPath, options = {}) {
    const { recursive = true, filter = null } = options;
    const files = await this.scanFolder(folderPath, recursive, filter);
    
    this.stats.totalFiles = files.length;
    this.emit('import-started', { totalFiles: files.length });

    const results = [];
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      this.emit('file-processing', { filePath, current: i + 1, total: files.length });

      try {
        const content = await this.readFile(filePath);
        const noteData = await this.parseFile(content, filePath);
        
        if (noteData) {
          await this.saveNote(noteData);
          results.push({ filePath, success: true });
          this.stats.successCount++;
        } else {
          this.stats.skippedCount++;
          this.addWarning(filePath, '文件被跳过');
        }
      } catch (error) {
        this.stats.errorCount++;
        this.addError(filePath, error.message);
        results.push({ filePath, success: false, error: error.message });
      }
    }

    this.emit('import-completed', this.stats);
    return { success: true, data: { ...this.stats, results } };
  }

  async scanFolder(folderPath, recursive = true, filter = null) {
    const files = [];
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      
      const fullPath = path.join(folderPath, entry.name);
      
      if (entry.isDirectory() && recursive) {
        files.push(...await this.scanFolder(fullPath, recursive, filter));
      } else if (entry.isFile() && this.isSupportedFile(fullPath)) {
        if (!filter || filter(fullPath)) files.push(fullPath);
      }
    }
    
    return files;
  }

  async saveNote(noteData) {
    return this.noteService.createNote(noteData);
  }

  async processImage(imagePath, sourceFolder) {
    try {
      if (!this.imageStorageService) {
        this.addWarning('processImage', '图片存储服务不可用');
        return null;
      }

      const fullImagePath = path.isAbsolute(imagePath) 
        ? imagePath 
        : path.join(sourceFolder, imagePath);
      
      const exists = await fs.access(fullImagePath).then(() => true).catch(() => false);
      if (!exists) {
        this.addWarning('processImage', `图片不存在: ${fullImagePath}`);
        return null;
      }

      // ImageService 把图片存进应用的 images/ 目录，返回可直接写进 Markdown 的相对路径
      return await this.imageStorageService.saveImageFromPath(fullImagePath, path.basename(fullImagePath));
    } catch (error) {
      this.addError(`处理图片失败: ${imagePath}`, error.message);
      return null;
    }
  }

  getName() { return 'Base Importer'; }
  getDescription() { return '通用导入器基类'; }
  getSupportedExtensions() { return ['.md', '.markdown', '.txt']; }
}

module.exports = BaseImporter;
