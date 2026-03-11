/**
 * Flota React Bridge
 * 为支持 React 的插件提供主应用 React 组件访问
 * 
 * ⚠️ 注意：
 * 1. 仅适用于使用 React 构建的插件
 * 2. 需要插件自行引入 React 和 ReactDOM
 * 3. 插件必须在 manifest.json 中声明 "framework": "react"
 * 
 * @version 1.0.0
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  TextField,
  Chip,
  Alert,
  CircularProgress,
  Box,
  Typography,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Paper,
  Divider,
  Stack,
  Grid,
  Container
} from '@mui/material'

/**
 * 导出的 React 组件集合
 */
export const FlotaComponents = {
  // 基础组件
  Button,
  IconButton,
  Typography,
  Box,
  Paper,
  Divider,
  
  // 卡片
  Card,
  CardContent,
  CardHeader,
  
  // 表单
  TextField,
  
  // 反馈
  Alert,
  Snackbar,
  CircularProgress,
  Chip,
  
  // 对话框
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  
  // 布局
  Stack,
  Grid,
  Container
}

/**
 * 创建 React 根节点的辅助函数
 * @param {HTMLElement} container - 容器元素
 * @param {React.Component} component - React 组件
 * @returns {Object} React root 对象
 */
export function createReactRoot(container, component) {
  if (!container) {
    throw new Error('createReactRoot: 容器元素不能为空')
  }
  
  const root = ReactDOM.createRoot(container)
  root.render(component)
  
  return {
    root,
    unmount: () => root.unmount()
  }
}

/**
 * React Hook: 使用 Flota 主题
 * 从 window.FlotaUI 获取主题信息并转换为 React state
 */
export function useFlotaTheme() {
  const [theme, setTheme] = React.useState(() => {
    if (window.FlotaUI) {
      return window.FlotaUI.getTheme()
    }
    return { mode: 'light', colors: {}, isDark: false }
  })

  React.useEffect(() => {
    if (!window.FlotaUI) {
      console.warn('[React Bridge] FlotaUI 未找到')
      return
    }

    const unsubscribe = window.FlotaUI.onThemeChange((newTheme) => {
      setTheme(newTheme)
    })

    return unsubscribe
  }, [])

  return theme
}

/**
 * React Hook: 使用 Flota Runtime API
 * 提供对插件 Runtime API 的访问
 */
export function useFlotaRuntime() {
  if (typeof runtime === 'undefined') {
    console.warn('[React Bridge] runtime 未找到')
    return null
  }
  
  return runtime
}

/**
 * React Hook: 显示通知
 */
export function useFlotaNotifications() {
  const runtime = useFlotaRuntime()
  
  const showNotification = React.useCallback(async (options) => {
    if (!runtime) {
      console.error('[React Bridge] runtime 不可用')
      return
    }
    
    try {
      await runtime.notifications.show(options)
    } catch (error) {
      console.error('[React Bridge] 显示通知失败:', error)
    }
  }, [runtime])
  
  return { showNotification }
}

/**
 * React Hook: 访问笔记数据
 */
export function useFlotaNotes() {
  const runtime = useFlotaRuntime()
  const [notes, setNotes] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  const fetchNotes = React.useCallback(async (options = {}) => {
    if (!runtime) {
      setError('runtime 不可用')
      return
    }

    setLoading(true)
    setError(null)
    
    try {
      const result = await runtime.notes.getAll(options)
      setNotes(result)
      return result
    } catch (err) {
      setError(err.message)
      console.error('[React Bridge] 获取笔记失败:', err)
    } finally {
      setLoading(false)
    }
  }, [runtime])

  const createNote = React.useCallback(async (noteData) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      const result = await runtime.notes.create(noteData)
      await fetchNotes() // 刷新列表
      return result
    } catch (err) {
      console.error('[React Bridge] 创建笔记失败:', err)
      throw err
    }
  }, [runtime, fetchNotes])

  const updateNote = React.useCallback(async (id, updates) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      const result = await runtime.notes.update(id, updates)
      await fetchNotes() // 刷新列表
      return result
    } catch (err) {
      console.error('[React Bridge] 更新笔记失败:', err)
      throw err
    }
  }, [runtime, fetchNotes])

  const deleteNote = React.useCallback(async (id) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      await runtime.notes.delete(id)
      await fetchNotes() // 刷新列表
    } catch (err) {
      console.error('[React Bridge] 删除笔记失败:', err)
      throw err
    }
  }, [runtime, fetchNotes])

  return {
    notes,
    loading,
    error,
    fetchNotes,
    createNote,
    updateNote,
    deleteNote
  }
}

/**
 * React Hook: 访问待办数据
 */
export function useFlotaTodos() {
  const runtime = useFlotaRuntime()
  const [todos, setTodos] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  const fetchTodos = React.useCallback(async (options = {}) => {
    if (!runtime) {
      setError('runtime 不可用')
      return
    }

    setLoading(true)
    setError(null)
    
    try {
      const result = await runtime.todos.getAll(options)
      setTodos(result)
      return result
    } catch (err) {
      setError(err.message)
      console.error('[React Bridge] 获取待办失败:', err)
    } finally {
      setLoading(false)
    }
  }, [runtime])

  const createTodo = React.useCallback(async (todoData) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      const result = await runtime.todos.create(todoData)
      await fetchTodos() // 刷新列表
      return result
    } catch (err) {
      console.error('[React Bridge] 创建待办失败:', err)
      throw err
    }
  }, [runtime, fetchTodos])

  const updateTodo = React.useCallback(async (id, updates) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      const result = await runtime.todos.update(id, updates)
      await fetchTodos() // 刷新列表
      return result
    } catch (err) {
      console.error('[React Bridge] 更新待办失败:', err)
      throw err
    }
  }, [runtime, fetchTodos])

  const deleteTodo = React.useCallback(async (id) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      await runtime.todos.delete(id)
      await fetchTodos() // 刷新列表
    } catch (err) {
      console.error('[React Bridge] 删除待办失败:', err)
      throw err
    }
  }, [runtime, fetchTodos])

  const toggleComplete = React.useCallback(async (id) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      const todo = todos.find(t => t.id === id)
      if (!todo) return
      
      await updateTodo(id, { completed: !todo.completed })
    } catch (err) {
      console.error('[React Bridge] 切换完成状态失败:', err)
      throw err
    }
  }, [runtime, todos, updateTodo])

  return {
    todos,
    loading,
    error,
    fetchTodos,
    createTodo,
    updateTodo,
    deleteTodo,
    toggleComplete
  }
}

/**
 * React Hook: 访问标签数据
 */
export function useFlotaTags() {
  const runtime = useFlotaRuntime()
  const [tags, setTags] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  const fetchTags = React.useCallback(async () => {
    if (!runtime) {
      setError('runtime 不可用')
      return
    }

    setLoading(true)
    setError(null)
    
    try {
      const result = await runtime.tags.getAll()
      setTags(result)
      return result
    } catch (err) {
      setError(err.message)
      console.error('[React Bridge] 获取标签失败:', err)
    } finally {
      setLoading(false)
    }
  }, [runtime])

  const createTag = React.useCallback(async (name, color) => {
    if (!runtime) {
      throw new Error('runtime 不可用')
    }

    try {
      const result = await runtime.tags.create(name, color)
      await fetchTags() // 刷新列表
      return result
    } catch (err) {
      console.error('[React Bridge] 创建标签失败:', err)
      throw err
    }
  }, [runtime, fetchTags])

  return {
    tags,
    loading,
    error,
    fetchTags,
    createTag
  }
}

/**
 * React Context: Flota Plugin Context
 * 提供插件全局状态和 API 访问
 */
export const FlotaContext = React.createContext({
  runtime: null,
  theme: null,
  components: FlotaComponents
})

/**
 * React Provider: Flota Plugin Provider
 * 包裹插件根组件，提供全局访问
 */
export function FlotaProvider({ children }) {
  const theme = useFlotaTheme()
  const runtime = useFlotaRuntime()

  const value = React.useMemo(() => ({
    runtime,
    theme,
    components: FlotaComponents
  }), [runtime, theme])

  return (
    <FlotaContext.Provider value={value}>
      {children}
    </FlotaContext.Provider>
  )
}

/**
 * React Hook: 使用 Flota Context
 */
export function useFlota() {
  const context = React.useContext(FlotaContext)
  
  if (!context) {
    throw new Error('useFlota 必须在 FlotaProvider 内部使用')
  }
  
  return context
}

/**
 * 将 React Bridge 注入到插件窗口
 * @param {Window} iframeWindow - 插件窗口
 */
export function injectReactBridge(iframeWindow) {
  if (!iframeWindow) {
    console.error('[React Bridge] iframe window 不能为空')
    return
  }

  // 注入 React Bridge API
  iframeWindow.FlotaReact = {
    // React 和 ReactDOM
    React,
    ReactDOM,
    
    // Material-UI 组件
    Components: FlotaComponents,
    
    // Hooks
    useFlotaTheme,
    useFlotaRuntime,
    useFlotaNotifications,
    useFlotaNotes,
    useFlotaTodos,
    useFlotaTags,
    useFlota,
    
    // Context 和 Provider
    FlotaContext,
    FlotaProvider,
    
    // 工具函数
    createReactRoot,
    
    version: '1.0.0'
  }

  console.log('[React Bridge] 已注入到插件窗口，版本:', '1.0.0')
}
