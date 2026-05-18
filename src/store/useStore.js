import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import {
    fetchNotes,
    fetchDeletedNotes,
    createNote as createNoteAPI,
    updateNote as updateNoteAPI,
    deleteNote as deleteNoteAPI,
    restoreNote as restoreNoteAPI,
    permanentDeleteNote as permanentDeleteNoteAPI,
    batchDeleteNotes as batchDeleteNotesAPI,
    batchRestoreNotes as batchRestoreNotesAPI,
    batchPermanentDeleteNotes as batchPermanentDeleteNotesAPI,
    togglePinNote as togglePinNoteAPI,
    batchSetNoteTags
} from '../api/noteAPI'
import { fetchInstalledPlugins } from '../api/pluginAPI'
import { normalizeTags } from '../utils/tagUtils'
import { searchNotesAPI } from '../api/searchAPI'
import logger from '../utils/logger'

const IS_MACOS =
    typeof navigator !== 'undefined' &&
    String(navigator.userAgentData?.platform || Reflect.get(navigator, 'platform') || '')
        .toLowerCase()
        .includes('mac')

const DEFAULT_TIMELINE_TYPES = ['note', 'whiteboard', 'todo']
const DEFAULT_APP_UPDATE_INFO = {
    checking: false,
    checked: false,
    latestVersion: '',
    downloadUrl: 'https://github.com/Xperiamol/Flota/releases',
    hasUpdate: false,
    error: '',
}

const normalizeTimelineTypes = (types) => {
    if (!Array.isArray(types) || types.length === 0) return DEFAULT_TIMELINE_TYPES
    const raw = new Set(types)
    if (raw.has('note') && raw.has('todo') && raw.has('voice')) return DEFAULT_TIMELINE_TYPES

    const next = []
    if (raw.has('note') || raw.has('voice')) next.push('note')
    if (raw.has('whiteboard')) next.push('whiteboard')
    if (raw.has('todo')) next.push('todo')
    return next.length ? next : DEFAULT_TIMELINE_TYPES
}

const useStore = create(
    persist(
        devtools(
            (set, get) => ({
                // 主题相关状态
                theme: 'system',
                primaryColor: '#1976d2',
                // macOS 下强制使用 mac 样式（并在设置中隐藏该项）
                titleBarStyle: IS_MACOS ? 'mac' : 'windows', // 标题栏样式：'mac' 或 'windows'
                language: 'zh-CN', // 界面语言

                // 笔记相关状态
                notes: [],
                selectedNoteId: null,
                searchQuery: '',

                // 白板元素数量实时状态（用于预览更新）
                whiteboardElementCounts: {}, // noteId -> elementCount

                // UI 相关状态
                isLoading: false,
                sidebarOpen: true,
                currentView: 'notes', // 当前选中的视图：notes, todo, calendar, files, profile, settings
                userAvatar: '', // 用户头像
                userName: '', // 用户名称
                editorMode: 'wysiwyg', // 编辑器模式：'markdown' | 'wysiwyg'
                defaultMinibarMode: false, // 独立窗口默认minibar模式
                maskOpacity: 'medium', // 遮罩透明度：'none' | 'light' | 'medium' | 'heavy'
                christmasMode: false, // 圣诞模式：true | false
                backgroundPattern: 'none', // 背景花纹：'none' | 'dots' | 'grid' | ... | 'custom'
                patternOpacity: 1.0, // 花纹透明度倍率 0-2
                wallpaperPath: '', // 自定义壁纸路径

                // AI 面板显示模式：'selection' 选中文本时 | 'always' 始终显示 | 'disabled' 禁用
                aiPanelMode: 'selection',

                // AI 聊天对话状态
                aiConversations: [], // [{id, title, messages, createdAt, updatedAt}]
                aiActiveConvId: null,
                aiNoteConversationMap: {},
                aiMessageMultiSelectRequest: null,
                aiCommandRequest: null,
                aiCommandCenterEnabled: true,
                aiCommandCenterOpen: false,
                // 工具栏按钮排序（null = 使用默认排序）
                toolbarOrder: null,
                // 浮动面板自定义格式项（null = 不显示额外格式项）
                floatingPanelItems: null,
                // 编辑器右键菜单显示项（null = 使用默认项）
                contextMenuItems: null,

                // 插件商店相关 UI 状态
                pluginStoreFilters: {
                    tab: 'market',
                    category: 'all',
                    search: ''
                },
                pluginStoreSelectedPluginId: null,
                pluginStoreCategories: [],
                pluginCommands: [],

                // 设置页面相关状态
                settingsTabValue: 0, // 设置页面当前选中的标签页
                appVersion: '',
                appUpdateInfo: DEFAULT_APP_UPDATE_INFO,

                // 筛选器相关设置
                filtersDefaultVisible: true, // 筛选器默认是否显示
                todoNavigationRequest: null, // { filterBy, viewMode, showCompleted }

                // 时间轴筛选器状态（对齐手机端 TagFilterDrawer）
                timelineFilter: {
                    search: '',
                    types: ['note', 'whiteboard', 'todo'], // 可选：note / whiteboard / todo
                    tags: [],
                    dateRange: 'all', // all | today | week | month
                    showCompleted: true,
                    showFuture: false,
                    quickMode: 'all' // all | open | media | inbox
                },

                // 主题相关 actions
                toggleTheme: () => set((state) => ({
                    theme: state.theme === 'light' ? 'dark' : 'light'
                })),

                setTheme: (theme) => set({ theme }),

                setPrimaryColor: (color) => set({ primaryColor: color }),

                setTitleBarStyle: (style) => {
                    if (IS_MACOS) return
                    set({ titleBarStyle: style })
                },

                setEditorMode: (mode) => set({ editorMode: mode }),

                setDefaultMinibarMode: (enabled) => set({ defaultMinibarMode: enabled }),

                setMaskOpacity: (opacity) => set({ maskOpacity: opacity }),

                setChristmasMode: (enabled) => set({ christmasMode: enabled }),

                setBackgroundPattern: (pattern) => set({ backgroundPattern: pattern }),

                setPatternOpacity: (opacity) => set({ patternOpacity: opacity }),

                setWallpaperPath: (path) => set({ wallpaperPath: path }),

                setAiPanelMode: (mode) => set({ aiPanelMode: mode }),

                // AI 聊天对话管理
                aiNewChat: (options = {}) => {
                    const noteId = options.noteId == null ? null : String(options.noteId)
                    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
                    const newConv = {
                        id,
                        title: options.title || '新对话',
                        messages: [],
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        noteId,
                        source: noteId ? 'note' : 'general'
                    }
                    set(state => ({
                        aiConversations: [newConv, ...state.aiConversations],
                        aiActiveConvId: options.activate === false ? state.aiActiveConvId : id,
                        aiNoteConversationMap: noteId
                            ? { ...state.aiNoteConversationMap, [noteId]: id }
                            : state.aiNoteConversationMap
                    }))
                    return id
                },
                aiEnsureNoteChat: (noteId, options = {}) => {
                    if (noteId == null) {
                        const activeId = get().aiActiveConvId
                        if (activeId) return activeId
                        return get().aiNewChat(options)
                    }
                    const noteKey = String(noteId)
                    const state = get()
                    const mappedId = state.aiNoteConversationMap?.[noteKey]
                    const mappedConversation = mappedId
                        ? state.aiConversations.find((conversation) => conversation.id === mappedId)
                        : null
                    if (mappedConversation) {
                        if (options.activate !== false) set({ aiActiveConvId: mappedConversation.id })
                        return mappedConversation.id
                    }
                    const latestForNote = state.aiConversations.find((conversation) => String(conversation.noteId || '') === noteKey)
                    if (latestForNote) {
                        set((currentState) => ({
                            aiActiveConvId: options.activate === false ? currentState.aiActiveConvId : latestForNote.id,
                            aiNoteConversationMap: { ...currentState.aiNoteConversationMap, [noteKey]: latestForNote.id }
                        }))
                        return latestForNote.id
                    }
                    return get().aiNewChat({ ...options, noteId: noteKey, activate: options.activate !== false })
                },
                aiDeleteConv: (id) => set(state => {
                    const updated = state.aiConversations.filter(c => c.id !== id)
                    const aiNoteConversationMap = Object.fromEntries(
                        Object.entries(state.aiNoteConversationMap || {}).filter(([, convId]) => convId !== id)
                    )
                    return {
                        aiConversations: updated,
                        aiNoteConversationMap,
                        aiActiveConvId: state.aiActiveConvId === id
                            ? (updated[0]?.id || null)
                            : state.aiActiveConvId
                    }
                }),
                aiSwitchConv: (id) => set({ aiActiveConvId: id }),
                aiUpdateConv: (id, data) => set(state => ({
                    aiConversations: state.aiConversations.map(c =>
                        c.id === id ? { ...c, ...data, updatedAt: Date.now() } : c
                    )
                })),
                aiTriggerMessageMultiSelect: (convId, initialIndexes = []) => set((state) => ({
                    aiActiveConvId: convId || state.aiActiveConvId,
                    aiMessageMultiSelectRequest: {
                        requestId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        convId: convId || state.aiActiveConvId,
                        initialIndexes: Array.isArray(initialIndexes) ? initialIndexes : []
                    }
                })),
                aiClearMessageMultiSelectRequest: () => set({ aiMessageMultiSelectRequest: null }),
                aiDispatchCommand: (prompt, options = {}) => set({
                    aiCommandRequest: {
                        requestId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        prompt,
                        autoSend: options.autoSend !== false
                    }
                }),
                aiClearCommandRequest: () => set({ aiCommandRequest: null }),
                setAiCommandCenterEnabled: (enabled) => set((state) => ({
                    aiCommandCenterEnabled: Boolean(enabled),
                    aiCommandCenterOpen: Boolean(enabled) ? state.aiCommandCenterOpen : false
                })),
                setAiCommandCenterOpen: (open) => set((state) => ({
                    aiCommandCenterOpen: Boolean(open) && state.aiCommandCenterEnabled
                })),

                setToolbarOrder: (order) => set({ toolbarOrder: order }),

                setFloatingPanelItems: (items) => set({ floatingPanelItems: items }),

                setContextMenuItems: (items) => set({ contextMenuItems: items }),

                setLanguage: (language) => set({ language }),

                setPluginStoreFilters: (updates) => set((state) => ({
                    pluginStoreFilters: {
                        ...state.pluginStoreFilters,
                        ...(updates || {})
                    }
                })),

                setPluginStoreTab: (tab) => set((state) => ({
                    pluginStoreFilters: {
                        ...state.pluginStoreFilters,
                        tab: tab || 'market'
                    }
                })),

                setPluginStoreCategory: (category) => set((state) => ({
                    pluginStoreFilters: {
                        ...state.pluginStoreFilters,
                        category: category || 'all'
                    }
                })),

                setPluginStoreSearch: (search) => set((state) => ({
                    pluginStoreFilters: {
                        ...state.pluginStoreFilters,
                        search: search || ''
                    }
                })),

                setPluginStoreSelectedPluginId: (pluginId) => set({
                    pluginStoreSelectedPluginId: pluginId || null
                }),

                setPluginStoreCategories: (categories) => set({
                    pluginStoreCategories: Array.isArray(categories) ? categories : []
                }),

                setPluginCommands: (commands) => set({
                    pluginCommands: Array.isArray(commands) ? commands : []
                }),

                addPluginCommand: (entry) => {
                    if (!entry || !entry.commandId || !entry.pluginId) return
                    set((state) => {
                        const exists = state.pluginCommands.some(
                            (item) => item.pluginId === entry.pluginId && item.commandId === entry.commandId
                        )
                        if (exists) {
                            return {
                                pluginCommands: state.pluginCommands.map((item) =>
                                    item.pluginId === entry.pluginId && item.commandId === entry.commandId ? { ...item, ...entry } : item
                                )
                            }
                        }

                        return {
                            pluginCommands: [...state.pluginCommands, entry]
                        }
                    })
                },

                removePluginCommand: (pluginId, commandId) => {
                    if (!pluginId || !commandId) return
                    set((state) => ({
                        pluginCommands: state.pluginCommands.filter(
                            (item) => !(item.pluginId === pluginId && item.commandId === commandId)
                        )
                    }))
                },

                refreshPluginCommands: async () => {
                    try {
                        const installed = await fetchInstalledPlugins()
                        if (!Array.isArray(installed)) {
                            set({ pluginCommands: [] })
                            return []
                        }

                        const collected = []
                        installed.forEach((plugin) => {
                            if (!plugin?.enabled) return
                            const commands = Array.isArray(plugin.commands) ? plugin.commands : []
                            const pluginName = plugin?.manifest?.name || plugin?.id

                            commands.forEach((command) => {
                                collected.push({
                                    pluginId: plugin.id,
                                    pluginName,
                                    commandId: command.id,
                                    title: command.title || command.id,
                                    description: command.description || '',
                                    icon: command.icon || null,
                                    shortcut: command.shortcut || null,
                                    shortcutBinding: command.shortcutBinding || null,
                                    surfaces: Array.isArray(command.surfaces)
                                        ? command.surfaces
                                            .map((surface) => (typeof surface === 'string' ? surface.trim() : ''))
                                            .filter(Boolean)
                                        : [],
                                    raw: command
                                })
                            })
                        })

                        set({ pluginCommands: collected })
                        return collected
                    } catch (error) {
                        console.error('Failed to refresh plugin commands:', error)
                        set({ pluginCommands: [] })
                        return []
                    }
                },

                // 设置页面相关 actions
                setSettingsTabValue: (value) => set({ settingsTabValue: value }),

                // 笔记相关 actions
                loadNotes: async (options = {}) => {
                    set({ isLoading: true })
                    try {
                        const payload = options.deleted ? await fetchDeletedNotes() : await fetchNotes(options)
                        const rawNotes = Array.isArray(payload) ? payload : (payload?.notes || [])
                        const normalized = rawNotes.map(n => ({
                            ...n,
                            tags: normalizeTags(n.tags)
                        }))

                        // 每次都用数据库内容重建白板元素数量缓存，确保预览与实际一致
                        const elementCounts = {}
                        normalized.forEach(note => {
                            if (note.note_type === 'whiteboard' && note.content) {
                                try {
                                    const whiteboardData = JSON.parse(note.content)
                                    elementCounts[note.id] = whiteboardData.elements?.length || 0
                                } catch (error) {
                                    console.warn('Failed to parse whiteboard content for element count:', error)
                                    elementCounts[note.id] = 0
                                }
                            }
                        })

                        set({
                            notes: normalized,
                            whiteboardElementCounts: elementCounts,
                            isLoading: false
                        })
                    } catch (error) {
                        console.error('Failed to load notes:', error)
                        set({ isLoading: false })
                    }
                },

                createNote: async (noteData = {}) => {
                    try {
                        const payloadToCreate = {
                            title: '',
                            content: '',
                            tags: [],
                            note_type: 'markdown',
                            ...noteData
                        }
                        const result = await createNoteAPI(payloadToCreate)
                        const payload = result?.data || result
                        if (result?.success || payload) {
                            const newNote = {
                                ...payload,
                                tags: normalizeTags(payload.tags)
                            }
                            set((state) => ({
                                notes: [newNote, ...state.notes],
                                selectedNoteId: newNote.id
                            }))
                            return { success: true, data: newNote }
                        }
                        return { success: false, error: result?.error || 'Failed to create note' }
                    } catch (error) {
                        console.error('Failed to create note:', error)
                        return { success: false, error: error.message }
                    }
                },

                updateNote: async (id, updates) => {
                    try {
                        const result = await updateNoteAPI(id, updates)
                        const payload = result?.data || result
                        if (result?.success || payload) {
                            const tags = Array.isArray(payload.tags)
                                ? payload.tags
                                : (typeof payload.tags === 'string' && payload.tags.trim())
                                    ? payload.tags.split(',')
                                    : []
                            const updatedNote = { ...payload, tags }

                            // 准备更新状态
                            const stateUpdate = {
                                notes: null, // 将在下面设置
                            }

                            // 如果是白板笔记，从传入的updates或返回的result中更新元素数量缓存
                            if (updatedNote.note_type === 'whiteboard') {
                                // 优先使用传入的content（这是最新保存的内容）
                                const contentToUse = updates.content || updatedNote.content
                                if (contentToUse) {
                                    try {
                                        const whiteboardData = JSON.parse(contentToUse)
                                        const elementCount = whiteboardData.elements?.length || 0
                                        stateUpdate.whiteboardElementCounts = elementCount
                                        logger.log(`[Store] 更新白板元素数量缓存: noteId=${id}, count=${elementCount}`)
                                    } catch (error) {
                                        console.warn('Failed to parse whiteboard content for element count:', error)
                                    }
                                }
                            }

                            // 一次性更新状态
                            set((state) => ({
                                notes: state.notes.map(note =>
                                    note.id === id ? updatedNote : note
                                ),
                                ...(stateUpdate.whiteboardElementCounts !== undefined && {
                                    whiteboardElementCounts: {
                                        ...state.whiteboardElementCounts,
                                        [id]: stateUpdate.whiteboardElementCounts
                                    }
                                })
                            }))

                            return { success: true, data: updatedNote }
                        }
                        return { success: false, error: result?.error || 'Failed to update note' }
                    } catch (error) {
                        console.error('Failed to update note:', error)
                        return { success: false, error: error.message }
                    }
                },

                deleteNote: async (id) => {
                    try {
                        const result = await deleteNoteAPI(id)
                        if (result?.success) {
                            set((state) => ({
                                notes: state.notes.filter(note => note.id !== id),
                                selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
                                whiteboardElementCounts: { ...state.whiteboardElementCounts, [id]: undefined }
                            }))
                            return { success: true }
                        }
                        return { success: false, error: result?.error || 'Failed to delete note' }
                    } catch (error) {
                        console.error('Failed to delete note:', error)
                        return { success: false, error: error.message }
                    }
                },

                restoreNote: async (id) => {
                    try {
                        const result = await restoreNoteAPI(id)
                        if (result?.success || result?.id) {
                            get().loadNotes()
                            return { success: true }
                        }
                        return { success: false, error: result?.error || 'Failed to restore note' }
                    } catch (error) {
                        console.error('Failed to restore note:', error)
                        return { success: false, error: error.message }
                    }
                },

                permanentDeleteNote: async (id) => {
                    try {
                        const result = await permanentDeleteNoteAPI(id)
                        if (result?.success || result === true) {
                            set((state) => ({
                                notes: state.notes.filter(note => note.id !== id),
                                selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
                                whiteboardElementCounts: { ...state.whiteboardElementCounts, [id]: undefined }
                            }))
                            return { success: true }
                        }
                        return { success: false, error: result?.error || 'Failed to permanently delete note' }
                    } catch (error) {
                        console.error('Failed to permanently delete note:', error)
                        return { success: false, error: error.message }
                    }
                },

                setSelectedNoteId: (id) => set({ selectedNoteId: id }),

                // 局部更新笔记列表中的单个笔记（不重新排序）
                updateNoteInList: (updatedNote) => {
                    set((state) => ({
                        notes: state.notes.map(note =>
                            note.id === updatedNote.id ? { ...note, ...updatedNote } : note
                        )
                    }))
                },

                // 批量删除笔记
                batchDeleteNotes: async (ids) => {
                    try {
                        const result = await batchDeleteNotesAPI(ids)
                        if (result?.success || result === true) {
                            set((state) => ({
                                notes: state.notes.filter(note => !ids.includes(note.id)),
                                selectedNoteId: ids.includes(state.selectedNoteId) ? null : state.selectedNoteId
                            }))
                            return { success: true }
                        }
                        return { success: false, error: result?.error || 'Failed to batch delete notes' }
                    } catch (error) {
                        console.error('Failed to batch delete notes:', error)
                        return { success: false, error: error.message }
                    }
                },

                // 批量恢复笔记
                batchRestoreNotes: async (ids) => {
                    try {
                        const result = await batchRestoreNotesAPI(ids)
                        if (result?.success || result === true) {
                            await get().loadNotes()
                            return { success: true }
                        }
                        return { success: false, error: result?.error || 'Failed to batch restore notes' }
                    } catch (error) {
                        console.error('Failed to batch restore notes:', error)
                        return { success: false, error: error.message }
                    }
                },

                // 批量永久删除笔记
                batchPermanentDeleteNotes: async (ids) => {
                    try {
                        const result = await batchPermanentDeleteNotesAPI(ids)
                        if (result?.success || result === true) {
                            set((state) => ({
                                notes: state.notes.filter(note => !ids.includes(note.id)),
                                selectedNoteId: ids.includes(state.selectedNoteId) ? null : state.selectedNoteId
                            }))
                            return { success: true }
                        }
                        return { success: false, error: result?.error || 'Failed to batch permanent delete notes' }
                    } catch (error) {
                        console.error('Failed to batch permanent delete notes:', error)
                        return { success: false, error: error.message }
                    }
                },

                // 批量删除待办事项
                batchDeleteTodos: async (ids) => {
                    try {
                        if (window.electronAPI?.todos) {
                            const result = await window.electronAPI.todos.batchDelete(ids)
                            if (result?.success) {
                                return { success: true }
                            }
                        }
                        return { success: false, error: 'Failed to batch delete todos' }
                    } catch (error) {
                        console.error('Failed to batch delete todos:', error)
                        return { success: false, error: error.message }
                    }
                },

                // 批量完成待办事项
                batchCompleteTodos: async (ids) => {
                    try {
                        if (window.electronAPI?.todos) {
                            const result = await window.electronAPI.todos.batchComplete(ids)
                            if (result?.success) {
                                return { success: true }
                            }
                        }
                        return { success: false, error: 'Failed to batch complete todos' }
                    } catch (error) {
                        console.error('Failed to batch complete todos:', error)
                        return { success: false, error: error.message }
                    }
                },

                setSearchQuery: (query) => set({ searchQuery: query }),

                // 搜索笔记 - 使用通用搜索API
                searchNotes: async (query) => {
                    try {
                        const result = await searchNotesAPI(query)

                        if (result?.success) {
                            set({ notes: result.data, searchQuery: query })
                            return result
                        }

                        return result
                    } catch (error) {
                        console.error('Failed to search notes:', error)
                        return { success: false, error: error.message }
                    }
                },

                // 切换笔记置顶状态
                togglePinNote: async (id) => {
                    try {
                        const result = await togglePinNoteAPI(id)
                        const payload = result?.data || result
                        if ((result?.success || payload) && payload) {
                            const updatedNote = {
                                ...payload,
                                tags: Array.isArray(payload.tags)
                                    ? payload.tags
                                    : (typeof payload.tags === 'string' && payload.tags.trim())
                                        ? payload.tags.split(',')
                                        : []
                            }
                            set((state) => ({
                                notes: state.notes.map(note =>
                                    note.id === id ? updatedNote : note
                                )
                            }))
                            return { success: true, data: updatedNote }
                        }
                        return { success: false, error: result?.error || 'Failed to toggle pin note' }
                    } catch (error) {
                        console.error('Failed to toggle pin note:', error)
                        return { success: false, error: error.message }
                    }
                },

                // UI 相关 actions
                setLoading: (loading) => set({ isLoading: loading }),

                toggleSidebar: () => set((state) => ({
                    sidebarOpen: !state.sidebarOpen
                })),

                setCurrentView: (view) => set({ currentView: view }),

                setTodoNavigationRequest: (request) => set({
                    todoNavigationRequest: request ? {
                        filterBy: request.filterBy || 'all',
                        viewMode: request.viewMode || 'focus',
                        showCompleted: typeof request.showCompleted === 'boolean' ? request.showCompleted : false,
                    } : null
                }),

                consumeTodoNavigationRequest: () => {
                    const request = get().todoNavigationRequest
                    if (request) {
                        set({ todoNavigationRequest: null })
                    }
                    return request || null
                },

                setAppVersion: (version) => set({ appVersion: String(version || '') }),

                checkForUpdates: async ({ silent = false } = {}) => {
                    if (!window.electronAPI?.system?.checkForUpdates) return null
                    const previous = get().appUpdateInfo || DEFAULT_APP_UPDATE_INFO
                    set({
                        appUpdateInfo: {
                            ...previous,
                            checking: true,
                            error: silent ? '' : previous.error,
                        }
                    })
                    try {
                        const result = await window.electronAPI.system.checkForUpdates()
                        if (!result?.success || !result?.data?.latestVersion) {
                            throw new Error(result?.error || '未获取到最新版本号')
                        }
                        set({
                            appVersion: String(result.data.currentVersion || get().appVersion || ''),
                            appUpdateInfo: {
                                checking: false,
                                checked: true,
                                latestVersion: result.data.latestVersion,
                                downloadUrl: result.data.downloadUrl || DEFAULT_APP_UPDATE_INFO.downloadUrl,
                                hasUpdate: Boolean(result.data.hasUpdate),
                                error: '',
                            }
                        })
                        return result
                    } catch (error) {
                        const message = String(error?.message || '')
                        const friendlyMessage = message.includes("No handler registered for 'system:check-for-updates'")
                            ? '更新检查模块已更新，请重启应用后再试'
                            : (error?.message || '检查更新失败')
                        set({
                            appUpdateInfo: {
                                checking: false,
                                checked: false,
                                latestVersion: '',
                                downloadUrl: DEFAULT_APP_UPDATE_INFO.downloadUrl,
                                hasUpdate: false,
                                error: silent ? '' : friendlyMessage,
                            }
                        })
                        return { success: false, error: friendlyMessage }
                    }
                },

                // 筛选器相关 actions
                setFiltersDefaultVisible: (visible) => set({ filtersDefaultVisible: visible }),

                // 时间轴筛选器 actions
                setTimelineFilter: (partial) => set((state) => ({
                    timelineFilter: {
                        ...state.timelineFilter,
                        ...(typeof partial === 'function' ? partial(state.timelineFilter) : partial)
                    }
                })),
                toggleTimelineType: (type) => set((state) => {
                    const cur = normalizeTimelineTypes(state.timelineFilter.types)
                    const next = cur.includes(type)
                        ? cur.filter((t) => t !== type)
                        : [...cur, type]
                    return { timelineFilter: { ...state.timelineFilter, types: next.length ? next : cur } }
                }),
                toggleTimelineTag: (tag) => set((state) => {
                    const cur = state.timelineFilter.tags
                    return {
                        timelineFilter: {
                            ...state.timelineFilter,
                            tags: cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]
                        }
                    }
                }),
                resetTimelineFilter: () => set((state) => ({
                    timelineFilter: {
                        ...state.timelineFilter,
                        search: '',
                        tags: [],
                        dateRange: 'all',
                        types: ['note', 'whiteboard', 'todo'],
                        showCompleted: true,
                        showFuture: false,
                        quickMode: 'all'
                    }
                })),

                // 用户头像相关 actions
                setUserAvatar: (avatar) => set({ userAvatar: avatar }),

                // 用户名称相关 actions
                setUserName: (name) => set({ userName: name }),

                // 初始化设置
                initializeSettings: async () => {
                    try {
                        if (window.electronAPI?.settings) {
                            const result = await window.electronAPI.settings.getAll()
                            if (result?.success && result.data) {
                                const settings = result.data
                                if (settings.theme) {
                                    set({ theme: settings.theme })
                                }
                                if (settings.customThemeColor) {
                                    set({ primaryColor: settings.customThemeColor })
                                }
                                if (settings.userAvatar !== undefined) {
                                    set({ userAvatar: settings.userAvatar || '' })
                                }
                                if (settings.userName !== undefined) {
                                    set({ userName: settings.userName || '' })
                                }
                                if (!IS_MACOS && settings.titleBarStyle) {
                                    set({ titleBarStyle: settings.titleBarStyle })
                                }
                                if (settings.language) {
                                    set({ language: settings.language })
                                }
                                if (settings.defaultMinibarMode !== undefined) {
                                    set({ defaultMinibarMode: Boolean(settings.defaultMinibarMode) })
                                }
                                if (settings.christmasMode !== undefined) {
                                    set({ christmasMode: Boolean(settings.christmasMode) })
                                }
                                if (settings.maskOpacity) {
                                    set({ maskOpacity: settings.maskOpacity })
                                }
                                if (settings.backgroundPattern) {
                                    set({ backgroundPattern: settings.backgroundPattern })
                                }
                                if (settings.patternOpacity !== undefined) {
                                    set({ patternOpacity: Number(settings.patternOpacity) })
                                }
                                if (settings.wallpaperPath !== undefined) {
                                    set({ wallpaperPath: settings.wallpaperPath || '' })
                                }
                                if (settings.editorMode) {
                                    set({ editorMode: settings.editorMode })
                                }
                                if (settings.aiPanelMode) {
                                    set({ aiPanelMode: settings.aiPanelMode })
                                }
                                if (settings.toolbarOrder !== undefined) {
                                    set({ toolbarOrder: settings.toolbarOrder || null })
                                }
                                if (settings.floatingPanelItems !== undefined) {
                                    set({ floatingPanelItems: settings.floatingPanelItems || null })
                                }
                                if (settings.contextMenuItems !== undefined) {
                                    set({ contextMenuItems: settings.contextMenuItems || null })
                                }
                            }
                        }
                        // 兜底：macOS 下始终锁定为 mac，避免历史持久化/远端写入覆盖
                        if (IS_MACOS) {
                            set({ titleBarStyle: 'mac' })
                        }
                    } catch (error) {
                        console.error('Failed to load settings:', error)
                    }
                },

                // 标签相关 actions
                getAllTags: async () => {
                    try {
                        if (window.electronAPI?.tags) {
                            const result = await window.electronAPI.tags.getAll()
                            if (result?.success) {
                                return result.data || []
                            }
                        }
                        return []
                    } catch (error) {
                        console.error('Failed to get all tags:', error)
                        return []
                    }
                },

                // 批量设置标签
                batchSetTags: async (noteIds, tags, replaceMode = false) => {
                    try {
                        if (noteIds.length === 0) {
                            return { success: false, error: '无效的参数' }
                        }

                        const result = await batchSetNoteTags({
                            noteIds,
                            tags,
                            replaceMode
                        })

                        if (result?.success) {
                            const { loadNotes } = get()
                            await loadNotes()
                            return { success: true, data: result.data }
                        }

                        return { success: false, error: result?.error || '批量设置标签失败' }
                    } catch (error) {
                        console.error('Failed to batch set tags:', error)
                        return { success: false, error: error.message }
                    }
                }
            }),
            {
                name: 'Flota-store'
            }
        ),
        {
            name: 'Flota-theme-settings',
            partialize: (state) => ({
                theme: state.theme,
                primaryColor: state.primaryColor,
                titleBarStyle: state.titleBarStyle,
                maskOpacity: state.maskOpacity,
                christmasMode: state.christmasMode,
                editorMode: state.editorMode,
                aiPanelMode: state.aiPanelMode,
                aiCommandCenterEnabled: state.aiCommandCenterEnabled,
                aiConversations: state.aiConversations || [],
                aiActiveConvId: state.aiActiveConvId,
                aiNoteConversationMap: state.aiNoteConversationMap || {},
                toolbarOrder: state.toolbarOrder,
                floatingPanelItems: state.floatingPanelItems,
                contextMenuItems: state.contextMenuItems,
                backgroundPattern: state.backgroundPattern,
                patternOpacity: state.patternOpacity,
                wallpaperPath: state.wallpaperPath,
            })
        }
    )
)

export { useStore }
