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
export const WHITEBOARD_AI_INTENTS = {
  CHAT: 'chat',
  WHITEBOARD: 'whiteboard',
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
}

const truncateText = (text = '', max = 1200) => {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max)}...` : value
}

const getRecentConversationContext = (messages = [], prompt = '') => {
  const normalizedPrompt = String(prompt || '').trim()
  return messages
    .filter(message => message?.content)
    .filter((message, index, arr) => !(index === arr.length - 1 && String(message.content).trim() === normalizedPrompt))
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: truncateText(message.content, 1000),
    }))
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

  if (/(修改|调整|优化|改成|改为|删掉|删除|去掉|替换掉|重排|合并|拆分|补齐|修正|更新一下|把.+改)/.test(text)) {
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
    .map((item) => trimInline(item?.text || '', 28))
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

  return [
    `元素总数：${activeElements.length}`,
    topTypes ? `元素类型：${topTypes}` : '',
    imageCount > 0 ? `图片数量：${imageCount}` : '',
    textSnippets.length ? `画布文字：${textSnippets.join(' | ')}` : '画布文字：无明显文本标签',
  ].filter(Boolean).join('\n')
}

export const summarizeWhiteboardContentForAI = (content = '') => {
  const parsed = parseWhiteboardContent(content)
  return summarizeWhiteboardElementsForAI(parsed.elements, parsed.fileMap)
}

const buildIntentClassificationMessages = ({ prompt, note, messages = [], currentWhiteboardSummary = '' }) => {
  const recentMessages = getRecentConversationContext(messages, prompt)

  return [
    {
      role: 'system',
      content: `你是 Flota 的画布请求路由器。你的任务是先判断：用户最新一句话，到底应该走“普通文字问答(chat)”还是“画布生成/修改(whiteboard)”。

只输出一个 JSON 对象，禁止解释、Markdown、代码块。

输出格式：
{
  "intent": "chat | whiteboard",
  "reason": "一句简短原因"
}

判定原则：
1. chat：总结、解释、提炼要点、问答、翻译、润色、分析风险、列待办、理解当前画布内容、基于画布做文字回复。
2. whiteboard：明确要求生成/插入/补充/重画/替换/修改图形或画布内容。
3. 只因为当前笔记是画布，并不代表必须走 whiteboard。
4. 用户如果说“总结当前笔记/当前画布”“解释这个流程”“提炼结论”，即使上下文是画布，也应判为 chat。
5. 只有当用户明确想让画布发生变化，或者最近对话强烈表明“上一轮就在让你继续画图/改图”时，才判为 whiteboard。
6. 有歧义时优先判为 chat，避免误改画布。`
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt,
        currentNote: {
          id: note?.id ?? null,
          title: note?.title || '',
          tags: note?.tags || [],
          noteType: note?.note_type || 'markdown',
        },
        currentWhiteboardSummary,
        recentConversation: recentMessages,
      })
    }
  ]
}

const buildGroundingMessages = ({ prompt, note, messages = [], currentWhiteboardSummary = '', actionHint }) => {
  const recentMessages = getRecentConversationContext(messages, prompt)

  return [
    {
      role: 'system',
      content: `你是 Flota 的画布素材整理器。上游已经确认：这次请求应该进入画布生成/修改流程。
你的任务是从用户最新一句话、最近对话以及当前画布摘要里，判断动作并提炼“真正要绘制成图的内容”。
图表类型由下游生成器自动选择，你不需要决定。

只输出一个 JSON 对象，禁止解释、Markdown、代码块。

输出格式：
{
  "action": "append | replace | edit",
  "groundedRequest": "可直接交给图表生成器使用的完整说明，包含真实主题、节点、关系或步骤",
  "reason": "一句简短原因"
}

规则：
1. 永远不要把画布原始 JSON 当成素材；如果提供了 currentWhiteboardSummary，只能使用这个语义摘要。
2. append = 在现有画布基础上继续补充；replace = 清空后重新生成整张画布；edit = 基于当前画布内容做定向修改，输出“修改后的完整画布需求”。
3. 如果用户说“这段内容/上面/刚才/整理一下”，优先用最近对话里 assistant 或 user 的真实文本。
4. 如果只有命令句、找不到具体素材，groundedRequest 设为空字符串，由前端用原 prompt 兜底。
5. 不要画“Mermaid 规范 / 图表规范 / 画布功能说明”这类元信息。
6. groundedRequest 必须是描述要画什么的中文说明，不要直接输出 Mermaid 或其他 DSL。
7. 如果用户明确指定图表类型（如“画甘特图/鱼骨图/思维导图”），把这个偏好写在 groundedRequest 开头，例如“以鱼骨图呈现：……”。
8. 如果 actionHint 很明确，应尽量与 actionHint 保持一致；只有用户表达明显相反时才改动。`
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt,
        actionHint,
        currentNote: {
          id: note?.id ?? null,
          title: note?.title || '',
          tags: note?.tags || [],
        },
        currentWhiteboardSummary,
        recentConversation: recentMessages,
      })
    }
  ]
}

const parseModelJsonObject = (content = '', errorMessage = '模型结果格式错误') => {
  const text = String(content || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(errorMessage)
  }
  return JSON.parse(text.slice(start, end + 1))
}

const normalizeWhiteboardIntent = (intent) => {
  const value = String(intent || '').trim().toLowerCase()
  return value === WHITEBOARD_AI_INTENTS.WHITEBOARD
    ? WHITEBOARD_AI_INTENTS.WHITEBOARD
    : WHITEBOARD_AI_INTENTS.CHAT
}

export const classifyWhiteboardIntent = async ({ note, prompt, messages = [] }) => {
  const currentWhiteboardSummary = isWhiteboardNote(note)
    ? summarizeWhiteboardContentForAI(note?.content)
    : ''
  const res = await window.electronAPI.ai.chat(
    buildIntentClassificationMessages({ prompt, note, messages, currentWhiteboardSummary }),
    { temperature: 0 }
  )

  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || '画布意图分类失败')
  }

  const parsed = parseModelJsonObject(res.data.content, '画布意图分类结果格式错误')
  return {
    intent: normalizeWhiteboardIntent(parsed?.intent),
    reason: String(parsed?.reason || '').trim(),
  }
}

export const groundWhiteboardRequest = async ({ note, prompt, messages = [] }) => {
  const actionHint = inferWhiteboardActionFromPrompt(prompt)
  const currentWhiteboardSummary = isWhiteboardNote(note)
    ? summarizeWhiteboardContentForAI(note?.content)
    : ''
  const res = await window.electronAPI.ai.chat(
    buildGroundingMessages({ prompt, note, messages, currentWhiteboardSummary, actionHint }),
    { temperature: 0 }
  )

  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || '画布素材整理失败')
  }

  const parsed = parseModelJsonObject(res.data.content, '画布素材整理结果格式错误')
  return {
    action: normalizeWhiteboardAction(parsed?.action, actionHint),
    groundedRequest: String(parsed?.groundedRequest || '').trim(),
    reason: parsed?.reason || '',
  }
}

const normalizeAppState = (appState = {}) => ({
  viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
  currentItemFontFamily: appState.currentItemFontFamily || 1,
  gridSize: appState.gridSize ?? null,
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

export const buildWhiteboardContent = ({ elements = [], appState = {}, fileMap = {} }) => JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'Flota-local',
  elements,
  appState: normalizeAppState(appState),
  fileMap,
})

const buildEditGenerationPrompt = ({ prompt, currentWhiteboardSummary = '' }) => {
  if (!currentWhiteboardSummary) {
    return `请基于以下修改要求，输出修改后的完整画布：\n${prompt}`
  }
  return [
    '请基于当前画布内容进行定向修改，并输出修改后的完整画布。',
    '不要解释过程，不要保留与修改目标无关的冗余旧结构。',
    `当前画布摘要：\n${currentWhiteboardSummary}`,
    `修改要求：\n${prompt}`,
  ].join('\n\n')
}

export const generateWhiteboardElementsByAction = async ({
  action = WHITEBOARD_AI_ACTIONS.APPEND,
  prompt,
  elements = [],
  appState = {},
  fileMap = {},
  currentWhiteboardSummary = '',
}) => {
  const activeElements = elements.filter(element => element && !element.isDeleted)
  const normalizedAction = normalizeWhiteboardAction(action)

  const unwrap = (res) => {
    if (Array.isArray(res)) return { elements: res, files: {}, warnings: [] }
    return { elements: res?.elements || [], files: res?.files || {}, warnings: res?.warnings || [] }
  }

  if (normalizedAction === WHITEBOARD_AI_ACTIONS.REPLACE) {
    const aiGenerateExcalidrawElements = await loadAIGenerator()
    const r = unwrap(await aiGenerateExcalidrawElements(String(prompt || '').trim(), []))
    return {
      action: normalizedAction,
      elements: r.elements,
      appState: normalizeAppState(appState),
      fileMap: r.files,
      addedCount: r.elements.length,
      warnings: r.warnings,
    }
  }

  if (normalizedAction === WHITEBOARD_AI_ACTIONS.EDIT) {
    const editPrompt = buildEditGenerationPrompt({ prompt, currentWhiteboardSummary })
    const aiGenerateExcalidrawElements = await loadAIGenerator()
    const r = unwrap(await aiGenerateExcalidrawElements(editPrompt, []))
    return {
      action: normalizedAction,
      elements: r.elements,
      appState: normalizeAppState(appState),
      fileMap: r.files,
      addedCount: r.elements.length,
      warnings: r.warnings,
    }
  }

  const aiGenerateExcalidrawElements = await loadAIGenerator()
  const r = unwrap(await aiGenerateExcalidrawElements(prompt, activeElements))
  const nextElements = [...activeElements, ...r.elements]

  return {
    action: normalizedAction,
    elements: nextElements,
    appState: normalizeAppState(appState),
    fileMap: { ...(fileMap || {}), ...r.files },
    addedCount: r.elements.length,
    warnings: r.warnings,
  }
}

const normalizeWhiteboardGenerationError = (error) => {
  const message = String(error?.message || error || '')
  if (/fetch failed|network|网络|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|timeout|超时|aborted|abort/i.test(message)) {
    return new Error('画布生成失败：网络请求失败，请检查网络或 AI 配置后重试')
  }
  return error instanceof Error ? error : new Error(message || '画布生成失败')
}

export const generateAndAppendWhiteboardElements = async ({ prompt, elements = [], appState = {}, fileMap = {} }) =>
  generateWhiteboardElementsByAction({
    action: WHITEBOARD_AI_ACTIONS.APPEND,
    prompt,
    elements,
    appState,
    fileMap,
  })

export const requestActiveWhiteboardGeneration = ({ noteId, prompt, action = WHITEBOARD_AI_ACTIONS.APPEND }) => {
  if (typeof window === 'undefined') return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const detail = {
      noteId: String(noteId),
      prompt,
      action: normalizeWhiteboardAction(action),
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

export const applyWhiteboardGenerationToNote = async ({ note, prompt, action = WHITEBOARD_AI_ACTIONS.APPEND, updateNote }) => {
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
    elements: currentData.elements,
    appState: currentData.appState,
    fileMap: currentData.fileMap,
    currentWhiteboardSummary: summarizeWhiteboardElementsForAI(currentData.elements, currentData.fileMap),
  })

  const content = buildWhiteboardContent(nextData)
  const result = await updateNote(note.id, {
    content,
    note_type: 'whiteboard',
  })

  if (result?.success === false) {
    throw new Error(result.error || '画布写入失败')
  }

  return nextData
}

const buildWhiteboardActionMessage = (result = {}) => {
  const action = normalizeWhiteboardAction(result.action)
  const warningText = Array.isArray(result.warnings) && result.warnings.length > 0
    ? ` 部分区块未生成：${result.warnings.slice(0, 2).join('；')}${result.warnings.length > 2 ? '；...' : ''}`
    : ''
  if (action === WHITEBOARD_AI_ACTIONS.REPLACE) {
    return `已清空当前画布并重新生成 ${result.addedCount || 0} 个元素。${warningText}`
  }
  if (action === WHITEBOARD_AI_ACTIONS.EDIT) {
    return `已基于当前画布完成修改，生成 ${result.addedCount || 0} 个元素。${warningText}`
  }
  return `已在当前画布插入 ${result.addedCount || 0} 个元素。${warningText}`
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
}) => {
  if (typeof createNote !== 'function' || typeof updateNote !== 'function') {
    throw new Error('缺少画布创建能力')
  }

  const rawPrompt = String(args.prompt || '').trim()
  if (!rawPrompt) throw new Error('缺少画布生成描述')

  const useCurrentNoteContext = args.use_current_note_context !== false
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

  await loadNotes?.()

  return {
    success: true,
    noteId: newNote.id,
    title: newNote.title || title,
    addedCount: result.addedCount || 0,
    message: `已创建画布《${newNote.title || title}》并生成 ${result.addedCount || 0} 个元素。`,
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
    const snapshotNote = resolveNoteById(notes, resolveContextNoteId(actionContext))
    targetNote = snapshotNote || currentNote
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
  })
  const result = activeResult || await applyWhiteboardGenerationToNote({
    note: targetNote,
    prompt: generationPrompt,
    action,
    updateNote,
  })

  setSelectedNoteId?.(targetNote.id)
  await loadNotes?.()

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

