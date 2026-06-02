import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme
} from '@mui/material'
import {
  AccessTime,
  AddTask,
  AttachFile,
  Brush,
  CheckCircle,
  ContentCopy,
  Close,
  DeleteOutline,
  Edit,
  Image,
  KeyboardVoice,
  LabelImportantOutline,
  Notes,
  OpenInNew,
  PushPin,
  PushPinOutlined,
  PriorityHigh,
  RadioButtonUnchecked,
  Send,
  Visibility
} from '@mui/icons-material'
import { useStore } from '../store/useStore'
import { createTodo, deleteTodo, fetchTodos, toggleTodoComplete, updateTodo } from '../api/todoAPI'
import ImagePreviewModal, { canvasToPngBlob } from './ImagePreviewModal'
import { getImageResolver } from '../utils/ImageProtocolResolver'
import { getLocalPathFromFileUrl } from '../utils/fileUrl'
import { toListResult } from '../utils/todoDisplayUtils'
import AudioRecordButton from './AudioRecordButton'
import MarkdownPreview from './MarkdownPreview'
import TodoEditDialog from './TodoEditDialog'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMELINE_TYPES = ['note', 'whiteboard', 'todo']
const TIMELINE_IMAGE_LIMIT = 4
const TIMELINE_AUDIO_LIMIT = 2
const TIMELINE_FILE_LIMIT = 2

const parseTimelineDate = (value) => {
  if (!value && value !== 0) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const text = String(value).trim()
  if (!text) return null

  // SQLite `CURRENT_TIMESTAMP` is UTC but omits the timezone suffix.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
    const utcDate = new Date(text.replace(' ', 'T') + 'Z')
    return Number.isNaN(utcDate.getTime()) ? null : utcDate
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
    const utcDate = new Date(`${text}Z`)
    return Number.isNaN(utcDate.getTime()) ? null : utcDate
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toTime = (value) => {
  const date = parseTimelineDate(value)
  return date ? date.getTime() : 0
}

const formatDay = (time) => {
  const date = parseTimelineDate(time)
  if (!date) return ''
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const delta = Math.round((dayStart - todayStart) / DAY_MS)

  if (delta === 0) return '今天'
  if (delta === -1) return '昨天'
  if (delta === 1) return '明天'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

const formatClock = (time) => {
  const date = parseTimelineDate(time)
  if (!date) return ''
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

const normalizeTimelineTypes = (types) => {
  if (!Array.isArray(types) || types.length === 0) return DEFAULT_TIMELINE_TYPES
  const raw = new Set(types)
  if (raw.has('note') && raw.has('todo') && raw.has('voice')) return DEFAULT_TIMELINE_TYPES

  const next = []
  if (raw.has('note') || raw.has('voice')) next.push('note')
  if (raw.has('whiteboard')) next.push('whiteboard')
  if (raw.has('todo')) next.push('todo')
  return next.length ? next : DEFAULT_TIMELINE_TYPES
}

const isDefaultTimelineTypes = (types) => {
  const normalized = normalizeTimelineTypes(types)
  return DEFAULT_TIMELINE_TYPES.every((type) => normalized.includes(type)) && normalized.length === DEFAULT_TIMELINE_TYPES.length
}

const getBadgesForDisplay = (item) => item?.badges || []

const AUDIO_EXT = /\.(m4a|mp3|wav|ogg|aac|opus|flac|webm)(?:\?|$)/i

const isAudioRef = (src) => {
  if (!src) return false
  if (src.startsWith('data:audio')) return true
  if (src.startsWith('audio/') || src.startsWith('app://audio/')) return true
  return AUDIO_EXT.test(src)
}

const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|bmp|svg|avif|ico)(?:\?|$)/i

// 应用内附件路径（attachments/xxx.ext 或 app://attachments/xxx.ext）
// 注意：图片本身可能也存在 attachments 目录中（图片语法），但我们用扩展名兜底区分
const isAttachmentFileRef = (src) => {
  if (!src) return false
  const isInAttachments = /^(?:attachments|app:\/\/attachments)\//.test(src)
  if (!isInAttachments) return false
  if (IMAGE_EXT.test(src)) return false
  if (isAudioRef(src)) return false
  return true
}

// 任何"应放进 attachments 目录"的文件路径
const isLocalFileLink = (src) => {
  if (!src) return false
  return src.startsWith('file://')
    || src.startsWith('app://')
    || /^(?:attachments|audio)\//.test(src)
}

const stripMarkdown = (content = '') => String(content)
  .replace(/!\[[^\]]*]\((audio\/[^)]+|app:\/\/audio\/[^)]+|[^)]+\.(?:m4a|mp3|wav|ogg|aac|opus|flac|webm))\)/gi, '[语音]')
  // 附件图片语法 ![name](attachments/...) → 附件占位（保留名称）
  .replace(/!\[([^\]]*)]\(([^)]+)\)/g, (full, label, url) => {
    if (isAttachmentFileRef(String(url || ''))) return `[附件] ${label || ''}`.trim()
    return ''
  })
  .replace(/\[([^\]]+)]\(([^)]+)\)/g, (_, label, url) => {
    const target = String(url || '')
    // 本机 file://、应用内 attachments/、app:// 协议附件 → 全部当作附件占位（兼容老链接语法）
    if (isLocalFileLink(target)) return `[附件] ${label}`
    return target
  })
  // 先吃掉完整 HTML 标签（必须在去掉 `>` 前完成）；编辑器富文本会以 <table>/<p> 等形式存为内容
  .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
  // 兜底：去除任何残留的孤立标签碎片，例如缺右尖括号的 `<table style="..."` 之类
  .replace(/<\/?[a-zA-Z][^<\n]*?(?=<|$)/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|#39);/g, ' ')
  .replace(/[#>*_`~]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const truncateText = (text = '', max = 220) => (
  text.length > max ? `${text.slice(0, max)}...` : text
)

const normalizeCompareText = (text = '') => String(text)
  .replace(/^\[(?:附件|语音|图片)\]\s*/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

const cleanMediaOnlyText = (text = '', { audios = [], images = [], files = [] } = {}) => {
  const raw = String(text || '').trim()
  if (!raw) return ''
  if (audios.length > 0 && raw === '[语音]') return ''
  if (images.length > 0 && raw === '[图片]') return ''
  if (files.length === 1 && raw === `[附件] ${files[0]?.label || ''}`.trim()) return ''
  if (files.length > 1 && raw.startsWith('[附件] ')) return ''
  return raw
}

const normalizeTitle = (rawTitle = '') => {
  const title = String(rawTitle || '').trim()
  if (!title || title === '无标题' || title === 'Untitled') return ''
  return title
}

const isGeneratedMediaTitle = (title = '', { audios = [], images = [], files = [] } = {}) => {
  if (!title) return false
  if (audios.length > 0 && ['语音记录', '语音笔记', '[语音]'].includes(title)) return true
  if (images.length > 0 && ['图片记录', '[图片]'].includes(title)) return true
  if (files.length > 0 && (title === '附件' || title.startsWith('[附件] ') || /^附件\s*\d*$/.test(title))) return true
  return false
}

const buildNoteTitle = ({ rawTitle, isWhiteboard, audios, images, files, contentText }) => {
  const title = normalizeTitle(rawTitle)
  if (title) {
    if (isGeneratedMediaTitle(title, { audios, images, files })) return ''
    return title
  }

  if (isWhiteboard) return '画布笔记'
  // 有正文内容但无显式标题：返回空字符串，渲染端会直接隐藏标题行
  if (contentText) return ''
  if (files.length > 0 || audios.length > 0 || images.length > 0) return ''
  return '无标题笔记'
}

const buildNotePreview = ({ note, isWhiteboard, whiteboardSummary, audios, images, files }) => {
  if (isWhiteboard) {
    return {
      title: normalizeTitle(note.title) || '画布笔记',
      body: whiteboardSummary.body || '画布内容',
      fullBody: whiteboardSummary.fullBody || '画布内容'
    }
  }

  const plain = cleanMediaOnlyText(stripMarkdown(note.content), { audios, images, files })
  const title = buildNoteTitle({
    rawTitle: note.title,
    isWhiteboard,
    audios,
    images,
    files,
    contentText: plain
  })
  let bodySource = plain
  if (title && !normalizeTitle(note.title) && plain) {
    const normalizedPlain = normalizeCompareText(plain)
    const normalizedTitle = normalizeCompareText(title)
    if (normalizedPlain.startsWith(normalizedTitle) && normalizedPlain !== normalizedTitle) {
      bodySource = plain.slice(title.length).trim().replace(/^[，。、,:：;；\- ]+/, '').trim()
    }
  }
  const deduped = title && normalizeCompareText(bodySource) === normalizeCompareText(title) ? '' : bodySource

  return {
    title,
    body: truncateText(deduped, 220),
    fullBody: deduped
  }
}

const extractImages = (content = '') => {
  const images = []
  const pattern = /!\[[^\]]*]\(([^)]+)\)/g
  let match
  while ((match = pattern.exec(String(content)))) {
    const src = match[1]?.trim()
    if (!src) continue
    if (isAudioRef(src)) continue
    if (isAttachmentFileRef(src)) continue
    // 跳过超长 data URL：时间轴卡片不展示内联 base64 图片，避免触发 ERR_INVALID_URL
    if (src.startsWith('data:')) continue
    images.push(src)
  }
  return images
}

const extractAudios = (content = '') => {
  const audios = []
  const pattern = /!\[[^\]]*]\(([^)]+)\)/g
  let match
  while ((match = pattern.exec(String(content)))) {
    const src = match[1]?.trim()
    if (src && isAudioRef(src)) {
      audios.push(src)
    }
  }
  return audios
}

const extractFiles = (content = '') => {
  const files = []
  // 1) 新版：图片语法 ![name](attachments/xxx.ext) —— 仅当扩展名非图片/非音频
  const imgPattern = /!\[([^\]]*)]\(([^)]+)\)/g
  let m
  while ((m = imgPattern.exec(String(content)))) {
    const label = m[1]
    const target = m[2]?.trim()
    if (!target) continue
    if (isAttachmentFileRef(target)) {
      files.push({ label: label || target.split('/').pop(), url: target })
    }
  }
  // 2) 老版兼容：链接语法 [name](attachments/...) / file:// / app://
  const linkPattern = /(^|[^!])\[([^\]]+)]\(([^)]+)\)/g
  while ((m = linkPattern.exec(String(content)))) {
    const label = m[2]
    const target = m[3]?.trim()
    if (!target) continue
    if (isLocalFileLink(target)) {
      files.push({ label, url: target })
    }
  }
  return files
}

const summarizeWhiteboard = (content = '') => {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content
    const elements = Array.isArray(parsed?.elements)
      ? parsed.elements.filter((item) => item && !item.isDeleted)
      : []
    const files = parsed?.files || parsed?.fileMap || {}

    const textSnippets = elements
      .map((item) => stripMarkdown(String(item?.text || '')).trim())
      .filter(Boolean)
      .slice(0, 3)

    const imageCount = elements.filter((item) => item?.type === 'image').length || Object.keys(files).length
    const textCount = elements.filter((item) => ['text', 'freedraw', 'arrow', 'line'].includes(item?.type) && String(item?.text || '').trim()).length
    const shapeCount = elements.filter((item) => !['text', 'image'].includes(item?.type)).length

    const stats = [
      elements.length > 0 ? `${elements.length} 个元素` : null,
      textCount > 0 ? `${textCount} 段文字` : null,
      imageCount > 0 ? `${imageCount} 张图片` : null,
      shapeCount > 0 ? `${shapeCount} 个图形` : null
    ].filter(Boolean)

    return {
      body: textSnippets.join(' / ') || stats.join('，') || '画布内容',
      fullBody: stats.join('，') || textSnippets.join('\n') || '画布内容',
      images: [],
      audios: [],
      files: []
    }
  } catch {
    return {
      body: '画布内容',
      fullBody: '画布内容',
      images: [],
      audios: [],
      files: []
    }
  }
}

const isTodoDone = (todo) => Boolean(todo?.completed || todo?.is_completed)

const getTodoTime = (todo) =>
  toTime(todo.completed_at || todo.completedAt) ||
  toTime(todo.due_date || todo.dueDate) ||
  toTime(todo.updated_at || todo.updatedAt) ||
  toTime(todo.created_at || todo.createdAt) ||
  Date.now()

const buildTimelineItems = (notes, todos) => {
  const noteItems = (notes || [])
    .filter((note) => !note.is_deleted)
    .map((note) => {
      const time = toTime(note.updated_at || note.updatedAt || note.created_at || note.createdAt) || Date.now()
      const isWhiteboard = note.note_type === 'whiteboard'
      const whiteboardSummary = isWhiteboard ? summarizeWhiteboard(note.content) : null
      const audios = extractAudios(note.content)
      const images = isWhiteboard ? whiteboardSummary.images : extractImages(note.content)
      const files = isWhiteboard ? whiteboardSummary.files : extractFiles(note.content)
      const isVoice = !isWhiteboard && audios.length > 0
      const notePreview = buildNotePreview({
        note,
        isWhiteboard,
        whiteboardSummary,
        audios,
        images,
        files
      })
      return {
        id: `note-${note.id}`,
        rawId: note.id,
        type: isWhiteboard ? 'whiteboard' : 'note',
        noteKind: isWhiteboard ? 'whiteboard' : 'note',
        badges: [
          isVoice ? '语音' : null,
          images.length > 0 ? '图片' : null,
          files.length > 0 ? '附件' : null
        ].filter(Boolean),
        title: notePreview.title,
        body: notePreview.body,
        fullBody: notePreview.fullBody,
        images,
        audios: isWhiteboard ? whiteboardSummary.audios : audios,
        files,
        whiteboardPreviewUrl: isWhiteboard ? getWhiteboardPreviewUrl(note, time) : '',
        time,
        tags: Array.isArray(note.tags) ? note.tags : [],
        pinned: Boolean(note.is_pinned),
        raw: note
      }
    })

  const todoItems = (todos || []).map((todo) => {
    const time = getTodoTime(todo)
    return {
      id: `todo-${todo.id}`,
      rawId: todo.id,
      type: 'todo',
      title: todo.content || todo.title || '未命名待办',
      body: todo.description || '',
      fullBody: todo.description || '',
      images: [],
      audios: [],
      files: [],
      badges: [],
      time,
      tags: typeof todo.tags === 'string'
        ? todo.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [],
      dueDate: todo.due_date,
      done: isTodoDone(todo),
      important: Boolean(todo.is_important),
      urgent: Boolean(todo.is_urgent),
      raw: todo
    }
  })

  return [...noteItems, ...todoItems].sort((a, b) => a.time - b.time)
}

const groupItemsByDay = (items) => {
  const groups = []
  items.forEach((item) => {
    const key = new Date(item.time).toDateString()
    const last = groups[groups.length - 1]
    if (!last || last.key !== key) {
      groups.push({ key, label: formatDay(item.time), items: [item] })
    } else {
      last.items.push(item)
    }
  })
  return groups
}

const inDateRange = (time, range) => {
  if (range === 'all') return true
  const now = Date.now()
  if (range === 'today') {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    return time >= startOfDay.getTime() && time <= now + DAY_MS
  }
  if (range === 'week') {
    return time >= now - 7 * DAY_MS
  }
  if (range === 'month') {
    return time >= now - 30 * DAY_MS
  }
  return true
}

const appendDraftText = (current, text) => {
  if (!text) return current
  const base = current || ''
  if (!base.trim()) return text.trimStart()
  return `${base}${base.endsWith('\n') ? '' : '\n'}${text.trimStart()}`
}

const attachmentToMarkdown = (item) => {
  if (item.type === 'image') return item.markdown
  if (item.type === 'audio') return `![录音](${item.path})`
  if (item.type === 'file') return `![${item.name}](${item.path})`
  return ''
}

const getDroppedFilePath = (file) => {
  try {
    return window.electronAPI?.system?.getPathForFile?.(file) || file?.path || file?.webkitRelativePath || ''
  } catch {
    return file?.path || file?.webkitRelativePath || ''
  }
}

const getFileUrl = (filePath) => filePath.startsWith('file://') ? filePath : `file://${filePath}`

const getWhiteboardPreviewUrl = (note, fallbackTime) => {
  const syncId = note?.sync_id || note?.id
  if (!syncId) return ''
  const stamp = encodeURIComponent(String(note?.updated_at || note?.updatedAt || fallbackTime || Date.now()))
  return `app://images/whiteboard-preview/${syncId}.png?t=${stamp}`
}

const normalizeTodoInput = (content) => {
  const text = content.trim()
  const match = text.match(/^(?:todo|待办|事项)\s*[:：]\s*(.+)$/i) || text.match(/^-\s*\[\s*]\s+(.+)$/)
  return match?.[1]?.trim() || null
}

const TimelineView = ({ onTodoUpdated }) => {
  const theme = useTheme()
  const notes = useStore((state) => state.notes)
  const loadNotes = useStore((state) => state.loadNotes)
  const createNote = useStore((state) => state.createNote)
  const deleteNote = useStore((state) => state.deleteNote)
  const setCurrentView = useStore((state) => state.setCurrentView)
  const setSelectedNoteId = useStore((state) => state.setSelectedNoteId)
  const togglePinNote = useStore((state) => state.togglePinNote)
  const timelineFilter = useStore((state) => state.timelineFilter)
  const resetTimelineFilter = useStore((state) => state.resetTimelineFilter)
  const [todos, setTodos] = useState([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [editingTodo, setEditingTodo] = useState(null)
  const [failedWhiteboardPreviews, setFailedWhiteboardPreviews] = useState({})
  const [detailPopover, setDetailPopover] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [resolvedImages, setResolvedImages] = useState({})
  const [resolvedAudios, setResolvedAudios] = useState({})
  const scrollRef = useRef(null)
  const clickTimerRef = useRef(null)

  const getDisplayImageSrc = useCallback((src) => {
    if (!src) return null
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('file://')) {
      return src
    }
    return resolvedImages[src] || null
  }, [resolvedImages])

  const refreshTodos = useCallback(async () => {
    try {
      const result = await fetchTodos({ includeCompleted: true, limit: 300 })
      setTodos(toListResult(result))
    } catch (error) {
      console.error('加载时间轴待办失败:', error)
    }
  }, [])

  useEffect(() => {
    loadNotes?.()
    refreshTodos()
  }, [loadNotes, refreshTodos])

  const allItems = useMemo(() => buildTimelineItems(notes, todos), [notes, todos])

  const timelineItems = useMemo(() => {
    const search = (timelineFilter?.search || '').trim().toLowerCase()
    const types = normalizeTimelineTypes(timelineFilter?.types)
    const tags = timelineFilter?.tags || []
    const dateRange = timelineFilter?.dateRange || 'all'
    const showCompleted = timelineFilter?.showCompleted !== false
    const showFuture = timelineFilter?.showFuture === true
    const quickMode = timelineFilter?.quickMode || 'all'
    const now = Date.now()

    return allItems.filter((item) => {
      if (!types.includes(item.type)) return false
      if (item.type === 'todo' && !showCompleted && item.done) return false
      if (!showFuture && item.time > now) return false
      if (!inDateRange(item.time, dateRange)) return false
      if (tags.length > 0 && !tags.some((tag) => item.tags?.includes(tag))) return false
      if (quickMode === 'open' && (item.type !== 'todo' || item.done)) return false
      if (quickMode === 'media' && !item.images?.length && !item.audios?.length && !item.files?.length) return false
      if (quickMode === 'inbox' && (item.tags || []).some((tag) => tag !== '时间轴')) return false
      if (search) {
        const haystack = `${item.title}\n${item.fullBody || item.body}\n${item.badges?.join(' ') || ''}\n${item.tags?.join(' ') || ''}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [allItems, timelineFilter])

  const filterActive = Boolean(
    (timelineFilter?.search || '').trim() ||
    (timelineFilter?.tags || []).length > 0 ||
    (timelineFilter?.dateRange || 'all') !== 'all' ||
    !isDefaultTimelineTypes(timelineFilter?.types) ||
    timelineFilter?.showCompleted === false ||
    timelineFilter?.showFuture === true ||
    (timelineFilter?.quickMode || 'all') !== 'all'
  )

  const groupedItems = useMemo(() => groupItemsByDay(timelineItems), [timelineItems])

  const timelineImageSources = useMemo(() => {
    const sources = new Set()
    timelineItems.forEach((item) => {
      item.images?.forEach((src) => sources.add(src))
    })
    return [...sources]
  }, [timelineItems])

  const timelineAudioSources = useMemo(() => {
    const sources = new Set()
    timelineItems.forEach((item) => {
      item.audios?.forEach((src) => sources.add(src))
    })
    return [...sources]
  }, [timelineItems])

  useEffect(() => {
    if (timelineImageSources.length === 0) return
    let cancelled = false
    const resolver = getImageResolver()
    Promise.allSettled(
      timelineImageSources.map(async (src) => [src, await resolver.resolve(src)])
    ).then((results) => {
      if (cancelled) return
      const next = {}
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const [src, resolved] = result.value
          next[src] = resolved || src
        }
      })
      setResolvedImages((prev) => ({ ...prev, ...next }))
    })
    return () => {
      cancelled = true
    }
  }, [timelineImageSources])

  useEffect(() => {
    if (timelineAudioSources.length === 0) return
    let cancelled = false
    const pendingSources = timelineAudioSources.filter((src) => !resolvedAudios[src])
    if (pendingSources.length === 0) return

    Promise.allSettled(
      pendingSources.map(async (src) => {
        if (/^(https?:|file:|data:audio)/i.test(src)) {
          return [src, { url: src, missing: false }]
        }

        const result = await window.electronAPI?.audio?.resolveSource?.(src)
        if (result?.success && result.data) {
          return [src, { url: result.data, missing: false }]
        }
        return [src, { url: '', missing: true }]
      })
    ).then((results) => {
      if (cancelled) return
      const next = {}
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const [src, resolved] = result.value
          next[src] = resolved
        }
      })
      if (Object.keys(next).length > 0) {
        setResolvedAudios((prev) => ({ ...prev, ...next }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [timelineAudioSources, resolvedAudios])

  useEffect(() => () => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current)
    }
  }, [])

  const scrollToLatest = useCallback((behavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    if (groupedItems.length === 0) return
    const frame = window.requestAnimationFrame(() => scrollToLatest('auto'))
    return () => window.cancelAnimationFrame(frame)
  }, [groupedItems.length, scrollToLatest])

  useEffect(() => {
    const handleScrollLatest = () => scrollToLatest('smooth')
    window.addEventListener('timeline:scroll-latest', handleScrollLatest)
    return () => window.removeEventListener('timeline:scroll-latest', handleScrollLatest)
  }, [scrollToLatest])

  const handleOpenItem = (item) => {
    if (item.type === 'todo') {
      setCurrentView('todo')
    } else {
      setSelectedNoteId(item.rawId)
      setCurrentView('notes')
    }
  }

  const openDetailPopover = useCallback((anchorEl, item) => {
    if (!anchorEl || !item) return
    setDetailPopover({ anchorEl, item })
    setDetailOpen(true)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailOpen(false)
  }, [])

  const handleShowDetail = (event, item) => {
    const anchorEl = event.currentTarget
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current)
    }
    clickTimerRef.current = window.setTimeout(() => {
      openDetailPopover(anchorEl, item)
      clickTimerRef.current = null
    }, 200)
  }

  const handleDoubleClickItem = (item) => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    closeDetail()
    handleOpenItem(item)
  }

  const handleToggleTodo = async (item) => {
    if (item.type !== 'todo') return
    try {
      await toggleTodoComplete(item.rawId)
      await refreshTodos()
      onTodoUpdated?.()
    } catch (error) {
      console.error('切换待办状态失败:', error)
    }
  }

  const handleOpenContextMenu = (event, item) => {
    event.preventDefault()
    event.stopPropagation()
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    closeDetail()
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      anchorEl: event.currentTarget,
      item
    })
  }

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const copyImageToClipboard = useCallback(async (src) => {
    if (!src) return false
    const displaySrc = resolvedImages[src] || src

    try {
      const response = await fetch(displaySrc)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
      return true
    } catch {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.src = displaySrc
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      const blob = await canvasToPngBlob(canvas)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return true
    }
  }, [resolvedImages])

  const copyTimelineItem = useCallback(async (item) => {
    const text = [item?.title, item?.fullBody || item?.body]
      .filter(Boolean)
      .join('\n\n')
      .trim()
    try {
      if (!text && item?.images?.length > 0) {
        await copyImageToClipboard(item.images[0])
        return
      }
      if (!text) return
      if (window.electronAPI?.system?.writeText) {
        await window.electronAPI.system.writeText(text)
      } else {
        await navigator.clipboard?.writeText(text)
      }
    } catch (error) {
      console.error('复制时间轴内容失败:', error)
    }
  }, [copyImageToClipboard])

  const handleDeleteTimelineItem = useCallback(async (item) => {
    if (!item) return
    const itemLabel = item.title || (item.body ? truncateText(item.body, 18) : '此记录')
    const confirmed = window.confirm(
      item.type === 'todo'
        ? `删除待办“${itemLabel}”？`
        : `删除记录“${itemLabel}”？`
    )
    if (!confirmed) return
    try {
      if (item.type === 'todo') {
        await deleteTodo(item.rawId)
        await refreshTodos()
        onTodoUpdated?.()
      } else {
        await deleteNote(item.rawId)
      }
    } catch (error) {
      console.error('删除时间轴记录失败:', error)
    }
  }, [deleteNote, onTodoUpdated, refreshTodos])

  const handleToggleTodoFlag = useCallback(async (item, field) => {
    if (item?.type !== 'todo') return
    const nextValue = field === 'is_important' ? !item.important : !item.urgent
    try {
      await updateTodo(item.rawId, { [field]: nextValue ? 1 : 0 })
      await refreshTodos()
      onTodoUpdated?.()
    } catch (error) {
      console.error('更新待办标记失败:', error)
    }
  }, [onTodoUpdated, refreshTodos])

  const handleToggleTimelinePin = useCallback(async (item) => {
    if (!item || item.type === 'todo') return
    try {
      await togglePinNote(item.rawId)
    } catch (error) {
      console.error('切换时间轴置顶失败:', error)
    }
  }, [togglePinNote])

  const handleEditTodoFromTimeline = useCallback((item) => {
    if (item?.type !== 'todo' || !item.raw) return
    setEditingTodo(item.raw)
  }, [])

  const handleTodoDialogUpdated = useCallback(async () => {
    setEditingTodo(null)
    await refreshTodos()
    onTodoUpdated?.()
  }, [onTodoUpdated, refreshTodos])

  const handleSubmit = async () => {
    const body = draft.trim()
    const attachmentText = attachments.map(attachmentToMarkdown).filter(Boolean).join('\n')
    const content = [body, attachmentText].filter(Boolean).join('\n\n').trim()
    if (!content || submitting) return
    const todoContent = attachments.length === 0 ? normalizeTodoInput(content) : null
    setSubmitting(true)
    try {
      if (todoContent) {
        await createTodo({ content: todoContent, tags: '时间轴' })
        await refreshTodos()
        onTodoUpdated?.()
      } else {
        await createNote({
          title: '',
          content,
          tags: ['时间轴']
        })
      }
      setDraft('')
      setAttachments([])
    } catch (error) {
      console.error('创建时间轴记录失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const addAttachment = (item) => {
    setAttachments((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...item }])
  }

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  const handleWhiteboardPreviewError = useCallback((itemId) => {
    if (!itemId) return
    setFailedWhiteboardPreviews((prev) => prev[itemId] ? prev : { ...prev, [itemId]: true })
  }, [])

  const importLocalFileAsAttachment = useCallback(async (filePath, fallbackName) => {
    if (!filePath) return null
    try {
      const result = await window.electronAPI?.attachments?.saveFromPath?.(filePath, fallbackName)
      if (result?.success && result.data?.relativePath) {
        return {
          name: result.data.displayName || fallbackName || '附件',
          path: result.data.relativePath,
          url: `app://${result.data.relativePath}`,
        }
      }
      // 导入失败：明确告知用户，不再静默降级为 file://（避免变成不能云同步的本机链接）
      const errMsg = result?.error || '未知原因'
      console.warn('导入附件失败:', errMsg)
      try { window.alert(`附件导入失败：${errMsg}`) } catch {}
      return null
    } catch (error) {
      console.error('导入附件异常:', error)
      try { window.alert(`附件导入失败：${error.message}`) } catch {}
      return null
    }
  }, [])

  const handleAttachFile = async () => {
    try {
      const result = await window.electronAPI?.system?.showOpenDialog?.({
        properties: ['openFile']
      })
      if (result?.canceled || !result?.filePaths?.[0]) return

      const filePath = result.filePaths[0]
      const fileName = filePath.split(/[\\/]/).pop() || '附件'
      const imported = await importLocalFileAsAttachment(filePath, fileName)
      if (imported) {
        addAttachment({ type: 'file', ...imported })
      }
    } catch (error) {
      console.error('选择时间轴附件失败:', error)
    }
  }

  const handleDropFiles = async (event) => {
    event.preventDefault()
    event.stopPropagation()

    const droppedFiles = Array.from(event.dataTransfer?.files || [])
    for (const file of droppedFiles) {
      const filePath = getDroppedFilePath(file)
      if (!filePath) continue
      const imported = await importLocalFileAsAttachment(filePath, file.name)
      if (imported) {
        addAttachment({ type: 'file', ...imported })
      }
    }
  }

  const openTimelineFile = async (event, fileUrl) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      if (!fileUrl) return
      if (fileUrl.startsWith('file://')) {
        await window.electronAPI?.system?.openPath?.(getLocalPathFromFileUrl(fileUrl))
      } else if (/^(?:attachments|audio|images)\//.test(fileUrl) || fileUrl.startsWith('app://')) {
        // 应用内附件：用专用 IPC（system.openExternal 仅支持 http/https）
        const cleaned = fileUrl.replace(/^app:\/\//, '')
        const result = await window.electronAPI?.attachments?.open?.(cleaned)
        if (result && result.success === false) {
          window.alert(`打开失败：${result.error || '未知原因'}`)
        }
      } else {
        await window.electronAPI?.system?.openExternal?.(fileUrl)
      }
    } catch (error) {
      console.error('打开时间轴附件失败:', error)
    }
  }

  const renderAttachmentQueue = () => {
    if (!attachments.length) return null

    return (
      <Stack direction="row" spacing={0.75} sx={{ mb: 1, overflowX: 'auto', pb: 0.25 }}>
        {attachments.map((item) => (
          <Chip
            key={item.id}
            size="small"
            label={
              item.type === 'image' ? item.name || '图片'
              : item.type === 'audio' ? '语音'
              : item.name || '文件'
            }
            color={item.type === 'audio' ? 'success' : item.type === 'file' ? 'default' : 'primary'}
            variant="outlined"
            onDelete={() => removeAttachment(item.id)}
            deleteIcon={<Close fontSize="small" />}
            sx={{
              height: 30,
              borderRadius: '999px',
              flexShrink: 0,
              maxWidth: 200,
              px: 0.35,
              color: 'text.primary',
              backgroundColor: theme.palette.mode === 'dark'
                ? alpha('#0f172a', 0.34)
                : alpha('#ffffff', 0.54),
              borderColor: theme.palette.mode === 'dark'
                ? alpha('#e2e8f0', 0.12)
                : alpha('#ffffff', 0.75),
              backdropFilter: 'blur(14px) saturate(150%)',
              WebkitBackdropFilter: 'blur(14px) saturate(150%)',
              boxShadow: theme.palette.mode === 'dark'
                ? 'inset 0 1px 0 rgba(255,255,255,0.05)'
                : 'inset 0 1px 0 rgba(255,255,255,0.68), 0 8px 24px rgba(15,23,42,0.06)',
              '& .MuiChip-label': {
                px: 1,
                fontSize: 12
              },
              '& .MuiChip-deleteIcon': {
                color: 'text.secondary'
              }
            }}
          />
        ))}
      </Stack>
    )
  }

  const glassPanel = {
    background: theme.palette.mode === 'dark'
      ? 'rgba(15, 23, 42, 0.64)'
      : 'rgba(255, 255, 255, 0.74)',
    border: '1px solid',
    borderColor: theme.palette.mode === 'dark'
      ? 'rgba(148, 163, 184, 0.16)'
      : 'rgba(15, 23, 42, 0.08)',
    backdropFilter: 'blur(18px) saturate(160%)',
    WebkitBackdropFilter: 'blur(18px) saturate(160%)'
  }

  const glassCard = {
    backgroundColor: theme.palette.mode === 'dark'
      ? alpha(theme.palette.background.paper, 0.44)
      : alpha(theme.palette.background.paper, 0.34),
    backgroundImage: theme.palette.mode === 'dark'
      ? `linear-gradient(135deg, ${alpha('#ffffff', 0.07)}, ${alpha('#ffffff', 0.02)} 48%, ${alpha(theme.palette.primary.main, 0.06)})`
      : `linear-gradient(135deg, ${alpha('#ffffff', 0.58)}, ${alpha('#ffffff', 0.2)} 48%, ${alpha(theme.palette.primary.main, 0.04)})`,
    border: `1px solid ${theme.palette.mode === 'dark' ? alpha('#ffffff', 0.06) : alpha('#ffffff', 0.32)}`,
    backdropFilter: 'blur(34px) saturate(190%)',
    WebkitBackdropFilter: 'blur(34px) saturate(190%)',
    boxShadow: theme.palette.mode === 'dark'
      ? '0 12px 36px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)'
      : '0 12px 30px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.46)'
  }

  const composerActionButtonSx = {
    width: 36,
    height: 36,
    color: 'text.secondary',
    borderRadius: '12px',
    backgroundColor: theme.palette.mode === 'dark'
      ? alpha('#0f172a', 0.24)
      : alpha('#ffffff', 0.38),
    border: '1px solid',
    borderColor: theme.palette.mode === 'dark'
      ? alpha('#e2e8f0', 0.08)
      : alpha('#ffffff', 0.58),
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    transition: 'all 160ms ease',
    '&:hover': {
      color: 'text.primary',
      backgroundColor: theme.palette.mode === 'dark'
        ? alpha('#1e293b', 0.4)
        : alpha('#ffffff', 0.56),
      transform: 'translateY(-1px)'
    }
  }

  const canSubmit = Boolean(draft.trim() || attachments.length > 0) && !submitting

  const renderAudioPlayers = (audios = [], sx = {}) => {
    if (!audios.length) return null

    return (
      <Stack spacing={0.75} sx={sx}>
        {audios.map((src, index) => {
          const resolved = resolvedAudios[src]
          const itemKey = `${src}-${index}`

          if (resolved?.missing) {
            return (
              <Box
                key={itemKey}
                onClick={(event) => event.stopPropagation()}
                sx={{
                  px: 1.25,
                  py: 0.9,
                  borderRadius: '12px',
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                  fontSize: 13
                }}
              >
                录音文件缺失
              </Box>
            )
          }

          if (!resolved?.url) {
            return (
              <Typography key={itemKey} sx={{ fontSize: 13, color: 'text.secondary' }}>
                录音加载中...
              </Typography>
            )
          }

          return (
            <Box
              key={itemKey}
              onClick={(event) => event.stopPropagation()}
              sx={{
                width: 'min(460px, 100%)',
                '& .markdown-preview-content': {
                  height: 'auto',
                  overflow: 'visible',
                  p: 0,
                  fontFamily: 'inherit'
                }
              }}
            >
              <MarkdownPreview
                content={`![录音](${resolved.url})`}
                showAudioTranscription={false}
                sx={{ height: 'auto', overflow: 'visible', p: 0 }}
              />
            </Box>
          )
        })}
      </Stack>
    )
  }

  const renderAiBubble = (message) => (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1.25 }}>
      <Box
        sx={{
          maxWidth: 'min(560px, 70%)',
          px: 1.5,
          py: 1.1,
          borderRadius: '16px 16px 16px 6px',
          color: 'text.primary',
          ...glassCard
        }}
      >
        <Typography sx={{ fontSize: 13, lineHeight: 1.65, color: 'text.secondary' }}>{message.text}</Typography>
      </Box>
    </Box>
  )

  const renderBubble = (item) => {
    if (item.type === 'ai') return renderAiBubble(item)

    const isTodo = item.type === 'todo'
    const showWhiteboardPreview = item.noteKind === 'whiteboard' && item.whiteboardPreviewUrl && !failedWhiteboardPreviews[item.id]
    const timelineAudios = item.audios?.slice(0, TIMELINE_AUDIO_LIMIT) || []
    const timelineFiles = item.files?.slice(0, TIMELINE_FILE_LIMIT) || []
    const timelineImages = item.images?.slice(0, TIMELINE_IMAGE_LIMIT) || []
    const hiddenAudioCount = Math.max((item.audios?.length || 0) - timelineAudios.length, 0)
    const hiddenFileCount = Math.max((item.files?.length || 0) - timelineFiles.length, 0)
    const hiddenImageCount = Math.max((item.images?.length || 0) - timelineImages.length, 0)

    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          mb: 1.25
        }}
      >
        <Box
          onClick={(event) => handleShowDetail(event, item)}
          onDoubleClick={() => handleDoubleClickItem(item)}
          onContextMenu={(event) => handleOpenContextMenu(event, item)}
          sx={{
            maxWidth: 'min(660px, 74%)',
            display: 'flex',
            flexDirection: 'row-reverse',
            alignItems: 'flex-end',
            gap: 1
          }}
        >
          <Box
            sx={{
              px: 1.5,
              py: 1.1,
              minWidth: 0,
              borderRadius: '16px 16px 6px 16px',
              color: 'text.primary',
              ...glassCard,
              cursor: 'pointer'
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: item.title && (item.body || item.audios?.length) ? 0.35 : 0, display: (isTodo || item.title) ? 'flex' : 'none' }}>
              {isTodo && (
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleToggleTodo(item)
                  }}
                  sx={{ p: 0.2, color: item.done ? 'success.main' : 'text.secondary' }}
                >
                  {item.done ? <CheckCircle fontSize="small" /> : <RadioButtonUnchecked fontSize="small" />}
                </IconButton>
              )}
              {item.title && (
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 650,
                    lineHeight: 1.5,
                    textDecoration: item.done ? 'line-through' : 'none',
                    opacity: item.done ? 0.62 : 1,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word'
                  }}
                >
                  {item.title}
                </Typography>
              )}
            </Stack>
            {item.body && (
              <Typography
                sx={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'text.secondary',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word'
                }}
              >
                {item.body}
              </Typography>
            )}
            {showWhiteboardPreview && (
              <Box
                sx={{
                  mt: item.body ? 0.9 : 0.35,
                  width: 'min(320px, 100%)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  border: theme.palette.mode === 'dark'
                    ? '1px solid rgba(148,163,184,0.16)'
                    : '1px solid rgba(15,23,42,0.08)',
                  bgcolor: theme.palette.mode === 'dark'
                    ? 'rgba(15,23,42,0.2)'
                    : 'rgba(255,255,255,0.56)',
                  boxShadow: theme.palette.mode === 'dark'
                    ? 'inset 0 1px 0 rgba(255,255,255,0.04)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.72)'
                }}
              >
                <Box
                  component="img"
                  src={item.whiteboardPreviewUrl}
                  alt="画布缩略预览"
                  onError={() => handleWhiteboardPreviewError(item.id)}
                  sx={{
                    width: '100%',
                    height: 164,
                    objectFit: 'cover',
                    display: 'block',
                    bgcolor: theme.palette.mode === 'dark'
                      ? 'rgba(15,23,42,0.36)'
                      : 'rgba(241,245,249,0.9)'
                  }}
                />
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  sx={{
                    px: 1,
                    py: 0.55,
                    bgcolor: theme.palette.mode === 'dark'
                      ? 'rgba(2,6,23,0.18)'
                      : 'rgba(255,255,255,0.62)'
                  }}
                >
                  <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: 'text.primary' }}>
                    画布预览
                  </Typography>
                </Stack>
              </Box>
            )}
            {renderAudioPlayers(timelineAudios, { mt: 0.75 })}
            {hiddenAudioCount > 0 && (
              <Typography sx={{ mt: 0.45, fontSize: 12, color: 'text.secondary' }}>
                还有 {hiddenAudioCount} 段录音
              </Typography>
            )}
            {timelineFiles.length > 0 && (
              <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                {timelineFiles.map((file, index) => (
                  <Chip
                    key={`${file.url}-${index}`}
                    icon={<AttachFile fontSize="small" />}
                    label={file.label}
                    size="small"
                    variant="outlined"
                    component="a"
                    href={file.url}
                    clickable
                    onClick={(event) => openTimelineFile(event, file.url)}
                    sx={{ alignSelf: 'flex-start', borderRadius: '9px', maxWidth: 240 }}
                  />
                ))}
              </Stack>
            )}
            {hiddenFileCount > 0 && (
              <Typography sx={{ mt: 0.45, fontSize: 12, color: 'text.secondary' }}>
                还有 {hiddenFileCount} 个附件
              </Typography>
            )}
            {timelineImages.length > 0 && (
              <Box
                sx={{
                  mt: 1,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(timelineImages.length, 2)}, minmax(88px, 1fr))`,
                  gap: 0.75,
                  maxWidth: 260
                }}
              >
                {timelineImages.map((src, index) => {
                  const displaySrc = getDisplayImageSrc(src)
                  if (!displaySrc) return null
                  return (
                    <Box
                      key={`${src}-${index}`}
                      component="img"
                      src={displaySrc}
                      alt="时间轴图片预览"
                      onClick={(event) => {
                        event.stopPropagation()
                        setPreviewImage(displaySrc)
                      }}
                      sx={{
                        width: '100%',
                        height: 92,
                        objectFit: 'cover',
                        borderRadius: '10px',
                        border: theme.palette.mode === 'dark' ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)',
                        bgcolor: theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.03)',
                        cursor: 'zoom-in'
                      }}
                    />
                  )
                })}
              </Box>
            )}
            {hiddenImageCount > 0 && (
              <Typography sx={{ mt: 0.5, fontSize: 12, color: 'text.secondary' }}>
                还有 {hiddenImageCount} 张图片
              </Typography>
            )}
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.8, color: 'text.secondary', opacity: 0.78 }}>
              <Typography sx={{ fontSize: 11 }}>{formatClock(item.time)}</Typography>
              {item.pinned && <Typography sx={{ fontSize: 11 }}>置顶</Typography>}
              {item.tags?.slice(0, 2).map((tag) => (
                <Typography key={tag} sx={{ fontSize: 11 }}>#{tag}</Typography>
              ))}
            </Stack>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={handleDropFiles}
    >
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          px: { xs: 2, md: 5 },
          py: 3,
          overflow: 'auto'
        }}
      >
        {groupedItems.length === 0 ? (
          <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
            <Stack alignItems="center" spacing={1.25}>
              <AccessTime sx={{ fontSize: 36, opacity: 0.35 }} />
              <Typography sx={{ fontWeight: 600 }}>没有匹配的时间轴记录</Typography>
              <Typography sx={{ fontSize: 13 }}>
                {filterActive ? '清空筛选后可以查看完整时间轴。' : '从底部输入一句话，开始记录这一刻。'}
              </Typography>
              {filterActive && (
                <Button size="small" variant="outlined" onClick={resetTimelineFilter} sx={{ borderRadius: '10px' }}>
                  清空筛选
                </Button>
              )}
            </Stack>
          </Box>
        ) : groupedItems.map((group) => (
          <Box key={group.key} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Chip
                label={group.label}
                size="small"
                sx={{
                  height: 24,
                  borderRadius: '8px',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.06)',
                  color: 'text.secondary',
                  fontSize: 12
                }}
              />
            </Box>
            {group.items.map((item) => (
              <Box key={item.id}>{renderBubble(item)}</Box>
            ))}
          </Box>
        ))}
      </Box>

      <Box sx={{ px: { xs: 2, md: 5 }, pb: 2, pt: 1 }}>
        {renderAttachmentQueue()}
        <Box
          sx={{
            position: 'relative',
            maxWidth: 920,
            mx: 'auto',
            minHeight: 78,
            borderRadius: '24px',
            display: 'flex',
            alignItems: 'center',
            px: 1,
            py: 1,
            gap: 1,
            ...glassPanel,
            borderColor: composerFocused
              ? theme.palette.mode === 'dark'
                ? alpha(theme.palette.primary.light, 0.28)
                : alpha(theme.palette.primary.main, 0.18)
              : glassPanel.borderColor,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 24px 54px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.06)'
              : '0 20px 48px rgba(15,23,42,0.1), inset 0 1px 0 rgba(255,255,255,0.72)',
            transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: 1,
              borderRadius: '23px',
              pointerEvents: 'none',
              background: theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01) 42%, rgba(255,255,255,0.03))'
                : 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.28) 38%, rgba(255,255,255,0.12))',
              opacity: composerFocused ? 1 : 0.86
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              left: 24,
              right: 24,
              bottom: -10,
              height: 28,
              borderRadius: '999px',
              pointerEvents: 'none',
              background: theme.palette.mode === 'dark'
                ? alpha(theme.palette.primary.main, 0.18)
                : alpha(theme.palette.primary.main, 0.16),
              filter: 'blur(24px)',
              opacity: composerFocused ? 0.8 : 0.42
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={handleDropFiles}
        >
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              position: 'relative',
              zIndex: 1,
              flexShrink: 0,
              p: 0.35,
              borderRadius: '16px',
              backgroundColor: theme.palette.mode === 'dark'
                ? alpha('#020617', 0.18)
                : alpha('#ffffff', 0.2),
              border: '1px solid',
              borderColor: theme.palette.mode === 'dark'
                ? alpha('#e2e8f0', 0.06)
                : alpha('#ffffff', 0.46)
            }}
          >
            <Tooltip title="添加文件">
              <span>
                <IconButton
                  size="small"
                  disabled={submitting}
                  onClick={handleAttachFile}
                  sx={{
                    ...composerActionButtonSx,
                    '&:hover': {
                      ...composerActionButtonSx['&:hover'],
                      color: 'primary.main'
                    }
                  }}
                >
                  <AttachFile fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <AudioRecordButton
              disabled={submitting}
              onAudioInsert={(audioPath) => addAttachment({ type: 'audio', path: audioPath })}
              onTranscription={(text) => setDraft((prev) => appendDraftText(prev, text))}
              sx={{
                ...composerActionButtonSx,
                '&:hover': {
                  ...composerActionButtonSx['&:hover'],
                  color: 'success.main'
                }
              }}
            />
          </Stack>
          <Box
            sx={{
              position: 'relative',
              zIndex: 1,
              width: 1,
              minWidth: 0,
              px: 1.25,
              py: 0.2,
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}
          >
            <InputBase
              multiline
              maxRows={4}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="记点什么..."
              sx={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                lineHeight: 1.7,
                color: 'text.primary',
                '& textarea': {
                  py: 0.75
                },
                '& textarea::placeholder': {
                  color: 'text.secondary',
                  opacity: 0.92
                }
              }}
            />
          </Box>
          <Tooltip title="发送">
            <span>
              <IconButton
                disabled={!canSubmit}
                onClick={handleSubmit}
                sx={{
                  position: 'relative',
                  zIndex: 1,
                  width: 44,
                  height: 44,
                  mr: 0.25,
                  flexShrink: 0,
                  color: canSubmit ? '#fff' : 'text.disabled',
                  background: canSubmit
                    ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.light})`
                    : theme.palette.mode === 'dark'
                      ? alpha('#ffffff', 0.08)
                      : alpha('#0f172a', 0.05),
                  boxShadow: canSubmit
                    ? theme.palette.mode === 'dark'
                      ? `0 14px 30px ${alpha(theme.palette.primary.main, 0.34)}`
                      : `0 12px 24px ${alpha(theme.palette.primary.main, 0.22)}`
                    : 'none',
                  border: '1px solid',
                  borderColor: canSubmit
                    ? alpha('#ffffff', 0.24)
                    : theme.palette.mode === 'dark'
                      ? alpha('#e2e8f0', 0.08)
                      : alpha('#ffffff', 0.58),
                  transition: 'all 180ms ease',
                  '&:hover': canSubmit ? {
                    transform: 'translateY(-1px) scale(1.01)',
                    boxShadow: theme.palette.mode === 'dark'
                      ? `0 18px 34px ${alpha(theme.palette.primary.main, 0.38)}`
                      : `0 16px 28px ${alpha(theme.palette.primary.main, 0.24)}`
                  } : undefined
                }}
              >
                <Send sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Popover
        open={detailOpen}
        anchorEl={detailPopover?.anchorEl || null}
        onClose={closeDetail}
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        transitionDuration={{ enter: 140, exit: 160 }}
        slotProps={{
          backdrop: {
            invisible: true
          },
          transition: {
            onExited: () => setDetailPopover(null)
          },
          paper: {
            sx: {
              mt: 1,
              width: 'min(520px, calc(100vw - 24px))',
              borderRadius: '18px',
              p: 1.25,
              position: 'relative',
              ...glassPanel,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 20px 46px rgba(0,0,0,0.34)'
                : '0 20px 46px rgba(15,23,42,0.14)',
              maxHeight: 'min(560px, 74vh)',
              overflowY: 'auto',
              overscrollBehavior: 'contain'
            }
          }
        }}
      >
        {detailPopover?.item && (
          <Stack spacing={1}>
            {(() => {
              const detailBadges = getBadgesForDisplay(detailPopover.item)
              return (
                <>
            <IconButton
              size="small"
              onClick={closeDetail}
              aria-label="关闭预览"
              sx={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 26,
                height: 26,
                borderRadius: 1,
                color: 'text.secondary',
                zIndex: 1,
                '&:hover': {
                  color: 'text.primary',
                  bgcolor: alpha(theme.palette.text.primary, 0.06)
                }
              }}
            >
              <Close sx={{ fontSize: 16 }} />
            </IconButton>
            <Stack direction="row" spacing={1} alignItems="center">
              {detailPopover.item.type === 'todo'
                ? <AddTask fontSize="small" />
                : detailPopover.item.type === 'whiteboard'
                  ? <Brush fontSize="small" />
                  : <Notes fontSize="small" />}
              {detailPopover.item.title && (
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 700,
                    flex: 1,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word'
                  }}
                >
                  {detailPopover.item.title}
                </Typography>
              )}
            </Stack>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: -0.15, pr: 3.5 }}>
              {formatDay(detailPopover.item.time)} {formatClock(detailPopover.item.time)}
            </Typography>
            {detailBadges.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                {detailBadges.map((badge) => (
                  <Chip
                    key={badge}
                    label={badge}
                    size="small"
                    variant="outlined"
                    icon={
                      badge === '语音' ? <KeyboardVoice fontSize="small" />
                      : badge === '图片' ? <Image fontSize="small" />
                      : <AttachFile fontSize="small" />
                    }
                    sx={{
                      height: 22,
                      borderRadius: '999px',
                      fontSize: 11,
                      color: 'text.secondary',
                      borderColor: theme.palette.mode === 'dark'
                        ? 'rgba(148,163,184,0.18)'
                        : 'rgba(15,23,42,0.1)',
                      bgcolor: theme.palette.mode === 'dark'
                        ? 'rgba(148,163,184,0.08)'
                        : 'rgba(15,23,42,0.035)',
                      '& .MuiChip-icon': {
                        ml: 0.75,
                        mr: -0.35,
                        fontSize: 14,
                        color: 'text.secondary'
                      },
                      '& .MuiChip-label': {
                        px: 0.85
                      }
                    }}
                  />
                ))}
              </Stack>
            )}
            <Box sx={{ pr: 0.25 }}>
              <Stack spacing={1}>
                {(detailPopover.item.fullBody || detailPopover.item.body) && (
                  <Typography
                    sx={{
                      fontSize: 14,
                      lineHeight: 1.72,
                      color: 'text.secondary',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word'
                    }}
                  >
                    {detailPopover.item.fullBody || detailPopover.item.body}
                  </Typography>
                )}
                {renderAudioPlayers(detailPopover.item.audios)}
                {detailPopover.item.files?.length > 0 && (
                  <Stack spacing={0.5}>
                    {detailPopover.item.files.map((file, index) => (
                      <Chip
                        key={`${file.url}-${index}`}
                        icon={<AttachFile fontSize="small" />}
                        label={file.label}
                        size="small"
                        variant="outlined"
                        component="a"
                        href={file.url}
                        clickable
                        onClick={(event) => openTimelineFile(event, file.url)}
                        sx={{ alignSelf: 'flex-start', borderRadius: '9px', maxWidth: '100%' }}
                      />
                    ))}
                  </Stack>
                )}
                {detailPopover.item.noteKind === 'whiteboard' && detailPopover.item.whiteboardPreviewUrl && !failedWhiteboardPreviews[detailPopover.item.id] && (
                  <Box
                    sx={{
                      borderRadius: '14px',
                      overflow: 'hidden',
                      border: theme.palette.mode === 'dark'
                        ? '1px solid rgba(148,163,184,0.16)'
                        : '1px solid rgba(15,23,42,0.08)',
                      bgcolor: theme.palette.mode === 'dark'
                        ? 'rgba(15,23,42,0.2)'
                        : 'rgba(255,255,255,0.56)'
                    }}
                  >
                    <Box
                      component="img"
                      src={detailPopover.item.whiteboardPreviewUrl}
                      alt="画布缩略预览"
                      onError={() => handleWhiteboardPreviewError(detailPopover.item.id)}
                      sx={{
                        width: '100%',
                        maxHeight: 320,
                        objectFit: 'cover',
                        display: 'block'
                      }}
                    />
                  </Box>
                )}
                {detailPopover.item.images?.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', pb: 0.5 }}>
                    {detailPopover.item.images.map((src, index) => {
                      const displaySrc = getDisplayImageSrc(src)
                      if (!displaySrc) return null
                      return (
                        <Box
                          key={`${src}-${index}`}
                          component="img"
                          src={displaySrc}
                          alt="时间轴图片预览"
                          onClick={() => setPreviewImage(displaySrc)}
                          sx={{
                            width: 140,
                            height: 104,
                            objectFit: 'cover',
                            borderRadius: '12px',
                            flexShrink: 0,
                            cursor: 'zoom-in'
                          }}
                        />
                      )
                    })}
                  </Box>
                )}
              </Stack>
            </Box>
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 0.25 }}>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  closeDetail()
                  handleOpenItem(detailPopover.item)
                }}
              >
                打开
              </Button>
            </Stack>
                </>
              )
            })()}
          </Stack>
        )}
      </Popover>
      {previewImage && (
        <ImagePreviewModal
          src={previewImage}
          alt="时间轴图片预览"
          onClose={() => setPreviewImage(null)}
        />
      )}
      <Menu
        open={Boolean(contextMenu)}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        slotProps={{
          paper: {
            sx: {
              minWidth: 196,
              borderRadius: '14px',
              py: 0.75,
              ...glassPanel,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 18px 42px rgba(0,0,0,0.34)'
                : '0 18px 42px rgba(15,23,42,0.14)',
              '& .MuiMenuItem-root': {
                minHeight: 38,
                fontSize: 13,
                borderRadius: '10px',
                mx: 0.75,
                px: 1.1
              }
            }
          }
        }}
      >
        <MenuItem
          onClick={() => {
            handleOpenItem(contextMenu?.item)
            closeContextMenu()
          }}
        >
          <ListItemIcon><OpenInNew fontSize="small" /></ListItemIcon>
          <ListItemText>打开</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            openDetailPopover(contextMenu?.anchorEl, contextMenu?.item)
            closeContextMenu()
          }}
        >
          <ListItemIcon><Visibility fontSize="small" /></ListItemIcon>
          <ListItemText>查看详情</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={async () => {
            await copyTimelineItem(contextMenu?.item)
            closeContextMenu()
          }}
          disabled={
            !contextMenu?.item?.title &&
            !contextMenu?.item?.body &&
            !contextMenu?.item?.fullBody &&
            !contextMenu?.item?.images?.length
          }
        >
          <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
          <ListItemText>
            {contextMenu?.item?.images?.length > 0 && !contextMenu?.item?.title && !contextMenu?.item?.body && !contextMenu?.item?.fullBody
              ? '复制图片'
              : '复制内容'}
          </ListItemText>
        </MenuItem>
        <Divider sx={{ my: 0.5 }} />
        {contextMenu?.item?.type === 'todo' ? (
          <>
            <MenuItem
              onClick={() => {
                handleEditTodoFromTimeline(contextMenu?.item)
                closeContextMenu()
              }}
            >
              <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
              <ListItemText>编辑待办</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={async () => {
                await handleToggleTodo(contextMenu?.item)
                closeContextMenu()
              }}
            >
              <ListItemIcon>
                {contextMenu?.item?.done ? <RadioButtonUnchecked fontSize="small" /> : <CheckCircle fontSize="small" />}
              </ListItemIcon>
              <ListItemText>{contextMenu?.item?.done ? '恢复为未完成' : '标记为完成'}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={async () => {
                await handleToggleTodoFlag(contextMenu?.item, 'is_important')
                closeContextMenu()
              }}
            >
              <ListItemIcon><LabelImportantOutline fontSize="small" /></ListItemIcon>
              <ListItemText>{contextMenu?.item?.important ? '取消重要' : '设为重要'}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={async () => {
                await handleToggleTodoFlag(contextMenu?.item, 'is_urgent')
                closeContextMenu()
              }}
            >
              <ListItemIcon><PriorityHigh fontSize="small" /></ListItemIcon>
              <ListItemText>{contextMenu?.item?.urgent ? '取消紧急' : '设为紧急'}</ListItemText>
            </MenuItem>
          </>
        ) : (
          <MenuItem
            onClick={async () => {
              await handleToggleTimelinePin(contextMenu?.item)
              closeContextMenu()
            }}
          >
            <ListItemIcon>
              {contextMenu?.item?.pinned ? <PushPinOutlined fontSize="small" /> : <PushPin fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{contextMenu?.item?.pinned ? '取消置顶' : '置顶记录'}</ListItemText>
          </MenuItem>
        )}
        <Divider sx={{ my: 0.5 }} />
        <MenuItem
          onClick={async () => {
            await handleDeleteTimelineItem(contextMenu?.item)
            closeContextMenu()
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutline fontSize="small" /></ListItemIcon>
          <ListItemText>删除</ListItemText>
        </MenuItem>
      </Menu>
      <TodoEditDialog
        todo={editingTodo}
        open={Boolean(editingTodo)}
        onClose={() => setEditingTodo(null)}
        onUpdated={handleTodoDialogUpdated}
      />
    </Box>
  )
}

export default TimelineView
