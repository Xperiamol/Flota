import { SETTINGS_GROUPS } from './settingsCategories.js'

// 关键词只用于本机查找设置，不包含用户填写的配置值。
const TOPICS = {
  0: [['首次使用引导', '新手 教程 onboarding'], ['开机自启动', '启动 auto launch'], ['启动时打开', '首页'], ['关闭主窗口时', '托盘 退出'], ['隐藏模式', '隐身 隐私'], ['语言', '中文 English']],
  1: [['主题', '深色 浅色 自动 dark light'], ['主题颜色', '配色'], ['背景', '壁纸 纹理 皮革 钢铁 透明度'], ['背景遮罩', '透明'], ['画布风格', '手绘'], ['标题栏样式', '窗口'], ['圣诞模式', '雪花 特效']],
  2: [['快捷键', '热键 keyboard shortcut 新建笔记 快速输入']],
  3: [['AI 服务配置', '模型 model API 密钥 服务商 base url'], ['图片理解', '多模态 vision'], ['联网搜索', '搜索引擎']],
  4: [['本机离线', 'Whisper 本地模型 下载 offline 录音'], ['火山引擎', '语音识别 云端 speech'], ['识别语言', '自动识别']],
  5: [['对话后自动记忆', '长期记忆 自动提取 memory'], ['记忆引擎', '记忆管理 删除记忆']],
  6: [['WebDAV', '坚果云 同步 NAS'], ['多网盘备份', '云备份 历史 附件'], ['Google 日历', 'calendar'], ['CalDAV', '日历同步']],
  7: [['网络代理', 'HTTP SOCKS proxy 端口']],
  8: [['本地使用量', '存储 空间 磁盘'], ['导入', 'Obsidian 旧版 数据迁移'], ['导出', '备份 恢复 数据'], ['数据库位置', '数据目录 文件夹'], ['回收站', '保留 永久删除']],
  9: [['MCP 服务', 'AI 客户端 端口 连接']],
  10: [['编辑模式', 'Markdown 所见即所得'], ['自动保存历史快照', '历史版本 恢复 快照 snapshot'], ['快照最小间隔', '历史频率'], ['每篇保留版本', '历史数量 上限'], ['显示字数', '字数统计'], ['显示阅读时长', '阅读时间 分钟'], ['正文字号', '字体 大小'], ['内容宽度', '排版'], ['浮动面板', 'AI 面板 选中文字 浮窗'], ['工具栏', '按钮 浮动 右键菜单']],
  11: [['关于', '版本 更新 许可证 开源']],
  12: [['网页剪藏', '浏览器 扩展 clipper 剪藏端口']],
  13: [['显示正文预览', '笔记列表 摘要'], ['时间显示', '修改时间'], ['打开外部文件时', '文件 关联'], ['附件最大大小 (MB)', '附件 限制 图片 音频']],
  14: [['默认视图', '待办 列表 看板'], ['默认排序', '待办 优先级'], ['显示已完成的待办', '完成 隐藏'], ['默认截止日期', '新建待办 日期']],
}

export const SETTINGS_SEARCH_ITEMS = SETTINGS_GROUPS.flatMap(group => group.items.flatMap(category => [
  { id: `${category.id}-category`, tab: category.id, label: category.name, category: category.name, group: group.label, keywords: '' },
  ...(TOPICS[category.id] || []).map(([label, keywords], index) => ({ id: `${category.id}-${index}`, tab: category.id, label, category: category.name, group: group.label, keywords })),
]))

export const searchSettings = query => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return SETTINGS_SEARCH_ITEMS.map(item => {
    const label = item.label.toLowerCase()
    const text = `${label} ${item.category} ${item.keywords}`.toLowerCase()
    return { ...item, score: words.every(word => text.includes(word)) ? words.reduce((sum, word) => sum + (label === word ? 10 : label.includes(word) ? 4 : 1), 0) : 0 }
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 16)
}
