// 引导与画布内的 AI 小窗共用，避免能力介绍和可执行示例脱节。
export const WHITEBOARD_AI_EXAMPLES = [
  { id: 'flowchart', label: '流程图', description: '把步骤和分支画清楚。', prompt: '在当前画布中画一个项目审批流程图：提交申请、负责人审核、通过后执行，不通过则修改后重新提交。' },
  { id: 'mindmap', label: '思维导图', description: '把零散想法整理成结构。', prompt: '在当前画布中画一张思维导图：如何读懂一本书，包含阅读准备、章节笔记、知识关联和行动实践。' },
  { id: 'architecture', label: '架构图', description: '梳理模块与连接关系。', prompt: '在当前画布中画一个笔记应用的架构图，包含桌面客户端、本地数据库、附件存储和 WebDAV 同步，标明连接关系。' },
  { id: 'text-to-diagram', label: '文字成图', description: '把一段描述变成图解。', prompt: '把下面的想法画成图，插入当前画布：设定目标、开始行动、收集反馈、调整计划，形成一个持续改进的闭环。' },
  { id: 'edit-diagram', label: '局部改图', description: '调整布局，保留其他内容。', prompt: '调整当前画布的布局，让节点排列更整齐、文字清晰可读；保留现有内容和连线关系。' },
  { id: 'read-diagram', label: '读图总结', description: '解释图中内容与关键结论。', prompt: '请解释当前画布的结构和主要内容，提炼关键结论及值得注意的问题。只用文字回复，不修改画布。' },
]
