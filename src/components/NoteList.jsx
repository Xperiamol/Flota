import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from '../utils/i18n'
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  Divider,
  TextField,
  InputAdornment,
  Skeleton,
  Fade,
  CircularProgress,
  Checkbox,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button
} from '@mui/material'
import {
  PushPin as PinIcon,
  PushPinOutlined as PinOutlinedIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  SelectAll as SelectAllIcon,
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Note as NoteIcon,
  Brush as WhiteboardIcon,
  Restore as RestoreIcon,
  DeleteForever as DeleteForeverIcon,
  CheckCircle as TodoIcon,
  WebAsset as WindowIcon
} from '@mui/icons-material'
import { useStore } from '../store/useStore'
import { zhCN as dateFnsZhCN } from 'date-fns/locale/zh-CN'
import { createTodo } from '../api/todoAPI'
import { useSearch } from '../hooks/useSearch'
import { useSearchManager } from '../hooks/useSearchManager'
import { useMultiSelectManager } from '../hooks/useMultiSelectManager'
import { useFiltersVisibility } from '../hooks/useFiltersVisibility'
import { searchNotesAPI } from '../api/searchAPI'
import FilterContainer from './FilterContainer'
import FilterPopover from './FilterPopover'
import FilterToggleButton from './FilterToggleButton'
import ChoiceFilter from './ChoiceFilter'
import { Image as ImageIcon, AccessTime as AccessTimeIcon, Description as MarkdownIcon, Category as CategoryIcon } from '@mui/icons-material'
import zhCN from '../locales/zh-CN'

const {
  filters: { placeholder }
} = zhCN;
import MultiSelectToolbar from './MultiSelectToolbar'
import { useDragAnimation } from './DragAnimationProvider'
import { useError } from './ErrorProvider'
import logger from '../utils/logger'
import { formatRelativeNoteTime } from '../utils/noteDateUtils'
import { stripMarkdownToPreviewText } from '../utils/markdownTextUtils'

const NOTE_LIST_GUTTER = '10px'
const NOTE_SCROLLBAR_COMPENSATION = '8px'
const NOTE_ITEM_RADIUS = '12px'
const NOTE_ITEM_SHADOW = '0 4px 12px rgba(0,0,0,0.08)'

const NoteList = ({ showDeleted = false, onMultiSelectChange, onMultiSelectRefChange }) => {
  const { t } = useTranslation()
  const { showError, showSuccess } = useError()
  const theme = useTheme()
  const {
    notes,
    selectedNoteId,
    isLoading,
    setSelectedNoteId,
    setSearchQuery,
    loadNotes,
    deleteNote,
    createNote,
    restoreNote,
    togglePinNote,
    batchDeleteNotes,
    batchRestoreNotes,
    batchPermanentDeleteNotes
  } = useStore()

  const [anchorEl, setAnchorEl] = useState(null)
  const [selectedNote, setSelectedNote] = useState(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [selectedTagFilters, setSelectedTagFilters] = useState([])
  // 笔记新增筛选维度
  const [selectedPinFilters, setSelectedPinFilters] = useState([]) // ['pinned'] 或 []
  const [selectedImageFilters, setSelectedImageFilters] = useState([]) // ['has', 'none']
  const [selectedTimeFilters, setSelectedTimeFilters] = useState([]) // ['today','7d','30d']
  const [selectedTypeFilters, setSelectedTypeFilters] = useState([]) // ['markdown','whiteboard']
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState(false)
  const [batchPermanentDeleteConfirm, setBatchPermanentDeleteConfirm] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ 
    open: false, 
    type: '', // 'restore' | 'delete'
    count: 0, 
    ids: [] 
  })
  const filterAnchorRef = useRef(null)

  // 添加ref防止重复加载
  const isLoadingRef = useRef(false)
  const notesRef = useRef([])
  const lastFetchedViewRef = useRef(null)

  // 保持 notes 的最新引用，供 loadNotes 判断是否已有数据
  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  // 筛选器可见性状态
  const { filtersVisible, toggleFiltersVisibility } = useFiltersVisibility('note_filters_visible')

  // 使用动画拖拽处理器
  const { createAnimatedDragHandler } = useDragAnimation()
  const dragHandler = createAnimatedDragHandler('note', async (note, endPosition) => {
    try {
      // 传递鼠标位置用于窗口定位
      await window.electronAPI.createNoteWindow(note.id, endPosition ? { x: endPosition.x, y: endPosition.y } : {})
    } catch (error) {
      console.error('创建笔记独立窗口失败:', error)
      showError(error, '打开独立窗口失败')
    }
  }, {
    onDragStart: () => {
      // 添加拖拽开始时的自定义逻辑
      logger.log('笔记拖拽开始，添加视觉反馈');
    },
    onCreateWindow: () => {
      // 独立窗口创建成功后的回调
      logger.log('笔记独立窗口创建成功');
    }
  })

  // 过滤笔记 - 使用 useMemo 避免每次渲染都重新计算
  const filteredNotes = useMemo(() => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const TIME_WINDOW = {
      today: DAY_MS,
      '7d': 7 * DAY_MS,
      '30d': 30 * DAY_MS
    };

    const noteHasImage = (note) => {
      if (Array.isArray(note.images) && note.images.length > 0) return true;
      const text = note.content || '';
      return /!\[[^\]]*]\([^)]+\)/.test(text);
    };

    return notes.filter(note => {
      const matchesDeletedStatus = showDeleted ? note.is_deleted : !note.is_deleted;
      if (!matchesDeletedStatus) return false;

      // 标签（OR 命中）
      if (selectedTagFilters.length > 0) {
        const noteTags = note.tags ?
          (Array.isArray(note.tags) ? note.tags : note.tags.split(',').map(tag => tag.trim())) : [];
        const tagHit = selectedTagFilters.some(filterTag =>
          noteTags.some(noteTag => noteTag === filterTag || noteTag.startsWith(filterTag + '/'))
        );
        if (!tagHit) return false;
      }

      // 置顶
      if (selectedPinFilters.length > 0) {
        const isPinned = !!note.is_pinned;
        const wantPinned = selectedPinFilters.includes('pinned');
        const wantUnpinned = selectedPinFilters.includes('unpinned');
        if (wantPinned && !wantUnpinned && !isPinned) return false;
        if (wantUnpinned && !wantPinned && isPinned) return false;
      }

      // 是否含图片
      if (selectedImageFilters.length > 0) {
        const hasImg = noteHasImage(note);
        const wantHas = selectedImageFilters.includes('has');
        const wantNone = selectedImageFilters.includes('none');
        if (wantHas && !wantNone && !hasImg) return false;
        if (wantNone && !wantHas && hasImg) return false;
      }

      // 时间范围（OR 命中：任一窗口内即通过）
      if (selectedTimeFilters.length > 0) {
        const ts = note.updated_at || note.created_at;
        const t = ts ? new Date(ts).getTime() : 0;
        if (!t) return false;
        const passed = selectedTimeFilters.some((key) => {
          const win = TIME_WINDOW[key];
          if (!win) return false;
          return now - t <= win;
        });
        if (!passed) return false;
      }

      // 笔记类型
      if (selectedTypeFilters.length > 0) {
        const type = note.note_type || 'markdown';
        if (!selectedTypeFilters.includes(type)) return false;
      }

      return true;
    })
  }, [notes, showDeleted, selectedTagFilters, selectedPinFilters, selectedImageFilters, selectedTimeFilters, selectedTypeFilters])

  const totalSelectedFilters =
    selectedTagFilters.length +
    selectedPinFilters.length +
    selectedImageFilters.length +
    selectedTimeFilters.length +
    selectedTypeFilters.length

  const clearAllFilters = useCallback(() => {
    setSelectedTagFilters([])
    setSelectedPinFilters([])
    setSelectedImageFilters([])
    setSelectedTimeFilters([])
    setSelectedTypeFilters([])
  }, [])

  // 使用多选管理hook
  const multiSelect = useMultiSelectManager({
    items: filteredNotes,
    itemType: '笔记',
    onMultiSelectChange,
    onMultiSelectRefChange
  })

  useEffect(() => {
    const handleTransition = async () => {
      const alreadyLoadedCurrentView = lastFetchedViewRef.current === showDeleted && notesRef.current.length > 0
      if (alreadyLoadedCurrentView) return

      // 初次挂载（从其他视图切回笔记页）且 store 中已有笔记数据时，
      // 跳过过渡动画和重复加载，由 App.jsx 的 loadNotes 负责后台刷新
      const isInitialMount = lastFetchedViewRef.current === null
      if (isInitialMount && notesRef.current.length > 0) {
        lastFetchedViewRef.current = showDeleted
        return
      }

      lastFetchedViewRef.current = showDeleted
      isLoadingRef.current = true

      setIsTransitioning(true)

      if (showDeleted) {
        await loadNotes({ deleted: true })
      } else {
        await loadNotes()
      }

      setIsTransitioning(false)
      isLoadingRef.current = false
    }

    handleTransition()
  }, [showDeleted, loadNotes])

  // 使用通用搜索hook
  const { search: searchNotes } = useSearch({
    searchAPI: searchNotesAPI,
    onSearchResult: (results, query) => {
      // 通过store更新notes状态
      useStore.setState({ notes: results, searchQuery: query })
    },
    onError: (error) => {
      console.error('Search error:', error)
    }
  })

  // 创建稳定的回调函数，避免无限循环
  const stableSearchFunction = useCallback((query) => {
    searchNotes(query)
  }, [searchNotes])

  const stableLoadFunction = useCallback((condition) => {
    setSearchQuery('')
    loadNotes(condition)
  }, [setSearchQuery, loadNotes])

  // 使用搜索管理hook解决无限循环问题
  const { localSearchQuery, setLocalSearchQuery } = useSearchManager({
    searchFunction: stableSearchFunction,
    loadFunction: stableLoadFunction,
    searchCondition: showDeleted ? { deleted: true } : {},
    debounceDelay: 300
  })

  const handleNoteClick = useCallback((noteId) => {
    if (!multiSelect.isMultiSelectMode) {
      setSelectedNoteId(noteId)
    }
  }, [multiSelect.isMultiSelectMode, setSelectedNoteId])

  const handleMenuClick = useCallback((e, note) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
    setSelectedNote(note);
  }, []);

  const handleMenuClose = useCallback(() => {
    setAnchorEl(null)
    setSelectedNote(null)
  }, [])

  const handleTogglePin = useCallback(async () => {
    if (selectedNote) {
      await togglePinNote(selectedNote.id)
      handleMenuClose()
    }
  }, [selectedNote, togglePinNote, handleMenuClose])

  const handleDelete = useCallback(async () => {
    if (selectedNote) {
      await deleteNote(selectedNote.id)
      handleMenuClose()
    }
  }, [selectedNote, deleteNote, handleMenuClose])

  const handleDuplicateNote = useCallback(async () => {
    if (!selectedNote) return

    try {
      const sourceTitle = selectedNote.title && selectedNote.title !== '无标题' && selectedNote.title !== 'Untitled'
        ? selectedNote.title
        : ''

      const duplicated = await createNote({
        title: sourceTitle ? `${sourceTitle} ${t('notes.copySuffix')}` : '',
        content: selectedNote.content || '',
        tags: Array.isArray(selectedNote.tags) ? selectedNote.tags.join(',') : (selectedNote.tags || ''),
        note_type: selectedNote.note_type || 'markdown',
        category: selectedNote.category || '',
      })

      if (!duplicated?.success) {
        throw new Error(duplicated?.error || t('notes.duplicateFailed'))
      }

      showSuccess(t('notes.duplicateSuccess'))
      handleMenuClose()
    } catch (error) {
      showError(error, t('notes.duplicateFailed'))
    }
  }, [selectedNote, createNote, handleMenuClose, showError, showSuccess, t])

  const handleRestore = useCallback(async () => {
    if (selectedNote) {
      await restoreNote(selectedNote.id)
      handleMenuClose()
    }
  }, [selectedNote, restoreNote, handleMenuClose])

  const ensureDeleteSynced = useCallback(async () => {
    try {
      const syncAPI = window.electronAPI?.sync
      if (!syncAPI?.getStatus || !syncAPI?.manualSync) {
        return true
      }

      const statusResult = await syncAPI.getStatus()
      const v3Status = statusResult?.v3
      const notesSyncEnabled = Boolean(
        v3Status?.enabled && (v3Status?.config?.syncCategories || []).includes('notes')
      )

      // 未启用笔记云同步时，不阻塞本地永久删除
      if (!notesSyncEnabled) {
        return true
      }

      const syncResult = await syncAPI.manualSync()
      if (syncResult?.success === false) {
        const errorMessage = syncResult?.offline
          ? '当前离线，删除已加入同步队列。为避免条目被云端回灌，暂不执行永久删除。'
          : (syncResult?.error || '同步失败')
        showError(new Error(errorMessage), '永久删除前同步失败')
        return false
      }

      return true
    } catch (error) {
      showError(error, '永久删除前同步失败')
      return false
    }
  }, [showError])

  const handlePermanentDelete = useCallback(async () => {
    if (selectedNote) {
      if (!permanentDeleteConfirm) {
        // 第一次点击，设置确认状态
        setPermanentDeleteConfirm(true)
        // 3秒后自动重置状态
        setTimeout(() => {
          setPermanentDeleteConfirm(false)
        }, 3000)
      } else {
        // 第二次点击，执行删除
        const canDelete = await ensureDeleteSynced()
        if (!canDelete) {
          setPermanentDeleteConfirm(false)
          return
        }

        const { permanentDeleteNote } = useStore.getState()
        await permanentDeleteNote(selectedNote.id)
        setPermanentDeleteConfirm(false)
        handleMenuClose()
      }
    }
  }, [selectedNote, permanentDeleteConfirm, handleMenuClose, ensureDeleteSynced])

  // 在独立窗口打开笔记
  const handleOpenStandalone = useCallback(async () => {
    if (!selectedNote) return

    try {
      await window.electronAPI.createNoteWindow(selectedNote.id)
      handleMenuClose()
    } catch (error) {
      console.error('打开独立窗口失败:', error)
      showError(error, '打开独立窗口失败')
    }
  }, [selectedNote, handleMenuClose, showError])

  // 转换笔记为待办事项
  const handleConvertToTodo = useCallback(async () => {
    if (!selectedNote) return

    try {
      // 从笔记内容中提取第一行作为待办标题
      let content = '未命名待办'
      let description = ''

      if (selectedNote.content) {
        const lines = selectedNote.content.trim().split('\n').filter(line => line.trim())
        if (lines.length > 0) {
          content = lines[0].replace(/^#+\s*/, '').trim() // 移除 Markdown 标题符号
          if (lines.length > 1) {
            description = lines.slice(1).join('\n').trim()
          }
        }
      }

      // 创建待办事项 - 注意：TodoService 使用 content 字段而不是 title
      const todoData = {
        content: content.substring(0, 200), // 限制内容长度
        description: description || selectedNote.content,
        is_important: false,
        is_urgent: false,
        tags: '', // 可以根据笔记标签设置
        due_date: null,
        item_type: 'todo'
      }

      const result = await createTodo(todoData)

      if (result) {
        // 删除原笔记
        await deleteNote(selectedNote.id)

        // 显示成功提示
        logger.log('已转换为待办事项:', result)
      }

      handleMenuClose()
    } catch (error) {
      console.error('转换为待办失败:', error)
      showError(error, '转换为待办失败')
    }
  }, [selectedNote, deleteNote, handleMenuClose, showError])

  // 批量操作处理函数
  const handleBatchRestore = useCallback(async (selectedIds) => {
    if (selectedIds.length === 0) return
    setConfirmDialog({ open: true, type: 'restore', count: selectedIds.length, ids: selectedIds })
  }, [])

  const handleBatchDelete = useCallback(async (selectedIds) => {
    if (selectedIds.length === 0) return
    setConfirmDialog({ open: true, type: 'delete', count: selectedIds.length, ids: selectedIds })
  }, [])

  const handleConfirmAction = useCallback(async () => {
    const { type, ids } = confirmDialog
    setConfirmDialog({ open: false, type: '', count: 0, ids: [] })
    
    const result = type === 'restore' 
      ? await batchRestoreNotes(ids)
      : await batchDeleteNotes(ids)
    
    if (result.success) {
      multiSelect.clearSelection()
    }
  }, [confirmDialog, batchRestoreNotes, batchDeleteNotes, multiSelect])

  const handleBatchPermanentDelete = useCallback(async (selectedIds) => {
    if (selectedIds.length === 0) return

    if (!batchPermanentDeleteConfirm) {
      setBatchPermanentDeleteConfirm(true)
      setTimeout(() => setBatchPermanentDeleteConfirm(false), 3000)
    } else {
      const canDelete = await ensureDeleteSynced()
      if (!canDelete) {
        setBatchPermanentDeleteConfirm(false)
        return
      }

      const result = await batchPermanentDeleteNotes(selectedIds)
      if (result.success) multiSelect.clearSelection()
      setBatchPermanentDeleteConfirm(false)
    }
  }, [batchPermanentDeleteNotes, batchPermanentDeleteConfirm, multiSelect, ensureDeleteSynced])

  const handleClearSearch = useCallback(() => {
    setLocalSearchQuery('')
  }, [setLocalSearchQuery])

  const formatDate = (value) => {
    return formatRelativeNoteTime(value, {
      locale: dateFnsZhCN,
      unknownText: t('notes.unknownTime')
    })
  }

  const getPreviewText = (content, noteType, skipChars = 0) => {
    if (!content) return t('notes.emptyNote')

    // Handle whiteboard notes specially
    if (noteType === 'whiteboard') {
      try {
        const whiteboardData = JSON.parse(content)
        const texts = whiteboardData.elements
          ?.filter(e => e.type === 'text' && !e.isDeleted && e.text?.trim())
          .map(e => stripMarkdownToPreviewText(e.text).trim())
          .filter(Boolean) || []
        if (texts.length > 0) return texts.join(' ').substring(0, 100)
        const count = whiteboardData.elements?.filter(e => !e.isDeleted)?.length || 0
        return count > 0 ? `画布笔记 · ${count} 个元素` : '画布笔记'
      } catch (error) {
        return '画布笔记'
      }
    }

    const clean = stripMarkdownToPreviewText(content)

    if (skipChars > 0) {
      const remaining = clean.substring(skipChars).trim()
      return remaining.substring(0, 100) || null
    }
    return clean.substring(0, 100) || null
  }

  // 获取笔记显示标题：如果有标题则显示标题，否则显示内容前9个字
  const getNoteDisplayTitle = (note) => {
    if (note.title && note.title !== '无标题' && note.title !== 'Untitled') {
      return note.title
    }
    if (note.content) {
      if (note.note_type === 'whiteboard') {
        return '画布笔记'
      }
      // Reuse the same preview cleaning for title fallback
      const preview = getPreviewText(note.content, note.note_type, 0)
      if (preview) {
        return preview.substring(0, 9) + (preview.length > 9 ? '...' : '')
      }
    }
    return t('notes.untitled')
  }

  // 获取笔记内容预览：如果标题显示的是内容前9个字，则预览从第9个字开始
  const getNotePreviewText = (note) => {
    const hasRealTitle = note.title && note.title !== '无标题' && note.title !== 'Untitled'
    if (hasRealTitle) {
      // 有真实标题，预览显示完整内容
      return getPreviewText(note.content, note.note_type, 0)
    } else {
      // 标题显示的是内容前9个字，预览从第9个字开始
      return getPreviewText(note.content, note.note_type, 9)
    }
  }

  // 渲染加载状态
  const renderLoadingState = () => (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '200px',
      gap: 2
    }}>
      <CircularProgress size={40} />
      <Typography variant="body2" color="text.secondary">
        {showDeleted ? t('notes.loadingTrash') : t('notes.loadingNotes')}
      </Typography>
    </Box>
  )

  // 仅在完全没有笔记数据时才显示骨架屏，
  // 已有数据时让列表保持可见，后台静默刷新，避免切换视图时闪烁
  if (isLoading && !isTransitioning && filteredNotes.length === 0) {
    return (
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0
      }}>
        <Box sx={{ p: 2, pb: 1, flexShrink: 0 }}>
          <Skeleton variant="rectangular" height={40} />
        </Box>
        <Box sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 0
        }}>
          {renderLoadingState()}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={(theme) => ({
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
      backgroundColor: theme.palette.mode === 'dark'
        ? 'rgba(30, 41, 59, 0.85)'
        : 'rgba(255, 255, 255, 0.85)',
      backdropFilter: 'blur(12px) saturate(150%)',
      WebkitBackdropFilter: 'blur(12px) saturate(150%)'
    })}>
      {/* 搜索框 */}
      <Box
        sx={{
          pl: NOTE_LIST_GUTTER,
          pr: `calc(${NOTE_LIST_GUTTER} + ${NOTE_SCROLLBAR_COMPENSATION})`,
          pt: 0.625,
          pb: 0.5,
          flexShrink: 0
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder={showDeleted ? placeholder.searchNotesDeleted : placeholder.searchNotes}
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
          aria-label="搜索笔记"
          sx={{
            '& .MuiOutlinedInput-root': {
              height: 34,
              borderRadius: '12px',
              fontSize: '0.8125rem',
              paddingLeft: '8px',
              paddingRight: '4px',
              backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.62)',
            },
            '& .MuiOutlinedInput-input': {
              padding: '6px 4px',
            },
            '& .MuiInputAdornment-root': {
              marginRight: '4px',
            },
            '& .MuiSvgIcon-root': {
              fontSize: 18,
            },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
              endAdornment: (
                <>
                  {localSearchQuery && (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={handleClearSearch} aria-label="清除搜索">
                        <ClearIcon />
                      </IconButton>
                    </InputAdornment>
                  )}
                <FilterToggleButton
                  ref={filterAnchorRef}
                  filtersVisible={filtersVisible}
                  onToggle={toggleFiltersVisibility}
                  selectedCount={totalSelectedFilters}
                />
                </>
              )
            }
          }}
        />

        <FilterPopover
          open={filtersVisible}
          anchorRef={filterAnchorRef}
          onClose={() => { if (filtersVisible) toggleFiltersVisibility() }}
          title="筛选笔记"
          totalSelected={totalSelectedFilters}
          onClearAll={clearAllFilters}
        >
          <FilterContainer
            showTagFilter={true}
            selectedTags={selectedTagFilters}
            onTagsChange={setSelectedTagFilters}
            showDeleted={showDeleted}
            extraGroups={[
              <ChoiceFilter
                key="type"
                title="类型"
                icon={<CategoryIcon />}
                options={[
                  { key: 'markdown', label: 'Markdown', icon: <MarkdownIcon sx={{ fontSize: 14 }} /> },
                  { key: 'whiteboard', label: '白板', icon: <WhiteboardIcon sx={{ fontSize: 14 }} /> }
                ]}
                selectedKeys={selectedTypeFilters}
                onChange={setSelectedTypeFilters}
              />,
              <ChoiceFilter
                key="pin"
                title="置顶"
                icon={<PinIcon />}
                options={[
                  { key: 'pinned', label: '已置顶' },
                  { key: 'unpinned', label: '未置顶' }
                ]}
                selectedKeys={selectedPinFilters}
                onChange={setSelectedPinFilters}
              />,
              <ChoiceFilter
                key="image"
                title="图片"
                icon={<ImageIcon />}
                options={[
                  { key: 'has', label: '含图片' },
                  { key: 'none', label: '无图片' }
                ]}
                selectedKeys={selectedImageFilters}
                onChange={setSelectedImageFilters}
              />,
              <ChoiceFilter
                key="time"
                title="时间范围"
                icon={<AccessTimeIcon />}
                options={[
                  { key: 'today', label: '今天' },
                  { key: '7d', label: '7 天内' },
                  { key: '30d', label: '30 天内' }
                ]}
                selectedKeys={selectedTimeFilters}
                onChange={setSelectedTimeFilters}
              />
            ]}
          />
        </FilterPopover>
      </Box>

      {/* 多选工具栏 */}
      {multiSelect.isMultiSelectMode && (
        <MultiSelectToolbar
          selectedCount={multiSelect.selectedIds.length}
          totalCount={filteredNotes.length}
          itemType="笔记"
          onSelectAll={() => multiSelect.selectAll(filteredNotes)}
          onSelectNone={multiSelect.selectNone}
          onDelete={showDeleted ? undefined : handleBatchDelete}
          onClose={multiSelect.exitMultiSelectMode}
          customActions={showDeleted ? [
            {
              label: t('notes.batchRestore'),
              icon: <RestoreIcon />,
              onClick: () => handleBatchRestore(multiSelect.selectedIds),
              color: 'primary'
            },
            {
              label: batchPermanentDeleteConfirm ? t('notes.confirmDelete') : t('notes.permanentDelete'),
              icon: <DeleteForeverIcon />,
              onClick: () => handleBatchPermanentDelete(multiSelect.selectedIds),
              color: batchPermanentDeleteConfirm ? 'error' : 'inherit',
              sx: batchPermanentDeleteConfirm ? {
                backgroundColor: 'error.main',
                color: 'error.contrastText',
                '&:hover': {
                  backgroundColor: 'error.dark'
                }
              } : {}
            }
          ] : []}
        />
      )}

      {/* 笔记列表 */}
      <Box sx={{
        flex: 1,
        overflow: 'auto',
        position: 'relative',
        minHeight: 0,
        scrollbarGutter: 'stable'
      }}>
        {/* 过渡加载状态 */}
        {isTransitioning && (
          <Box sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'background.paper',
            zIndex: 1
          }}>
            {renderLoadingState()}
          </Box>
        )}

        {/* 笔记内容 */}
        <Fade in={!isTransitioning} timeout={200}>
          <Box>
            {filteredNotes.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <NoteIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                  {showDeleted ? t('notes.trashEmpty') : t('notes.noNotes')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {showDeleted ? t('notes.trashEmptyDesc') : t('notes.noNotesDesc')}
                </Typography>
              </Box>
            ) : (
              <List sx={{ py: 0, px: NOTE_LIST_GUTTER }}>
                {filteredNotes.map((note) => (
                  <React.Fragment key={note.id}>
                    <ListItem
                      disablePadding
                      sx={{
                        mb: 0.25,
                        position: 'relative',
                        width: '100%',
                        display: 'block',
                        borderRadius: NOTE_ITEM_RADIUS,
                        '&:hover .note-menu-button': {
                          opacity: 1
                        }
                      }}
                    >
                      <ListItemButton
                        selected={!multiSelect.isMultiSelectMode && selectedNoteId === note.id}
                        onClick={(e) => {
                          // 检查是否点击了菜单按钮或其子元素
                          if (e.target.closest('.note-menu-button')) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          multiSelect.handleClick(e, note.id, handleNoteClick)
                        }}
                        onContextMenu={(e) => multiSelect.handleContextMenu(
                          e,
                          note.id,
                          multiSelect.isMultiSelectMode,
                          () => handleMenuClick(e, note)
                        )}
                        onMouseDown={(e) => {
                          // 检查是否点击了菜单按钮
                          if (e.target.closest('.note-menu-button')) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          // 只在非多选模式下启用拖拽
                          if (!multiSelect.isMultiSelectMode && e.button === 0) {
                            dragHandler.handleDragStart(e, note)
                          }
                        }}
                        sx={{
                          position: 'relative',
                          width: '100%',
                          maxWidth: 'none',
                          boxSizing: 'border-box',
                          m: '0 !important',
                          borderRadius: NOTE_ITEM_RADIUS,
                          overflow: 'hidden',
                          backgroundClip: 'padding-box',
                          border: '1px solid',
                          borderColor: note.is_pinned
                            ? theme.palette.primary.main + '80'
                            : 'transparent',
                          backgroundColor: note.is_pinned
                            ? (theme.palette.mode === 'dark' ? theme.palette.primary.main + '14' : theme.palette.primary.main + '0A')
                            : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.6)'),
                          transition: 'background-color 0.2s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s cubic-bezier(0.4,0,0.2,1), border-color 0.2s cubic-bezier(0.4,0,0.2,1)',
                          minHeight: 46,
                          py: 0.5,
                          px: 1.25,
                          pr: 1.25,
                          '& .MuiTouchRipple-root': {
                            borderRadius: 'inherit'
                          },
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                            borderRadius: NOTE_ITEM_RADIUS,
                            boxShadow: NOTE_ITEM_SHADOW,
                            borderColor: note.is_pinned ? theme.palette.primary.main : theme.palette.divider,
                            zIndex: 1,
                          },
                          '&.Mui-selected': {
                            borderRadius: NOTE_ITEM_RADIUS,
                            backgroundColor: theme.palette.mode === 'dark'
                              ? theme.palette.primary.main + '1F'
                              : theme.palette.primary.main + '12',
                            borderColor: theme.palette.primary.main + '40',
                            '&:hover': {
                              borderRadius: NOTE_ITEM_RADIUS,
                              boxShadow: NOTE_ITEM_SHADOW,
                              backgroundColor: theme.palette.mode === 'dark'
                                ? theme.palette.primary.main + '29'
                                : theme.palette.primary.main + '1A'
                            }
                          },
                          ...(multiSelect.isMultiSelectMode && multiSelect.isSelected(note.id) && {
                            backgroundColor: 'action.selected',
                            borderColor: theme.palette.primary.main,
                            borderRadius: NOTE_ITEM_RADIUS,
                            '&:hover': {
                              borderRadius: NOTE_ITEM_RADIUS,
                              boxShadow: NOTE_ITEM_SHADOW,
                              backgroundColor: 'action.selected'
                            }
                          })
                        }}
                      >
                        {multiSelect.isMultiSelectMode && (
                          <ListItemIcon sx={{ minWidth: 30 }}>
                            <Checkbox
                              checked={multiSelect.isSelected(note.id)}
                              size="small"
                              sx={{ p: 0.5 }}
                            />
                          </ListItemIcon>
                        )}
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                              {!!note.note_type && note.note_type === 'whiteboard' && (
                                <WhiteboardIcon sx={{ fontSize: 12, color: 'text.disabled', flexShrink: 0, alignSelf: 'center' }} />
                              )}
                              <Typography
                                variant="subtitle2"
                                sx={{
                                  fontWeight: note.is_pinned ? 600 : 500,
                                  fontSize: '0.8125rem',
                                  lineHeight: 1.35,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                  minWidth: 0
                                }}
                              >
                                {getNoteDisplayTitle(note)}
                              </Typography>
                            </Box>
                          }
                          secondary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, mt: 0.25 }}>
                              {getNotePreviewText(note) && (
                                <Typography
                                  component="span"
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    display: 'block',
                                    fontSize: '0.75rem',
                                    lineHeight: 1.4,
                                    opacity: 0.85,
                                    flex: 1,
                                    minWidth: 0
                                  }}
                                >
                                  {getNotePreviewText(note)}
                                </Typography>
                              )}
                              <Typography
                                component="span"
                                variant="caption"
                                color="text.secondary"
                                sx={{
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                  fontSize: '0.6875rem',
                                  lineHeight: 1.35,
                                  opacity: 0.56,
                                  ml: getNotePreviewText(note) ? 0 : 'auto',
                                  pr: 2.25
                                }}
                              >
                                {formatDate(note.updated_at || note.created_at)}
                              </Typography>
                            </Box>
                          }
                          sx={{ my: 0 }}
                          slotProps={{
                            primary: { component: 'div' },
                            secondary: { component: 'div' }
                          }}
                        />
                        {/* 菜单按钮 - 绝对定位在右上角 */}
                        {!multiSelect.isMultiSelectMode && (
                          <IconButton
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleMenuClick(e, note);
                            }}
                            aria-label="更多操作"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            size="small"
                            className="note-menu-button"
                            sx={{
                              position: 'absolute',
                              right: 6,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              width: 26,
                              height: 26,
                              opacity: 0,
                              transition: 'opacity 0.2s, background-color 0.2s',
                              zIndex: 10,
                              padding: 0,
                              backgroundColor: 'transparent',
                              '&:hover': {
                                opacity: 1,
                                backgroundColor: theme.palette.action.hover
                              }
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        )}
                      </ListItemButton>
                    </ListItem>
                  </React.Fragment>
                ))}
              </List>
            )}
          </Box>
        </Fade>
      </Box >

      {/* 右键菜单 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{
          paper: {
            sx: (theme) => ({
              backdropFilter: theme?.custom?.glass?.backdropFilter || 'blur(6px)',
              backgroundColor: theme?.custom?.glass?.background || (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.4)'),
              border: theme?.custom?.glass?.border || `1px solid ${theme.palette.divider}`,
              borderRadius: 1
            })
          }
        }}
      >
        {
          showDeleted ? (
            [
              <MenuItem
                key="enter-multi-select"
                onClick={() => {
                  if (selectedNote?.id) {
                    multiSelect.enterMultiSelectMode(selectedNote.id)
                  }
                  handleMenuClose()
                }}
                disabled={multiSelect.isMultiSelectMode || !selectedNote?.id}
              >
                <ListItemIcon>
                  <SelectAllIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('common.enterMultiSelect')}</ListItemText>
              </MenuItem>,
              <Divider key="divider-enter-multi-select" />,
              <MenuItem key="restore" onClick={handleRestore} >
                <ListItemIcon>
                  <RestoreIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('notes.restoreNote')}</ListItemText>
              </MenuItem>,
              <MenuItem
                key="permanent-delete"
                onClick={handlePermanentDelete}
                sx={permanentDeleteConfirm ? {
                  backgroundColor: 'error.main',
                  color: 'error.contrastText',
                  '&:hover': {
                    backgroundColor: 'error.dark'
                  }
                } : {}}
              >
                <ListItemIcon>
                  <DeleteIcon fontSize="small" color={permanentDeleteConfirm ? "inherit" : "error"} />
                </ListItemIcon>
                <ListItemText>{permanentDeleteConfirm ? t('notes.confirmDelete') : t('notes.permanentDelete')}</ListItemText>
              </MenuItem>
            ]
          ) : (
            [
              <MenuItem
                key="enter-multi-select"
                onClick={() => {
                  if (selectedNote?.id) {
                    multiSelect.enterMultiSelectMode(selectedNote.id)
                  }
                  handleMenuClose()
                }}
                disabled={multiSelect.isMultiSelectMode || !selectedNote?.id}
              >
                <ListItemIcon>
                  <SelectAllIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('common.enterMultiSelect')}</ListItemText>
              </MenuItem>,
              <Divider key="divider-enter-multi-select" />,
              <MenuItem key="pin" onClick={handleTogglePin}>
                <ListItemIcon>
                  {selectedNote?.is_pinned ? (
                    <PinOutlinedIcon fontSize="small" />
                  ) : (
                    <PinIcon fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText>
                  {selectedNote?.is_pinned ? t('notes.unpinNote') : t('notes.pinNote')}
                </ListItemText>
              </MenuItem>,
              <MenuItem key="standalone" onClick={handleOpenStandalone}>
                <ListItemIcon>
                  <WindowIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('notes.openInNewWindow')}</ListItemText>
              </MenuItem>,
              <MenuItem key="convert" onClick={handleConvertToTodo}>
                <ListItemIcon>
                  <TodoIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('notes.convertToTodo')}</ListItemText>
              </MenuItem>,
              <MenuItem key="duplicate" onClick={handleDuplicateNote}>
                <ListItemIcon>
                  <CopyIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('notes.duplicateNote')}</ListItemText>
              </MenuItem>,
              <Divider key="divider" />,
              <MenuItem key="delete" onClick={handleDelete}>
                <ListItemIcon>
                  <DeleteIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('notes.deleteNote')}</ListItemText>
              </MenuItem>
            ]
          )}
      </Menu >

      {/* 批量操作确认对话框 */}
      <Dialog 
        open={confirmDialog.open} 
        onClose={() => setConfirmDialog({ open: false, type: '', count: 0, ids: [] })} 
        maxWidth="xs" 
        fullWidth
      >
        <DialogTitle>
          {confirmDialog.type === 'restore' ? '确认恢复' : '确认删除'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要{confirmDialog.type === 'restore' ? '恢复' : '删除'} {confirmDialog.count} 个笔记吗？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ open: false, type: '', count: 0, ids: [] })}>取消</Button>
          <Button 
            onClick={handleConfirmAction} 
            color={confirmDialog.type === 'restore' ? 'primary' : 'error'} 
            variant="contained"
          >
            确认
          </Button>
        </DialogActions>
      </Dialog>
    </Box >
  )
}

export default NoteList
