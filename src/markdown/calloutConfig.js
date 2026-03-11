/**
 * Callout 类型配置 — 单一真相源
 * 被 callout.js、customContainer.js、WYSIWYGEditor、MarkdownToolbar 共享
 */
export const CALLOUT_TYPES = {
  // 5 标准类型（对齐 GitHub）
  note:      { icon: 'ℹ️',  color: '#3b82f6', label: '备注' },
  tip:       { icon: '💡', color: '#22c55e', label: '提示' },
  important: { icon: '💜', color: '#8b5cf6', label: '重要' },
  warning:   { icon: '⚠️', color: '#f59e0b', label: '警告' },
  caution:   { icon: '🔴', color: '#ef4444', label: '注意' },
  // 兼容旧类型
  info:      { icon: 'ℹ️',  color: '#3b82f6', label: '信息' },
  danger:    { icon: '🔴', color: '#ef4444', label: '危险' },
  error:     { icon: '❌', color: '#ef4444', label: '错误' },
  success:   { icon: '✅', color: '#22c55e', label: '成功' },
  question:  { icon: '❓', color: '#8b5cf6', label: '问题' },
  quote:     { icon: '💬', color: '#6b7280', label: '引用' },
  example:   { icon: '📝', color: '#06b6d4', label: '示例' },
  abstract:  { icon: '📋', color: '#06b6d4', label: '摘要' },
  todo:      { icon: '☑️', color: '#3b82f6', label: '待办' },
  bug:       { icon: '🐛', color: '#ef4444', label: 'Bug' },
  details:   { icon: '📋', color: '#6b7280', label: '详情' },
  summary:   { icon: '📊', color: '#06b6d4', label: '总结' },
  tldr:      { icon: '⚡', color: '#f59e0b', label: 'TL;DR' },
  failure:   { icon: '❌', color: '#ef4444', label: '失败' },
}

/** 工具栏使用的 5 个标准类型 */
export const STANDARD_CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution']
  .map(t => ({ type: t, ...CALLOUT_TYPES[t] }))
