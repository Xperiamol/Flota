// 不经过对话的一次性画布设计（如「AI 转画布」）：主进程用对话引擎让模型写画布、试渲染、自己修，
// 这里拿到被采用的内容后渲染成 Excalidraw 元素。
import { readCanvasSpec, renderCanvasSpec } from './agentCanvas'
import { isAiCanvasSvgAllowed } from './canvasSvgPolicy'
import { DIAGRAM_THEME } from './shared'

const MAX_SOURCE_CHARS = 30000

/** 把一篇笔记整理成画布的请求 */
export const noteToCanvasRequest = ({ title = '', content = '' } = {}) => {
  const body = String(content || '')
  return [
    '把下面这篇笔记的内容整理成一张清晰的画布：保留关键信息、结构和关系，选择最合适的呈现方式；只用笔记里有的内容，不编造。',
    title ? `笔记标题：${title}` : '',
    `笔记正文：\n${body.length > MAX_SOURCE_CHARS ? `${body.slice(0, MAX_SOURCE_CHARS)}\n…（后面内容过长已省略）` : body}`,
  ].filter(Boolean).join('\n\n')
}

/**
 * @param {string} request
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ title?: string, elements: Array, files: object, content: string }>}
 *   content 是可以直接保存为画布笔记的 JSON 字符串（files 未落盘，保存前需 saveWhiteboardFiles）
 */
export const composeCanvas = async (request, { signal } = {}) => {
  const requestId = `compose_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const cancel = () => { window.electronAPI?.ai?.cancelChat?.(requestId) }
  signal?.addEventListener('abort', cancel, { once: true })
  let res
  try {
    res = await window.electronAPI.ai.composeCanvas(requestId, request)
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
  if (signal?.aborted) throw Object.assign(new Error('已停止生成'), { name: 'AbortError' })
  if (!res?.success) throw new Error(res?.error || '画布生成失败')
  const spec = readCanvasSpec(res.data || {})
  if (!spec) throw new Error('AI 没有提交画布内容')
  const rendered = await renderCanvasSpec(spec, { allowSvg: await isAiCanvasSvgAllowed() })
  const content = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'Flota-local',
    elements: rendered.elements,
    appState: { viewBackgroundColor: DIAGRAM_THEME.canvas, currentItemFontFamily: 2, gridSize: null },
    fileMap: rendered.files,
  })
  return { title: res.data.title, elements: rendered.elements, files: rendered.files, content }
}
