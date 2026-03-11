const BaseExporter = require('./BaseExporter');
const path = require('path');
const fs = require('fs').promises;

// 获取用户数据路径
const getUserDataPath = () => {
  let app = null;
  try {
    app = require('electron').app;
  } catch (e) {
    // Standalone mode
  }
  
  if (app) return app.getPath('userData');
  
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || homeDir, 'Flota');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  } else {
    return path.join(homeDir, '.config', 'Flota');
  }
}

/**
 * Obsidian 导出器
 * 导出笔记为 Obsidian 兼容的 Markdown 格式
 * 特性：
 * - 生成 YAML Front-matter
 * - 转换链接为 WikiLinks
 * - 导出附件到指定文件夹
 * - 保持文件夹结构（基于分类）
 * - 支持标签和元数据
 */
class ObsidianExporter extends BaseExporter {
  constructor(noteService, imageStorageService) {
    super(noteService, imageStorageService);
    
    // Obsidian 导出配置
    this.config = {
      // 附件文件夹名称
      attachmentFolder: 'attachments',
      // 是否使用 Front-matter
      useFrontMatter: true,
      // 是否转换为 WikiLinks
      useWikiLinks: true,
      // 是否按分类创建文件夹
      useCategories: true,
      // 是否导出图片附件
      exportImages: true,
      // 是否导出白板笔记（导出为PNG）
      exportWhiteboards: true,
      // 日期格式
      dateFormat: 'YYYY-MM-DD HH:mm:ss'
    };
    
    // 用于记录已使用的文件名，避免重复
    this.usedFileNames = new Set();
  }

  /**
   * 导出笔记到 Obsidian vault
   * @param {object} options - 导出选项
   * @returns {Promise<object>} 导出结果
   */
  async export(options) {
    const {
      exportPath,
      filters = {},
      config = {}
    } = options;

    // 合并配置
    this.config = { ...this.config, ...config };
    this.resetStats();
    this.usedFileNames.clear(); // 清空已使用的文件名

    try {
      // 获取要导出的笔记
      const notes = await this.getNotes(filters);
      this.stats.totalNotes = notes.length;
      
      this.emit('export-started', { 
        totalNotes: notes.length, 
        exportPath 
      });

      // 创建导出根目录
      await this.createExportDirectory(exportPath);

      // 创建附件目录
      const attachmentPath = path.join(exportPath, this.config.attachmentFolder);
      if (this.config.exportImages) {
        await this.createExportDirectory(attachmentPath);
      }

      // 导出每个笔记
      const results = [];
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        this.emit('note-processing', {
          noteId: note.id,
          title: note.title,
          current: i + 1,
          total: notes.length
        });

        try {
          const result = await this.exportNote(note, exportPath, attachmentPath);
          results.push(result);
          this.stats.successCount++;
        } catch (error) {
          this.stats.errorCount++;
          this.addError(`导出笔记失败: ${note.title}`, error.message);
          results.push({
            noteId: note.id,
            title: note.title,
            success: false,
            error: error.message
          });
        }
      }

      // 创建 .obsidian 配置文件夹（可选）
      await this.createObsidianConfig(exportPath);

      this.emit('export-completed', this.stats);

      return {
        success: true,
        data: {
          ...this.stats,
          exportPath,
          results
        }
      };
    } catch (error) {
      this.emit('export-error', { error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 导出单个笔记
   * @param {object} note - 笔记数据
   * @param {string} exportPath - 导出根路径
   * @param {string} attachmentPath - 附件路径
   * @returns {Promise<object>} 导出结果
   */
  async exportNote(note, exportPath, attachmentPath) {
    try {
      // 如果是白板笔记且启用了白板导出
      if (note.note_type === 'whiteboard' && this.config.exportWhiteboards) {
        return await this.exportWhiteboardNote(note, exportPath, attachmentPath);
      }
      
      // 确定笔记的保存路径
      const notePath = this.getNoteExportPath(note, exportPath);
      
      // 处理笔记内容
      let content = note.content || '';
      
      // 处理图片引用
      if (this.config.exportImages) {
        content = await this.processImages(content, note.id, attachmentPath);
      }
      
      // 转换链接为 WikiLinks
      if (this.config.useWikiLinks) {
        content = this.convertToWikiLinks(content);
      }
      
      // 生成 Front-matter
      const frontMatter = this.generateFrontMatter(note);
      
      // 组合最终内容
      let finalContent = '';
      if (this.config.useFrontMatter && frontMatter) {
        finalContent = `---\n${frontMatter}\n---\n\n`;
      }
      finalContent += content;
      
      // 写入文件
      await this.writeFile(notePath, finalContent);
      
      return {
        noteId: note.id,
        title: note.title,
        filePath: notePath,
        success: true
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 导出白板笔记为Excalidraw文件+Markdown
   */
  async exportWhiteboardNote(note, exportPath, attachmentPath) {
    try {
      // 解析白板内容
      let whiteboardData;
      try {
        whiteboardData = JSON.parse(note.content || '{}');
      } catch {
        throw new Error('无效的白板数据');
      }
      
      const { elements = [] } = whiteboardData;
      
      if (elements.length === 0) {
        this.addWarning(`白板笔记为空: ${note.title}`, '跳过导出');
        return { noteId: note.id, title: note.title, success: false, skipped: true };
      }
      
      // 保存为 .excalidraw 文件
      const excalidrawFileName = `${this.sanitizeFileName(note.title || `whiteboard-${note.id}`)}.excalidraw`;
      const excalidrawPath = path.join(attachmentPath, excalidrawFileName);
      
      // Excalidraw 格式
      const excalidrawContent = {
        type: 'excalidraw',
        version: 2,
        source: 'Flota',
        elements: whiteboardData.elements || [],
        appState: whiteboardData.appState || {},
        files: whiteboardData.files || {}
      };
      
      await this.writeFile(excalidrawPath, JSON.stringify(excalidrawContent, null, 2));
      
      // 创建Markdown文件，引用 .excalidraw 文件
      const notePath = this.getNoteExportPath(note, exportPath);
      
      let content = '';
      
      // 生成 Front-matter
      if (this.config.useFrontMatter) {
        const frontMatter = this.generateFrontMatter(note);
        if (frontMatter) {
          content = `---\n${frontMatter}\n---\n\n`;
        }
      }
      
      // 添加说明和链接
      content += `# ${note.title}\n\n`;
      content += `这是一个白板笔记，已导出为 Excalidraw 文件。\n\n`;
      
      // 添加文件引用
      const relativePath = path.join(this.config.attachmentFolder, excalidrawFileName);
      if (this.config.useWikiLinks) {
        content += `白板文件: [[${excalidrawFileName}]]\n\n`;
      } else {
        content += `白板文件: [${excalidrawFileName}](${relativePath})\n\n`;
      }
      
      // 如果有备注，添加到内容
      if (note.description) {
        content += `## 备注\n\n${note.description}\n`;
      }
      
      // 添加使用说明
      content += `\n---\n\n`;
      content += `> **使用说明**: 可以在 [Excalidraw.com](https://excalidraw.com) 或 Obsidian 的 Excalidraw 插件中打开此文件。\n`;
      
      await this.writeFile(notePath, content);
      
      return {
        noteId: note.id,
        title: note.title,
        filePath: notePath,
        excalidrawPath,
        success: true
      };
    } catch (error) {
      this.addError(`导出白板笔记失败: ${note.title}`, error.message);
      throw error;
    }
  }

  /**
   * 获取笔记的导出路径
   * @param {object} note - 笔记数据
   * @param {string} exportPath - 导出根路径
   * @returns {string} 笔记文件路径
   */
  getNoteExportPath(note, exportPath) {
    let baseFileName = this.sanitizeFileName(note.title || `note-${note.id}`);
    
    // 确定目录路径
    let dirPath = exportPath;
    if (this.config.useCategories && note.category && note.category !== 'default') {
      dirPath = path.join(exportPath, this.sanitizeFileName(note.category));
    }
    
    // 处理文件名冲突，添加序号
    let fileName = baseFileName;
    let counter = 1;
    let fullPath = path.join(dirPath, `${fileName}.md`);
    
    while (this.usedFileNames.has(fullPath)) {
      fileName = `${baseFileName}-${counter}`;
      fullPath = path.join(dirPath, `${fileName}.md`);
      counter++;
    }
    
    // 记录使用的文件名
    this.usedFileNames.add(fullPath);
    
    return fullPath;
  }

  /**
   * 生成 YAML Front-matter
   * @param {object} note - 笔记数据
   * @returns {string} Front-matter 内容
   */
  generateFrontMatter(note) {
    const fm = {};
    
    // 基本信息
    if (note.title) {
      fm.title = note.title;
    }
    
    // 日期
    if (note.created_at) {
      fm.created = this.formatDate(note.created_at);
    }
    if (note.updated_at) {
      fm.updated = this.formatDate(note.updated_at);
    }
    
    // 标签
    if (note.tags) {
      const tags = note.tags.split(',').map(t => t.trim()).filter(t => t);
      if (tags.length > 0) {
        fm.tags = tags;
      }
    }
    
    // 分类
    if (note.category && note.category !== 'default') {
      fm.category = note.category;
    }
    
    // 笔记类型
    if (note.note_type) {
      fm.type = note.note_type;
    }
    
    // 自定义元数据（如果有）
    if (note.metadata) {
      try {
        const metadata = typeof note.metadata === 'string' 
          ? JSON.parse(note.metadata) 
          : note.metadata;
        
        // 添加非系统字段
        for (const [key, value] of Object.entries(metadata)) {
          if (!['source', 'originalPath', 'frontMatter', 'imageReferences'].includes(key)) {
            fm[key] = value;
          }
        }
      } catch {
        // 忽略元数据解析错误
      }
    }
    
    // 转换为 YAML
    return this.objectToYaml(fm);
  }

  /**
   * 将对象转换为 YAML 格式
   * @param {object} obj - 对象
   * @returns {string} YAML 字符串
   */
  objectToYaml(obj) {
    const lines = [];
    
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        continue;
      }
      
      if (Array.isArray(value)) {
        // 数组格式
        if (value.length === 0) {
          lines.push(`${key}: []`);
        } else {
          lines.push(`${key}:`);
          value.forEach(item => {
            lines.push(`  - ${this.escapeYamlValue(item)}`);
          });
        }
      } else if (typeof value === 'object') {
        // 嵌套对象（简单处理）
        lines.push(`${key}:`);
        for (const [subKey, subValue] of Object.entries(value)) {
          lines.push(`  ${subKey}: ${this.escapeYamlValue(subValue)}`);
        }
      } else {
        // 普通值
        lines.push(`${key}: ${this.escapeYamlValue(value)}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * 转义 YAML 值
   * @param {*} value - 值
   * @returns {string} 转义后的值
   */
  escapeYamlValue(value) {
    if (typeof value === 'string') {
      // 如果包含特殊字符，用引号包裹
      if (value.includes(':') || value.includes('#') || value.includes('\n')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    return String(value);
  }

  /**
   * 处理图片（导出到附件文件夹并更新引用）
   * @param {string} content - 笔记内容
   * @param {string} noteId - 笔记ID
   * @param {string} attachmentPath - 附件路径
   * @returns {Promise<string>} 处理后的内容
   */
  async processImages(content, noteId, attachmentPath) {
    // 提取所有图片引用
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    const replacements = [];
    
    while ((match = imageRegex.exec(content)) !== null) {
      const [fullMatch, alt, imagePath] = match;
      
      try {
        // 检查是否是本地图片路径（不是 URL）
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
          continue; // 跳过外部链接
        }
        
        // 尝试复制图片到附件文件夹
        const newImagePath = await this.exportImage(imagePath, attachmentPath, noteId);
        
        if (newImagePath) {
          // 使用相对于 attachmentPath 的路径
          const fileName = path.basename(newImagePath);
          const relativePath = path.join(this.config.attachmentFolder, fileName);
          
          // 根据配置决定使用 WikiLink 还是标准 Markdown
          let newReference;
          if (this.config.useWikiLinks) {
            newReference = `![[${fileName}]]`;
          } else {
            newReference = `![${alt}](${relativePath})`;
          }
          
          replacements.push({ old: fullMatch, new: newReference });
        }
      } catch (error) {
        this.addWarning(`处理图片失败: ${imagePath}`, error.message);
      }
    }
    
    // 应用所有替换
    let processedContent = content;
    for (const { old, new: newRef } of replacements) {
      processedContent = processedContent.replace(old, newRef);
    }
    
    return processedContent;
  }

  /**
   * 导出图片到附件文件夹
   * @param {string} imagePath - 图片路径（可能是相对路径、绝对路径或文件名）
   * @param {string} attachmentPath - 附件文件夹路径
   * @param {string} noteId - 笔记ID
   * @returns {Promise<string|null>} 新图片路径
   */
  async exportImage(imagePath, attachmentPath, noteId) {
    try {
      const fs = require('fs');
      const { app } = require('electron');
      
      // 如果是绝对路径且存在，直接复制
      if (path.isAbsolute(imagePath) && fs.existsSync(imagePath)) {
        const fileName = path.basename(imagePath);
        const destPath = path.join(attachmentPath, fileName);
        await this.copyFile(imagePath, destPath);
        return destPath;
      }
      
      // 从 ImageStorageService 的存储位置查找
      const userDataPath = getUserDataPath();
      const possiblePaths = [
        // 1. 直接是文件名，在 images 目录下
        path.join(userDataPath, 'images', imagePath),
        // 2. 在 whiteboard 子目录下
        path.join(userDataPath, 'images', 'whiteboard', imagePath),
        // 3. 相对于 userData 的路径
        path.join(userDataPath, imagePath),
        // 4. 原始路径（可能已经是完整路径）
        imagePath
      ];
      
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          const fileName = path.basename(possiblePath);
          const destPath = path.join(attachmentPath, fileName);
          await this.copyFile(possiblePath, destPath);
          return destPath;
        }
      }
      
      this.addWarning(`找不到图片文件: ${imagePath}`, '跳过导出');
      return null;
    } catch (error) {
      this.addWarning(`导出图片失败: ${imagePath}`, error.message);
      return null;
    }
  }

  /**
   * 转换标准 Markdown 链接为 WikiLinks
   * @param {string} content - 内容
   * @returns {string} 转换后的内容
   */
  convertToWikiLinks(content) {
    // 将 [text](link) 转换为 [[link|text]]
    // 但保持图片链接不变（已经在 processImages 中处理）
    return content.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, text, link) => {
      // 跳过 URL 链接
      if (link.startsWith('http://') || link.startsWith('https://')) {
        return match;
      }
      
      // 如果链接和文本相同，使用简单格式
      if (text === link) {
        return `[[${link}]]`;
      }
      
      // 使用显示文本格式
      return `[[${link}|${text}]]`;
    });
  }

  /**
   * 格式化日期
   * @param {string|Date} date - 日期
   * @returns {string} 格式化后的日期
   */
  formatDate(date) {
    try {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } catch {
      return String(date);
    }
  }

  /**
   * 创建 Obsidian 配置文件夹
   * @param {string} exportPath - 导出路径
   */
  async createObsidianConfig(exportPath) {
    try {
      const obsidianPath = path.join(exportPath, '.obsidian');
      await this.createExportDirectory(obsidianPath);
      
      // 创建基本配置文件
      const config = {
        vaultName: 'Flota Export',
        theme: 'moonstone',
        attachmentFolderPath: this.config.attachmentFolder
      };
      
      const configPath = path.join(obsidianPath, 'config.json');
      await this.writeFile(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      // 配置文件创建失败不影响导出
      this.addWarning('创建 Obsidian 配置', error.message);
    }
  }

  /**
   * 获取导出器名称
   */
  getName() {
    return 'Obsidian Exporter';
  }

  /**
   * 获取导出器描述
   */
  getDescription() {
    return 'Export notes to Obsidian-compatible Markdown format with Front-matter and WikiLinks';
  }

  /**
   * 获取支持的格式
   */
  getSupportedFormat() {
    return 'obsidian-markdown';
  }

  /**
   * 更新配置
   * @param {object} newConfig - 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }
}

module.exports = ObsidianExporter;
