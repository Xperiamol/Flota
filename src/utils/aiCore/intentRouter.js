/**
 * 意图路由（精简版）
 *
 * 历史上这里有三层叠加：模型分类器 → 正则兜底 → 白板原地编辑特例。
 * 每出一个 case 就要新加一条规则，结果就是模型偶尔会说"我来生成…"
 * 但工具被路由提前禁用，反而落不下来。
 *
 * 新策略：信任模型 + 用户确认。
 *   - 写工具默认全部可用，不在路由层做禁用。
 *   - 误调用由 `requireConfirmation` 的确认卡兜底，用户拒绝即可。
 *   - 路由只保留接口（兼容现有调用方），不再做意图分类。
 */
export const WRITE_TOOL_NAMES = [
  'create_note',
  'edit_note',
  'create_todos',
  'create_whiteboard',
  'update_whiteboard',
]

export const routeIntent = async () => ({
  allowPersistence: true,
  disabledTools: [],
  needClarification: false,
  clarifyQuestion: '',
})
