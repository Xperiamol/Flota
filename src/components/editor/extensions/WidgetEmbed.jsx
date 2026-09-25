import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { DeleteOutline, MoreHoriz, OpenInFull, OpenInNew, SwapHoriz } from '../../common/AppIcons'
import AppContextMenu from '../../common/AppContextMenu'
import WidgetHost from '../../widgets/WidgetHost'
import InstancePicker from '../../widgets/InstancePicker'
import { openWidgetInstance } from '../../../store/useWidgetStore'
import { askAIToFixWidget } from '../../../utils/widgets/askAI'
import { instanceLabel } from '../../../utils/widgets/widgetActions'
import { WidgetGlyph } from '../../widgets/widgetIcons'

// 笔记里的组件引用：[显示名](app://widget/<实例 id>)，在其他 Markdown 工具里显示为链接
const widgetUrl = (instanceId) => `app://widget/${encodeURIComponent(instanceId)}`
const embedTitle = (widget, instance) => instanceLabel(widget.name, instance.name).replace(/[[\]]/g, '')

function useInstanceInfo(instanceId) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    const load = () => window.electronAPI?.widgets?.getInstance(instanceId).then((result) => setInfo(result?.success ? result.data : { missing: true }))
    load()
    const off = window.electronAPI?.widgets?.onListChanged?.(load)
    return () => off?.()
  }, [instanceId])
  return info
}

function WidgetEmbedView({ node, editor, getPos, selected, updateAttributes }) {
  const instanceId = node.attrs.reference
  const info = useInstanceInfo(instanceId)
  const [menu, setMenu] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const title = info?.widget && info?.instance ? embedTitle(info.widget, info.instance) : (node.attrs.title || '组件')

  const removeReference = () => {
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos === 'number') editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
  }

  return (
    <NodeViewWrapper className="flota-widget-embed" data-drag-handle="" contentEditable={false}>
      <Box sx={{ my: 1.5, border: '1px solid', borderColor: selected ? 'primary.main' : 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper', transition: 'border-color 150ms ease' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <WidgetGlyph icon={info?.widget?.manifest?.icon} sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 600 }} noWrap>
            {info?.missing ? '组件不存在' : title}
          </Typography>
          {info?.instance && (
            <Tooltip title="在组件主页打开">
              <IconButton size="small" onClick={() => openWidgetInstance(instanceId)}><OpenInFull fontSize="small" /></IconButton>
            </Tooltip>
          )}
          <IconButton size="small" onClick={(event) => setMenu({ el: event.currentTarget })}><MoreHoriz fontSize="small" /></IconButton>
        </Box>
        {info?.missing ? (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">引用的组件实例不存在，可能尚未同步到本设备。</Typography>
          </Box>
        ) : (
          <WidgetHost instanceId={instanceId} size="medium" surface="note"
            onFixRequest={info?.widget ? (errors) => askAIToFixWidget(info.widget, instanceId, errors) : undefined} />
        )}
      </Box>
      <AppContextMenu anchor={menu} onClose={() => setMenu(null)} items={[
        { label: '换一个实例', icon: <SwapHoriz fontSize="small" />, hidden: !editor.isEditable, onClick: () => setPickerOpen(true) },
        { label: '在桌面小窗打开', icon: <OpenInNew fontSize="small" />, hidden: !info?.instance, onClick: () => window.electronAPI.createWidgetWindow(instanceId) },
        { divider: true, hidden: !editor.isEditable },
        { label: '移除引用（实例和数据保留）', icon: <DeleteOutline fontSize="small" />, danger: true, hidden: !editor.isEditable, onClick: removeReference },
      ]} />
      <InstancePicker open={pickerOpen} onClose={() => setPickerOpen(false)} title="换一个实例" confirmText="使用"
        initialWidgetId={info?.widget?.id}
        onSelect={({ widget, instance }) => updateAttributes({ reference: instance.id, title: embedTitle(widget, instance) })} />
    </NodeViewWrapper>
  )
}

export const WidgetEmbed = Node.create({
  name: 'widgetEmbed',
  priority: 1000,
  group: 'block',
  atom: true,
  draggable: true,
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const title = String(node.attrs.title || '组件').replace(/[[\]]/g, '')
          state.write(`[${title}](${widgetUrl(node.attrs.reference)})`)
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element) {
            element.querySelectorAll('a[href^="app://widget/"]').forEach((link) => {
              let reference = ''
              try { reference = decodeURIComponent(new URL(link.getAttribute('href')).pathname.slice(1)) } catch { return }
              if (!reference) return
              const embed = document.createElement('div')
              embed.setAttribute('data-type', 'widget-embed')
              embed.setAttribute('data-reference', reference)
              embed.setAttribute('data-title', link.textContent || '')
              const paragraph = link.parentElement?.matches('p') && link.parentElement.childNodes.length === 1 ? link.parentElement : null
              ;(paragraph || link).replaceWith(embed)
            })
          },
        },
      },
    }
  },
  addAttributes: () => ({
    reference: {
      default: '',
      parseHTML: (el) => el.getAttribute('data-reference') || '',
      renderHTML: (attrs) => ({ 'data-reference': attrs.reference }),
    },
    title: {
      default: '',
      parseHTML: (el) => el.getAttribute('data-title') || '',
      renderHTML: (attrs) => ({ 'data-title': attrs.title }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-type="widget-embed"][data-reference]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'widget-embed' })],
  addNodeView: () => ReactNodeViewRenderer(WidgetEmbedView),
})
