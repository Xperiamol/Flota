// 画布的渲染、保存与对话卡片执行。画布内容由对话智能体直接给出（见 diagrams/agentCanvas），这里按需加载排版引擎
import logger from './logger'

const LEGACY_CARD_ERROR = '这张卡片来自旧版画布生成，已不再支持，请在对话里让 AI 重新画一次'

export const WHITEBOARD_AI_GENERATE_EVENT = 'flota:whiteboard-ai-generate'
export const WHITEBOARD_AI_ACTIONS = {
  APPEND: 'append',
  REPLACE: 'replace',
  EDIT: 'edit',
}

export const isWhiteboardNote = (note) => (note?.note_type || 'markdown') === 'whiteboard'

export const resolveNoteById = (notes = [], id) => {
  if (id == null || id === '') return null
  return (Array.isArray(notes) ? notes : []).find((note) => String(note?.id) === String(id)) || null
}

// 从待确认动作的上下文快照里取出"动作被提出时所在的笔记 id"。
// 用户确认前可能已经切走，快照比实时 currentNote 更能代表用户当时的真实意图。
export const resolveContextNoteId = (actionContext) => {
  if (!actionContext || typeof actionContext !== 'object') return null
  const id = actionContext.selectedNoteId ?? actionContext.currentNoteId
  return id == null || id === '' ? null : id
}

export const normalizeWhiteboardAction = (action, fallback = WHITEBOARD_AI_ACTIONS.APPEND) => {
  const value = String(action || '').trim().toLowerCase()
  if (Object.values(WHITEBOARD_AI_ACTIONS).includes(value)) {
    return value
  }
  return fallback
}

const trimInline = (text = '', max = 32) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  return value.length > max ? `${value.slice(0, max)}...` : value
}

export const summarizeWhiteboardElementsForAI = (elements = [], fileMap = {}) => {
  const activeElements = Array.isArray(elements)
    ? elements.filter((item) => item && !item.isDeleted)
    : []

  if (!activeElements.length) {
    return '当前画布为空。'
  }

  const textSnippets = activeElements
    .map((item) => {
      if (item?.text) return trimInline(item.text, 80)
      // 整体 SVG 只有一个 image 元素；编辑时仍需保留其中的标题、日期和正文。
      if (item?.customData?.svgSource && typeof DOMParser !== 'undefined') {
        const svg = new DOMParser().parseFromString(item.customData.svgSource, 'image/svg+xml')
        return trimInline([...svg.querySelectorAll('text')].map(node => node.textContent).join(' | '), 4000)
      }
      return ''
    })
    .filter(Boolean)
    .slice(0, 18)

  const typeCounts = {}
  activeElements.forEach((item) => {
    const type = item?.type || 'unknown'
    typeCounts[type] = (typeCounts[type] || 0) + 1
  })

  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([type, count]) => `${type}:${count}`)
    .join('，')

  const imageCount = activeElements.filter((item) => item?.type === 'image').length || Object.keys(fileMap || {}).length
  const svgCount = activeElements.filter((item) => item?.customData?.kind === 'svg-image').length

  return [
    `元素总数：${activeElements.length}`,
    topTypes ? `元素类型：${topTypes}` : '',
    imageCount > 0 ? `图片数量：${imageCount}` : '',
    svgCount > 0 ? `其中 SVG 整体元素：${svgCount}（不能拆分编辑，只能整体调整或修改源码）` : '',
    textSnippets.length ? `画布文字：${textSnippets.join(' | ')}` : '画布文字：无明显文本标签',
  ].filter(Boolean).join('\n')
}

export const summarizeWhiteboardContentForAI = (content = '') => {
  const parsed = parseWhiteboardContent(content)
  return summarizeWhiteboardElementsForAI(parsed.elements, parsed.fileMap)
}

const normalizeAppState = (appState = {}) => ({
  gridModeEnabled: Boolean(appState?.gridModeEnabled),
  scrollX: appState?.scrollX,
  scrollY: appState?.scrollY,
  zoom: appState?.zoom,
  viewBackgroundColor: appState?.viewBackgroundColor || '#ffffff',
  currentItemFontFamily: appState?.currentItemFontFamily || 1,
  gridSize: appState?.gridSize ?? null,
})

export const parseWhiteboardContent = (content = '') => {
  if (!content) {
    return {
      type: 'excalidraw',
      version: 2,
      source: 'Flota-local',
      elements: [],
      appState: normalizeAppState(),
      fileMap: {},
    }
  }

  const data = JSON.parse(content)
  if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) {
    throw new Error('画布数据格式错误')
  }

  return {
    ...data,
    appState: normalizeAppState(data.appState),
    fileMap: data.fileMap || data.files || {},
  }
}

// Every save path must finish image persistence before returning or writing scene JSON.
export const saveWhiteboardFiles = async (files = {}) => {
  const ids = Object.keys(files || {})
  if (!ids.length) return {}
  const result = await window.electronAPI.whiteboard.saveImages(files)
  if (!result?.success) throw new Error(result?.error || '画布图片保存失败')
  if (!result.data || ids.some(id => !result.data[id])) throw new Error('画布图片保存不完整，原内容未覆盖')
  return result.data
}

export const buildWhiteboardContent = ({ elements = [], appState = {}, fileMap = {} }) => JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'Flota-local',
  elements,
  appState: normalizeAppState(appState),
  fileMap,
})

export const generateWhiteboardElementsByAction = async ({
  action = WHITEBOARD_AI_ACTIONS.APPEND,
  spec = null,
  elements = [],
  appState = {},
  task,
}) => {
  const activeElements = elements.filter(element => element && !element.isDeleted)
  const normalizedAction = normalizeWhiteboardAction(action)

  // 对话智能体自己写好的画布内容：直接渲染，不再调用第二个模型
  if (spec) {
    const { renderCanvasSpec } = await import('./diagrams/agentCanvas')
    const { isAiCanvasSvgAllowed } = await import('./diagrams/canvasSvgPolicy')
    const isAppend = normalizedAction === WHITEBOARD_AI_ACTIONS.APPEND
    const r = await renderCanvasSpec(spec, { existingElements: activeElements, append: isAppend, allowSvg: await isAiCanvasSvgAllowed() })
    task?.throwIfCancelled()
    if (!Array.isArray(r.elements) || !r.elements.some(element => element && !element.isDeleted)) {
      throw new Error('画布生成结果为空，原画布未修改')
    }
    return {
      action: spec.patch ? WHITEBOARD_AI_ACTIONS.EDIT : normalizedAction,
      elements: r.replacesAll ? r.elements : (isAppend ? [...activeElements, ...r.elements] : r.elements),
      appState: normalizeAppState(appState),
      fileMap: r.files,
      addedCount: r.elements.length,
      warnings: r.warnings,
    }
  }

  // 旧版只有一句描述（prompt）的确认卡由已移除的生成器处理，现在给出明确说明
  throw new Error(LEGACY_CARD_ERROR)
}

const normalizeWhiteboardGenerationError = (error) => {
  const message = String(error?.message || error || '')
  if (error?.name === 'AbortError') return error
  if (/fetch failed|network|网络|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|timeout|超时|aborted|abort/i.test(message)) {
    return new Error('画布生成失败：网络请求失败，请检查网络或 AI 配置后重试')
  }
  return error instanceof Error ? error : new Error(message || '画布生成失败')
}

export const requestActiveWhiteboardGeneration = ({ noteId, spec = null, action = WHITEBOARD_AI_ACTIONS.APPEND, task }) => {
  if (typeof window === 'undefined') return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const detail = {
      noteId: String(noteId),
      spec,
      action: normalizeWhiteboardAction(action),
      task,
      handled: false,
      resolve,
      reject,
    }

    window.dispatchEvent(new CustomEvent(WHITEBOARD_AI_GENERATE_EVENT, { detail }))
    if (!detail.handled) {
      resolve(null)
    }
  })
}

export const applyWhiteboardGenerationToNote = async ({ note, spec = null, action = WHITEBOARD_AI_ACTIONS.APPEND, updateNote, task }) => {
  if (!isWhiteboardNote(note)) {
    throw new Error('当前笔记不是画布')
  }
  if (typeof updateNote !== 'function') {
    throw new Error('缺少笔记更新能力')
  }

  const currentData = parseWhiteboardContent(note.content)
  const nextData = await generateWhiteboardElementsByAction({
    action,
    spec,
    task,
    elements: currentData.elements,
    appState: currentData.appState,
  })

  // 未在编辑器中打开的画布会走这里。生成器返回的是 Excalidraw BinaryFileData，
  // 必须先落盘再把 { fileName, mimeType } 索引写入笔记，否则重新打开时无法加载图片。
  task?.throwIfCancelled()
  const generatedFiles = nextData.fileMap || {}
  const persistedGeneratedFiles = await saveWhiteboardFiles(generatedFiles)

  const normalizedAction = normalizeWhiteboardAction(nextData.action, action)
  const persistedFileMap = normalizedAction !== WHITEBOARD_AI_ACTIONS.REPLACE
    ? { ...(currentData.fileMap || {}), ...persistedGeneratedFiles }
    : persistedGeneratedFiles
  const content = buildWhiteboardContent({
    ...nextData,
    fileMap: persistedFileMap,
  })
  task?.beginCommit()
  const result = await updateNote(note.id, {
    content,
    note_type: 'whiteboard',
  })

  if (result?.success === false) {
    throw new Error(result.error || '画布写入失败')
  }

  return { ...nextData, fileMap: persistedFileMap }
}

const buildWhiteboardActionMessage = (result = {}) => {
  const action = normalizeWhiteboardAction(result.action)
  const warningText = Array.isArray(result.warnings) && result.warnings.length > 0
    ? ` 提示：${result.warnings.slice(0, 2).join('；')}${result.warnings.length > 2 ? '；...' : ''}`
    : ''
  if (action === WHITEBOARD_AI_ACTIONS.REPLACE) {
    return `已重新生成画布，共 ${result.addedCount || 0} 个元素。${warningText}`
  }
  if (action === WHITEBOARD_AI_ACTIONS.EDIT) {
    return `已基于当前画布完成修改，生成 ${result.addedCount || 0} 个元素。${warningText}`
  }
  return `已在当前画布插入 ${result.addedCount || 0} 个元素。${warningText}`
}

// 数据已保存后的列表刷新失败不能把操作标成失败，否则用户重试会重复创建。
const refreshWhiteboardNotes = async (loadNotes, result) => {
  try {
    await loadNotes?.()
  } catch (error) {
    logger.warn('[whiteboardAI] 画布已保存，但列表刷新失败:', error)
    result.warnings = [...(result.warnings || []), '画布已保存，但列表刷新失败，请重新打开笔记列表']
  }
}

export const executeCreateWhiteboardToolAction = async ({
  args = {},
  currentNote = null,
  notes = [],
  actionContext = null,
  createNote,
  deleteNote,
  updateNote,
  loadNotes,
  task,
}) => {
  if (typeof createNote !== 'function' || typeof updateNote !== 'function') {
    throw new Error('缺少画布创建能力')
  }

  const { readCanvasSpec } = await import('./diagrams/agentCanvas')
  const spec = readCanvasSpec(args)
  if (!spec) throw new Error(LEGACY_CARD_ERROR)
  const title = String(args.title || '').trim() || String(spec.canvas?.title || '').trim() || '未命名画布'

  const created = await createNote({
    note_type: 'whiteboard',
    title,
    content: buildWhiteboardContent({}),
    selectAfterCreate: false,
  })
  if (!created?.success || !created.data?.id) {
    throw new Error(created?.error || '创建画布笔记失败')
  }

  const newNote = created.data
  let result
  try {
    result = await applyWhiteboardGenerationToNote({
      note: newNote,
      spec,
      action: WHITEBOARD_AI_ACTIONS.REPLACE,
      updateNote,
      task,
    })
  } catch (error) {
    if (typeof deleteNote === 'function') {
      try {
        await deleteNote(newNote.id)
      } catch (cleanupError) {
        console.warn('[executeCreateWhiteboardToolAction] 清理失败的空白画布失败:', cleanupError)
      }
    }
    throw normalizeWhiteboardGenerationError(error)
  }

  await refreshWhiteboardNotes(loadNotes, result)

  return {
    success: true,
    noteId: newNote.id,
    title: newNote.title || title,
    addedCount: result.addedCount || 0,
    message: `已创建画布《${newNote.title || title}》并生成 ${result.addedCount || 0} 个元素。${result.warnings?.length ? ` 提示：${result.warnings.join('；')}` : ''}`,
    result,
  }
}

export const executeUpdateWhiteboardToolAction = async ({
  args = {},
  currentNote = null,
  notes = [],
  actionContext = null,
  updateNote,
  loadNotes,
  setSelectedNoteId,
  task,
}) => {
  if (typeof updateNote !== 'function') {
    throw new Error('缺少画布更新能力')
  }

  const { readCanvasSpec } = await import('./diagrams/agentCanvas')
  const spec = readCanvasSpec(args)
  if (!spec) throw new Error(LEGACY_CARD_ERROR)

  // 目标画布解析（问题5）：
  // - 显式传了 target_note_id：必须命中且是画布，否则直接失败，绝不静默回退到当前画布；
  // - 未传 target_note_id：优先用动作被提出时的上下文快照笔记，其次回退当前画布。
  let targetNote
  if (args.target_note_id != null && args.target_note_id !== '') {
    targetNote = resolveNoteById(notes, args.target_note_id)
    if (!targetNote) {
      throw new Error('未找到指定的目标画布，可能已被删除')
    }
  } else {
    const snapshotId = resolveContextNoteId(actionContext)
    targetNote = snapshotId != null ? resolveNoteById(notes, snapshotId) : currentNote
  }
  if (!targetNote || !isWhiteboardNote(targetNote)) {
    throw new Error('未找到可修改的目标画布')
  }

  const action = spec.patch
    ? WHITEBOARD_AI_ACTIONS.EDIT
    : normalizeWhiteboardAction(args.mode || args.action, WHITEBOARD_AI_ACTIONS.APPEND)

  // 若目标画布正在编辑器中打开，优先走实时 scene（问题8），避免用持久化的旧 content
  // 覆盖用户未保存的改动；编辑器未接管时（detail.handled 仍为 false）才回退读持久化内容。
  const activeResult = await requestActiveWhiteboardGeneration({
    noteId: targetNote.id,
    spec,
    action,
    task,
  })
  const result = activeResult || await applyWhiteboardGenerationToNote({
    note: targetNote,
    spec,
    action,
    updateNote,
    task,
  })

  // 后台完成不改变用户当前选中的笔记。
  await refreshWhiteboardNotes(loadNotes, result)

  return {
    success: true,
    noteId: targetNote.id,
    title: targetNote.title || '未命名画布',
    addedCount: result.addedCount || 0,
    action,
    message: buildWhiteboardActionMessage(result),
    result,
  }
}
