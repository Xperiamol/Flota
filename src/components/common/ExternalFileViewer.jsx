import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme
} from '@mui/material'
import { Close as CloseIcon, FolderOpenRounded, NoteAdd } from './AppIcons'
import PanelIconButton from './PanelIconButton'
import MarkdownPreview from '../editor/MarkdownPreview'
import { useStore } from '../../store/useStore'
import { useError } from './ErrorProvider'
import { replaceDataImagesInMarkdown } from '../../utils/dataUrlImage'
import { EXTERNAL_FILE_OPEN_EVENT } from '../../utils/externalFiles'
import { editorScrollbarSx } from '../../styles/commonStyles'

const ExternalWhiteboardView = lazy(() => import('./ExternalWhiteboardView'))

const FORMAT_LABELS = { markdown: 'Markdown', text: '纯文本', whiteboard: 'Excalidraw 白板' }
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)

const formatSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 外部文件只读查看器：系统双击 / 打开方式 / 拖到 Dock / 「打开文件…」都会进入这里。
// 文件本身不会被修改；需要编辑时导入为笔记（图片会一并复制进应用）。
const ExternalFileViewer = () => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showError, showSuccess } = useError()
  const [queue, setQueue] = useState([])
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  const currentPath = queue[0] || null

  const enqueue = useCallback((filePath) => {
    if (!filePath) return
    setQueue((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]))
  }, [])

  // 系统交来的文件 + 启动时积压的文件 + 渲染层内部的打开请求
  useEffect(() => {
    const api = window.electronAPI?.externalFiles
    const unsubscribe = api?.onOpened?.(enqueue)
    api?.consumePending?.().then((result) => {
      if (result?.success) (result.data || []).forEach(enqueue)
    }).catch(() => {})
    const handleRequest = (event) => enqueue(event.detail?.path)
    window.addEventListener(EXTERNAL_FILE_OPEN_EVENT, handleRequest)
    return () => {
      unsubscribe?.()
      window.removeEventListener(EXTERNAL_FILE_OPEN_EVENT, handleRequest)
    }
  }, [enqueue])

  useEffect(() => {
    if (!currentPath) {
      setFile(null)
      setError('')
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setError('')
    setFile(null)
    window.electronAPI?.externalFiles?.read?.(currentPath)
      .then((result) => {
        if (cancelled) return
        if (result?.success) setFile(result.data)
        else setError(result?.error || '无法读取文件')
      })
      .catch((err) => { if (!cancelled) setError(err?.message || '无法读取文件') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentPath])

  const close = useCallback(() => {
    setQueue((prev) => prev.slice(1))
  }, [])

  const handleImport = useCallback(async () => {
    if (!file || importing) return
    setImporting(true)
    try {
      const state = useStore.getState()
      let payload
      if (file.format === 'whiteboard') {
        // 与应用内白板存储结构一致；fileMap 里带内联 dataURL，首次打开后会落盘到本地图片目录
        payload = {
          title: file.title,
          note_type: 'whiteboard',
          content: JSON.stringify({
            type: 'excalidraw',
            version: 2,
            source: 'Flota-import',
            elements: file.whiteboard.elements,
            appState: file.whiteboard.appState,
            fileMap: file.whiteboard.files
          })
        }
      } else {
        payload = {
          title: file.title,
          note_type: 'markdown',
          tags: file.tags || [],
          // 预览时内联的本地图片在这里复制进应用图片目录
          content: await replaceDataImagesInMarkdown(file.content || '')
        }
      }
      const result = await state.createNote(payload)
      if (!result?.success) throw new Error(result?.error || '导入失败')
      state.setSelectedNoteId(result.data.id)
      state.setCurrentView('notes')
      showSuccess?.(`已导入为笔记「${file.title}」`)
      close()
    } catch (err) {
      showError?.(err, '导入失败')
    } finally {
      setImporting(false)
    }
  }, [close, file, importing, showError, showSuccess])

  const handleReveal = useCallback(() => {
    if (currentPath) window.electronAPI?.externalFiles?.reveal?.(currentPath)
  }, [currentPath])

  const open = Boolean(currentPath)
  const chipSx = { height: 22, fontSize: 11, borderRadius: 1 }

  const renderBody = () => {
    if (loading) {
      return (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      )
    }
    if (error) {
      return (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 4 }}>
          <Stack spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 600 }}>无法打开这个文件</Typography>
            <Typography variant="body2" color="text.secondary">{error}</Typography>
          </Stack>
        </Box>
      )
    }
    if (!file) return null
    if (file.format === 'whiteboard') {
      return (
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Suspense fallback={<Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>}>
            <ExternalWhiteboardView whiteboard={file.whiteboard} isDark={isDark} />
          </Suspense>
        </Box>
      )
    }
    if (file.format === 'text') {
      return (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 2, md: 5 }, py: 3, ...editorScrollbarSx }}>
          <Box
            component="pre"
            sx={{
              m: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'text.primary'
            }}
          >
            {file.content}
          </Box>
        </Box>
      )
    }
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 2, md: 5 }, py: 3, ...editorScrollbarSx }}>
        <Box sx={{ maxWidth: 860, mx: 'auto' }}>
          <MarkdownPreview content={file.content} showAudioTranscription={false} />
        </Box>
      </Box>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      fullWidth
      maxWidth="lg"
      slotProps={{
        paper: {
          sx: {
            height: '86vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: '16px',
            backgroundImage: 'none'
          }
        }
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, isDark ? 0.6 : 0.9)
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 15, fontWeight: 700, minWidth: 0 }}>
              {file?.name || currentPath?.split(/[\\/]/).pop() || ''}
            </Typography>
            <Tooltip title="外部文件以只读方式打开，不会被修改。需要编辑时请导入为笔记。">
              <Chip size="small" label="只读" sx={{ ...chipSx, bgcolor: alpha(theme.palette.warning.main, 0.14), color: 'warning.main' }} />
            </Tooltip>
            {file && <Chip size="small" variant="outlined" label={FORMAT_LABELS[file.format] || file.format} sx={chipSx} />}
            {file && file.format !== 'whiteboard' && !String(file.encoding).startsWith('UTF-8') && (
              <Chip size="small" variant="outlined" label={file.encoding} sx={chipSx} />
            )}
            {file && <Chip size="small" variant="outlined" label={formatSize(file.size)} sx={chipSx} />}
            {queue.length > 1 && <Chip size="small" label={`还有 ${queue.length - 1} 个文件`} sx={chipSx} />}
          </Stack>
          <Typography noWrap variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {currentPath}
            {file?.missingImages > 0 ? ` · ${file.missingImages} 张图片未找到` : ''}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<FolderOpenRounded fontSize="small" />}
          onClick={handleReveal}
          sx={{ textTransform: 'none', color: 'text.secondary', borderRadius: '10px' }}
        >
          {isMac ? '在访达中显示' : '在文件夹中显示'}
        </Button>
        <Button
          size="small"
          variant="contained"
          disableElevation
          startIcon={importing ? <CircularProgress size={14} color="inherit" /> : <NoteAdd fontSize="small" />}
          disabled={!file || importing}
          onClick={handleImport}
          sx={{ textTransform: 'none', borderRadius: '10px', fontWeight: 700 }}
        >
          导入为笔记
        </Button>
        <PanelIconButton title="关闭" onClick={close}>
          <CloseIcon />
        </PanelIconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
        {renderBody()}
      </Box>
    </Dialog>
  )
}

export default ExternalFileViewer
