import { aiGenerateExcalidrawElements } from './aiExcalidrawGenerator'

export const WHITEBOARD_AI_GENERATE_EVENT = 'flota:whiteboard-ai-generate'
export const WHITEBOARD_AI_ACTIONS = {
  APPEND: 'append',
  REPLACE: 'replace',
  EDIT: 'edit',
}

export const isWhiteboardNote = (note) => (note?.note_type || 'markdown') === 'whiteboard'

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
    return '当前白板为空。'
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

const buildGroundingMessages = ({ prompt, note, messages = [], currentWhiteboardSummary = '', actionHint }) => {
  const recentMessages = getRecentConversationContext(messages, prompt)

  return [
    {
      role: 'system',
      content: `你是 Flota 的白板素材整理器。当前笔记是白板，用户的请求一定要走白板生成。
你的任务是从用户最新一句话、最近对话以及当前白板摘要里，判断动作并提炼“真正要绘制成图的内容”。
图表类型由下游生成器自动选择，你不需要决定。

只输出一个 JSON 对象，禁止解释、Markdown、代码块。

输出格式：
{
  "action": "append | replace | edit",
  "groundedRequest": "可直接交给图表生成器使用的完整说明，包含真实主题、节点、关系或步骤",
  "reason": "一句简短原因"
}

规则：
1. 永远不要把白板原始 JSON 当成素材；如果提供了 currentWhiteboardSummary，只能使用这个语义摘要。
2. append = 在现有白板基础上继续补充；replace = 清空后重新生成整张白板；edit = 基于当前白板内容做定向修改，输出“修改后的完整白板需求”。
3. 如果用户说“这段内容/上面/刚才/整理一下”，优先用最近对话里 assistant 或 user 的真实文本。
4. 如果只有命令句、找不到具体素材，groundedRequest 设为空字符串，由前端用原 prompt 兜底。
5. 不要画“Mermaid 规范 / 图表规范 / 白板功能说明”这类元信息。
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

const parseGroundingResult = (content = '') => {
  const text = String(content || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('白板素材整理结果格式错误')
  }
  return JSON.parse(text.slice(start, end + 1))
}

export const groundWhiteboardRequest = async ({ note, prompt, messages = [] }) => {
  const actionHint = inferWhiteboardActionFromPrompt(prompt)
  const currentWhiteboardSummary = isWhiteboardNote(note)
    ? summarizeWhiteboardContentForAI(note?.content)
    : ''
  const res = await window.electronAPI.ai.chat(
    buildGroundingMessages({ prompt, note, messages, currentWhiteboardSummary, actionHint }),
    { temperature: 0, maxTokens: 400 }
  )

  if (!res?.success || !res.data?.content) {
    throw new Error(res?.error || '白板素材整理失败')
  }

  const parsed = parseGroundingResult(res.data.content)
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
    throw new Error('白板数据格式错误')
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
    return `请基于以下修改要求，输出修改后的完整白板：\n${prompt}`
  }
  return [
    '请基于当前白板内容进行定向修改，并输出修改后的完整白板。',
    '不要解释过程，不要保留与修改目标无关的冗余旧结构。',
    `当前白板摘要：\n${currentWhiteboardSummary}`,
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
    throw new Error('当前笔记不是白板')
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
    throw new Error(result.error || '白板写入失败')
  }

  return nextData
}

const buildWhiteboardActionMessage = (result = {}) => {
  const action = normalizeWhiteboardAction(result.action)
  const warningText = Array.isArray(result.warnings) && result.warnings.length > 0
    ? ` 部分区块未生成：${result.warnings.slice(0, 2).join('；')}${result.warnings.length > 2 ? '；...' : ''}`
    : ''
  if (action === WHITEBOARD_AI_ACTIONS.REPLACE) {
    return `已清空当前白板并重新生成 ${result.addedCount || 0} 个元素。${warningText}`
  }
  if (action === WHITEBOARD_AI_ACTIONS.EDIT) {
    return `已基于当前白板完成修改，生成 ${result.addedCount || 0} 个元素。${warningText}`
  }
  return `已在当前白板插入 ${result.addedCount || 0} 个元素。${warningText}`
}

export const handleWhiteboardAIRequest = async ({ note, prompt, messages = [], updateNote, loadNotes }) => {
  if (!isWhiteboardNote(note)) {
    return null
  }

  let action = inferWhiteboardActionFromPrompt(prompt)
  let groundedRequest = ''
  try {
    const grounded = await groundWhiteboardRequest({ note, prompt, messages })
    action = normalizeWhiteboardAction(grounded.action, action)
    groundedRequest = grounded.groundedRequest
  } catch (error) {
    groundedRequest = ''
  }

  const generationPrompt = groundedRequest || String(prompt || '').trim()

  const activeResult = await requestActiveWhiteboardGeneration({
    noteId: note.id,
    prompt: generationPrompt,
    action,
  })
  const result = activeResult || await applyWhiteboardGenerationToNote({
    note,
    prompt: generationPrompt,
    action,
    updateNote,
  })
  await loadNotes?.()

  return {
    content: buildWhiteboardActionMessage(result),
    result,
  }
}
