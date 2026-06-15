/**
 * 插件系统共享工具函数
 */
export const getDisplayCategories = (plugin) => {
  if (!plugin) return []
  const categories = plugin.categories || []
  if (Array.isArray(categories)) return categories
  return typeof categories === 'string' ? [categories] : []
}

export const formatPermissions = (permissions) => {
  if (!permissions) return []
  if (Array.isArray(permissions)) return permissions
  return Object.entries(permissions)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
}

export const filterPlugins = (plugins, { search, category }) => {
  if (!Array.isArray(plugins) || plugins.length === 0) return []
  return plugins.filter((plugin) => {
    const matchesCategory =
      !category || category === 'all' || getDisplayCategories(plugin).some((item) => item === category)
    if (!matchesCategory) return false
    if (!search) return true
    const keywords = `${plugin.name || ''} ${plugin.description || ''} ${plugin.author?.name || ''}`.toLowerCase()
    return keywords.includes(search.toLowerCase())
  })
}

export const permissionDescriptions = {
  'notes:read': '读取你的笔记列表与基础元数据（标题、标签、时间等）',
  'notes:read:full': '读取笔记的完整内容，包括正文、收藏状态等所有信息',
  'notes:write': '创建或更新笔记内容',
  'todos:read': '读取待办事项列表与基础信息（标题、完成状态、优先级等）',
  'todos:read:full': '读取待办事项的完整信息，包括描述、截止时间、提醒等',
  'todos:write': '创建或更新待办事项',
  'tags:read': '读取标签列表和标签统计信息',
  'tags:write': '创建、更新或删除标签',
  'ui:open-note': '请求宿主应用打开指定笔记',
  'ui:theme': '读取或修改应用主题，注入自定义样式',
  'notifications:show': '通过宿主通知中心展示提示',
  'settings:read': '读取基础设置用于适配展示',
  'storage:read': '访问插件私有存储中的数据',
  'storage:write': '写入或删除插件私有存储数据',
  'network:request': '发起网络请求，访问互联网资源',
  'filesystem:read': '通过对话框选择并读取文件内容',
  'filesystem:write': '通过对话框选择位置并写入文件',
  'clipboard:read': '读取系统剪贴板中的文本或图片',
  'clipboard:write': '写入文本或图片到系统剪贴板',
  'search:advanced': '使用高级搜索功能（全文搜索、过滤等）',
  'attachments:read': '读取笔记的附件列表和附件信息',
  'attachments:write': '上传或删除笔记附件',
  'events:subscribe': '订阅应用事件（笔记创建、待办完成等）',
  'scheduler:create': '创建和管理定时任务',
  'analytics:read': '读取笔记和待办的统计分析数据',
  'markdown:extend': '扩展 Markdown 语法，注册自定义渲染器',
  'ai:inference': '调用 AI 服务进行推理（需用户配置 AI）'
}
