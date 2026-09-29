const BaseImporter = require('./BaseImporter');
const path = require('path');
const fs = require('fs').promises;
const { getFileTimes } = require('../../utils/fileTimes');

/**
 * Obsidian 导入器
 * 专门处理 Obsidian 格式的 Markdown 文件
 * 支持：
 * - YAML Front-matter
 * - [[WikiLinks]] 内部链接
 * - ![[image.png]] 图片嵌入
 * - 标签 #tag
 * - 附件路径重映射
 */
class ObsidianImporter extends BaseImporter {
  constructor(noteService, imageStorageService) {
    super(noteService, imageStorageService);
    
    // Obsidian 配置
    this.config = {
      // 附件文件夹名称（可配置）
      attachmentFolders: ['attachments', 'assets', 'files', '_resources'],
      // 图片扩展名
      imageExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
      // 是否转换 WikiLinks 为标准 Markdown 链接
      convertWikiLinks: true,
      // 是否保留 Front-matter
      preserveFrontMatter: true,
      // 是否导入链接的笔记
      followLinks: false
    };

    // 链接映射表（原文件名 -> 新笔记ID）
    this.linkMap = new Map();
  }

  /**
   * 导入 Obsidian vault
   * @param {object} options - 导入选项
   * @returns {Promise<object>} 导入结果
   */
  async import(options) {
    const { 
      folderPath, 
      config = {},
      importAttachments = true,
      createCategories = true 
    } = options;

    // 合并配置
    this.config = { ...this.config, ...config };
    this.resetStats();

    try {
      // 验证文件夹
      const stats = await fs.stat(folderPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: '指定的路径不是文件夹'
        };
      }

      // 扫描所有 Markdown 文件
      const files = await this.scanFolder(folderPath, true, (filePath) => {
        return this.isSupportedFile(filePath);
      });

      this.stats.totalFiles = files.length;
      this.emit('import-started', { 
        totalFiles: files.length, 
        vaultPath: folderPath 
      });

      // Obsidian 默认按文件名在整个库里找附件（![[pic.png]] 不带路径），先建一份文件名索引；
      // 同一张图被多篇笔记引用时只复制一次
      this.imageIndex = importAttachments ? await this.buildImageIndex(folderPath) : new Map();
      this.importedImages = new Map();

      const noteResults = [];
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        this.emit('file-processing', { 
          filePath, 
          current: i + 1, 
          total: files.length,
          phase: 'importing'
        });

        try {
          const content = await this.readFile(filePath);
          const noteData = await this.parseFile(content, filePath);
          
          if (noteData) {
            // 如果启用分类，根据文件夹结构创建分类
            if (createCategories) {
              noteData.category = this.extractCategory(filePath, folderPath);
            }

            // 图片在保存前就复制进应用图片目录并改写引用：保存后再 updateNote 会把修改时间改成现在
            if (importAttachments) {
              noteData.content = await this.importNoteImages(noteData.content, filePath, folderPath);
            }

            const result = await this.saveNote(noteData);
            if (!result?.success || !result.data) {
              throw new Error(result?.error || '保存笔记失败');
            }
            
            // 记录文件名到笔记ID的映射
            const fileName = path.basename(filePath, path.extname(filePath));
            this.linkMap.set(fileName, result.data.id);
            
            noteResults.push({ 
              filePath, 
              noteId: result.data.id, 
              success: true, 
              data: result.data 
            });
            this.stats.successCount++;
          } else {
            this.stats.skippedCount++;
          }
        } catch (error) {
          this.stats.errorCount++;
          this.addError(filePath, error.message);
          noteResults.push({ filePath, success: false, error: error.message });
        }
      }

      this.emit('import-completed', this.stats);

      return {
        success: true,
        data: {
          ...this.stats,
          results: noteResults,
          linkMap: Object.fromEntries(this.linkMap)
        }
      };
    } catch (error) {
      this.emit('import-error', { error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 解析 Obsidian Markdown 文件
   * @param {string} content - 文件内容
   * @param {string} filePath - 文件路径
   * @returns {Promise<object>} 笔记数据
   */
  async parseFile(content, filePath) {
    try {
      // 解析 YAML Front-matter
      const { frontMatter, contentWithoutFrontMatter } = this.parseFrontMatter(content);
      
      // 提取标题（优先使用 Front-matter 中的 title，否则使用文件名或第一个标题）
      const title = this.extractTitle(frontMatter, contentWithoutFrontMatter, filePath);
      
      // 提取标签
      const tags = this.extractTags(frontMatter, contentWithoutFrontMatter);
      
      // 处理内容（转换 WikiLinks、处理图片等）
      let processedContent = contentWithoutFrontMatter;
      
      // 转换 WikiLinks
      if (this.config.convertWikiLinks) {
        processedContent = this.convertWikiLinks(processedContent);
      }
      
      // 构建笔记数据
      const noteData = {
        title,
        content: processedContent,
        tags: tags.join(','),
        category: 'default',
        note_type: 'markdown',
        metadata: {
          source: 'obsidian',
          originalPath: filePath,
          frontMatter: this.config.preserveFrontMatter ? frontMatter : null
        }
      };

      // 时间：Front-matter 里写了就用它，否则用文件原来的创建 / 修改时间。
      // 写错的日期不再让整篇笔记解析失败，交给 createNote 忽略后退回文件时间
      const fileTimes = await getFileTimes(filePath);
      const created = frontMatter?.created || frontMatter?.date;
      const updated = frontMatter?.updated || frontMatter?.modified;
      noteData.created_at = created && !Number.isNaN(new Date(created).getTime()) ? String(created) : fileTimes.created_at;
      noteData.updated_at = updated && !Number.isNaN(new Date(updated).getTime()) ? String(updated) : fileTimes.updated_at;

      // 从 Front-matter 中提取额外信息
      if (frontMatter) {
        if (frontMatter.category) {
          noteData.category = frontMatter.category;
        }
      }

      return noteData;
    } catch (error) {
      this.addError(`解析文件失败: ${filePath}`, error.message);
      throw error;
    }
  }

  /**
   * 解析 YAML Front-matter
   * @param {string} content - 文件内容
   * @returns {object} { frontMatter, contentWithoutFrontMatter }
   */
  parseFrontMatter(content) {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(frontMatterRegex);
    
    if (!match) {
      return { frontMatter: null, contentWithoutFrontMatter: content };
    }

    const frontMatterText = match[1];
    const contentWithoutFrontMatter = content.slice(match[0].length);
    
    // 简单的 YAML 解析（支持基本的键值对）
    const frontMatter = {};
    const lines = frontMatterText.split('\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();
        
        // 移除引号
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        // 处理数组（简单的逗号分隔或 YAML 列表格式）
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(v => v.trim());
        } else if (key === 'tags' || key === 'aliases') {
          // 如果是标签或别名，可能是 YAML 列表格式（下一行开始）
          const tagLines = [];
          let j = lines.indexOf(line) + 1;
          while (j < lines.length && lines[j].startsWith('  - ')) {
            tagLines.push(lines[j].replace(/^\s*-\s*/, '').trim());
            j++;
          }
          if (tagLines.length > 0) {
            value = tagLines;
          }
        }
        
        frontMatter[key] = value;
      }
    }
    
    return { frontMatter, contentWithoutFrontMatter };
  }

  /**
   * 提取标题
   * @param {object} frontMatter - Front-matter 数据
   * @param {string} content - 内容
   * @param {string} filePath - 文件路径
   * @returns {string} 标题
   */
  extractTitle(frontMatter, content, filePath) {
    // 优先级：Front-matter title > 第一个一级标题 > 文件名
    if (frontMatter && frontMatter.title) {
      return frontMatter.title;
    }
    
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    
    return path.basename(filePath, path.extname(filePath));
  }

  /**
   * 提取标签
   * @param {object} frontMatter - Front-matter 数据
   * @param {string} content - 内容
   * @returns {Array<string>} 标签列表
   */
  extractTags(frontMatter, content) {
    const tags = new Set();
    
    // 从 Front-matter 提取
    if (frontMatter && frontMatter.tags) {
      const fmTags = Array.isArray(frontMatter.tags) ? frontMatter.tags : [frontMatter.tags];
      fmTags.forEach(tag => tags.add(tag.toString().replace(/^#/, '')));
    }
    
    // 从内容中提取 #tag 格式的标签
    const tagRegex = /#([a-zA-Z0-9_\u4e00-\u9fa5-]+)/g;
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      tags.add(match[1]);
    }
    
    return Array.from(tags);
  }

  /**
   * 转换 WikiLinks 为标准 Markdown 链接
   * @param {string} content - 内容
   * @returns {string} 转换后的内容
   */
  convertWikiLinks(content) {
    // 转换 [[link]] 为 [link](link)
    // 转换 [[link|display]] 为 [display](link)
    // 转换 [[link#heading]] 为 [link](link#heading)
    
    // 跳过 ![[...]] 嵌入：图片由导入时统一处理，其余嵌入保留原样
    return content.replace(/(?<!!)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (match, link, heading, display) => {
      const displayText = display || link;
      const linkTarget = heading ? `${link}#${heading}` : link;
      
      // 记录链接引用（用于后续可能的关联处理）
      return `[${displayText}](${linkTarget})`;
    });
  }

  /**
   * 提取图片引用（只认图片扩展名；网络图片、data URI 和已在应用图片目录里的跳过）
   * @param {string} content - 内容
   * @returns {Array<object>} 图片引用列表：{ type, original, path, alt }
   */
  extractImageReferences(content) {
    const images = [];
    const isImage = (target) => this.config.imageExtensions.includes(path.extname(target).toLowerCase());
    
    // ![[image.png]]、![[image.png|300]]、![[folder/image.png#x]]
    const wikiImageRegex = /!\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = wikiImageRegex.exec(content)) !== null) {
      const target = match[1].split('|')[0].split('#')[0].trim();
      if (target && isImage(target)) {
        images.push({ type: 'wiki', original: match[0], path: target, alt: path.basename(target, path.extname(target)) });
      }
    }
    
    // ![alt](path)、![alt](<path with spaces>)、![alt](path "title")
    const mdImageRegex = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\s*\)/g;
    while ((match = mdImageRegex.exec(content)) !== null) {
      let target = match[2].replace(/^<|>$/g, '').trim();
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target) || /^images\//i.test(target)) continue;
      try { target = decodeURI(target); } catch { /* 保留原样 */ }
      if (target && isImage(target)) {
        images.push({ type: 'markdown', original: match[0], path: target, alt: match[1] });
      }
    }
    
    return images;
  }

  /**
   * 把笔记里引用的本地图片复制进应用图片目录，并把引用改写成 ![alt](images/xxx)
   * @param {string} content - 笔记内容
   * @param {string} notePath - 笔记文件路径
   * @param {string} vaultPath - Vault 根路径
   * @returns {Promise<string>} 改写后的内容
   */
  async importNoteImages(content, notePath, vaultPath) {
    let result = content;
    for (const imageRef of this.extractImageReferences(content)) {
      const source = this.resolveImagePath(imageRef.path, notePath, vaultPath);
      if (!source) {
        this.addWarning(imageRef.path, `找不到图片（${path.basename(notePath)}）`);
        continue;
      }
      let stored = this.importedImages?.get(source);
      if (!stored) {
        stored = await this.processImage(source, vaultPath);
        if (!stored) continue;
        this.importedImages?.set(source, stored);
      }
      result = result.split(imageRef.original).join(`![${imageRef.alt}](${stored})`);
    }
    return result;
  }

  /**
   * 建立 vault 内图片的文件名索引（小写文件名 -> 绝对路径，重名时取先找到的）
   * @param {string} vaultPath - Vault 根路径
   * @returns {Promise<Map<string, string>>}
   */
  async buildImageIndex(vaultPath) {
    const index = new Map();
    const walk = async (dir) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(fullPath);
        else if (entry.isFile() && this.config.imageExtensions.includes(path.extname(entry.name).toLowerCase())) {
          const key = entry.name.toLowerCase();
          if (!index.has(key)) index.set(key, fullPath);
        }
      }
    };
    await walk(vaultPath);
    return index;
  }

  /**
   * 解析图片路径
   * @param {string} imagePath - 图片路径（可能是相对路径或附件名）
   * @param {string} notePath - 笔记文件路径
   * @param {string} vaultPath - Vault 根路径
   * @returns {string|null} 解析后的绝对路径
   */
  resolveImagePath(imagePath, notePath, vaultPath) {
    // 如果是绝对路径，直接返回
    if (path.isAbsolute(imagePath)) {
      return imagePath;
    }

    // 如果是 URL，跳过
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return null;
    }

    // 策略1：相对于笔记文件的路径
    const relativeToNote = path.join(path.dirname(notePath), imagePath);
    
    // 策略2：在常见附件文件夹中查找
    const attachmentPaths = this.config.attachmentFolders.map(folder => 
      path.join(vaultPath, folder, path.basename(imagePath))
    );

    // 策略3：在 vault 根目录查找
    const rootPath = path.join(vaultPath, imagePath);

    // 策略4：按文件名在整个 vault 里找（Obsidian 默认的"尽可能短的路径"写法）
    const indexed = this.imageIndex?.get(path.basename(imagePath).toLowerCase());

    // 返回第一个存在的路径
    const candidates = [relativeToNote, ...attachmentPaths, rootPath, indexed].filter(Boolean);
    
    for (const candidate of candidates) {
      try {
        // 同步检查文件是否存在（因为这里需要快速判断）
        const fs = require('fs');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // 继续尝试下一个
      }
    }

    return null;
  }

  /**
   * 从路径提取分类
   * @param {string} filePath - 文件路径
   * @param {string} vaultPath - Vault 路径
   * @returns {string} 分类名称
   */
  extractCategory(filePath, vaultPath) {
    const relativePath = path.relative(vaultPath, path.dirname(filePath));
    
    // 如果在根目录，返回 default
    if (!relativePath || relativePath === '.') {
      return 'default';
    }
    
    // 使用第一级文件夹作为分类
    const firstFolder = relativePath.split(path.sep)[0];
    return firstFolder || 'default';
  }

  /**
   * 检查文件是否支持
   */
  isSupportedFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ['.md', '.markdown'].includes(ext);
  }

  /**
   * 获取支持的文件扩展名
   */
  getSupportedExtensions() {
    return ['.md', '.markdown'];
  }

  /**
   * 获取导入器名称
   */
  getName() {
    return 'Obsidian Importer';
  }

  /**
   * 获取导入器描述
   */
  getDescription() {
    return 'Import notes from Obsidian vaults with support for WikiLinks, Front-matter, and attachments';
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

module.exports = ObsidianImporter;
