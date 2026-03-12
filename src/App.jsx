import React, { useEffect, useState, lazy, Suspense, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import * as MaterialUI from '@mui/material'
import * as MaterialIcons from '@mui/icons-material'
import { CacheProvider } from '@emotion/react'
import createCache from '@emotion/cache'
import {
  ThemeProvider,
  CssBaseline,
  Box,
  AppBar,
  useMediaQuery,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  CircularProgress
} from '@mui/material'
import {
  Restore as RestoreIcon,
  DeleteForever as DeleteForeverIcon,
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon
} from '@mui/icons-material'
import { useStore } from './store/useStore'
import { createAppTheme } from './styles/theme'
import { generatePatternCSS } from './utils/patternStyles'
import { initI18n } from './utils/i18n'
import Toolbar from './components/Toolbar'
import NoteList from './components/NoteList'
import NoteEditor from './components/NoteEditor'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import MultiSelectToolbar from './components/MultiSelectToolbar'
import TagSelectionDialog from './components/TagSelectionDialog'
import DragAnimationProvider from './components/DragAnimationProvider'
import TodoEditDialog from './components/TodoEditDialog'
import CreateTodoModal from './components/CreateTodoModal'
import CommandPalette from './components/CommandPalette'
import { ErrorProvider, useError } from './components/ErrorProvider'
import logger from './utils/logger'

// 懒加载非首屏组件，减少初始bundle大小
const TodoView = lazy(() => import('./components/TodoView'))
const CalendarView = lazy(() => import('./components/CalendarView'))
const Settings = lazy(() => import('./components/Settings'))
const PluginStore = lazy(() => import('./components/PluginStore'))
const SecondarySidebar = lazy(() => import('./components/SecondarySidebar'))
const Profile = lazy(() => import('./components/Profile'))
const AIChatView = lazy(() => import('./components/AIChatView'))
const ConflictResolutionDialog = lazy(() => import('./components/ConflictResolutionDialog'))
const ChristmasDecorations = lazy(() => import('./components/ChristmasSnow'))

// 加载指示器组件
const LoadingFallback = () => (
  <Box display="flex" justifyContent="center" alignItems="center" height="100%">
    <CircularProgress />
  </Box>
)

function rewriteCssUrls(cssText, sheetHref) {
  if (!cssText || !sheetHref) {
    return cssText
  }

  try {
    return cssText.replace(/url\(([^)]+)\)/g, (match, raw) => {
      if (!raw) return match
      const cleaned = raw.trim().replace(/^['"]|['"]$/g, '')
      if (/^(data:|https?:|file:|app:|#)/i.test(cleaned)) {
        return match
      }
      try {
        const absolute = new URL(cleaned, sheetHref).href
        // logger.log('[Plugin Window] Rewriting URL:', cleaned, '->', absolute)
        return `url("${absolute}")`
      } catch (err) {
        console.warn('[Plugin Window] URL 重写失败:', cleaned, err)
        return match
      }
    })
  } catch (error) {
    console.warn('[Plugin Window] CSS URL 重写失败:', error)
    return cssText
  }
}

// 辅助函数：同步样式到 iframe
const syncIframeStyles = async (iframe) => {
  if (!iframe || !iframe.contentWindow) return

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document
    const iframeHead = iframeDoc.head

    // 移除旧的样式（避免重复）
    const oldStyles = iframeHead.querySelectorAll('style[data-emotion], style[data-inline-css], style[data-source], link[data-injected]')
    oldStyles.forEach(s => s.remove())

    // 方案1：直接在 iframe 中添加 <link> 标签引用主应用的 CSS 文件
    const mainStyleLinks = document.querySelectorAll('link[rel="stylesheet"]')
    mainStyleLinks.forEach(link => {
      const clonedLink = iframeDoc.createElement('link')
      clonedLink.rel = 'stylesheet'
      clonedLink.href = link.href
      clonedLink.setAttribute('data-injected', 'true')
      iframeHead.appendChild(clonedLink)
    })

    // 方案2：复制所有 emotion 样式标签（Material-UI 的动态样式）
    // 这些样式会随着组件渲染动态增加，所以需要持续监听
    const copyEmotionStyles = () => {
      const emotionStyles = document.querySelectorAll('style[data-emotion]')
      const iframeEmotionStyles = iframeHead.querySelectorAll('style[data-emotion]')

      // 移除 iframe 中旧的 emotion 样式
      iframeEmotionStyles.forEach(s => s.remove())

      // 复制新的样式
      if (emotionStyles.length > 0) {
        let totalLength = 0
        emotionStyles.forEach(style => {
          const cloned = style.cloneNode(true)
          iframeHead.appendChild(cloned)
          totalLength += style.textContent?.length || 0
        })
        logger.log(`[Plugin Window] ✅ 已同步 ${emotionStyles.length} 个 emotion 样式，总长度: ${totalLength} 字符`)
      }
    }

    // 立即复制一次
    copyEmotionStyles()

    // 持续监听主文档的样式变化，自动同步到 iframe
    const styleObserver = new MutationObserver(() => {
      copyEmotionStyles()
    })

    styleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-emotion']
    })

    // 将观察器保存到 iframe，以便后续清理
    if (!iframe.__styleObserver) {
      iframe.__styleObserver = styleObserver
    }

    const totalStyles = iframeHead.querySelectorAll('style').length
    const totalLinks = iframeHead.querySelectorAll('link[rel="stylesheet"]').length
    logger.log(`[Plugin Window] 样式初始化完成 - Style: ${totalStyles}, Link: ${totalLinks}`)
  } catch (err) {
    console.warn('[Plugin Window] 同步样式失败:', err)
  }
}
import { createTodo as createTodoAPI } from './api/todoAPI'
import TimeZoneUtils from './utils/timeZoneUtils'
import { subscribePluginEvents, subscribePluginUiRequests, subscribePluginWindowRequests, loadPluginFile, executePluginCommand } from './api/pluginAPI'
import { injectUIBridge } from './utils/pluginUIBridge'
import themeManager from './utils/pluginThemeManager'
import { PluginNotificationListener } from './utils/PluginNotificationListener'

function App() {
  const { theme, setTheme, primaryColor, loadNotes, currentView, initializeSettings, setCurrentView, createNote, batchDeleteNotes, batchDeleteTodos, batchCompleteTodos, batchRestoreNotes, batchPermanentDeleteNotes, getAllTags, batchSetTags, selectedNoteId, setSelectedNoteId, updateNoteInList, maskOpacity, christmasMode, backgroundPattern, patternOpacity, wallpaperPath } = useStore()
  const refreshPluginCommands = useStore((state) => state.refreshPluginCommands)
  const addPluginCommand = useStore((state) => state.addPluginCommand)
  const removePluginCommand = useStore((state) => state.removePluginCommand)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [secondarySidebarOpen, setSecondarySidebarOpen] = useState(true)
  const [showDeleted, setShowDeleted] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // TODO视图相关状态
  const [todoViewMode, setTodoViewMode] = useState('quadrant')
  const [todoShowCompleted, setTodoShowCompleted] = useState(false)
  const [selectedTodo, setSelectedTodo] = useState(null)
  const [showTodoCreateForm, setShowTodoCreateForm] = useState(false)
  const [todoSortBy, setTodoSortBy] = useState('priority')
  const [initialTodoData, setInitialTodoData] = useState(null) // 用于预设初始todo数据

  // 初始todo状态定义
  const initialTodoState = {
    content: '',
    description: '',
    is_important: false,
    is_urgent: false,
    due_date: '',
    due_time: '',
    repeat_type: 'none',
    repeat_interval: 1,
    repeat_days: '',
    tags: ''
  };

  const [newTodo, setNewTodo] = useState(initialTodoState);

  // 日历视图相关状态
  const [calendarCurrentDate, setCalendarCurrentDate] = useState(new Date())

  // 暴露当前选中笔记ID给主进程（AI助手用）
  useEffect(() => { window.__currentSelectedNoteId = selectedNoteId }, [selectedNoteId])
  const [selectedDate, setSelectedDate] = useState(null)
  const [calendarShowCompleted, setCalendarShowCompleted] = useState(false)
  const [calendarViewMode, setCalendarViewMode] = useState('todos') // 'todos', 'notes', 'focus'

  // 日历视图模式变化处理（带调试）
  const handleCalendarViewModeChange = useCallback((mode) => {
    logger.log('Calendar view mode changing from', calendarViewMode, 'to', mode);
    setCalendarViewMode(mode);
  }, [calendarViewMode])

  // 多选状态管理
  const [multiSelectState, setMultiSelectState] = useState({
    isActive: false,
    selectedIds: [],
    selectedCount: 0,
    totalCount: 0,
    itemType: ''
  })

  // 插件窗口状态
  const [pluginWindow, setPluginWindow] = useState(null)

  // 存储当前多选实例的引用
  const [currentMultiSelectRef, setCurrentMultiSelectRef] = useState(null)

  // 待办事项刷新触发器
  const [todoRefreshTrigger, setTodoRefreshTrigger] = useState(0)
  const [calendarRefreshTrigger, setCalendarRefreshTrigger] = useState(0)
  const handleTodoDialogClose = () => setSelectedTodo(null)
  const handleTodoUpdated = () => {
    setTodoRefreshTrigger(prev => prev + 1)
    setCalendarRefreshTrigger(prev => prev + 1)
  }

  // 永久删除确认状态
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState(false)
  const [todoPermanentDeleteConfirm, setTodoPermanentDeleteConfirm] = useState(false)

  // 标签选择对话框状态
  const [tagSelectionDialogOpen, setTagSelectionDialogOpen] = useState(false)
  const [selectedNotesForTagging, setSelectedNotesForTagging] = useState([])

  // 同步冲突解决对话框状态
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false)
  const [currentConflict, setCurrentConflict] = useState(null)

  // 解析实际显示的主题（保持用户偏好 'system' 不变，仅用于渲染）
  const resolveDisplayTheme = (pref) => {
    if (pref === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return pref === 'dark' ? 'dark' : 'light'
  }
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveDisplayTheme(theme))

  const appTheme = createAppTheme(resolvedTheme, primaryColor)

  // 根据遮罩透明度设置获取对应的透明度值
  const getMaskOpacityValue = (isDark) => {
    const opacityMap = {
      none: { dark: 0, light: 0 },
      light: { dark: 0.4, light: 0.35 },
      medium: { dark: 0.6, light: 0.6 },
      heavy: { dark: 0.85, light: 0.85 }
    }
    const values = opacityMap[maskOpacity] || opacityMap.medium
    return isDark ? values.dark : values.light
  }
  const isMobile = useMediaQuery(appTheme.breakpoints.down('md'))

  // 主题壁纸 - 注入/更新背景花纹CSS
  useEffect(() => {
    const styleId = 'flota-background-pattern'
    let styleEl = document.getElementById(styleId)

    if (backgroundPattern === 'none' || !backgroundPattern) {
      if (styleEl) styleEl.remove()
      return
    }

    const css = generatePatternCSS(backgroundPattern, primaryColor, patternOpacity, wallpaperPath)
    if (!css) {
      if (styleEl) styleEl.remove()
      return
    }

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = css
    return () => { styleEl?.remove() }
  }, [backgroundPattern, primaryColor, patternOpacity, wallpaperPath])

  // 暴露插件API到全局对象（用于调试和测试）
  useEffect(() => {
    if (!window.FlotaPlugin) {
      window.FlotaPlugin = {
        executeCommand: executePluginCommand
      }
    }
  }, [])

  // 当用户手动切换主题偏好时，同步更新 resolvedTheme
  useEffect(() => {
    setResolvedTheme(resolveDisplayTheme(theme))
  }, [theme])

  // 监听系统主题变化 - 只更新 resolvedTheme，不改变用户的偏好设置
  useEffect(() => {
    if (!window.electronAPI?.ipcRenderer) return

    const handleSystemThemeChange = (_, data) => {
      if (theme === 'system') {
        setResolvedTheme(data.shouldUseDarkColors ? 'dark' : 'light')
      }
    }

    window.electronAPI.ipcRenderer.on('system-theme-changed', handleSystemThemeChange)
    return () => {
      window.electronAPI.ipcRenderer.removeAllListeners('system-theme-changed')
    }
  }, [theme])

  // 处理初始todo数据变化
  useEffect(() => {
    if (initialTodoData) {
      setNewTodo({ ...initialTodoState, ...initialTodoData });
    } else {
      setNewTodo(initialTodoState);
    }
  }, [initialTodoData]);

  // 监听来自独立窗口的笔记更新（实现同步）
  useEffect(() => {
    if (!window.electronAPI?.notes?.onNoteUpdated) return

    const handleNoteUpdate = (updatedNote) => {
      logger.log('接收到笔记更新事件:', updatedNote)
      // 使用局部更新而不是重新加载整个列表，避免不必要的排序
      if (updatedNote && updatedNote.id) {
        updateNoteInList(updatedNote)
      }
    }

    const unsubscribe = window.electronAPI.notes.onNoteUpdated(handleNoteUpdate)

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [updateNoteInList])

  useEffect(() => {
    refreshPluginCommands()
  }, [refreshPluginCommands])

  // 监听视图切换，只在切换到笔记视图时重新加载并排序笔记列表
  useEffect(() => {
    if (currentView === 'notes') {
      logger.log('[App] 切换到笔记视图，重新加载笔记列表');
      loadNotes();
    }
  }, [currentView, loadNotes]);

  // 监听视图切换，自动退出多选模式
  useEffect(() => {
    // 当切换功能区时，退出多选状态
    if (currentMultiSelectRef) {
      currentMultiSelectRef.exitMultiSelectMode();
    }
  }, [currentView]);

  // 监听命令面板快捷键 (Ctrl+Shift+P / Cmd+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Shift+P (Windows/Linux) 或 Cmd+Shift+P (Mac)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const unsubscribe = subscribePluginEvents((event) => {
      if (!event) return

      logger.log('[App] 收到插件事件:', event.type, event)

      if (event.type === 'command-registered' && event.command && event.pluginId) {
        const surfaces = Array.isArray(event.command.surfaces)
          ? event.command.surfaces
            .map((surface) => (typeof surface === 'string' ? surface.trim() : ''))
            .filter(Boolean)
          : []

        addPluginCommand({
          pluginId: event.pluginId,
          pluginName: event.plugin?.manifest?.name || event.plugin?.id || event.pluginId,
          commandId: event.command.id,
          title: event.command.title || event.command.id,
          description: event.command.description || '',
          icon: event.command.icon || null,
          shortcut: event.command.shortcut || null,
          shortcutBinding: event.command.shortcutBinding || null,
          surfaces,
          raw: event.command
        })
        return
      }

      if (event.type === 'command-unregistered' && event.commandId && event.pluginId) {
        removePluginCommand(event.pluginId, event.commandId)
        return
      }

      // 处理主题样式事件
      if (event.type === 'plugin:theme-register-style') {
        const { pluginId, styleId, css, priority } = event
        if (pluginId && styleId && css !== undefined) {
          themeManager.registerStyle(pluginId, styleId, css, priority || 0)
          logger.log(`[App] 已注册插件主题样式: ${pluginId}/${styleId}`)
        }
        return
      }

      if (event.type === 'plugin:theme-unregister-style') {
        const { pluginId, styleId } = event
        if (pluginId && styleId) {
          themeManager.unregisterStyle(pluginId, styleId)
          logger.log(`[App] 已移除插件主题样式: ${pluginId}/${styleId}`)
        }
        return
      }

      if (event.type === 'plugin:theme-update-style') {
        const { pluginId, styleId, css, priority } = event
        if (pluginId && styleId && css !== undefined) {
          themeManager.updateStyle(pluginId, styleId, css, priority)
          logger.log(`[App] 已更新插件主题样式: ${pluginId}/${styleId}`)
        }
        return
      }

      if (['installed', 'uninstalled', 'enabled', 'disabled', 'ready', 'error', 'stopped'].includes(event.type)) {
        refreshPluginCommands()

        // 插件卸载时清理其主题样式
        if (event.type === 'uninstalled' && event.pluginId) {
          themeManager.unregisterAllStyles(event.pluginId)
        }
      }
    })

    return () => {
      unsubscribe && unsubscribe()
    }
  }, [addPluginCommand, removePluginCommand, refreshPluginCommands])

  // 监听同步冲突事件
  useEffect(() => {
    if (!window.electronAPI?.sync?.onConflictDetected) return

    const handleConflict = (conflict) => {
      logger.log('[App] 检测到同步冲突:', conflict)
      setCurrentConflict(conflict)
      setConflictDialogOpen(true)
    }

    const unsubscribe = window.electronAPI.sync.onConflictDetected(handleConflict)

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  // 处理冲突解决
  const handleConflictResolve = async (resolution) => {
    if (!currentConflict) return

    try {
      await window.electronAPI.sync.resolveConflict(currentConflict.conflictId, resolution)
      logger.log('[App] 冲突已解决:', resolution)
      setConflictDialogOpen(false)
      setCurrentConflict(null)
    } catch (error) {
      console.error('[App] 冲突解决失败:', error)
      // 可以在这里显示错误提示
    }
  }

  // 处理冲突取消
  const handleConflictCancel = async () => {
    if (!currentConflict) return

    try {
      await window.electronAPI.sync.resolveConflict(currentConflict.conflictId, 'cancel')
      logger.log('[App] 用户取消冲突解决')
      setConflictDialogOpen(false)
      setCurrentConflict(null)
    } catch (error) {
      console.error('[App] 取消冲突解决失败:', error)
    }
  }

  // 创建新待办事项
  const handleCreateTodo = async () => {
    try {
      // 使用TimeZoneUtils转换日期时间为UTC
      const dueDateUTC = TimeZoneUtils.toUTC(newTodo.due_date, newTodo.due_time);

      logger.log('[App] 创建待办事项:');
      logger.log('  - 本地日期:', newTodo.due_date);
      logger.log('  - 本地时间:', newTodo.due_time);
      logger.log('  - UTC时间:', dueDateUTC);

      await createTodoAPI({
        content: newTodo.content,
        description: newTodo.description, // 添加 description 字段
        is_important: newTodo.is_important,
        is_urgent: newTodo.is_urgent,
        due_date: dueDateUTC,
        tags: newTodo.tags,
        repeat_type: newTodo.repeat_type,
        repeat_interval: newTodo.repeat_interval,
        repeat_days: newTodo.repeat_days
      });

      setNewTodo(initialTodoState);
      setShowTodoCreateForm(false);
      setInitialTodoData(null);

      // 刷新相关数据
      setTodoRefreshTrigger(prev => prev + 1);
      setCalendarRefreshTrigger(prev => prev + 1);

      logger.log('[App] 待办事项创建成功');
    } catch (error) {
      console.error('创建待办事项失败:', error);
    }
  };

  // 处理批量设置标签
  const handleBatchSetTags = async () => {
    if (multiSelectState.selectedIds.length === 0) return;

    setSelectedNotesForTagging(multiSelectState.selectedIds);
    setTagSelectionDialogOpen(true);
  };

  // 确认批量设置标签
  const handleConfirmBatchSetTags = async ({ tags, replaceMode, noteIds }) => {
    try {
      const result = await batchSetTags(noteIds, tags, replaceMode);
      if (result.success) {
        logger.log(`成功为 ${noteIds.length} 个笔记设置标签`);
        // 退出多选模式
        if (currentMultiSelectRef) {
          currentMultiSelectRef.exitMultiSelectMode();
        }
      } else {
        console.error('批量设置标签失败:', result.error);
      }
    } catch (error) {
      console.error('批量设置标签失败:', error);
    }
  };

  useEffect(() => {
    // 测试 Electron API 连接
    const testElectronAPI = async () => {
      try {
        if (window.electronAPI) {
          const version = await window.electronAPI.getVersion()
          const message = await window.electronAPI.helloWorld()
          logger.log('App Version:', version)
          logger.log('Hello World:', message)
        }
      } catch (error) {
        console.error('Electron API 测试失败:', error)
      }
    }

    testElectronAPI()

    // 初始化设置
    const initApp = async () => {
      await initializeSettings()

      // 初始化i18n系统
      const { language } = useStore.getState()
      initI18n(language)
    }

    initApp()

    // 🟡优化：初始只加载首屏笔记(20条)，后续按需分页加载
    loadNotes({ limit: 20, page: 1 })

    // 监听来自托盘菜单的事件
    const handleTrayEvents = () => {
      if (window.electronAPI && window.electronAPI.ipcRenderer) {
        // 监听创建新笔记事件
        window.electronAPI.ipcRenderer.on('create-new-note', async () => {
          try {
            await createNote()
            setCurrentView('notes')
          } catch (error) {
            console.error('创建笔记失败:', error)
          }
        })

        // 监听创建新待办事件
        window.electronAPI.ipcRenderer.on('create-new-todo', () => {
          setCurrentView('todo')
          setShowTodoCreateForm(true)
        })

        // 监听打开设置事件
        window.electronAPI.ipcRenderer.on('open-settings', () => {
          setCurrentView('settings')
        })

        // 监听快速输入事件
        window.electronAPI.ipcRenderer.on('quick-input', () => {
          // 切换到笔记视图并创建新笔记
          setCurrentView('notes')
          createNote()
        })

        // 监听刷新笔记列表事件（用于首次启动显示欢迎笔记）
        window.electronAPI.ipcRenderer.on('refresh-notes', async (event, data) => {
          logger.log('[App] 收到refresh-notes事件:', data)
          await loadNotes()
          if (data && data.selectNoteId) {
            setSelectedNoteId(data.selectNoteId)
            setCurrentView('notes')
          }
        })
      }
    }

    handleTrayEvents()

    // 监听插件更新笔记事件，刷新笔记数据
    const handlePluginNoteUpdate = async (event) => {
      const { noteId, result } = event.detail || {};
      if (noteId && result?.data) {
        logger.log('[App] 检测到插件更新笔记，局部更新:', noteId);
        // 使用局部更新而不是重新加载整个列表，避免重新排序
        updateNoteInList(result.data);
      }
    };

    window.addEventListener('plugin-note-updated', handlePluginNoteUpdate);

    // 清理事件监听器
    return () => {
      window.removeEventListener('plugin-note-updated', handlePluginNoteUpdate);
      if (window.electronAPI && window.electronAPI.ipcRenderer) {
        window.electronAPI.ipcRenderer.removeAllListeners('create-new-note')
        window.electronAPI.ipcRenderer.removeAllListeners('create-new-todo')
        window.electronAPI.ipcRenderer.removeAllListeners('open-settings')
        window.electronAPI.ipcRenderer.removeAllListeners('quick-input')
        window.electronAPI.ipcRenderer.removeAllListeners('refresh-notes')
      }
    }
  }, [createNote, loadNotes])

  useEffect(() => {
    const unsubscribe = subscribePluginUiRequests((payload) => {
      if (!payload?.noteId) return
      setCurrentView('notes')
      setSelectedNoteId(payload.noteId)
    })

    return () => {
      unsubscribe && unsubscribe()
    }
  }, [setCurrentView, setSelectedNoteId])

  // 监听插件窗口打开请求
  useEffect(() => {
    const unsubscribe = subscribePluginWindowRequests(async (payload) => {
      if (!payload) return

      logger.log('插件请求打开窗口:', payload)

      try {
        // 加载插件HTML文件内容
        const result = await loadPluginFile(payload.pluginId, payload.url)

        if (!result.success) {
          console.error('加载插件文件失败:', result.error)
          return
        }

        // 在 HTML 中注入 base 标签，设置资源基准 URL
        let htmlContent = result.content
        const baseUrl = window.location.origin + window.location.pathname.replace(/[^/]*$/, '')
        const baseTag = `<base href="${baseUrl}">`

        // 在 head 标签后插入 base 标签
        if (htmlContent.includes('<head>')) {
          htmlContent = htmlContent.replace('<head>', `<head>\n${baseTag}`)
        } else if (htmlContent.includes('<HEAD>')) {
          htmlContent = htmlContent.replace('<HEAD>', `<HEAD>\n${baseTag}`)
        } else {
          // 如果没有 head 标签，在 html 标签后添加
          htmlContent = htmlContent.replace(/<html[^>]*>/i, `$&\n<head>\n${baseTag}\n</head>`)
        }

        // 设置窗口信息，包含修改后的HTML内容
        setPluginWindow({
          pluginId: payload.pluginId,
          url: payload.url,
          htmlContent: htmlContent,
          title: payload.title || '插件窗口',
          width: payload.width || 800,
          height: payload.height || 600,
          resizable: payload.resizable !== false,
          closable: payload.closable !== false
        })
      } catch (error) {
        console.error('加载插件窗口失败:', error)
      }
    })

    return () => {
      unsubscribe && unsubscribe()
    }
  }, [])

  // 在插件窗口打开时注入 UI Bridge 和依赖
  useEffect(() => {
    if (!pluginWindow || !pluginWindow.htmlContent) return

    let injected = false
    let styleObserver = null

    // 尝试多次注入,确保成功
    const tryInject = () => {
      const iframe = document.querySelector('iframe[title="' + pluginWindow.title + '"]')
      if (iframe && iframe.contentWindow && iframe.contentDocument) {
        try {
          // 注入 UI Bridge
          injectUIBridge(iframe.contentWindow, appTheme, {
            pluginId: pluginWindow.pluginId,
            commandExecutor: executePluginCommand
          })

          // 为 iframe 创建独立的 emotion cache，让样式注入到 iframe 内部
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document

          // 确保 iframe document 已加载
          if (!iframeDoc || !iframeDoc.head) {
            console.error('[UI Bridge] iframe document not ready')
            return false
          }

          // 创建 emotion cache，添加错误处理
          let iframeCache = null
          try {
            iframeCache = createCache({
              key: 'iframe-emotion',
              container: iframeDoc.head,
              prepend: true,
              speedy: false  // 禁用speedy模式，提高兼容性
            })

            // 验证cache对象完整性
            if (!iframeCache || typeof iframeCache.registered !== 'object') {
              console.warn('[UI Bridge] emotion cache not properly initialized')
              iframeCache = null
            }
          } catch (error) {
            console.error('[UI Bridge] Failed to create emotion cache:', error)
            iframeCache = null
          }

          // 暴露基本依赖（MUI为插件提供）
          iframe.contentWindow.React = React
          iframe.contentWindow.ReactDOM = ReactDOM
          iframe.contentWindow.MaterialUI = MaterialUI
          iframe.contentWindow.MaterialIcons = MaterialIcons
          iframe.contentWindow.appTheme = appTheme

          // 只有在cache有效时才暴露
          if (iframeCache) {
            iframe.contentWindow.emotionCache = iframeCache
            iframe.contentWindow.CacheProvider = CacheProvider
          } else {
            iframe.contentWindow.emotionCache = null
            iframe.contentWindow.CacheProvider = null
          }

          injected = true
          logger.log('[UI Bridge] 已注入插件窗口:', pluginWindow.title)
          logger.log('[Dependencies] 已暴露: React, ReactDOM, MaterialUI, MaterialIcons, appTheme, emotionCache')
          logger.log('[UI Bridge] ✅ Emotion cache 已配置，样式将自动注入到 iframe')

          return true
        } catch (error) {
          console.error('[UI Bridge] 注入失败:', error)
          return false
        }
      }
      return false
    }

    // 立即尝试注入
    if (tryInject()) return

    // 如果失败,使用定时器重试
    const timer = setTimeout(() => {
      if (!injected) {
        tryInject()
      }
    }, 50)

    // 再设置一个备用定时器
    const timer2 = setTimeout(() => {
      if (!injected) {
        tryInject()
      }
    }, 200)

    return () => {
      clearTimeout(timer)
      clearTimeout(timer2)
      if (styleObserver) {
        styleObserver.disconnect()
      }
    }
  }, [pluginWindow, appTheme])

  // 处理todo创建，支持预设初始数据
  const handleOpenCreateTodo = (initialData = null) => {
    setInitialTodoData(initialData)
    setShowTodoCreateForm(true)
  }

  // 处理todo创建表单关闭
  const handleTodoCreateFormClose = () => {
    setShowTodoCreateForm(false)
    setInitialTodoData(null)
  }  // 在移动端自动隐藏侧边栏
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [isMobile])

  return (
    <ErrorProvider>
      <PluginNotificationListener />
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <DragAnimationProvider>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          {/* 自定义标题栏 */}
          <TitleBar />

          {/* 主应用区域 */}
          <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* 主侧边栏 */}
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* 工具栏和内容区域 */}
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {/* 顶部工具栏 */}
              <AppBar
                position="static"
                sx={{
                  backgroundColor: 'transparent',
                  color: 'text.primary',
                  boxShadow: 'none'
                }}
              >
                <Toolbar
                  onToggleSidebar={() => setSecondarySidebarOpen(!secondarySidebarOpen)}
                  sidebarOpen={secondarySidebarOpen}
                  showDeleted={showDeleted}
                  onToggleDeleted={() => {
                    const newShowDeleted = !showDeleted;
                    setShowDeleted(newShowDeleted);
                    setSelectedNoteId(null);
                    loadNotes(newShowDeleted ? { deleted: true } : {});
                  }}
                  currentView={currentView}
                  todoViewMode={todoViewMode}
                  onTodoViewModeChange={setTodoViewMode}
                  todoShowCompleted={todoShowCompleted}
                  onTodoShowCompletedChange={setTodoShowCompleted}
                  onCreateTodo={handleOpenCreateTodo}
                  todoSortBy={todoSortBy}
                  onTodoSortByChange={setTodoSortBy}
                  calendarCurrentDate={calendarCurrentDate}
                  onCalendarDateChange={setCalendarCurrentDate}
                  calendarShowCompleted={calendarShowCompleted}
                  onCalendarShowCompletedChange={setCalendarShowCompleted}
                  onSelectedDateChange={setSelectedDate}
                  selectedDate={selectedDate}
                  calendarViewMode={calendarViewMode}
                  onCalendarViewModeChange={handleCalendarViewModeChange}
                />
              </AppBar>

              {/* 多选工具栏 */}
              {multiSelectState.isActive && (
                <MultiSelectToolbar
                  visible={multiSelectState.isActive}
                  selectedCount={multiSelectState.selectedCount}
                  totalCount={multiSelectState.totalCount}
                  itemType={multiSelectState.itemType}
                  onSelectAll={() => {
                    if (currentMultiSelectRef) {
                      currentMultiSelectRef.selectAll();
                    }
                  }}
                  onSelectNone={() => {
                    if (currentMultiSelectRef) {
                      currentMultiSelectRef.selectNone();
                    }
                  }}
                  onDelete={showDeleted ? undefined : async () => {
                    if (multiSelectState.selectedIds.length === 0) return;

                    try {
                      if (multiSelectState.itemType === '笔记') {
                        const result = await batchDeleteNotes(multiSelectState.selectedIds);
                        if (result.success) {
                          logger.log(`成功删除 ${multiSelectState.selectedIds.length} 个笔记`);
                        } else {
                          console.error('批量删除笔记失败:', result.error);
                        }
                      } else if (multiSelectState.itemType === '待办事项') {
                        const result = await batchDeleteTodos(multiSelectState.selectedIds);
                        if (result.success) {
                          logger.log(`成功删除 ${multiSelectState.selectedIds.length} 个待办事项`);
                          // 触发待办事项列表刷新
                          setTodoRefreshTrigger(prev => prev + 1);
                        } else {
                          console.error('批量删除待办事项失败:', result.error);
                        }
                      }
                    } catch (error) {
                      console.error('批量删除失败:', error);
                    } finally {
                      // 无论成功失败都退出多选模式
                      if (currentMultiSelectRef) {
                        currentMultiSelectRef.exitMultiSelectMode();
                      }
                    }
                  }}
                  onSetTags={showDeleted || multiSelectState.itemType !== '笔记' ? undefined : handleBatchSetTags}
                  onClose={() => {
                    if (currentMultiSelectRef) {
                      currentMultiSelectRef.exitMultiSelectMode();
                    }
                  }}
                  customActions={
                    showDeleted && multiSelectState.itemType === '笔记' ? [
                      {
                        label: '批量恢复',
                        icon: <RestoreIcon />,
                        onClick: async () => {
                          if (multiSelectState.selectedIds.length === 0) return;

                          try {
                            const result = await batchRestoreNotes(multiSelectState.selectedIds);
                            if (result.success) {
                              logger.log(`成功恢复 ${multiSelectState.selectedIds.length} 个笔记`);
                            } else {
                              console.error('批量恢复笔记失败:', result.error);
                            }
                          } catch (error) {
                            console.error('批量恢复失败:', error);
                          } finally {
                            if (currentMultiSelectRef) {
                              currentMultiSelectRef.exitMultiSelectMode();
                            }
                          }
                        },
                        color: 'primary'
                      },
                      {
                        label: permanentDeleteConfirm ? '确认删除' : '永久删除',
                        icon: <DeleteForeverIcon />,
                        onClick: async () => {
                          if (multiSelectState.selectedIds.length === 0) return;

                          if (!permanentDeleteConfirm) {
                            // 第一次点击，设置确认状态
                            setPermanentDeleteConfirm(true);
                            // 3秒后自动重置状态
                            setTimeout(() => {
                              setPermanentDeleteConfirm(false);
                            }, 3000);
                          } else {
                            // 第二次点击，执行删除
                            try {
                              const result = await batchPermanentDeleteNotes(multiSelectState.selectedIds);
                              if (result.success) {
                                logger.log(`成功永久删除 ${multiSelectState.selectedIds.length} 个笔记`);
                              } else {
                                console.error('批量永久删除笔记失败:', result.error);
                              }
                            } catch (error) {
                              console.error('批量永久删除失败:', error);
                            } finally {
                              setPermanentDeleteConfirm(false);
                              if (currentMultiSelectRef) {
                                currentMultiSelectRef.exitMultiSelectMode();
                              }
                            }
                          }
                        },
                        color: permanentDeleteConfirm ? 'error' : 'inherit',
                        sx: permanentDeleteConfirm ? {
                          backgroundColor: 'error.main',
                          color: 'error.contrastText',
                          '&:hover': {
                            backgroundColor: 'error.dark'
                          }
                        } : {}
                      }
                    ] : multiSelectState.itemType === '待办事项' ? [
                      {
                        label: '设为完成',
                        icon: <CheckCircleIcon />,
                        onClick: async () => {
                          if (multiSelectState.selectedIds.length === 0) return;

                          try {
                            const result = await batchCompleteTodos(multiSelectState.selectedIds);
                            if (result.success) {
                              logger.log(`成功完成 ${multiSelectState.selectedIds.length} 个待办事项`);
                              // 触发待办事项列表刷新
                              setTodoRefreshTrigger(prev => prev + 1);
                            } else {
                              console.error('批量完成待办事项失败:', result.error);
                            }
                          } catch (error) {
                            console.error('批量完成失败:', error);
                          } finally {
                            if (currentMultiSelectRef) {
                              currentMultiSelectRef.exitMultiSelectMode();
                            }
                          }
                        },
                        color: 'success'
                      }
                    ] : []
                  }
                />
              )}

              {/* 内容区域 */}
              <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* 二级侧边栏 - 始终渲染以支持动画 */}
                <Suspense fallback={<LoadingFallback />}>
                  <SecondarySidebar
                    open={secondarySidebarOpen}
                    onClose={() => setSecondarySidebarOpen(false)}
                    onTodoSelect={setSelectedTodo}
                    onViewModeChange={setTodoViewMode}
                    onShowCompletedChange={setTodoShowCompleted}
                    viewMode={todoViewMode}
                    showCompleted={todoShowCompleted}
                    onMultiSelectChange={setMultiSelectState}
                    onMultiSelectRefChange={setCurrentMultiSelectRef}
                    todoRefreshTrigger={todoRefreshTrigger}
                    todoSortBy={todoSortBy}
                    onTodoSortByChange={setTodoSortBy}
                    showDeleted={showDeleted}
                    selectedDate={selectedDate}
                    calendarRefreshTrigger={calendarRefreshTrigger}
                    onTodoUpdated={handleTodoUpdated}
                  />
                </Suspense>

                {/* 主内容区域 */}
                <Box sx={(theme) => {
                  const opacity = getMaskOpacityValue(theme.palette.mode === 'dark')
                  return {
                    flex: 1,
                    overflow: 'hidden',
                    backgroundColor: theme.palette.mode === 'dark'
                      ? `rgba(15, 23, 42, ${opacity})`
                      : `rgba(240, 244, 248, ${opacity})`,
                    backdropFilter: opacity > 0 ? 'blur(8px)' : 'none',
                    WebkitBackdropFilter: opacity > 0 ? 'blur(8px)' : 'none',
                  }
                }}>
                  {currentView === 'notes' && <NoteEditor />}
                  <Suspense fallback={<LoadingFallback />}>
                    {currentView === 'todo' && (
                      <TodoView
                        viewMode={todoViewMode}
                        showCompleted={todoShowCompleted}
                        onViewModeChange={setTodoViewMode}
                        onShowCompletedChange={setTodoShowCompleted}
                        onRefresh={() => setTodoRefreshTrigger(prev => prev + 1)}
                        onTodoSelect={setSelectedTodo}
                      />
                    )}
                    {currentView === 'calendar' && <CalendarView currentDate={calendarCurrentDate} onDateChange={setCalendarCurrentDate} onTodoSelect={setSelectedTodo} selectedDate={selectedDate} onSelectedDateChange={setSelectedDate} refreshToken={calendarRefreshTrigger} showCompleted={calendarShowCompleted} onShowCompletedChange={setCalendarShowCompleted} onTodoUpdated={handleTodoUpdated} viewMode={calendarViewMode} />}
                    {currentView === 'settings' && <Settings />}
                    {currentView === 'plugins' && (
                      <Box sx={{ p: 3, height: '100%', boxSizing: 'border-box' }}>
                        <PluginStore />
                      </Box>
                    )}
                    {currentView === 'profile' && <Profile />}
                    {currentView === 'ai' && <AIChatView />}
                  </Suspense>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        <TodoEditDialog
          todo={selectedTodo}
          open={Boolean(selectedTodo)}
          onClose={handleTodoDialogClose}
          onUpdated={handleTodoUpdated}
        />

        {/* 创建Todo对话框 */}
        {showTodoCreateForm && (
          <CreateTodoModal
            todo={newTodo}
            onChange={setNewTodo}
            onSubmit={handleCreateTodo}
            onCancel={handleTodoCreateFormClose}
          />
        )}

        {/* 标签选择对话框 */}
        <TagSelectionDialog
          open={tagSelectionDialogOpen}
          onClose={() => {
            setTagSelectionDialogOpen(false);
            setSelectedNotesForTagging([]);
          }}
          onConfirm={handleConfirmBatchSetTags}
          noteIds={selectedNotesForTagging}
          getAllTags={getAllTags}
        />

        {/* 同步冲突解决对话框 */}
        <Suspense fallback={null}>
          <ConflictResolutionDialog
            open={conflictDialogOpen}
            conflict={currentConflict}
            onResolve={handleConflictResolve}
            onCancel={handleConflictCancel}
          />
        </Suspense>

        {/* 插件窗口对话框 */}
        {pluginWindow && pluginWindow.htmlContent && (
          <Dialog
            open={true}
            onClose={pluginWindow.closable ? () => setPluginWindow(null) : undefined}
            maxWidth={false}
            PaperProps={{
              sx: {
                width: pluginWindow.width,
                height: pluginWindow.height,
                maxWidth: '90vw',
                maxHeight: '90vh',
                m: 2
              }
            }}
          >
            <DialogTitle sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              p: 2,
              borderBottom: 1,
              borderColor: 'divider'
            }}>
              {pluginWindow.title}
              {pluginWindow.closable && (
                <IconButton
                  edge="end"
                  color="inherit"
                  onClick={() => setPluginWindow(null)}
                  aria-label="close"
                >
                  <CloseIcon />
                </IconButton>
              )}
            </DialogTitle>
            <DialogContent sx={{ p: 0, overflow: 'hidden', height: `calc(${pluginWindow.height}px - 64px)` }}>
              <iframe
                srcDoc={pluginWindow.htmlContent}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none'
                }}
                title={pluginWindow.title}
                sandbox="allow-scripts allow-same-origin"
                onLoad={(e) => {
                  // iframe 加载完成后立即注入依赖
                  const iframe = e.target
                  if (iframe && iframe.contentWindow) {
                    try {
                      logger.log('[Plugin Window] iframe onLoad 触发')

                      // 注入 UI Bridge
                      injectUIBridge(iframe.contentWindow, appTheme, {
                        pluginId: pluginWindow.pluginId,
                        commandExecutor: executePluginCommand
                      })

                      // 为 iframe 创建独立的 emotion cache
                      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document
                      const iframeCache = createCache({
                        key: 'iframe-emotion',
                        container: iframeDoc.head,
                        prepend: true
                      })

                      // 暴露 React 和 Material-UI 依赖
                      iframe.contentWindow.React = React
                      iframe.contentWindow.ReactDOM = ReactDOM
                      iframe.contentWindow.MaterialUI = MaterialUI
                      iframe.contentWindow.MaterialIcons = MaterialIcons
                      iframe.contentWindow.appTheme = appTheme
                      iframe.contentWindow.emotionCache = iframeCache
                      iframe.contentWindow.CacheProvider = CacheProvider

                      logger.log('[Plugin Window] ✅ UI Bridge和依赖注入完成')
                    } catch (error) {
                      console.error('[Plugin Window] ❌ 依赖注入失败:', error)
                    }
                  }
                }}
              />
            </DialogContent>
          </Dialog>
        )}

        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />

        <Suspense fallback={null}>
          {christmasMode && <ChristmasDecorations />}
        </Suspense>
      </DragAnimationProvider>
    </ThemeProvider>
    </ErrorProvider>
  )
}

export default App
