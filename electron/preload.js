const { contextBridge, ipcRenderer } = require('electron')

// ── IPC 桥工厂 ──
const inv = (ch) => (...args) => ipcRenderer.invoke(ch, ...args)
const listen = (ch) => (cb) => {
  const h = (_, d) => cb(d)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  getVersion: inv('app-version'),
  helloWorld: inv('hello-world'),

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
    createFloatingBall: inv('window:create-floating-ball'),
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
    getPath: inv('system:get-path'),
    showOpenDialog: inv('system:show-open-dialog'),
    showSaveDialog: inv('system:show-save-dialog'),
    showMessageBox: inv('system:show-message-box'),
    openDataFolder: inv('system:open-data-folder'),
    readImageAsBase64: inv('system:read-image-as-base64'),
    writeText: inv('system:write-text'),
    readText: inv('system:read-text'),
    showNotification: inv('system:show-notification'),
    openExternal: inv('system:open-external'),
  },

  // 数据库调试
  db: { getInfo: inv('db:get-info'), repair: inv('db:repair') },
  // 日志
  log: { openDir: inv('log:open-dir') },

  // 同步诊断和修复
  diagnoseSync: inv('sync:diagnose'),
  fixMissingSyncId: inv('sync:fix-missing-sync-id'),

  // 悬浮球相关API
  floatingBall: {
    create: inv('floating-ball:create'),
    hide: inv('floating-ball:hide'),
    show: inv('floating-ball:show'),
  },

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

  // 白板图片存储API
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
  audio: { saveFromBuffer: inv('audio:save-from-buffer') },

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
  },

  // 网络状态
  network: {
    isOnline: inv('network:is-online'),
    getOfflineQueueLength: inv('network:get-offline-queue-length'),
    onStatusChanged: listen('network:status-changed'),
  },

  // 云同步相关API
  sync: {
    getAvailableServices: inv('sync:get-available-services'),
    getStatus: inv('sync:get-status'),
    testConnection: inv('sync:test-connection'),
    switchService: inv('sync:switch-service'),
    disable: inv('sync:disable'),
    enableCategory: inv('sync:enable-category'),
    disableCategory: inv('sync:disable-category'),
    manualSync: inv('sync:manual-sync'),
    forceStop: inv('sync:force-stop'),
    getConflicts: inv('sync:get-conflicts'),
    resolveConflict: inv('sync:resolve-conflict'),
    exportData: inv('sync:export-data'),
    importData: inv('sync:import-data'),
    forceFullSync: inv('sync:force-full-sync'),
    toggleAutoSync: inv('sync:toggle-auto-sync'),
    setAutoSyncInterval: inv('sync:set-auto-sync-interval'),
    clearAll: inv('sync:clear-all'),
    downloadImage: inv('sync:download-image'),
    uploadImage: inv('sync:upload-image'),
    syncImages: inv('sync:sync-images'),
    cleanupUnusedImages: inv('sync:cleanup-unused-images'),
    getUnusedImagesStats: inv('sync:get-unused-images-stats'),
    onSyncStart: listen('sync:start'),
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

  // 通用方法
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => ipcRenderer.on(channel, callback),
  removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),

  // 兼容旧代码的受限 ipcRenderer
  ipcRenderer: {
    on: (channel, callback) => {
      const validChannels = ['create-new-note', 'create-new-todo', 'open-settings', 'quick-input', 'system-theme-changed']
      if (validChannels.includes(channel)) ipcRenderer.on(channel, callback)
    },
    removeAllListeners: (channel) => {
      const validChannels = ['create-new-note', 'create-new-todo', 'open-settings', 'quick-input', 'system-theme-changed']
      if (validChannels.includes(channel)) ipcRenderer.removeAllListeners(channel)
    },
  },
})