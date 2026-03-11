/**
 * Flota v3.0 原子化同步系统 - 类型定义
 *
 * 本文件定义了云同步系统的所有数据结构
 */

/**
 * 同步清单 - 云端索引的核心数据结构
 * @typedef {Object} SyncManifest
 * @property {number} version - 协议版本 (v=3)
 * @property {number} last_synced_at - Unix Timestamp (毫秒)
 * @property {string} device_id - 写入设备 ID
 * @property {Record<string, FileEntry>} files - 文件条目映射，Key = UUID 或 "global_todos"/"global_settings"
 */

/**
 * 文件条目 - 单个文件的元数据
 * @typedef {Object} FileEntry
 * @property {number} v - Version: 逻辑时钟 (每次修改+1)
 * @property {number} t - Timestamp: 最后修改时间 (Unix毫秒)
 * @property {string} h - Hash: 内容指纹 (MD5)
 * @property {0|1} d - Deleted: 0=活跃, 1=墓碑
 * @property {'.md'|'.wb'|'.json'} ext - 文件扩展名
 */

/**
 * 待办事项数据结构
 * @typedef {Object} TodoItem
 * @property {string} id - UUID (sync_id)
 * @property {string} content - 待办内容
 * @property {boolean} done - 是否完成
 * @property {number} updated_at - 最后更新时间 (Unix毫秒)
 * @property {number} [created_at] - 创建时间
 * @property {string} [due_date] - 截止日期 (ISO字符串)
 * @property {number} [priority] - 优先级
 * @property {string} [category] - 分类
 * @property {number} [focus_time] - 专注时长
 * @property {string} [repeat_type] - 重复类型
 * @property {boolean} [is_recurring] - 是否重复任务
 */

/**
 * 笔记数据结构
 * @typedef {Object} NoteItem
 * @property {string} id - UUID (sync_id)
 * @property {string} title - 笔记标题
 * @property {string} content - 笔记内容 (Markdown)
 * @property {string} note_type - 笔记类型: 'markdown' | 'whiteboard'
 * @property {number} updated_at - 最后更新时间 (Unix毫秒)
 * @property {number} [created_at] - 创建时间
 * @property {string} [tags] - 标签 (逗号分隔)
 * @property {string} [category] - 分类
 * @property {boolean} [is_pinned] - 是否置顶
 * @property {boolean} [is_favorite] - 是否收藏
 */

/**
 * 白板数据结构
 * @typedef {Object} WhiteboardItem
 * @property {string} id - UUID (sync_id)
 * @property {string} title - 白板标题
 * @property {string} content - 白板数据 (JSON字符串)
 * @property {string} note_type - 固定为 'whiteboard'
 * @property {number} updated_at - 最后更新时间 (Unix毫秒)
 * @property {number} [created_at] - 创建时间
 */

/**
 * 设置数据结构
 * @typedef {Object} SettingsData
 * @property {Object} [theme] - 主题设置
 * @property {Object} [ai] - AI 设置
 * @property {Object} [sync] - 同步设置
 * @property {Object} [general] - 通用设置
 */

/**
 * 同步操作类型
 * @typedef {'upload'|'download'|'delete'|'skip'} SyncOperation
 */

/**
 * 同步任务
 * @typedef {Object} SyncTask
 * @property {SyncOperation} operation - 操作类型
 * @property {string} fileId - 文件ID (UUID或global_xxx)
 * @property {string} remotePath - 云端路径
 * @property {string} [localPath] - 本地路径
 * @property {FileEntry} [remoteEntry] - 远程文件条目
 * @property {FileEntry} [localEntry] - 本地文件条目
 * @property {any} [data] - 文件数据
 */

/**
 * 同步结果
 * @typedef {Object} SyncResult
 * @property {boolean} success - 是否成功
 * @property {number} uploaded - 上传文件数
 * @property {number} downloaded - 下载文件数
 * @property {number} deleted - 删除文件数
 * @property {number} skipped - 跳过文件数
 * @property {number} errors - 错误数
 * @property {Array<{fileId: string, error: string}>} errorDetails - 错误详情
 * @property {number} duration - 同步耗时 (毫秒)
 */

/**
 * 冲突解决策略
 * @typedef {'local'|'remote'|'merge'|'ask'} ConflictStrategy
 */

/**
 * 同步配置
 * @typedef {Object} SyncConfig
 * @property {string} baseUrl - WebDAV 基础URL
 * @property {string} username - 用户名
 * @property {string} password - 密码
 * @property {string} rootPath - 根路径 (默认 /Flota/)
 * @property {number} maxConcurrency - 最大并发数 (默认 3)
 * @property {number} requestDelay - 请求间隔 (毫秒，默认 200)
 * @property {number} retryAttempts - 重试次数 (默认 3)
 * @property {ConflictStrategy} conflictStrategy - 冲突解决策略 (默认 'ask')
 * @property {boolean} enableDebugLog - 是否启用调试日志 (默认 false)
 */

/**
 * WebDAV 客户端配置
 * @typedef {Object} WebDAVConfig
 * @property {string} baseUrl - WebDAV 基础URL
 * @property {string} username - 用户名
 * @property {string} password - 密码
 * @property {number} timeout - 请求超时 (毫秒，默认 30000)
 * @property {number} retryAttempts - 重试次数 (默认 3)
 */

module.exports = {
  // 导出类型以供 JSDoc 使用
  // 实际代码中可以通过 @type {import('./types').SyncManifest} 引用
};
