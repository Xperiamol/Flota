import React, { createContext, useContext, useEffect } from 'react'
import { useStandaloneStore } from '../../store/useStandaloneStore'
import { useStore } from '../../store/useStore'
import { DragAnimationProvider } from './DragAnimationProvider'

export const StandaloneContext = createContext(null)

export const useStandaloneContext = () => {
  const context = useContext(StandaloneContext)
  if (!context) {
    throw new Error('useStandaloneContext must be used within StandaloneProvider')
  }
  return context
}

export const StandaloneProvider = ({ children, windowType, windowData }) => {
  const store = useStandaloneStore()
  const { defaultMinibarMode } = useStore()
  const [isLoading, setIsLoading] = React.useState(true)
  
  // 初始化窗口配置
  useEffect(() => {
    const initializeData = async () => {
      if (windowType && windowData) {
        store.setWindowConfig(windowType, windowData)
        
        // 设置默认minibar模式：优先使用 windowData 中的 minibarMode（如果存在），否则使用主应用的 defaultMinibarMode
        if (windowData && typeof windowData.minibarMode !== 'undefined') {
          store.setMinibarMode(Boolean(windowData.minibarMode))
        } else {
          store.setMinibarMode(defaultMinibarMode)
        }
        
        // 如果是笔记窗口，加载对应的笔记
        if (windowType === 'note' && windowData.noteId) {
          await store.loadNote(windowData.noteId)
        }
      }
      setIsLoading(false)
    }
    
    initializeData()
  }, [windowType, windowData, defaultMinibarMode]) // 添加defaultMinibarMode依赖

  // 订阅主进程推送的笔记更新事件，实现跨窗口同步
  useEffect(() => {
    if (!window.electronAPI?.notes?.onNoteUpdated) return
    
    const unsubscribe = window.electronAPI.notes.onNoteUpdated((updated) => {
      try {
        // 只同步当前独立窗口正在编辑的笔记
        store.applyIncomingNoteUpdate?.(updated)
      } catch (e) {
        console.error('处理主进程笔记更新失败:', e)
      }
    })

    return () => {
      try {
        if (typeof unsubscribe === 'function') unsubscribe()
      } catch (e) {
        // ignore
      }
    }
  }, [])
  
  const contextValue = {
    ...store,
    isStandaloneMode: true,
    isLoading
  }
  
  // 在数据加载完成前不渲染子组件，避免显示空白内容
  if (isLoading) {
    return (
      <StandaloneContext.Provider value={contextValue}>
        <DragAnimationProvider>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh',
            fontSize: '16px',
            color: '#666'
          }}>
            加载中...
          </div>
        </DragAnimationProvider>
      </StandaloneContext.Provider>
    )
  }
  
  return (
    <StandaloneContext.Provider value={contextValue}>
      <DragAnimationProvider>
        {children}
      </DragAnimationProvider>
    </StandaloneContext.Provider>
  )
}

export default StandaloneProvider
