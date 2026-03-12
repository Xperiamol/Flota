import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Box, Alert, CircularProgress, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material'
import { Save as SaveIcon, GetApp as ExportIcon, AutoAwesome as AIIcon, Undo as UndoIcon } from '@mui/icons-material'
import { Excalidraw, exportToBlob, exportToSvg, THEME } from '@excalidraw/excalidraw'
import { useStore } from '../store/useStore'
import { useStandaloneContext } from './StandaloneProvider'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { aiGenerateExcalidrawElements } from '../utils/aiExcalidrawGenerator'
import '@excalidraw/excalidraw/index.css'
import logger from '../utils/logger'

/**
 * 白板编辑器组件
 * 直接使用 @excalidraw/excalidraw React 组件
 */
const WhiteboardEditor = ({ noteId, showToolbar = true, isStandaloneMode = false, onSaveWhiteboard, onGetContent, onExportPNG }) => {
  // Get context from either main store or standalone context
  let store
  let actualIsStandaloneMode = isStandaloneMode
  try {
    store = useStandaloneContext()
    actualIsStandaloneMode = true
  } catch (error) {
    // Not in standalone mode, use main store
    store = useStore()
    actualIsStandaloneMode = false
  }
  
  const { notes, updateNote, currentView, theme: themePref } = store

  // 解析实际主题（处理 'system'）
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const isDark = themePref === 'dark' || (themePref === 'system' && systemIsDark)

  const [excalidrawAPI, setExcalidrawAPI] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [initialData, setInitialData] = useState(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [excalidrawKey, setExcalidrawKey] = useState(() => `excalidraw-${noteId || 'unknown'}`)
  const [bridgeActive, setBridgeActive] = useState(false)
  // AI 生成对话框状态
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiLoadingText, setAiLoadingText] = useState('')
  // AI 撤销快照
  const aiSnapshotRef = useRef(null)
  const [aiUndoAvailable, setAiUndoAvailable] = useState(false)
  // AI 按钮位置（null = 默认右下角）
  const [aiBtnPos, setAiBtnPos] = useState(null)
  const aiDragRef = useRef({ dragging: false, startMouseX: 0, startMouseY: 0, startBtnX: 0, startBtnY: 0, hasMoved: false })
  const aiButtonRef = useRef(null)
  const hasUnsavedChangesRef = useRef(false)
  // 保存上一个noteId，用于检测noteId变化（初始为null，避免首次加载时触发保存）
  const prevNoteIdRef = useRef(null)
  // 当前正在编辑的白板noteId（防止异步保存写错对象）
  const activeNoteIdRef = useRef(noteId)
  // 标记是否正在切换笔记，用于避免组件卸载时的重复保存
  const isSwitchingNoteRef = useRef(false)
  // 记录最近一次成功保存/加载的场景数据，用于变更检测
  const lastSavedSceneRef = useRef(null)
  // 标记当前是否正由系统应用远端数据，避免 onChange 误判
  const isApplyingRemoteDataRef = useRef(true)
  // 记录最近一次渲染的完整场景，用于在组件重挂载时仍能保存
  const latestSceneRef = useRef({ elements: [], appState: {}, files: {} })
  // 标记是否正在进行类型转换，用于避免卸载时自动保存覆盖转换结果
  const isTypeConvertingRef = useRef(false)
  
  // 监听类型转换事件
  useEffect(() => {
    const handleTypeConversion = () => {
      logger.log('[WhiteboardEditor] 收到类型转换事件，标记为正在转换')
      isTypeConvertingRef.current = true
      // 同时清除未保存标记，防止卸载时保存
      hasUnsavedChangesRef.current = false
      setHasUnsavedChanges(false)
    }
    
    window.addEventListener('whiteboard-type-converting', handleTypeConversion)
    return () => {
      window.removeEventListener('whiteboard-type-converting', handleTypeConversion)
    }
  }, [])
  
  // 同步 hasUnsavedChanges 到 ref
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  // 只在开发环境输出调试日志
  if (process.env.NODE_ENV === 'development') {
    logger.log('[WhiteboardEditor] 组件渲染', { 
      noteId, 
      noteIdType: typeof noteId,
      hasExcalidrawAPI: !!excalidrawAPI
    })
  }

  // 定义空白板模板数据（跟随暗黑模式）
  const blankBoardData = useMemo(() => ({
    elements: [],
    appState: { viewBackgroundColor: isDark ? '#1e1e1e' : '#ffffff' },
    files: {}
  }), [isDark])

  const serializeScene = useCallback((elements = [], appState = {}, files = {}) => {
    const sanitizedAppState = {
      viewBackgroundColor: appState.viewBackgroundColor,
      currentItemFontFamily: appState.currentItemFontFamily,
      gridSize: appState.gridSize
    }

    const sortedFileKeys = Object.keys(files || {}).sort()
    const sanitizedFiles = {}
    sortedFileKeys.forEach((key) => {
      sanitizedFiles[key] = files[key]
    })

    return JSON.stringify({
      elements,
      appState: sanitizedAppState,
      files: sanitizedFiles
    })
  }, [])

  // 重置Excalidraw内容的通用函数
  const resetExcalidrawContent = useCallback(async (api, note) => {
    const applyScene = (elements, appState, files) => {
      if (api && api.updateScene && typeof api.updateScene === 'function') {
        api.updateScene({ elements, appState, files })
      } else if (api && api.resetScene && typeof api.resetScene === 'function') {
        api.resetScene({ elements, appState, files })
      } else {
        setInitialData({ elements, appState, files })
      }

      lastSavedSceneRef.current = serializeScene(elements, appState, files)
      latestSceneRef.current = {
        elements,
        appState,
        files
      }
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false
    }

    isApplyingRemoteDataRef.current = true

    try {
      const useBlankScene = () => {
        applyScene(
          blankBoardData.elements,
          blankBoardData.appState,
          blankBoardData.files
        )
      }

      // 如果笔记类型不是白板，使用空白板
      if (note.note_type !== 'whiteboard') {
        useBlankScene()
        return
      }

      // 笔记类型是白板，但内容为空
      if (!note.content) {
        useBlankScene()
        return
      }

      // 解析白板数据并更新
      const excalidrawData = JSON.parse(note.content)
      const elements = excalidrawData.elements || []
      const appState = excalidrawData.appState || { viewBackgroundColor: '#ffffff' }
      
      // 处理图片文件
      let files = {}
      if (excalidrawData.fileMap && Object.keys(excalidrawData.fileMap).length > 0) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 处理图片文件', {
            filesCount: Object.keys(excalidrawData.fileMap).length
          })
        }
        
        // 检查 fileMap 中是否已经包含 dataURL（从 Markdown 转换过来的情况）
        const hasInlineDataURL = Object.values(excalidrawData.fileMap).some(
          f => f.dataURL && f.dataURL.startsWith('data:')
        )
        
        if (hasInlineDataURL) {
          // fileMap 中已经有 dataURL，直接使用
          for (const [fileId, fileData] of Object.entries(excalidrawData.fileMap)) {
            if (fileData.dataURL && fileData.dataURL.startsWith('data:')) {
              files[fileId] = {
                mimeType: fileData.mimeType || 'image/png',
                id: fileId,
                dataURL: fileData.dataURL,
                created: fileData.created || Date.now()
              }
            }
          }
          logger.log('[WhiteboardEditor] 使用内联 dataURL 图片:', Object.keys(files).length)
        } else {
          // 从文件系统加载图片
          const result = await window.electronAPI.whiteboard.loadImages(excalidrawData.fileMap)
          if (result.success) {
            files = result.data
          } else {
            console.error('[WhiteboardEditor] 加载图片失败', result.error)
          }
        }
      }
      
      applyScene(elements, appState, files)
    } catch (error) {
      console.error('[WhiteboardEditor] 更新Excalidraw内容失败', error)
      applyScene(
        blankBoardData.elements,
        blankBoardData.appState,
        blankBoardData.files
      )
    } finally {
      isApplyingRemoteDataRef.current = false
    }
  }, [blankBoardData, serializeScene, setHasUnsavedChanges, setInitialData])

  // 加载白板数据（仅在首次挂载时执行，后续切换通过 useEffect 处理）
  useEffect(() => {
    // 只在首次加载时执行（prevNoteIdRef 为 null）
    if (prevNoteIdRef.current !== null) {
      return
    }
    
    const loadWhiteboardData = async () => {
      if (process.env.NODE_ENV === 'development') {
        logger.log('[WhiteboardEditor] 首次加载数据', { noteId })
      }
      isApplyingRemoteDataRef.current = true
      
      if (!noteId) {
        console.error('[WhiteboardEditor] noteId 无效', { noteId })
        setError('笔记 ID 无效')
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
        return
      }

      const note = notes.find(n => n.id === noteId)

      if (!note) {
        setError('笔记不存在')
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
        return
      }

      // 解析白板数据
      try {
        // 如果笔记类型不是白板，使用空白板
        if (note.note_type !== 'whiteboard') {
          setInitialData(blankBoardData)
          lastSavedSceneRef.current = serializeScene(
            blankBoardData.elements,
            blankBoardData.appState,
            blankBoardData.files
          )
          setHasUnsavedChanges(false)
          hasUnsavedChangesRef.current = false
          activeNoteIdRef.current = noteId
          setIsLoading(false)
          isApplyingRemoteDataRef.current = false
          return
        }

        // 笔记类型是白板，但内容为空
        if (!note.content) {
          setInitialData(blankBoardData)
          lastSavedSceneRef.current = serializeScene(
            blankBoardData.elements,
            blankBoardData.appState,
            blankBoardData.files
          )
          setHasUnsavedChanges(false)
          hasUnsavedChangesRef.current = false
          activeNoteIdRef.current = noteId
          setIsLoading(false)
          isApplyingRemoteDataRef.current = false
          return
        }

        // 解析白板数据
        const excalidrawData = JSON.parse(note.content)

        // 处理图片文件
        let files = {}
        if (excalidrawData.fileMap && Object.keys(excalidrawData.fileMap).length > 0) {
          if (process.env.NODE_ENV === 'development') {
            logger.log('[WhiteboardEditor] 初始加载 - 处理图片文件', {
              filesCount: Object.keys(excalidrawData.fileMap).length
            })
          }
          
          // 检查 fileMap 中是否已经包含 dataURL（从 Markdown 转换过来的情况）
          const hasInlineDataURL = Object.values(excalidrawData.fileMap).some(
            f => f.dataURL && f.dataURL.startsWith('data:')
          )
          
          if (hasInlineDataURL) {
            // fileMap 中已经有 dataURL，直接使用
            for (const [fileId, fileData] of Object.entries(excalidrawData.fileMap)) {
              if (fileData.dataURL && fileData.dataURL.startsWith('data:')) {
                files[fileId] = {
                  mimeType: fileData.mimeType || 'image/png',
                  id: fileId,
                  dataURL: fileData.dataURL,
                  created: fileData.created || Date.now()
                }
              }
            }
            logger.log('[WhiteboardEditor] 初始加载 - 使用内联 dataURL 图片:', Object.keys(files).length)
          } else {
            // 从文件系统加载图片
            const result = await window.electronAPI.whiteboard.loadImages(excalidrawData.fileMap)
            if (result.success) {
              files = result.data
              if (process.env.NODE_ENV === 'development') {
                logger.log('[WhiteboardEditor] 图片加载成功', {
                  filesCount: Object.keys(files).length
                })
              }
            } else {
              console.error('[WhiteboardEditor] 加载图片失败', result.error)
            }
          }
        }

        const initialScene = {
          elements: excalidrawData.elements || [],
          appState: excalidrawData.appState || { viewBackgroundColor: '#ffffff' },
          files: files
        }

        setInitialData(initialScene)
        lastSavedSceneRef.current = serializeScene(
          initialScene.elements,
          initialScene.appState,
          initialScene.files
        )
        latestSceneRef.current = initialScene
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
        activeNoteIdRef.current = noteId
        
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
      } catch (error) {
        console.error('[WhiteboardEditor] 解析白板数据失败，使用空白板', error)
        
        // 解析失败时使用空白板
        setInitialData(blankBoardData)
        lastSavedSceneRef.current = serializeScene(
          blankBoardData.elements,
          blankBoardData.appState,
          blankBoardData.files
        )
        latestSceneRef.current = blankBoardData
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
    activeNoteIdRef.current = noteId
        
        // 只在笔记类型确实是白板时才显示错误
        const note = notes.find(n => n.id === noteId)
        if (note?.note_type === 'whiteboard') {
          setError('白板数据格式错误，已使用空白板')
        } else {
          setError(null) // 非白板类型解析失败是预期行为
        }
        
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
      }
    }

    loadWhiteboardData()
    // 首次加载后设置 prevNoteIdRef
    prevNoteIdRef.current = noteId
  }, [noteId, notes, blankBoardData, serializeScene, setHasUnsavedChanges])

  // 当noteId变化时，先保存旧笔记，再加载新笔记
  useEffect(() => {
    // 跳过首次加载（已在上面的 useEffect 处理）
    if (prevNoteIdRef.current === null) {
      return
    }
    
    // 使用 ref 追踪上一个 noteId
    const prevNoteId = prevNoteIdRef.current
    
    if (excalidrawAPI && noteId && prevNoteId !== noteId) {
      if (process.env.NODE_ENV === 'development') {
        logger.log('[WhiteboardEditor] noteId变化，开始切换', { 
          prevNoteId, 
          newNoteId: noteId,
          hasUnsavedChanges: hasUnsavedChangesRef.current
        })
      }
      
      // 标记正在切换笔记
      isSwitchingNoteRef.current = true
      setBridgeActive(true)
      setIsLoading(true)
      setInitialData(null)
      
      // 使用 async IIFE 确保顺序执行
      ;(async () => {
        try {
          // 如果有未保存的更改，先保存旧笔记
          if (hasUnsavedChangesRef.current) {
            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 切换前保存旧笔记', { prevNoteId })
            }
            
            const sceneSnapshot = latestSceneRef.current || {}
            const elements = sceneSnapshot.elements || []
            const appState = sceneSnapshot.appState || { viewBackgroundColor: '#ffffff' }
            const files = sceneSnapshot.files || {}

            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 获取到的数据', {
                elementsCount: elements?.length || 0,
                filesCount: Object.keys(files || {}).length
              })
            }

            // 将图片保存到文件系统
            let fileMap = {}
            if (files && Object.keys(files).length > 0) {
              const result = await window.electronAPI.whiteboard.saveImages(files)
              if (result.success) {
                fileMap = result.data
              }
            }

            const data = {
              type: 'excalidraw',
              version: 2,
              source: 'Flota-local',
              elements,
              appState: {
                viewBackgroundColor: appState.viewBackgroundColor,
                currentItemFontFamily: appState.currentItemFontFamily,
                gridSize: appState.gridSize
              },
              fileMap
            }

            await updateNote(prevNoteId, {
              content: JSON.stringify(data),
              note_type: 'whiteboard'
            })
            
            hasUnsavedChangesRef.current = false
            setHasUnsavedChanges(false)
            
            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 旧笔记保存完成', { 
                prevNoteId,
                savedElementsCount: elements?.length || 0
              })
            }
          }
          
          // 保存完成后（或无需保存时），加载新笔记
          const note = notes.find(n => n.id === noteId)
          if (note) {
            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 开始加载新笔记', { noteId })
            }
            await resetExcalidrawContent(null, note)
            activeNoteIdRef.current = noteId
            setExcalidrawKey(`excalidraw-${noteId || 'unknown'}`)
            setIsLoading(false)
            setBridgeActive(false)
          } else {
            activeNoteIdRef.current = noteId
            setExcalidrawKey(`excalidraw-${noteId || 'unknown'}`)
            setIsLoading(false)
            setBridgeActive(false)
          }
        } catch (error) {
          console.error('[WhiteboardEditor] 切换笔记流程出错', error)
        } finally {
          setIsLoading(false)
          setBridgeActive(false)
          // 更新 prevNoteIdRef
          prevNoteIdRef.current = noteId
          
          // 切换完成，重置标志
          isSwitchingNoteRef.current = false
        }
      })()
    }
  }, [noteId, notes, resetExcalidrawContent, updateNote, setHasUnsavedChanges])

  // 保存函数（稳定引用）
  const performSave = useCallback(async () => {
    // 保存当前正在编辑的noteId的快照，避免切换时写错对象
    const currentNoteId = activeNoteIdRef.current
    if (process.env.NODE_ENV === 'development') {
      logger.log('[WhiteboardEditor] performSave调用', {
        currentNoteId,
        componentNoteId: noteId,
        hasExcalidrawAPI: !!excalidrawAPI,
        hasLatestScene: !!latestSceneRef.current
      })
    }

    // 优先使用 latestSceneRef 中的数据（即使组件卸载也能获取）
    let elements, appState, files
    
    if (latestSceneRef.current && latestSceneRef.current.elements && latestSceneRef.current.elements.length > 0) {
      elements = latestSceneRef.current.elements
      appState = latestSceneRef.current.appState
      files = latestSceneRef.current.files
    } else if (excalidrawAPI) {
      elements = excalidrawAPI.getSceneElements()
      appState = excalidrawAPI.getAppState()
      files = excalidrawAPI.getFiles()
    } else {
      return
    }

    if (!currentNoteId) {
      return
    }

    try {

      // 将图片保存到文件系统
      let fileMap = {}
      if (files && Object.keys(files).length > 0) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 保存图片到文件系统', {
            filesCount: Object.keys(files).length
          })
        }
        
        const result = await window.electronAPI.whiteboard.saveImages(files)
        if (result.success) {
          fileMap = result.data
        } else {
          throw new Error(result.error || '保存图片失败')
        }
      }

      const persistedAppState = {
        viewBackgroundColor: appState.viewBackgroundColor,
        currentItemFontFamily: appState.currentItemFontFamily,
        gridSize: appState.gridSize
      }

      const data = {
        type: 'excalidraw',
        version: 2,
        source: 'Flota-local',
        elements,
        appState: persistedAppState,
        fileMap // 保存文件映射而非实际图片数据
      }

      await updateNote(currentNoteId, {
        content: JSON.stringify(data),
        note_type: 'whiteboard'
      })
      
      lastSavedSceneRef.current = serializeScene(elements, persistedAppState, files)
      
      // 只有当当前组件的noteId与保存的noteId一致时，才更新状态
      if (noteId === currentNoteId) {
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
      }

      // 异步导出 PNG 预览图供移动端查看（不阻塞保存流程）
      // 使用 SVG→Canvas 方式保证清晰度，scale: 2 兼顾质量与文件大小
      try {
        const note = notes?.find(n => n.id === currentNoteId)
        const syncId = note?.sync_id
        if (syncId && window.electronAPI?.whiteboard?.savePreview) {
          exportToSvg({
            elements,
            appState: { ...appState, exportWithDarkMode: false },
            files: files || {},
          }).then(svgElement => {
              const svgString = new XMLSerializer().serializeToString(svgElement)
              const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
              const svgUrl = URL.createObjectURL(svgBlob)
              return new Promise((resolve, reject) => {
                const img = new Image()
                img.onload = () => {
                  const SCALE = 2
                  const canvas = document.createElement('canvas')
                  canvas.width = img.naturalWidth * SCALE
                  canvas.height = img.naturalHeight * SCALE
                  const ctx = canvas.getContext('2d')
                  ctx.scale(SCALE, SCALE)
                  ctx.drawImage(img, 0, 0)
                  URL.revokeObjectURL(svgUrl)
                  canvas.toBlob(pngBlob => {
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result.split(',')[1])
                    reader.onerror = reject
                    reader.readAsDataURL(pngBlob)
                  }, 'image/png')
                }
                img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e) }
                img.src = svgUrl
              })
            })
            .then(base64 => window.electronAPI.whiteboard.savePreview(syncId, base64))
            .catch(err => console.warn('[WhiteboardEditor] 预览图导出失败:', err))
        }
      } catch (_) { /* 预览导出失败不影响主保存 */ }
    } catch (error) {
      console.error('[WhiteboardEditor] 保存失败', error)
      setError('保存失败: ' + error.message)
    }
  }, [excalidrawAPI, noteId, updateNote, serializeScene])

  // 保存开始日志
  const performSaveWithLog = useCallback(async () => {
    if (process.env.NODE_ENV === 'development') {
      logger.log('[WhiteboardEditor] 开始保存', { 
        noteId, 
        hasUnsavedChanges: hasUnsavedChangesRef.current,
        hasExcalidrawAPI: !!excalidrawAPI 
      })
    }
    
    const result = await performSave()
    
    if (process.env.NODE_ENV === 'development') {
      logger.log('[WhiteboardEditor] 保存完成', { 
        noteId, 
        hasUnsavedChanges: hasUnsavedChangesRef.current 
      })
    }
    
    return result
  }, [performSave, noteId, hasUnsavedChangesRef, excalidrawAPI])

  // 使用防抖保存 Hook，白板保存频率较低（10秒）
  const { debouncedSave, saveNow, cancelSave } = useDebouncedSave(performSaveWithLog, 10000)

  // 独立窗口模式：监听窗口关闭事件
  useEffect(() => {
    if (!actualIsStandaloneMode) {
      logger.log('[WhiteboardEditor] 非独立窗口模式，不监听关闭事件')
      return
    }

    logger.log('[WhiteboardEditor] 独立窗口模式，开始监听 standalone-window-save 事件')

    const handleWindowSave = async () => {
      logger.log('[WhiteboardEditor] 收到 standalone-window-save 事件', { 
        noteId, 
        hasUnsavedChanges: hasUnsavedChangesRef.current 
      })
      
      // 无论是否有未保存的更改，都尝试保存（因为可能有延迟的更改）
      try {
        logger.log('[WhiteboardEditor] 开始执行保存...')
        await saveNow()
        logger.log('[WhiteboardEditor] 保存完成')
        // 通知主进程保存完成
        window.dispatchEvent(new CustomEvent('standalone-save-complete'))
      } catch (error) {
        console.error('[WhiteboardEditor] 保存失败:', error)
        // 即使失败也通知，避免主进程一直等待
        window.dispatchEvent(new CustomEvent('standalone-save-complete'))
      }
    }

    // 监听独立窗口保存事件
    window.addEventListener('standalone-window-save', handleWindowSave)
    logger.log('[WhiteboardEditor] 已添加 standalone-window-save 事件监听器')

    return () => {
      logger.log('[WhiteboardEditor] 移除 standalone-window-save 事件监听器')
      window.removeEventListener('standalone-window-save', handleWindowSave)
    }
  }, [actualIsStandaloneMode, noteId, saveNow])

  // 监听视图切换，从笔记视图切换出去时触发保存（仅非独立窗口模式）
  const prevViewRef = useRef(currentView)
  useEffect(() => {
    // 独立窗口模式下不需要监听视图切换（没有视图概念）
    if (actualIsStandaloneMode || !currentView) {
      return
    }
    
    const prevView = prevViewRef.current
    
    // 如果从笔记视图切换到其他视图，且有选中的笔记且有未保存的更改，立即保存
    if (prevView === 'notes' && currentView !== 'notes' && noteId && hasUnsavedChangesRef.current) {
      logger.log('[WhiteboardEditor] 切换视图前保存白板，从', prevView, '切换到', currentView)
      // 先取消防抖保存
      cancelSave()
      // 立即保存
      saveNow().catch(error => {
        console.error('[WhiteboardEditor] 切换视图时保存失败:', error)
      })
    }
    
    // 更新前一个视图
    prevViewRef.current = currentView
  }, [currentView, noteId, saveNow, cancelSave, actualIsStandaloneMode])

  // AI 按钮拖动
  const handleAIBtnPointerDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const btn = aiButtonRef.current
    if (!btn) return
    const groupEl = btn.parentElement          // 按钮组容器（position:absolute）
    const whiteboardEl = groupEl?.parentElement // 白板容器（position:relative）
    const whiteboardRect = whiteboardEl ? whiteboardEl.getBoundingClientRect() : { left: 0, top: 0 }
    const groupRect = groupEl ? groupEl.getBoundingClientRect() : { left: 0, top: 0 }
    aiDragRef.current = {
      dragging: true,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      // 首次拖动时，取按钮组相对于白板容器的实际位置，而非按钮在组内的偏移
      startBtnX: aiBtnPos ? aiBtnPos.x : groupRect.left - whiteboardRect.left,
      startBtnY: aiBtnPos ? aiBtnPos.y : groupRect.top - whiteboardRect.top,
      hasMoved: false,
    }
    btn.setPointerCapture(e.pointerId)
  }, [aiBtnPos])

  const handleAIBtnPointerMove = useCallback((e) => {
    if (!aiDragRef.current.dragging) return
    const dx = e.clientX - aiDragRef.current.startMouseX
    const dy = e.clientY - aiDragRef.current.startMouseY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      aiDragRef.current.hasMoved = true
      setAiBtnPos({ x: aiDragRef.current.startBtnX + dx, y: aiDragRef.current.startBtnY + dy })
    }
  }, [])

  const handleAIBtnPointerUp = useCallback((e) => {
    if (!aiDragRef.current.dragging) return
    aiDragRef.current.dragging = false
    if (!aiDragRef.current.hasMoved) {
      setAiDialogOpen(true)
      setAiError('')
    }
  }, [])

  // AI 生成白板元素
  const handleAIGenerate = useCallback(async () => {
    if (!aiPrompt.trim() || !excalidrawAPI) return

    setAiLoading(true)
    setAiError('')
    setAiLoadingText('AI 正在理解语义…')

    try {
      const existingElements = excalidrawAPI.getSceneElements().filter(e => !e.isDeleted)

      // 保存撤销快照
      aiSnapshotRef.current = existingElements.map(e => ({ ...e }))

      setAiLoadingText('AI 正在生成 Mermaid 图表…')
      const newElements = await aiGenerateExcalidrawElements(aiPrompt.trim(), existingElements)

      setAiLoadingText('布局渲染中…')
      // 合并到现有画布
      const allElements = [...existingElements, ...newElements]
      excalidrawAPI.updateScene({ elements: allElements })
      setAiUndoAvailable(true)

      logger.log('[WhiteboardEditor] AI 生成了', newElements.length, '个元素')

      setAiDialogOpen(false)
      setAiPrompt('')
    } catch (err) {
      console.error('[WhiteboardEditor] AI 生成失败:', err)
      setAiError(err.message || 'AI 生成失败')
      aiSnapshotRef.current = null
    } finally {
      setAiLoading(false)
      setAiLoadingText('')
    }
  }, [aiPrompt, excalidrawAPI])

  // AI 撤销
  const handleAIUndo = useCallback(() => {
    if (!excalidrawAPI || !aiSnapshotRef.current) return
    excalidrawAPI.updateScene({ elements: aiSnapshotRef.current })
    aiSnapshotRef.current = null
    setAiUndoAvailable(false)
    logger.log('[WhiteboardEditor] 已撤销 AI 生成')
  }, [excalidrawAPI])

  // 保存白板
  const saveWhiteboard = useCallback(async () => {
    await saveNow()
  }, [saveNow])

  // 获取当前白板内容（用于类型转换）
  const getCurrentContent = useCallback(async () => {
    if (!excalidrawAPI) return null

    const elements = excalidrawAPI.getSceneElements()
    const appState = excalidrawAPI.getAppState()
    const files = excalidrawAPI.getFiles()

    // 保存图片到文件系统
    let fileMap = {}
    if (files && Object.keys(files).length > 0) {
      const result = await window.electronAPI.whiteboard.saveImages(files)
      if (result.success) {
        fileMap = result.data
      }
    }

    const persistedAppState = {
      viewBackgroundColor: appState.viewBackgroundColor,
      currentItemFontFamily: appState.currentItemFontFamily,
      gridSize: appState.gridSize
    }

    const data = {
      type: 'excalidraw',
      version: 2,
      source: 'Flota-local',
      elements,
      appState: persistedAppState,
      fileMap
    }

    return JSON.stringify(data)
  }, [excalidrawAPI])

  // 导出 PNG
  const exportPNG = useCallback(async () => {
    if (!excalidrawAPI) return

    try {
      logger.log('[WhiteboardEditor] 导出 PNG（SVG→Canvas 高清转换）')

      // 第一步：导出 SVG（矢量，无损）
      const svgElement = await exportToSvg({
        elements: excalidrawAPI.getSceneElements(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      })

      // 第二步：将 SVG 以 3 倍分辨率光栅化为 PNG
      const svgString = new XMLSerializer().serializeToString(svgElement)
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)

      await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const SCALE = 3
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth * SCALE
          canvas.height = img.naturalHeight * SCALE
          const ctx = canvas.getContext('2d')
          ctx.scale(SCALE, SCALE)
          ctx.drawImage(img, 0, 0)
          URL.revokeObjectURL(svgUrl)

          canvas.toBlob(pngBlob => {
            const url = URL.createObjectURL(pngBlob)
            const a = document.createElement('a')
            a.href = url
            a.download = `whiteboard-${noteId}.png`
            a.click()
            URL.revokeObjectURL(url)
            logger.log('[WhiteboardEditor] 导出 PNG 成功')
            resolve()
          }, 'image/png')
        }
        img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e) }
        img.src = svgUrl
      })
    } catch (error) {
      console.error('[WhiteboardEditor] 导出 PNG 失败', error)
    }
  }, [excalidrawAPI, noteId])

  // 将保存、获取内容和导出函数暴露给父组件
  useEffect(() => {
    if (onSaveWhiteboard) {
      onSaveWhiteboard(saveWhiteboard)
    }
  }, [saveWhiteboard, onSaveWhiteboard])

  useEffect(() => {
    if (onGetContent) {
      onGetContent(getCurrentContent)
    }
  }, [getCurrentContent, onGetContent])

  useEffect(() => {
    if (onExportPNG) {
      onExportPNG(exportPNG)
    }
  }, [exportPNG, onExportPNG])

  // 组件卸载时保存当前白板
  useEffect(() => {
    return () => {
      // 如果正在切换笔记，不要在卸载时保存（已在切换逻辑中处理）
      if (isSwitchingNoteRef.current) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 组件卸载，但正在切换笔记，跳过保存')
        }
        return
      }
      
      // 如果正在进行类型转换，不要保存（会覆盖转换结果）
      if (isTypeConvertingRef.current) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 组件卸载，但正在类型转换，跳过保存')
        }
        return
      }
      
      if (process.env.NODE_ENV === 'development') {
        logger.log('[WhiteboardEditor] 组件卸载，检查是否需要保存', { 
          noteId: prevNoteIdRef.current,
          hasUnsavedChanges: hasUnsavedChangesRef.current 
        })
      }
      
      if (hasUnsavedChangesRef.current) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 组件卸载，自动保存当前内容', { 
            noteId: prevNoteIdRef.current 
          })
        }
        saveNow()
      }
    }
  }, [saveNow])

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (isLoading || !initialData || bridgeActive) {
    return (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%'
      }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ 
      position: 'relative', 
      width: '100%', 
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Excalidraw 画布 */}
      <Box sx={{ 
        flex: 1, 
        minHeight: 0,
        width: '100%',
        position: 'relative',
        '& .excalidraw': {
          height: '100% !important',
          width: '100% !important'
        }
      }}>
        <Excalidraw
          key={excalidrawKey}
          excalidrawAPI={(api) => {
            if (api) {
              logger.log('[WhiteboardEditor] Excalidraw API 已设置')
              setExcalidrawAPI(api)
            }
          }}
          initialData={initialData}
          onChange={(elements, appState, files) => {
            if (isApplyingRemoteDataRef.current) {
              return
            }

            const persistedAppState = {
              viewBackgroundColor: appState.viewBackgroundColor,
              currentItemFontFamily: appState.currentItemFontFamily,
              gridSize: appState.gridSize
            }
            latestSceneRef.current = {
              elements,
              appState: persistedAppState,
              files
            }
            const serializedScene = serializeScene(elements, persistedAppState, files)

            if (serializedScene !== lastSavedSceneRef.current) {
              if (!hasUnsavedChangesRef.current) {
                setHasUnsavedChanges(true)
                hasUnsavedChangesRef.current = true
              }
              debouncedSave()
            }
          }}
          theme={isDark ? THEME.DARK : THEME.LIGHT}
          langCode="zh-CN"
          viewModeEnabled={false}
          zenModeEnabled={false}
          gridModeEnabled={false}
          UIOptions={{
            canvasActions: {
              loadScene: false, // 禁用加载场景按钮（我们有自己的笔记管理）
              export: false, // 禁用导出按钮（我们有自己的导出功能）
              saveAsImage: false, // 禁用另存为图片（我们有自己的PNG导出）
            },
          }}
        />
      </Box>

      {/* AI 操作按钮组 */}
      <Box sx={{
        position: 'absolute',
        ...(aiBtnPos
          ? { top: aiBtnPos.y, left: aiBtnPos.x }
          : { bottom: 20, right: 20 }
        ),
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        zIndex: 10,
      }}>
        {/* 撤销按钮 */}
        {aiUndoAvailable && (
          <Box
            onClick={handleAIUndo}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.5,
              px: 1.5, py: 0.75,
              bgcolor: 'warning.main', color: 'warning.contrastText',
              borderRadius: 2, boxShadow: 3, cursor: 'pointer',
              userSelect: 'none', fontSize: 13, fontWeight: 500,
              whiteSpace: 'nowrap',
              '&:hover': { bgcolor: 'warning.dark' },
            }}
          >
            <UndoIcon sx={{ fontSize: 16 }} />
            撤销
          </Box>
        )}
        {/* AI 生成按钮（可拖动） */}
        <Box
          ref={aiButtonRef}
          onPointerDown={handleAIBtnPointerDown}
          onPointerMove={handleAIBtnPointerMove}
          onPointerUp={handleAIBtnPointerUp}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            px: 1.5, py: 0.75,
            bgcolor: 'primary.main', color: 'primary.contrastText',
            borderRadius: 2, boxShadow: 3,
            cursor: 'grab', userSelect: 'none',
            fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            '&:hover': { bgcolor: 'primary.dark' },
            '&:active': { cursor: 'grabbing' },
          }}
        >
          <AIIcon sx={{ fontSize: 18 }} />
          AI 生成
        </Box>
      </Box>

      {/* AI 生成对话框 */}
      <Dialog
        open={aiDialogOpen}
        onClose={() => { if (!aiLoading) setAiDialogOpen(false) }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>AI 生成白板内容</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            maxRows={8}
            placeholder="描述你想生成的白板内容，例如：&#10;• 画一个项目开发流程图&#10;• 用思维导图整理 React 学习路线&#10;• 画一个用户注册的时序图"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleAIGenerate()
              }
            }}
            disabled={aiLoading}
            sx={{ mt: 1 }}
          />
          {aiLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
              {/* 五彩圆圈 */}
              <Box sx={{
                flexShrink: 0,
                width: 22, height: 22, borderRadius: '50%',
                background: 'conic-gradient(#f44336, #ff9800, #ffeb3b, #4caf50, #2196f3, #9c27b0, #f44336)',
                mask: 'radial-gradient(farthest-side, transparent 63%, black 63%)',
                WebkitMask: 'radial-gradient(farthest-side, transparent 63%, black 63%)',
                animation: 'ai-rainbow-spin 0.9s linear infinite',
                '@keyframes ai-rainbow-spin': { '100%': { transform: 'rotate(360deg)' } },
              }} />
              {/* 文字 + 逐点动画 */}
              <Box sx={{ fontSize: 14, color: 'text.secondary', display: 'flex', alignItems: 'baseline', gap: '1px' }}>
                {aiLoadingText || 'AI 生成中'}
                <Box component="span" sx={{
                  display: 'inline-flex', ml: '1px',
                  '& .aidot': { opacity: 0, animation: 'ai-dot-seq 1.5s infinite' },
                  '& .aidot:nth-of-type(2)': { animationDelay: '0.5s' },
                  '& .aidot:nth-of-type(3)': { animationDelay: '1s' },
                  '@keyframes ai-dot-seq': { '0%,66%,100%': { opacity: 0 }, '33%': { opacity: 1 } },
                }}>
                  <span className="aidot">.</span>
                  <span className="aidot">.</span>
                  <span className="aidot">.</span>
                </Box>
              </Box>
            </Box>
          )}
          {aiError && (
            <Alert severity="error" sx={{ mt: 2 }}>{aiError}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAiDialogOpen(false)} disabled={aiLoading} color="inherit">
            取消
          </Button>
          <Button
            onClick={handleAIGenerate}
            disabled={!aiPrompt.trim() || aiLoading}
            variant="contained"
            startIcon={aiLoading ? <CircularProgress size={18} color="inherit" /> : <AIIcon />}
          >
            {aiLoading ? '生成中…' : '生成'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default WhiteboardEditor
