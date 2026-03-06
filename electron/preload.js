const { contextBridge, ipcRenderer } = require('electron')

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  getVersion: () => ipcRenderer.invoke('app-version'),

  // 测试用的Hello World
  helloWorld: () => ipcRenderer.invoke('hello-world'),

  // 笔记相关API
  notes: {
    // 创建笔记
    create: (noteData) => ipcRenderer.invoke('note:create', noteData),

    // 获取笔记
    getById: (id) => ipcRenderer.invoke('note:get-by-id', id),
    getAll: (options) => ipcRenderer.invoke('note:get-all', options),
    getPinned: () => ipcRenderer.invoke('note:get-pinned'),
    getDeleted: () => ipcRenderer.invoke('note:get-deleted'),
    getRecentlyModified: (limit) => ipcRenderer.invoke('note:get-recently-modified', limit),

    // 更新笔记
    update: (id, updates) => ipcRenderer.invoke('note:update', id, updates),
    autoSave: (id, content) => ipcRenderer.invoke('note:auto-save', id, content),

    // 删除和恢复笔记
    delete: (id) => ipcRenderer.invoke('note:delete', id),
    restore: (id) => ipcRenderer.invoke('note:restore', id),
    permanentDelete: (id) => ipcRenderer.invoke('note:permanent-delete', id),

    // 置顶操作
    togglePin: (id) => ipcRenderer.invoke('note:toggle-pin', id),

    // 搜索笔记
    search: (query, options) => ipcRenderer.invoke('note:search', query, options),

    // 批量操作
    batchUpdate: (ids, updates) => ipcRenderer.invoke('note:batch-update', ids, updates),
    batchDelete: (ids) => ipcRenderer.invoke('note:batch-delete', ids),
    batchRestore: (ids) => ipcRenderer.invoke('note:batch-restore', ids),
    batchPermanentDelete: (ids) => ipcRenderer.invoke('note:batch-permanent-delete', ids),
    batchSetTags: (params) => ipcRenderer.invoke('note:batch-set-tags', params),

    // 获取统计信息
    getStats: () => ipcRenderer.invoke('note:get-stats'),

    // 导出导入
    export: (options) => ipcRenderer.invoke('note:export', options),
    import: (data) => ipcRenderer.invoke('note:import', data),

    // 事件监听
    onNoteCreated: (callback) => {
      ipcRenderer.on('note:created', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('note:created');
    },
    onNoteUpdated: (callback) => {
      ipcRenderer.on('note:updated', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('note:updated');
    },
    onNoteDeleted: (callback) => {
      ipcRenderer.on('note:deleted', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('note:deleted');
    }
  },

  // 标签相关API
  tags: {
    // 获取所有标签
    getAll: (options) => ipcRenderer.invoke('tag:get-all', options),

    // 获取热门标签
    getPopular: (limit) => ipcRenderer.invoke('tags:getPopular', limit),

    // 搜索标签
    search: (query, limit) => ipcRenderer.invoke('tag:search', query, limit),

    // 获取标签建议
    getSuggestions: (input, limit) => ipcRenderer.invoke('tag:get-suggestions', input, limit),

    // 获取标签统计
    getStats: () => ipcRenderer.invoke('tag:get-stats'),

    // 删除标签
    delete: (tagName) => ipcRenderer.invoke('tag:delete', tagName),

    // 清理未使用的标签
    cleanup: () => ipcRenderer.invoke('tag:cleanup'),

    // 重新计算标签使用次数
    recalculateUsage: () => ipcRenderer.invoke('tag:recalculate-usage'),

    // 批量操作
    batchDelete: (tagNames) => ipcRenderer.invoke('tag:batch-delete', tagNames)
  },

  // 待办事项相关API
  todos: {
    // 创建待办事项
    create: (todoData) => ipcRenderer.invoke('todo:create', todoData),

    // 获取待办事项
    getAll: (options) => ipcRenderer.invoke('todo:getAll', options),
    getByQuadrant: (includeCompleted) => ipcRenderer.invoke('todo:getByQuadrant', includeCompleted),
    getDueToday: () => ipcRenderer.invoke('todo:getDueToday'),
    getByDate: (dateString) => ipcRenderer.invoke('todo:getByDate', dateString),
    getOverdue: () => ipcRenderer.invoke('todo:getOverdue'),

    // 更新待办事项
    update: (id, todoData) => ipcRenderer.invoke('todo:update', id, todoData),
    toggleComplete: (id) => ipcRenderer.invoke('todo:toggleComplete', id),

    // 删除待办事项
    delete: (id) => ipcRenderer.invoke('todo:delete', id),

    // 搜索和排序
    search: (query) => ipcRenderer.invoke('todo:search', query),
    getByPriority: () => ipcRenderer.invoke('todo:getByPriority'),
    getByDueDate: () => ipcRenderer.invoke('todo:getByDueDate'),
    getByCreatedAt: () => ipcRenderer.invoke('todo:getByCreatedAt'),

    // 批量操作
    batchUpdate: (updates) => ipcRenderer.invoke('todo:batchUpdate', updates),
    batchDelete: (ids) => ipcRenderer.invoke('todo:batchDelete', ids),
    batchComplete: (ids) => ipcRenderer.invoke('todo:batchComplete', ids),

    // 获取统计信息
    getStats: () => ipcRenderer.invoke('todo:getStats'),
    getPriorityStats: () => ipcRenderer.invoke('todo:getPriorityStats'),
    getTodoTagStats: () => ipcRenderer.invoke('todo:getTodoTagStats'),
    getTagSuggestions: (query) => ipcRenderer.invoke('todo:getTagSuggestions', query),
    searchTags: (query) => ipcRenderer.invoke('todo:searchTags', query)
  },

  // 设置相关API
  settings: {
    // 获取设置
    get: (key) => ipcRenderer.invoke('setting:get', key),
    getMultiple: (keys) => ipcRenderer.invoke('setting:get-multiple', keys),
    getAll: () => ipcRenderer.invoke('setting:get-all'),
    getByType: (type) => ipcRenderer.invoke('setting:get-by-type', type),
    getThemeSettings: () => ipcRenderer.invoke('setting:get-theme'),
    getWindowSettings: () => ipcRenderer.invoke('setting:get-window'),
    getEditorSettings: () => ipcRenderer.invoke('setting:get-editor'),

    // 设置设置
    set: (key, value) => ipcRenderer.invoke('setting:set', key, value),
    setMultiple: (settings) => ipcRenderer.invoke('setting:set-multiple', settings),

    // 删除设置
    delete: (key) => ipcRenderer.invoke('setting:delete', key),
    deleteMultiple: (keys) => ipcRenderer.invoke('setting:delete-multiple', keys),

    // 重置设置
    reset: (key) => ipcRenderer.invoke('setting:reset', key),
    resetAll: () => ipcRenderer.invoke('setting:reset-all'),

    // 搜索设置
    search: (query) => ipcRenderer.invoke('setting:search', query),

    // 获取统计信息
    getStats: () => ipcRenderer.invoke('setting:get-stats'),

    // 导出导入
    export: () => ipcRenderer.invoke('setting:export'),
    import: (data) => ipcRenderer.invoke('setting:import', data),

    // 壁纸选择
    selectWallpaper: () => ipcRenderer.invoke('setting:select-wallpaper'),

    // 开机自启
    setAutoLaunch: (enabled) => ipcRenderer.invoke('setting:set-auto-launch', enabled),
    getAutoLaunch: () => ipcRenderer.invoke('setting:get-auto-launch'),

    // 事件监听
    onSettingChanged: (callback) => {
      ipcRenderer.on('setting:changed', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('setting:changed');
    }
  },

  // 代理配置API
  proxy: {
    getConfig: () => ipcRenderer.invoke('proxy:get-config'),
    saveConfig: (config) => ipcRenderer.invoke('proxy:save-config', config),
    test: (config) => ipcRenderer.invoke('proxy:test', config)
  },

  // 本地备份/恢复
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    restore: () => ipcRenderer.invoke('backup:restore')
  },

  // 数据导入导出API
  dataImport: {
    // 文件选择
    selectFile: () => ipcRenderer.invoke('data:select-file'),

    // 导出数据
    exportNotes: (options) => ipcRenderer.invoke('data:export-notes', options),
    exportSettings: (filePath) => ipcRenderer.invoke('data:export-settings', filePath),

    // 导入数据
    importNotes: (options) => ipcRenderer.invoke('data:import-notes', options),
    importSettings: (filePath) => ipcRenderer.invoke('data:import-settings', filePath),
    importFolder: () => ipcRenderer.invoke('data:import-folder'),

    // 获取支持的格式
    getSupportedFormats: () => ipcRenderer.invoke('data:get-supported-formats'),
    getStats: () => ipcRenderer.invoke('data:get-stats'),

    // 事件监听
    onNotesExported: (callback) => {
      ipcRenderer.on('data:notes-exported', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('data:notes-exported');
    },
    onNotesImported: (callback) => {
      ipcRenderer.on('data:notes-imported', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('data:notes-imported');
    },
    onSettingsExported: (callback) => {
      ipcRenderer.on('data:settings-exported', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('data:settings-exported');
    },
    onSettingsImported: (callback) => {
      ipcRenderer.on('data:settings-imported', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('data:settings-imported');
    },
    onFolderImported: (callback) => {
      ipcRenderer.on('data:folder-imported', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('data:folder-imported');
    }
  },

  // 独立窗口创建API（顶层方法）
  createNoteWindow: (noteId, options) => ipcRenderer.invoke('window:create-note-window', noteId, options),
  isNoteOpenInWindow: (noteId) => ipcRenderer.invoke('window:is-note-open', noteId),
  createTodoWindow: (todoData) => ipcRenderer.invoke('window:create-todo-window', todoData),

  // 窗口管理API
  window: {
    // 窗口控制
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    hide: () => ipcRenderer.invoke('window:hide'),
    show: () => ipcRenderer.invoke('window:show'),
    focus: () => ipcRenderer.invoke('window:focus'),

    // 开发者工具
    toggleDevTools: () => ipcRenderer.invoke('window:toggle-dev-tools'),

    // 窗口状态
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    isMinimized: () => ipcRenderer.invoke('window:is-minimized'),
    isVisible: () => ipcRenderer.invoke('window:is-visible'),
    isFocused: () => ipcRenderer.invoke('window:is-focused'),

    // 窗口大小和位置
    getBounds: () => ipcRenderer.invoke('window:get-bounds'),
    setBounds: (bounds) => ipcRenderer.invoke('window:set-bounds', bounds),
    getSize: () => ipcRenderer.invoke('window:get-size'),
    setSize: (width, height) => ipcRenderer.invoke('window:set-size', width, height),
    getPosition: () => ipcRenderer.invoke('window:get-position'),
    setPosition: (x, y) => ipcRenderer.invoke('window:set-position', x, y),

    // 特殊窗口
    createFloatingBall: () => ipcRenderer.invoke('window:create-floating-ball'),

    // 窗口管理
    getAllWindows: () => ipcRenderer.invoke('window:get-all'),
    getWindowById: (id) => ipcRenderer.invoke('window:get-by-id', id),
    closeWindow: (id) => ipcRenderer.invoke('window:close-window', id),

    // 窗口准备就绪通知
    windowReady: () => ipcRenderer.invoke('window:ready'),

    // 事件监听
    onWindowStateChanged: (callback) => {
      ipcRenderer.on('window:state-changed', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('window:state-changed');
    },
    onWindowCreated: (callback) => {
      ipcRenderer.on('window:created', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('window:created');
    },
    onWindowClosed: (callback) => {
      ipcRenderer.on('window:closed', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('window:closed');
    },
    onWindowClosing: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('window-closing', handler);
      return () => ipcRenderer.removeListener('window-closing', handler);
    },
    removeWindowClosingListener: (callback) => {
      ipcRenderer.removeListener('window-closing', callback);
    }
  },

  // 系统相关API
  system: {
    // 获取系统信息
    getPlatform: () => ipcRenderer.invoke('system:get-platform'),
    getVersion: () => ipcRenderer.invoke('system:get-version'),
    getPath: (name) => ipcRenderer.invoke('system:get-path', name),

    // 文件系统操作
    showOpenDialog: (options) => ipcRenderer.invoke('system:show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('system:show-save-dialog', options),
    showMessageBox: (options) => ipcRenderer.invoke('system:show-message-box', options),
    openDataFolder: () => ipcRenderer.invoke('system:open-data-folder'),
    readImageAsBase64: (filePath) => ipcRenderer.invoke('system:read-image-as-base64', filePath),

    // 剪贴板操作
    writeText: (text) => ipcRenderer.invoke('system:write-text', text),
    readText: () => ipcRenderer.invoke('system:read-text'),

    // 通知
    showNotification: (options) => ipcRenderer.invoke('system:show-notification', options),

    // 打开外部链接
    openExternal: (url) => ipcRenderer.invoke('system:open-external', url)
  },

  // 数据库调试
  db: {
    getInfo: () => ipcRenderer.invoke('db:get-info'),
    repair: () => ipcRenderer.invoke('db:repair')
  },

  // 同步诊断和修复
  diagnoseSync: () => ipcRenderer.invoke('sync:diagnose'),
  fixMissingSyncId: () => ipcRenderer.invoke('sync:fix-missing-sync-id'),

  // 悬浮球相关API
  floatingBall: {
    create: () => ipcRenderer.invoke('floating-ball:create'),
    hide: () => ipcRenderer.invoke('floating-ball:hide'),
    show: () => ipcRenderer.invoke('floating-ball:show')
  },

  // 快捷键相关API
  shortcuts: {
    // 更新快捷键（支持传递完整配置）
    update: (shortcutId, newShortcut, action, allShortcuts) => ipcRenderer.invoke('shortcut:update', shortcutId, newShortcut, action, allShortcuts),

    // 重置单个快捷键
    reset: (shortcutId) => ipcRenderer.invoke('shortcut:reset', shortcutId),

    // 重置所有快捷键
    resetAll: () => ipcRenderer.invoke('shortcut:reset-all'),

    // 获取所有快捷键配置
    getAll: () => ipcRenderer.invoke('shortcut:get-all')
  },

  // 图片相关API
  images: {
    // 保存图片（从Buffer）
    saveFromBuffer: (buffer, fileName) => ipcRenderer.invoke('image:save-from-buffer', buffer, fileName),

    // 保存图片（从文件路径）
    saveFromPath: (sourcePath, fileName) => ipcRenderer.invoke('image:save-from-path', sourcePath, fileName),

    // 选择图片文件
    selectFile: () => ipcRenderer.invoke('image:select-file'),

    // 获取图片完整路径
    getPath: (relativePath) => ipcRenderer.invoke('image:get-path', relativePath),

    // 获取图片base64数据
    getBase64: (relativePath) => ipcRenderer.invoke('image:get-base64', relativePath),

    // 删除图片
    delete: (relativePath) => ipcRenderer.invoke('image:delete', relativePath)
  },

  // 白板图片存储API
  whiteboard: {
    // 保存白板图片
    saveImages: (files) => ipcRenderer.invoke('whiteboard:save-images', files),

    // 加载白板图片（批量）
    loadImages: (fileMap) => ipcRenderer.invoke('whiteboard:load-images', fileMap),

    // 加载单个白板图片
    loadImage: (fileName) => ipcRenderer.invoke('whiteboard:load-image', fileName),

    // 删除白板图片
    deleteImages: (fileMap) => ipcRenderer.invoke('whiteboard:delete-images', fileMap),

    // 获取存储统计
    getStorageStats: () => ipcRenderer.invoke('whiteboard:get-storage-stats'),

    // 保存白板预览图（PNG）
    savePreview: (syncId, pngBase64) => ipcRenderer.invoke('whiteboard:save-preview', { syncId, pngBase64 })
  },

  // AI 相关 API
  ai: {
    // 获取AI配置
    getConfig: () => ipcRenderer.invoke('ai:get-config'),

    // 保存AI配置
    saveConfig: (config) => ipcRenderer.invoke('ai:save-config', config),

    // 测试连接
    testConnection: (config) => ipcRenderer.invoke('ai:test-connection', config),

    // 获取支持的提供商列表
    getProviders: () => ipcRenderer.invoke('ai:get-providers'),

    // AI聊天（供后续功能/插件使用）
    chat: (messages, options) => ipcRenderer.invoke('ai:chat', messages, options)
  },

  // STT (Speech-to-Text) 相关 API
  stt: {
    // 获取STT配置
    getConfig: () => ipcRenderer.invoke('stt:get-config'),

    // 保存STT配置
    saveConfig: (config) => ipcRenderer.invoke('stt:save-config', config),

    // 测试连接
    testConnection: (config) => ipcRenderer.invoke('stt:test-connection', config),

    // 语音转文字
    transcribe: (audioFile, options) => ipcRenderer.invoke('stt:transcribe', { audioFile, options })
  },

  // 音频相关 API
  audio: {
    saveFromBuffer: (buffer, fileName) => ipcRenderer.invoke('audio:save-from-buffer', buffer, fileName)
  },

  // 插件商店与插件运行时 API
  pluginStore: {
    listAvailable: () => ipcRenderer.invoke('plugin-store:list-available'),
    listInstalled: () => ipcRenderer.invoke('plugin-store:list-installed'),
    scanLocalPlugins: () => ipcRenderer.invoke('plugin-store:scan-local'),
    getDetails: (pluginId) => ipcRenderer.invoke('plugin-store:get-details', pluginId),
    install: (pluginId) => ipcRenderer.invoke('plugin-store:install', pluginId),
    uninstall: (pluginId) => ipcRenderer.invoke('plugin-store:uninstall', pluginId),
    enable: (pluginId) => ipcRenderer.invoke('plugin-store:enable', pluginId),
    disable: (pluginId) => ipcRenderer.invoke('plugin-store:disable', pluginId),
    executeCommand: (pluginId, commandId, payload) => ipcRenderer.invoke('plugin-store:execute-command', pluginId, commandId, payload),
    openPluginFolder: (pluginId) => ipcRenderer.invoke('plugin-store:open-plugin-folder', pluginId),
    openPluginsDirectory: () => ipcRenderer.invoke('plugin-store:open-plugins-directory'),
    loadPluginFile: (pluginId, filePath) => ipcRenderer.invoke('plugin-store:load-plugin-file', pluginId, filePath),
    onEvent: (callback) => {
      const channel = 'plugin-store:event'
      const handler = (event, data) => callback?.(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onUiRequest: (callback) => {
      const channel = 'plugin:ui-open-note'
      const handler = (event, data) => callback?.(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onOpenWindow: (callback) => {
      const channel = 'plugin:ui-open-window'
      const handler = (event, data) => callback?.(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onNotification: (callback) => {
      const channel = 'plugin:notification'
      const handler = (event, data) => callback?.(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },

  // Mem0 知识记忆 API
  mem0: {
    // 添加记忆（需要 mem0:write）
    add: (userId, content, options) =>
      ipcRenderer.invoke('mem0:add', userId, content, options),

    // 搜索记忆（需要 mem0:read）
    search: (userId, query, options) =>
      ipcRenderer.invoke('mem0:search', userId, query, options),

    // 获取记忆列表（需要 mem0:read）
    get: (userId, options) =>
      ipcRenderer.invoke('mem0:get', userId, options),

    // 删除记忆（需要 mem0:write）
    delete: (memoryId) =>
      ipcRenderer.invoke('mem0:delete', memoryId),

    // 清空用户记忆（需要 mem0:write）
    clear: (userId) =>
      ipcRenderer.invoke('mem0:clear', userId),

    // 获取统计信息（需要 mem0:read）
    stats: (userId) =>
      ipcRenderer.invoke('mem0:stats', userId),

    // 检查可用性
    isAvailable: () =>
      ipcRenderer.invoke('mem0:is-available')
  },

  // 云同步相关API
  sync: {
    // 获取可用的同步服务
    getAvailableServices: () => ipcRenderer.invoke('sync:get-available-services'),

    // 获取同步状态
    getStatus: () => ipcRenderer.invoke('sync:get-status'),

    // 测试连接
    testConnection: (serviceName, config) => ipcRenderer.invoke('sync:test-connection', serviceName, config),

    // 切换同步服务
    switchService: (serviceName, config) => ipcRenderer.invoke('sync:switch-service', serviceName, config),

    // 禁用同步
    disable: () => ipcRenderer.invoke('sync:disable'),

    // 启用/禁用特定类别的同步
    enableCategory: (category) => ipcRenderer.invoke('sync:enable-category', category),
    disableCategory: (category) => ipcRenderer.invoke('sync:disable-category', category),

    // 手动同步
    manualSync: () => ipcRenderer.invoke('sync:manual-sync'),

    // 获取同步状态
    getStatus: () => ipcRenderer.invoke('sync:get-status'),

    // 强制停止同步
    forceStop: () => ipcRenderer.invoke('sync:force-stop'),

    // 获取冲突列表
    getConflicts: () => ipcRenderer.invoke('sync:get-conflicts'),

    // 解决冲突
    resolveConflict: (entityType, entityId, resolvedData) =>
      ipcRenderer.invoke('sync:resolve-conflict', entityType, entityId, resolvedData),

    // 导出数据
    exportData: (filePath) => ipcRenderer.invoke('sync:export-data', filePath),

    // 导入数据
    importData: (filePath) => ipcRenderer.invoke('sync:import-data', filePath),

    // V3 同步专用 API
    forceFullSync: () => ipcRenderer.invoke('sync:force-full-sync'),
    toggleAutoSync: (enabled) => ipcRenderer.invoke('sync:toggle-auto-sync', enabled),
    setAutoSyncInterval: (minutes) => ipcRenderer.invoke('sync:set-auto-sync-interval', minutes),
    clearAll: () => ipcRenderer.invoke('sync:clear-all'),

    // 图片同步相关
    downloadImage: (relativePath) => ipcRenderer.invoke('sync:download-image', relativePath),
    uploadImage: (localPath, relativePath) => ipcRenderer.invoke('sync:upload-image', localPath, relativePath),
    syncImages: () => ipcRenderer.invoke('sync:sync-images'),
    cleanupUnusedImages: (retentionDays) => ipcRenderer.invoke('sync:cleanup-unused-images', retentionDays),
    getUnusedImagesStats: (retentionDays) => ipcRenderer.invoke('sync:get-unused-images-stats', retentionDays),

    // 冲突解决
    resolveConflict: (conflictId, resolution) => ipcRenderer.invoke('sync:resolve-conflict', conflictId, resolution),

    // 同步事件监听
    onSyncStart: (callback) => {
      ipcRenderer.on('sync:start', () => callback());
      return () => ipcRenderer.removeAllListeners('sync:start');
    },
    onSyncComplete: (callback) => {
      ipcRenderer.on('sync:complete', (event, result) => callback(result));
      return () => ipcRenderer.removeAllListeners('sync:complete');
    },
    onSyncError: (callback) => {
      ipcRenderer.on('sync:error', (event, error) => callback(error));
      return () => ipcRenderer.removeAllListeners('sync:error');
    },
    onConflictDetected: (callback) => {
      ipcRenderer.on('sync:conflict', (event, conflict) => callback(conflict));
      return () => ipcRenderer.removeAllListeners('sync:conflict');
    }
  },

  // MCP 相关 API
  mcp: {
    checkInstalled: () => ipcRenderer.invoke('mcp:isInstalled'),
    getInstallInfo: () => ipcRenderer.invoke('mcp:getInstallInfo'),
    install: () => ipcRenderer.invoke('mcp:install'),
    uninstall: () => ipcRenderer.invoke('mcp:uninstall'),
    getConfigPath: () => ipcRenderer.invoke('mcp:getConfigPath'),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('mcp:install-progress', handler);
      return () => ipcRenderer.removeListener('mcp:install-progress', handler);
    }
  },

  // 通用 invoke 方法
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // 事件监听方法
  on: (channel, callback) => {
    ipcRenderer.on(channel, callback);
  },
  
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // 暴露 ipcRenderer 用于特定事件监听（兼容旧代码）
  ipcRenderer: {
    on: (channel, callback) => {
      // 只允许特定的频道
      const validChannels = ['create-new-note', 'create-new-todo', 'open-settings', 'quick-input']
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, callback)
      }
    },
    removeAllListeners: (channel) => {
      const validChannels = ['create-new-note', 'create-new-todo', 'open-settings', 'quick-input']
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel)
      }
    }
  }
})

// 监听来自主进程的消息（如果需要的话）
// window.addEventListener('DOMContentLoaded', () => {
//   // DOM加载完成后的初始化代码
// })