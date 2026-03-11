const NoteDAO = require('../dao/NoteDAO');
const TagService = require('./TagService');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

class NoteService extends EventEmitter {
  constructor() {
    super();
    this.noteDAO = new NoteDAO();
    this.autoSaveTimers = new Map(); // 存储自动保存定时器
  }

  /**
   * 创建新笔记
   */
  async createNote(noteData) {
    try {
      // 确保noteData存在并设置默认值
      const safeNoteData = {
        title: noteData?.title || '无标题',
        content: noteData?.content || '',
        tags: noteData?.tags || [],
        category: noteData?.category || 'default'
      };
      
      // 使用TagService规范化标签
      const tagsString = TagService.formatTags(safeNoteData.tags);
      
      const note = this.noteDAO.create({
        title: safeNoteData.title,
        content: safeNoteData.content,
        tags: tagsString,
        category: safeNoteData.category
      });
      
      this.emit('note-created', note);
      return {
        success: true,
        data: note
      };
    } catch (error) {
      console.error('创建笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取笔记详情
   */
  async getNoteById(id) {
    try {
      const note = this.noteDAO.findById(id);
      if (!note) {
        return {
          success: false,
          error: '笔记不存在'
        };
      }
      
      return {
        success: true,
        data: note
      };
    } catch (error) {
      console.error('获取笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 更新笔记
   * @param {boolean} silent - 是否静默更新（不触发事件）
   */
  async updateNote(id, noteData, silent = false) {
    try {
      // 清除自动保存定时器
      this.clearAutoSaveTimer(id);
      
      // 规范化 tags 参数：如果是数组则转换为逗号分隔的字符串
      const normalizedData = { ...noteData };
      if (normalizedData.tags !== undefined) {
        if (Array.isArray(normalizedData.tags)) {
          normalizedData.tags = normalizedData.tags.join(',');
        } else if (typeof normalizedData.tags !== 'string') {
          normalizedData.tags = '';
        }
      }
      
      const note = this.noteDAO.update(id, normalizedData);
      if (!note) {
        return {
          success: false,
          error: '笔记不存在'
        };
      }
      
      // 只在非静默模式下触发事件
      if (!silent) {
        this.emit('note-updated', note);
      }
      return {
        success: true,
        data: note
      };
    } catch (error) {
      console.error('更新笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 自动保存笔记
   */
  async autoSaveNote(id, noteData, delay = 0) {
    // 取消之前的自动保存定时器，避免竞态
    this.clearAutoSaveTimer(id)

    try {
      const result = await this.updateNote(id, noteData)
      if (result && result.success) {
        this.emit('note-auto-saved', result.data)
      }
      return result
    } catch (error) {
      console.error('自动保存失败:', error)
      throw error
    }
  }

  /**
   * 清除自动保存定时器
   */
  clearAutoSaveTimer(id) {
    const timer = this.autoSaveTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.autoSaveTimers.delete(id)
    }
  }

  /**
   * 删除笔记
   */
  async deleteNote(id) {
    try {
      const success = this.noteDAO.softDelete(id);
      if (!success) {
        return {
          success: false,
          error: '笔记不存在'
        };
      }
      
      // 清除自动保存定时器
      this.clearAutoSaveTimer(id);
      
      this.emit('note-deleted', { id });
      return {
        success: true,
        message: '笔记已删除'
      };
    } catch (error) {
      console.error('删除笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 恢复已删除的笔记
   */
  async restoreNote(id) {
    try {
      const success = this.noteDAO.restore(id);
      if (!success) {
        return {
          success: false,
          error: '笔记不存在'
        };
      }
      
      const note = this.noteDAO.findById(id);
      this.emit('note-restored', note);
      return {
        success: true,
        data: note
      };
    } catch (error) {
      console.error('恢复笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 永久删除笔记
   */
  async permanentDeleteNote(id) {
    try {
      const success = this.noteDAO.hardDelete(id);
      if (!success) {
        return {
          success: false,
          error: '笔记不存在'
        };
      }
      
      // 清除自动保存定时器
      this.clearAutoSaveTimer(id);
      
      this.emit('note-permanent-deleted', { id });
      return {
        success: true,
        message: '笔记已永久删除'
      };
    } catch (error) {
      console.error('永久删除笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取笔记列表
   */
  async getNotes(options = {}) {
    try {
      const result = this.noteDAO.findAll(options);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('获取笔记列表失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取一条随机笔记
   * @param {object} options
   * @param {boolean} [options.includeDeleted=false] 是否包含已删除笔记
   * @param {number} [options.pageSize=50] 每次批量读取的数量
   */
  async getRandomNote(options = {}) {
    const {
      includeDeleted = false,
      pageSize: rawPageSize = 50
    } = options

    const pageSize = Math.min(200, Math.max(1, Number(rawPageSize) || 50))

    try {
      const initialBatch = this.noteDAO.findAll({
        page: 1,
        limit: pageSize,
        includeDeleted,
        pinnedFirst: false,
        sortBy: 'updated_at',
        sortOrder: 'DESC'
      })

      const total = initialBatch?.pagination?.total || 0
      if (!total) {
        return {
          success: true,
          data: null
        }
      }

      const randomIndex = Math.floor(Math.random() * total)
      const targetPage = Math.floor(randomIndex / pageSize) + 1
      const offsetIndex = randomIndex % pageSize

      const batch = targetPage === 1
        ? initialBatch
        : this.noteDAO.findAll({
            page: targetPage,
            limit: pageSize,
            includeDeleted,
            pinnedFirst: false,
            sortBy: 'updated_at',
            sortOrder: 'DESC'
          })

      const note = Array.isArray(batch?.notes) ? batch.notes[offsetIndex] || batch.notes[0] || null : null

      return {
        success: true,
        data: note
      }
    } catch (error) {
      console.error('获取随机笔记失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 获取置顶笔记
   */
  async getPinnedNotes() {
    try {
      const notes = this.noteDAO.findPinned();
      return {
        success: true,
        data: notes
      };
    } catch (error) {
      console.error('获取置顶笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取已删除的笔记
   */
  async getDeletedNotes(options = {}) {
    try {
      const result = this.noteDAO.findDeleted(options);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('获取已删除笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 搜索笔记
   */
  async searchNotes(query, options = {}) {
    try {
      if (!query || query.trim() === '') {
        return {
          success: true,
          data: []
        };
      }
      
      const notes = this.noteDAO.search(query.trim(), options);
      return {
        success: true,
        data: notes
      };
    } catch (error) {
      console.error('搜索笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 切换笔记置顶状态
   */
  async togglePinNote(id) {
    try {
      const note = this.noteDAO.togglePin(id);
      if (!note) {
        return {
          success: false,
          error: '笔记不存在'
        };
      }
      
      this.emit('note-pin-toggled', note);
      return {
        success: true,
        data: note
      };
    } catch (error) {
      console.error('切换置顶状态失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量操作笔记
   */
  async batchUpdateNotes(ids, updates) {
    try {
      this.noteDAO.batchUpdate(ids, updates);
      this.emit('notes-batch-updated', { ids, updates });
      return {
        success: true,
        message: `已更新 ${ids.length} 条笔记`
      };
    } catch (error) {
      console.error('批量更新笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量删除笔记
   */
  async batchDeleteNotes(ids) {
    try {
      this.noteDAO.batchDelete(ids);
      
      // 清除所有相关的自动保存定时器
      ids.forEach(id => this.clearAutoSaveTimer(id));
      
      this.emit('notes-batch-deleted', { ids });
      return {
        success: true,
        message: `已删除 ${ids.length} 条笔记`
      };
    } catch (error) {
      console.error('批量删除笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量恢复笔记
   */
  async batchRestoreNotes(ids) {
    try {
      this.noteDAO.batchRestore(ids);
      
      this.emit('notes-batch-restored', { ids });
      return {
        success: true,
        message: `已恢复 ${ids.length} 条笔记`
      };
    } catch (error) {
      console.error('批量恢复笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量永久删除笔记
   */
  async batchPermanentDeleteNotes(ids) {
    try {
      this.noteDAO.batchHardDelete(ids);
      
      // 清除所有相关的自动保存定时器
      ids.forEach(id => this.clearAutoSaveTimer(id));
      
      this.emit('notes-batch-permanent-deleted', { ids });
      return {
        success: true,
        message: `已永久删除 ${ids.length} 条笔记`
      };
    } catch (error) {
      console.error('批量永久删除笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取最近修改的笔记
   */
  async getRecentNotes(limit = 10) {
    try {
      const notes = this.noteDAO.findRecent(limit);
      return {
        success: true,
        data: notes
      };
    } catch (error) {
      console.error('获取最近笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取笔记统计信息
   */
  async getNoteStats() {
    try {
      const stats = this.noteDAO.getStats();
      const categoryStats = this.noteDAO.countByCategory();
      
      return {
        success: true,
        data: {
          ...stats,
          categoryStats
        }
      };
    } catch (error) {
      console.error('获取笔记统计失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 导出笔记
   */
  async exportNotes(options = {}) {
    try {
      const { format = 'json', includeDeleted = false, category = null } = options;
      
      const notesResult = this.noteDAO.findAll({
        includeDeleted,
        category,
        limit: 10000 // 导出时不限制数量
      });
      
      const exportData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        totalNotes: notesResult.notes.length,
        notes: notesResult.notes
      };
      
      if (format === 'json') {
        return {
          success: true,
          data: exportData,
          filename: `Flota-export-${new Date().toISOString().split('T')[0]}.json`
        };
      }
      
      // 可以扩展其他格式的导出
      return {
        success: false,
        error: '不支持的导出格式'
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
   * 导入笔记
   */
  async importNotes(data) {
    try {
      if (!data.notes || !Array.isArray(data.notes)) {
        return {
          success: false,
          error: '无效的导入数据格式'
        };
      }
      
      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      
      for (const noteData of data.notes) {
        try {
          await this.createNote({
            title: noteData.title || '无标题',
            content: noteData.content || '',
            tags: noteData.tags || '',
            category: noteData.category || 'default'
          });
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push(`导入笔记失败: ${error.message}`);
        }
      }
      
      this.emit('notes-imported', { successCount, errorCount });
      
      return {
        success: true,
        data: {
          successCount,
          errorCount,
          errors: errors.slice(0, 10) // 只返回前10个错误
        }
      };
    } catch (error) {
      console.error('导入笔记失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量设置标签
   */
  async batchSetTags({ noteIds, tags, replaceMode = false }) {
    try {
      if (!Array.isArray(noteIds) || noteIds.length === 0) {
        return {
          success: false,
          error: '无效的笔记ID列表'
        };
      }

      if (!Array.isArray(tags)) {
        return {
          success: false,
          error: '无效的标签列表'
        };
      }

      // 规范化标签
      const normalizedTags = tags.filter(tag => tag && tag.trim()).map(tag => tag.trim());
      const tagsString = TagService.formatTags(normalizedTags);

      let updatedCount = 0;
      const errors = [];

      for (const noteId of noteIds) {
        try {
          const existingNote = this.noteDAO.findById(noteId);
          if (!existingNote) {
            errors.push(`笔记 ${noteId} 不存在`);
            continue;
          }

          let finalTags;
          if (replaceMode) {
            // 替换模式：直接使用新标签
            finalTags = normalizedTags;
          } else {
            // 追加模式：合并现有标签和新标签
            const existingTags = TagService.parseTags(existingNote.tags || '');
            const combinedTags = [...new Set([...existingTags, ...normalizedTags])];
            finalTags = combinedTags;
          }

          const finalTagsString = TagService.formatTags(finalTags);

          // 更新笔记标签
          const result = this.noteDAO.update(noteId, {
            tags: finalTagsString,
            updated_at: new Date().toISOString()
          });

          if (result) {
            updatedCount++;
            // 更新标签使用统计
            if (finalTags.length > 0) {
              const tagService = new TagService();
              await tagService.updateTagsUsage(finalTags);
            }
          }
        } catch (error) {
          errors.push(`更新笔记 ${noteId} 失败: ${error.message}`);
        }
      }

      return {
        success: true,
        data: {
          updatedCount,
          totalCount: noteIds.length,
          errors: errors.slice(0, 10) // 只返回前10个错误
        }
      };
    } catch (error) {
      console.error('批量设置标签失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 清理所有自动保存定时器
   */
  cleanup() {
    for (const [id, timer] of this.autoSaveTimers) {
      clearTimeout(timer);
    }
    this.autoSaveTimers.clear();
  }
}

module.exports = NoteService;