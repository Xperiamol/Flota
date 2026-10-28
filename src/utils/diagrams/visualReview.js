import { parseStructuredOutput } from './structuredOutput'

export const parseCanvasReview = content => {
  try {
    const parsed = parseStructuredOutput(content)
    const issues = Array.isArray(parsed) ? parsed : parsed?.issues
    if (!Array.isArray(issues) || !issues.every(item => typeof item === 'string')) throw new Error()
    return issues.map(item => item.trim()).filter(Boolean).slice(0, 3).map(item => item.slice(0, 500))
  } catch { throw new Error('视觉复核返回格式不正确') }
}

// One bounded review, only when the configured model has image understanding enabled.
export const reviewCanvas = async (result, description, task) => {
  const config = await window.electronAPI?.ai?.getConfig?.()
  if (![true, 'true'].includes(config?.data?.visionEnabled)) return null
  task?.throwIfCancelled()
  const { exportToBlob } = await import('@excalidraw/excalidraw')
  const blob = await exportToBlob({
    elements: result.elements,
    files: result.files || {},
    appState: { viewBackgroundColor: '#f8fafc', exportBackground: true, exportWithDarkMode: false },
    mimeType: 'image/png',
    maxWidthOrHeight: 1400,
  })
  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('画布预览读取失败'))
    reader.readAsDataURL(blob)
  })
  task?.throwIfCancelled()
  const response = await (task ? task.chat : window.electronAPI.ai.chat)([
    { role: 'system', content: '你是画布视觉审校。检查实际渲染图中的文字遮挡、裁切、过小字号、关系不清、明显不符合用户风格和需求的构图。不要因个人偏好强迫统一风格。返回严格 JSON：{"issues":["具体位置、问题、修正方法"]}；没有实质问题返回 {"issues":[]}，最多3项。不要虚构用户没给的数据。' },
    { role: 'user', content: [{ type: 'text', text: `用户需求：${description}` }, { type: 'image_url', image_url: { url: image } }] },
  ], { temperature: 0.1, timeoutMs: 60000, bypassTokenLimit: true })
  if (!response?.success) throw new Error(response?.error || '视觉复核失败')
  try { return parseCanvasReview(response.data?.content) } catch {
    // 只做一次文本格式修复，不重复传图或重新生成画布。
    const repaired = await (task ? task.chat : window.electronAPI.ai.chat)([
      { role: 'system', content: '只修复 JSON 格式，不新增或改变审校结论。输出 {"issues":["问题"]}，无问题输出 {"issues":[]}；禁止说明文字和代码围栏。' },
      { role: 'user', content: String(response.data?.content || '') },
    ], { temperature: 0, timeoutMs: 30000, bypassTokenLimit: true })
    task?.throwIfCancelled()
    if (!repaired?.success) throw new Error('视觉复核返回格式不正确')
    return parseCanvasReview(repaired.data?.content)
  }
}
