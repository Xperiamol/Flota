// 主进程在对话智能体提交画布时调用（window.__flotaCanvasCheck）：用真实排版引擎试渲染一次，
// 返回 { ok, error?, summary?, warnings?, image? }。只做检查，不写入任何笔记。
import { readCanvasSpec, renderCanvasSpec, summarizeRendered, renderCanvasPreview } from './agentCanvas'
import { isAiCanvasSvgAllowed } from './canvasSvgPolicy'
import { parseWhiteboardContent, resolveContextNoteId } from '../whiteboardAI'

const loadTargetElements = async (args, actionContext) => {
  const id = args.target_note_id ?? resolveContextNoteId(actionContext) ?? window.__flotaVisibleNoteId
  if (id == null || id === '') throw new Error('没有指定要修改的画布（target_note_id），当前也没有打开画布')
  const res = await window.electronAPI.notes.getById(Number(id))
  const note = res?.data || res
  if (!note || note.note_type !== 'whiteboard') throw new Error(`笔记 ${id} 不存在或不是画布`)
  const data = parseWhiteboardContent(note.content)
  return { elements: data.elements || [], files: data.fileMap || {} }
}

export const checkCanvasProposal = async ({ name, args = {}, actionContext = null, wantImage = false } = {}) => {
  try {
    const spec = readCanvasSpec(args)
    if (!spec) return { ok: false, error: '缺少画布内容：请提供 canvas（原语树）、mermaid 或 patch 其中一种' }
    const isUpdate = name === 'update_whiteboard'
    const mode = spec.patch ? 'edit' : (isUpdate ? (args.mode || 'append') : 'replace')
    if (!['append', 'replace', 'edit'].includes(mode)) return { ok: false, error: 'mode 只能是 append 或 replace（局部修改请给 patch）' }
    const existing = isUpdate ? await loadTargetElements(args, actionContext) : { elements: [], files: {} }
    const result = await renderCanvasSpec(spec, {
      existingElements: existing.elements,
      append: mode === 'append',
      allowSvg: await isAiCanvasSvgAllowed(),
    })
    const live = existing.elements.filter(element => element && !element.isDeleted)
    const finalElements = result.replacesAll ? result.elements : (mode === 'append' ? [...live, ...result.elements] : result.elements)
    let image = null
    if (wantImage) {
      try {
        image = await renderCanvasPreview(finalElements, { ...existing.files, ...result.files })
      } catch { image = null }
    }
    return { ok: true, summary: { mode, ...summarizeRendered(result.elements) }, warnings: result.warnings || [], ...(image ? { image } : {}) }
  } catch (error) {
    return { ok: false, error: String(error?.message || error || '画布渲染失败') }
  }
}
