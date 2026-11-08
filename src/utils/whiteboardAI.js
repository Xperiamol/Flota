// 动态导入 aiExcalidrawGenerator 以避免首屏加载 Excalidraw 依赖（~1.3MB）
import { stripMarkdownToPreviewText } from './markdownTextUtils'
import logger from './logger'

const loadAIGenerator = () =>
  import('./aiExcalidrawGenerator').then(m => m.aiGenerateExcalidrawElements)

export const WHITEBOARD_AI_GENERATE_EVENT = 'flota:whiteboard-ai-generate'
export const WHITEBOARD_AI_ACTIONS = {
  APPEND: 'append',
  REPLACE: 'replace',
  EDIT: 'edit',
}

export const isWhiteboardNote = (note) => (note?.note_type || 'markdown') === 'whiteboard'

const WHITEBOARD_DIAGRAM_TYPE_LABELS = {
  auto: '',
  mindmap: '思维导图',
  flowchart: '流程图',
  architecture: '架构图',
  sequence: '时序图',
  hierarchy: '层级结构图',
  fishbone: '鱼骨图',
  timeline: '时间轴',
  gantt: '甘特图',
  quadrant: '四象限图',
  pie: '饼图',
  svg: 'SVG 矢量图',
}

const buildCurrentNoteContext = (note = null) => {
  if (!note || isWhiteboardNote(note)) return null
  const raw = typeof note.content === 'string' ? note.content : ''
  const preview = stripMarkdownToPreviewText(raw).slice(0, 1800).trim()
  return {
    id: note.id,
    title: String(note.title || '').trim(),
    noteType: note.note_type || 'markdown',
    contentPreview: preview,
  }
}

const buildWhiteboardGenerationPrompt = ({ prompt, diagramType = 'auto', sourceNote = null }) => {
  const text = String(prompt || '').trim()
  const typeKey = String(diagramType || 'auto').trim().toLowerCase()
  const typeLabel = WHITEBOARD_DIAGRAM_TYPE_LABELS[typeKey] || ''
  const currentNoteContext = buildCurrentNoteContext(sourceNote)

  return [
    typeLabel ? `以${typeLabel}呈现：${text}` : text,
    currentNoteContext
      ? `参考当前笔记内容生成，不要替换成其他故事或通用示例。\n当前笔记标题：${currentNoteContext.title || '未命名'}\n当前笔记内容摘要：${currentNoteContext.contentPreview || '（空）'}`
      : ''
  ].filter(Boolean).join('\n\n')
}

const resolveNoteById = (notes = [], id) => {
  if (id == null || id === '') return null
  return (Array.isArray(notes) ? notes : []).find((note) => String(note?.id) === String(id)) || null
}

// 从待确认动作的上下文快照里取出"动作被提出时所在的笔记 id"。
// 用户确认前可能已经切走，快照比实时 currentNote 更能代表用户当时的真实意图。
const resolveContextNoteId = (actionContext) => {
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

export const inferWhiteboardActionFromPrompt = (prompt = '') => {
  const text = String(prompt || '').trim().toLowerCase()
  if (!text) return WHITEBOARD_AI_ACTIONS.APPEND

  if (/(清空|重画|重做|重新生成|整张重来|全部重来|整体重构|覆盖当前|替换当前|推翻重画)/.test(text)) {
    return WHITEBOARD_AI_ACTIONS.REPLACE
  }

  if (/(修改|调整|优化|美化|太丑|不好看|不整齐|不对齐|改成|改为|删掉|删除|去掉|替换掉|重排|合并|拆分|补齐|修正|更新一下|把.+改)/.test(text)) {
    return WHITEBOARD_AI_ACTIONS.EDIT
  }

  return WHITEBOARD_AI_ACTIONS.APPEND
}

const deriveFallbackWhiteboardTitle = (prompt = '', note = null) => {
  const text = String(prompt || '').trim()
  const baseTitle = String(note?.title || '').trim()

  if (/思维导图|脑图/i.test(text)) return baseTitle ? `${baseTitle}·思维导图` : '思维导图'
  if (/流程图/i.test(text)) return baseTitle ? `${baseTitle}·流程图` : '流程图'
  if (/架构图/i.test(text)) return baseTitle ? `${baseTitle}·架构图` : '架构图'
  if (/时序图/i.test(text)) return baseTitle ? `${baseTitle}·时序图` : '时序图'
  if (/甘特图/i.test(text)) return baseTitle ? `${baseTitle}·甘特图` : '甘特图'
  if (/鱼骨图/i.test(text)) return baseTitle ? `${baseTitle}·鱼骨图` : '鱼骨图'
  if (/(?:SVG|矢量)/i.test(text)) return baseTitle ? `${baseTitle}·矢量图` : 'SVG 矢量图'
  return baseTitle ? `${baseTitle}·画布` : '未命名画布'
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
  prompt,
  elements = [],
  appState = {},
  currentWhiteboardSummary = '',
  task,
}) => {
  const activeElements = elements.filter(element => element && !element.isDeleted)
  const normalizedAction = normalizeWhiteboardAction(action)

  const unwrap = (res) => {
    if (Array.isArray(res)) return { elements: res, files: {}, warnings: [] }
    return { elements: res?.elements || [], files: res?.files || {}, warnings: res?.warnings || [] }
  }
  const aiGenerateExcalidrawElements = await loadAIGenerator()
  const isAppend = normalizedAction === WHITEBOARD_AI_ACTIONS.APPEND
  const r = normalizedAction === WHITEBOARD_AI_ACTIONS.EDIT
    ? await import('./diagrams/editScene').then(({ editScene }) => editScene({ elements: activeElements, prompt, appState, task }))
    : unwrap(await aiGenerateExcalidrawElements(String(prompt || '').trim(), isAppend ? activeElements : [], task))
  if (!Array.isArray(r.elements) || !r.elements.some(element => element && !element.isDeleted)) {
    throw new Error('画布生成结果为空，原画布未修改')
  }

  return {
    action: normalizedAction,
    elements: isAppend ? [...activeElements, ...r.elements] : r.elements,
    appState: normalizeAppState(appState),
    // fileMap 始终只承载本次生成的 BinaryFileData；磁盘索引由保存层合并。
    fileMap: r.files,
    addedCount: r.elements.length,
    warnings: r.warnings,
  }
}

const normalizeWhiteboardGenerationError = (error) => {
  const message = String(error?.message || error || '')
  if (error?.name === 'AbortError') return error
  if (/fetch failed|network|网络|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|timeout|超时|aborted|abort/i.test(message)) {
    return new Error('画布生成失败：网络请求失败，请检查网络或 AI 配置后重试')
  }
  return error instanceof Error ? error : new Error(message || '画布生成失败')
}

export const requestActiveWhiteboardGeneration = ({ noteId, prompt, action = WHITEBOARD_AI_ACTIONS.APPEND, task }) => {
  if (typeof window === 'undefined') return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const detail = {
      noteId: String(noteId),
      prompt,
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

export const applyWhiteboardGenerationToNote = async ({ note, prompt, action = WHITEBOARD_AI_ACTIONS.APPEND, updateNote, task }) => {
  if (!isWhiteboardNote(note)) {
    throw new Error('当前笔记不是画布')
  }
  if (typeof updateNote !== 'function') {
    throw new Error('缺少笔记更新能力')
  }

  const currentData = parseWhiteboardContent(note.content)
  const nextData = await generateWhiteboardElementsByAction({
    action,
    prompt,
    task,
    elements: currentData.elements,
    appState: currentData.appState,
    currentWhiteboardSummary: summarizeWhiteboardElementsForAI(currentData.elements, currentData.fileMap),
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

  const rawPrompt = String(args.prompt || '').trim()
  if (!rawPrompt) throw new Error('缺少画布生成描述')

  const useCurrentNoteContext = args.use_current_note_context === true
  const snapshotNote = resolveNoteById(notes, resolveContextNoteId(actionContext))
  const explicitSourceNote = resolveNoteById(notes, args.source_note_id)
  const sourceNote = explicitSourceNote || (useCurrentNoteContext ? (snapshotNote || currentNote) : null)
  const title = String(args.title || '').trim() || deriveFallbackWhiteboardTitle(rawPrompt, sourceNote)
  const generationPrompt = buildWhiteboardGenerationPrompt({
    prompt: rawPrompt,
    diagramType: args.diagram_type || 'auto',
    sourceNote,
  })

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
      prompt: generationPrompt,
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

  const rawPrompt = String(args.prompt || '').trim()
  if (!rawPrompt) throw new Error('缺少画布修改描述')

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

  const action = normalizeWhiteboardAction(
    args.action,
    inferWhiteboardActionFromPrompt(rawPrompt)
  )
  const generationPrompt = buildWhiteboardGenerationPrompt({
    prompt: rawPrompt,
    diagramType: args.diagram_type || 'auto',
    sourceNote: null,
  })

  // 若目标画布正在编辑器中打开，优先走实时 scene（问题8），避免用持久化的旧 content
  // 覆盖用户未保存的改动；编辑器未接管时（detail.handled 仍为 false）才回退读持久化内容。
  const activeResult = await requestActiveWhiteboardGeneration({
    noteId: targetNote.id,
    prompt: generationPrompt,
    action,
    task,
  })
  const result = activeResult || await applyWhiteboardGenerationToNote({
    note: targetNote,
    prompt: generationPrompt,
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
