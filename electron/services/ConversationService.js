const ConversationDAO = require('../dao/ConversationDAO');

/**
 * AI 会话服务。封装会话的增删改查，返回统一 { success, data, error } 结构，
 * 供 IPC 透传。完整会话（含大对象）落 SQLite，渲染层只在内存与 localStorage 维护索引。
 */
class ConversationService {
  constructor() {
    this.dao = new ConversationDAO();
  }

  async getAllConversations() {
    try {
      return { success: true, data: this.dao.getAll() };
    } catch (error) {
      console.error('获取 AI 会话失败:', error);
      return { success: false, error: error.message };
    }
  }

  async saveConversation(conversation) {
    try {
      if (!conversation?.id) return { success: false, error: 'conversation.id 缺失' };
      const data = this.dao.upsert(conversation);
      return { success: true, data };
    } catch (error) {
      console.error('保存 AI 会话失败:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteConversation(id) {
    try {
      const deleted = this.dao.delete(id);
      // 幂等删除：行不存在也视为成功，避免渲染层 fire-and-forget 调用被拒绝。
      return { success: true, data: { id, deleted } };
    } catch (error) {
      console.error('删除 AI 会话失败:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteConversations(ids) {
    try {
      const count = this.dao.deleteMany(ids);
      return { success: true, data: { count } };
    } catch (error) {
      console.error('批量删除 AI 会话失败:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ConversationService;
