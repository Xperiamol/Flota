import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  ClickAwayListener,
  Divider,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
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
  LocalOffer,
  Notes,
  OpenInNew,
  PushPin,
  PushPinOutlined,
  PriorityHigh,
  RadioButtonUnchecked,
  TaskAlt,
  Visibility
} from '../common/AppIcons'
import { useStore } from '../../store/useStore'
import { createTodo, fetchTodos, getTodoTagSuggestions, toggleTodoComplete, updateTodo } from '../../api/todoAPI'
import { formatTags, parseTags } from '../../utils/tagUtils'
import TagEditorPopover from '../common/TagEditorPopover'
import ImagePreviewModal, { canvasToPngBlob } from '../common/ImagePreviewModal'
import { getImageResolver } from '../../utils/ImageProtocolResolver'
import { stripMarkdownBlocks, stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'
import { notifyError } from '../../utils/notify'
import { openNoteLink } from '../../utils/linkUtils'
import { toListResult } from '../../utils/todoDisplayUtils'
import { getWhiteboardPreviewUrl } from '../../utils/whiteboardPreview'
import MarkdownPreview from '../editor/MarkdownPreview'
import TodoEditDialog from '../todos/TodoEditDialog'
import TimelineComposer from './timeline/TimelineComposer'
import TimelineDayPicker from './timeline/TimelineDayPicker'
import useTimelineItemActions from './timeline/useTimelineItemActions'
import { IMAGE_EXT, TIMELINE_TAG, splitEditableContent } from './timeline/timelineContent'
import { glassSx } from '../../styles/materials'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMELINE_TYPES = ['note', 'whiteboard', 'todo']
// 每次渲染 / 往上加载的记录条数（按整天取，实际会略多）
const RENDER_BATCH = 120
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

const AUDIO_EXT = /\.(m4a|mp3|wav|ogg|aac|opus|flac|webm)(?:\?|$)/i

const isAudioRef = (src) => {
  if (!src) return false
  if (src.startsWith('data:audio')) return true
  if (src.startsWith('audio/') || src.startsWith('app://audio/')) return true
  return AUDIO_EXT.test(src)
}

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

// Markdown 链接目标可能写成 <file:///含空格的路径>，先去掉尖括号
const linkTarget = (raw) => {
  const text = String(raw || '').trim()
  return text.startsWith('<') && text.endsWith('>') ? text.slice(1, -1).trim() : text
}

// 应用内引用（关联画布、笔记、待办、组件）：不是附件，点了打开对应内容
const APP_REFERENCE_LINK = /^app:\/\/(note|whiteboard|todo|todo-list|widget)\//i

// 本机文件或应用内附件（file://、attachments/、audio/、app://attachments 等），不含应用内引用
const isLocalFileLink = (src) => {
  if (!src || APP_REFERENCE_LINK.test(src)) return false
  return src.startsWith('file://')
    || src.startsWith('app://')
    || /^(?:attachments|audio)\//.test(src)
}

// 时间轴只额外处理「附件 / 语音」这类媒体占位，其余 Markdown 统一交给共享的预览文本清洗
const stripMarkdown = (content = '') => stripMarkdownToPreviewText(
  stripMarkdownBlocks(content)
    .replace(/!\[[^\]]*]\((audio\/[^)]+|app:\/\/audio\/[^)]+|[^)]+\.(?:m4a|mp3|wav|ogg|aac|opus|flac|webm))\)/gi, '[语音]')
    // 附件图片语法 ![name](attachments/...) → 附件占位（保留名称）；普通图片不进正文预览
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, (full, label, url) => {
      if (isAttachmentFileRef(String(url || ''))) return `[附件] ${label || ''}`.trim()
      return ''
    })
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, (_, label, url) => {
      const target = linkTarget(url)
      // 应用内引用在气泡里单独显示成可点的标签，正文里不再重复
      if (APP_REFERENCE_LINK.test(target)) return ''
      // 本机 file://、应用内 attachments/、app:// 协议附件 → 全部当作附件占位（兼容老链接语法）
      if (isLocalFileLink(target)) return `[附件] ${label}`
      return label
    })
)

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
    const target = linkTarget(m[3])
    if (!target) continue
    if (isLocalFileLink(target)) {
      files.push({ label, url: target })
    }
  }
  return files
}

// 应用内引用：[关联画布](app://whiteboard/<id>) 等，显示成可点的标签
const extractReferences = (content = '') => {
  const references = []
  const pattern = /(^|[^!])\[([^\]]+)]\(([^)]+)\)/g
  let m
  while ((m = pattern.exec(String(content)))) {
    const url = linkTarget(m[3])
    const kind = APP_REFERENCE_LINK.exec(url)?.[1]?.toLowerCase()
    if (kind) references.push({ label: m[2], url, kind })
  }
  return references
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

const buildNoteItemUncached = (note) => {
  const time = toTime(note.updated_at || note.updatedAt || note.created_at || note.createdAt) || Date.now()
  const isWhiteboard = note.note_type === 'whiteboard'
  const whiteboardSummary = isWhiteboard ? summarizeWhiteboard(note.content) : null
  const audios = extractAudios(note.content)
  const images = isWhiteboard ? whiteboardSummary.images : extractImages(note.content)
  const files = isWhiteboard ? whiteboardSummary.files : extractFiles(note.content)
  const references = isWhiteboard ? [] : extractReferences(note.content)
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
    references,
    whiteboardPreviewUrl: isWhiteboard ? getWhiteboardPreviewUrl(note, time) : '',
    time,
    tags: parseTags(note.tags),
    pinned: Boolean(note.is_pinned),
    raw: note
  }
}

// 笔记 → 时间轴条目的解析（正则抽图片 / 录音 / 附件、生成预览文字）比较重。
// store 对没变的笔记保持同一个对象引用，所以按对象缓存：改一篇只重算那一篇。
const noteItemCache = new WeakMap()

const buildNoteItem = (note) => {
  const cached = noteItemCache.get(note)
  if (cached) return cached
  const item = buildNoteItemUncached(note)
  noteItemCache.set(note, item)
  return item
}

const buildTimelineItems = (notes, todos) => {
  const noteItems = (notes || [])
    .filter((note) => !note.is_deleted)
    .map(buildNoteItem)

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
      tags: parseTags(todo.tags),
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

// 原地编辑只给普通文字笔记，且不太长；长文、画布去编辑器里改更顺手
const INLINE_EDIT_MAX_LENGTH = 5000
const canEditInline = (item) => item?.type === 'note'
  && typeof item.raw?.content === 'string'
  && item.raw.content.length <= INLINE_EDIT_MAX_LENGTH
const editableTextOf = (item) => splitEditableContent(item?.raw?.content).text

const TimelineView = ({ onTodoUpdated }) => {
  const theme = useTheme()
  const notes = useStore((state) => state.notes)
  const loadNotes = useStore((state) => state.loadNotes)
  const createNote = useStore((state) => state.createNote)
  const setCurrentView = useStore((state) => state.setCurrentView)
  const setSelectedNoteId = useStore((state) => state.setSelectedNoteId)
  const togglePinNote = useStore((state) => state.togglePinNote)
  const timelineFilter = useStore((state) => state.timelineFilter)
  const resetTimelineFilter = useStore((state) => state.resetTimelineFilter)
  const [todos, setTodos] = useState([])
  const [composerHeight, setComposerHeight] = useState(80)
  const [contextMenu, setContextMenu] = useState(null)
  const [editingTodo, setEditingTodo] = useState(null)
  const [failedWhiteboardPreviews, setFailedWhiteboardPreviews] = useState({})
  const [detailPopover, setDetailPopover] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [resolvedImages, setResolvedImages] = useState({})
  const [resolvedAudios, setResolvedAudios] = useState({})
  // 详情里的原地编辑：{ text, saving }；null 表示在看不在改
  const [detailEdit, setDetailEdit] = useState(null)
  const [dayPicker, setDayPicker] = useState(null) // { anchorEl, group }
  const [tagEditor, setTagEditor] = useState(null) // { anchorEl, itemId }
  const scrollRef = useRef(null)
  const composerRef = useRef(null)
  const dayRefs = useRef(new Map())
  const pendingScrollLatestRef = useRef(false)

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

  const {
    hiddenTodoIds,
    deleteItem,
    canConvertToTodo,
    convertToTodo,
    saveTags,
    saveNoteText,
    mergeableCount,
    mergeDay,
  } = useTimelineItemActions({ refreshTodos, onTodoUpdated })

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
      if (item.type === 'todo' && hiddenTodoIds.has(item.rawId)) return false
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
  }, [allItems, hiddenTodoIds, timelineFilter])

  const filterActive = Boolean(
    (timelineFilter?.search || '').trim() ||
    (timelineFilter?.tags || []).length > 0 ||
    (timelineFilter?.dateRange || 'all') !== 'all' ||
    !isDefaultTimelineTypes(timelineFilter?.types) ||
    timelineFilter?.showCompleted === false ||
    timelineFilter?.showFuture === true ||
    (timelineFilter?.quickMode || 'all') !== 'all'
  )

  const allGroups = useMemo(() => groupItemsByDay(timelineItems), [timelineItems])
  const dayCounts = useMemo(
    () => new Map(allGroups.map((group) => [group.key, group.items.length])),
    [allGroups]
  )

  // 只渲染最近的一部分（按整天切，不把一天拆开），往上滚到顶再加载更早的。
  // 记录多的时候第一次打开不用把几千条一次性渲染出来。
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH)
  const groupedItems = useMemo(() => {
    let count = 0
    let start = allGroups.length
    while (start > 0 && count < renderLimit) {
      start -= 1
      count += allGroups[start].items.length
    }
    return start === 0 ? allGroups : allGroups.slice(start)
  }, [allGroups, renderLimit])
  const hasEarlier = groupedItems.length < allGroups.length

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

  // 只解析还没解析过的图片：筛选、编辑等引起的列表变化不会重复请求全部图片。
  // 结果晚到也照样合并（解析结果与列表无关），只在卸载后丢弃。
  const requestedImagesRef = useRef(new Set())
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  useEffect(() => {
    const pendingSources = timelineImageSources.filter((src) => !requestedImagesRef.current.has(src))
    if (pendingSources.length === 0) return
    pendingSources.forEach((src) => requestedImagesRef.current.add(src))
    const resolver = getImageResolver()
    Promise.allSettled(
      pendingSources.map(async (src) => [src, await resolver.resolve(src)])
    ).then((results) => {
      if (!mountedRef.current) return
      const next = {}
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const [src, resolved] = result.value
          next[src] = resolved || src
        }
      })
      setResolvedImages((prev) => ({ ...prev, ...next }))
    })
  }, [timelineImageSources])

  const requestedAudiosRef = useRef(new Set())
  useEffect(() => {
    const pendingSources = timelineAudioSources.filter((src) => !requestedAudiosRef.current.has(src))
    if (pendingSources.length === 0) return
    pendingSources.forEach((src) => requestedAudiosRef.current.add(src))
    Promise.allSettled(
      pendingSources.map(async (src) => {
        if (/^(https?:|file:|data:audio)/i.test(src)) return [src, { url: src, missing: false }]
        const result = await window.electronAPI?.audio?.resolveSource?.(src)
        if (result?.success && result.data) return [src, { url: result.data, missing: false }]
        return [src, { url: '', missing: true }]
      })
    ).then((results) => {
      if (!mountedRef.current) return
      const next = {}
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const [src, resolved] = result.value
          next[src] = resolved
        }
      })
      if (Object.keys(next).length > 0) setResolvedAudios((prev) => ({ ...prev, ...next }))
    })
  }, [timelineAudioSources])

  const scrollToLatest = useCallback((behavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  // ── 滚动 ──
  // 第一次有内容 / 换了筛选：绘制前直接定位到最新，不出现“从头滚到底”的动画。
  // 停在底部时一直贴底：图片、录音加载完撑高内容也不会把最新一条顶上去。
  // 往上看历史时不打扰；只有自己刚记了一条才平滑滚回最新。
  const atBottomRef = useRef(true)
  const prependAnchorRef = useRef(null) // 加载更早记录前，距底部的距离
  const jumpToDayRef = useRef(null)
  const filterKey = JSON.stringify(timelineFilter || {})
  const positionedKeyRef = useRef(null)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || timelineItems.length === 0 || positionedKeyRef.current === filterKey) return
    positionedKeyRef.current = filterKey
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
  }, [filterKey, timelineItems.length])

  // 换筛选时重新从最近一批开始渲染
  useEffect(() => { setRenderLimit(RENDER_BATCH) }, [filterKey])

  useEffect(() => {
    if (!pendingScrollLatestRef.current) return undefined
    pendingScrollLatestRef.current = false
    const frame = window.requestAnimationFrame(() => scrollToLatest('smooth'))
    return () => window.cancelAnimationFrame(frame)
  }, [timelineItems, scrollToLatest])

  // 加载更早的记录后，保持用户眼前的内容不动
  useLayoutEffect(() => {
    const el = scrollRef.current
    const fromBottom = prependAnchorRef.current
    if (!el || fromBottom == null) return
    prependAnchorRef.current = null
    el.scrollTop = el.scrollHeight - fromBottom
  }, [groupedItems])

  // 跳到某一天：直接定位（不播放长距离滚动），并短暂高亮那天的日期。
  // 那天还没渲染时先扩大渲染范围，渲染出来后再定位。
  const [flashDayKey, setFlashDayKey] = useState(null)
  const scrollDayIntoView = useCallback((dayKey) => {
    const node = dayRefs.current.get(dayKey)
    if (!node) return false
    atBottomRef.current = false
    node.scrollIntoView({ block: 'start' })
    setFlashDayKey(dayKey)
    return true
  }, [])
  useEffect(() => {
    if (!flashDayKey) return undefined
    const timer = window.setTimeout(() => setFlashDayKey(null), 1200)
    return () => window.clearTimeout(timer)
  }, [flashDayKey])

  useLayoutEffect(() => {
    const dayKey = jumpToDayRef.current
    if (dayKey && scrollDayIntoView(dayKey)) jumpToDayRef.current = null
  }, [groupedItems, scrollDayIntoView])

  const jumpToDay = useCallback((dayKey) => {
    const index = allGroups.findIndex((group) => group.key === dayKey)
    if (index < 0) return
    const needed = allGroups.slice(index).reduce((sum, group) => sum + group.items.length, 0)
    // 跳转期间不贴底：扩大渲染范围会撑高内容，贴底逻辑会把视图拉回最新
    atBottomRef.current = false
    if (needed > renderLimit) {
      jumpToDayRef.current = dayKey
      setRenderLimit(needed)
    } else {
      scrollDayIntoView(dayKey)
    }
  }, [allGroups, renderLimit, scrollDayIntoView])

  const handleListScroll = useCallback((event) => {
    const el = event.currentTarget
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (hasEarlier && el.scrollTop < 240 && prependAnchorRef.current == null) {
      prependAnchorRef.current = el.scrollHeight - el.scrollTop
      setRenderLimit((limit) => limit + RENDER_BATCH)
    }
  }, [hasEarlier])

  // 输入框变高（多行、附件）会改变列表底部留白，停在底部时跟着贴底
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [composerHeight])

  // 内容高度变化时（图片解析、录音加载），停在底部的用户继续贴底
  const listContentRef = useRef(null)
  useEffect(() => {
    const content = listContentRef.current
    const el = scrollRef.current
    if (!content || !el) return undefined
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current && prependAnchorRef.current == null) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

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

  const openDetailPopover = useCallback((anchorEl, item, { edit = false } = {}) => {
    if (!anchorEl || !item) return
    setDetailPopover({ anchorEl, item })
    setDetailEdit(edit && canEditInline(item) ? { text: editableTextOf(item), saving: false } : null)
    setDetailOpen(true)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailOpen(false)
    setDetailEdit(null)
  }, [])

  // 单击立即出详情（不再为了区分双击而等 200ms）；详情是非模态的，
  // 所以双击仍能直接打开，点另一条记录会直接换成那条的详情。
  const handleShowDetail = (event, item) => {
    if (detailOpen && detailPopover?.item?.id === item.id) return
    openDetailPopover(event.currentTarget, item)
  }

  const handleDoubleClickItem = (item) => {
    closeDetail()
    handleOpenItem(item)
  }

  // 列表重新生成后（编辑保存、同步），详情里显示的条目跟着换成最新的
  const detailItemId = detailPopover?.item?.id
  useEffect(() => {
    if (!detailItemId) return
    const latest = allItems.find((item) => item.id === detailItemId)
    if (!latest) closeDetail()
    else setDetailPopover((current) => (current && current.item !== latest ? { ...current, item: latest } : current))
  }, [allItems, closeDetail, detailItemId])

  // 焦点不在详情里（比如刚点完气泡）时的 Esc
  useEffect(() => {
    if (!detailOpen) return undefined
    const handleKey = (event) => {
      if (event.key !== 'Escape') return
      if (detailEdit) setDetailEdit(null)
      else closeDetail()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [closeDetail, detailEdit, detailOpen])

  const saveDetailEdit = async () => {
    const item = detailPopover?.item
    if (!item || !detailEdit || detailEdit.saving) return
    setDetailEdit((current) => current && { ...current, saving: true })
    const ok = await saveNoteText(item, detailEdit.text)
    setDetailEdit((current) => (ok ? null : current && { ...current, saving: false }))
  }

  const handleToggleTodo = async (item) => {
    if (item.type !== 'todo') return
    try {
      await toggleTodoComplete(item.rawId)
      await refreshTodos()
      onTodoUpdated?.()
    } catch (error) {
      notifyError(`更新待办失败：${error?.message || '未知原因'}`)
    }
  }

  const handleOpenContextMenu = (event, item) => {
    event.preventDefault()
    event.stopPropagation()
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

  // 标签弹层始终显示这条记录的最新标签（每次增删保存后列表会刷新）
  const tagEditorItem = tagEditor ? allItems.find((item) => item.id === tagEditor.itemId) : null

  const contextMenuDay = useMemo(() => {
    const id = contextMenu?.item?.id
    return id ? groupedItems.find((group) => group.items.some((item) => item.id === id)) : null
  }, [contextMenu, groupedItems])
  const contextMenuDayMergeCount = contextMenuDay && contextMenu?.item?.type === 'note'
    ? mergeableCount(contextMenuDay.items)
    : 0

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

  const handleToggleTodoFlag = useCallback(async (item, field) => {
    if (item?.type !== 'todo') return
    const nextValue = field === 'is_important' ? !item.important : !item.urgent
    try {
      await updateTodo(item.rawId, { [field]: nextValue ? 1 : 0 })
      await refreshTodos()
      onTodoUpdated?.()
    } catch (error) {
      notifyError(`更新待办失败：${error?.message || '未知原因'}`)
    }
  }, [onTodoUpdated, refreshTodos])

  const handleToggleTimelinePin = useCallback(async (item) => {
    if (!item || item.type === 'todo') return
    const result = await togglePinNote(item.rawId)
    if (result?.success === false) notifyError(`置顶失败：${result.error || '未知原因'}`)
  }, [togglePinNote])

  const handleEditTodoFromTimeline = useCallback((item) => {
    if (item?.type !== 'todo' || !item.raw) return
    setEditingTodo(item.raw)
  }, [])

  const handleTodoDialogUpdated = useCallback(async (updatedTodo, options = {}) => {
    if (options.keepOpen && updatedTodo) setEditingTodo(updatedTodo)
    else setEditingTodo(null)
    await refreshTodos()
    onTodoUpdated?.()
  }, [onTodoUpdated, refreshTodos])

  // 输入框提交：失败时抛错，输入框会保留内容并提示
  const handleComposerSubmit = useCallback(async ({ kind, content }) => {
    if (kind === 'todo') {
      await createTodo({ content, tags: TIMELINE_TAG })
      await refreshTodos()
      onTodoUpdated?.()
    } else {
      const result = await createNote({ title: '', content, tags: [TIMELINE_TAG], selectAfterCreate: false })
      if (!result?.success) throw new Error(result?.error || '保存失败')
    }
    pendingScrollLatestRef.current = true
  }, [createNote, onTodoUpdated, refreshTodos])

  // 在时间轴任意位置松开文件，都交给输入框导入
  const handleDropFiles = (event) => {
    event.preventDefault()
    event.stopPropagation()
    composerRef.current?.importFiles(Array.from(event.dataTransfer?.files || []))
  }

  const handleWhiteboardPreviewError = useCallback((previewUrl) => {
    if (!previewUrl) return
    setFailedWhiteboardPreviews((prev) => prev[previewUrl] ? prev : { ...prev, [previewUrl]: true })
  }, [])

  useEffect(() => {
    setFailedWhiteboardPreviews((prev) => {
      const activeUrls = new Set(
        timelineItems
          .map((item) => item.whiteboardPreviewUrl)
          .filter(Boolean)
      )
      const nextEntries = Object.entries(prev).filter(([url]) => activeUrls.has(url))
      if (nextEntries.length === Object.keys(prev).length) return prev
      return Object.fromEntries(nextEntries)
    })
  }, [timelineItems])

  // 附件、本机文件、关联画布 / 笔记 / 待办等链接都交给编辑器同一个打开逻辑
  const openTimelineLink = async (event, url) => {
    event.preventDefault()
    event.stopPropagation()
    if (!url) return
    try {
      if (!(await openNoteLink(url))) notifyError('找不到链接指向的内容，可能已经被删除')
    } catch (error) {
      notifyError(`打开失败：${error?.message || '未知原因'}`)
    }
  }

  const glassPanel = { ...glassSx(theme, 'popover'), borderColor: theme.palette.divider }
  const glassCard = glassSx(theme, 'card')

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
                  borderRadius: 1.5,
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

  const renderBubble = (item) => {
    const isTodo = item.type === 'todo'
    const showWhiteboardPreview = item.noteKind === 'whiteboard' && item.whiteboardPreviewUrl && !failedWhiteboardPreviews[item.whiteboardPreviewUrl]
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
          data-timeline-bubble=""
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
              ...(detailOpen && detailPopover?.item?.id === item.id ? {
                borderColor: alpha(theme.palette.primary.main, 0.45),
                boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.12)}`
              } : {}),
              transition: 'border-color 150ms ease, box-shadow 150ms ease',
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
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  border: theme.palette.mode === 'dark'
                    ? '1px solid rgba(157,157,165,0.16)'
                    : '1px solid rgba(22,22,24,0.08)',
                  bgcolor: theme.palette.mode === 'dark'
                    ? 'rgba(22,22,24,0.2)'
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
                      onError={() => handleWhiteboardPreviewError(item.whiteboardPreviewUrl)}
                  sx={{
                    width: '100%',
                    height: 164,
                    objectFit: 'cover',
                    display: 'block',
                    bgcolor: theme.palette.mode === 'dark'
                      ? 'rgba(22,22,24,0.36)'
                      : 'rgba(242,242,243,0.9)'
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
                      ? 'rgba(11,11,12,0.18)'
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
                    onClick={(event) => openTimelineLink(event, file.url)}
                    sx={{ alignSelf: 'flex-start', borderRadius: 1, maxWidth: 240 }}
                  />
                ))}
              </Stack>
            )}
{item.references?.length > 0 && (
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                {item.references.map((reference, index) => (
                  <Chip
                    key={`${reference.url}-${index}`}
                    icon={reference.kind === 'whiteboard' ? <Brush fontSize="small" /> : reference.kind.startsWith('todo') ? <AddTask fontSize="small" /> : <Notes fontSize="small" />}
                    label={reference.label}
                    size="small"
                    variant="outlined"
                    clickable
                    onClick={(event) => openTimelineLink(event, reference.url)}
                    sx={{ borderRadius: 1, maxWidth: 240 }}
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
                        borderRadius: 1,
                        border: theme.palette.mode === 'dark' ? '1px solid rgba(157,157,165,0.18)' : '1px solid rgba(22,22,24,0.08)',
                        bgcolor: theme.palette.mode === 'dark' ? 'rgba(157,157,165,0.08)' : 'rgba(22,22,24,0.03)',
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
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}
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
          pt: 3,
          // 按悬浮输入框的实际高度留白：最后一条记录不会被盖住
          pb: `${Math.ceil(composerHeight) + 16}px`,
          overflow: 'auto',
          overflowAnchor: 'none'
        }}
        onScroll={handleListScroll}
      >
        <Box ref={listContentRef} sx={{ minHeight: '100%' }}>
        {hasEarlier && (
          <Typography sx={{ textAlign: 'center', fontSize: 12, color: 'text.disabled', pb: 2 }}>
            往上滑加载更早的记录
          </Typography>
        )}
        {groupedItems.length === 0 ? (
          <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
            <Stack alignItems="center" spacing={1.25}>
              <AccessTime sx={{ fontSize: 36, opacity: 0.35 }} />
              <Typography sx={{ fontWeight: 600 }}>没有匹配的时间轴记录</Typography>
              <Typography sx={{ fontSize: 13 }}>
                {filterActive ? '清空筛选后可以查看完整时间轴。' : '从底部输入一句话，开始记录这一刻。'}
              </Typography>
              {filterActive && (
                <Button size="small" variant="outlined" onClick={resetTimelineFilter} sx={{ borderRadius: 1 }}>
                  清空筛选
                </Button>
              )}
            </Stack>
          </Box>
        ) : groupedItems.map((group) => (
          <Box
            key={group.key}
            ref={(node) => { if (node) dayRefs.current.set(group.key, node); else dayRefs.current.delete(group.key) }}
            sx={{ mb: 2, scrollMarginTop: 12 }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              {/* 点日期：弹出月历跳到别的日子，或合并这一天的记录 */}
              <ButtonBase
                onClick={(event) => setDayPicker({ anchorEl: event.currentTarget, group })}
                aria-label={`${group.label}，选择日期`}
                sx={{
                  height: 24,
                  px: 1,
                  borderRadius: 1,
                  bgcolor: flashDayKey === group.key
                    ? alpha(theme.palette.primary.main, 0.18)
                    : theme.palette.mode === 'dark' ? 'rgba(157,157,165,0.16)' : 'rgba(22,22,24,0.06)',
                  color: flashDayKey === group.key ? 'primary.main' : 'text.secondary',
                  fontSize: 12,
                  transition: 'background-color 300ms ease, color 300ms ease',
                  '&:hover': {
                    color: 'text.primary',
                    bgcolor: theme.palette.mode === 'dark' ? 'rgba(157,157,165,0.24)' : 'rgba(22,22,24,0.1)'
                  }
                }}
              >
                {group.label}
              </ButtonBase>
            </Box>
            {group.items.map((item) => (
              <Box key={item.id}>{renderBubble(item)}</Box>
            ))}
          </Box>
        ))}
        </Box>
      </Box>

      {/* 输入区：与 AI 页面同一款悬浮玻璃输入框，记录从玻璃下方滑过 */}
      <TimelineComposer ref={composerRef} onSubmit={handleComposerSubmit} onHeightChange={setComposerHeight} />

      {/* 与笔记编辑器同一个「管理标签」弹层：输入、建议、插件扩展都一样 */}
      <TagEditorPopover
        anchorEl={tagEditorItem ? tagEditor.anchorEl : null}
        onClose={() => setTagEditor(null)}
        value={formatTags(tagEditorItem?.tags || [])}
        onChange={(value) => saveTags(tagEditorItem, value)}
        getSuggestions={tagEditorItem?.type === 'todo' ? getTodoTagSuggestions : undefined}
        noteContent={tagEditorItem?.raw?.content || ''}
        noteId={tagEditorItem?.type === 'todo' ? null : tagEditorItem?.rawId}
      />

      <TimelineDayPicker
        anchorEl={dayPicker?.anchorEl || null}
        onClose={() => setDayPicker(null)}
        dayCounts={dayCounts}
        activeTime={dayPicker?.group?.items?.[0]?.time}
        onPick={(dayKey) => {
          setDayPicker(null)
          jumpToDay(dayKey)
        }}
        mergeCount={dayPicker ? mergeableCount(dayPicker.group.items) : 0}
        onMerge={() => {
          const items = dayPicker?.group?.items
          setDayPicker(null)
          if (items) mergeDay(items)
        }}
      />

      <Popover
        open={detailOpen}
        anchorEl={detailPopover?.anchorEl || null}
        // 焦点在详情里时 Esc 由这里处理（Modal 会拦下按键）：编辑中先退出编辑，再按一次才关闭
        onClose={(_event, reason) => {
          if (reason === 'escapeKeyDown' && detailEdit) setDetailEdit(null)
          else closeDetail()
        }}
        // 非模态：不挡住时间轴的点击，点另一条记录直接换详情、双击直接打开
        hideBackdrop
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        transitionDuration={{ enter: 140, exit: 160 }}
        slotProps={{
          root: { sx: { pointerEvents: 'none' } },
          transition: {
            onExited: () => setDetailPopover(null)
          },
          paper: {
            sx: {
              pointerEvents: 'auto',
              mt: 1,
              width: 'min(520px, calc(100vw - 24px))',
              borderRadius: 1.5,
              p: 1.25,
              position: 'relative',
              ...glassPanel,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 12px 32px rgba(0,0,0,0.28)'
                : '0 12px 32px rgba(22,22,24,0.11)',
              maxHeight: 'min(560px, 74vh)',
              overflowY: 'auto',
              overscrollBehavior: 'contain'
            }
          }
        }}
      >
        {detailPopover?.item && (
          <ClickAwayListener
            onClickAway={(event) => {
              // 点记录气泡由气泡自己处理（换详情 / 双击打开）；编辑中点外面不丢内容
              if (event.target?.closest?.('[data-timeline-bubble]') || detailEdit) return
              closeDetail()
            }}
          >
          <Stack spacing={1}>
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
            {(detailPopover.item.badges || []).length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                {(detailPopover.item.badges || []).map((badge) => (
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
                        ? 'rgba(157,157,165,0.18)'
                        : 'rgba(22,22,24,0.1)',
                      bgcolor: theme.palette.mode === 'dark'
                        ? 'rgba(157,157,165,0.08)'
                        : 'rgba(22,22,24,0.035)',
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
                {detailEdit ? (
                  <InputBase
                    autoFocus
                    multiline
                    minRows={3}
                    maxRows={14}
                    value={detailEdit.text}
                    disabled={detailEdit.saving}
                    onChange={(event) => setDetailEdit((current) => current && { ...current, text: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        saveDetailEdit()
                      }
                    }}
                    onFocus={(event) => {
                      const end = event.target.value.length
                      event.target.setSelectionRange(end, end)
                    }}
                    inputProps={{ 'aria-label': '编辑记录' }}
                    sx={{
                      px: 1,
                      py: 0.75,
                      fontSize: 14,
                      lineHeight: 1.72,
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: alpha(theme.palette.primary.main, 0.45),
                      boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.1)}`,
                      bgcolor: theme.palette.mode === 'dark' ? alpha('#000', 0.15) : alpha('#fff', 0.7)
                    }}
                  />
                ) : (detailPopover.item.fullBody || detailPopover.item.body) && (
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
{detailPopover.item.references?.length > 0 && (
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                {detailPopover.item.references.map((reference, index) => (
                  <Chip
                    key={`${reference.url}-${index}`}
                    icon={reference.kind === 'whiteboard' ? <Brush fontSize="small" /> : reference.kind.startsWith('todo') ? <AddTask fontSize="small" /> : <Notes fontSize="small" />}
                    label={reference.label}
                    size="small"
                    variant="outlined"
                    clickable
                    onClick={(event) => openTimelineLink(event, reference.url)}
                    sx={{ borderRadius: 1, maxWidth: '100%' }}
                  />
                ))}
              </Stack>
            )}
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
                        onClick={(event) => openTimelineLink(event, file.url)}
                        sx={{ alignSelf: 'flex-start', borderRadius: 1, maxWidth: '100%' }}
                      />
                    ))}
                  </Stack>
                )}
                {detailPopover.item.noteKind === 'whiteboard' && detailPopover.item.whiteboardPreviewUrl && !failedWhiteboardPreviews[detailPopover.item.whiteboardPreviewUrl] && (
                  <Box
                    sx={{
                      borderRadius: 1.5,
                      overflow: 'hidden',
                      border: theme.palette.mode === 'dark'
                        ? '1px solid rgba(157,157,165,0.16)'
                        : '1px solid rgba(22,22,24,0.08)',
                      bgcolor: theme.palette.mode === 'dark'
                        ? 'rgba(22,22,24,0.2)'
                        : 'rgba(255,255,255,0.56)'
                    }}
                  >
                    <Box
                      component="img"
                      src={detailPopover.item.whiteboardPreviewUrl}
                      alt="画布缩略预览"
                      onError={() => handleWhiteboardPreviewError(detailPopover.item.whiteboardPreviewUrl)}
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
                            borderRadius: 1.5,
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
            <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: 0.25 }}>
              {detailEdit ? (
                <>
                  <Typography sx={{ flex: 1, fontSize: 11.5, color: 'text.disabled' }}>
                    {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'} + Enter 保存 · Esc 取消
                  </Typography>
                  <Button size="small" color="inherit" disabled={detailEdit.saving} onClick={() => setDetailEdit(null)}
                    sx={{ color: 'text.secondary' }}>
                    取消
                  </Button>
                  <Button size="small" variant="contained" disableElevation disabled={detailEdit.saving} onClick={saveDetailEdit}>
                    {detailEdit.saving ? '保存中…' : '保存'}
                  </Button>
                </>
              ) : (
                <>
                  <Box sx={{ flex: 1 }} />
                  {(canEditInline(detailPopover.item) || detailPopover.item.type === 'todo') && (
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<Edit sx={{ fontSize: '16px !important' }} />}
                      onClick={() => {
                        const item = detailPopover.item
                        if (item.type === 'todo') {
                          closeDetail()
                          handleEditTodoFromTimeline(item)
                        } else {
                          setDetailEdit({ text: editableTextOf(item), saving: false })
                        }
                      }}
                      sx={{ color: 'text.secondary' }}
                    >
                      编辑
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    onClick={() => {
                      const item = detailPopover.item
                      closeDetail()
                      handleOpenItem(item)
                    }}
                  >
                    {detailPopover.item.type === 'todo' ? '去待办' : '打开'}
                  </Button>
                </>
              )}
            </Stack>
          </Stack>
          </ClickAwayListener>
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
              borderRadius: 1.5,
              py: 0.75,
              ...glassPanel,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 10px 28px rgba(0,0,0,0.26)'
                : '0 10px 28px rgba(22,22,24,0.1)',
              '& .MuiMenuItem-root': {
                minHeight: 38,
                fontSize: 13,
                borderRadius: 1,
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
        {canEditInline(contextMenu?.item) && (
          <MenuItem
            onClick={() => {
              openDetailPopover(contextMenu?.anchorEl, contextMenu?.item, { edit: true })
              closeContextMenu()
            }}
          >
            <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
            <ListItemText>编辑</ListItemText>
          </MenuItem>
        )}
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
        {/* 整理：加标签后就离开「待整理」；纯文字记录可以直接变成待办；一天的碎片可以合并 */}
        <MenuItem
          onClick={() => {
            const { item, anchorEl } = contextMenu || {}
            closeContextMenu()
            if (item && anchorEl) setTagEditor({ anchorEl, itemId: item.id })
          }}
        >
          <ListItemIcon><LocalOffer fontSize="small" /></ListItemIcon>
          <ListItemText>{contextMenu?.item?.tags?.some((tag) => tag !== TIMELINE_TAG) ? '编辑标签' : '加标签'}</ListItemText>
        </MenuItem>
        {canConvertToTodo(contextMenu?.item) && (
          <MenuItem
            onClick={() => {
              const item = contextMenu?.item
              closeContextMenu()
              convertToTodo(item)
            }}
          >
            <ListItemIcon><TaskAlt fontSize="small" /></ListItemIcon>
            <ListItemText>转为待办</ListItemText>
          </MenuItem>
        )}
        {contextMenuDayMergeCount >= 2 && (
          <MenuItem
            onClick={() => {
              const items = contextMenuDay?.items
              closeContextMenu()
              if (items) mergeDay(items)
            }}
          >
            <ListItemIcon><Notes fontSize="small" /></ListItemIcon>
            <ListItemText>合并这天的 {contextMenuDayMergeCount} 条记录</ListItemText>
          </MenuItem>
        )}
        <Divider sx={{ my: 0.5 }} />
        <MenuItem
          onClick={() => {
            const item = contextMenu?.item
            closeContextMenu()
            deleteItem(item)
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
