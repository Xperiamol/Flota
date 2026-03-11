import React, { useEffect, useState, useMemo } from 'react'
import {
  ThemeProvider,
  CssBaseline,
  Box,
  Typography,
  CircularProgress
} from '@mui/material'
import { createAppTheme } from './styles/theme'
import './styles/index.css'
import TitleBar from './components/TitleBar'
import NoteEditor from './components/NoteEditor'
import TodoList from './components/TodoList'
import StandaloneProvider, { useStandaloneContext } from './components/StandaloneProvider'
import { useStandaloneStore } from './store/useStandaloneStore'
import { ErrorProvider } from './components/ErrorProvider'
import logger from './utils/logger'

/**
 * 独立窗口内容组件
 * 处理StandaloneProvider的加载状态
 */
function StandaloneContent({ windowType }) {
  const { isLoading } = useStandaloneContext()

  if (isLoading) {
    return (
      <Box sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        flexDirection: 'column',
        gap: 2
      }}>
        <CircularProgress />
        <Typography>正在加载数据...</Typography>
      </Box>
    )
  }

  return (
    <>
      {windowType === 'note' && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <NoteEditor />
        </Box>
      )}

      {windowType === 'todo' && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <TodoList
            onTodoSelect={() => { }}
            onViewModeChange={() => { }}
            onShowCompletedChange={() => { }}
            viewMode="list"
            showCompleted={false}
            onMultiSelectChange={() => { }}
            onMultiSelectRefChange={() => { }}
            refreshTrigger={0}
            sortBy="createdAt"
            onSortByChange={() => { }}
          />
        </Box>
      )}
    </>
  )
}

/**
 * 独立窗口组件
 * 根据URL参数决定显示笔记编辑器还是Todo列表
 */
function StandaloneWindow() {
  const [windowType, setWindowType] = useState(null)
  const [windowData, setWindowData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [themeMode, setThemeMode] = useState('light')
  const [primaryColor, setPrimaryColor] = useState('#1976d2')
  const store = useStandaloneStore()

  // 创建主题
  const appTheme = createAppTheme(themeMode, primaryColor)

  // 检查是否在Electron环境中运行
  const isElectronEnvironment = useMemo(() => {
    return window.electronAPI !== undefined
  }, [])

  // 将主题设置应用到 CSS 变量（与主窗口保持同步）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode)
  }, [themeMode])

  // 从主应用读取全部设置，并监听变化
  useEffect(() => {
    if (!isElectronEnvironment) return

    // 解析主题 mode，处理 system
    const resolveTheme = (mode) => {
      if (mode === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      return mode || 'light'
    }

    // 初始读取设置
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.settings.getAll()
        if (result?.success && result.data) {
          const s = result.data
          if (s.theme) setThemeMode(resolveTheme(s.theme))
          if (s.customThemeColor) setPrimaryColor(s.customThemeColor)
        }
      } catch {}
    }
    loadSettings()

    // 监听设置变更（用户在主窗口修改时实时同步）
    const unsubSetting = window.electronAPI.settings.onSettingChanged((data) => {
      if (!data?.key) return
      if (data.key === 'theme') setThemeMode(resolveTheme(data.value))
      if (data.key === 'customThemeColor') setPrimaryColor(data.value)
    })

    // 监听系统主题变化（仅 theme=system 时响应）
    // 复用初始 loadSettings 拿到的 themePref，无需二次 getAll
    let currentThemePref = null
    window.electronAPI.settings.get('theme').then(r => {
      if (r?.success) currentThemePref = r.data
    }).catch(() => {})

    const handleSystemTheme = (_, payload) => {
      if (currentThemePref === 'system') {
        setThemeMode(payload?.shouldUseDarkColors ? 'dark' : 'light')
      }
    }
    window.electronAPI.ipcRenderer.on('system-theme-changed', handleSystemTheme)

    // 跟踪 theme preference 变化以便响应系统主题
    const unsubTrackTheme = window.electronAPI.settings.onSettingChanged((data) => {
      if (data?.key === 'theme') currentThemePref = data.value
    })

    return () => {
      if (typeof unsubSetting === 'function') unsubSetting()
      if (typeof unsubTrackTheme === 'function') unsubTrackTheme()
      window.electronAPI.ipcRenderer.removeAllListeners('system-theme-changed')
    }
  }, [isElectronEnvironment])

  useEffect(() => {
    const initializeWindow = async () => {
      try {
        logger.log('开始初始化独立窗口...')
        setIsLoading(true)

        // 如果不在Electron环境中，直接返回，不进行参数解析
        if (!isElectronEnvironment) {
          setIsLoading(false)
          return
        }

        // 解析URL参数
        const urlParams = new URLSearchParams(window.location.search)
        const type = urlParams.get('type')
        const noteIdParam = urlParams.get('noteId')
        const minibarModeParam = urlParams.get('minibarMode')

        logger.log('独立窗口参数:', { type, noteId: noteIdParam, minibarMode: minibarModeParam })

        // 将 minibarMode 参数传递给 StandaloneProvider 通过 windowData
        const minibarFlag = minibarModeParam === 'true'

        if (type === 'note' && noteIdParam) {
          // 笔记独立窗口
          const parsedNoteId = Number(noteIdParam)
          if (Number.isNaN(parsedNoteId)) {
            console.error('无效的noteId:', noteIdParam)
            setError('无效的窗口参数: noteId')
            return
          }
          logger.log('设置笔记窗口类型')
          setWindowType('note')
          setWindowData({ noteId: parsedNoteId, minibarMode: minibarFlag })

        } else if (type === 'todo') {
          // Todo独立窗口 - 通过 IPC 拉取数据，避免 URL 过长导致 431 错误
          logger.log('设置Todo窗口类型，通过IPC拉取数据...')
          try {
            const result = await window.electronAPI.window.getInitData()
            if (!result?.success || !result.data) {
              console.error('获取Todo初始化数据失败:', result?.error)
              setError('无法加载Todo数据')
              return
            }
            setWindowType('todo')
            setWindowData({ ...result.data, minibarMode: minibarFlag })
          } catch (e) {
            console.error('IPC拉取Todo数据失败:', e)
            setError('加载Todo数据时出错')
            return
          }

        } else {
          console.error('无效的窗口参数:', { type, noteId: noteIdParam })
          setError('无效的窗口参数')
          return
        }

        logger.log('独立窗口初始化完成')

      } catch (error) {
        console.error('初始化独立窗口失败:', error)
        setError('初始化失败: ' + error.message)
      } finally {
        logger.log('设置加载状态为false')
        setIsLoading(false)
      }
    }

    // 添加延迟确保DOM完全加载
    const timer = setTimeout(() => {
      initializeWindow()
    }, 100)

    return () => clearTimeout(timer)
  }, [isElectronEnvironment])

  // 监听页面渲染完成，通知Electron窗口准备就绪
  useEffect(() => {
    if (!isLoading && !error && windowType) {
      logger.log('页面渲染完成，通知窗口准备就绪')

      // 检查是否在Electron环境中
      if (!isElectronEnvironment) {
        console.warn('独立窗口只能在Electron环境中运行')
        return
      }

      // 通知 Electron 窗口页面已准备就绪
      const readyCaller = window.electronAPI?.window?.windowReady
      if (typeof readyCaller === 'function') {
        logger.log('通过electronAPI.window.windowReady通知窗口准备就绪')
        try {
          readyCaller().then(() => {
            logger.log('windowReady调用成功')
          }).catch((error) => {
            console.error('windowReady调用失败:', error)
          })
        } catch (error) {
          console.error('windowReady调用异常:', error)
        }
      } else {
        logger.log('electronAPI.window.windowReady 不可用，手动触发DOMContentLoaded事件')
        // 手动触发 DOMContentLoaded 事件作为备选方案
        const event = new Event('DOMContentLoaded')
        document.dispatchEvent(event)
      }
    }
  }, [isLoading, error, windowType, isElectronEnvironment])

  // 窗口关闭前保存数据
  useEffect(() => {
    if (!isElectronEnvironment) return;

    // 暴露保存函数供WindowManager调用
    window.__saveBeforeClose = async () => {
      logger.log('[StandaloneWindow] 执行窗口关闭前保存...');
      try {
        // 触发store中的保存逻辑
        if (store.saveNow) {
          await store.saveNow();
          logger.log('[StandaloneWindow] 保存完成');
        }
      } catch (error) {
        console.error('[StandaloneWindow] 保存失败:', error);
      }
    };

    // 监听beforeunload事件（备用保护）
    const handleBeforeUnload = async (e) => {
      if (store.hasUnsavedChanges && store.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
        
        // 尝试保存
        if (store.saveNow) {
          await store.saveNow();
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      delete window.__saveBeforeClose;
    };
  }, [isElectronEnvironment, store]);

  // 如果不在Electron环境中，显示提示信息
  if (!isElectronEnvironment) {
    return (
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <Box sx={{
          height: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          gap: 2,
          p: 3
        }}>
          <Typography color="error" variant="h6">环境错误</Typography>
          <Typography sx={{ textAlign: 'center' }}>独立窗口只能在Flota桌面应用中运行</Typography>
          <Typography sx={{ textAlign: 'center' }} color="text.secondary">
            请通过拖拽笔记或Todo列表到窗口中来创建独立窗口
          </Typography>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ErrorProvider>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          {/* 使用主应用的TitleBar组件 */}
          <TitleBar 
          isStandalone={true} 
          isMinibarMode={store.minibarMode}
          onMinibarClick={async () => {
            if (store.minibarMode) {
              // 退出minibar模式
              store.setMinibarMode(false);
              if (window.electronAPI) {
                await window.electronAPI.window.setSize(800, 600); // 恢复默认大小
              }
            } else {
              // 进入minibar模式
              store.setMinibarMode(true);
              if (window.electronAPI) {
                await window.electronAPI.window.setSize(300, 280);
              }
            }
          }}
        />
        {isLoading && (
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            flexDirection: 'column',
            gap: 2
          }}>
            <CircularProgress />
            <Typography>正在加载独立窗口...</Typography>
          </Box>
        )}

        {error && (
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            flexDirection: 'column',
            gap: 2,
            p: 3
          }}>
            <Typography color="error" variant="h6">加载失败</Typography>
            <Typography sx={{ textAlign: 'center' }}>{error}</Typography>
          </Box>
        )}

        {!isLoading && !error && windowType && windowData && (
          <StandaloneProvider windowType={windowType} windowData={windowData}>
            <StandaloneContent windowType={windowType} />
          </StandaloneProvider>
        )}
      </Box>
    </ThemeProvider>
    </ErrorProvider>
  )
}

export default StandaloneWindow