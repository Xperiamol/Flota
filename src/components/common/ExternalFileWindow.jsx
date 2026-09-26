import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme
} from '@mui/material'
import {
  Check,
  Close,
  ContentCopy,
  ContentCutRounded,
  ContentPaste,
  Edit,
  FolderOpenRounded,
  HorizontalRule,
  Link,
  MoreHoriz,
  NoteAdd,
  RedoRounded,
  Refresh,
  SaveRounded,
  SelectAll,
  UndoRounded,
  Visibility,
  WebAsset
} from './AppIcons'
import AppContextMenu from './AppContextMenu'
import MarkdownPreview from '../editor/MarkdownPreview'
import { useError } from './ErrorProvider'
import { replaceDataImagesInMarkdown } from '../../utils/dataUrlImage'
import { editorScrollbarSx, segmentedButtonSx, segmentedControlSx } from '../../styles/commonStyles'

const ExternalWhiteboardView = lazy(() => import('./ExternalWhiteboardView'))

const FORMAT_LABELS = { markdown: 'Markdown', text: '纯文本', whiteboard: 'Excalidraw 白板' }
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'

const formatSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const countChars = (text = '') => text.replace(/\s/g, '').length

// 白板内容签名：元素版本之和 + 元素数 + 背景色，用来判断是否有未保存的修改
const sceneSignature = (elements = [], appState = {}) => {
  const live = elements.filter((el) => !el.isDeleted)
  return `${live.reduce((sum, el) => sum + (el.version || 0), 0)}:${live.length}:${appState.viewBackgroundColor || ''}`
}

const api = () => window.electronAPI?.externalFiles

/**
 * 外部文件独立窗口：系统双击 / 打开方式 / 拖到 Dock / 「打开文件…」打开的每个文件各占一个窗口。
 * 默认预览；切换到编辑模式后可直接改写原文件（保留原编码和换行符），也可导入为笔记。
 */
export default function ExternalFileWindow({ filePath }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showError, showSuccess } = useError()

  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [mode, setMode] = useState('preview')
  const [draft, setDraft] = useState('')
  const [savedText, setSavedText] = useState('')
  const [previewContent, setPreviewContent] = useState('')
  const [boardDirty, setBoardDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [importing, setImporting] = useState(false)
  const [menu, setMenu] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [confirmClose, setConfirmClose] = useState(false)

  const textareaRef = useRef(null)
  const whiteboardApiRef = useRef(null)
  const boardBaselineRef = useRef(null)
  const mtimeRef = useRef(null)
  const allowCloseRef = useRef(false)
  const dirtyRef = useRef(false)

  const isBoard = file?.format === 'whiteboard'
  const dirty = isBoard ? boardDirty : draft !== savedText
  const fileName = file?.name || filePath.split(/[\\/]/).pop()
  dirtyRef.current = dirty

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api()?.read?.(filePath)
      if (!result?.success) throw new Error(result?.error || '无法读取文件')
      const data = result.data
      setFile(data)
      setDraft(data.raw ?? '')
      setSavedText(data.raw ?? '')
      setPreviewContent(data.content ?? '')
      setBoardDirty(false)
      boardBaselineRef.current = null
      mtimeRef.current = data.modifiedAt
    } catch (error) {
      setLoadError(error.message || '无法读取文件')
    } finally {
      setLoading(false)
    }
  }, [filePath])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${fileName}`
  }, [dirty, fileName])

  // 有未保存修改时拦下关闭，改为弹出确认
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!dirtyRef.current || allowCloseRef.current) return
      event.preventDefault()
      event.returnValue = ''
      setConfirmClose(true)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const refreshPreview = useCallback(async (text) => {
    if (file?.format !== 'markdown') {
      setPreviewContent(text)
      return
    }
    const result = await api()?.render?.(filePath, text)
    if (result?.success) setPreviewContent(result.data.content)
  }, [file?.format, filePath])

  const switchMode = useCallback(async (next) => {
    if (next === mode || !file) return
    if (next === 'edit' && !file.writable) return
    if (next === 'preview' && !isBoard && draft !== savedText) await refreshPreview(draft)
    setMode(next)
    if (next === 'edit' && !isBoard) requestAnimationFrame(() => textareaRef.current?.focus())
  }, [draft, file, isBoard, mode, refreshPreview, savedText])

  const save = useCallback(async ({ force = false } = {}) => {
    if (!file || saving || !dirtyRef.current) return true
    setSaving(true)
    try {
      let result
      if (isBoard) {
        const board = whiteboardApiRef.current
        if (!board) return false
        const elements = board.getSceneElements()
        const usedFiles = new Set(elements.map((el) => el.fileId).filter(Boolean))
        const allFiles = board.getFiles() || {}
        const files = Object.fromEntries(Object.entries(allFiles).filter(([id]) => usedFiles.has(id)))
        result = await api()?.writeWhiteboard?.(filePath, {
          elements,
          appState: { viewBackgroundColor: board.getAppState().viewBackgroundColor },
          files
        }, { expectedMtime: mtimeRef.current, force })
      } else {
        result = await api()?.write?.(filePath, draft, { expectedMtime: mtimeRef.current, force })
      }
      if (!result?.success) throw new Error(result?.error || '保存失败')
      if (result.data.conflict) {
        setConflict(result.data)
        return false
      }
      mtimeRef.current = result.data.modifiedAt
      setFile((prev) => ({ ...prev, size: result.data.size, encoding: result.data.encoding || prev.encoding }))
      if (isBoard) {
        const board = whiteboardApiRef.current
        boardBaselineRef.current = sceneSignature(board.getSceneElements(), board.getAppState())
        setBoardDirty(false)
      } else {
        setSavedText(draft)
        refreshPreview(draft)
      }
      if (result.data.convertedFrom) showSuccess?.(`已保存，编码从 ${result.data.convertedFrom} 转为 UTF-8`)
      return true
    } catch (error) {
      showError?.(error, '保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }, [draft, file, filePath, isBoard, refreshPreview, saving, showError, showSuccess])

  const closeWindow = useCallback(() => window.electronAPI?.window?.close?.(), [])

  const closeWithoutGuard = useCallback(() => {
    allowCloseRef.current = true
    closeWindow()
  }, [closeWindow])

  const copyText = useCallback(async (text) => {
    const result = await api()?.copyText?.(text)
    if (result?.success) return true
    showError?.(new Error(result?.error || '复制失败'), '复制失败')
    return false
  }, [showError])

  const copyAll = useCallback(async () => {
    if (!file || isBoard) return
    if (await copyText(draft)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }
  }, [copyText, draft, file, isBoard])

  const reveal = useCallback(() => api()?.reveal?.(filePath), [filePath])

  const importAsNote = useCallback(async () => {
    if (!file || importing) return
    setImporting(true)
    try {
      let payload
      if (isBoard) {
        const board = whiteboardApiRef.current
        payload = {
          title: file.title,
          note_type: 'whiteboard',
          content: JSON.stringify({
            type: 'excalidraw',
            version: 2,
            source: 'Flota-import',
            elements: board ? board.getSceneElements() : file.whiteboard.elements,
            appState: board ? { viewBackgroundColor: board.getAppState().viewBackgroundColor } : file.whiteboard.appState,
            fileMap: board ? board.getFiles() : file.whiteboard.files
          })
        }
      } else {
        // 导入当前内容（含未保存的修改）；预览时内联的本地图片复制进应用图片目录
        const content = draft === savedText ? previewContent : (await api()?.render?.(filePath, draft))?.data?.content ?? draft
        payload = {
          title: file.title,
          note_type: 'markdown',
          tags: file.tags || [],
          content: await replaceDataImagesInMarkdown(content || '')
        }
      }
      const result = await window.electronAPI?.notes?.create?.(payload)
      if (!result?.success) throw new Error(result?.error || '导入失败')
      await api()?.showNote?.(result.data.id)
    } catch (error) {
      showError?.(error, '导入失败')
    } finally {
      setImporting(false)
    }
  }, [draft, file, filePath, importing, isBoard, previewContent, savedText, showError])

  // 快捷键：保存、切换编辑 / 预览
  useEffect(() => {
    const handleKey = (event) => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (!mod || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        save()
      } else if (key === 'e' && !event.shiftKey) {
        event.preventDefault()
        switchMode(mode === 'edit' ? 'preview' : 'edit')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [mode, save, switchMode])

  const handleWhiteboardChange = useCallback((elements, appState) => {
    const signature = sceneSignature(elements, appState)
    if (boardBaselineRef.current === null) {
      boardBaselineRef.current = signature
      return
    }
    setBoardDirty(signature !== boardBaselineRef.current)
  }, [])

  const handleTextareaKeyDown = (event) => {
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      document.execCommand('insertText', false, '  ')
    }
  }

  // 编辑区里的菜单操作走 execCommand，保留撤销栈
  const editCommand = (command) => {
    textareaRef.current?.focus()
    document.execCommand(command)
  }

  const pasteIntoEditor = async () => {
    const result = await api()?.readClipboard?.()
    if (!result?.success) {
      showError?.(new Error(result?.error || '无法读取剪贴板'), '粘贴失败')
      return
    }
    textareaRef.current?.focus()
    if (result.data) document.execCommand('insertText', false, result.data)
  }

  const openContextMenu = (event) => {
    if (!file || isBoard) return
    event.preventDefault()
    const selection = mode === 'edit'
      ? (() => {
        const el = textareaRef.current
        return el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
      })()
      : String(window.getSelection?.() || '')
    setMenu({ x: event.clientX, y: event.clientY, selection })
  }

  const menuItems = useMemo(() => {
    if (!menu || !file) return []
    const hasSelection = Boolean(menu.selection)
    const fileItems = [
      { key: 'copy-all', label: '复制全文', icon: <ContentCopy fontSize="small" />, onClick: copyAll },
      { key: 'copy-path', label: '复制文件路径', icon: <Link fontSize="small" />, onClick: () => copyText(filePath) },
      { key: 'd-file', divider: true },
      { key: 'reveal', label: isMac ? '在访达中显示' : '在文件夹中显示', icon: <FolderOpenRounded fontSize="small" />, onClick: reveal },
      { key: 'import', label: '导入为笔记', icon: <NoteAdd fontSize="small" />, onClick: importAsNote },
    ]
    if (mode === 'edit') {
      return [
        { key: 'undo', label: '撤销', icon: <UndoRounded fontSize="small" />, onClick: () => editCommand('undo') },
        { key: 'redo', label: '重做', icon: <RedoRounded fontSize="small" />, onClick: () => editCommand('redo') },
        { key: 'd1', divider: true },
        { key: 'cut', label: '剪切', icon: <ContentCutRounded fontSize="small" />, disabled: !hasSelection, onClick: () => editCommand('cut') },
        { key: 'copy', label: '复制', icon: <ContentCopy fontSize="small" />, disabled: !hasSelection, onClick: () => copyText(menu.selection) },
        { key: 'paste', label: '粘贴', icon: <ContentPaste fontSize="small" />, onClick: pasteIntoEditor },
        { key: 'select-all', label: '全选', icon: <SelectAll fontSize="small" />, onClick: () => editCommand('selectAll') },
        { key: 'd2', divider: true },
        { key: 'save', label: `保存（${MOD}S）`, icon: <SaveRounded fontSize="small" />, disabled: !dirty, onClick: () => save() },
        { key: 'preview', label: '切换到预览', icon: <Visibility fontSize="small" />, onClick: () => switchMode('preview') },
        { key: 'd3', divider: true },
        ...fileItems,
      ]
    }
    return [
      { key: 'copy', label: '复制', icon: <ContentCopy fontSize="small" />, disabled: !hasSelection, onClick: () => copyText(menu.selection) },
      {
        key: 'select-all',
        label: '全选',
        icon: <SelectAll fontSize="small" />,
        onClick: () => {
          const target = document.getElementById('external-file-content')
          if (!target) return
          const range = document.createRange()
          range.selectNodeContents(target)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
        }
      },
      { key: 'd1', divider: true },
      { key: 'edit', label: `编辑（${MOD}E）`, icon: <Edit fontSize="small" />, disabled: !file.writable, onClick: () => switchMode('edit') },
      { key: 'reload', label: '重新载入', icon: <Refresh fontSize="small" />, onClick: load },
      { key: 'd2', divider: true },
      ...fileItems,
    ]
  }, [copyAll, copyText, dirty, file, filePath, importAsNote, load, menu, mode, reveal, save, switchMode])

  const moreItems = [
    { key: 'copy-path', label: '复制文件路径', icon: <Link fontSize="small" />, onClick: () => copyText(filePath) },
    { key: 'reveal', label: isMac ? '在访达中显示' : '在文件夹中显示', icon: <FolderOpenRounded fontSize="small" />, onClick: reveal },
    { key: 'reload', label: '重新载入', icon: <Refresh fontSize="small" />, disabled: dirty, onClick: load },
    { key: 'd1', divider: true },
    { key: 'import', label: '导入为笔记', icon: <NoteAdd fontSize="small" />, disabled: !file || importing, onClick: importAsNote },
  ]

  const iconButtonSx = { width: 30, height: 30, borderRadius: '9px', color: 'text.secondary' }

  const renderBody = () => {
    if (loading) {
      return <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}><CircularProgress size={26} /></Box>
    }
    if (loadError) {
      return (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 4 }}>
          <Stack spacing={1.5} alignItems="center">
            <Typography sx={{ fontWeight: 600 }}>无法打开这个文件</Typography>
            <Typography variant="body2" color="text.secondary">{loadError}</Typography>
            <Button size="small" variant="outlined" onClick={load} sx={{ borderRadius: '9px' }}>重试</Button>
          </Stack>
        </Box>
      )
    }
    if (!file) return null
    if (isBoard) {
      return (
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Suspense fallback={<Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><CircularProgress size={26} /></Box>}>
            <ExternalWhiteboardView
              whiteboard={file.whiteboard}
              isDark={isDark}
              editable={mode === 'edit'}
              onChange={handleWhiteboardChange}
              apiRef={whiteboardApiRef}
            />
          </Suspense>
        </Box>
      )
    }
    if (mode === 'edit') {
      return (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', ...editorScrollbarSx }} onContextMenu={openContextMenu}>
          <Box
            component="textarea"
            ref={textareaRef}
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            sx={{
              display: 'block',
              width: '100%',
              maxWidth: 860,
              minHeight: '100%',
              mx: 'auto',
              // 与预览对齐：外层内边距 + MarkdownPreview 自带的 16px
              px: { xs: 4.5, md: 7 },
              py: 5,
              border: 0,
              outline: 0,
              resize: 'none',
              bgcolor: 'transparent',
              color: 'text.primary',
              caretColor: theme.palette.primary.main,
              fontFamily: file.format === 'text'
                ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
                : 'inherit',
              fontSize: file.format === 'text' ? 13.5 : 15,
              lineHeight: 1.8,
              fieldSizing: 'content',
              '&::selection': { bgcolor: alpha(theme.palette.primary.main, 0.22) },
            }}
          />
        </Box>
      )
    }
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', ...editorScrollbarSx }} onContextMenu={openContextMenu}>
        <Box id="external-file-content" sx={{ maxWidth: 860, mx: 'auto', px: { xs: 2.5, md: 5 }, py: 3 }}>
          {file.format === 'text' ? (
            <Box
              component="pre"
              sx={{
                m: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 13.5,
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'text.primary'
              }}
            >
              {previewContent}
            </Box>
          ) : (
            <MarkdownPreview content={previewContent} showAudioTranscription={false} />
          )}
        </Box>
      </Box>
    )
  }

  const statusParts = file ? [
    FORMAT_LABELS[file.format] || file.format,
    !isBoard ? `${countChars(draft).toLocaleString()} 字` : null,
    formatSize(file.size),
    file.encoding && !String(file.encoding).startsWith('UTF-8') ? file.encoding : null,
    file.missingImages > 0 && mode === 'preview' ? `${file.missingImages} 张图片未找到` : null,
  ].filter(Boolean) : []

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* 标题栏：可拖动；macOS 左侧留给系统红绿灯，其他平台右侧自绘窗口按钮 */}
      <Box
        sx={{
          height: 46,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: isMac ? '84px' : 1.75,
          pr: isMac ? 1.25 : 0,
          borderBottom: 1,
          borderColor: 'divider',
          WebkitAppRegion: 'drag',
          userSelect: 'none',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography noWrap title={filePath} sx={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>
            {fileName}
          </Typography>
          {dirty && (
            <Tooltip title="有未保存的修改">
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.secondary', flexShrink: 0, WebkitAppRegion: 'no-drag' }} />
            </Tooltip>
          )}
          {file && !file.writable && (
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', flexShrink: 0 }}>只读</Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, WebkitAppRegion: 'no-drag' }}>
          {mode === 'edit' && (
            <Button
              size="small"
              variant={dirty ? 'contained' : 'text'}
              disableElevation
              disabled={!dirty || saving}
              onClick={() => save()}
              startIcon={saving ? <CircularProgress size={13} color="inherit" /> : <SaveRounded sx={{ fontSize: '16px !important' }} />}
              sx={{ height: 30, px: 1.25, borderRadius: '9px', fontSize: 12.5, fontWeight: 600, textTransform: 'none', mr: 0.5 }}
            >
              {dirty ? '保存' : '已保存'}
            </Button>
          )}

          {!isBoard && (
            <Tooltip title={copied ? '已复制' : '复制全文'}>
              <span>
                <IconButton size="small" disabled={!file} onClick={copyAll} sx={iconButtonSx}>
                  {copied ? <Check sx={{ fontSize: 17, color: 'success.main' }} /> : <ContentCopy sx={{ fontSize: 16 }} />}
                </IconButton>
              </span>
            </Tooltip>
          )}

          <Tooltip title={file && !file.writable ? '文件是只读的，无法编辑' : ''}>
            <Box sx={[segmentedControlSx, { height: 32, boxSizing: 'border-box', p: '2px', gap: '2px', borderRadius: '10px' }]}>
              {[{ value: 'preview', label: '预览', Icon: Visibility }, { value: 'edit', label: '编辑', Icon: Edit }].map((item) => (
                <Button
                  key={item.value}
                  disableRipple
                  disabled={!file || (item.value === 'edit' && !file.writable)}
                  aria-pressed={mode === item.value}
                  onClick={() => switchMode(item.value)}
                  sx={[segmentedButtonSx(mode === item.value), { height: 26, minHeight: 26, px: 1.1, py: 0, borderRadius: '7px', lineHeight: 1 }]}
                >
                  <item.Icon sx={{ fontSize: 14, mr: 0.5 }} />
                  {item.label}
                </Button>
              ))}
            </Box>
          </Tooltip>

          <Tooltip title="更多">
            <IconButton size="small" onClick={(event) => setMenu({ el: event.currentTarget, more: true })} sx={iconButtonSx}>
              <MoreHoriz sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          {!isMac && (
            <Box sx={{ display: 'flex', alignSelf: 'stretch', ml: 0.5 }}>
              {[
                { label: '最小化', Icon: HorizontalRule, onClick: () => window.electronAPI?.window?.minimize?.() },
                { label: '最大化', Icon: WebAsset, onClick: () => window.electronAPI?.window?.maximize?.() },
                { label: '关闭', Icon: Close, onClick: closeWindow, danger: true },
              ].map(({ label, Icon, onClick, danger }) => (
                <Box
                  key={label}
                  role="button"
                  aria-label={label}
                  onClick={onClick}
                  sx={{
                    width: 44,
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                    color: 'text.primary',
                    '&:hover': danger
                      ? { bgcolor: 'error.main', color: 'error.contrastText' }
                      : { bgcolor: 'action.hover' },
                  }}
                >
                  <Icon sx={{ fontSize: 16 }} />
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {renderBody()}
      </Box>

      {/* 状态栏 */}
      {file && (
        <Box
          sx={{
            height: 28,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 1.75,
            borderTop: 1,
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 11.5,
          }}
        >
          <Typography noWrap title={filePath} sx={{ fontSize: 'inherit', flex: 1, minWidth: 0, opacity: 0.85 }}>
            {filePath}
          </Typography>
          <Typography sx={{ fontSize: 'inherit', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {statusParts.join(' · ')}
          </Typography>
        </Box>
      )}

      <AppContextMenu
        anchor={menu}
        onClose={() => setMenu(null)}
        items={menu?.more ? moreItems : menuItems}
      />

      {/* 文件在外部被修改过 */}
      <Dialog open={Boolean(conflict)} onClose={() => setConflict(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>文件已在外部被修改</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            打开之后，「{fileName}」被其他程序改过了。覆盖会丢掉那些改动；重新载入会丢掉你在这里的修改。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConflict(null)} color="inherit">取消</Button>
          <Button onClick={() => { setConflict(null); load() }} color="inherit">重新载入</Button>
          <Button variant="contained" disableElevation onClick={() => { setConflict(null); save({ force: true }) }}>覆盖</Button>
        </DialogActions>
      </Dialog>

      {/* 关闭时有未保存的修改 */}
      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>保存对「{fileName}」的修改吗？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">不保存的话，修改会丢失。</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeWithoutGuard} color="inherit">不保存</Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setConfirmClose(false)} color="inherit">取消</Button>
          <Button
            variant="contained"
            disableElevation
            onClick={async () => {
              setConfirmClose(false)
              if (await save()) closeWithoutGuard()
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
