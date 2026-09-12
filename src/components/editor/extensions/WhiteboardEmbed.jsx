import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Alert, Box, Button, ButtonBase, CircularProgress, IconButton, Portal, Tooltip, Typography } from '@mui/material'
import { Brush, Check, ContentCopy, DeleteOutline, DragIndicator, Edit, ExpandLess, ExpandMore, OpenInNew } from '../../common/AppIcons'
import { useStore } from '../../../store/useStore'
import { openNoteLink } from '../../../utils/linkUtils'
import { floatingGlassSx } from '../../../utils/floatingGlassSx'

const WhiteboardEditor = lazy(() => import('../WhiteboardEditor'))
const MENU_WIDTH = 210
const MENU_HEIGHT = 238
const MENU_MARGIN = 8

const CanvasMenuAction = ({ icon, children, danger = false, onClick }) => (
  <ButtonBase onClick={onClick} sx={{ width: '100%', minHeight: 38, px: 1.25, borderRadius: 1.5, justifyContent: 'flex-start', gap: 1.25, color: danger ? 'error.main' : 'text.primary', fontSize: 13, fontWeight: 600, '&:hover': { bgcolor: danger ? 'rgba(239,68,68,0.10)' : 'action.hover' } }}>
    <Box sx={{ width: 22, display: 'grid', placeItems: 'center', color: danger ? 'error.main' : 'text.secondary', '& .MuiSvgIcon-root': { fontSize: 18 } }}>{icon}</Box>
    {children}
  </ButtonBase>
)

function EmbedView({ node, editor, getPos, selected }) {
  const note = useStore(state => state.notes.find(n => !n.is_deleted && !n.deleted_at && (String(n.sync_id || n.id) === node.attrs.reference || String(n.id) === node.attrs.reference)))
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [menu, setMenu] = useState(null)
  const [canvasMounted, setCanvasMounted] = useState(false)
  const canvasHostRef = useRef(null)
  const referenceUrl = `app://whiteboard/${encodeURIComponent(node.attrs.reference)}`
  const beginEditing = () => {
    setCanvasMounted(true)
    setEditing(true)
  }
  const openMenu = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.max(MENU_MARGIN, Math.min(event.clientX + 2, window.innerWidth - MENU_WIDTH - MENU_MARGIN)),
      y: Math.max(MENU_MARGIN, Math.min(event.clientY + 2, window.innerHeight - MENU_HEIGHT - MENU_MARGIN)),
    })
  }
  const runMenuAction = (action) => {
    setMenu(null)
    action()
  }
  const removeReference = () => {
    const pos = getPos()
    if (typeof pos === 'number') editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
  }
  const finish = () => {
    setEditing(false)
    setExpanded(false)
    const pos = getPos()
    if (!editor.isDestroyed && typeof pos === 'number') {
      editor.commands.focus(Math.min(pos + node.nodeSize, editor.state.doc.content.size))
    }
  }
  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    const closeOnEscape = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])
  useLayoutEffect(() => {
    const host = canvasHostRef.current
    if (!host || canvasMounted) return undefined
    // 当前可见（或即将进入视口）的嵌入画布在浏览器绘制前直接开始挂载，
    // 避免先闪现静态预览图，再突然切换成可拖动画布。
    const bounds = host.getBoundingClientRect()
    if (bounds.bottom >= -500 && bounds.top <= window.innerHeight + 500) {
      setCanvasMounted(true)
      return undefined
    }
    if (!window.IntersectionObserver) {
      setCanvasMounted(true)
      return undefined
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setCanvasMounted(true)
        observer.disconnect()
      }
    }, { rootMargin: '500px 0px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [canvasMounted])
  return <NodeViewWrapper contentEditable={false} className="flota-whiteboard-embed">
    <Box sx={{ my: 1.25, border: '1px solid', borderColor: editing || selected ? 'primary.main' : 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper', transition: 'border-color 160ms ease' }}>
      <Box onContextMenu={openMenu} sx={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 0.75, px: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        {editor.isEditable && <Box data-drag-handle title="拖动调整位置" sx={{ display: 'flex', cursor: 'grab', color: 'text.disabled', '&:active': { cursor: 'grabbing' } }}><DragIndicator fontSize="small" /></Box>}
        <Brush sx={{ fontSize: 18 }} color="primary" />
        <Typography variant="body2" fontWeight={600} noWrap title={note?.title || '关联画布'} sx={{ flex: 1, minWidth: 0 }}>{note?.title || '关联画布'}</Typography>
        <Button size="small" disabled={!note || !editor.isEditable} variant={editing ? 'contained' : 'text'}
          startIcon={editing ? <Check fontSize="small" /> : undefined} sx={{ flexShrink: 0, minWidth: 0, px: 1 }} onClick={() => editing ? finish() : beginEditing()}>{editing ? '完成' : '编辑'}</Button>
        <Tooltip title={expanded ? '收起画布' : '展开画布'}><span><IconButton size="small" disabled={!note} aria-label={expanded ? '收起画布' : '展开画布'} onClick={() => setExpanded(value => !value)}>{expanded ? <ExpandLess /> : <ExpandMore />}</IconButton></span></Tooltip>
      </Box>
      {!note ? <Alert severity="warning" sx={{ borderRadius: 0 }}>原画布已删除或尚未同步</Alert> :
        <Box
          ref={canvasHostRef}
          onContextMenuCapture={editing ? undefined : openMenu}
          onContextMenu={editing ? (event) => event.stopPropagation() : undefined}
          sx={{ height: expanded ? 'max(420px, 72vh)' : 300, position: 'relative', display: 'flex', flexDirection: 'column', contentVisibility: editing ? 'visible' : 'auto', containIntrinsicSize: '300px', cursor: editing ? 'default' : 'grab', '&:active': { cursor: editing ? 'default' : 'grabbing' } }}
          onKeyDown={e => {
            if (e.key !== 'Escape' || e.defaultPrevented || e.target.closest('[role="dialog"], [role="menu"], input, textarea')) return
            e.stopPropagation()
            if (expanded) setExpanded(false)
            else if (editing) finish()
          }}>
          {canvasMounted ? <Suspense fallback={<Box sx={{ flex: 1, display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 1.5 }}><CircularProgress size={24} /><Typography variant="body2" color="text.secondary">正在打开画布…</Typography></Box>}>
            <WhiteboardEditor noteId={note.id} viewOnly={!editing} />
          </Suspense> : <Box sx={{ flex: 1, bgcolor: 'background.default' }} />}
        </Box>}
    </Box>
    {menu && <Portal><Box data-editor-context-menu onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}
      sx={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 1400, width: MENU_WIDTH, p: 0.55, ...floatingGlassSx({ radius: '14px', shadow: 'menu' }) }}>
      {!editing && editor.isEditable && <CanvasMenuAction icon={<Edit />} onClick={() => runMenuAction(beginEditing)}>编辑画布</CanvasMenuAction>}
      <CanvasMenuAction icon={<OpenInNew />} onClick={() => runMenuAction(() => openNoteLink(referenceUrl))}>打开原画布</CanvasMenuAction>
      <CanvasMenuAction icon={expanded ? <ExpandLess /> : <ExpandMore />} onClick={() => runMenuAction(() => setExpanded(value => !value))}>{expanded ? '收起' : '展开'}</CanvasMenuAction>
      <CanvasMenuAction icon={<ContentCopy />} onClick={() => runMenuAction(() => navigator.clipboard?.writeText(referenceUrl))}>复制画布链接</CanvasMenuAction>
      {editor.isEditable && <Box sx={{ my: 0.5, borderTop: '1px solid', borderColor: 'divider' }} />}
      {editor.isEditable && <CanvasMenuAction danger icon={<DeleteOutline />} onClick={() => runMenuAction(removeReference)}>删除引用</CanvasMenuAction>}
    </Box></Portal>}
  </NodeViewWrapper>
}

export const WhiteboardEmbed = Node.create({
  name: 'whiteboardEmbed', priority: 1000, group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ reference: {
    default: '',
    parseHTML: el => el.getAttribute('data-reference') || '',
    renderHTML: attrs => ({ 'data-reference': attrs.reference }),
  } }),
  parseHTML: () => [{ tag: 'div[data-type="whiteboard-embed"][data-reference]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'whiteboard-embed' })],
  addNodeView: () => ReactNodeViewRenderer(EmbedView),
  addStorage() { return { markdown: {
    serialize(state, node) { state.write(`[关联画布](app://whiteboard/${encodeURIComponent(node.attrs.reference)})`); state.closeBlock(node) },
    parse: {
      updateDOM(element) {
        element.querySelectorAll('a[href^="app://whiteboard/"]').forEach(link => {
          let reference = ''
          try { reference = decodeURIComponent(new URL(link.getAttribute('href')).pathname.slice(1)) } catch { return }
          if (!reference) return
          const embed = document.createElement('div')
          embed.setAttribute('data-type', 'whiteboard-embed')
          embed.setAttribute('data-reference', reference)
          const paragraph = link.parentElement?.matches('p') && link.parentElement.childNodes.length === 1 ? link.parentElement : null
          ;(paragraph || link).replaceWith(embed)
        })
      },
    },
  } } },
})
