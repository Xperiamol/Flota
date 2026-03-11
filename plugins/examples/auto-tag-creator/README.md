# 自动标签创建器插件

> 根据笔记内容智能创建和管理标签

## 功能特性

### ✨ 主要功能

1. **预定义标签集** - 一键创建常用标签（工作、学习、生活等）
2. **智能分析** - 分析笔记内容，自动提取关键词并创建标签
3. **重复检测** - 自动跳过已存在的标签
4. **频率统计** - 根据关键词出现频率智能创建标签

## 使用方法

### 1. 安装插件

1. 确保 Flota 版本 >= 2.1.0
2. 进入 Flota → 插件商店 → 本地开发
3. 点击"刷新本地插件"
4. 找到"自动标签创建器"并安装

### 2. 创建预定义标签集

**快捷方式**：命令面板 → "创建预定义标签集"

**预定义标签**：
- 🔵 工作 (#1976d2)
- 🟢 学习 (#2e7d32)
- 🟠 生活 (#ed6c02)
- 🟣 项目 (#9c27b0)
- 🔴 会议 (#d32f2f)
- 🔵 想法 (#0288d1)
- 🟠 待办 (#f57c00)
- 🔴 重要 (#c62828)

**功能**：
- 批量创建8个常用标签
- 自动跳过已存在的标签
- 显示创建结果统计

### 3. 智能分析笔记

**快捷方式**：命令面板 → "分析笔记并创建标签"

**工作原理**：
1. 扫描所有笔记内容（最多100篇）
2. 提取关键词（工作、学习、会议、项目等）
3. 统计关键词出现频率
4. 创建出现次数 >= 2 的标签（最多10个）

**关键词映射**：
- "工作" → 标签：工作、项目、会议
- "学习" → 标签：学习、笔记、课程、教程
- "会议" → 标签：会议、讨论、沟通
- "项目" → 标签：项目、开发、设计
- "重要" → 标签：重要、紧急、优先

## 使用示例

### 示例 1: 快速开始

```javascript
// 场景：新用户首次使用
// 操作：命令面板 → "创建预定义标签集"
// 结果：创建8个常用标签，可立即使用

✅ 成功创建 8 个标签，跳过 0 个已存在的标签
```

### 示例 2: 智能分析

```javascript
// 场景：已有笔记，需要自动分类
// 笔记内容示例：
// - 笔记1: "工作会议纪要"
// - 笔记2: "项目开发计划"
// - 笔记3: "学习笔记 - Python"
// - 笔记4: "工作总结"

// 操作：命令面板 → "分析笔记并创建标签"
// 结果：
✅ 分析了 4 篇笔记，创建了 3 个标签
   - 工作 (出现 3 次)
   - 项目 (出现 2 次)
   - 学习 (出现 2 次)
```

## API 使用示例

### 创建单个标签

```javascript
// 创建一个标签
await runtime.tags.create('编程', '#4caf50')

// 成功返回：{ id: 1, name: '编程', color: '#4caf50', ... }
```

### 批量创建标签

```javascript
const tags = [
  { name: 'JavaScript', color: '#f7df1e' },
  { name: 'Python', color: '#3776ab' },
  { name: 'React', color: '#61dafb' }
]

for (const tag of tags) {
  await runtime.tags.create(tag.name, tag.color)
}
```

### 检查标签是否存在

```javascript
const existingTags = await runtime.tags.list()
const tagExists = existingTags.some(t => t.name === '工作')

if (!tagExists) {
  await runtime.tags.create('工作', '#1976d2')
}
```

### 更新标签

```javascript
// 获取标签列表
const tags = await runtime.tags.list()
const workTag = tags.find(t => t.name === '工作')

// 更新标签颜色
if (workTag) {
  await runtime.tags.update(workTag.id, { 
    color: '#ff0000' 
  })
}
```

### 删除标签

```javascript
const tags = await runtime.tags.list()
const oldTag = tags.find(t => t.name === '旧标签')

if (oldTag) {
  await runtime.tags.delete(oldTag.id)
}
```

## 权限说明

此插件需要以下权限：

- `notes:read` - 读取笔记列表
- `notes:read:full` - 读取笔记完整内容（用于分析）
- `tags:read` - 读取现有标签
- `tags:write` - 创建标签
- `notifications:show` - 显示通知

## 技术实现

### 核心代码片段

```javascript
// 创建标签
await runtime.tags.create('标签名', '#颜色代码')

// 获取标签列表
const tags = await runtime.tags.list()

// 更新标签
await runtime.tags.update(tagId, { 
  name: '新名称', 
  color: '#新颜色' 
})

// 删除标签
await runtime.tags.delete(tagId)
```

### 关键词提取算法

```javascript
// 简单关键词匹配
const content = `${note.title} ${note.content}`.toLowerCase()
const keywords = ['工作', '学习', '会议', '项目']

for (const keyword of keywords) {
  if (content.includes(keyword)) {
    // 统计出现次数
    tagCountMap.set(keyword, (tagCountMap.get(keyword) || 0) + 1)
  }
}
```

## 扩展建议

### 🎯 功能扩展

1. **AI 增强** - 集成 AI 分析笔记主题
2. **多语言支持** - 支持英文关键词识别
3. **标签推荐** - 基于笔记内容智能推荐标签
4. **标签合并** - 合并相似标签（如"学习"和"学习笔记"）
5. **标签统计** - 显示标签使用频率

### 💡 代码示例：AI 增强版

```javascript
// 使用 AI 分析笔记并生成标签
runtime.registerCommand('auto-tag-creator.ai-analyze', async () => {
  const notes = await runtime.notes.list({ limit: 10 })
  
  for (const note of notes.notes) {
    const response = await runtime.ai.chat([
      { role: 'system', content: '你是标签生成助手，根据笔记内容生成3-5个标签' },
      { role: 'user', content: `笔记标题: ${note.title}\n内容: ${note.content}` }
    ])
    
    const suggestedTags = JSON.parse(response.content) // ['标签1', '标签2', ...]
    
    for (const tagName of suggestedTags) {
      await runtime.tags.create(tagName, randomColor())
    }
  }
})
```

## 故障排除

### Q: 为什么没有创建任何标签？

A: 可能原因：
1. 笔记内容中没有匹配的关键词
2. 关键词出现频率 < 2 次
3. 标签已存在

### Q: 如何修改关键词映射？

A: 编辑 `index.js` 中的 `KEYWORD_TAG_MAP` 对象：

```javascript
const KEYWORD_TAG_MAP = {
  '你的关键词': ['标签1', '标签2'],
  // 添加更多映射
}
```

### Q: 可以修改预定义标签吗？

A: 编辑 `index.js` 中的 `PREDEFINED_TAGS` 数组：

```javascript
const PREDEFINED_TAGS = [
  { name: '自定义标签', color: '#自定义颜色' },
  // 添加更多标签
]
```

## 相关文档

- [插件开发指南](../../docs/development-guide.md)
- [Tags API 文档](../../docs/development-guide.md#标签-api)
- [Runtime API 完整文档](../../docs/development-guide.md#runtime-api)

## 版本历史

- **v1.0.0** (2025-01-11)
  - ✨ 初始版本
  - ✅ 支持预定义标签创建
  - ✅ 支持智能笔记分析
  - ✅ 支持关键词提取

## 许可证

MIT License - 自由使用和修改

---

**作者**: Flota Team  
**GitHub**: https://github.com/Xperiamol/Flota
