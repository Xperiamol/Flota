import {
  WRITE_TOOL_NAMES,
  classifyWritingIntent,
  createClarificationMessage,
  hasExplicitPersistenceIntent,
} from '../aiIntentUtils'

export { WRITE_TOOL_NAMES }

// 统一意图路由：一次性判定持久化意图 + 写作意图（含追问），
// 供所有 AI 入口复用，避免各入口各写一套预筛/分类/兜底逻辑。
export const routeIntent = async ({ prompt, messages = [], currentNote = null }) => {
  const allowPersistence = hasExplicitPersistenceIntent(prompt)
  const writingIntent = await classifyWritingIntent({ prompt, messages, currentNote })
  return {
    allowPersistence,
    disabledTools: allowPersistence ? [] : WRITE_TOOL_NAMES,
    needClarification: writingIntent.needClarification,
    clarifyQuestion: createClarificationMessage(writingIntent),
  }
}
