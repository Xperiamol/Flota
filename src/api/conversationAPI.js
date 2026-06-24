import { invoke } from './ipc'

// AI 会话持久化 API：完整会话（含图片/长消息/工具结果）落 SQLite。
// 渲染层内存与 localStorage 只保留索引。

export const fetchConversations = () => invoke('conversation:get-all')
export const saveConversation = (conversation) => invoke('conversation:save', conversation)
export const deleteConversation = (id) => invoke('conversation:delete', id)
export const deleteConversations = (ids) => invoke('conversation:delete-many', ids)
