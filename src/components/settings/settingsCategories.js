/**
 * 设置分类：侧栏分组展示；id 是历史上的 tab 序号（其他页面用它跳转，不要改动已有 id）。
 * 标题栏显示「设置 · 分类名」，新增分类在这里登记名字即可。
 */
export const SETTINGS_GROUPS = [
  { label: '通用', items: [
    { id: 0, name: '通用', icon: 'general' },
    { id: 1, name: '外观', icon: 'appearance' },
    { id: 2, name: '快捷键', icon: 'shortcuts' },
  ] },
  { label: '记录', items: [
    { id: 10, name: '编辑器', icon: 'editor' },
    { id: 13, name: '笔记与文件', icon: 'files' },
    { id: 14, name: '待办', icon: 'todo' },
    { id: 12, name: '网页剪藏', icon: 'clipper' },
  ] },
  { label: '智能', items: [
    { id: 3, name: 'AI', icon: 'ai' },
    { id: 4, name: '语音转文字', icon: 'stt' },
    { id: 5, name: '记忆引擎', icon: 'memory' },
  ] },
  { label: '数据', items: [
    { id: 6, name: '云同步', icon: 'cloud' },
    { id: 8, name: '数据管理', icon: 'data' },
  ] },
  { label: '高级', items: [
    { id: 7, name: '网络代理', icon: 'proxy' },
    { id: 9, name: 'MCP 服务', icon: 'mcp' },
  ] },
  { label: null, items: [
    { id: 11, name: '关于', icon: 'about' },
  ] },
]

export const SETTINGS_CATEGORY_NAMES = Object.fromEntries(
  SETTINGS_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item.name])
)
