import { useStore } from '../../store/useStore'
import { confirmAction, notifyError, notifySuccess, promptInput } from '../notify'
import { openWidgetHome } from '../../store/useWidgetStore'

/** 实例的显示名：与组件同名时只显示一次，否则「组件 · 实例」 */
export const instanceLabel = (widgetName, instanceName) => (
  !instanceName || instanceName === widgetName ? widgetName : `${widgetName} · ${instanceName}`
)

/** 笔记里引用实例的 Markdown：[显示名](app://widget/<实例 id>) */
export const widgetEmbedMarkdown = (widgetName, instance) =>
  `[${instanceLabel(widgetName, instance.name).replace(/[[\]]/g, '')}](app://widget/${instance.id})`

/** 把实例引用追加到某篇笔记末尾 */
export const insertInstanceIntoNote = async (note, widgetName, instance) => {
  const state = useStore.getState()
  const content = String(note.content || '').replace(/\s+$/, '')
  const result = await state.updateNote(note.id, { content: `${content}${content ? '\n\n' : ''}${widgetEmbedMarkdown(widgetName, instance)}\n` })
  if (result?.success === false) throw new Error(result.error || '插入失败')
  notifySuccess(`已插入到「${note.title || '未命名笔记'}」`)
}

/** 新建实例（询问名称）并直接打开 */
export const createInstanceInteractive = async (widget) => {
  const name = await promptInput({ title: '新建实例', label: '名称', defaultValue: `${widget.name} ${(widget.instanceCount || 0) + 1}`, confirmText: '新建' })
  if (!name) return null
  const result = await window.electronAPI.widgets.createInstance(widget.id, name)
  if (!result?.success) {
    notifyError(result?.error || '新建失败')
    return null
  }
  openWidgetHome(widget.id, result.data.id)
  return result.data
}

export const renameInstance = async (instance) => {
  const name = await promptInput({ title: '重命名实例', label: '名称', defaultValue: instance.name, confirmText: '保存' })
  if (!name) return
  const result = await window.electronAPI.widgets.renameInstance(instance.id, name)
  if (!result?.success) notifyError(result?.error || '重命名失败')
}

/** 删除实例（进入最近删除），返回是否已删除 */
export const deleteInstance = async (instance) => {
  const refs = instance.notes?.length ? `引用它的 ${instance.notes.length} 篇笔记会显示可恢复。` : ''
  const ok = await confirmAction({ title: '删除实例', message: `删除「${instance.name}」？30 天内可以在“最近删除”里恢复。${refs}`, confirmText: '删除', danger: true })
  if (!ok) return false
  const result = await window.electronAPI.widgets.deleteInstance(instance.id)
  if (!result?.success) notifyError(result?.error || '删除失败')
  return Boolean(result?.success)
}

/** 删除组件及其全部实例（实例进入最近删除），返回是否已删除 */
export const deleteWidget = async (widget) => {
  const ok = await confirmAction({
    title: '删除组件',
    message: `删除「${widget.name}」和它的 ${widget.instanceCount || 0} 个实例？30 天内可以恢复实例。`,
    confirmText: '删除', danger: true,
  })
  if (!ok) return false
  const result = await window.electronAPI.widgets.delete(widget.id)
  if (!result?.success) notifyError(result?.error || '删除失败')
  return Boolean(result?.success)
}

export const exportWidget = async (widget) => {
  const result = await window.electronAPI.widgets.exportFile(widget.id)
  if (!result?.success) return notifyError(result?.error || '导出失败')
  if (result.data) notifySuccess('组件已导出')
}

export const openMiniWindow = async (instanceId) => {
  const result = await window.electronAPI.createWidgetWindow(instanceId)
  if (result && result.success === false) notifyError(result.error || '打开小窗失败')
}

export const toggleHomeInstance = async (instanceId) => {
  const { toggleInstanceOnHome } = await import('../../store/useHomeStore')
  if (toggleInstanceOnHome(instanceId)) notifySuccess('已放到首页')
}
