const { contextBridge, ipcRenderer, webUtils } = require('electron')

// ── IPC 桥工厂 ──
const inv = (ch) => (...args) => ipcRenderer.invoke(ch, ...args)
const listen = (ch) => (cb) => {
  const h = (_, d) => cb(d)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

const INVOKE_ALLOWLIST = new Set([
  'todo:toggleComplete',
  'google-calendar:get-config',
  'google-calendar:get-status',
  'google-calendar:save-config',
  'google-calendar:list-calendars',
  'google-calendar:start-auth',
  'google-calendar:disconnect',
  'google-calendar:sync',
  'caldav:get-config',
  'caldav:get-status',
  'caldav:save-config',
  'caldav:test-connection',
  'caldav:sync',
  'proxy:get-config',
  'proxy:save-config',
  'proxy:test',
  'mem0:is-available',
  'mem0:stats',
  'mem0:get',
  'mem0:search',
  'mem0:delete',
  'mem0:clear',
  'mem0:cleanup',
  'mem0:migrate-historical',
  'data:import-obsidian-vault',
  'data:export-to-obsidian',
  'data:get-importer-config',
  'data:update-importer-config',
  'data:get-exporter-config',
  'data:update-exporter-config',
  'data:get-available-importers-exporters'
])

// 允许旧的 src/api/* 通过 electronAPI.invoke 访问的低风险业务前缀（避免逐条枚举）。
// 注意：这里刻意不包含 system:/db:/window:/plugin-store: 等高风险通道。
const INVOKE_ALLOWED_PREFIXES = [
  'note:',
  'tag:',
  'tags:',
  'todo:',
  'setting:',
  'sync:',
  'data:',
  'proxy:',
  'mem0:',
  'caldav:',
  'google-calendar:',
]

const isAllowedInvokeChannel = (channel) => (
  typeof channel === 'string' &&
  (INVOKE_ALLOWLIST.has(channel) || INVOKE_ALLOWED_PREFIXES.some((p) => channel.startsWith(p)))
)

const isAllowedEventChannel = (channel) => (
  typeof channel === 'string' &&
  (/^obsidian-[a-z-]+$/.test(channel) ||
    ['create-new-note', 'create-new-todo', 'open-settings', 'quick-input', 'todo:focus', 'system-theme-changed'].includes(channel))
)

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  // 笔记相关API
  notes: {
    create: inv('note:create'),
    getById: inv('note:get-by-id'),
    getAll: inv('note:get-all'),
    getPinned: inv('note:get-pinned'),
    getDeleted: inv('note:get-deleted'),
    getRecentlyModified: inv('note:get-recently-modified'),
    update: inv('note:update'),
    autoSave: inv('note:auto-save'),
    delete: inv('note:delete'),
    restore: inv('note:restore'),
    permanentDelete: inv('note:permanent-delete'),
    togglePin: inv('note:toggle-pin'),
    search: inv('note:search'),
    batchUpdate: inv('note:batch-update'),
    batchDelete: inv('note:batch-delete'),
    batchRestore: inv('note:batch-restore'),
    batchPermanentDelete: inv('note:batch-permanent-delete'),
    batchSetTags: inv('note:batch-set-tags'),
    getStats: inv('note:get-stats'),
    getActivityHeatmap: inv('note:get-activity-heatmap'),
    export: inv('note:export'),
    import: inv('note:import'),
    onNoteCreated: listen('note:created'),
    onNoteUpdated: listen('note:updated'),
    onNoteDeleted: listen('note:deleted'),
  },

  // 标签相关API
  tags: {
    getAll: inv('tag:get-all'),
    getPopular: inv('tags:getPopular'),
    search: inv('tag:search'),
    getSuggestions: inv('tag:get-suggestions'),
    getStats: inv('tag:get-stats'),
    delete: inv('tag:delete'),
    cleanup: inv('tag:cleanup'),
    recalculateUsage: inv('tag:recalculate-usage'),
    batchDelete: inv('tag:batch-delete'),
  },

  // 待办事项相关API
  todos: {
    create: inv('todo:create'),
    getAll: inv('todo:getAll'),
    getByQuadrant: inv('todo:getByQuadrant'),
    getDueToday: inv('todo:getDueToday'),
    getByDate: inv('todo:getByDate'),
    getOverdue: inv('todo:getOverdue'),
    update: inv('todo:update'),
    toggleComplete: inv('todo:toggleComplete'),
    delete: inv('todo:delete'),
    search: inv('todo:search'),
    getByPriority: inv('todo:getByPriority'),
    getByDueDate: inv('todo:getByDueDate'),
    getByCreatedAt: inv('todo:getByCreatedAt'),
    batchUpdate: inv('todo:batchUpdate'),
    batchDelete: inv('todo:batchDelete'),
    batchComplete: inv('todo:batchComplete'),
    getStats: inv('todo:getStats'),
    getPriorityStats: inv('todo:getPriorityStats'),
    getTodoTagStats: inv('todo:getTodoTagStats'),
    getTagSuggestions: inv('todo:getTagSuggestions'),
    searchTags: inv('todo:searchTags'),
  },

  // 设置相关API
  settings: {
    get: inv('setting:get'),
    getMultiple: inv('setting:get-multiple'),
    getAll: inv('setting:get-all'),
    getByType: inv('setting:get-by-type'),
    getThemeSettings: inv('setting:get-theme'),
    getWindowSettings: inv('setting:get-window'),
    getEditorSettings: inv('setting:get-editor'),
    set: inv('setting:set'),
    setMultiple: inv('setting:set-multiple'),
    delete: inv('setting:delete'),
    deleteMultiple: inv('setting:delete-multiple'),
    resetAll: inv('setting:reset-all'),
    search: inv('setting:search'),
    getStats: inv('setting:get-stats'),
    export: inv('setting:export'),
    import: inv('setting:import'),
    selectWallpaper: inv('setting:select-wallpaper'),
    setAutoLaunch: inv('setting:set-auto-launch'),
    getAutoLaunch: inv('setting:get-auto-launch'),
    onSettingChanged: listen('setting:changed'),
  },

  // 代理配置API
  proxy: {
    getConfig: inv('proxy:get-config'),
    saveConfig: inv('proxy:save-config'),
    test: inv('proxy:test'),
  },

  // 本地备份/恢复
  backup: {
    create: inv('backup:create'),
    restore: inv('backup:restore'),
  },

  // 数据导入导出API
  dataImport: {
    selectFile: inv('data:select-file'),
    exportNotes: inv('data:export-notes'),
    exportSettings: inv('data:export-settings'),
    importNotes: inv('data:import-notes'),
    importSettings: inv('data:import-settings'),
    importFolder: inv('data:import-folder'),
    getSupportedFormats: inv('data:get-supported-formats'),
    getStats: inv('data:get-stats'),
    onNotesExported: listen('data:notes-exported'),
    onNotesImported: listen('data:notes-imported'),
    onSettingsExported: listen('data:settings-exported'),
    onSettingsImported: listen('data:settings-imported'),
    onFolderImported: listen('data:folder-imported'),
  },

  // 独立窗口创建API（顶层方法）
  createNoteWindow: inv('window:create-note-window'),
  isNoteOpenInWindow: inv('window:is-note-open'),
  createTodoWindow: inv('window:create-todo-window'),

  // 窗口管理API
  window: {
    minimize: inv('window:minimize'),
    maximize: inv('window:maximize'),
    close: inv('window:close'),
    hide: inv('window:hide'),
    show: inv('window:show'),
    focus: inv('window:focus'),
    toggleDevTools: inv('window:toggle-dev-tools'),
    isMaximized: inv('window:is-maximized'),
    isMinimized: inv('window:is-minimized'),
    isVisible: inv('window:is-visible'),
    isFocused: inv('window:is-focused'),
    getBounds: inv('window:get-bounds'),
    setBounds: inv('window:set-bounds'),
    getSize: inv('window:get-size'),
    setSize: inv('window:set-size'),
    getPosition: inv('window:get-position'),
    setPosition: inv('window:set-position'),
    getAllWindows: inv('window:get-all'),
    getWindowById: inv('window:get-by-id'),
    closeWindow: inv('window:close-window'),
    windowReady: inv('window:ready'),
    getInitData: inv('window:get-init-data'),
    onWindowStateChanged: listen('window:state-changed'),
    onWindowCreated: listen('window:created'),
    onWindowClosed: listen('window:closed'),
    onWindowClosing: listen('window-closing'),
    removeWindowClosingListener: (callback) => {
      ipcRenderer.removeListener('window-closing', callback)
    },
  },

  // 系统相关API
  system: {
    getPlatform: inv('system:get-platform'),
    getVersion: inv('system:get-version'),
    checkForUpdates: inv('system:check-for-updates'),
    getPath: inv('system:get-path'),
    getStorageUsage: inv('system:get-storage-usage'),
    showOpenDialog: inv('system:show-open-dialog'),
    showSaveDialog: inv('system:show-save-dialog'),
    showMessageBox: inv('system:show-message-box'),
    openDataFolder: inv('system:open-data-folder'),
    readImageAsBase64: inv('system:read-image-as-base64'),
    writeText: inv('system:write-text'),
    readText: inv('system:read-text'),
    showNotification: inv('system:show-notification'),
    openExternal: inv('system:open-external'),
    openPath: inv('system:open-path'),
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },

  // 数据库调试
  db: { getInfo: inv('db:get-info'), repair: inv('db:repair') },
  // 日志
  log: { openDir: inv('log:open-dir') },

  // 快捷键相关API
  shortcuts: {
    update: inv('shortcut:update'),
    reset: inv('shortcut:reset'),
    resetAll: inv('shortcut:reset-all'),
    getAll: inv('shortcut:get-all'),
  },

  // 图片相关API
  images: {
    saveFromBuffer: inv('image:save-from-buffer'),
    saveFromPath: inv('image:save-from-path'),
    selectFile: inv('image:select-file'),
    getPath: inv('image:get-path'),
    getBase64: inv('image:get-base64'),
    delete: inv('image:delete'),
  },

  // 画布图片存储API
  whiteboard: {
    saveImages: inv('whiteboard:save-images'),
    loadImages: inv('whiteboard:load-images'),
    loadImage: inv('whiteboard:load-image'),
    deleteImages: inv('whiteboard:delete-images'),
    getStorageStats: inv('whiteboard:get-storage-stats'),
    savePreview: (syncId, pngBase64) => ipcRenderer.invoke('whiteboard:save-preview', { syncId, pngBase64 }),
  },

  // AI 相关 API
  ai: {
    getConfig: inv('ai:get-config'),
    saveConfig: inv('ai:save-config'),
    testConnection: inv('ai:test-connection'),
    getProviders: inv('ai:get-providers'),
    chat: inv('ai:chat'),
    chatStream: (messages, options) => ipcRenderer.invoke('ai:chat-stream', { messages, options }),
    cancelStream: (requestId) => ipcRenderer.invoke('ai:cancel-stream', requestId),
    executePendingAction: inv('ai:execute-pending-action'),
    onChatChunk: listen('ai:chat-chunk'),
  },

  // STT (Speech-to-Text) 相关 API
  stt: {
    getConfig: inv('stt:get-config'),
    saveConfig: inv('stt:save-config'),
    testConnection: inv('stt:test-connection'),
    transcribe: (audioFile, options) => ipcRenderer.invoke('stt:transcribe', { audioFile, options }),
  },

  // 音频相关 API
  audio: {
    saveFromBuffer: inv('audio:save-from-buffer'),
    resolveSource: inv('audio:resolve-source')
  },

  // 通用附件 API（按 SHA-1 内容去重存到 attachments/）
  attachments: {
    saveFromPath: inv('attachments:save-from-path'),
    saveFromBuffer: inv('attachments:save-from-buffer'),
    open: inv('attachments:open'),
  },

  // 插件商店与插件运行时 API
  pluginStore: {
    listAvailable: inv('plugin-store:list-available'),
    listInstalled: inv('plugin-store:list-installed'),
    scanLocalPlugins: inv('plugin-store:scan-local'),
    getDetails: inv('plugin-store:get-details'),
    install: inv('plugin-store:install'),
    uninstall: inv('plugin-store:uninstall'),
    enable: inv('plugin-store:enable'),
    disable: inv('plugin-store:disable'),
    executeCommand: inv('plugin-store:execute-command'),
    openPluginFolder: inv('plugin-store:open-plugin-folder'),
    openPluginsDirectory: inv('plugin-store:open-plugins-directory'),
    loadPluginFile: inv('plugin-store:load-plugin-file'),
    onEvent: listen('plugin-store:event'),
    onUiRequest: listen('plugin:ui-open-note'),
    onOpenWindow: listen('plugin:ui-open-window'),
    onNotification: listen('plugin:notification'),
  },

  // Mem0 知识记忆 API
  mem0: {
    add: inv('mem0:add'),
    search: inv('mem0:search'),
    get: inv('mem0:get'),
    delete: inv('mem0:delete'),
    clear: inv('mem0:clear'),
    stats: inv('mem0:stats'),
    isAvailable: inv('mem0:is-available'),
    cleanup: inv('mem0:cleanup'),
    migrateHistorical: inv('mem0:migrate-historical'),
  },

  // 网络状态
  network: {
    isOnline: inv('network:is-online'),
    getOfflineQueueLength: inv('network:get-offline-queue-length'),
    onStatusChanged: listen('network:status-changed'),
  },

  // 云同步相关API
  sync: {
    getConfig: inv('sync:get-config'),
    getStatus: inv('sync:get-status'),
    saveConfig: inv('sync:save-config'),
    testConnection: inv('sync:test-connection'),
    switchService: inv('sync:switch-service'),
    disable: inv('sync:disable'),
    disconnect: inv('sync:disconnect'),
    enableCategory: inv('sync:enable-category'),
    disableCategory: inv('sync:disable-category'),
    manualSync: inv('sync:manual-sync'),
    resolveConflict: inv('sync:resolve-conflict'),
    forceFullSync: inv('sync:force-full-sync'),
    toggleAutoSync: inv('sync:toggle-auto-sync'),
    setAutoSyncInterval: inv('sync:set-auto-sync-interval'),
    clearAll: inv('sync:clear-all'),
    downloadImage: inv('sync:download-image'),
    uploadImage: inv('sync:upload-image'),
    cleanupUnusedImages: inv('sync:cleanup-unused-images'),
    getUnusedImagesStats: inv('sync:get-unused-images-stats'),
    onSyncStart: listen('sync:start'),
    onSyncProgress: listen('sync:progress'),
    onSyncComplete: listen('sync:complete'),
    onSyncError: listen('sync:error'),
    onConflictDetected: listen('sync:conflict'),
  },

  // MCP 相关 API
  mcp: {
    checkInstalled: inv('mcp:isInstalled'),
    getInstallInfo: inv('mcp:getInstallInfo'),
    install: inv('mcp:install'),
    uninstall: inv('mcp:uninstall'),
    getConfigPath: inv('mcp:getConfigPath'),
    onProgress: listen('mcp:install-progress'),
  },

  // 兼容旧代码的受限通用方法，禁止渲染层调用任意 IPC。
  invoke: (channel, ...args) => {
    if (!isAllowedInvokeChannel(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel, callback) => {
    if (isAllowedEventChannel(channel)) {
      ipcRenderer.on(channel, callback)
    }
  },
  removeListener: (channel, callback) => {
    if (isAllowedEventChannel(channel)) {
      ipcRenderer.removeListener(channel, callback)
    }
  },

  // 兼容旧代码的受限 ipcRenderer
  ipcRenderer: {
    on: (channel, callback) => {
      const validChannels = ['create-new-note', 'create-new-todo', 'open-settings', 'quick-input', 'todo:focus', 'system-theme-changed']
      if (validChannels.includes(channel)) ipcRenderer.on(channel, callback)
    },
    removeAllListeners: (channel) => {
      const validChannels = ['create-new-note', 'create-new-todo', 'open-settings', 'quick-input', 'todo:focus', 'system-theme-changed']
      if (validChannels.includes(channel)) ipcRenderer.removeAllListeners(channel)
    },
  },
})
