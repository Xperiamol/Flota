// 会话消息的展示辅助。消息由主进程的会话服务组装与保存（electron/services/aichat/sessions/messageModel.js）。

// 消息展示、重试、取回输入使用同一种文本提取规则，保留多模态消息中的文本顺序。
export const messageText = (content) => (Array.isArray(content)
  ? content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n')
  : String(content || ''))
