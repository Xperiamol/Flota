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

const useStore = create(
    persist(
        devtools(
            (set, get) => ({
                // 主题相关状态
                theme: 'system',
                primaryColor: '#1976d2',
                titleBarStyle: 'windows', // 标题栏样式：'mac' 或 'windows'
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
                // 工具栏按钮排序（null = 使用默认排序）
                toolbarOrder: null,
                // 浮动面板自定义格式项（null = 不显示额外格式项）
                floatingPanelItems: null,

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

                // 筛选器相关设置
                filtersDefaultVisible: true, // 筛选器默认是否显示

                // 主题相关 actions
                toggleTheme: () => set((state) => ({
                    theme: state.theme === 'light' ? 'dark' : 'light'
                })),

                setTheme: (theme) => set({ theme }),

                setPrimaryColor: (color) => set({ primaryColor: color }),

                setTitleBarStyle: (style) => set({ titleBarStyle: style }),

                setEditorMode: (mode) => set({ editorMode: mode }),

                setDefaultMinibarMode: (enabled) => set({ defaultMinibarMode: enabled }),

                setMaskOpacity: (opacity) => set({ maskOpacity: opacity }),

                setChristmasMode: (enabled) => set({ christmasMode: enabled }),

                setBackgroundPattern: (pattern) => set({ backgroundPattern: pattern }),

                setPatternOpacity: (opacity) => set({ patternOpacity: opacity }),

                setWallpaperPath: (path) => set({ wallpaperPath: path }),

                setAiPanelMode: (mode) => set({ aiPanelMode: mode }),

                setToolbarOrder: (order) => set({ toolbarOrder: order }),

                setFloatingPanelItems: (items) => set({ floatingPanelItems: items }),

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

                createNote: async (noteData) => {
                    try {
                        const result = await createNoteAPI(noteData)
                        if (result) {
                            const newNote = {
                                ...result,
                                tags: normalizeTags(result.tags)
                            }
                            set((state) => ({
                                notes: [newNote, ...state.notes],
                                selectedNoteId: newNote.id
                            }))
                            return { success: true, data: newNote }
                        }
                        return { success: false, error: 'Failed to create note' }
                    } catch (error) {
                        console.error('Failed to create note:', error)
                        return { success: false, error: error.message }
                    }
                },

                updateNote: async (id, updates) => {
                    try {
                        const result = await updateNoteAPI(id, updates)
                        if (result) {
                            const tags = Array.isArray(result.tags)
                                ? result.tags
                                : (typeof result.tags === 'string' && result.tags.trim())
                                    ? result.tags.split(',')
                                    : []
                            const updatedNote = { ...result, tags }

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
                                        console.log(`[Store] 更新白板元素数量缓存: noteId=${id}, count=${elementCount}`)
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
                        return { success: false, error: 'Failed to update note' }
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

                // 筛选器相关 actions
                setFiltersDefaultVisible: (visible) => set({ filtersDefaultVisible: visible }),

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
                                if (settings.userAvatar) {
                                    set({ userAvatar: settings.userAvatar })
                                }
                                if (settings.userName) {
                                    set({ userName: settings.userName })
                                }
                                if (settings.titleBarStyle) {
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
                                if (settings.wallpaperPath) {
                                    set({ wallpaperPath: settings.wallpaperPath })
                                }
                            }
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
                toolbarOrder: state.toolbarOrder,
                floatingPanelItems: state.floatingPanelItems,
                backgroundPattern: state.backgroundPattern,
                patternOpacity: state.patternOpacity,
                wallpaperPath: state.wallpaperPath,
            })
        }
    )
)

export { useStore }