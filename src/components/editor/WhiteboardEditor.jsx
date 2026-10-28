import { preserveWhiteboardFileMap } from '../../utils/whiteboardFileMap'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Box,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Tooltip,
  IconButton,
} from '@mui/material'
import { Excalidraw, exportToSvg, convertToExcalidrawElements, THEME } from '@excalidraw/excalidraw'
import NoteReferencePicker from './NoteReferencePicker'
import { noteReferenceText } from '../../utils/noteReference'
import { useStore } from '../../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { useStandaloneContext } from '../common/StandaloneProvider'
import { useDebouncedSave } from '../../hooks/useDebouncedSave'
import {
  WHITEBOARD_AI_GENERATE_EVENT,
  buildWhiteboardContent,
  saveWhiteboardFiles,
  generateWhiteboardElementsByAction,
  parseWhiteboardContent,
  summarizeWhiteboardElementsForAI,
} from '../../utils/whiteboardAI'
import { canvasToPngBlob } from '../common/ImagePreviewModal'
import '@excalidraw/excalidraw/index.css'
import logger from '../../utils/logger'
import { renderMermaidNative } from '../../utils/diagrams/mermaidNative'
import { createSvgAsset, createSvgDataURL } from '../../utils/diagrams/svgAsset'
import { prepareSceneStyle } from '../../utils/diagrams/sceneStyle'
import { getWhiteboardPreviewKey } from '../../utils/whiteboardPreview'
import useWhiteboardProperties from '../../hooks/useWhiteboardProperties'
import useExcalidrawControlSlots from '../../hooks/useExcalidrawControlSlots'
import { Tune, CenterFocusStrong, VisibilityOff } from '../common/AppIcons'
import { openNoteLink } from '../../utils/linkUtils'
import { createWhiteboardSurfaceSx, createWhiteboardSurfaceTokens } from '../../utils/whiteboardSurfaceTheme'
import WhiteboardToolbar from './WhiteboardToolbar'

const createMermaidDialogSlotProps = ({ isDark, primaryColor }) => {
  const tokens = createWhiteboardSurfaceTokens({ isDark, primaryColor })
  return {
    paper: {
      sx: {
        color: tokens.text,
        backgroundColor: tokens.glassBackground,
        backgroundImage: tokens.glassBackgroundImage,
        backdropFilter: tokens.glassBlur,
        WebkitBackdropFilter: tokens.glassBlur,
        border: tokens.glassBorder,
        boxShadow: tokens.glassShadow,
        borderRadius: '16px',
      },
    },
    backdrop: {
      sx: {
        backgroundColor: isDark ? 'rgba(0,0,0,.36)' : 'rgba(22,22,24,.18)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      },
    },
  }
}

const SvgSourcePreview = ({ source, emptyText = '输入 SVG 源码后在这里预览' }) => {
  if (!String(source || '').trim()) {
    return <Typography variant="body2" color="text.secondary">{emptyText}</Typography>
  }
  try {
    return (
      <Box
        component="img"
        src={createSvgDataURL(source)}
        alt="SVG 预览"
        sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
      />
    )
  } catch (error) {
    return <Typography variant="body2" color="text.secondary">{error?.message || 'SVG 暂时无法预览'}</Typography>
  }
}

const SvgSourceDialog = ({
  open,
  title,
  description,
  source,
  error,
  busy,
  placeholder,
  submitLabel,
  busyLabel,
  slotProps,
  onChange,
  onClose,
  onSubmit,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    maxWidth="lg"
    fullWidth
    slotProps={slotProps}
    sx={{ zIndex: (theme) => theme.zIndex.modal + 10 }}
  >
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{description}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.25fr) minmax(280px, 0.75fr)' }, gap: 2 }}>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={18}
          value={source}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={busy}
        />
        <Box sx={{ minHeight: 360, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.default', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          <SvgSourcePreview source={source} />
        </Box>
      </Box>
      {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={busy} color="inherit">取消</Button>
      <Button onClick={onSubmit} disabled={busy} variant="contained">
        {busy ? busyLabel : submitLabel}
      </Button>
    </DialogActions>
  </Dialog>
)

const getSelectedEditableImage = (elements = [], appState = {}) => {
  const selectedIds = Object.keys(appState?.selectedElementIds || {})
  if (selectedIds.length !== 1) return null

  const selected = elements.find((element) => element?.id === selectedIds[0] && !element?.isDeleted)
  if (selected?.type !== 'image') return null

  const { kind, mermaidSource, svgSource } = selected.customData || {}
  return (kind === 'mermaid-image' && mermaidSource) || (kind === 'svg-image' && svgSource)
    ? selected
    : null
}

const getPersistedAppState = (appState = {}) => ({
  viewBackgroundColor: appState.viewBackgroundColor,
  currentItemFontFamily: appState.currentItemFontFamily,
  gridModeEnabled: Boolean(appState.gridModeEnabled),
  gridSize: appState.gridSize,
  scrollX: appState.scrollX,
  scrollY: appState.scrollY,
  zoom: appState.zoom,
})

const hasViewportChanged = (previous = {}, next = {}) => (
  previous.scrollX !== next.scrollX
  || previous.scrollY !== next.scrollY
  || previous.zoom?.value !== next.zoom?.value
)

const hasCanvasSettingsChanged = (previous = {}, next = {}) => (
  previous.viewBackgroundColor !== next.viewBackgroundColor
  || previous.currentItemFontFamily !== next.currentItemFontFamily
  || Boolean(previous.gridModeEnabled) !== Boolean(next.gridModeEnabled)
  || previous.gridSize !== next.gridSize
)

// Excalidraw 对未修改元素保持对象/版本稳定。这里仅比较轻量元数据，避免在
// pointermove/onChange 热路径中反复序列化整张画布（尤其是图片 dataURL）。
const haveElementsChanged = (previous = [], next = []) => {
  if (previous === next) return false
  if (previous.length !== next.length) return true
  for (let index = 0; index < next.length; index += 1) {
    const before = previous[index]
    const after = next[index]
    if (before === after) continue
    if (
      before?.id !== after?.id
      || before?.version !== after?.version
      || before?.versionNonce !== after?.versionNonce
      || Boolean(before?.isDeleted) !== Boolean(after?.isDeleted)
    ) return true
  }
  return false
}

const haveFilesChanged = (previous = {}, next = {}) => {
  if (previous === next) return false
  const previousKeys = Object.keys(previous || {})
  const nextKeys = Object.keys(next || {})
  if (previousKeys.length !== nextKeys.length) return true
  for (const key of nextKeys) {
    const before = previous?.[key]
    const after = next?.[key]
    if (!before || !after) return true
    if (
      before !== after
      && (before.id !== after.id
        || before.dataURL !== after.dataURL
        || before.mimeType !== after.mimeType
        || before.created !== after.created)
    ) return true
  }
  return false
}

/**
 * 画布编辑器组件
 * 直接使用 @excalidraw/excalidraw React 组件
 */
const WhiteboardEditor = ({ noteId, isStandaloneMode = false, onGetContent, onExportPNG, viewOnly = false }) => {
  const translateElementsTo = useCallback((elements = [], targetX = 0, targetY = 0) => {
    const validElements = elements.filter((element) => element && !element.isDeleted)
    if (!validElements.length) return elements

    const minX = Math.min(...validElements.map((element) => typeof element.x === 'number' ? element.x : 0))
    const minY = Math.min(...validElements.map((element) => typeof element.y === 'number' ? element.y : 0))
    const deltaX = targetX - minX
    const deltaY = targetY - minY

    return elements.map((element) => {
      if (!element) return element
      return {
        ...element,
        x: typeof element.x === 'number' ? element.x + deltaX : element.x,
        y: typeof element.y === 'number' ? element.y + deltaY : element.y,
      }
    })
  }, [])

  const centerElementsInViewport = useCallback((elements = [], appState = {}) => {
    const active = elements.filter((element) => element && !element.isDeleted)
    if (!active.length) return elements

    const minX = Math.min(...active.map((element) => element.x || 0))
    const minY = Math.min(...active.map((element) => element.y || 0))
    const maxX = Math.max(...active.map((element) => (element.x || 0) + (element.width || 0)))
    const maxY = Math.max(...active.map((element) => (element.y || 0) + (element.height || 0)))
    const zoom = appState?.zoom?.value || 1
    const centerX = -(appState?.scrollX || 0) + (appState?.width || 0) / zoom / 2
    const centerY = -(appState?.scrollY || 0) + (appState?.height || 0) / zoom / 2

    return translateElementsTo(
      elements,
      centerX - (maxX - minX) / 2,
      centerY - (maxY - minY) / 2,
    )
  }, [translateElementsTo])

  // Get context from either main store or standalone context
  let store
  let actualIsStandaloneMode = isStandaloneMode
  try {
    store = useStandaloneContext()
    actualIsStandaloneMode = true
  } catch (error) {
    // Not in standalone mode, use main store
    store = useStore(useShallow(state => ({
      notes: viewOnly ? null : state.notes,
      currentNote: state.notes.find(note => String(note.id) === String(noteId)) || null,
      updateNote: state.updateNote,
      currentView: state.currentView,
      theme: state.theme,
      primaryColor: state.primaryColor,
      whiteboardStyle: state.whiteboardStyle,
      language: state.language,
    })))
    actualIsStandaloneMode = false
  }
  
  const { notes: storeNotes, currentNote: storeCurrentNote, updateNote: storeUpdateNote, currentView, theme: themePref, primaryColor, whiteboardStyle, language = 'zh-CN' } = store
  const notes = useMemo(() => storeNotes || (storeCurrentNote ? [storeCurrentNote] : []), [storeNotes, storeCurrentNote])
  // 画布自己写进数据库的内容（按笔记 id）。数据库里的内容变成了别的版本（云同步下载、独立窗口、AI）时据此识别
  const knownContentRef = useRef(new Map())
  const awaitingInitialChangeRef = useRef(true)
  const updateNote = useCallback((id, updates) => {
    if (typeof updates?.content === 'string') knownContentRef.current.set(String(id), updates.content)
    return storeUpdateNote(id, updates)
  }, [storeUpdateNote])
  const notesByReference = useMemo(() => {
    const index = new Map()
    notes.forEach(note => {
      index.set(String(note.id), note)
      if (note.sync_id) index.set(String(note.sync_id), note)
    })
    return index
  }, [notes])
  const styleMode = whiteboardStyle === 'sketchy' ? 'sketchy' : 'neat'

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
  useEffect(() => {
    if (!excalidrawAPI) return
    excalidrawAPI.setActiveTool({ type: viewOnly ? 'hand' : 'selection' })
  }, [excalidrawAPI, viewOnly])
  const [notePickerOpen, setNotePickerOpen] = useState(false)
  const [whiteboardContainer, setWhiteboardContainer] = useState(null)
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(() => {
    try { return localStorage.getItem('flota.whiteboard.propertiesCollapsed') === 'true' } catch { return false }
  })
  useWhiteboardProperties(excalidrawAPI, whiteboardContainer, propertiesCollapsed || viewOnly)
  const controlSlots = useExcalidrawControlSlots(whiteboardContainer, language, !viewOnly)
  const toggleProperties = () => {
    const next = !propertiesCollapsed
    setPropertiesCollapsed(next)
    try { localStorage.setItem('flota.whiteboard.propertiesCollapsed', String(next)) } catch { /* preference only */ }
    excalidrawAPI?.updateScene({ appState: { openPopup: null, openMenu: next ? null : 'shape' } })
  }
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [initialData, setInitialData] = useState(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [excalidrawKey, setExcalidrawKey] = useState(() => `excalidraw-${noteId || 'unknown'}`)
  const [bridgeActive, setBridgeActive] = useState(false)
  const [toolbarState, setToolbarState] = useState({ activeTool: 'selection', locked: false })
  const [selectedEditableImage, setSelectedEditableImage] = useState(null)
  const selectedMermaidImage = selectedEditableImage?.customData?.kind === 'mermaid-image'
    ? selectedEditableImage
    : null
  const selectedSvgImage = selectedEditableImage?.customData?.kind === 'svg-image'
    ? selectedEditableImage
    : null
  const [dslEditorOpen, setDslEditorOpen] = useState(false)
  const [dslDraft, setDslDraft] = useState('')
  const [dslError, setDslError] = useState('')
  const [isRegeneratingDsl, setIsRegeneratingDsl] = useState(false)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [creatorDraft, setCreatorDraft] = useState('')
  const [creatorError, setCreatorError] = useState('')
  const [isCreatingDiagram, setIsCreatingDiagram] = useState(false)
  const [svgCreatorOpen, setSvgCreatorOpen] = useState(false)
  const [svgCreatorDraft, setSvgCreatorDraft] = useState('')
  const [svgCreatorError, setSvgCreatorError] = useState('')
  const [isCreatingSvg, setIsCreatingSvg] = useState(false)
  const [svgEditorOpen, setSvgEditorOpen] = useState(false)
  const [svgDraft, setSvgDraft] = useState('')
  const [svgError, setSvgError] = useState('')
  const [isRegeneratingSvg, setIsRegeneratingSvg] = useState(false)
  const hasUnsavedChangesRef = useRef(false)
  // 保存上一个noteId，用于检测noteId变化（初始为null，避免首次加载时触发保存）
  const prevNoteIdRef = useRef(null)
  // 当前正在编辑的画布noteId（防止异步保存写错对象）
  const activeNoteIdRef = useRef(noteId)
  // 标记是否正在切换笔记，用于避免组件卸载时的重复保存
  const isSwitchingNoteRef = useRef(false)
  // 标记当前是否正由系统应用远端数据，避免 onChange 误判
  const isApplyingRemoteDataRef = useRef(true)
  // 记录最近一次渲染的完整场景，用于在组件重挂载时仍能保存
  const latestSceneRef = useRef({ elements: [], appState: {}, files: {} })
  const viewportOnlyChangeRef = useRef(false)
  const contentChangePendingRef = useRef(false)
  const lastViewportSaveScheduleRef = useRef(0)
  const sceneRevisionRef = useRef(0)
  const aiGenerationInFlightRef = useRef(false)
  const editorMountedRef = useRef(true)
  useEffect(() => {
    editorMountedRef.current = true
    return () => { editorMountedRef.current = false }
  }, [])
  // 标记是否正在进行类型转换，用于避免卸载时自动保存覆盖转换结果
  const isTypeConvertingRef = useRef(false)

  const openMermaidDslEditor = useCallback((element = selectedMermaidImage) => {
    if (!element) return
    setSelectedEditableImage(element)
    setDslDraft(element.customData?.mermaidSource || '')
    setDslError('')
    setDslEditorOpen(true)
  }, [selectedMermaidImage])

  const closeMermaidDslEditor = useCallback(() => {
    if (isRegeneratingDsl) return
    setDslEditorOpen(false)
    setDslError('')
  }, [isRegeneratingDsl])

  const applyWhiteboardStyleToElements = useCallback(
    elements => prepareSceneStyle(elements, styleMode),
    [styleMode],
  )

  const commitWhiteboardScene = useCallback(async ({ elements, appState, files, validate, task }) => {
    validate?.()
    const persistedAppState = getPersistedAppState(appState)
    const fileMap = preserveWhiteboardFileMap(elements, await saveWhiteboardFiles(files), notes?.find(n => String(n.id) === String(noteId))?.content)

    validate?.()
    task?.beginCommit()
    const updateResult = await updateNote(noteId, {
      content: buildWhiteboardContent({ elements, appState: persistedAppState, fileMap }),
      note_type: 'whiteboard',
    })
    if (updateResult?.success === false) throw new Error(updateResult.error || '保存画布失败')

    if (!editorMountedRef.current || String(activeNoteIdRef.current) !== String(noteId)) return

    const nextScene = { elements, appState: persistedAppState, files }
    setInitialData(nextScene)
    setExcalidrawKey(`excalidraw-${noteId || 'unknown'}-${Date.now()}`)
    latestSceneRef.current = nextScene
    setHasUnsavedChanges(false)
    hasUnsavedChangesRef.current = false
    viewportOnlyChangeRef.current = false
    contentChangePendingRef.current = false
    sceneRevisionRef.current += 1
  }, [noteId, updateNote, notes])

  const regenerateMermaidImage = useCallback(async () => {
    if (!selectedMermaidImage || !dslDraft.trim()) {
      setDslError('请输入 Mermaid DSL')
      return
    }

    if (!excalidrawAPI) return

    setIsRegeneratingDsl(true)
    setDslError('')
    isApplyingRemoteDataRef.current = true

    try {
      const rendered = await renderMermaidNative(dslDraft.trim(), { offsetX: 0, offsetY: 0 })
      const styledElements = applyWhiteboardStyleToElements(rendered.elements)
      const translatedElements = translateElementsTo(
        styledElements,
        selectedMermaidImage.x,
        selectedMermaidImage.y,
      )

      const currentElements = excalidrawAPI.getSceneElements()
      const currentAppState = excalidrawAPI.getAppState()
      const currentFiles = excalidrawAPI.getFiles()
      const nextElements = [
        ...currentElements.filter((element) => element.id !== selectedMermaidImage.id),
        ...translatedElements,
      ]
      const nextFiles = { ...(currentFiles || {}) }

      if (selectedMermaidImage.fileId) {
        delete nextFiles[selectedMermaidImage.fileId]
      }
      Object.assign(nextFiles, rendered.files || {})
      await commitWhiteboardScene({
        elements: nextElements,
        appState: currentAppState,
        files: nextFiles,
      })
      setSelectedEditableImage(null)
      setDslEditorOpen(false)
    } catch (error) {
      logger.warn('[WhiteboardEditor] Mermaid DSL 重画失败:', error)
      setDslError(error?.message || 'Mermaid 解析失败，请检查 DSL 语法')
      isApplyingRemoteDataRef.current = false
    } finally {
      setIsRegeneratingDsl(false)
    }

    setTimeout(() => {
      isApplyingRemoteDataRef.current = false
    }, 200)
  }, [
    selectedMermaidImage,
    dslDraft,
    excalidrawAPI,
    translateElementsTo,
    applyWhiteboardStyleToElements,
    commitWhiteboardScene,
  ])

  const openMermaidCreator = useCallback(() => {
    setCreatorDraft('')
    setCreatorError('')
    setCreatorOpen(true)
  }, [])

  const closeMermaidCreator = useCallback(() => {
    if (isCreatingDiagram) return
    setCreatorOpen(false)
    setCreatorError('')
  }, [isCreatingDiagram])

  const createMermaidDiagram = useCallback(async () => {
    const dsl = creatorDraft.trim()
    if (!dsl) {
      setCreatorError('请输入 Mermaid DSL')
      return
    }
    if (!excalidrawAPI) return

    setIsCreatingDiagram(true)
    setCreatorError('')
    isApplyingRemoteDataRef.current = true

    try {
      const rendered = await renderMermaidNative(dsl, { offsetX: 0, offsetY: 0 })
      const styledRenderedElements = applyWhiteboardStyleToElements(rendered.elements)

      const currentElements = excalidrawAPI.getSceneElements()
      const currentAppState = excalidrawAPI.getAppState()
      const currentFiles = excalidrawAPI.getFiles()
      const translatedElements = centerElementsInViewport(styledRenderedElements, currentAppState)
      const nextElements = [...currentElements, ...translatedElements]
      const nextFiles = { ...(currentFiles || {}), ...(rendered.files || {}) }
      await commitWhiteboardScene({
        elements: nextElements,
        appState: currentAppState,
        files: nextFiles,
      })
      setCreatorOpen(false)
      setCreatorDraft('')
    } catch (error) {
      logger.warn('[WhiteboardEditor] Mermaid 成图失败:', error)
      setCreatorError(error?.message || 'Mermaid 解析失败，请检查 DSL 语法')
      isApplyingRemoteDataRef.current = false
    } finally {
      setIsCreatingDiagram(false)
    }

    setTimeout(() => {
      isApplyingRemoteDataRef.current = false
    }, 200)
  }, [
    creatorDraft,
    excalidrawAPI,
    applyWhiteboardStyleToElements,
    centerElementsInViewport,
    commitWhiteboardScene,
  ])

  const openSvgCreator = useCallback(() => {
    setSvgCreatorDraft('')
    setSvgCreatorError('')
    setSvgCreatorOpen(true)
  }, [])

  const insertNoteReference = useCallback(async (note) => {
    if (!excalidrawAPI) return
    const reference = String(note.sync_id || note.id)
    const elements = convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0, width: 320, height: 230,
      backgroundColor: '#f2f2f3', fillStyle: 'solid', strokeColor: primaryColor || '#1976d2', roughness: 0,
      link: `app://note/${encodeURIComponent(reference)}`, customData: { kind: 'note-reference', reference },
      label: { text: noteReferenceText(note), fontSize: 16, fontFamily: 2, textAlign: 'left', verticalAlign: 'top' } }])
    await commitWhiteboardScene({ elements: [...excalidrawAPI.getSceneElements(), ...centerElementsInViewport(elements, excalidrawAPI.getAppState())],
      appState: excalidrawAPI.getAppState(), files: excalidrawAPI.getFiles() })
  }, [excalidrawAPI, primaryColor, commitWhiteboardScene, centerElementsInViewport])

  useEffect(() => {
    if (!excalidrawAPI || viewOnly) return
    const elements = excalidrawAPI.getSceneElements()
    const updates = new Map()
    elements.forEach(card => {
      if (card.customData?.kind !== 'note-reference') return
      const reference = card.customData.reference
      const note = notesByReference.get(String(reference))
      const text = noteReferenceText(note)
      const label = elements.find(el => el.type === 'text' && el.containerId === card.id)
      if (label && label.originalText !== text) updates.set(label.id, { ...label, text, originalText: text, version: label.version + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() })
    })
    if (updates.size) excalidrawAPI.updateScene({ elements: elements.map(el => updates.get(el.id) || el) })
  }, [excalidrawAPI, notesByReference, viewOnly])

  useEffect(() => {
    if (!whiteboardContainer || !excalidrawAPI || viewOnly) return
    const openCard = event => {
      if (!(event.target instanceof HTMLCanvasElement)) return
      const state = excalidrawAPI.getAppState()
      const selected = excalidrawAPI.getSceneElements().filter(el => state.selectedElementIds?.[el.id])
      const card = selected.find(el => el.customData?.kind === 'note-reference')
      if (!card) return
      event.preventDefault(); event.stopPropagation()
      openNoteLink(card.link)
    }
    whiteboardContainer.addEventListener('dblclick', openCard, true)
    return () => whiteboardContainer.removeEventListener('dblclick', openCard, true)
  }, [whiteboardContainer, excalidrawAPI, viewOnly])

  const closeSvgCreator = useCallback(() => {
    if (isCreatingSvg) return
    setSvgCreatorOpen(false)
    setSvgCreatorError('')
  }, [isCreatingSvg])

  const createSvgDiagram = useCallback(async () => {
    if (!svgCreatorDraft.trim()) {
      setSvgCreatorError('请输入 SVG 源码')
      return
    }
    if (!excalidrawAPI) return

    setIsCreatingSvg(true)
    setSvgCreatorError('')
    isApplyingRemoteDataRef.current = true

    try {
      const rendered = createSvgAsset(svgCreatorDraft, { offsetX: 0, offsetY: 0, source: 'manual' })
      const currentElements = excalidrawAPI.getSceneElements()
      const currentAppState = excalidrawAPI.getAppState()
      const currentFiles = excalidrawAPI.getFiles()
      const centeredElements = centerElementsInViewport(rendered.elements, currentAppState)
      const nextElements = [...currentElements, ...centeredElements]
      const nextFiles = { ...(currentFiles || {}), ...(rendered.files || {}) }
      await commitWhiteboardScene({
        elements: nextElements,
        appState: currentAppState,
        files: nextFiles,
      })
      setSvgCreatorOpen(false)
      setSvgCreatorDraft('')
    } catch (error) {
      logger.warn('[WhiteboardEditor] SVG 成图失败:', error)
      setSvgCreatorError(error?.message || 'SVG 生成失败，请检查源码')
      isApplyingRemoteDataRef.current = false
    } finally {
      setIsCreatingSvg(false)
    }

    setTimeout(() => {
      isApplyingRemoteDataRef.current = false
    }, 200)
  }, [svgCreatorDraft, excalidrawAPI, centerElementsInViewport, commitWhiteboardScene])

  const openSvgEditor = useCallback((element = selectedSvgImage) => {
    if (!element) return
    setSelectedEditableImage(element)
    setSvgDraft(element.customData?.svgSource || '')
    setSvgError('')
    setSvgEditorOpen(true)
  }, [selectedSvgImage])

  const closeSvgEditor = useCallback(() => {
    if (isRegeneratingSvg) return
    setSvgEditorOpen(false)
    setSvgError('')
  }, [isRegeneratingSvg])

  const regenerateSvgImage = useCallback(async () => {
    if (!selectedSvgImage || !svgDraft.trim()) {
      setSvgError('请输入 SVG 源码')
      return
    }
    if (!excalidrawAPI) return

    setIsRegeneratingSvg(true)
    setSvgError('')
    isApplyingRemoteDataRef.current = true

    try {
      const rendered = createSvgAsset(svgDraft, {
        offsetX: selectedSvgImage.x,
        offsetY: selectedSvgImage.y,
        source: selectedSvgImage.customData?.generatedBy || 'manual',
        maxWidth: Math.max(24, selectedSvgImage.width),
        maxHeight: Math.max(24, selectedSvgImage.height),
      })
      const replacement = {
        ...selectedSvgImage,
        fileId: rendered.elements[0].fileId,
        width: selectedSvgImage.width,
        height: selectedSvgImage.height,
        version: (selectedSvgImage.version || 1) + 1,
        versionNonce: rendered.elements[0].versionNonce,
        updated: Date.now(),
        customData: rendered.elements[0].customData,
      }
      const currentElements = excalidrawAPI.getSceneElements()
      const currentAppState = excalidrawAPI.getAppState()
      const currentFiles = excalidrawAPI.getFiles()
      const nextElements = currentElements.map((element) => (
        element.id === selectedSvgImage.id ? replacement : element
      ))
      const nextFiles = { ...(currentFiles || {}) }
      if (selectedSvgImage.fileId) delete nextFiles[selectedSvgImage.fileId]
      Object.assign(nextFiles, rendered.files)
      await commitWhiteboardScene({
        elements: nextElements,
        appState: currentAppState,
        files: nextFiles,
      })
      setSelectedEditableImage(null)
      setSvgEditorOpen(false)
    } catch (error) {
      logger.warn('[WhiteboardEditor] SVG 原位重画失败:', error)
      setSvgError(error?.message || 'SVG 重画失败，请检查源码')
      isApplyingRemoteDataRef.current = false
    } finally {
      setIsRegeneratingSvg(false)
    }

    setTimeout(() => {
      isApplyingRemoteDataRef.current = false
    }, 200)
  }, [selectedSvgImage, svgDraft, excalidrawAPI, commitWhiteboardScene])
  
  // 监听类型转换事件
  useEffect(() => {
    if (viewOnly) return undefined
    const handleTypeConversion = (event) => {
      if (String(event.detail?.noteId) !== String(activeNoteIdRef.current)) return
      // 仅在提交类型变更时阻止卸载保存；失败后恢复，不提前宣称已经保存。
      isTypeConvertingRef.current = event.detail.active === true
    }
    
    window.addEventListener('whiteboard-type-converting', handleTypeConversion)
    return () => {
      window.removeEventListener('whiteboard-type-converting', handleTypeConversion)
    }
  }, [viewOnly])
  
  // 同步 hasUnsavedChanges 到 ref
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  // 当用户在设置中切换画布风格时，实时把 appState 的"当前绘图属性"推送到画布
  // 这样无需切换/刷新笔记，新画的元素就会立刻按新风格渲染
  useEffect(() => {
    if (!excalidrawAPI || viewOnly) return
    try {
      excalidrawAPI.updateScene({
        appState: {
          currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
          currentItemRoughness: styleMode === 'neat' ? 0 : 1,
          currentItemStrokeStyle: 'solid',
        },
      })
    } catch (e) {
      logger.warn('[WhiteboardEditor] 推送画布风格失败', e)
    }
  }, [styleMode, excalidrawAPI, viewOnly])

  useEffect(() => {
    if (!selectedEditableImage) return
    const currentElements = excalidrawAPI?.getSceneElements?.() || []
    const stillExists = currentElements.some((element) => element.id === selectedEditableImage.id && !element.isDeleted)
    if (!stillExists) {
      setSelectedEditableImage(null)
      setDslEditorOpen(false)
      setDslError('')
      setSvgEditorOpen(false)
      setSvgError('')
    }
  }, [selectedEditableImage, excalidrawAPI, excalidrawKey])

  // 只在开发环境输出调试日志
  if (process.env.NODE_ENV === 'development') {
    logger.log('[WhiteboardEditor] 组件渲染', { 
      noteId, 
      noteIdType: typeof noteId,
      hasExcalidrawAPI: !!excalidrawAPI
    })
  }

  // 定义空画布模板数据（跟随暗黑模式与画布风格设置）
  const blankBoardData = useMemo(() => ({
    elements: [],
    appState: {
      viewBackgroundColor: isDark ? '#1e1e1e' : '#ffffff',
      // 规整模式：默认使用 Helvetica（fontFamily=2）+ 直线（roughness=0）+ 实线（strokeStyle=solid）
      // 手绘模式：保留 Excalidraw 默认（Virgil + roughness=1 + solid）
      currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
      currentItemRoughness: styleMode === 'neat' ? 0 : 1,
      currentItemStrokeStyle: 'solid',
    },
    files: {}
  }), [isDark, styleMode])

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

      latestSceneRef.current = {
        elements: api?.getSceneElements?.() || elements,
        appState: getPersistedAppState(api?.getAppState?.() || appState),
        files: api?.getFiles?.() || files
      }
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false
      viewportOnlyChangeRef.current = false
      contentChangePendingRef.current = false
      sceneRevisionRef.current += 1
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

      // 如果笔记类型不是画布，使用空画布
      if (note.note_type !== 'whiteboard') {
        useBlankScene()
        return
      }

      // 笔记类型是画布，但内容为空
      if (!note.content) {
        useBlankScene()
        return
      }

      // 解析画布数据并更新
      const excalidrawData = JSON.parse(note.content)
      setError(null)
      const elements = applyWhiteboardStyleToElements(excalidrawData.elements || [])
      const appState = {
        ...(excalidrawData.appState || { viewBackgroundColor: '#ffffff' }),
        currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
        currentItemRoughness: styleMode === 'neat' ? 0 : 1,
        currentItemStrokeStyle: 'solid',
      }
      
      // 处理图片文件
      let files = {}
      if (excalidrawData.fileMap && Object.keys(excalidrawData.fileMap).length > 0) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 处理图片文件', {
            filesCount: Object.keys(excalidrawData.fileMap).length
          })
        }
        
        const result = await window.electronAPI.whiteboard.loadImages(excalidrawData.fileMap)
        if (result.success) files = result.data
        else console.error('[WhiteboardEditor] 加载图片失败', result.error)
      }
      
      applyScene(elements, appState, files)
    } catch (error) {
      console.error('[WhiteboardEditor] 更新Excalidraw内容失败', error)
      setError('画布数据格式错误，无法加载')
    } finally {
      isApplyingRemoteDataRef.current = false
    }
  }, [blankBoardData, setHasUnsavedChanges, setInitialData])

  // 加载画布数据（仅在首次挂载时执行，后续切换通过 useEffect 处理）
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

      // 解析画布数据
      try {
        // 如果笔记类型不是画布，使用空画布
        if (note.note_type !== 'whiteboard') {
          setInitialData(blankBoardData)
          latestSceneRef.current = blankBoardData
          setHasUnsavedChanges(false)
          hasUnsavedChangesRef.current = false
          activeNoteIdRef.current = null
          setIsLoading(false)
          isApplyingRemoteDataRef.current = false
          return
        }

        // 笔记类型是画布，但内容为空
        if (!note.content) {
          setInitialData(blankBoardData)
          latestSceneRef.current = blankBoardData
          setHasUnsavedChanges(false)
          hasUnsavedChangesRef.current = false
          activeNoteIdRef.current = noteId
          setIsLoading(false)
          isApplyingRemoteDataRef.current = false
          return
        }

        // 解析画布数据
        const excalidrawData = JSON.parse(note.content)
        setError(null)

        // 处理图片文件
        let files = {}
        if (excalidrawData.fileMap && Object.keys(excalidrawData.fileMap).length > 0) {
          if (process.env.NODE_ENV === 'development') {
            logger.log('[WhiteboardEditor] 初始加载 - 处理图片文件', {
              filesCount: Object.keys(excalidrawData.fileMap).length
            })
          }
          
          const result = await window.electronAPI.whiteboard.loadImages(excalidrawData.fileMap)
          if (result.success) files = result.data
          else console.error('[WhiteboardEditor] 加载图片失败', result.error)
        }

        const initialScene = {
          elements: applyWhiteboardStyleToElements(excalidrawData.elements || []),
          appState: {
            ...(excalidrawData.appState || { viewBackgroundColor: '#ffffff' }),
            currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
            currentItemRoughness: styleMode === 'neat' ? 0 : 1,
            currentItemStrokeStyle: 'solid',
          },
          files: files
        }

        setInitialData(initialScene)
        awaitingInitialChangeRef.current = true
        latestSceneRef.current = initialScene
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
        activeNoteIdRef.current = noteId
        
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
      } catch (error) {
        console.error('[WhiteboardEditor] 解析画布数据失败', error)
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
        activeNoteIdRef.current = noteId
        
        const note = notes.find(n => n.id === noteId)
        if (note?.note_type === 'whiteboard') {
          setError('画布数据格式错误，无法加载')
        } else {
          setError(null)
        }
        
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
      }
    }

    loadWhiteboardData()
    // 首次加载后设置 prevNoteIdRef
    prevNoteIdRef.current = noteId
  }, [noteId, notes, blankBoardData, setHasUnsavedChanges])

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
            const fileMap = preserveWhiteboardFileMap(elements, await saveWhiteboardFiles(files), notes?.find(n => String(n.id) === String(prevNoteId))?.content)

            const data = {
              type: 'excalidraw',
              version: 2,
              source: 'Flota-local',
              elements,
              appState: {
                viewBackgroundColor: appState.viewBackgroundColor,
                currentItemFontFamily: appState.currentItemFontFamily,
                gridModeEnabled: Boolean(appState.gridModeEnabled),
                gridSize: appState.gridSize
              },
              fileMap
            }

            const saved = await updateNote(prevNoteId, {
              content: JSON.stringify(data),
              note_type: 'whiteboard'
            })
            if (saved?.success === false) throw new Error(saved.error || '保存画布失败')
            
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
            if (note.note_type !== 'whiteboard') {
              activeNoteIdRef.current = null
              hasUnsavedChangesRef.current = false
              setHasUnsavedChanges(false)
              setIsLoading(false)
              setBridgeActive(false)
              return
            }
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

  // 打开着的画布在别处被更新（云同步下载了另一台设备的版本等）：没有未保存的修改就载入新版本。
  // 以前画布只在打开时读一次，接着再画一笔就把旧画布连同新笔画存回去，另一台设备的修改被覆盖
  const storeContent = storeCurrentNote?.content
  useEffect(() => {
    const note = storeCurrentNote
    if (viewOnly || !note || note.note_type !== 'whiteboard') return
    const key = String(note.id)
    const known = knownContentRef.current
    if (!known.has(key)) { known.set(key, note.content); return }
    if (known.get(key) === note.content) return
    if (!excalidrawAPI || contentChangePendingRef.current || isSwitchingNoteRef.current || String(activeNoteIdRef.current) !== key) return
    known.set(key, note.content)
    resetExcalidrawContent(excalidrawAPI, note)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeContent, excalidrawAPI])

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
    // 注意：elements 可能为空数组（用户清空画布），也必须允许保存。
    let elements, appState, files
    
    if (latestSceneRef.current && Array.isArray(latestSceneRef.current.elements)) {
      elements = latestSceneRef.current.elements
      appState = latestSceneRef.current.appState || { viewBackgroundColor: '#ffffff' }
      files = latestSceneRef.current.files || {}
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

    const savedRevision = sceneRevisionRef.current

    const currentNote = notes?.find(item => String(item.id) === String(currentNoteId))
    if (currentNote?.note_type !== 'whiteboard') {
      return
    }

    try {
      if (viewportOnlyChangeRef.current && !contentChangePendingRef.current) {
        const stored = JSON.parse(currentNote.content || '{}')
        const persistedAppState = getPersistedAppState(appState)
        const updateResult = await updateNote(currentNoteId, {
          content: JSON.stringify({ ...stored, appState: persistedAppState }),
          note_type: 'whiteboard'
        })
        if (updateResult?.success === false) throw new Error(updateResult.error || '保存画布失败')
        if (sceneRevisionRef.current === savedRevision) {
          viewportOnlyChangeRef.current = false
        }
        if (noteId === currentNoteId && sceneRevisionRef.current === savedRevision) {
          setHasUnsavedChanges(false)
          hasUnsavedChangesRef.current = false
        }
        return
      }

      // 将图片保存到文件系统
      const fileMap = preserveWhiteboardFileMap(elements, await saveWhiteboardFiles(files), currentNote?.content)

      const persistedAppState = getPersistedAppState(appState)

      const data = {
        type: 'excalidraw',
        version: 2,
        source: 'Flota-local',
        elements,
        appState: persistedAppState,
        fileMap // 保存文件映射而非实际图片数据
      }

      const updateResult = await updateNote(currentNoteId, {
        content: JSON.stringify(data),
        note_type: 'whiteboard'
      })
      if (updateResult?.success === false) throw new Error(updateResult.error || '保存画布失败')
      
      // 只有当当前组件的noteId与保存的noteId一致时，才更新状态
      if (noteId === currentNoteId && sceneRevisionRef.current === savedRevision) {
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
        viewportOnlyChangeRef.current = false
        contentChangePendingRef.current = false
      }

      // 异步导出 PNG 预览图供移动端查看（不阻塞保存流程）
      // 使用 SVG→Canvas 方式保证清晰度，scale: 2 兼顾质量与文件大小
      try {
        const note = notes?.find(n => n.id === currentNoteId)
        const previewKey = getWhiteboardPreviewKey(note || { id: currentNoteId })
        if (previewKey && window.electronAPI?.whiteboard?.savePreview) {
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
                img.onload = async () => {
                  try {
                    const SCALE = 2
                    const canvas = document.createElement('canvas')
                    canvas.width = img.naturalWidth * SCALE
                    canvas.height = img.naturalHeight * SCALE
                    const ctx = canvas.getContext('2d')
                    ctx.scale(SCALE, SCALE)
                    ctx.drawImage(img, 0, 0)
                    URL.revokeObjectURL(svgUrl)
                    const pngBlob = await canvasToPngBlob(canvas)
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result.split(',')[1])
                    reader.onerror = reject
                    reader.readAsDataURL(pngBlob)
                  } catch (error) {
                    URL.revokeObjectURL(svgUrl)
                    reject(error)
                  }
                }
                img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e) }
                img.src = svgUrl
              })
            })
            .then(base64 => window.electronAPI.whiteboard.savePreview(previewKey, base64))
            .catch(err => console.warn('[WhiteboardEditor] 预览图导出失败:', err))
        }
      } catch (_) { /* 预览导出失败不影响主保存 */ }
    } catch (error) {
      console.error('[WhiteboardEditor] 保存失败', error)
      setError('保存失败: ' + error.message)
      throw error
    }
  }, [excalidrawAPI, noteId, updateNote, notes])

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

  // 停笔 1.5 秒保存；连续绘制最多等待 5 秒；草稿独立暂存。
  const { debouncedSave, saveNow, cancelSave } = useDebouncedSave(performSaveWithLog, 1500, 5000, () => {
    if (viewOnly || !contentChangePendingRef.current) return null
    const scene = latestSceneRef.current
    return { noteId: activeNoteIdRef.current, updates: {
      note_type: 'whiteboard',
      content: { type: 'excalidraw', version: 2, elements: scene.elements,
        appState: scene.appState, fileMap: preserveWhiteboardFileMap(scene.elements, scene.files, notes?.find(n => String(n.id) === String(activeNoteIdRef.current))?.content) },
    } }
  })

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
      logger.log('[WhiteboardEditor] 切换视图前保存画布，从', prevView, '切换到', currentView)
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

  useEffect(() => {
    if (viewOnly) return undefined
    const handleExternalGenerate = async (event) => {
      const detail = event.detail
      if (!detail || detail.handled || String(detail.noteId) !== String(noteId) || !excalidrawAPI) return

      detail.handled = true
      if (aiGenerationInFlightRef.current) {
        detail.reject?.(new Error('当前画布正在生成，请等待完成后再试'))
        return
      }
      aiGenerationInFlightRef.current = true
      try {
        cancelSave()
        await saveNow()
        if (!editorMountedRef.current || String(activeNoteIdRef.current) !== String(noteId)) {
          throw new Error('画布已切换或关闭，请重新发起生成')
        }
        // 先生成并持久化，成功后再重挂载画布，避免半保存状态。
        const existingElements = excalidrawAPI.getSceneElements().filter(e => !e.isDeleted)
        const appState = excalidrawAPI.getAppState()
        const files = excalidrawAPI.getFiles()
        const validate = () => {
          detail.task?.throwIfCancelled()
          if (!editorMountedRef.current || String(activeNoteIdRef.current) !== String(noteId)) {
            throw new Error('生成期间已切换或关闭画布，生成结果未覆盖任何画布，请重新发起')
          }
          if (haveElementsChanged(existingElements, excalidrawAPI.getSceneElements().filter(e => !e.isDeleted))
            || haveFilesChanged(files, excalidrawAPI.getFiles())
            || hasCanvasSettingsChanged(appState, excalidrawAPI.getAppState())) {
            throw new Error('生成期间画布已有新修改，为保留你的修改，本次结果未写入，请重试')
          }
        }
        const note = notes.find(item => String(item.id) === String(noteId))
        const persistedData = parseWhiteboardContent(note?.content)
        const result = await generateWhiteboardElementsByAction({
          action: detail.action,
          prompt: detail.prompt,
          task: detail.task,
          elements: existingElements,
          appState,
          currentWhiteboardSummary: summarizeWhiteboardElementsForAI(existingElements, persistedData.fileMap || {}),
        })

        const nextFiles = result.action !== 'replace'
          ? { ...(files || {}), ...(result.fileMap || {}) }
          : { ...(result.fileMap || {}) }
        validate()
        cancelSave()
        await saveNow()
        validate()
        isApplyingRemoteDataRef.current = true
        await commitWhiteboardScene({
          elements: result.elements,
          appState: getPersistedAppState(excalidrawAPI.getAppState()),
          files: nextFiles,
          validate,
          task: detail.task,
        })

        // 重挂载完成后再放开 onChange 拦截，避免误判为用户操作触发自动保存
        setTimeout(() => {
          if (editorMountedRef.current && String(activeNoteIdRef.current) === String(noteId)) {
            isApplyingRemoteDataRef.current = false
          }
        }, 200)

        detail.resolve?.(result)
      } catch (error) {
        if (editorMountedRef.current && String(activeNoteIdRef.current) === String(noteId)) {
          isApplyingRemoteDataRef.current = false
        }
        detail.reject?.(error)
      } finally {
        aiGenerationInFlightRef.current = false
      }
    }

    window.addEventListener(WHITEBOARD_AI_GENERATE_EVENT, handleExternalGenerate)
    return () => window.removeEventListener(WHITEBOARD_AI_GENERATE_EVENT, handleExternalGenerate)
  }, [excalidrawAPI, noteId, notes, commitWhiteboardScene, viewOnly, cancelSave, saveNow])

  // 获取当前画布内容（用于类型转换）
  const getCurrentContent = useCallback(async () => {
    if (!excalidrawAPI) return null

    const elements = excalidrawAPI.getSceneElements()
    const appState = excalidrawAPI.getAppState()
    const files = excalidrawAPI.getFiles()

    // 保存图片到文件系统
    const fileMap = preserveWhiteboardFileMap(elements, await saveWhiteboardFiles(files), notes?.find(n => String(n.id) === String(noteId))?.content)

    const persistedAppState = getPersistedAppState(appState)

    const data = {
      type: 'excalidraw',
      version: 2,
      source: 'Flota-local',
      elements,
      appState: persistedAppState,
      fileMap
    }

    return JSON.stringify(data)
  }, [excalidrawAPI, notes, noteId])

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
        img.onload = async () => {
          try {
            const SCALE = 3
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth * SCALE
            canvas.height = img.naturalHeight * SCALE
            const ctx = canvas.getContext('2d')
            ctx.scale(SCALE, SCALE)
            ctx.drawImage(img, 0, 0)
            URL.revokeObjectURL(svgUrl)

            const pngBlob = await canvasToPngBlob(canvas)
            const url = URL.createObjectURL(pngBlob)
            const a = document.createElement('a')
            a.href = url
            a.download = `whiteboard-${noteId}.png`
            a.click()
            URL.revokeObjectURL(url)
            logger.log('[WhiteboardEditor] 导出 PNG 成功')
            resolve()
          } catch (error) {
            URL.revokeObjectURL(svgUrl)
            reject(error)
          }
        }
        img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e) }
        img.src = svgUrl
      })
    } catch (error) {
      console.error('[WhiteboardEditor] 导出 PNG 失败', error)
    }
  }, [excalidrawAPI, noteId])

  // 将获取内容和导出函数暴露给父组件
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

  // 组件卸载时保存当前画布
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
        saveNow().catch(error => console.error('[WhiteboardEditor] 卸载保存失败:', error))
      }
    }
  }, [saveNow])

  const excalidrawSurfaceSx = useMemo(
    () => createWhiteboardSurfaceSx({ isDark, primaryColor }),
    [isDark, primaryColor],
  )
  const mermaidDialogSlotProps = useMemo(
    () => createMermaidDialogSlotProps({ isDark, primaryColor }),
    [isDark, primaryColor],
  )

  const fitWhiteboardContent = useCallback(() => {
    if (!excalidrawAPI) return
    const state = excalidrawAPI.getAppState()
    const all = excalidrawAPI.getSceneElements().filter(element => !element.isDeleted)
    const selected = all.filter(element => state.selectedElementIds?.[element.id])
    const target = selected.length ? selected : all
    if (target.length) excalidrawAPI.scrollToContent(target, { fitToContent: true, animate: true })
  }, [excalidrawAPI])

  const contextEditableImage = controlSlots.contextMenu && excalidrawAPI
    ? getSelectedEditableImage(excalidrawAPI.getSceneElements(), excalidrawAPI.getAppState())
    : null
  const editContextImage = () => {
    if (!contextEditableImage) return
    excalidrawAPI?.updateScene({ appState: { contextMenu: null } })
    if (contextEditableImage.customData?.kind === 'mermaid-image') {
      openMermaidDslEditor(contextEditableImage)
    } else if (contextEditableImage.customData?.kind === 'svg-image') {
      openSvgEditor(contextEditableImage)
    }
  }

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
      containerType: 'inline-size',
      position: 'relative', 
      width: '100%', 
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Excalidraw 画布 */}
      <Box ref={setWhiteboardContainer} sx={{
        flex: 1, 
        minHeight: 0,
        width: '100%',
        position: 'relative',
        '& .excalidraw': {
          height: '100% !important',
          width: '100% !important'
        },
        ...(viewOnly ? {
          cursor: 'grab',
          '&:active': { cursor: 'grabbing' },
          // 嵌入只读画布只保留画布本体；Excalidraw 在较矮容器里会切到
          // mobile bottom bar，即使里面仅剩菜单按钮也会占掉一整块高度。
          '& .App-menu, & .App-bottom-bar, & .App-mobile-menu, & .layer-ui__wrapper__footer, & .layer-ui__wrapper__top-right, & .selected-shape-actions': { display: 'none !important' },
        } : {}),
        ...excalidrawSurfaceSx,
        ...(propertiesCollapsed ? { '& .excalidraw .App-menu__left, & .excalidraw .App-mobile-menu': { display: 'none !important' } } : {}),
      }}>
        <Excalidraw
          key={excalidrawKey}
          excalidrawAPI={(api) => {
            if (api) {
              logger.log('[WhiteboardEditor] Excalidraw API 已设置')
              setExcalidrawAPI(api)
              const active = api.getAppState()?.activeTool
              setToolbarState({
                activeTool: active?.type || 'selection',
                locked: Boolean(active?.locked),
              })
            }
          }}
          initialData={initialData}
          viewModeEnabled={viewOnly}
          onChange={(elements, appState, files) => {
            if (isApplyingRemoteDataRef.current) return

            const persistedAppState = getPersistedAppState(appState)
            // Excalidraw 首次恢复会补齐 gridSize、元素版本等默认值，它们不是用户编辑。
            if (awaitingInitialChangeRef.current) {
              awaitingInitialChangeRef.current = false
              latestSceneRef.current = { elements, appState: persistedAppState, files }
              return
            }
            const previousScene = latestSceneRef.current || {}
            const previousAppState = previousScene.appState || {}
            const viewportChanged = hasViewportChanged(previousAppState, persistedAppState)
            if (viewOnly) {
              latestSceneRef.current = { elements, appState: persistedAppState, files }
              if (viewportChanged) {
                sceneRevisionRef.current += 1
                if (!contentChangePendingRef.current) viewportOnlyChangeRef.current = true
                if (!hasUnsavedChangesRef.current) {
                  setHasUnsavedChanges(true)
                  hasUnsavedChangesRef.current = true
                }
                const now = Date.now()
                if (now - lastViewportSaveScheduleRef.current >= 250) {
                  lastViewportSaveScheduleRef.current = now
                  debouncedSave()
                }
              }
              return
            }

            const active = appState?.activeTool
            setToolbarState(previous => {
              const next = {
                activeTool: active?.type || 'selection',
                locked: Boolean(active?.locked),
              }
              return previous.activeTool === next.activeTool && previous.locked === next.locked
                ? previous
                : next
            })
            const editableImage = getSelectedEditableImage(elements, appState)
            setSelectedEditableImage((prev) => {
              if (!editableImage && !prev) return prev
              if (!editableImage) return null
              if (prev?.id === editableImage.id && prev?.version === editableImage.version) {
                return prev
              }
              return editableImage
            })

            const contentChanged = haveElementsChanged(previousScene.elements, elements)
              || haveFilesChanged(previousScene.files, files)
              || hasCanvasSettingsChanged(previousAppState, persistedAppState)
            latestSceneRef.current = {
              elements,
              appState: persistedAppState,
              files
            }

            if (contentChanged) {
              sceneRevisionRef.current += 1
              contentChangePendingRef.current = true
              viewportOnlyChangeRef.current = false
              if (!hasUnsavedChangesRef.current) {
                setHasUnsavedChanges(true)
                hasUnsavedChangesRef.current = true
              }
              debouncedSave()
            } else if (viewportChanged) {
              sceneRevisionRef.current += 1
              if (!contentChangePendingRef.current) viewportOnlyChangeRef.current = true
              if (!hasUnsavedChangesRef.current) {
                setHasUnsavedChanges(true)
                hasUnsavedChangesRef.current = true
              }
              const now = Date.now()
              if (now - lastViewportSaveScheduleRef.current >= 250) {
                lastViewportSaveScheduleRef.current = now
                debouncedSave()
              }
            }
          }}
          theme={isDark ? THEME.DARK : THEME.LIGHT}
          langCode={language === 'zh-CN' ? 'zh-CN' : 'en'}
          onLinkOpen={(element, event) => {
            event.preventDefault()
            openNoteLink(element.link).catch(error => console.warn('打开白板链接失败:', error))
          }}
          UIOptions={{
            canvasActions: {
              loadScene: false, // 禁用加载场景按钮（我们有自己的笔记管理）
              export: false, // 禁用导出按钮（我们有自己的导出功能）
              saveAsImage: false, // 禁用另存为图片（我们有自己的PNG导出）
            },
          }}
        />
        {viewOnly && (
          <Tooltip title="适应内容" placement="top">
            <IconButton
              size="small"
              aria-label="适应内容"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                fitWhiteboardContent()
              }}
              sx={{
                position: 'absolute',
                left: 12,
                bottom: 12,
                zIndex: 5,
                width: 34,
                height: 34,
                borderRadius: '9px',
                color: 'text.secondary',
                bgcolor: isDark ? 'rgba(35, 35, 41, 0.88)' : 'rgba(255, 255, 255, 0.88)',
                border: '1px solid',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(22,22,24, 0.10)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                '&:hover': {
                  color: 'primary.main',
                  bgcolor: isDark ? 'rgba(45, 45, 53, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                },
                '& .MuiSvgIcon-root': { fontSize: 18 },
              }}
            >
              <CenterFocusStrong />
            </IconButton>
          </Tooltip>
        )}
        {/* Portal 是有效的 React 子项，但 prop-types 的 node 校验不识别；用 Fragment 包装。 */}
        <>
        {!viewOnly && controlSlots.toolbar && createPortal(
          <WhiteboardToolbar
            api={excalidrawAPI}
            activeTool={toolbarState.activeTool}
            locked={toolbarState.locked}
            isDark={isDark}
            primaryColor={primaryColor}
            onMermaidCreate={openMermaidCreator}
            onSvgCreate={openSvgCreator}
            onNoteReference={() => setNotePickerOpen(true)}
          />,
          controlSlots.toolbar,
        )}
        {controlSlots.zoom && createPortal(
          <>
            <Tooltip title="适应选中内容；未选中时显示全部" placement="top">
              <button type="button" className="flota-native-control" aria-label="适应内容" onClick={fitWhiteboardContent}>
                <CenterFocusStrong />
              </button>
            </Tooltip>
            {propertiesCollapsed ? (
              <Tooltip title="显示属性面板" placement="top">
                <button type="button" className="flota-native-control" aria-label="展开属性面板" onClick={toggleProperties}>
                  <Tune />
                </button>
              </Tooltip>
            ) : null}
          </>,
          controlSlots.zoom,
        )}
        {!viewOnly && controlSlots.properties && !propertiesCollapsed && createPortal(
          <div className="flota-properties-header">
            <span>属性</span>
            <Tooltip title="收起属性面板" placement="right">
              <button type="button" className="flota-native-control" aria-label="收起属性面板" onClick={toggleProperties}>
                <VisibilityOff />
              </button>
            </Tooltip>
          </div>,
          controlSlots.properties,
        )}
        {controlSlots.contextMenu && contextEditableImage && createPortal(
          <button
            type="button"
            className="context-menu-item flota-context-menu-item"
            aria-label={contextEditableImage.customData?.kind === 'mermaid-image' ? '编辑 Mermaid 源码' : '编辑 SVG 源码'}
            onClick={editContextImage}
          >
            <div className="context-menu-item__label">
              {contextEditableImage.customData?.kind === 'mermaid-image' ? '编辑 Mermaid 源码' : '编辑 SVG 源码'}
            </div>
            <kbd className="context-menu-item__shortcut" />
          </button>,
          controlSlots.contextMenu,
        )}
        </>
      </Box>
      <NoteReferencePicker open={notePickerOpen} excludeId={noteId} onClose={() => setNotePickerOpen(false)} onSelect={insertNoteReference} />
      <Dialog
        open={dslEditorOpen}
        onClose={closeMermaidDslEditor}
        maxWidth="md"
        fullWidth
        slotProps={mermaidDialogSlotProps}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 10 }}
      >
        <DialogTitle>编辑 Mermaid DSL</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            当前图片是官方 Mermaid 图片快照。修改 DSL 后会原位重画并替换旧图。
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={14}
            value={dslDraft}
            onChange={(event) => setDslDraft(event.target.value)}
            placeholder="请输入 Mermaid DSL"
            disabled={isRegeneratingDsl}
          />
          {dslError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {dslError}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeMermaidDslEditor} disabled={isRegeneratingDsl} color="inherit">
            取消
          </Button>
          <Button onClick={regenerateMermaidImage} disabled={isRegeneratingDsl} variant="contained">
            {isRegeneratingDsl ? '重画中...' : '重画替换'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={creatorOpen}
        onClose={closeMermaidCreator}
        maxWidth="md"
        fullWidth
        slotProps={mermaidDialogSlotProps}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 10 }}
      >
        <DialogTitle>Mermaid 代码成图</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            输入 Mermaid DSL，将在画布视口中心生成图形。flowchart / sequence / class / state / er 可拆图元编辑，其余类型以图片快照插入。
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={14}
            value={creatorDraft}
            onChange={(event) => setCreatorDraft(event.target.value)}
            placeholder={'示例：\nflowchart LR\n  A[开始] --> B{是否登录}\n  B -- 是 --> C[进入主页]\n  B -- 否 --> D[跳转登录]'}
            disabled={isCreatingDiagram}
          />
          {creatorError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {creatorError}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeMermaidCreator} disabled={isCreatingDiagram} color="inherit">
            取消
          </Button>
          <Button onClick={createMermaidDiagram} disabled={isCreatingDiagram} variant="contained">
            {isCreatingDiagram ? '生成中...' : '生成到画布'}
          </Button>
        </DialogActions>
      </Dialog>
      <SvgSourceDialog
        open={svgCreatorOpen}
        title="SVG 代码成图"
        description="粘贴完整 SVG 源码。系统会移除脚本、外链、动画等不安全内容，并以可无损缩放的图片元素插入视口中心。"
        source={svgCreatorDraft}
        error={svgCreatorError}
        busy={isCreatingSvg}
        placeholder={'<svg viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">\n  ...\n</svg>'}
        submitLabel="插入到画布"
        busyLabel="插入中..."
        slotProps={mermaidDialogSlotProps}
        onChange={setSvgCreatorDraft}
        onClose={closeSvgCreator}
        onSubmit={createSvgDiagram}
      />
      <SvgSourceDialog
        open={svgEditorOpen}
        title="编辑 SVG 源码"
        description="保存后会在原位置替换图形，并保留当前元素的大小、旋转和层级关系。"
        source={svgDraft}
        error={svgError}
        busy={isRegeneratingSvg}
        submitLabel="保存并替换"
        busyLabel="替换中..."
        slotProps={mermaidDialogSlotProps}
        onChange={setSvgDraft}
        onClose={closeSvgEditor}
        onSubmit={regenerateSvgImage}
      />
    </Box>
  )
}

export default WhiteboardEditor
