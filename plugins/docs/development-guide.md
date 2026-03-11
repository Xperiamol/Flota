# Flota 插件开发指南

> 精简且准确的 Flota 2.0 插件开发文档

## 快速开始

### 1. 创建插件

```
plugins/examples/my-plugin/
├── manifest.json
└── index.js
```

**manifest.json**（必需字段）:
```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "entry": "index.js",
  "description": "插件描述",
  "permissions": ["notifications:show"],
  "minAppVersion": "2.1.0"
}
```

**index.js**:
```javascript
runtime.onActivate((context) => {
  runtime.logger.info('插件已激活')
  
  runtime.registerCommand(
    { id: 'my-plugin.hello', title: '打招呼' },
    async () => {
      await runtime.notifications.show({
        title: '你好！',
        body: '欢迎使用 Flota 插件',
        type: 'success'
      })
      return { success: true }
    }
  )
})

runtime.onDeactivate(() => {
  runtime.logger.info('插件已停用')
})
```

### 2. 测试插件

1. 启动：`npm run electron-dev`
2. 打开"插件商店" → "本地开发" → "刷新本地插件"
3. 安装并启用插件
4. 按 `Ctrl+Shift+I` 查看日志

---

## Runtime API

### 生命周期

```javascript
runtime.onActivate(async (context) => {
  // context: { pluginId, version, manifest }
})

runtime.onDeactivate(async () => {
  // 清理资源
})
```

### 命令

```javascript
runtime.registerCommand(
  { id: 'plugin.command', title: '命令名' },
  async (payload) => {
    return { success: true, data: result }
  }
)

runtime.unregisterCommand('plugin.command')
```

### 笔记 API

**权限**: `notes:read` / `notes:read:full`

```javascript
// 获取笔记列表
await runtime.notes.list(options)
// 返回: { notes: [...], pagination: {...} }
// 基础字段: id, title, tags, updated_at, created_at, category
// 完整字段(需notes:read:full): + content, favorited, deleted

// 获取随机笔记
await runtime.notes.getRandom()
// 返回: 单个笔记对象
```

### 待办 API

**权限**: `todos:read` / `todos:read:full` / `todos:write`

**字段说明**（使用数据库字段名）:

基础字段（todos:read）:
- `id`: 待办ID
- `content`: 任务内容（必填）
- `is_completed`: 完成状态 (boolean)
- `focus_time_seconds`: 专注时长（秒）
- `category`: 分类
- `created_at` / `updated_at`: 时间戳

完整字段（todos:read:full）:
- `description`: 详细描述
- `due_date`: 截止日期 (YYYY-MM-DD)
- `tags`: 标签（逗号分隔字符串）
- `is_important`: 重要标识 (boolean)
- `is_urgent`: 紧急标识 (boolean)
- `reminder_time`: 提醒时间
- `completed_at`: 完成时间
- `deleted`: 删除标识

```javascript
// 获取待办列表
await runtime.todos.list(options)
// 返回: [{ id, content, is_completed, focus_time_seconds, ... }]

// 根据ID查找
await runtime.todos.findById(id)

// 创建待办
await runtime.todos.create({
  content: '任务内容',           // 必填
  description: '详细描述',       // 可选
  is_important: true,           // 可选
  is_urgent: false,             // 可选
  due_date: '2025-12-31',       // 可选: YYYY-MM-DD
  is_completed: false,          // 可选
  tags: '标签1,标签2',          // 可选
  focus_time_seconds: 0         // 可选
})

// 更新待办
await runtime.todos.update(id, {
  content: '新内容',
  description: '新描述',
  is_completed: true,
  is_important: false,
  is_urgent: true,
  due_date: '2025-12-31',
  tags: '新标签',
  focus_time_seconds: 1800  // 30分钟
})
```

### 标签 API

**权限**: `tags:read` / `tags:write`

```javascript
// 获取所有标签
await runtime.tags.list()
// 返回: [{ id, name, usage_count, created_at, updated_at }, ...]

// 创建标签（注意：目前不支持自定义颜色）
await runtime.tags.create('标签名')
// 返回: { id: '标签名', name: '标签名' }

// 删除标签（参数是标签名称，不是 id）
await runtime.tags.delete('标签名')
// 返回: { success: true }

// 注意：tags.update() 暂不支持
```

### UI 操作

```javascript
// 打开笔记（需要 ui:open-note）
await runtime.ui.openNote(noteId)

// 打开自定义窗口（需要 ui:open-window）
await runtime.ui.openWindow({
  url: 'planner.html',  // 相对路径，不要 /planner.html
  title: '窗口标题',
  width: 1000,
  height: 700
})
```

**使用 React + Material-UI**：

插件窗口自动注入主应用的依赖，可以直接使用：

```javascript
// 在插件 HTML 中可用
window.React          // React 18
window.ReactDOM       // ReactDOM 18
window.MaterialUI     // @mui/material
window.MaterialIcons  // @mui/icons-material
window.appTheme       // 主应用主题
```

示例：`plugins/examples/react-mui-demo/`

### 通知

**权限**: `notifications:show`

```javascript
await runtime.notifications.show({
  title: '标题',
  body: '内容',
  type: 'success'  // 'info'|'success'|'warning'|'error'
})
```

### 存储

**权限**: `storage:read` / `storage:write`

```javascript
await runtime.storage.setItem('key', { any: 'value' })
const value = await runtime.storage.getItem('key')
await runtime.storage.removeItem('key')
await runtime.storage.clear()
```

### 其他 API

```javascript
// 网络请求（需要 network:request）
await runtime.network.fetch(url, options)

// 剪贴板（需要 clipboard:read/write）
await runtime.clipboard.readText()      // 返回: { text: '...' }
await runtime.clipboard.writeText('文本')
await runtime.clipboard.readImage()     // 返回: { dataUrl: '...', size: {...} }
await runtime.clipboard.writeImage(dataUrl)

// 文件系统（需要 filesystem:read/write）
await runtime.filesystem.pickFile(options)
await runtime.filesystem.pickDirectory()
await runtime.filesystem.readFile(filePath, encoding)
await runtime.filesystem.writeFile(filePath, content)

// AI（需要 ai:inference）
const response = await runtime.ai.chat(messages, options)
// messages: [{ role: 'system'|'user'|'assistant', content: '...' }]
// options: { temperature: 0.7, maxTokens: 200 }
// 返回: { success: true, data: { content: '...', usage: {...} } }
// 或: { success: false, error: '错误信息' }

await runtime.ai.isAvailable()
// 返回: { available: boolean, provider: string, model: string }

// 搜索（需要 search:advanced）
await runtime.search.fullText(query, options)  // 全文搜索
await runtime.search.filter(filterOptions)     // 高级过滤

// 事件订阅（需要 events:subscribe）
await runtime.events.subscribe('note:created', listenerId)
await runtime.events.unsubscribe(listenerId)

// 数据分析（需要 analytics:read）
await runtime.analytics.notesStats(timeRange)  // 笔记统计
await runtime.analytics.todosStats(timeRange)  // 待办统计

// 知识记忆（Mem0）
// 读取记忆（需要 mem0:read）
await runtime.mem0.search(userId, query, {limit: 10, threshold: 0.7})
await runtime.mem0.get(userId, {limit: 100, category: 'task_planning'})
await runtime.mem0.stats(userId)
await runtime.mem0.isAvailable()

// 写入记忆（需要 mem0:write）
await runtime.mem0.add(userId, content, {category: 'task_planning', metadata: {...}})
await runtime.mem0.delete(memoryId)
await runtime.mem0.clear(userId)

// 日志
runtime.logger.info('信息', data)
runtime.logger.warn('警告', data)
runtime.logger.error('错误', error)

// 权限检查
runtime.permissions.has('notes:write')
runtime.permissions.list()
```

---

## 权限列表

| 权限 | 说明 |
|------|------|
| `notes:read` | 读取笔记基础信息 |
| `notes:read:full` | 读取笔记完整内容 |
| `todos:read` | 读取待办基础信息 |
| `todos:read:full` | 读取待办完整信息 |
| `todos:write` | 创建/修改待办 |
| `tags:read` / `tags:write` | 标签操作 |
| `ui:open-note` / `ui:open-window` | UI操作 |
| `ai:inference` | 使用AI |
| `search:advanced` | 高级搜索 |
| `events:subscribe` | 事件订阅 |
| `analytics:read` | 数据分析 |
| `notifications:show` | 显示通知 |
| `storage:read` / `storage:write` | 插件存储 |
| `network:request` | 网络请求 |
| `clipboard:read` / `clipboard:write` | 剪贴板 |
| `filesystem:read` / `filesystem:write` | 文件系统 |
| `mem0:read` | 读取知识记忆 |
| `mem0:write` | 写入/删除知识记忆 |

---

## Manifest 配置

### 必填字段

```json
{
  "id": "unique-plugin-id",
  "name": "插件名称",
  "version": "1.0.0",
  "entry": "index.js",
  "description": "插件描述",
  "permissions": [],
  "minAppVersion": "2.1.0"
}
```

### 可选字段

```json
{
  "author": "作者名",
  "icon": "icon.svg",
  "commands": [{
    "id": "plugin.command",
    "title": "命令名",
    "surfaces": ["command-palette", "toolbar:notes", "toolbar:todos"]
  }]
}
```

---

## 最佳实践

### ✅ 正确用法

```javascript
// 1. 使用全局 runtime
runtime.onActivate(() => {})

// 2. 使用正确的 API
await runtime.todos.list()
await runtime.notes.list()

// 3. 使用数据库字段名
await runtime.todos.create({
  content: '任务',
  due_date: '2025-12-31'  // 不是 dueDate
})

// 4. 使用相对路径
await runtime.ui.openWindow({ url: 'window.html' })  // 不是 /window.html

// 5. 错误处理
try {
  const result = await someOperation()
  return { success: true, data: result }
} catch (error) {
  runtime.logger.error('操作失败', error)
  await runtime.notifications.show({
    title: '错误',
    body: error.message,
    type: 'error'
  })
  return { success: false, error: error.message }
}
```

### ❌ 常见错误

```javascript
// ❌ 不要使用 require
const { onActivate } = require('@flota/sdk')

// ❌ 不存在的方法
await runtime.todos.getAll()      // 用 list()
await runtime.todos.createBatch() // 循环调用 create()
await runtime.notes.getAll()      // 用 list()

// ❌ 错误的字段名
dueDate: '2025-12-31'  // 应该是 due_date

// ❌ 错误的路径
url: '/window.html'  // 应该是 'window.html'

// ❌ 错误的标签 API 用法
await tags.create('标签', '#FF0000')  // 不支持颜色参数
await tags.update(id, data)           // 不支持更新
await tags.delete(id)                 // 参数应该是标签名，不是 id

// ❌ 错误的 AI 响应处理
const tags = JSON.parse(response.content)  // 应该是 response.data.content

// ❌ 错误的 Mem0 返回值处理
const memories = await mem0.search(...)    // 返回的是 { memories: [...] }
memories.forEach(...)                      // 应该是 result.memories.forEach(...)
```

---

## 完整示例

```javascript
// manifest.json
{
  "id": "random-note",
  "name": "随机笔记",
  "version": "1.0.0",
  "entry": "index.js",
  "permissions": ["notes:read", "ui:open-note"],
  "commands": [{
    "id": "random-note.open",
    "title": "打开随机笔记",
    "surfaces": ["command-palette", "toolbar:notes"]
  }],
  "minAppVersion": "2.1.0"
}

// index.js
runtime.onActivate(() => {
  runtime.logger.info('随机笔记插件已激活')
  
  runtime.registerCommand(
    { id: 'random-note.open', title: '打开随机笔记' },
    async () => {
      try {
        const result = await runtime.notes.list()
        const notes = result.notes || []
        
        if (notes.length === 0) {
          await runtime.notifications.show({
            title: '提示',
            body: '当前没有笔记',
            type: 'info'
          })
          return { success: false }
        }
        
        const randomNote = notes[Math.floor(Math.random() * notes.length)]
        await runtime.ui.openNote(randomNote.id)
        
        runtime.logger.info('已打开随机笔记', randomNote.id)
        return { success: true }
      } catch (error) {
        runtime.logger.error('打开随机笔记失败', error)
        return { success: false, error: error.message }
      }
    }
  )
})

runtime.onDeactivate(() => {
  runtime.logger.info('随机笔记插件已停用')
})
```

---

## 调试

1. 启动开发：`npm run electron-dev`
2. 插件商店 → 本地开发 → 刷新本地插件
3. 按 `Ctrl+Shift+I` 查看日志
4. 修改代码后点击"重载插件"

---

## API 速查

| API | 方法 |
|-----|------|
| **笔记** | `notes.list()`, `notes.getRandom()`, `notes.findById()`, `notes.create()`, `notes.update()`, `notes.delete()` |
| **待办** | `todos.list()`, `todos.findById()`, `todos.create()`, `todos.update()`, `todos.delete()` |
| **标签** | `tags.list()`, `tags.create()`, `tags.update()`, `tags.delete()` |
| **UI** | `ui.openNote()`, `ui.openWindow()` |
| **搜索** | `search.fullText()`, `search.filter()` |
| **事件** | `events.subscribe()`, `events.unsubscribe()` |
| **分析** | `analytics.notesStats()`, `analytics.todosStats()` |
| **通知** | `notifications.show()` |
| **存储** | `storage.setItem()`, `storage.getItem()`, `storage.removeItem()`, `storage.clear()` |
| **AI** | `ai.chat()`, `ai.isAvailable()` |
| **网络** | `network.fetch()` |
| **剪贴板** | `clipboard.readText()`, `clipboard.writeText()`, `clipboard.readImage()`, `clipboard.writeImage()` |
| **文件系统** | `filesystem.pickFile()`, `filesystem.pickDirectory()`, `filesystem.readFile()`, `filesystem.writeFile()` |
| **日志** | `logger.info()`, `logger.warn()`, `logger.error()` |
| **权限** | `permissions.has()`, `permissions.list()` |
| **知识记忆** | `mem0.search()`, `mem0.get()`, `mem0.add()`, `mem0.delete()`, `mem0.clear()`, `mem0.stats()`, `mem0.isAvailable()` |

---

## Mem0 知识记忆 API

Mem0 提供语义化的知识记忆功能，让插件能够"记住"用户的偏好和历史行为，实现个性化体验。

### 使用场景

- **AI 任务规划**：记住用户的任务类型偏好、时间安排习惯
- **智能推荐**：基于历史笔记主题推荐相关内容
- **学习用户习惯**：记录常用标签、工作流程、操作模式

### API 方法

#### 1. 搜索记忆（需要 `mem0:read`）

```javascript
const result = await runtime.mem0.search(userId, query, options)
```

**参数：**
- `userId` (string): 用户标识
- `query` (string): 搜索查询（自然语言）
- `options` (object, 可选):
  - `limit` (number): 返回数量，默认 10
  - `threshold` (number): 相似度阈值 0-1，默认 0.7
  - `category` (string): 筛选类别

**返回：** 
```javascript
{
  memories: [
    {
      id: 'uuid',
      content: '用户喜欢在早上规划紧急任务',
      score: 0.92,
      category: 'task_planning',
      metadata: {...},
      created_at: 1234567890
    }
  ]
}
```

#### 2. 获取记忆列表（需要 `mem0:read`）

```javascript
const result = await runtime.mem0.get(userId, options)
```

**参数：**
- `userId` (string): 用户标识
- `options` (object, 可选):
  - `limit` (number): 返回数量
  - `category` (string): 筛选类别

**返回：** 
```javascript
{
  memories: [...]
}
```
- `userId` (string): 用户标识
- `options` (object, 可选):
  - `limit` (number): 返回数量
  - `category` (string): 筛选类别

#### 3. 添加记忆（需要 `mem0:write`）

```javascript
const result = await runtime.mem0.add(userId, content, options)
```

**参数：**
- `userId` (string): 用户标识
- `content` (string): 记忆内容（自然语言描述）
- `options` (object, 可选):
  - `category` (string): 分类标签，如 `'task_planning'`
  - `metadata` (object): 额外数据

**返回：** `{ id: 'uuid', created_at: timestamp }`

#### 4. 删除记忆（需要 `mem0:write`）

```javascript
const result = await runtime.mem0.delete(memoryId)
// 返回: { deleted: boolean }
```

#### 5. 清空用户记忆（需要 `mem0:write`）

```javascript
const result = await runtime.mem0.clear(userId)
// 返回: { count: number }
```

#### 6. 获取统计信息（需要 `mem0:read`）

```javascript
const stats = await runtime.mem0.stats(userId)
// 返回: { totalMemories: 42, byCategory: { task_planning: 20, ... } }
```

#### 7. 检查可用性

```javascript
const result = await runtime.mem0.isAvailable()
// 返回: { available: boolean }
```

### 实战示例：AI 任务规划插件

```javascript
// plugin.json 中添加权限
{
  "permissions": [
    "ai:inference",
    "todos:write",
    "mem0:read",
    "mem0:write"
  ]
}

// index.js - 学习用户习惯
runtime.onActivate(async () => {
  runtime.registerCommand('ai-plan-with-memory', async () => {
    const userId = 'current_user' // 实际应用从用户系统获取
    
    // 1. 搜索历史规划偏好
    const result = await runtime.mem0.search(
      userId,
      '任务规划 紧急重要 时间偏好',
      { limit: 5, category: 'task_planning' }
    )
    
    // 2. 构建个性化提示词
    let promptContext = ''
    if (result.memories && result.memories.length > 0) {
      promptContext = '\n用户偏好:\n' + 
        result.memories.map(m => `- ${m.content}`).join('\n')
    }
    
    const prompt = `请生成今日任务清单。当前时间: ${new Date().toLocaleDateString('zh-CN')}
${promptContext}

要求: JSON 数组，每项包含 content, is_important, is_urgent, due_date`
    
    // 3. AI 生成任务
    const aiResponse = await runtime.ai.chat([
      { role: 'system', content: '你是任务规划助手' },
      { role: 'user', content: prompt }
    ])
    
    const tasks = JSON.parse(aiResponse.data.content)
    
    // 4. 创建任务
    for (const task of tasks) {
      await runtime.todos.create(task)
    }
    
    // 5. 学习并记录本次规划特征
    const urgentCount = tasks.filter(t => t.is_urgent).length
    const importantCount = tasks.filter(t => t.is_important).length
    
    if (urgentCount > tasks.length / 2) {
      await runtime.mem0.add(
        userId,
        `用户偏好规划紧急任务，占比 ${(urgentCount/tasks.length*100).toFixed(0)}%`,
        { category: 'task_planning', metadata: { date: new Date().toISOString() } }
      )
    }
    
    runtime.logger.info(`已创建 ${tasks.length} 个任务（基于 ${result.memories.length} 条历史偏好）`)
    return { success: true, tasksCreated: tasks.length }
  })
})
```

### 技术细节

- **向量模型**：使用 all-MiniLM-L6-v2（384 维）进行语义编码
- **存储**：SQLite TEXT 列存储 JSON 向量
- **搜索性能**：<10k 条记忆时查询 <20ms
- **本地运行**：无需 API Key，模型首次下载 ~22MB 后本地缓存

### 最佳实践

1. **分类管理**：使用 `category` 区分不同场景的记忆（如 `task_planning`, `note_themes`, `user_habits`）
2. **定期清理**：避免记忆无限增长，可设定保留策略
3. **描述性内容**：记忆内容应是完整的自然语言描述，便于语义搜索
4. **隐私保护**：敏感信息应存储在 metadata 而非 content
5. **异步调用**：Mem0 初始化需加载模型，首次调用可能耗时 1-2 秒

---

## API 速查（完整版）

| API | 方法 |
|-----|------|
| **笔记** | `notes.list()`, `notes.getRandom()`, `notes.findById()`, `notes.create()`, `notes.update()`, `notes.delete()` |
| **待办** | `todos.list()`, `todos.findById()`, `todos.create()`, `todos.update()`, `todos.delete()` |
| **标签** | `tags.list()`, `tags.create()`, `tags.update()`, `tags.delete()` |
| **UI** | `ui.openNote()`, `ui.openWindow()` |
| **搜索** | `search.fullText()`, `search.filter()` |
| **事件** | `events.subscribe()`, `events.unsubscribe()` |
| **分析** | `analytics.notesStats()`, `analytics.todosStats()` |
| **通知** | `notifications.show()` |
| **存储** | `storage.setItem()`, `storage.getItem()`, `storage.removeItem()`, `storage.clear()` |
| **AI** | `ai.chat()`, `ai.isAvailable()` |
| **网络** | `network.fetch()` |
| **剪贴板** | `clipboard.readText()`, `clipboard.writeText()`, `clipboard.readImage()`, `clipboard.writeImage()` |
| **文件系统** | `filesystem.pickFile()`, `filesystem.pickDirectory()`, `filesystem.readFile()`, `filesystem.writeFile()` |
| **日志** | `logger.info()`, `logger.warn()`, `logger.error()` |
| **权限** | `permissions.has()`, `permissions.list()` |
| **知识记忆** | `mem0.search()`, `mem0.get()`, `mem0.add()`, `mem0.delete()`, `mem0.clear()`, `mem0.stats()`, `mem0.isAvailable()` |

---

## 高级：使用 React + Material-UI

插件窗口自动注入主应用的 React 和 Material-UI，无需打包即可使用！

### 可用依赖

```javascript
window.React          // React 18
window.ReactDOM       // ReactDOM 18.createRoot
window.MaterialUI     // 完整的 @mui/material
window.MaterialIcons  // @mui/icons-material
window.appTheme       // 主应用主题（自动适配明暗模式）
```

### 基础示例

```html
<!DOCTYPE html>
<html>
<head>
  <title>我的 React 插件</title>
</head>
<body>
  <div id="root"></div>
  
  <script>
    // 等待依赖加载
    function waitForDependencies(callback) {
      const check = setInterval(() => {
        if (window.React && window.ReactDOM && window.MaterialUI) {
          clearInterval(check)
          callback()
        }
      }, 100)
    }

    waitForDependencies(() => {
      const { React, ReactDOM, MaterialUI, appTheme } = window
      const { useState } = React
      const { ThemeProvider, Box, Button, TextField } = MaterialUI

      function App() {
        const [text, setText] = useState('')

        return React.createElement(ThemeProvider, { theme: appTheme },
          React.createElement(Box, { sx: { p: 3 } },
            React.createElement(TextField, {
              fullWidth: true,
              label: '输入内容',
              value: text,
              onChange: (e) => setText(e.target.value)
            }),
            React.createElement(Button, {
              variant: 'contained',
              sx: { mt: 2 },
              onClick: () => alert(text)
            }, '提交')
          )
        )
      }

      const root = ReactDOM.createRoot(document.getElementById('root'))
      root.render(React.createElement(App))
    })
  </script>
</body>
</html>
```

### 完整示例

参考 `plugins/examples/react-mui-demo/` 查看：
- 状态管理和副作用
- 调用插件 API
- 列表渲染和表单处理
- 主题适配

### 优势

- ✅ **零构建**：无需 npm install、webpack、vite
- ✅ **轻量级**：HTML 文件只有几 KB
- ✅ **主题一致**：自动适配主应用主题
- ✅ **完整组件库**：所有 MUI 组件都可用

### 重要说明：命令返回值结构

在插件窗口中通过 `window.FlotaPlugin.executeCommand()` 调用命令时，返回值结构为：

```javascript
// 调用命令
const result = await window.FlotaPlugin.executeCommand(
  'plugin-id',
  'command-id',
  { payload: 'data' }
)

// 返回结构（IPC 层封装）
{
  success: true,     // IPC 通信是否成功
  data: {            // 插件命令的实际返回值
    status: 'success',
    result: '...'
  }
}

// 正确的访问方式
if (result.success && result.data.status === 'success') {
  console.log(result.data.result)
}
```

**重要说明**：

1. **插件 API** (`executePluginCommand`) 返回格式为 `{success, data}`，需要手动检查和解包
2. **应用内部 API** (通过 `src/api/ipc.js` 的 `invoke` 函数) 会**自动解包**，直接返回 `data` 内容
3. 详细说明请参阅项目根目录的 `IPC_API_GUIDE.md`

---

## API 限制和注意事项

### 标签 API 限制

⚠️ **当前标签系统的限制**：

1. **不支持标签颜色**：`tags.create()` 只接受标签名称参数，颜色参数会被忽略
2. **不支持标签更新**：`tags.update()` 暂未实现，调用会抛出异常
3. **删除参数是标签名**：`tags.delete()` 的参数是标签名称（string），不是 id

```javascript
// ✅ 正确用法
await tags.create('工作')
await tags.delete('工作')

// ❌ 错误用法
await tags.create('工作', '#FF0000')  // 颜色参数无效
await tags.update(id, { name: '新名称' })  // 不支持
await tags.delete(123)  // 应该传标签名，不是 id
```

### AI API 返回值格式

⚠️ **AI 返回的数据结构**：

```javascript
const response = await ai.chat([...])

// 返回格式
{
  success: true,
  data: {
    content: '...',  // AI 生成的内容在这里
    usage: { ... }
  }
}

// ✅ 正确访问
const content = response.data.content

// ❌ 错误访问
const content = response.content  // undefined
```

### Mem0 API 返回值格式

⚠️ **Mem0 返回的数据包装**：

```javascript
const result = await mem0.search(userId, query, options)

// 返回格式
{
  memories: [
    { id, content, score, ... }
  ]
}

// ✅ 正确访问
result.memories.forEach(m => console.log(m.content))

// ❌ 错误访问
result.forEach(...)  // result 不是数组
```

---

**文档版本**: 7.1.0  
**最后更新**: 2025-11-12  
**状态**: ✅ 已与 PluginManager 实现完全同步

**示例插件**: `plugins/examples/`  
**GitHub**: https://github.com/Xperiamol/Flota
