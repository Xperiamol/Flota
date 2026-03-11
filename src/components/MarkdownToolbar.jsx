import React from 'react'
import {
  Box,
  IconButton,
  Tooltip,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText
} from '@mui/material'
import {
  FormatBold as BoldIcon,
  FormatItalic as ItalicIcon,
  FormatStrikethrough as StrikethroughIcon,
  Code as CodeIcon,
  Link as LinkIcon,
  FormatListBulleted as BulletListIcon,
  FormatListNumbered as NumberListIcon,
  CheckBox as TaskListIcon,
  FormatQuote as QuoteIcon,
  TableChart as TableIcon,
  Edit as EditIcon,
  Visibility as PreviewIcon,
  ViewColumn as SplitViewIcon,
  Highlight as HighlightIcon,
  Palette as ColorIcon,
  TipsAndUpdates as CalloutIcon,
  HorizontalRule as DividerIcon,
  FormatClear as ClearFormatIcon,
  ArrowDropDown as DropdownIcon,
  AutoFixHigh as RewriteIcon,
  Summarize as SummarizeIcon,
  Translate as TranslateIcon,
  AutoAwesome as ContinueIcon,
  Chat as ChatIcon,
  InsertLink as WikiLinkIcon,
  DataObject as CodeBlockIcon,
  Checklist as MeetingTodoIcon,
  Email as FollowupEmailIcon
} from '@mui/icons-material'
import ImageUploadButton from './ImageUploadButton'
import AudioRecordButton from './AudioRecordButton'
import { useStore } from '../store/useStore'
import { STANDARD_CALLOUT_TYPES } from '../markdown/calloutConfig.js'

// 所有可用工具栏项的定义（id → 渲染配置）
const ALL_TOOLBAR_ITEMS = {
  heading:    { group: 'paragraph', label: '标题', type: 'heading' },
  bold:       { group: 'inline', label: '粗体', icon: BoldIcon, inline: ['**', '**', '粗体文本'] },
  italic:     { group: 'inline', label: '斜体', icon: ItalicIcon, inline: ['*', '*', '斜体文本'] },
  strike:     { group: 'inline', label: '删除线', icon: StrikethroughIcon, inline: ['~~', '~~', '删除线文本'] },
  inlineCode: { group: 'inline', label: '行内代码', icon: CodeIcon, inline: ['`', '`', '代码'] },
  highlight:  { group: 'inline', label: '高亮', icon: HighlightIcon, inline: ['==', '==', '高亮文本'] },
  bulletList: { group: 'list', label: '无序列表', icon: BulletListIcon, block: '- ' },
  orderedList:{ group: 'list', label: '有序列表', icon: NumberListIcon, block: '1. ' },
  taskList:   { group: 'list', label: '任务列表', icon: TaskListIcon, block: '- [ ] ' },
  quote:      { group: 'list', label: '引用', icon: QuoteIcon, block: '> ' },
  link:       { group: 'insert', label: '链接', icon: LinkIcon, inline: ['[', '](url)', '链接文本'] },
  table:      { group: 'insert', label: '表格', icon: TableIcon, insert: '| 列1 | 列2 | 列3 |\n|-----|-----|-----|\n| 内容1 | 内容2 | 内容3 |\n' },
  codeBlock:  { group: 'insert', label: '代码块', type: 'codeBlock' },
  divider:    { group: 'insert', label: '分割线', icon: DividerIcon, insert: '\n---\n' },
  image:      { group: 'insert', label: '图片', type: 'image' },
  audio:      { group: 'insert', label: '录音', type: 'audio' },
  wikiLink:   { group: 'ext', label: 'Wiki 链接', type: 'wikiLink' },
  colorText:  { group: 'ext', label: '彩色文本', icon: ColorIcon, type: 'colorMenu' },
  callout:    { group: 'ext', label: '提示框', icon: CalloutIcon, type: 'calloutMenu' },
  clearFormat: { group: 'ext', label: '清除格式', icon: ClearFormatIcon, type: 'clearFormat' },
  // AI 浮动面板动作
  aiRewrite:   { group: 'ai', label: 'AI 改写', icon: RewriteIcon, aiAction: { prompt: '请改写以下文本，保持原意但使其更流畅自然：\n\n' } },
  aiSummarize: { group: 'ai', label: 'AI 摘要', icon: SummarizeIcon, aiAction: { prompt: '请用简洁的语言总结以下文本的要点：\n\n' } },
  aiTranslate: { group: 'ai', label: 'AI 翻译', icon: TranslateIcon, aiAction: { prompt: '请将以下文本翻译为英文（如果原文是英文则翻译为中文）：\n\n' } },
  aiContinue:  { group: 'ai', label: 'AI 续写', icon: ContinueIcon, aiAction: { prompt: '请根据上下文自然地续写以下文本：\n\n' } },
  aiMeetingTodos: { group: 'ai', label: '提取会议待办', icon: MeetingTodoIcon, aiAction: { prompt: '请从以下会议记录中提取所有待办事项，按责任人分类列出，格式为 Markdown 任务列表（- [ ] 事项 @责任人 截止日期）：\n\n' } },
  aiFollowupEmail: { group: 'ai', label: '会议跟进邮件', icon: FollowupEmailIcon, aiAction: { prompt: '请根据以下会议记录生成一封专业的会议跟进邮件，包含会议要点、决议事项、待办跟进和下次会议安排：\n\n' } },
  aiChat:      { group: 'ai', label: '自由提问', icon: ChatIcon, aiAction: { isChat: true } },
}

const DEFAULT_TOOLBAR_ORDER = [
  'heading', '|',
  'bold', 'italic', 'strike', 'inlineCode', 'highlight', '|',
  'bulletList', 'orderedList', 'taskList', 'quote', '|',
  'link', 'table', 'codeBlock', 'divider', 'image', 'audio', '|',
  'wikiLink', 'colorText', 'callout', 'clearFormat',
]

const DEFAULT_FLOATING_ORDER = [
  'aiRewrite', 'aiSummarize', 'aiTranslate', 'aiContinue', 'aiMeetingTodos', 'aiFollowupEmail', 'aiChat',
]

/**
 * 执行 WYSIWYG 命令（根据 ALL_TOOLBAR_ITEMS 的 def 直接映射到 TipTap 操作）
 * 供 MarkdownToolbar / AIAssistPanel 共用，消除重复逻辑
 */
const COLOR_MAP = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899' }

// ── 统一的 WYSIWYG 命令映射（handleWYSIWYGInsert 和 execWYSIWYGCommand 共用） ──
const WYSIWYG_MAP = {
  '**':  (c) => c.toggleBold().run(),
  '*':   (c) => c.toggleItalic().run(),
  '~~':  (c) => c.toggleStrike().run(),
  '`':   (c) => c.toggleCode().run(),
  '==':  (c) => c.toggleHighlight().run(),
  '- ':  (c) => c.toggleBulletList().run(),
  '1. ': (c) => c.toggleOrderedList().run(),
  '> ':  (c) => c.toggleBlockquote().run(),
  '- [ ] ': (c) => c.toggleTaskList?.().run?.(),
}

function runWYSIWYG(editor, before, after, placeholder, getSelected) {
  const c = editor.chain().focus()
  const sel = getSelected?.()
  // 直接映射
  if (WYSIWYG_MAP[before] && (!after || after === before)) return WYSIWYG_MAP[before](c)
  // heading
  if (/^#{1,6}\s$/.test(before)) return c.toggleHeading({ level: before.trim().length }).run()
  // code block
  if (before.startsWith('```')) return c.toggleCodeBlock().run()
  // link
  if (before === '[' && after === '](url)') return c.setLink({ href: 'https://' }).run()
  // table
  if (before.includes('|') && before.includes('---')) return c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  // hr
  if (before.includes('---')) return c.setHorizontalRule().run()
  // callout — 插入 blockquote 并在首行写入 [!type] 标记
  if (before.startsWith('> [!')) {
    const type = before.match(/\[!([\w]+)\]/)?.[1] || 'note'
    const content = sel || placeholder || '内容'
    // 用 setBlockquote 而非 toggle，确保始终创建引用块
    return c.setBlockquote().insertContent(`[!${type}] ${content}`).run()
  }
  // container (legacy)
  if (before.startsWith(':::')) {
    return c.setBlockquote().insertContent(sel || placeholder || '内容').run()
  }
  // color
  if (before.startsWith('@') && before.endsWith('{') && after === '}') {
    return c.setTextColor(COLOR_MAP[before.slice(1, -1)] || '#ef4444').run()
  }
  // wiki link
  if (before === '[[' && after === ']]') {
    return c.insertContent('[[' + (sel || placeholder || '笔记标题') + ']]').run()
  }
  // image/audio
  if (/^!\[.*\]\(.*\)/.test(before)) {
    const m = before.match(/^!\[([^\]]*)\]\(([^)]+)\)/)
    return m ? c.setImage({ src: m[2], alt: m[1] }).run() : c.setImage({ src: '', alt: '' }).run()
  }
  // clear format
  if (before === '__clearFormat__') return c.unsetAllMarks().clearNodes().run()
  // fallback
  return c.insertContent(before + (placeholder || '文本') + after).run()
}

function execWYSIWYGCommand(editor, def) {
  if (!editor || !def) return
  const getSelected = () => {
    const { from, to } = editor.state.selection
    return editor.state.doc.textBetween(from, to)
  }
  if (def.type === 'clearFormat') return runWYSIWYG(editor, '__clearFormat__', '', '', getSelected)
  if (def.inline) return runWYSIWYG(editor, def.inline[0], def.inline[1], def.inline[2], getSelected)
  if (def.block) return runWYSIWYG(editor, def.block, '', '', getSelected)
  if (def.insert) return runWYSIWYG(editor, def.insert, '', '', getSelected)
  switch (def.type) {
    case 'heading': return runWYSIWYG(editor, '## ', '', '', getSelected)
    case 'codeBlock': return runWYSIWYG(editor, '```', '', '', getSelected)
    case 'wikiLink': return runWYSIWYG(editor, '[[', ']]', '笔记标题', getSelected)
    case 'colorMenu': return editor.chain().focus().setTextColor('#ef4444').run()
    case 'calloutMenu': return runWYSIWYG(editor, '> [!note] ', '\n> ', '内容', getSelected)
  }
}

const MarkdownToolbar = ({ onInsert, onBlockFormat, disabled = false, viewMode, onViewModeChange, editor = null, editorMode = 'markdown' }) => {
  const [calloutAnchor, setCalloutAnchor] = React.useState(null)

  const [colorAnchor, setColorAnchor] = React.useState(null)
  const [headingAnchor, setHeadingAnchor] = React.useState(null)

  const toolbarOrder = useStore((s) => s.toolbarOrder) || DEFAULT_TOOLBAR_ORDER

  // 自动追加新增的工具栏项（兼容旧保存配置）
  const effectiveOrder = React.useMemo(() => {
    const saved = toolbarOrder
    const missing = DEFAULT_TOOLBAR_ORDER.filter(id => id !== '|' && !saved.includes(id))
    return missing.length ? [...saved, '|', ...missing] : saved
  }, [toolbarOrder])

  const insertText = (before, after = '', placeholder = '') => {
    if (editorMode === 'wysiwyg' && editor) {
      handleWYSIWYGInsert(before, after, placeholder)
    } else {
      onInsert(before, after, placeholder)
    }
  }

  // 块级格式（标题/列表/引用）— 在 markdown 模式中用 onBlockFormat 实现智能切换
  const applyBlock = (prefix) => {
    if (editorMode === 'wysiwyg' && editor) {
      handleWYSIWYGInsert(prefix, '', '')
    } else if (onBlockFormat) {
      onBlockFormat(prefix)
    } else {
      onInsert(prefix, '', '')
    }
  }

  const handleWYSIWYGInsert = (before, after, placeholder) => {
    if (!editor) return
    const getSelected = () => {
      const { from, to } = editor.state.selection
      return editor.state.doc.textBetween(from, to)
    }
    runWYSIWYG(editor, before, after, placeholder, getSelected)
  }

  const calloutTypes = STANDARD_CALLOUT_TYPES
  const colors = [
    { name: 'red', label: '红色', color: '#ef4444' }, { name: 'orange', label: '橙色', color: '#f97316' },
    { name: 'yellow', label: '黄色', color: '#eab308' }, { name: 'green', label: '绿色', color: '#22c55e' },
    { name: 'blue', label: '蓝色', color: '#3b82f6' }, { name: 'purple', label: '紫色', color: '#a855f7' },
    { name: 'pink', label: '粉色', color: '#ec4899' }
  ]

  const handleCalloutSelect = (item) => {
    insertText(`> [!${item.type}] `, '\n> ', '内容')
    setCalloutAnchor(null)
  }
  const handleColorSelect = (colorName) => { insertText(`@${colorName}{`, '}', '文本'); setColorAnchor(null) }

  // Shared styles
  const btnSx = {
    width: 32, height: 32, borderRadius: '8px', color: 'text.secondary',
    transition: 'all 0.2s ease',
    '&:hover': { bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: 'text.primary' },
    '& .MuiSvgIcon-root': { fontSize: 18 },
  }
  const menuBtnSx = { ...btnSx, width: 'auto', px: 0.5, gap: 0 }
  const Sep = () => <Box sx={{ width: '1px', height: 20, mx: 0.5, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }} />

  // 渲染单个工具栏项
  const renderItem = (id) => {
    if (id === '|') return <Sep key={`sep-${Math.random()}`} />
    const def = ALL_TOOLBAR_ITEMS[id]
    if (!def) return null
    // AI 动作项不渲染到工具栏
    if (def.aiAction) return null

    // 内联格式（粗体、斜体、删除线等）
    if (def.inline) {
      const Icon = def.icon
      return (
        <Tooltip key={id} title={def.label} placement="bottom">
          <span><IconButton size="small" disabled={disabled} onClick={() => insertText(...def.inline)} sx={btnSx}><Icon /></IconButton></span>
        </Tooltip>
      )
    }

    // 块级格式（列表、引用）
    if (def.block) {
      const Icon = def.icon
      return (
        <Tooltip key={id} title={def.label} placement="bottom">
          <span><IconButton size="small" disabled={disabled} onClick={() => applyBlock(def.block)} sx={btnSx}><Icon /></IconButton></span>
        </Tooltip>
      )
    }

    // 简单插入（表格、分割线）
    if (def.insert) {
      const Icon = def.icon
      return (
        <Tooltip key={id} title={def.label} placement="bottom">
          <span><IconButton size="small" disabled={disabled} onClick={() => insertText(def.insert, '', '')} sx={btnSx}><Icon /></IconButton></span>
        </Tooltip>
      )
    }

    // 特殊类型
    switch (def.type) {
      case 'heading':
        return (
          <React.Fragment key={id}>
            <Tooltip title="标题" placement="bottom">
              <IconButton size="small" disabled={disabled} onClick={(e) => setHeadingAnchor(e.currentTarget)} sx={menuBtnSx}>
                <Box component="span" sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1, fontFamily: 'inherit' }}>H</Box>
                <DropdownIcon sx={{ fontSize: '14px !important', ml: -0.3 }} />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={headingAnchor} open={Boolean(headingAnchor)} onClose={() => setHeadingAnchor(null)}
              slotProps={{ paper: { sx: { borderRadius: '10px', minWidth: 120 } } }}>
              {[{ level: 1, label: '标题 1', sx: { fontSize: '1.1rem', fontWeight: 700 } },
                { level: 2, label: '标题 2', sx: { fontSize: '1rem', fontWeight: 600 } },
                { level: 3, label: '标题 3', sx: { fontSize: '0.9rem', fontWeight: 600 } },
                { level: 0, label: '正文', sx: { fontSize: '0.85rem', fontWeight: 400 } }
              ].map(h => (
                <MenuItem key={h.level} onClick={() => { applyBlock(h.level === 0 ? '' : '#'.repeat(h.level) + ' '); setHeadingAnchor(null) }}>
                  <ListItemText primaryTypographyProps={{ sx: h.sx }}>{h.label}</ListItemText>
                </MenuItem>
              ))}
            </Menu>
          </React.Fragment>
        )
      case 'codeBlock':
        return (
          <Tooltip key={id} title="代码块" placement="bottom">
            <span><IconButton size="small" disabled={disabled} onClick={() => insertText('```\n', '\n```', '代码块')} sx={btnSx}>
              <CodeBlockIcon />
            </IconButton></span>
          </Tooltip>
        )
      case 'image':
        return <ImageUploadButton key={id} onImageInsert={(text, a, b) => insertText(text, a, b)} disabled={disabled} sx={btnSx} />
      case 'audio':
        return <AudioRecordButton
          key={id}
          onAudioInsert={(audioPath) => {
            if (editorMode === 'wysiwyg' && editor) {
              editor.chain().focus()
                .setImage({ src: audioPath, alt: '录音' })
                .createParagraphNear()
                .run()
            } else {
              onInsert(`![录音](${audioPath})\n`, '', '')
            }
          }}
          onTranscription={(text) => {
            if (editorMode === 'wysiwyg' && editor) {
              editor.chain().focus().insertContent(text).run()
            } else {
              onInsert(text + '\n', '', '')
            }
          }}
          sx={btnSx}
        />
      case 'wikiLink':
        return (
          <Tooltip key={id} title="Wiki 链接 [[Note]]" placement="bottom">
            <span><IconButton size="small" disabled={disabled} onClick={() => insertText('[[', ']]', '笔记标题')} sx={btnSx}>
              <WikiLinkIcon />
            </IconButton></span>
          </Tooltip>
        )
      case 'colorMenu':
        return (
          <Tooltip key={id} title="彩色文本" placement="bottom">
            <span><IconButton size="small" disabled={disabled} onClick={(e) => setColorAnchor(e.currentTarget)} sx={menuBtnSx}>
              <ColorIcon /><DropdownIcon sx={{ fontSize: '14px !important', ml: -0.3 }} />
            </IconButton></span>
          </Tooltip>
        )
      case 'calloutMenu':
        return (
          <Tooltip key={id} title="提示框" placement="bottom">
            <span><IconButton size="small" disabled={disabled} onClick={(e) => setCalloutAnchor(e.currentTarget)} sx={menuBtnSx}>
              <CalloutIcon /><DropdownIcon sx={{ fontSize: '14px !important', ml: -0.3 }} />
            </IconButton></span>
          </Tooltip>
        )
      case 'clearFormat':
        return (
          <Tooltip key={id} title="清除格式" placement="bottom">
            <span><IconButton size="small" disabled={disabled} onClick={() => {
              if (editorMode === 'wysiwyg' && editor) {
                editor.chain().focus().unsetAllMarks().clearNodes().run()
              } else {
                // markdown 模式：移除选中文本的常见格式标记
                const textarea = document.querySelector('.note-editor textarea')
                if (!textarea) return
                const start = textarea.selectionStart, end = textarea.selectionEnd
                if (start === end) return
                const sel = textarea.value.substring(start, end)
                const cleaned = sel.replace(/\*\*|\*|~~|`|==|\+\+/g, '').replace(/^#{1,6}\s/gm, '').replace(/^>\s?/gm, '').replace(/^[-*]\s/gm, '').replace(/^\d+\.\s/gm, '')
                textarea.focus(); textarea.setSelectionRange(start, end)
                document.execCommand('insertText', false, cleaned)
              }
            }} sx={btnSx}>
              <ClearFormatIcon />
            </IconButton></span>
          </Tooltip>
        )
      default:
        return null
    }
  }

  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.25,
        px: 1, py: 0.5,
        borderBottom: 1, borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(30,41,59,0.5)' : 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        flexWrap: 'wrap', minHeight: 40,
      }}
    >
      {effectiveOrder.map((id, i) => renderItem(id))}

      {/* ── 编辑/预览模式切换 ── */}
      {viewMode && onViewModeChange && (
        <>
          <Box sx={{ flex: 1 }} />
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: '3px',
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
            borderRadius: '10px', p: '2.5px',
          }}>
            {[
              { value: 'edit', icon: <EditIcon sx={{ fontSize: 16 }} />, tip: '编辑模式' },
              { value: 'preview', icon: <PreviewIcon sx={{ fontSize: 16 }} />, tip: '预览模式' },
              { value: 'split', icon: <SplitViewIcon sx={{ fontSize: 16 }} />, tip: '分屏模式' },
            ].map(m => {
              const isActive = viewMode === m.value
              return (
                <Tooltip key={m.value} title={m.tip} placement="bottom">
                  <Button
                    disableElevation disableRipple size="small"
                    variant={isActive ? 'contained' : 'text'}
                    onClick={() => onViewModeChange(m.value)}
                    sx={{
                      minWidth: 0, p: 0.6, borderRadius: '8px',
                      transition: 'all 0.25s cubic-bezier(.4,0,.2,1)',
                      ...(isActive ? {
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.13)' : 'primary.main',
                        color: (theme) => theme.palette.mode === 'dark' ? '#fff' : 'primary.contrastText',
                        boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 1px 4px rgba(0,0,0,0.3)' : `0 2px 8px ${theme.palette.primary.main}33`,
                        '&:hover': { bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'primary.dark' },
                      } : {
                        color: 'text.secondary', bgcolor: 'transparent',
                        '&:hover': { bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', color: 'text.primary' },
                      }),
                    }}
                  >
                    {m.icon}
                  </Button>
                </Tooltip>
              )
            })}
          </Box>
        </>
      )}

      {/* ── 弹出菜单 ── */}
      <Menu anchorEl={calloutAnchor} open={Boolean(calloutAnchor)} onClose={() => setCalloutAnchor(null)}
        slotProps={{ paper: { sx: { borderRadius: '10px' } } }}>
        {calloutTypes.map((c) => (
          <MenuItem key={c.type} onClick={() => handleCalloutSelect(c)}>
            <ListItemIcon sx={{ minWidth: 32 }}><span style={{ fontSize: '1.1rem' }}>{c.icon}</span></ListItemIcon>
            <ListItemText
              primary={c.label}
              secondary={`> [!${c.type}]`}
              slotProps={{ secondary: { sx: { fontFamily: 'monospace', fontSize: 11 } } }}
            />
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: c.color, ml: 1, flexShrink: 0 }} />
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={colorAnchor} open={Boolean(colorAnchor)} onClose={() => setColorAnchor(null)}
        slotProps={{ paper: { sx: { borderRadius: '10px' } } }}>
        {colors.map((c) => (
          <MenuItem key={c.name} onClick={() => handleColorSelect(c.name)}>
            <ListItemIcon sx={{ minWidth: 32 }}>
              <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: c.color, border: '2px solid', borderColor: 'background.paper' }} />
            </ListItemIcon>
            <ListItemText primary={c.label} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}

export { ALL_TOOLBAR_ITEMS, DEFAULT_TOOLBAR_ORDER, DEFAULT_FLOATING_ORDER, execWYSIWYGCommand }
export default MarkdownToolbar
