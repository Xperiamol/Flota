import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Box, Chip, IconButton, InputBase, Stack, Tooltip, alpha, useTheme } from '@mui/material'
import { AttachFile, Close, Image, KeyboardVoice, Send, TaskAlt } from '../../common/AppIcons'
import AudioRecordButton from '../../editor/AudioRecordButton'
import { imageAPI } from '../../../api/imageAPI'
import { getImageResolver } from '../../../utils/ImageProtocolResolver'
import { imageUploadName } from '../../../utils/editorImageSource'
import { isImeComposing } from '../../../utils/imeUtils'
import { notifyError } from '../../../utils/notify'
import {
  floatingComposerDockSx,
  floatingComposerSendSx,
  floatingComposerSx,
  floatingComposerToolSx,
} from '../../../styles/floatingComposerSx'
import { IMAGE_EXT, appendDraftText, attachmentToMarkdown, parseTodoInput } from './timelineContent'

// 时间轴底部的输入框。
//
// 自己持有草稿 / 附件状态：打字只重渲染输入框，不会带着整条时间轴一起重渲染。
// 写入由父组件的 onSubmit({ kind, content }) 完成：失败时抛错，输入框保留内容并提示。

const getDroppedFilePath = (file) => {
  try {
    return window.electronAPI?.system?.getPathForFile?.(file) || file?.path || file?.webkitRelativePath || ''
  } catch {
    return file?.path || file?.webkitRelativePath || ''
  }
}

const isImageFile = (file) => Boolean(
  file && (String(file.type || '').startsWith('image/') || IMAGE_EXT.test(file.name || ''))
)

// 从剪贴板中取出文件（截图、Finder 复制的文件等）
const getClipboardFiles = (clipboardData) => {
  if (!clipboardData) return []
  const files = Array.from(clipboardData.files || [])
  if (files.length) return files
  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean)
}

const toAttachment = (result, fallbackName) => ({
  name: result.data.displayName || fallbackName || '附件',
  path: result.data.relativePath,
  url: `app://${result.data.relativePath}`,
})

const AttachmentQueue = ({ attachments, onRemove }) => {
  const theme = useTheme()
  if (!attachments.length) return null
  return (
    <Stack direction="row" spacing={0.75} sx={{ px: 0.5, pt: 0.25, mb: 1, overflowX: 'auto', pb: 0.25 }}>
      {attachments.map((item) => (
        <Chip
          key={item.id}
          size="small"
          label={item.type === 'image' ? item.name || '图片' : item.type === 'audio' ? '语音' : item.name || '文件'}
          variant="outlined"
          icon={
            item.type === 'image' && item.previewUrl
              ? <Box component="img" src={item.previewUrl} alt="" sx={{ width: 22, height: 22, borderRadius: '6px', objectFit: 'cover', ml: '4px !important' }} />
              : item.type === 'image' ? <Image fontSize="small" />
              : item.type === 'audio' ? <KeyboardVoice fontSize="small" />
              : <AttachFile fontSize="small" />
          }
          onDelete={() => onRemove(item.id)}
          deleteIcon={<Close fontSize="small" />}
          sx={{
            height: 30,
            borderRadius: '999px',
            flexShrink: 0,
            maxWidth: 200,
            px: 0.35,
            color: 'text.primary',
            backgroundColor: theme.palette.mode === 'dark' ? alpha('#1f1f22', 0.84) : alpha('#ffffff', 0.9),
            borderColor: alpha(theme.palette.text.primary, 0.12),
            '& .MuiChip-label': { px: 1, fontSize: 12 },
            '& .MuiChip-deleteIcon': { color: 'text.secondary' },
          }}
        />
      ))}
    </Stack>
  )
}

const TimelineComposer = forwardRef(({ onSubmit, onHeightChange }, ref) => {
  const theme = useTheme()
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const dockRef = useRef(null)
  const inputRef = useRef(null)
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments

  // 「待办：」「- [ ]」开头会建成待办：输入时就显示出来，发送前就知道会变成什么
  const todoText = attachments.length === 0 ? parseTodoInput(draft) : null

  // 父组件按输入框实际高度给列表留白（附件、多行时会变高）
  useLayoutEffect(() => {
    const node = dockRef.current
    if (!node || !onHeightChange) return undefined
    const report = () => onHeightChange(node.getBoundingClientRect().height)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(node)
    return () => observer.disconnect()
  }, [onHeightChange])

  // 卸载时回收本地缩略图 URL
  useEffect(() => () => {
    attachmentsRef.current.forEach((item) => { if (item.ownsPreview) URL.revokeObjectURL(item.previewUrl) })
  }, [])

  const addAttachment = useCallback((item) => {
    setAttachments((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...item }])
  }, [])

  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target?.ownsPreview) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((item) => item.id !== id)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((item) => { if (item.ownsPreview) URL.revokeObjectURL(item.previewUrl) })
      return []
    })
  }, [])

  const importLocalFileAsAttachment = useCallback(async (filePath, fallbackName) => {
    if (!filePath) return null
    try {
      const result = await window.electronAPI?.attachments?.saveFromPath?.(filePath, fallbackName)
      if (result?.success && result.data?.relativePath) return toAttachment(result, fallbackName)
      // 导入失败：明确告知用户，不静默降级为 file://（那样的链接不能云同步）
      notifyError(`附件导入失败：${result?.error || '未知原因'}`)
      return null
    } catch (error) {
      notifyError(`附件导入失败：${error.message}`)
      return null
    }
  }, [])

  // 统一的文件导入：图片走图片目录并带缩略图，其他文件走附件目录
  const importFiles = useCallback(async (files = []) => {
    if (!files.length) return
    setImporting(true)
    try {
      for (const file of files) {
        const filePath = getDroppedFilePath(file)
        if (isImageFile(file)) {
          try {
            const fileName = file.name && file.name !== 'image.png' ? file.name : imageUploadName(file, 'clipboard')
            const imagePath = filePath
              ? await imageAPI.saveFromPath(filePath, fileName)
              : await imageAPI.saveFromBuffer(new Uint8Array(await file.arrayBuffer()), fileName)
            addAttachment({
              type: 'image',
              name: fileName,
              path: imagePath,
              markdown: `![${fileName}](${imagePath})`,
              previewUrl: URL.createObjectURL(file),
              ownsPreview: true,
            })
          } catch (error) {
            notifyError(`图片导入失败：${error.message}`)
          }
          continue
        }

        let imported = null
        if (filePath) {
          imported = await importLocalFileAsAttachment(filePath, file.name)
        } else {
          // 无本地路径（如从网页复制的文件），直接按内容保存
          try {
            const result = await window.electronAPI?.attachments?.saveFromBuffer?.(
              new Uint8Array(await file.arrayBuffer()),
              file.name || '附件'
            )
            if (!result?.success || !result.data?.relativePath) throw new Error(result?.error || '未知原因')
            imported = toAttachment(result, file.name)
          } catch (error) {
            notifyError(`附件导入失败：${error.message}`)
          }
        }
        if (imported) addAttachment({ type: 'file', ...imported })
      }
    } finally {
      setImporting(false)
    }
  }, [addAttachment, importLocalFileAsAttachment])

  useImperativeHandle(ref, () => ({
    importFiles,
    focus: () => inputRef.current?.focus(),
  }), [importFiles])

  const handleAttachFile = async () => {
    try {
      const result = await window.electronAPI?.system?.showOpenDialog?.({ properties: ['openFile', 'multiSelections'] })
      if (result?.canceled || !result?.filePaths?.length) return
      setImporting(true)
      try {
        for (const filePath of result.filePaths) {
          const fileName = filePath.split(/[\\/]/).pop() || '附件'
          if (IMAGE_EXT.test(fileName)) {
            try {
              const imagePath = await imageAPI.saveFromPath(filePath, fileName)
              // CSP 不允许 file://，缩略图走应用内图片解析
              const previewUrl = await getImageResolver().resolve(imagePath).catch(() => null)
              addAttachment({ type: 'image', name: fileName, path: imagePath, markdown: `![${fileName}](${imagePath})`, previewUrl: previewUrl || undefined })
              continue
            } catch (error) {
              console.warn('按图片导入失败，改为附件:', error)
            }
          }
          const imported = await importLocalFileAsAttachment(filePath, fileName)
          if (imported) addAttachment({ type: 'file', ...imported })
        }
      } finally {
        setImporting(false)
      }
    } catch (error) {
      notifyError(`选择附件失败：${error.message}`)
    }
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    await importFiles(Array.from(event.dataTransfer?.files || []))
  }

  const handlePaste = (event) => {
    const files = getClipboardFiles(event.clipboardData)
    if (!files.length) return
    // 有文件时拦截默认粘贴（否则会把文件名当文本粘进来）
    event.preventDefault()
    importFiles(files)
  }

  const canSubmit = Boolean(draft.trim() || attachments.length > 0) && !submitting && !importing

  const handleSubmit = async () => {
    if (!canSubmit) return
    const attachmentText = attachments.map(attachmentToMarkdown).filter(Boolean).join('\n')
    const content = [draft.trim(), attachmentText].filter(Boolean).join('\n\n').trim()
    const request = todoText ? { kind: 'todo', content: todoText } : content ? { kind: 'note', content } : null
    if (!request) return

    setSubmitting(true)
    try {
      await onSubmit(request)
      setDraft('')
      clearAttachments()
    } catch (error) {
      // 内容留在输入框里，用户可以直接重试
      notifyError(`没有记上：${error?.message || '未知原因'}。内容还在输入框里，可以重试`)
    } finally {
      setSubmitting(false)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const placeholder = dragActive
    ? '松开以添加文件'
    : importing
      ? '正在添加附件…'
      : '记点什么…「待办：」开头会建成待办，也可以拖入图片、文件'

  return (
    <Box ref={dockRef} sx={{ ...floatingComposerDockSx, px: { xs: 2, md: 5 }, maxWidth: 'none' }}>
      <Box
        sx={{
          ...floatingComposerSx(theme, { highlight: dragActive }),
          maxWidth: 920,
          mx: 'auto',
          display: 'flex',
          flexDirection: 'column',
          pl: 1,
          pr: 1.25,
          py: 1.25,
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          if (!dragActive) setDragActive(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false)
        }}
        onDrop={handleDrop}
      >
        <AttachmentQueue attachments={attachments} onRemove={removeAttachment} />
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.25, '& > span': { display: 'inline-flex' } }}>
          <Tooltip title="添加文件">
            <span>
              <IconButton size="small" aria-label="添加文件" disabled={submitting} onClick={handleAttachFile}
                sx={{ ...floatingComposerToolSx(theme), mb: '2px' }}>
                <AttachFile fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <AudioRecordButton
            disabled={submitting}
            onAudioInsert={(audioPath) => addAttachment({ type: 'audio', path: audioPath })}
            onTranscription={(text) => setDraft((prev) => appendDraftText(prev, text))}
            sx={{ ...floatingComposerToolSx(theme), mb: '2px' }}
          />
          <InputBase
            inputRef={inputRef}
            multiline
            maxRows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !isImeComposing(event)) {
                event.preventDefault()
                handleSubmit()
              }
            }}
            placeholder={placeholder}
            inputProps={{ 'aria-label': '新记录' }}
            sx={{
              flex: 1,
              minWidth: 0,
              px: 0.75,
              py: 0,
              fontSize: '0.9rem',
              lineHeight: 1.4375,
              color: 'text.primary',
              '& textarea': { py: '7.5px' },
              '& textarea::placeholder': { color: 'text.secondary', opacity: 0.9 },
            }}
          />
          {todoText && (
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0, height: 24, px: 0.9, mb: '6px', mr: 0.5,
              borderRadius: 1, fontSize: 12, fontWeight: 600, color: 'primary.main',
              bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08),
            }}>
              <TaskAlt sx={{ fontSize: 14 }} />
              待办
            </Box>
          )}
          <Tooltip title={todoText ? '添加待办' : '发送'}>
            <span>
              <IconButton
                disabled={!canSubmit}
                onClick={handleSubmit}
                aria-label={todoText ? '添加待办' : '发送'}
                sx={floatingComposerSendSx(theme, { active: canSubmit })}
              >
                <Send sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  )
})

TimelineComposer.displayName = 'TimelineComposer'

export default TimelineComposer
