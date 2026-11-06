import { alpha } from '@mui/material/styles'
import { nativeCheckboxSx } from './checkboxStyles'

// 链接图标（Material Symbols「link」），用遮罩画，颜色跟着文字走
const LINK_ICON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z'/%3E%3C/svg%3E\")"

const doneText = (theme) => ({
  color: theme.palette.text.secondary,
  textDecoration: 'line-through',
  textDecorationColor: alpha(theme.palette.text.secondary, 0.6),
})

/**
 * 编辑器（tiptap）里的任务列表：
 * <ul data-type="taskList"><li data-checked data-todo-ref?><label><input/></label><div>内容</div><span class="flota-task-meta"/></li></ul>
 */
export const editorTaskListSx = (theme) => ({
  listStyle: 'none',
  paddingLeft: 0,
  '& li': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
  },
  // 高度、上边距和段落的行高、上边距一致，勾和第一行文字居中对齐
  '& li > label': {
    display: 'flex',
    alignItems: 'center',
    height: '1.7em',
    marginTop: '0.25rem',
    flexShrink: 0,
    userSelect: 'none',
    '& > span': { display: 'none' },
  },
  '& input[type="checkbox"]': nativeCheckboxSx(theme),
  '& li > div': { flex: 1, minWidth: 0 },
  '& li[data-checked="true"] > div > p': doneText(theme),
  // 行尾：关联任务的小标记 / 普通任务悬停时的「加入待办」
  '& .flota-task-meta': {
    display: 'flex',
    alignItems: 'center',
    height: '1.7em',
    marginTop: '0.25rem',
    flexShrink: 0,
    '&:empty': { display: 'none' },
  },
  '& .flota-task-meta button': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: 22,
    padding: '0 6px',
    border: 0,
    borderRadius: '6px',
    background: 'transparent',
    color: theme.palette.text.secondary,
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, color 120ms ease, opacity 120ms ease',
    '&:hover': { backgroundColor: theme.palette.action.hover, color: theme.palette.text.primary },
    '&:focus-visible': { outline: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`, outlineOffset: 1 },
  },
  '& .flota-task-promote': { opacity: 0, color: `${theme.palette.primary.main} !important` },
  // 只在指着这一项（而不是它的子项）时出现
  '& li:hover:not(:has(li:hover)) > .flota-task-meta .flota-task-promote, & li:focus-within:not(:has(li:focus-within)) > .flota-task-meta .flota-task-promote': { opacity: 1 },
  '& .flota-task-dot': { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  '& .flota-task-badge .is-overdue': { color: theme.palette.error.main },
  '& .flota-task-badge.is-missing': { color: theme.palette.text.disabled },
  '& .flota-task-link-icon': {
    width: 14,
    height: 14,
    backgroundColor: 'currentColor',
    opacity: 0.7,
    maskImage: LINK_ICON,
    WebkitMaskImage: LINK_ICON,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
  },
  '& li.is-missing > div > p': { color: theme.palette.text.disabled },
})

/**
 * Markdown 预览里的任务列表：
 * <ul class="contains-task-list"><li class="task-list-item" data-checked><span class="task-list-checkbox"><input/></span>文字</li></ul>
 */
export const previewTaskListSx = (theme) => ({
  '& .contains-task-list': { listStyle: 'none', paddingLeft: 0 },
  '& .task-list-item': { position: 'relative', paddingLeft: '1.7em' },
  '& .task-list-item[data-checked="true"]': doneText(theme),
  '& .task-list-item[data-checked="true"] .task-list-item[data-checked="false"]': { color: theme.palette.text.primary, textDecoration: 'none' },
  '& .task-list-checkbox': {
    position: 'absolute',
    left: 0,
    top: 0,
    display: 'flex',
    alignItems: 'center',
    height: '1.6em',
  },
  '& .task-list-checkbox input': nativeCheckboxSx(theme),
  // 只有关联任务可以在预览里直接勾（写回待办）；普通任务在预览里只读
  '& .task-list-item:not([data-todo-ref]) > .task-list-checkbox input': { pointerEvents: 'none' },
})
