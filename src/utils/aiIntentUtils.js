const WRITING_CLASSIFIER_SYSTEM_PROMPT = `你是 Flota 的用户意图路由器。判断用户最新一句话的交付物类型。

只输出 JSON 对象，禁止解释、Markdown、代码块。

输出格式：
{
  "scene": "general_chat | writing",
  "taskType": "news_article | feature_article | brief_news | outline | plan | rewrite | summary | other",
  "deliverable": "formal_article | outline | plan | rewrite | summary | answer",
  "style": "可为空，如 科技日报",
  "needClarification": true | false,
  "clarifyQuestion": "需要追问时的一句话",
  "reason": "一句简短原因"
}

判定规则：
1. 当用户要求产出的内容较为丰富或者复杂、不适合在对话框展示的时候，scene=writing。
2. 有歧义时优先追问，比如不知道用户要的产物类型、缺少关键信息等，不要自作主张生成，needClarification=true。`

export const WRITE_TOOL_NAMES = ['create_note', 'edit_note', 'create_todo', 'create_todos', 'add_memory', 'update_memory', 'write_long_document']

const parseModelJsonObject = (content = '') => {
  const text = String(content || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (_) {
    return null
  }
}

export const normalizeWritingIntent = (value = {}) => {
  const scene = value.scene === 'writing' ? 'writing' : 'general_chat'
  const taskType = String(value.taskType || 'other').trim() || 'other'
  const deliverable = String(value.deliverable || (scene === 'writing' ? 'formal_article' : 'answer')).trim()
  const style = String(value.style || '').trim()
  const clarifyQuestion = String(value.clarifyQuestion || '').trim()
  return {
    scene,
    taskType,
    deliverable,
    style,
    needClarification: Boolean(value.needClarification && clarifyQuestion),
    clarifyQuestion,
    reason: String(value.reason || '').trim(),
  }
}

export const classifyWritingIntent = async ({ prompt, messages = [], currentNote = null }) => {
  const recentConversation = (messages || [])
    .filter((message) => message?.content)
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 1000),
    }))

  try {
    const res = await window.electronAPI.ai.chat([
      { role: 'system', content: WRITING_CLASSIFIER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          prompt,
          currentNote: currentNote ? {
            id: currentNote.id,
            title: currentNote.title || '',
            noteType: currentNote.note_type || 'markdown',
          } : null,
          recentConversation,
        }),
      },
    ], { temperature: 0, maxTokens: 420 })

    if (!res?.success || !res.data?.content) {
      return normalizeWritingIntent()
    }
    return normalizeWritingIntent(parseModelJsonObject(res.data.content) || {})
  } catch (_) {
    return normalizeWritingIntent()
  }
}

export const hasExplicitPersistenceIntent = (prompt = '') => {
  const text = String(prompt || '').trim().toLowerCase()
  if (!text) return false

  return /(保存|存为|存成|落库|写入|新建笔记|创建笔记|建个笔记|记到笔记|加入笔记|更新当前笔记|修改当前笔记|编辑当前笔记|创建待办|新建待办|加个待办|批量待办|规划|拆解|安排|帮我安排|帮我规划|做个计划|列个计划|保存记忆|记住|加入记忆|放到白板|插入到画布|加到画布|新建画布|创建画布)/.test(text)
}

export const createClarificationMessage = (intent = {}) => (
  intent.clarifyQuestion || '你要我直接写成稿，还是先给提纲/策划方案？'
)
