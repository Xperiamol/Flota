import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  TextField,
  Typography,
  Paper,
  Button,
  IconButton,
  Tooltip,
  Divider,
  Popover,
  Stack,
  Chip,
  Alert,
  Snackbar
} from '@mui/material'
import {
  AutoMode as AutoSaveIcon,
  AutoAwesome as AIIcon,
  InfoOutlined as RelatedIcon,
  PushPin as PinIcon,
  PushPinOutlined as PinOutlinedIcon,
  Article as ArticleIcon,
  Brush as WhiteboardIcon,
  WebAsset as WindowIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  GetApp as GetAppIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Close as CloseIcon,
  KeyboardArrowUp as CollapseToolbarIcon,
  KeyboardArrowDown as ExpandToolbarIcon
} from '@mui/icons-material'
import { useStore } from '../store/useStore'
import { useStandaloneContext } from './StandaloneProvider'
import { zhCN } from 'date-fns/locale/zh-CN'
import { parseTags, formatTags } from '../utils/tagUtils'
import shortcutManager from '../utils/ShortcutManager'
import TagInput from './TagInput'
import MarkdownPreview from './MarkdownPreview'
import MarkdownToolbar from './MarkdownToolbar'
import WhiteboardEditor from './WhiteboardEditor'
import NoteTypeConversionDialog from './NoteTypeConversionDialog'
import WYSIWYGEditor from './WYSIWYGEditor'
import AIAssistPanel from './AIAssistPanel'
import RelatedContextPanel from './RelatedContextPanel'
import AICommandCenter from './AICommandCenter'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { imageAPI } from '../api/imageAPI'
import { convertMarkdownToWhiteboard, convertWhiteboardToMarkdown, extractImageUrls } from '../utils/markdownToWhiteboardConverter'
import { aiConvertMarkdownToWhiteboard } from '../utils/aiExcalidrawGenerator'
import { useError } from './ErrorProvider'
import { useTranslation } from '../utils/i18n'
import { saveQueue } from '../utils/SaveQueue'
import logger from '../utils/logger'
import { formatRelativeNoteTime } from '../utils/noteDateUtils'
import { finalizeMarkdownForStorage } from '../markdown/index.js'
import { pickClipboardMarkdown } from '../utils/clipboardConversion'
import { insertIntoTextarea, placeCursorAfterInsert } from '../utils/textareaInsert'

const NoteEditor = () => {
  // 检测是否在独立窗口模式下运行
  let standaloneContext = null
  let isStandaloneMode = false
  try {
    standaloneContext = useStandaloneContext()
    isStandaloneMode = true
  } catch (error) {
    // 不在独立窗口模式下，使用主应用store
    isStandaloneMode = false
  }
  const isMinibarMode = Boolean(standaloneContext?.minibarMode)

  // 根据运行环境选择状态管理
  const mainStore = useStore()
  const store = standaloneContext || mainStore
  const maskOpacity = useStore((state) => state.maskOpacity)
  const aiCommandCenterEnabled = useStore((state) => state.aiCommandCenterEnabled)
  const aiCommandCenterOpen = useStore((state) => state.aiCommandCenterOpen)
  const setAiCommandCenterEnabled = useStore((state) => state.setAiCommandCenterEnabled)
  const setAiCommandCenterOpen = useStore((state) => state.setAiCommandCenterOpen)
  const initializeMainSettings = useStore((state) => state.initializeSettings)
  const userAvatar = useStore((state) => state.userAvatar)

  const { t } = useTranslation()
  const { showError } = useError()

  const {
    selectedNoteId,
    notes,
    updateNote,
    togglePinNote,
    editorMode,
    currentView
  } = store

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [noteType, setNoteType] = useState('markdown') // 'markdown' or 'whiteboard'
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [showSaveSuccess, setShowSaveSuccess] = useState(false)
  const [showSaveError, setShowSaveError] = useState(false)
  const [saveErrorMessage, setSaveErrorMessage] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [viewMode, setViewMode] = useState('edit') // 'edit', 'preview', 'split'
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false)
  const [pendingNoteType, setPendingNoteType] = useState(null)
  const [whiteboardGetContentFunc, setWhiteboardGetContentFunc] = useState(null)
  const [whiteboardExportFunc, setWhiteboardExportFunc] = useState(null)
  const [wikiLinkError, setWikiLinkError] = useState('') // wiki 链接错误提示
  const [isOpenInStandaloneWindow, setIsOpenInStandaloneWindow] = useState(false) // 是否在独立窗口中打开
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [userToolbarCollapsed, setUserToolbarCollapsed] = useState(false) // 用户主动折叠工具栏（会话级，不持久化）
  const [fullscreenToolbarExpanded, setFullscreenToolbarExpanded] = useState(false)
  const [minibarToolbarExpanded, setMinibarToolbarExpanded] = useState(false)
  const [standaloneAICommandCenterOpen, setStandaloneAICommandCenterOpen] = useState(false)
  const [relatedAnchorEl, setRelatedAnchorEl] = useState(null)
  const editorContainerRef = useRef(null)
  const contentRef = useRef(null)
  const titleRef = useRef(null)
  const wysiwygEditorRef = useRef(null)
  // WYSIWYG editor 实例存到 state，避免 ref 在首次渲染时为 null 导致工具栏拿不到
  const [wysiwygEditor, setWysiwygEditor] = useState(null)
  const [blockSelectActive, setBlockSelectActive] = useState(false)

  const currentNote = notes.find(note => note.id === selectedNoteId)
  const resolvedAICommandCenterOpen = isStandaloneMode
    ? standaloneAICommandCenterOpen
    : aiCommandCenterOpen
  const persistedNoteType = currentNote?.note_type || 'markdown'
  const selectedNoteIdRef = useRef(selectedNoteId)
  const prevNoteIdRef = useRef(null)
  const prevStateRef = useRef({ title: '', content: '', tags: '', noteType: 'markdown' })
  const hasUnsavedChangesRef = useRef(false)

  useEffect(() => {
    if (isStandaloneMode) {
      initializeMainSettings?.()
    }
    if (!isStandaloneMode || !window.electronAPI?.settings?.onSettingChanged) return undefined
    const unsubscribe = window.electronAPI.settings.onSettingChanged((data) => {
      if (data?.key === 'userAvatar' || data?.key === 'userName') {
        initializeMainSettings?.()
      }
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [initializeMainSettings, isStandaloneMode])

  const getSavedAtFromUpdateResult = (result) => {
    if (result?.data?.updated_at) return result.data.updated_at
    if (result?.data?.created_at) return result.data.created_at
    return null
  }

  const ensureUpdateSucceeded = (result) => {
    if (!result?.success) {
      throw new Error(result?.error || '保存失败，请重试')
    }
    return result
  }

  const createSavePayload = (state) => ({
    title: (state.title || '').trim(),
    content: (state.noteType || 'markdown') === 'markdown'
      ? finalizeMarkdownForStorage(state.content || '')
      : (state.content || ''),
    tags: formatTags(parseTags(state.tags || '')),
    note_type: state.noteType || 'markdown'
  })

  // 保存函数（稳定引用，带重试机制和队列管理）
  const performSave = async (retries = 3) => {
    const noteId = selectedNoteId
    if (!noteId) return

    const stateToSave = createSavePayload({ ...prevStateRef.current })

    // 使用保存队列避免并发冲突
    return saveQueue.add(noteId, async () => {
      setIsAutoSaving(true)
      
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const result = ensureUpdateSucceeded(await updateNote(noteId, stateToSave))
          const persistedSavedAt = getSavedAtFromUpdateResult(result)
          setLastSaved(persistedSavedAt || currentNote?.updated_at || currentNote?.created_at || null)
          if (selectedNoteIdRef.current === noteId) {
            setHasUnsavedChanges(false)
            hasUnsavedChangesRef.current = false
          }
          setShowSaveError(false)
          logger.log('[NoteEditor] 自动保存成功')
          setIsAutoSaving(false)
          return // 保存成功，退出
        } catch (error) {
          console.error(`[NoteEditor] 自动保存失败 (尝试 ${attempt + 1}/${retries}):`, error)
          
          if (attempt === retries - 1) {
            // 最后一次尝试失败
            setShowSaveError(true)
            setSaveErrorMessage(error.message || '保存失败，请重试')
            console.error('[NoteEditor] 保存失败，已达最大重试次数')
            showError(error, '自动保存失败，请稍后重试')
            setIsAutoSaving(false)
            throw error; // 抛出错误让队列知道保存失败
          } else {
            // 等待一段时间后重试
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
      }
    });
  }

  // 使用防抖保存 Hook（3秒延迟，避免频繁保存）
  const { debouncedSave, saveNow, cancelSave } = useDebouncedSave(performSave, 3000)

  // 同步 hasUnsavedChanges 到 ref
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId
  }, [selectedNoteId])

  // 第一步：在切换笔记前保存旧笔记
  useEffect(() => {
    // 只在 selectedNoteId 真正变化时才执行
    if (prevNoteIdRef.current !== null && prevNoteIdRef.current !== selectedNoteId) {
      // 检查是否有未保存的更改
      if (hasUnsavedChangesRef.current) {
        const oldNoteId = prevNoteIdRef.current
        const stateToSave = createSavePayload({ ...prevStateRef.current })

        // 先取消当前的防抖保存
        cancelSave()

        // 使用保存队列立即保存，确保按顺序执行
        saveQueue.add(oldNoteId, async () => {
          logger.log('[NoteEditor] 切换笔记前保存:', oldNoteId);
          await updateNote(oldNoteId, stateToSave);
        }).catch(error => {
          console.error('[NoteEditor] 切换笔记时保存失败:', error);
        });
      }
    }

    // 更新 prevNoteIdRef
    prevNoteIdRef.current = selectedNoteId
  }, [selectedNoteId, updateNote, cancelSave])

  // 监听视图切换，从笔记视图切换出去时触发保存
  const prevViewRef = useRef(currentView)
  useEffect(() => {
    const prevView = prevViewRef.current
    
    // 如果从笔记视图切换到其他视图，且有选中的笔记且有未保存的更改，立即保存
    if (prevView === 'notes' && currentView !== 'notes' && selectedNoteId && hasUnsavedChangesRef.current) {
      logger.log('[NoteEditor] 切换视图前保存笔记，从', prevView, '切换到', currentView)
      cancelSave()
      const noteId = selectedNoteId
      const stateToSave = createSavePayload({ ...prevStateRef.current })
      saveQueue.add(noteId, async () => {
        await updateNote(noteId, stateToSave)
      }).catch(error => {
        console.error('[NoteEditor] 切换视图时保存失败:', error)
      })
    }
    
    // 更新前一个视图
    prevViewRef.current = currentView
  }, [currentView, selectedNoteId, updateNote, cancelSave])

  // 检查笔记是否在独立窗口中打开（仅主窗口，事件驱动）
  useEffect(() => {
    if (isStandaloneMode || !selectedNoteId) {
      setIsOpenInStandaloneWindow(false)
      return
    }

    // 初始检查一次当前状态
    const checkWindowStatus = async () => {
      try {
        const result = await window.electronAPI?.isNoteOpenInWindow?.(selectedNoteId)
        if (result?.success) {
          setIsOpenInStandaloneWindow(result.isOpen)
        }
      } catch (error) {
        console.error('检查独立窗口状态失败:', error)
        showError(error, '检查窗口状态失败')
      }
    }
    checkWindowStatus()

    // 通过 IPC 事件驱动更新，替代 2 秒轮询
    const unsubCreated = window.electronAPI?.window?.onWindowCreated?.((data) => {
      if (data?.noteId == selectedNoteId) {
        setIsOpenInStandaloneWindow(true)
      }
    })
    const unsubClosed = window.electronAPI?.window?.onWindowClosed?.((data) => {
      if (data?.noteId == selectedNoteId) {
        setIsOpenInStandaloneWindow(false)
      }
    })

    return () => {
      unsubCreated?.()
      unsubClosed?.()
    }
  }, [selectedNoteId, isStandaloneMode])

  // 第二步：加载新笔记的数据
  // 重要：只在 selectedNoteId 变化时加载新内容，避免同步更新时覆盖用户正在编辑的内容
  useEffect(() => {
    if (currentNote) {
      const newTitle = currentNote.title || ''
      const newContent = currentNote.content || ''
      // 处理 tags：可能是数组或逗号分隔的字符串
      const newTags = Array.isArray(currentNote.tags)
        ? currentNote.tags.join(', ')
        : (currentNote.tags || '')
      const newNoteType = currentNote.note_type || 'markdown'

      setTitle(newTitle)
      setContent(newContent)
      setTags(newTags)
      setNoteType(newNoteType)
      setLastSaved(currentNote.updated_at)
      setHasUnsavedChanges(false)
      setShowSaveError(false)

      // 保存新笔记的状态到 ref
      prevStateRef.current = {
        title: newTitle,
        content: newContent,
        tags: newTags,
        noteType: newNoteType
      }

      // 如果是新创建的笔记（内容为空），自动聚焦到内容输入框
      const noteTitle = String(currentNote.title || '').trim()
      const isNewNote = !currentNote.content && 
        (!noteTitle || noteTitle === '无标题' || noteTitle === 'Untitled' || noteTitle === '新笔记')
      if (isNewNote) {
        setTimeout(() => {
          if (contentRef.current) {
            const textarea = contentRef.current.querySelector('textarea')
            if (textarea) {
              textarea.focus()
            }
          }
        }, 100)
      }
    } else {
      setTitle('')
      setContent('')
      setTags('')
      setLastSaved(null)
      setHasUnsavedChanges(false)
      prevStateRef.current = { title: '', content: '', tags: '' }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoteId]) // 只依赖 selectedNoteId，不依赖 currentNote，防止同步更新覆盖编辑中的内容

  // 暴露保存函数供窗口关闭时调用
  useEffect(() => {
    window.__saveBeforeClose = async () => {
      if (hasUnsavedChangesRef.current) {
        logger.log('[NoteEditor] 窗口关闭前保存');
        await saveNow();
      }
    };

    return () => {
      delete window.__saveBeforeClose;
    };
  }, [saveNow]);

  // 初始化快捷键管理器和注册监听器
  useEffect(() => {
    const initializeShortcuts = async () => {
      logger.log('初始化快捷键管理器...')
      await shortcutManager.initialize()

      // 只注册保存快捷键，其他快捷键使用编辑器原生实现
      const handlers = {
        save: handleManualSave
      }

      shortcutManager.registerListener(document, handlers)
      logger.log('编辑器快捷键监听器已注册')
    }

    initializeShortcuts()

    // 清理函数：组件卸载时保存未保存的内容
    return () => {
      shortcutManager.unregisterListener(document)

      // 组件卸载时立即保存（使用 ref 拿到最新值，避免闭包过期）
      const noteId = selectedNoteIdRef.current
      if (hasUnsavedChangesRef.current && noteId) {
        updateNote(noteId, createSavePayload(prevStateRef.current)).catch(error => {
          console.error('组件卸载时保存失败:', error)
        })
      }
    }
  }, [])

  // 独立窗口模式：监听窗口关闭事件，触发保存
  useEffect(() => {
    if (!isStandaloneMode) return

    const handleStandaloneSave = async () => {
      logger.log('独立窗口保存事件触发', { noteType: prevStateRef.current.noteType })

      // 对于白板类型，触发全局保存事件由WhiteboardEditor处理
      if (prevStateRef.current.noteType === 'whiteboard') {
        logger.log('白板类型，触发白板保存事件')
        const whiteboardSaveEvent = new CustomEvent('whiteboard-save')
        window.dispatchEvent(whiteboardSaveEvent)
        // 等待白板保存完成
        await new Promise(resolve => setTimeout(resolve, 500))
        return
      }

      // Markdown类型的保存逻辑
      if (hasUnsavedChangesRef.current && selectedNoteId) {
        try {
          await updateNote(selectedNoteId, createSavePayload(prevStateRef.current))
          logger.log('独立窗口关闭前Markdown保存成功')
          // 通知主进程保存完成
          window.dispatchEvent(new CustomEvent('standalone-save-complete'))
        } catch (error) {
          console.error('独立窗口关闭前保存失败:', error)
          showError(error, '保存失败')
          // 即使失败也通知，避免主进程一直等待
          window.dispatchEvent(new CustomEvent('standalone-save-complete'))
        }
      } else {
        // 没有未保存的更改，也通知完成
        window.dispatchEvent(new CustomEvent('standalone-save-complete'))
      }
    }

    // 监听自定义保存事件
    window.addEventListener('standalone-window-save', handleStandaloneSave)

    return () => {
      window.removeEventListener('standalone-window-save', handleStandaloneSave)
    }
  }, [isStandaloneMode, selectedNoteId, updateNote])

  const handleTitleChange = (e) => {
    const newValue = e.target.value
    setTitle(newValue)
    setHasUnsavedChanges(true)
    // 同时更新 ref，避免额外的 useEffect
    prevStateRef.current.title = newValue
    // 触发防抖保存
    debouncedSave()
  }

  const handleContentChange = (e) => {
    const newValue = e.target.value
    setContent(newValue)
    setHasUnsavedChanges(true)
    // 同时更新 ref，避免额外的 useEffect
    prevStateRef.current.content = newValue
    // 触发防抖保存
    debouncedSave()
  }



  const handleManualSave = async () => {
    if (!selectedNoteId) return

    try {
      const result = ensureUpdateSucceeded(await updateNote(selectedNoteId, createSavePayload({
        title,
        content,
        tags,
        noteType
      })))
      const persistedSavedAt = getSavedAtFromUpdateResult(result)
      setLastSaved(persistedSavedAt || currentNote?.updated_at || currentNote?.created_at || null)
      setHasUnsavedChanges(false)
      setShowSaveError(false)
      setShowSaveSuccess(true)
    } catch (error) {
      console.error('保存失败:', error)
      showError(error, '保存失败')
      setShowSaveError(true)
      setSaveErrorMessage(error.message || '保存失败')
    }
  }

  const handleTogglePin = async () => {
    if (selectedNoteId) {
      await togglePinNote(selectedNoteId)
    }
  }

  const handleToggleRelatedContext = (event) => {
    setRelatedAnchorEl((prev) => (prev ? null : event.currentTarget))
  }

  const handleCloseRelatedContext = () => {
    setRelatedAnchorEl(null)
  }

  // 处理 wiki 链接点击
  const handleWikiLinkClick = (wikiTarget) => {
    // 根据笔记标题查找所有匹配的笔记
    const matchingNotes = notes.filter(note =>
      note.title && note.title.toLowerCase() === wikiTarget.toLowerCase()
    )

    if (matchingNotes.length === 0) {
      console.warn(`Wiki link target not found: ${wikiTarget}`)
      setWikiLinkError(t('common.wikiLinkNotFound', { noteTitle: wikiTarget }))
      return
    }

    let targetNote

    if (matchingNotes.length === 1) {
      // 只有一个匹配的笔记，直接使用
      targetNote = matchingNotes[0]
    } else {
      // 多个相同标题的笔记，优先选择最近修改的
      targetNote = matchingNotes.reduce((latest, current) => {
        const latestTime = new Date(latest.updated_at || latest.created_at || 0)
        const currentTime = new Date(current.updated_at || current.created_at || 0)
        return currentTime > latestTime ? current : latest
      })

      console.info(`Multiple notes found with title "${wikiTarget}", navigating to the most recently updated one (ID: ${targetNote.id})`)
    }

    // 设置选中的笔记 ID 来导航到该笔记
    store.setSelectedNoteId(targetNote.id)
  }

  // 处理标签点击
  const handleTagClick = (tag) => {
    // 设置搜索查询来过滤显示该标签的笔记
    store.setSearchQuery(`tag:${tag}`)
  }

  // 处理在独立窗口打开
  const handleOpenStandalone = async () => {
    if (!selectedNoteId) return

    try {
      await window.electronAPI.createNoteWindow(selectedNoteId)
    } catch (error) {
      console.error('打开独立窗口失败:', error)
      showError(error, '打开独立窗口失败')
    }
  }

  const handleToggleFullscreen = useCallback(async () => {
    const container = editorContainerRef.current
    if (!container) return

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen()
      } else if (!document.fullscreenElement) {
        await container.requestFullscreen()
      } else {
        await document.exitFullscreen()
        await container.requestFullscreen()
      }
    } catch (error) {
      console.error('切换全屏失败:', error)
      showError(error, '切换全屏失败')
    }
  }, [showError])

  // 处理笔记类型切换
  const handleNoteTypeChange = async (newType) => {
    if (newType === null) return

    // 如果切换到相同类型，不做任何操作
    if (newType === noteType) return

    const shouldSkipDialog =
      (noteType === 'markdown' && newType === 'whiteboard' && isMarkdownNoteEmpty()) ||
      (noteType === 'whiteboard' && newType === 'markdown' && await isWhiteboardNoteEmpty())

    if (shouldSkipDialog) {
      setPendingNoteType(null)
      setConversionDialogOpen(false)
      if (noteType === 'markdown' && newType === 'whiteboard') {
        await convertMarkdownToWhiteboardNote()
      } else if (noteType === 'whiteboard' && newType === 'markdown') {
        await convertWhiteboardToMarkdownNote()
      }
      return
    }

    // 记录用户想要切换到的类型
    setPendingNoteType(newType)

    // 显示转换确认对话框
    setConversionDialogOpen(true)
  }

  // AI 转换 loading 状态（在 NoteTypeConversionDialog 中显示）
  const [aiConvertLoading, setAiConvertLoading] = useState(false)
  const [aiConvertStep, setAiConvertStep] = useState('')

  const isMarkdownNoteEmpty = useCallback(() => {
    return !String(title || '').trim() &&
      !String(content || '').trim() &&
      !String(tags || '').trim()
  }, [title, content, tags])

  const isWhiteboardNoteEmpty = useCallback(async () => {
    try {
      const rawContent = whiteboardGetContentFunc
        ? await whiteboardGetContentFunc()
        : currentNote?.content

      if (!rawContent) return true
      const parsed = JSON.parse(rawContent)
      const elements = Array.isArray(parsed?.elements) ? parsed.elements : []
      return elements.filter(element => !element?.isDeleted).length === 0
    } catch (error) {
      logger.warn('[NoteEditor] 判断白板是否为空失败，按非空处理:', error)
      return false
    }
  }, [whiteboardGetContentFunc, currentNote?.content])

  // 处理转换确认 (confirmed: false=取消, true=普通转换, 'ai'=AI转换)
  const handleConversionConfirm = async (confirmed) => {
    if (!confirmed || !pendingNoteType) {
      // 用户取消，重置
      setConversionDialogOpen(false)
      setPendingNoteType(null)
      return
    }

    try {
      if (noteType === 'markdown' && pendingNoteType === 'whiteboard') {
        if (confirmed === 'ai') {
          // 保持对话框开启，显示 loading
          setAiConvertLoading(true)
          setAiConvertStep('AI 正在分析并生成图表')
          try {
            await aiConvertMarkdownToWhiteboardNote()
          } finally {
            setAiConvertLoading(false)
            setAiConvertStep('')
            setConversionDialogOpen(false)
          }
          return
        } else {
          setConversionDialogOpen(false)
          await convertMarkdownToWhiteboardNote()
        }
      } else if (noteType === 'whiteboard' && pendingNoteType === 'markdown') {
        setConversionDialogOpen(false)
        await convertWhiteboardToMarkdownNote()
      }
    } catch (error) {
      console.error('笔记类型转换失败:', error)
      showError(error, '笔记类型转换失败')
      setShowSaveSuccess(false)
    } finally {
      setPendingNoteType(null)
    }
  }

  // Markdown 转白板（支持图片）
  const convertMarkdownToWhiteboardNote = async () => {
    if (!selectedNoteId) return

    try {
      // 先保存当前 MD 内容（和白板转换逻辑一样）
      logger.log('MD转白板: 先保存当前内容...')
      
      if (hasUnsavedChangesRef.current) {
        logger.log('MD转白板: 检测到未保存的更改，立即保存')
        cancelSave()
        saveNow()
        // 等待保存完成
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      
      // 从 store 重新获取最新的笔记内容
      const latestNote = notes.find(n => n.id === selectedNoteId)
      const markdownContent = latestNote?.content || content || ''
      
      logger.log('MD转白板: 获取到MD内容长度:', markdownContent.length)
      
      // 提取 Markdown 中的图片 URL
      const imageUrls = extractImageUrls(markdownContent)
      logger.log('MD转白板: 提取到图片URL:', imageUrls)
      
      const imageDataMap = {}
      
      // 加载图片数据
      for (const url of imageUrls) {
        try {
          // 如果是本地图片路径，读取图片数据
          if (url.startsWith('Flota://') || url.startsWith('images/')) {
            const dataURL = await imageAPI.getBase64(url)
            if (dataURL) {
              // 从 dataURL 解析 mimeType
              const mimeMatch = dataURL.match(/^data:([^;]+);/)
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
              imageDataMap[url] = {
                dataURL: dataURL,
                mimeType: mimeType
              }
              logger.log('MD转白板: 加载图片成功:', url)
            }
          }
        } catch (error) {
          console.warn('MD转白板: 加载图片失败:', url, error)
        }
      }
      
      // 转换 Markdown 内容为白板数据（包含图片）
      logger.log('MD转白板: 开始转换，图片数据:', Object.keys(imageDataMap).length)
      const whiteboardContentStr = convertMarkdownToWhiteboard(markdownContent, imageDataMap)
      logger.log('MD转白板: 转换结果长度:', whiteboardContentStr?.length || 0)
      
      // 解析白板数据，将图片保存到文件系统（和白板保存逻辑一致）
      const whiteboardData = JSON.parse(whiteboardContentStr)
      let finalFileMap = {}
      
      if (whiteboardData.fileMap && Object.keys(whiteboardData.fileMap).length > 0) {
        logger.log('MD转白板: 保存图片到文件系统...')
        const files = whiteboardData.fileMap
        const result = await window.electronAPI.whiteboard.saveImages(files)
        
        if (result.success) {
          finalFileMap = result.data
          logger.log('MD转白板: 图片保存成功，数量:', Object.keys(finalFileMap).length)
        } else {
          console.warn('MD转白板: 图片保存失败:', result.error)
          // 继续，但图片可能丢失
        }
      }
      
      // 构建最终的白板数据（使用保存后的 fileMap）
      const finalWhiteboardData = {
        ...whiteboardData,
        fileMap: finalFileMap
      }
      const finalWhiteboardContent = JSON.stringify(finalWhiteboardData)
      logger.log('MD转白板: 最终数据长度:', finalWhiteboardContent.length)

      // 先更新笔记到数据库（在切换类型之前，确保数据已保存）
      const updateResult = await updateNote(selectedNoteId, {
        content: finalWhiteboardContent,
        note_type: 'whiteboard',
        title: title.trim(),
        tags: formatTags(parseTags(tags))
      })
      
      if (!updateResult || !updateResult.success) {
        throw new Error('保存失败: ' + (updateResult?.error || '未知错误'))
      }
      
      logger.log('MD转白板: 数据库更新完成')

      // 然后更新本地状态，触发 WhiteboardEditor 挂载
      setNoteType('whiteboard')
      setContent('') // 清空 Markdown content 状态（白板数据存储在 note.content 中）
      prevStateRef.current.noteType = 'whiteboard'
      prevStateRef.current.content = ''
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false

      logger.log('Markdown 转白板成功，处理了', imageUrls.length, '张图片')
    } catch (error) {
      console.error('Markdown 转白板失败:', error)
      showError(error, 'Markdown 转白板失败')
      throw error
    }
  }

  // AI 智能 Markdown 转白板
  const aiConvertMarkdownToWhiteboardNote = async () => {
    if (!selectedNoteId) return

    try {
      // 先保存当前 MD 内容
      if (hasUnsavedChangesRef.current) {
        cancelSave()
        saveNow()
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      const latestNote = notes.find(n => n.id === selectedNoteId)
      const markdownContent = latestNote?.content || content || ''

      logger.log('AI MD转白板: 内容长度:', markdownContent.length)

      // 调用 AI 生成白板数据
      const whiteboardContentStr = await aiConvertMarkdownToWhiteboard(markdownContent)

      // 更新数据库
      const updateResult = await updateNote(selectedNoteId, {
        content: whiteboardContentStr,
        note_type: 'whiteboard',
        title: title.trim(),
        tags: formatTags(parseTags(tags))
      })

      if (!updateResult || !updateResult.success) {
        throw new Error('保存失败: ' + (updateResult?.error || '未知错误'))
      }

      // 更新本地状态
      setNoteType('whiteboard')
      setContent('')
      prevStateRef.current.noteType = 'whiteboard'
      prevStateRef.current.content = ''
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false

      logger.log('AI Markdown 转白板成功')
    } catch (error) {
      console.error('AI Markdown 转白板失败:', error)
      showError(error, 'AI 转换失败: ' + error.message)
      throw error
    }
  }

  // 白板转 Markdown（智能提取内容和图片）
  const convertWhiteboardToMarkdownNote = async () => {
    if (!selectedNoteId) return

    try {
      // 直接从白板编辑器获取最新内容（包括图片）
      logger.log('白板转MD: 从编辑器获取最新内容...')
      
      if (!whiteboardGetContentFunc) {
        console.error('白板转MD: whiteboardGetContentFunc 未初始化')
        return
      }
      
      // 直接获取当前编辑器的内容（会自动保存图片到文件系统）
      const whiteboardContent = await whiteboardGetContentFunc()
      
      if (!whiteboardContent) {
        console.error('白板转MD: 获取内容失败')
        return
      }
      
      logger.log('白板转MD: 获取到内容长度:', whiteboardContent.length)
      
      // 通知白板编辑器正在进行类型转换，避免卸载时自动保存覆盖转换结果
      window.dispatchEvent(new CustomEvent('whiteboard-type-converting'))
      
      // 转换白板为 Markdown
      const { markdown, imageMap } = convertWhiteboardToMarkdown(whiteboardContent)
      
      logger.log('白板转MD: 原始markdown长度:', markdown.length)
      logger.log('白板转MD: 图片数量:', Object.keys(imageMap).length)
      logger.log('白板转MD: 图片映射:', imageMap)
      
      // 处理图片：将白板中的图片保存为 Markdown 可用的格式
      let finalMarkdown = finalizeMarkdownForStorage(markdown)
      
      for (const [fileName, imageData] of Object.entries(imageMap)) {
        logger.log('白板转MD: 处理图片:', fileName, imageData)
        
        try {
          let dataURL = imageData.dataURL
          
          // 如果没有 dataURL，尝试从文件系统加载
          if (!dataURL && imageData.sourceFileName) {
            logger.log('白板转MD: 从文件系统加载图片:', imageData.sourceFileName)
            // 加载白板图片
            const loadResult = await window.electronAPI.whiteboard.loadImage(imageData.sourceFileName)
            if (loadResult.success) {
              dataURL = loadResult.data
              logger.log('白板转MD: 图片加载成功，dataURL长度:', dataURL?.length || 0)
            } else {
              console.warn('白板转MD: 图片加载失败:', loadResult.error)
            }
          }
          
          if (dataURL) {
            // 从 dataURL 提取 buffer 并保存
            const base64Data = dataURL.split(',')[1]
            const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
            const imagePath = await imageAPI.saveFromBuffer(buffer, fileName)
            logger.log('白板转MD: 图片保存成功:', imagePath)
            
            // 替换占位符为实际路径
            const placeholder = `{{IMAGE_PLACEHOLDER:${fileName}}}`
            finalMarkdown = finalizeMarkdownForStorage(finalMarkdown.replace(placeholder, imagePath))
          } else {
            console.warn('白板转MD: 无法获取图片数据:', fileName)
            // 移除无法保存的图片占位符
            finalMarkdown = finalMarkdown.replace(
              new RegExp(`!\\[[^\\]]*\\]\\(\\{\\{IMAGE_PLACEHOLDER:${fileName}\\}\\}\\)\\n?`, 'g'),
              ''
            )
          }
        } catch (error) {
          console.warn('保存图片失败:', fileName, error)
          // 移除无法保存的图片占位符
          finalMarkdown = finalMarkdown.replace(
            new RegExp(`!\\[[^\\]]*\\]\\(\\{\\{IMAGE_PLACEHOLDER:${fileName}\\}\\}\\)\\n?`, 'g'),
            ''
          )
        }
      }
      
      // 先更新本地状态，避免 store 更新触发重渲染时状态不一致
      setNoteType('markdown')
      setContent(finalMarkdown)
      prevStateRef.current.noteType = 'markdown'
      prevStateRef.current.content = finalMarkdown
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false
      
      // 更新笔记到数据库
      await updateNote(selectedNoteId, {
        content: finalMarkdown,
        note_type: 'markdown',
        title: title.trim(),
        tags: formatTags(parseTags(tags))
      })

      logger.log('白板转 Markdown 成功，提取了', Object.keys(imageMap).length, '张图片')
    } catch (error) {
      console.error('白板转 Markdown 失败:', error)
      showError(error, '白板转 Markdown 失败')
      throw error
    }
  }

  // 处理Markdown工具栏插入文本（支持撤销）
  const handleMarkdownInsert = (before, after = '', placeholder = '') => {
    const textarea = contentRef.current?.querySelector('textarea')
    if (!textarea) {
      // 预览模式下没有 textarea，直接追加到 content 末尾
      const insertedText = before + (placeholder || '') + after
      const newContent = content + (content.endsWith('\n') ? '' : '\n') + insertedText
      setContent(newContent)
      setHasUnsavedChanges(true)
      prevStateRef.current.content = newContent
      debouncedSave()
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = content.substring(start, end)
    const textToInsert = selectedText || placeholder
    const insertedText = before + textToInsert + after

    // 使用可撤销的方式插入文本
    textarea.focus()
    textarea.setSelectionRange(start, end)
    
    let success = false
    try {
      success = document.execCommand('insertText', false, insertedText)
    } catch (e) {
      success = false
    }
    
    if (!success) {
      // 回退方案：直接修改内容
      const newContent = content.substring(0, start) + insertedText + content.substring(end)
      setContent(newContent)
    }
    
    setHasUnsavedChanges(true)
    prevStateRef.current.content = textarea.value
    debouncedSave()

    // 设置新的光标位置
    setTimeout(() => {
      const newCursorPos = start + before.length + textToInsert.length
      textarea.focus()
      textarea.setSelectionRange(newCursorPos, newCursorPos + (selectedText ? 0 : after.length))
    }, 0)
  }

  // 处理块级格式切换（标题、列表、引用等行首前缀替换）
  const handleBlockFormat = (prefix) => {
    if (!contentRef.current) return
    const textarea = contentRef.current.querySelector('textarea')
    if (!textarea) return

    const start = textarea.selectionStart
    const text = textarea.value

    // 找到当前行的起始和结束位置
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const lineEnd = text.indexOf('\n', start)
    const lineEndPos = lineEnd === -1 ? text.length : lineEnd
    const line = text.substring(lineStart, lineEndPos)

    // 匹配已有的块级前缀
    const blockPrefixRegex = /^(#{1,6}\s|>\s|- \[[ x]\]\s|- |\* |\d+\.\s)/
    const match = line.match(blockPrefixRegex)
    const existingPrefix = match ? match[1] : ''

    let newLine
    if (existingPrefix === prefix) {
      // 同一格式再次点击 → 取消格式（回到正文）
      newLine = line.substring(existingPrefix.length)
    } else if (existingPrefix) {
      // 已有其他块级格式 → 替换
      newLine = prefix + line.substring(existingPrefix.length)
    } else {
      // 无格式 → 添加
      newLine = prefix + line
    }

    // 选中整行并替换
    textarea.focus()
    textarea.setSelectionRange(lineStart, lineEndPos)
    let success = false
    try {
      success = document.execCommand('insertText', false, newLine)
    } catch (e) {
      success = false
    }
    if (!success) {
      const newContent = text.substring(0, lineStart) + newLine + text.substring(lineEndPos)
      setContent(newContent)
    }

    setHasUnsavedChanges(true)
    prevStateRef.current.content = textarea.value
    debouncedSave()

    // 光标放到行内容末尾
    setTimeout(() => {
      const cursorPos = lineStart + newLine.length
      textarea.focus()
      textarea.setSelectionRange(cursorPos, cursorPos)
    }, 0)
  }

  const formatLastSaved = (dateString) => {
    return formatRelativeNoteTime(dateString, { locale: zhCN, unknownText: '' })
  }

  // 处理键盘事件
  const handleKeyDown = (e) => {
    // 只在Markdown模式下处理特殊键盘事件
    if (editorMode === 'markdown') {
      // 处理退格键和删除键 - 整块删除图片
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const textarea = e.target
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        
        // 只有在没有选中文本时才处理整块删除
        if (start === end) {
          // 匹配图片语法: ![alt](url)
          const imageRegex = /!\[[^\]]*\]\([^)]+\)/g
          let match
          
          while ((match = imageRegex.exec(content)) !== null) {
            const matchStart = match.index
            const matchEnd = match.index + match[0].length
            
            // 检查光标是否在图片块内部或紧邻图片块
            const cursorInImage = start > matchStart && start <= matchEnd
            const cursorBeforeImage = e.key === 'Delete' && start === matchStart
            const cursorAfterImage = e.key === 'Backspace' && start === matchEnd
            
            if (cursorInImage || cursorBeforeImage || cursorAfterImage) {
              e.preventDefault()
              
              // 删除整个图片块（包括前后可能的换行符）
              let deleteStart = matchStart
              let deleteEnd = matchEnd
              
              // 如果图片前面是换行符，也删除它
              if (deleteStart > 0 && content[deleteStart - 1] === '\n') {
                deleteStart--
              }
              // 如果图片后面是换行符，也删除它
              if (deleteEnd < content.length && content[deleteEnd] === '\n') {
                deleteEnd++
              }
              
              // 使用原生方式删除，保持撤销栈
              textarea.focus()
              textarea.setSelectionRange(deleteStart, deleteEnd)
              
              // 使用 execCommand 删除选中内容，支持 Ctrl+Z 撤销
              const deleted = document.execCommand('delete', false)
              
              if (!deleted) {
                // 如果 execCommand 不支持，回退到直接修改
                const newContent = content.substring(0, deleteStart) + content.substring(deleteEnd)
                setContent(newContent)
                setTimeout(() => {
                  textarea.selectionStart = textarea.selectionEnd = deleteStart
                }, 0)
              }
              
              setHasUnsavedChanges(true)
              prevStateRef.current.content = textarea.value
              debouncedSave()
              return
            }
          }
        }
      }

      // 处理Tab键缩进（支持撤销）
      if (e.key === 'Tab') {
        e.preventDefault()
        const textarea = e.target
        const start = textarea.selectionStart
        const end = textarea.selectionEnd

        // 使用可撤销的方式插入缩进
        textarea.focus()
        textarea.setSelectionRange(start, end)
        
        let success = false
        try {
          success = document.execCommand('insertText', false, '  ')
        } catch (err) {
          success = false
        }
        
        if (!success) {
          const newContent = content.substring(0, start) + '  ' + content.substring(end)
          setContent(newContent)
        }
        
        setHasUnsavedChanges(true)
        prevStateRef.current.content = textarea.value
        debouncedSave()

        // 设置光标位置
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2
        }, 0)
        return
      }

      // 处理Ctrl+B (粗体)
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault()
        handleMarkdownInsert('**', '**', '粗体文本')
        return
      }

      // 处理Ctrl+I (斜体)
      if (e.ctrlKey && e.key === 'i') {
        e.preventDefault()
        handleMarkdownInsert('*', '*', '斜体文本')
        return
      }
    }

    // 撤销/重做使用浏览器原生功能
    // 不需要阻止默认行为
  }  // 处理剪贴板粘贴（统一处理表格 / HTML 富文本 / TSV / 图片 / 纯文本）
  const handlePaste = async (e) => {
    const clipboard = e.clipboardData
    if (!clipboard) return

    const items = clipboard.items ? Array.from(clipboard.items) : []
    const imageItems = items.filter(item => item.type?.startsWith('image/'))

    const html = clipboard.getData('text/html') || ''
    const plain = clipboard.getData('text/plain') || ''

    // 仅当浏览器能处理纯文本本身、且没有图片/HTML 表格/复杂结构时，才完全交给浏览器默认逻辑。
    if (!imageItems.length && !html && !plain) return

    // 选取最合适的 Markdown 文本。失败时退化为 plain。
    let textForInsert = ''
    let kind = 'plain'
    try {
      const picked = pickClipboardMarkdown({ html, plain })
      textForInsert = picked.text || ''
      kind = picked.kind
    } catch (err) {
      logger.warn?.('剪贴板转换失败，回退纯文本:', err)
      textForInsert = plain
      kind = 'plain'
    }

    // 如果只有纯文本、且已是 plain 文本，让浏览器默认处理，保留原生光标 / IME / Undo 行为。
    if (!imageItems.length && kind === 'plain') return

    e.preventDefault()

    try {
      const imageMarkdowns = []
      if (imageItems.length > 0) {
        const timestamp = Date.now()
        for (let i = 0; i < imageItems.length; i++) {
          const blob = imageItems[i].getAsFile()
          if (!blob) continue
          const arrayBuffer = await blob.arrayBuffer()
          const buffer = new Uint8Array(arrayBuffer)
          const fileName = `clipboard_${timestamp}_${i + 1}.png`
          const imagePath = await imageAPI.saveFromBuffer(buffer, fileName)
          imageMarkdowns.push(`![${fileName}](${imagePath})`)
        }
      }

      const trimmedText = String(textForInsert || '').replace(/\s+$/g, '')
      const imagesBlock = imageMarkdowns.join('\n')
      const insertText = [trimmedText, imagesBlock]
        .filter(Boolean)
        .join(trimmedText && imagesBlock ? '\n\n' : '')

      if (!insertText) return

      const textarea = contentRef.current?.querySelector('textarea')
      if (!textarea) return

      const { start, success, nextValue } = insertIntoTextarea(textarea, insertText, {
        getValue: () => content,
        onFallback: (next) => setContent(next),
      })

      setHasUnsavedChanges(true)
      prevStateRef.current.content = success ? textarea.value : nextValue
      debouncedSave()

      placeCursorAfterInsert(textarea, start, insertText.length)
    } catch (error) {
      console.error('粘贴失败:', error)
      showError(error, '粘贴失败')
    }
  }

  // 处理拖拽悬停
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // 处理拖拽放置（支持文本和图片）
  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()

    const textarea = contentRef.current?.querySelector('textarea')
    if (!textarea) return

    // 使用 caretPositionFromPoint 或 caretRangeFromPoint 获取插入位置
    let position = 0
    if (document.caretPositionFromPoint) {
      const caretPos = document.caretPositionFromPoint(e.clientX, e.clientY)
      if (caretPos) position = caretPos.offset
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY)
      if (range) position = range.startOffset
    } else {
      // 降级方案:使用当前光标位置
      position = textarea.selectionStart
    }

    // 优先处理文本/HTML（与粘贴保持一致：表格 / 富文本 / 纯文本）
    const html = e.dataTransfer.getData('text/html') || ''
    const plain = e.dataTransfer.getData('text/plain') || ''
    if (html || plain) {
      let textToInsert = plain
      try {
        const picked = pickClipboardMarkdown({ html, plain })
        textToInsert = picked.text || plain
      } catch (err) {
        logger.warn?.('拖拽文本转换失败，回退纯文本:', err)
      }
      if (!textToInsert) return

      // 把光标先放到落点位置，再用统一插入工具
      textarea.focus()
      textarea.setSelectionRange(position, position)

      const { start, success, nextValue } = insertIntoTextarea(textarea, textToInsert, {
        getValue: () => content,
        onFallback: (next) => setContent(next),
      })

      setHasUnsavedChanges(true)
      prevStateRef.current.content = success ? textarea.value : nextValue
      debouncedSave()

      placeCursorAfterInsert(textarea, start, textToInsert.length)
      return
    }

    // 处理图片文件 - 插入到光标位置
    const files = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    try {
      let insertText = ''
      for (const file of imageFiles) {
        const arrayBuffer = await file.arrayBuffer()
        const buffer = new Uint8Array(arrayBuffer)
        const imagePath = await imageAPI.saveFromBuffer(buffer, file.name)
        insertText += `![${file.name}](${imagePath})\n`
      }

      // 把光标先放到落点位置，再走统一插入工具，保留撤销栈
      textarea.focus()
      textarea.setSelectionRange(position, position)

      const { start, success, nextValue } = insertIntoTextarea(textarea, insertText, {
        getValue: () => content,
        onFallback: (next) => setContent(next),
      })

      setHasUnsavedChanges(true)
      prevStateRef.current.content = success ? textarea.value : nextValue
      debouncedSave()

      placeCursorAfterInsert(textarea, start, insertText.length)
    } catch (error) {
      console.error('拖拽失败:', error)
      showError(error, '拖拽失败')
    }
  }

  useEffect(() => {
    const syncFullscreenState = () => {
      const fsEl = document.fullscreenElement
      const nextIsFullscreen = Boolean(fsEl) && fsEl === editorContainerRef.current
      setIsFullscreen(nextIsFullscreen)
      if (!nextIsFullscreen) {
        setFullscreenToolbarExpanded(false)
      }
    }

    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  const toolbarsHidden = isFullscreen
    ? !fullscreenToolbarExpanded
    : isMinibarMode
      ? !minibarToolbarExpanded
      : userToolbarCollapsed

  // 快捷键：Cmd/Ctrl + . 按当前窗口形态切换工具栏
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isToggleCombo = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '.'
      if (!isToggleCombo) return
      e.preventDefault()
      if (isFullscreen) {
        setFullscreenToolbarExpanded(prev => !prev)
      } else if (isMinibarMode) {
        setMinibarToolbarExpanded(prev => !prev)
      } else {
        setUserToolbarCollapsed(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, isMinibarMode])

  useEffect(() => {
    if (!isMinibarMode) {
      setMinibarToolbarExpanded(false)
    }
  }, [isMinibarMode])

  if (!selectedNoteId) {
    return (
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
          overflow: 'hidden'
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            {t('common.selectNoteToEdit')}
          </Typography>
          <Typography variant="body2">
            {t('common.selectOrCreateNote')}
          </Typography>
        </Box>
      </Box>
    )
  }

  // 根据遮罩透明度设置获取对应的透明度值
  const getMaskOpacityValue = (isDark) => {
    const opacityMap = {
      none: { dark: 0, light: 0 },
      light: { dark: 0.5, light: 0.45 },
      medium: { dark: 0.75, light: 0.75 },
      heavy: { dark: 0.92, light: 0.92 }
    }
    const values = opacityMap[maskOpacity] || opacityMap.medium
    return isDark ? values.dark : values.light
  }

  const relatedOpen = Boolean(relatedAnchorEl)
  const noteTags = parseTags(tags)
  const plainContent = String(content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/[#>*_`~|=-]/g, ' ')
  const latinWordCount = (plainContent.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) || []).length
  const cjkCharCount = (plainContent.match(/[\u4e00-\u9fa5]/g) || []).length
  const wordCount = latinWordCount + cjkCharCount
  const charCount = String(content || '').length
  const noteCreatedAt = currentNote?.created_at || currentNote?.createdAt
  const noteUpdatedAt = lastSaved || currentNote?.updated_at || currentNote?.updatedAt || noteCreatedAt
  const noteMetaItems = [
    { label: '类型', value: noteType === 'whiteboard' ? '白板' : editorMode === 'wysiwyg' ? '所见即所得' : 'Markdown' },
    { label: '字数', value: `${wordCount} 字` },
    { label: '字符', value: `${charCount} 个` },
    { label: '创建', value: formatLastSaved(noteCreatedAt) || '未知' },
    { label: '更新', value: formatLastSaved(noteUpdatedAt) || '未知' },
    { label: '状态', value: currentNote?.is_pinned ? '已置顶' : hasUnsavedChanges ? '有未保存更改' : '已保存' },
  ]
  return (
    <Box
      ref={editorContainerRef}
      data-flota-note-editor="true"
      sx={(theme) => {
        const opacity = getMaskOpacityValue(theme.palette.mode === 'dark')
        return { 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column', 
          overflow: 'hidden', 
          position: 'relative',
          backgroundColor: theme.palette.mode === 'dark'
            ? `rgba(15, 23, 42, ${opacity})`
            : `rgba(240, 244, 248, ${opacity})`,
          backdropFilter: opacity > 0 ? 'blur(8px)' : 'none',
          WebkitBackdropFilter: opacity > 0 ? 'blur(8px)' : 'none',
        }
      }}
    >
      {/* 工具栏隐藏时的浮动入口：全屏/minibar/手动折叠都先展开工具栏 */}
      {toolbarsHidden && (
        <Tooltip title={t('notes.expandToolbar')}>
          <IconButton
            onClick={() => {
              if (isFullscreen) {
                setFullscreenToolbarExpanded(true)
              } else if (isMinibarMode) {
                setMinibarToolbarExpanded(true)
              } else {
                setUserToolbarCollapsed(false)
              }
            }}
            size="small"
            sx={(theme) => ({
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              borderRadius: '8px',
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(15, 23, 42, 0.55)'
                : 'rgba(255, 255, 255, 0.7)',
              backdropFilter: 'blur(20px) saturate(160%)',
              WebkitBackdropFilter: 'blur(20px) saturate(160%)',
              opacity: 0.45,
              transition: 'opacity 160ms ease',
              '&:hover': {
                opacity: 1,
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(15, 23, 42, 0.85)'
                  : 'rgba(255, 255, 255, 0.95)',
              },
            })}
          >
            <ExpandToolbarIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}

      {/* 工具栏 - 调整高度 */}
      <Paper
        elevation={0}
        sx={{
          px: 1,
          py: 0.75,
          minHeight: '52px',
          borderBottom: 1,
          borderColor: 'divider',
          borderRadius: 0,
          display: toolbarsHidden ? 'none' : 'flex',
          alignItems: 'center',
          gap: 0.75,
          overflow: 'hidden',
          backgroundColor: (theme) => theme.palette.mode === 'dark'
            ? 'rgba(15, 23, 42, 0.58)'
            : 'rgba(255, 255, 255, 0.74)',
          backdropFilter: 'blur(30px) saturate(180%)',
          WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
          {isAutoSaving ? (
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.5,
              px: 1, py: 0.35, borderRadius: '999px',
              bgcolor: 'primary.main', color: 'primary.contrastText',
              maxWidth: '100%'
            }}>
              <AutoSaveIcon fontSize="small" sx={{ fontSize: 15, animation: 'pulse 1.5s infinite' }} />
              <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                {t('common.autoSaving')}
              </Typography>
            </Box>
          ) : showSaveError ? (
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.5,
              px: 1, py: 0.35, borderRadius: '999px',
              bgcolor: 'error.main', color: 'error.contrastText',
              maxWidth: '100%'
            }}>
              <ErrorIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                保存失败
              </Typography>
            </Box>
          ) : hasUnsavedChanges ? (
            <Box sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1,
              py: 0.35,
              borderRadius: '999px',
              bgcolor: (theme) => theme.palette.mode === 'dark'
                ? 'rgba(96, 165, 250, 0.14)'
                : 'rgba(59, 130, 246, 0.10)',
              color: 'text.secondary',
              maxWidth: '100%',
              '@keyframes gentleBounce': {
                '0%, 80%, 100%': {
                  transform: 'translateY(0)',
                  opacity: 0.45
                },
                '40%': {
                  transform: 'translateY(-2px)',
                  opacity: 1
                }
              }
            }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px', pl: 0.125 }}>
                {[0, 1, 2].map((index) => (
                  <Box
                    key={index}
                    sx={{
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      opacity: 0.45,
                      animation: 'gentleBounce 1.2s ease-in-out infinite',
                      animationDelay: `${index * 0.14}s`,
                    }}
                  />
                ))}
              </Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 500,
                  color: 'text.secondary',
                  whiteSpace: 'nowrap'
                }}
              >
                {t('common.editing')}
              </Typography>
            </Box>
          ) : lastSaved ? (
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.5,
              px: 1, py: 0.35, borderRadius: '999px',
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.12)',
              maxWidth: '100%'
            }}>
              <CheckCircleIcon sx={{ fontSize: 15, color: 'success.main' }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t('common.lastSaved', { time: formatLastSaved(lastSaved) })}
              </Typography>
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
              {t('common.newNote')}
            </Typography>
          )}
        </Box>

        {/* 笔记类型切换 - 移到工具栏 */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: '3px',
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
          borderRadius: '12px', p: '3px',
        }}>
          {[{ value: 'markdown', icon: <ArticleIcon sx={{ fontSize: 15, mr: 0.5 }} />, label: 'Markdown' },
            { value: 'whiteboard', icon: <WhiteboardIcon sx={{ fontSize: 15, mr: 0.5 }} />, label: '白板' }].map((item) => {
            const isActive = noteType === item.value;
            return (
              <Button
                key={item.value}
                disableElevation
                disableRipple
                variant={isActive ? 'contained' : 'text'}
                onClick={() => isActive ? null : handleNoteTypeChange(item.value)}
                sx={{
                  px: 1.5, py: 0.4, minWidth: 0, fontSize: '0.78rem', fontWeight: 600,
                  borderRadius: '9px', textTransform: 'none', lineHeight: 1.5,
                  letterSpacing: '0.01em',
                  transition: 'all 0.25s cubic-bezier(.4,0,.2,1)',
                  ...(isActive ? {
                    bgcolor: (theme) => theme.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.13)'
                      : 'primary.main',
                    color: (theme) => theme.palette.mode === 'dark'
                      ? '#fff'
                      : 'primary.contrastText',
                    boxShadow: (theme) => theme.palette.mode === 'dark'
                      ? '0 1px 4px rgba(0,0,0,0.3)'
                      : `0 2px 8px ${theme.palette.primary.main}33`,
                    '&:hover': {
                      bgcolor: (theme) => theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.18)'
                        : 'primary.dark',
                    },
                  } : {
                    color: 'text.secondary',
                    bgcolor: 'transparent',
                    '&:hover': {
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                      color: 'text.primary',
                    },
                  }),
                }}
              >
                {item.icon}{item.label}
              </Button>
            );
          })}
        </Box>

        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          p: 0.25, borderRadius: '10px',
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(15, 23, 42, 0.06)'
        }}>
          {!isStandaloneMode && (
            <Tooltip title={t('notes.openInNewWindow')}>
              <IconButton
                onClick={handleOpenStandalone}
                size="small"
                sx={{ borderRadius: '8px' }}
              >
                <WindowIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title={isFullscreen ? t('notes.exitFullscreen') : t('notes.fullscreen')}>
            <IconButton
              onClick={handleToggleFullscreen}
              size="small"
              sx={{
                borderRadius: '8px',
                color: isFullscreen ? 'primary.main' : 'text.secondary',
                bgcolor: isFullscreen
                  ? (theme) => theme.palette.mode === 'dark' ? 'rgba(96,165,250,0.16)' : 'rgba(25,118,210,0.1)'
                  : 'transparent',
              }}
            >
              {isFullscreen ? (
                <FullscreenExitIcon sx={{ fontSize: 18 }} />
              ) : (
                <FullscreenIcon sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </Tooltip>

          <Tooltip title={currentNote?.is_pinned ? t('notes.unpinNote') : t('notes.pinNote')}>
            <IconButton
              onClick={handleTogglePin}
              size="small"
              sx={{ borderRadius: '8px' }}
            >
              {currentNote?.is_pinned ? (
                <PinIcon color="primary" sx={{ fontSize: 18 }} />
              ) : (
                <PinOutlinedIcon sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </Tooltip>

          <Tooltip title={relatedOpen ? '隐藏笔记详情' : '显示笔记详情'}>
            <IconButton
              onClick={handleToggleRelatedContext}
              size="small"
              sx={{
                borderRadius: '8px',
                color: relatedOpen ? 'primary.main' : 'text.secondary',
                bgcolor: relatedOpen
                  ? (theme) => theme.palette.mode === 'dark' ? 'rgba(96,165,250,0.16)' : 'rgba(25,118,210,0.1)'
                  : 'transparent',
              }}
            >
              <RelatedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title={resolvedAICommandCenterOpen ? '关闭 AI 小窗' : '打开 AI 小窗'}>
            <IconButton
              onClick={() => {
                if (isStandaloneMode) {
                  setStandaloneAICommandCenterOpen(prev => !prev)
                  return
                }
                if (!aiCommandCenterEnabled) setAiCommandCenterEnabled(true)
                setAiCommandCenterOpen(!aiCommandCenterOpen)
              }}
              size="small"
              sx={{
                borderRadius: '8px',
                color: resolvedAICommandCenterOpen ? 'primary.main' : 'text.secondary',
                bgcolor: resolvedAICommandCenterOpen
                  ? (theme) => theme.palette.mode === 'dark' ? 'rgba(96,165,250,0.14)' : 'rgba(25,118,210,0.09)'
                  : 'transparent',
              }}
            >
              <AIIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          {/* 白板模式：导出PNG */}
          {noteType === 'whiteboard' && (
            <Tooltip title={t('common.exportPngTooltip')}>
              <IconButton
                onClick={() => whiteboardExportFunc?.()}
                size="small"
                sx={{ borderRadius: '8px' }}
              >
                <GetAppIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title={t('notes.collapseToolbar')}>
            <IconButton
              onClick={() => {
                if (isFullscreen) {
                  setFullscreenToolbarExpanded(false)
                } else if (isMinibarMode) {
                  setMinibarToolbarExpanded(false)
                } else {
                  setUserToolbarCollapsed(true)
                }
              }}
              size="small"
              sx={{ borderRadius: '8px' }}
            >
              <CollapseToolbarIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>

      {/* 标签和标题栏 - 调整高度 */}
      <Box
        sx={{
          p: 1,
          height: '48px',
          borderBottom: 1,
          borderColor: 'divider',
          display: toolbarsHidden ? 'none' : 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'nowrap',
          overflow: 'hidden',
          backgroundColor: (theme) => theme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.6)'
            : 'rgba(255, 255, 255, 0.6)',
          backdropFilter: 'blur(30px) saturate(180%)',
          WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        }}
      >
        {/* 标题输入 - 紧凑样式 */}
        <TextField
          ref={titleRef}
          fullWidth
          variant="standard"
          placeholder={t('common.noteTitlePlaceholder')}
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleKeyDown}
          aria-label={t('common.noteTitlePlaceholder')}
          sx={{
            flex: 1,  // 减小标题宽度占比
            '& .MuiInput-input': {
              fontSize: '1.1rem',  // 减小字体大小
              fontWeight: 500,
              padding: '2px 0',    // 减小内边距
              maxWidth: '100%'     // 确保不超过容器宽度
            }
          }}
          slotProps={{
            input: {
              disableUnderline: true
            }
          }}
        />

        {/* 标签 */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
          <Box sx={{ flex: 1 }}>
            <TagInput
              value={tags}
              onChange={(newTags) => {
                setTags(newTags);
                setHasUnsavedChanges(true);
                prevStateRef.current.tags = newTags;
                debouncedSave();
              }}
              placeholder={t('common.tagsPlaceholder')}
              maxTags={5}
              showSuggestions={true}
              inline={true}
              noteContent={content}
              noteId={selectedNoteId}
              size="small"
              sx={{
                width: '100%',
                '& .MuiInputBase-root': {
                  height: '100%',
                  fontSize: '0.85rem'
                },
                '& .MuiInputBase-input': {
                  fontSize: '0.85rem'
                }
              }}
            />
          </Box>
        </Box>
      </Box>

      {/* 编辑区域 */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {/* 独立窗口打开提示 */}
        {isOpenInStandaloneWindow && !isStandaloneMode && (
          <Alert severity="info" sx={{ m: 2, mb: 0 }}>
            {t('common.noteOpenInStandalone')}
          </Alert>
        )}
        {/* Markdown 编辑器 */}
        {noteType === 'markdown' && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <Box
              sx={{
                display: toolbarsHidden ? 'none' : 'block',
              }}
            >
              <MarkdownToolbar
                onInsert={handleMarkdownInsert}
                onBlockFormat={handleBlockFormat}
                disabled={!selectedNoteId || (editorMode === 'markdown' && viewMode === 'preview')}
                viewMode={editorMode === 'wysiwyg' ? null : viewMode}
                onViewModeChange={editorMode === 'wysiwyg' ? null : setViewMode}
                editor={wysiwygEditor}
                editorMode={editorMode}
                blockSelectActive={blockSelectActive}
                onToggleBlockSelect={() => wysiwygEditorRef.current?.toggleBlockSelect?.()}
              />
            </Box>
            {/* WYSIWYG 模式: 单一编辑器，无分屏/预览 */}
            {editorMode === 'wysiwyg' ? (
              <Box
                sx={{
                  flex: 1,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
                onDragOver={handleDragOver}
                onDrop={async (e) => {
                  // 外层 onDrop 作为备用：TipTap 内部已处理大多数情况，
                  // 当图片文件拖入时与源码模式保持相同逻辑
                  const files = Array.from(e.dataTransfer?.files || [])
                  const imageFiles = files.filter(f => f.type.startsWith('image/'))
                  if (imageFiles.length === 0) return
                  // 如果 TipTap 内部已 preventDefault，外层不再重复将去
                  if (e.defaultPrevented) return
                  e.preventDefault()
                  e.stopPropagation()
                  // 计算鼠标落点对应的文档位置
                  let dropPos
                  try {
                    const view = wysiwygEditor?.view
                    const coords = view?.posAtCoords({ left: e.clientX, top: e.clientY })
                    if (coords) dropPos = coords.pos
                  } catch {
                    /* 边界异常，回退到当前光标 */
                  }
                  wysiwygEditorRef.current?.insertImageFiles(imageFiles, dropPos)
                }}
              >
                <WYSIWYGEditor
                  ref={wysiwygEditorRef}
                  noteId={selectedNoteId}
                  content={content}
                  onEditorReady={setWysiwygEditor}
                  onBlockSelectModeChange={setBlockSelectActive}
                  onChange={(newContent) => {
                    setContent(newContent)
                    setHasUnsavedChanges(true)
                    prevStateRef.current.content = newContent
                    debouncedSave()
                  }}
                  placeholder={t('common.startWriting')}
                />
              </Box>
            ) : (
            /* Markdown 源码模式: 支持编辑/预览/分屏 */
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: viewMode === 'split' ? 'row' : 'column',
                overflow: 'hidden',
                minHeight: 0
              }}
            >
              {/* 编辑面板 */}
              {(viewMode === 'edit' || viewMode === 'split') && (
                <Box
                  sx={{
                    flex: viewMode === 'split' ? 1 : 'auto',
                    p: 0,
                    borderRight: viewMode === 'split' ? 1 : 0,
                    borderColor: 'divider',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onPaste={handlePaste}
                >
                  <TextField
                    ref={contentRef}
                    fullWidth
                    multiline
                    variant="standard"
                    placeholder={t('common.startWritingMarkdown')}
                    value={content}
                    onChange={handleContentChange}
                    onKeyDown={handleKeyDown}
                    aria-label={t('common.startWritingMarkdown')}
                    slotProps={{
                      input: {
                        disableUnderline: true
                      }
                    }}
                    sx={{
                      flex: 1,
                      '& .MuiInput-root': {
                        height: '100%',
                        padding: 0
                      },
                      '& .MuiInput-input': {
                        fontSize: '1rem',
                        lineHeight: 1.6,
                        fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
                        height: '100% !important',
                        overflow: 'auto !important',
                        padding: '16px',
                        boxSizing: 'border-box',
                      },
                      // 防止超长无断词文本撑破布局；textarea 本身允许换行，但无空格长串会导致横向溢出
                      '& .MuiInputBase-inputMultiline': {
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        maxWidth: '100%',
                      },
                    }}
                  />
                </Box>
              )}

              {/* 预览面板 */}
              {(viewMode === 'preview' || viewMode === 'split') && (
                <Box sx={{
                  flex: viewMode === 'split' ? 1 : 'auto',
                  height: viewMode === 'preview' ? '100%' : 'auto',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}>
                  <MarkdownPreview
                    content={content}
                    onWikiLinkClick={handleWikiLinkClick}
                    onTagClick={handleTagClick}
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      maxWidth: '100%',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />
                </Box>
              )}
            </Box>
            )}

            {/* 源码模式浮动面板 */}
            {editorMode === 'markdown' && (viewMode === 'edit' || viewMode === 'split') && (
              <AIAssistPanel textareaRef={contentRef} onInsert={handleMarkdownInsert} />
            )}
          </Box>
        )}

        {/* 白板编辑器 */}
        {persistedNoteType === 'whiteboard' && selectedNoteId && (
          <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <WhiteboardEditor
              noteId={selectedNoteId}
              isStandaloneMode={isStandaloneMode}
              onGetContent={(func) => setWhiteboardGetContentFunc(() => func)}
              onExportPNG={(func) => setWhiteboardExportFunc(() => func)}
            />
          </Box>
        )}
      </Box>

      <Popover
        open={relatedOpen}
        anchorEl={relatedAnchorEl}
        onClose={handleCloseRelatedContext}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: (theme) => ({
              mt: 0.75,
              width: 336,
              maxWidth: 'calc(100vw - 32px)',
              borderRadius: '14px',
              overflow: 'hidden',
              border: '1px solid',
              borderColor: theme.palette.mode === 'dark'
                ? 'rgba(148, 163, 184, 0.18)'
                : 'rgba(148, 163, 184, 0.24)',
              bgcolor: theme.palette.mode === 'dark'
                ? 'rgba(15, 23, 42, 0.78)'
                : 'rgba(255, 255, 255, 0.78)',
              backdropFilter: 'blur(18px) saturate(160%)',
              WebkitBackdropFilter: 'blur(18px) saturate(160%)',
              boxShadow: '0 18px 56px rgba(15, 23, 42, 0.22), 0 4px 16px rgba(15, 23, 42, 0.10)',
              backgroundClip: 'padding-box',
            })
          }
        }}
      >
        <Box sx={{ p: 0.55 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.25, pt: 0.7, pb: 0.35 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'text.disabled' }}>
                笔记详情
              </Typography>
              <Typography noWrap sx={{ fontSize: 13, fontWeight: 650, mt: 0.25 }}>
                {currentNote?.title || '未命名'}
              </Typography>
            </Box>
            <Tooltip title="关闭详情">
              <IconButton size="small" onClick={handleCloseRelatedContext} sx={{ borderRadius: '8px', p: 0.55 }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              columnGap: 1,
              rowGap: 0,
              px: 0.65,
              py: 0.25,
            }}
          >
            {noteMetaItems.map((item, index) => (
              <Box
                key={item.label}
                sx={{
                  minWidth: 0,
                  px: 0.45,
                  py: 0.55,
                  borderTop: index > 1 ? '1px solid' : 0,
                  borderColor: 'divider',
                }}
              >
                <Typography color="text.disabled" sx={{ fontSize: 10.5, fontWeight: 700, mb: 0.1 }}>
                  {item.label}
                </Typography>
                <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 650 }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Box>

          {noteTags.length > 0 && (
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.7, px: 0.15 }}>
              {noteTags.slice(0, 8).map((tag) => (
                <Chip
                  key={tag}
                  label={`#${tag}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 21, borderRadius: '7px', fontSize: 11.5, fontWeight: 650 }}
                />
              ))}
            </Stack>
          )}
        </Box>

        <Divider sx={{ opacity: 0.7 }} />

        <RelatedContextPanel
          embedded
          forceExpanded
          notes={notes}
          selectedNoteId={selectedNoteId}
          onSelectNote={(noteId) => {
            store.setSelectedNoteId(noteId)
            handleCloseRelatedContext()
          }}
          onOpenTodo={() => {
            store.setCurrentView?.('todo')
            handleCloseRelatedContext()
          }}
        />
      </Popover>

      {/* 保存成功提示 */}
      <Snackbar
        open={showSaveSuccess}
        autoHideDuration={2000}
        onClose={() => setShowSaveSuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" onClose={() => setShowSaveSuccess(false)}>
          {t('common.noteSaved')}
        </Alert>
      </Snackbar>

      {/* 保存失败提示 */}
      <Snackbar
        open={showSaveError}
        autoHideDuration={5000}
        onClose={() => setShowSaveError(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="error" onClose={() => setShowSaveError(false)}>
          {saveErrorMessage || '保存失败，请重试'}
        </Alert>
      </Snackbar>

      {/* Wiki 链接错误提示 */}
      <Snackbar
        open={!!wikiLinkError}
        autoHideDuration={3000}
        onClose={() => setWikiLinkError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setWikiLinkError('')}>
          {wikiLinkError}
        </Alert>
      </Snackbar>

      {/* 笔记类型转换确认对话框 */}
      <NoteTypeConversionDialog
        open={conversionDialogOpen}
        onClose={handleConversionConfirm}
        conversionType={
          noteType === 'markdown' && pendingNoteType === 'whiteboard'
            ? 'markdown-to-whiteboard'
            : 'whiteboard-to-markdown'
        }
        noteTitle={title}
        loading={aiConvertLoading}
        loadingText={aiConvertStep}
      />

      {isStandaloneMode && (
        <AICommandCenter
          open={standaloneAICommandCenterOpen}
          onClose={() => setStandaloneAICommandCenterOpen(false)}
          portalContainer={editorContainerRef.current}
          notesOverride={notes}
          selectedNoteIdOverride={selectedNoteId}
          updateNoteOverride={updateNote}
          loadNotesOverride={standaloneContext?.loadNote ? () => standaloneContext.loadNote(selectedNoteId) : undefined}
          userAvatarOverride={userAvatar}
          positionPersistKey="flota.aiCommandCenter.standalone.position"
        />
      )}

    </Box>
  )
}

export default NoteEditor
