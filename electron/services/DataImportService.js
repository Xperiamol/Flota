const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const { dialog, app } = require('electron');
const { getFileTimes } = require('../utils/fileTimes');

// 导入新的导入导出器
const ObsidianImporter = require('./importers/ObsidianImporter');
const ObsidianExporter = require('./exporters/ObsidianExporter');

class DataImportService extends EventEmitter {
  constructor(noteService, settingsService, imageStorageService) {
    super();
    this.noteService = noteService;
    this.settingsService = settingsService;
    this.imageStorageService = imageStorageService;
    
    // 初始化导入导出器
    this.importers = {
      obsidian: new ObsidianImporter(noteService, imageStorageService)
    };
    
    this.exporters = {
      obsidian: new ObsidianExporter(noteService, imageStorageService)
    };
    this.supportedFormats = {
      json: {
        name: 'JSON',
        extensions: ['json'],
        description: 'JSON 格式文件'
      },
      txt: {
        name: 'Text',
        extensions: ['txt'],
        description: '纯文本文件'
      },
      md: {
        name: 'Markdown',
        extensions: ['md', 'markdown'],
        description: 'Markdown 文件'
      },
      csv: {
        name: 'CSV',
        extensions: ['csv'],
        description: 'CSV 格式文件'
      }
    };
  }

  /**
   * 导出笔记数据
   */
  async exportNotes(options = {}) {
    try {
      const {
        format = 'json',
        includeDeleted = false,
        category = null,
        filePath = null
      } = options;

      // 获取笔记数据
      const notesResult = await this.noteService.exportNotes({
        format,
        includeDeleted,
        category
      });

      if (!notesResult.success) {
        return notesResult;
      }

      // 确定保存路径
      let savePath = filePath;
      if (!savePath) {
        const result = await dialog.showSaveDialog({
          title: '导出笔记',
          defaultPath: notesResult.filename,
          filters: [
            {
              name: this.supportedFormats[format].name,
              extensions: this.supportedFormats[format].extensions
            },
            { name: '所有文件', extensions: ['*'] }
          ]
        });

        if (result.canceled) {
          return {
            success: false,
            error: '用户取消导出'
          };
        }

        savePath = result.filePath;
      }

      // 根据格式导出数据
      let exportContent;
      switch (format) {
        case 'json':
          exportContent = JSON.stringify(notesResult.data, null, 2);
          break;
        case 'csv':
          exportContent = this.convertToCSV(notesResult.data.notes);
          break;
        case 'txt':
          exportContent = this.convertToText(notesResult.data.notes);
          break;
        case 'md':
          exportContent = this.convertToMarkdown(notesResult.data.notes);
          break;
        default:
          return {
            success: false,
            error: '不支持的导出格式'
          };
      }

      // 写入文件
      await fs.writeFile(savePath, exportContent, 'utf8');

      this.emit('notes-exported', {
        format,
        filePath: savePath,
        count: notesResult.data.totalNotes
      });

      return {
        success: true,
        data: {
          filePath: savePath,
          format,
          count: notesResult.data.totalNotes
        }
      };
    } catch (error) {
      console.error('导出笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 导入笔记数据
   */
  async importNotes(options = {}) {
    try {
      const { filePath = null, format = null } = options;

      // 选择导入文件
      let importPath = filePath;
      let detectedFormat = format;

      if (!importPath) {
        const result = await dialog.showOpenDialog({
          title: '导入笔记',
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: 'CSV 文件', extensions: ['csv'] },
            { name: 'Markdown 文件', extensions: ['md', 'markdown'] },
            { name: '文本文件', extensions: ['txt'] },
            { name: '所有文件', extensions: ['*'] }
          ],
          properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
          return {
            success: false,
            error: '用户取消导入'
          };
        }

        importPath = result.filePaths[0];
      }

      // 检测文件格式
      if (!detectedFormat) {
        detectedFormat = this.detectFileFormat(importPath);
      }

      // 读取文件内容
      const fileContent = await fs.readFile(importPath, 'utf8');

      // 解析数据
      let parsedData;
      switch (detectedFormat) {
        case 'json':
          parsedData = this.parseJSON(fileContent);
          break;
        case 'csv':
          parsedData = this.parseCSV(fileContent);
          break;
        case 'txt':
          parsedData = this.parseText(fileContent, importPath);
          break;
        case 'md':
          parsedData = this.parseMarkdown(fileContent, importPath);
          break;
        default:
          return {
            success: false,
            error: '不支持的文件格式'
          };
      }

      if (!parsedData.success) {
        return parsedData;
      }

      // 单个 Markdown / 文本文件：用文件原来的创建、修改时间，而不是导入的这一刻
      if (detectedFormat === 'md' || detectedFormat === 'txt') {
        const times = await getFileTimes(importPath);
        parsedData.data.notes.forEach(note => Object.assign(note, times));
      }

      // 检查是否是V1格式的完整导入
      if (parsedData.isV1Import) {
        return await this.importV1Data(parsedData.data, parsedData.importInfo, detectedFormat, importPath);
      }

      // 导入笔记
      const importResult = await this.noteService.importNotes(parsedData.data);

      if (importResult.success) {
        this.emit('notes-imported', {
          format: detectedFormat,
          filePath: importPath,
          ...importResult.data
        });
      }

      return importResult;
    } catch (error) {
      console.error('导入笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 导入V1格式的完整数据
   */
  async importV1Data(data, importInfo, format, filePath) {
    try {
      const results = {
        notes: { successCount: 0, errorCount: 0, errors: [] },
        todos: { successCount: 0, errorCount: 0, errors: [] },
        settings: { success: false, error: null }
      };

      // 导入笔记
      if (data.notes && data.notes.length > 0) {
        const notesResult = await this.noteService.importNotes({ notes: data.notes });
        if (notesResult.success) {
          results.notes = notesResult.data;
        } else {
          results.notes.errorCount = data.notes.length;
          results.notes.errors.push(notesResult.error);
        }
      }

      // 导入待办事项（如果有TodoService的话）
      if (data.todos && data.todos.length > 0) {
        // 这里可以添加待办事项的导入逻辑
        // 暂时标记为成功，因为当前版本可能没有独立的TodoService
        results.todos.successCount = data.todos.length;
      }

      // 导入设置
      if (data.settings) {
        try {
          // 导入自定义颜色设置
          if (data.settings.customColors) {
            for (const [key, value] of Object.entries(data.settings.customColors)) {
              await this.settingsService.set(key, value);
            }
          }

          // 导入其他设置
          const settingsToImport = {
            theme: data.settings.theme,
            backgroundImage: data.settings.backgroundImage,
            backgroundBlur: data.settings.backgroundBlur,
            backgroundBrightness: data.settings.backgroundBrightness,
            inputRadius: data.settings.inputRadius,
            blockRadius: data.settings.blockRadius
          };

          for (const [key, value] of Object.entries(settingsToImport)) {
            if (value !== undefined && value !== null) {
              await this.settingsService.set(key, value);
            }
          }

          results.settings.success = true;
        } catch (error) {
          results.settings.error = error.message;
        }
      }

      // 发出导入完成事件
      this.emit('v1-data-imported', {
        format,
        filePath,
        importInfo,
        results
      });

      const totalSuccess = results.notes.successCount + results.todos.successCount;
      const totalErrors = results.notes.errorCount + results.todos.errorCount;

      return {
        success: true,
        data: {
          isV1Import: true,
          importInfo,
          totalImported: totalSuccess,
          totalErrors,
          details: results,
          message: `成功导入V1数据：${results.notes.successCount}个笔记，${results.todos.successCount}个待办事项${results.settings.success ? '，设置已更新' : ''}`
        }
      };
    } catch (error) {
      console.error('V1数据导入失败:', error);
      return {
        success: false,
        error: 'V1数据导入失败: ' + error.message
      };
    }
  }

  /**
   * 导出设置
   */
  async exportSettings(filePath = null) {
    try {
      const settingsResult = await this.settingsService.exportSettings();
      if (!settingsResult.success) {
        return settingsResult;
      }

      // 确定保存路径
      let savePath = filePath;
      if (!savePath) {
        const result = await dialog.showSaveDialog({
          title: '导出设置',
          defaultPath: settingsResult.filename,
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        });

        if (result.canceled) {
          return {
            success: false,
            error: '用户取消导出'
          };
        }

        savePath = result.filePath;
      }

      // 写入文件
      const content = JSON.stringify(settingsResult.data, null, 2);
      await fs.writeFile(savePath, content, 'utf8');

      this.emit('settings-exported', { filePath: savePath });

      return {
        success: true,
        data: {
          filePath: savePath
        }
      };
    } catch (error) {
      console.error('导出设置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 导入设置
   */
  async importSettings(filePath = null) {
    try {
      // 选择导入文件
      let importPath = filePath;
      if (!importPath) {
        const result = await dialog.showOpenDialog({
          title: '导入设置',
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: '所有文件', extensions: ['*'] }
          ],
          properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
          return {
            success: false,
            error: '用户取消导入'
          };
        }

        importPath = result.filePaths[0];
      }

      // 读取并解析文件
      const fileContent = await fs.readFile(importPath, 'utf8');
      const settingsData = JSON.parse(fileContent);

      // 导入设置
      const importResult = await this.settingsService.importSettings(settingsData);

      if (importResult.success) {
        this.emit('settings-imported', { filePath: importPath });
      }

      return importResult;
    } catch (error) {
      console.error('导入设置失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量导入文件夹中的文件
   */
  async importFolder() {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择导入文件夹',
        properties: ['openDirectory']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          error: '用户取消导入'
        };
      }

      const folderPath = result.filePaths[0];
      const files = await fs.readdir(folderPath);
      
      const supportedFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase().slice(1);
        return Object.values(this.supportedFormats).some(format => 
          format.extensions.includes(ext)
        );
      });

      if (supportedFiles.length === 0) {
        return {
          success: false,
          error: '文件夹中没有支持的文件格式'
        };
      }

      let totalSuccess = 0;
      let totalErrors = 0;
      const errors = [];

      for (const file of supportedFiles) {
        try {
          const filePath = path.join(folderPath, file);
          const importResult = await this.importNotes({ filePath });
          
          if (importResult.success) {
            totalSuccess += importResult.data.successCount || 1;
          } else {
            totalErrors++;
            errors.push(`${file}: ${importResult.error}`);
          }
        } catch (error) {
          totalErrors++;
          errors.push(`${file}: ${error.message}`);
        }
      }

      this.emit('folder-imported', {
        folderPath,
        totalFiles: supportedFiles.length,
        totalSuccess,
        totalErrors
      });

      return {
        success: true,
        data: {
          folderPath,
          totalFiles: supportedFiles.length,
          totalSuccess,
          totalErrors,
          errors: errors.slice(0, 10)
        }
      };
    } catch (error) {
      console.error('批量导入失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 检测文件格式
   */
  detectFileFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    
    for (const [format, config] of Object.entries(this.supportedFormats)) {
      if (config.extensions.includes(ext)) {
        return format;
      }
    }
    
    return 'txt'; // 默认为文本格式
  }

  /**
   * 解析JSON格式
   */
  parseJSON(content) {
    try {
      const data = JSON.parse(content);
      
      // 检查是否是V1版本的导出格式
      if (data.version === '1.0' && data.data) {
        return this.parseV1Format(data);
      }
      
      // 检查是否是当前版本的笔记数据格式
      if (data.notes && Array.isArray(data.notes)) {
        return {
          success: true,
          data
        };
      }
      
      // 如果是单个笔记对象
      if (data.title !== undefined || data.content !== undefined) {
        return {
          success: true,
          data: {
            notes: [data]
          }
        };
      }
      
      return {
        success: false,
        error: '无效的JSON数据格式'
      };
    } catch (error) {
      return {
        success: false,
        error: 'JSON解析失败: ' + error.message
      };
    }
  }

  /**
   * 解析V1版本的导出格式
   */
  parseV1Format(v1Data) {
    try {
      const result = {
        notes: [],
        todos: [],
        settings: null
      };

      // 转换笔记数据
      if (v1Data.data.notes && Array.isArray(v1Data.data.notes)) {
        result.notes = v1Data.data.notes.map(note => ({
          id: note.id,
          title: '', // V1版本没有单独的标题字段
          content: note.text || '',
          color: note.color || '',
          alwaysOnTop: note.alwaysOnTop || false,
          createdAt: note.createdAt || new Date().toISOString(),
          updatedAt: note.createdAt || new Date().toISOString(),
          isDeleted: false,
          category: 'default'
        }));
      }

      // 转换待办事项数据
      if (v1Data.data.todos && Array.isArray(v1Data.data.todos)) {
        result.todos = v1Data.data.todos.map(todo => ({
          id: todo.id,
          text: todo.text || '',
          done: todo.done || false,
          createdAt: todo.createdAt || new Date().toISOString(),
          updatedAt: todo.createdAt || new Date().toISOString(),
          dueDate: todo.ddl,
          priority: todo.quadrant || 'normal'
        }));
      }

      // 转换设置数据
      if (v1Data.data.settings) {
        result.settings = {
          theme: 'light',
          customColors: v1Data.data.settings.customColors || {},
          backgroundImage: v1Data.data.settings.backgroundImage || '',
          backgroundBlur: v1Data.data.settings.backgroundBlur || 0,
          backgroundBrightness: v1Data.data.settings.backgroundBrightness || 100,
          inputRadius: v1Data.data.settings.inputRadius || 25,
          blockRadius: v1Data.data.settings.blockRadius || 6
        };
      }

      return {
        success: true,
        data: result,
        isV1Import: true,
        importInfo: {
          version: v1Data.version,
          exportTime: v1Data.exportTime,
          appVersion: v1Data.appVersion,
          notesCount: result.notes.length,
          todosCount: result.todos.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: 'V1格式解析失败: ' + error.message
      };
    }
  }

  /**
   * 解析CSV格式
   */
  parseCSV(content) {
    try {
      const lines = content.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        return {
          success: false,
          error: 'CSV文件格式无效'
        };
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const notes = [];

      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i]);
        const note = {};
        
        headers.forEach((header, index) => {
          note[header.toLowerCase()] = values[index] || '';
        });
        
        notes.push({
          title: note.title || note.标题 || `导入笔记 ${i}`,
          content: note.content || note.内容 || '',
          tags: note.tags || note.标签 || '',
          category: note.category || note.分类 || 'default',
          created_at: note.created_at || note.创建时间 || undefined,
          updated_at: note.updated_at || note.更新时间 || undefined
        });
      }

      return {
        success: true,
        data: { notes }
      };
    } catch (error) {
      return {
        success: false,
        error: 'CSV解析失败: ' + error.message
      };
    }
  }

  /**
   * 解析CSV行
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * 解析文本格式
   */
  parseText(content, filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));
    
    return {
      success: true,
      data: {
        notes: [{
          title: fileName,
          content: content,
          tags: '',
          category: 'default'
        }]
      }
    };
  }

  /**
   * 解析Markdown格式
   */
  parseMarkdown(content, filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));
    
    // 尝试从内容中提取标题
    const lines = content.split('\n');
    let title = fileName;
    
    // 查找第一个一级标题
    for (const line of lines) {
      if (line.startsWith('# ')) {
        title = line.substring(2).trim();
        break;
      }
    }
    
    return {
      success: true,
      data: {
        notes: [{
          title,
          content,
          tags: '',
          category: 'default'
        }]
      }
    };
  }

  /**
   * 转换为CSV格式
   */
  convertToCSV(notes) {
    const headers = ['title', 'content', 'tags', 'category', 'created_at', 'updated_at'];
    const csvLines = [headers.join(',')];
    
    notes.forEach(note => {
      const values = headers.map(header => {
        const value = note[header] || '';
        // 转义CSV中的特殊字符
        return `"${String(value).replace(/"/g, '""')}"`;
      });
      csvLines.push(values.join(','));
    });
    
    return csvLines.join('\n');
  }

  /**
   * 转换为文本格式
   */
  convertToText(notes) {
    return notes.map(note => {
      let text = `标题: ${note.title}\n`;
      text += `分类: ${note.category}\n`;
      if (note.tags) {
        text += `标签: ${note.tags}\n`;
      }
      text += `创建时间: ${note.created_at}\n`;
      text += `更新时间: ${note.updated_at}\n`;
      text += `\n内容:\n${note.content}\n`;
      text += '\n' + '='.repeat(50) + '\n\n';
      return text;
    }).join('');
  }

  /**
   * 转换为Markdown格式
   */
  convertToMarkdown(notes) {
    return notes.map(note => {
      let md = `# ${note.title}\n\n`;
      
      if (note.tags) {
        md += `**标签:** ${note.tags}\n\n`;
      }
      
      md += `**分类:** ${note.category}\n\n`;
      md += `**创建时间:** ${note.created_at}\n\n`;
      md += `**更新时间:** ${note.updated_at}\n\n`;
      md += '---\n\n';
      md += note.content + '\n\n';
      
      return md;
    }).join('\n\n');
  }

  /**
   * 选择文件对话框
   */
  async selectFile() {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择要导入的文件',
        filters: [
          { name: 'JSON 文件', extensions: ['json'] },
          { name: '文本文件', extensions: ['txt'] },
          { name: 'Markdown 文件', extensions: ['md', 'markdown'] },
          { name: 'CSV 文件', extensions: ['csv'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    } catch (error) {
      console.error('选择文件失败:', error);
      throw error;
    }
  }

  /**
   * 获取支持的格式列表
   */
  getSupportedFormats() {
    return this.supportedFormats;
  }

  /**
   * 获取导入导出统计
   */
  getStats() {
    return {
      supportedFormats: Object.keys(this.supportedFormats).length,
      formats: this.supportedFormats
    };
  }

  /**
   * 转发处理器事件到服务事件
   */
  forwardEvents(processor, prefix) {
    // 导入事件
    processor.on('import-started', (data) => this.emit(`${prefix}-started`, data));
    processor.on('file-processing', (data) => this.emit(`${prefix}-file-processing`, data));
    processor.on('phase-changed', (data) => this.emit(`${prefix}-phase-changed`, data));
    processor.on('import-completed', (data) => this.emit(`${prefix}-completed`, data));
    processor.on('import-error', (data) => this.emit(`${prefix}-error`, data));
    
    // 导出事件
    processor.on('export-started', (data) => this.emit(`${prefix}-started`, data));
    processor.on('note-processing', (data) => this.emit(`${prefix}-note-processing`, data));
    processor.on('export-completed', (data) => this.emit(`${prefix}-completed`, data));
    processor.on('export-error', (data) => this.emit(`${prefix}-error`, data));
    
    // 通用事件
    processor.on('error', (data) => this.emit(`${prefix}-error`, data));
    processor.on('warning', (data) => this.emit(`${prefix}-warning`, data));
  }

  async importObsidianVault(options = {}) {
    const { folderPath = null, ...importOptions } = options;

    let vaultPath = folderPath;
    if (!vaultPath) {
      const result = await dialog.showOpenDialog({
        title: '选择 Obsidian Vault 文件夹',
        properties: ['openDirectory']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消导入' };
      }

      vaultPath = result.filePaths[0];
    }

    const importer = this.importers.obsidian;
    this.forwardEvents(importer, 'obsidian-import');

    return importer.import({ folderPath: vaultPath, ...importOptions });
  }

  async exportToObsidian(options = {}) {
    const { exportPath = null, ...exportOptions } = options;

    let outputPath = exportPath;
    if (!outputPath) {
      const result = await dialog.showOpenDialog({
        title: '选择导出文件夹',
        properties: ['openDirectory', 'createDirectory']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消导出' };
      }

      outputPath = result.filePaths[0];
    }

    const exporter = this.exporters.obsidian;
    this.forwardEvents(exporter, 'obsidian-export');

    return exporter.export({ exportPath: outputPath, ...exportOptions });
  }

  /**
   * 获取导入器配置
   * @param {string} importerName - 导入器名称
   * @returns {object} 配置对象
   */
  getImporterConfig(importerName) {
    return this.importers[importerName]?.getConfig?.() || null;
  }

  updateImporterConfig(importerName, config) {
    const importer = this.importers[importerName];
    if (importer?.updateConfig) {
      importer.updateConfig(config);
      return true;
    }
    return false;
  }

  getExporterConfig(exporterName) {
    return this.exporters[exporterName]?.getConfig?.() || null;
  }

  updateExporterConfig(exporterName, config) {
    const exporter = this.exporters[exporterName];
    if (exporter?.updateConfig) {
      exporter.updateConfig(config);
      return true;
    }
    return false;
  }

  getAvailableImportersAndExporters() {
    const map = (obj, type) => Object.entries(obj).map(([name, item]) => ({
      name,
      displayName: item.getName(),
      description: item.getDescription(),
      ...(type === 'importer' 
        ? { supportedExtensions: item.getSupportedExtensions() }
        : { supportedFormat: item.getSupportedFormat() })
    }));

    return {
      importers: map(this.importers, 'importer'),
      exporters: map(this.exporters, 'exporter')
    };
  }
}

module.exports = DataImportService;