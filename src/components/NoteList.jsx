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
  Paper,
  Skeleton,
  Fade,
  Collapse,
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
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Note as NoteIcon,
  Brush as WhiteboardIcon,
  Restore as RestoreIcon,
  DeleteForever as DeleteForeverIcon,
  CheckCircle as TodoIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material'
import { useStore } from '../store/useStore'
import { formatDistanceToNow } from 'date-fns'
import { zhCN as dateFnsZhCN } from 'date-fns/locale/zh-CN'
import { createTodo } from '../api/todoAPI'
import { useMultiSelect } from '../hooks/useMultiSelect'
import { useSearch } from '../hooks/useSearch'
import { useSearchManager } from '../hooks/useSearchManager'
import { useMultiSelectManager } from '../hooks/useMultiSelectManager'
import { useFiltersVisibility } from '../hooks/useFiltersVisibility'
import { searchNotesAPI } from '../api/searchAPI'
import TagFilter from './TagFilter'
import FilterToggleButton from './FilterToggleButton'
import zhCN from '../locales/zh-CN'

const {
  filters: { placeholder }
} = zhCN;
import MultiSelectToolbar from './MultiSelectToolbar'
import { createDragHandler } from '../utils/DragManager'
import { useDragAnimation } from './DragAnimationProvider'
import { ANIMATIONS, createTransitionString } from '../utils/animationConfig'
import { useError } from './ErrorProvider'
import logger from '../utils/logger'

const NoteList = ({ showDeleted = false, onMultiSelectChange, onMultiSelectRefChange }) => {
  const { t } = useTranslation()
  const { showError, showSuccess } = useError()
  const theme = useTheme()
  const {
    notes,
    selectedNoteId,
    searchQuery,
    isLoading,
    setSelectedNoteId,
    setSearchQuery,
    loadNotes,
    deleteNote,
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
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState(false)
  const [batchPermanentDeleteConfirm, setBatchPermanentDeleteConfirm] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ 
    open: false, 
    type: '', // 'restore' | 'delete'
    count: 0, 
    ids: [] 
  })

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
    onDragStart: (dragData) => {
      // 添加拖拽开始时的自定义逻辑
      logger.log('笔记拖拽开始，添加视觉反馈');
    },
    onCreateWindow: (dragData) => {
      // 独立窗口创建成功后的回调
      logger.log('笔记独立窗口创建成功');
    }
  })

  // 过滤笔记 - 使用 useMemo 避免每次渲染都重新计算
  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      const matchesDeletedStatus = showDeleted ? note.is_deleted : !note.is_deleted;

      // 如果没有选择标签筛选，只按删除状态筛选
      if (selectedTagFilters.length === 0) {
        return matchesDeletedStatus;
      }

      // 检查笔记是否包含选中的标签（层级前缀匹配：选中 "论文" 也匹配 "论文/初稿"）
      const noteTags = note.tags ?
        (Array.isArray(note.tags) ? note.tags : note.tags.split(',').map(tag => tag.trim())) : [];
      const hasSelectedTags = selectedTagFilters.some(filterTag =>
        noteTags.some(noteTag => noteTag === filterTag || noteTag.startsWith(filterTag + '/'))
      );

      return matchesDeletedStatus && hasSelectedTags;
    })
  }, [notes, showDeleted, selectedTagFilters])

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
  const { search: searchNotes, isSearching } = useSearch({
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

  const handleRestore = useCallback(async () => {
    if (selectedNote) {
      await restoreNote(selectedNote.id)
      handleMenuClose()
    }
  }, [selectedNote, restoreNote, handleMenuClose])

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
        const { permanentDeleteNote } = useStore.getState()
        await permanentDeleteNote(selectedNote.id)
        setPermanentDeleteConfirm(false)
        handleMenuClose()
      }
    }
  }, [selectedNote, permanentDeleteConfirm, handleMenuClose])

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
      const result = await batchPermanentDeleteNotes(selectedIds)
      if (result.success) multiSelect.clearSelection()
      setBatchPermanentDeleteConfirm(false)
    }
  }, [batchPermanentDeleteNotes, batchPermanentDeleteConfirm, multiSelect])

  const handleClearSearch = useCallback(() => {
    setLocalSearchQuery('')
  }, [setLocalSearchQuery])

  const formatDate = (value) => {
    if (!value) return t('notes.unknownTime')

    try {
      const str = String(value)
      // 尝试解析：纯数字 → 时间戳，包含 T/Z → ISO，否则 → SQLite 格式
      const date = /^\d+$/.test(str) 
        ? new Date(Number(str))
        : (str.includes('T') || str.includes('Z'))
          ? new Date(str)
          : new Date(str.replace(' ', 'T') + 'Z')

      return isNaN(date.getTime()) 
        ? t('notes.unknownTime')
        : formatDistanceToNow(date, { addSuffix: true, locale: dateFnsZhCN })
    } catch {
      return t('notes.unknownTime')
    }
  }

  const getPreviewText = (content, noteType, skipChars = 0) => {
    if (!content) return t('notes.emptyNote')

    // Handle whiteboard notes specially
    if (noteType === 'whiteboard') {
      try {
        const whiteboardData = JSON.parse(content)
        return t('notes.whiteboardElements', { count: whiteboardData.elements?.length || 0 })
      } catch (error) {
        return t('notes.whiteboardNote')
      }
    }

    // Handle markdown notes normally
    const cleanContent = content.replace(/[#*`\n]/g, '')
    // 如果需要跳过前面的字符（用于标题已显示的部分）
    if (skipChars > 0) {
      const remainingContent = cleanContent.substring(skipChars).trim()
      // 如果跳过后没有内容，返回null（不显示预览）
      return remainingContent.substring(0, 100) || null
    }
    return cleanContent.substring(0, 100) || null
  }

  // 获取笔记显示标题：如果有标题则显示标题，否则显示内容前9个字
  const getNoteDisplayTitle = (note) => {
    if (note.title && note.title !== '无标题' && note.title !== 'Untitled') {
      return note.title
    }
    // 没有标题时，显示内容前9个字
    if (note.content) {
      // 白板笔记特殊处理
      if (note.note_type === 'whiteboard') {
        return t('notes.whiteboardNote')
      }
      const cleanContent = note.content.replace(/[#*`\n]/g, '').trim()
      if (cleanContent) {
        return cleanContent.substring(0, 9) + (cleanContent.length > 9 ? '...' : '')
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
      <Box sx={{ p: 2, pb: 1, flexShrink: 0 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={showDeleted ? placeholder.searchNotesDeleted : placeholder.searchNotes}
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
            endAdornment: (
              <>
                {localSearchQuery && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={handleClearSearch}>
                      <ClearIcon />
                    </IconButton>
                  </InputAdornment>
                )}
                <FilterToggleButton
                  filtersVisible={filtersVisible}
                  onToggle={toggleFiltersVisibility}
                />
              </>
            )
          }}
        />

        {/* 标签筛选 */}
        <Collapse
          in={filtersVisible}
          timeout={200}
          easing={{
            enter: ANIMATIONS.dragTransition.easing,
            exit: 'cubic-bezier(0.55, 0.06, 0.68, 0.19)'
          }}
          sx={{
            '& .MuiCollapse-wrapper': {
              transition: createTransitionString(ANIMATIONS.dragTransition)
            }
          }}
        >
          <TagFilter
            selectedTags={selectedTagFilters}
            onTagsChange={setSelectedTagFilters}
            showDeleted={showDeleted}
            sx={{ mt: 1 }}
          />
        </Collapse>
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
        minHeight: 0
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
              <List sx={{ py: 0 }}>
                {filteredNotes.map((note, index) => (
                  <React.Fragment key={note.id}>
                    <ListItem
                      disablePadding
                      sx={{
                        mb: 0.5,
                        position: 'relative',
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
                        onContextMenu={(e) => multiSelect.handleContextMenu(e, note.id, multiSelect.isMultiSelectMode)}
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
                          borderRadius: '12px',
                          border: '1px solid',
                          borderColor: 'transparent',
                          backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.6)',
                          transition: 'background-color 0.2s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s cubic-bezier(0.4,0,0.2,1), border-color 0.2s cubic-bezier(0.4,0,0.2,1)',
                          py: 1,
                          pr: multiSelect.isMultiSelectMode ? 2 : 6,
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            borderColor: theme.palette.divider,
                            zIndex: 1,
                          },
                          '&.Mui-selected': {
                            backgroundColor: theme.palette.primary.main + '1A', // 10% 透明度
                            borderColor: theme.palette.primary.main + '33',
                            '&:hover': {
                              backgroundColor: theme.palette.primary.main + '26'
                            }
                          },
                          ...(multiSelect.isMultiSelectMode && multiSelect.isSelected(note.id) && {
                            backgroundColor: 'action.selected',
                            borderColor: theme.palette.primary.main,
                            '&:hover': {
                              backgroundColor: 'action.selected'
                            }
                          })
                        }}
                      >
                        {multiSelect.isMultiSelectMode && (
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <Checkbox
                              checked={multiSelect.isSelected(note.id)}
                              size="small"
                              sx={{ p: 0.5 }}
                            />
                          </ListItemIcon>
                        )}
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          {note.is_pinned ? (
                            <PinIcon color="primary" fontSize="small" />
                          ) : note.note_type === 'whiteboard' ? (
                            <WhiteboardIcon color="action" fontSize="small" />
                          ) : (
                            <NoteIcon color="action" fontSize="small" />
                          )}
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography
                                variant="subtitle2"
                                sx={{
                                  fontWeight: note.is_pinned ? 600 : 500,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1
                                }}
                              >
                                {getNoteDisplayTitle(note)}
                              </Typography>
                            </Box>
                          }
                          secondary={
                            <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                              {getNotePreviewText(note) && (
                                <Typography
                                  component="span"
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    mb: 0.5,
                                    display: 'block',
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  {getNotePreviewText(note)}
                                </Typography>
                              )}
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', opacity: 0.8 }}>
                                {formatDate(note.updated_at)}
                              </Typography>
                            </Box>
                          }
                          primaryTypographyProps={{ component: 'div' }}
                          secondaryTypographyProps={{ component: 'div' }}
                        />
                        {/* 菜单按钮 - 绝对定位在右上角 */}
                        {!multiSelect.isMultiSelectMode && (
                          <IconButton
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleMenuClick(e, note);
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            size="small"
                            className="note-menu-button"
                            sx={{
                              position: 'absolute',
                              right: 8,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              opacity: 0.3,
                              transition: 'opacity 0.2s',
                              zIndex: 10,
                              backgroundColor: theme.palette.background.paper,
                              '&:hover': {
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
        PaperProps={{
          sx: (theme) => ({
            backdropFilter: theme?.custom?.glass?.backdropFilter || 'blur(6px)',
            backgroundColor: theme?.custom?.glass?.background || (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.4)'),
            border: theme?.custom?.glass?.border || `1px solid ${theme.palette.divider}`,
            borderRadius: 1
          })
        }}
      >
        {
          showDeleted ? (
            [
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
                  <OpenInNewIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('notes.openInNewWindow')}</ListItemText>
              </MenuItem>,
              <MenuItem key="convert" onClick={handleConvertToTodo}>
                <ListItemIcon>
                  <TodoIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('notes.convertToTodo')}</ListItemText>
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
