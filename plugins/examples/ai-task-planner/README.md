# AI 任务规划助手

一个智能的 Flota 插件,帮助你使用 AI 拆解复杂任务为可执行的待办事项。**支持学习用户偏好,实现个性化规划。**

## ✨ 功能特点

- 🤖 **AI 智能拆解**:输入任务描述,AI 自动生成详细的子任务
- 🧠 **学习用户偏好**:自动记录你的规划习惯,提供个性化建议
- 📊 **语义记忆搜索**:基于历史偏好优化任务生成
- ✏️ **可视化编辑**:在友好的界面中查看和编辑生成的任务
- 📝 **灵活调整**:修改标题、描述、重要/紧急标记和截止日期
- 💾 **一键创建**:批量创建待办事项到 Flota
- 🎨 **Material-UI 设计**:使用 Material-UI 组件,与主应用风格完全一致
- 🌈 **主题同步**:自动同步 Flota 的浅色/深色主题

## 🧠 智能学习功能

插件使用 **Mem0 知识记忆框架** 学习你的任务规划习惯:

### 自动学习的内容

1. **紧急/重要偏好**: 记录你倾向标记哪类任务为紧急或重要
2. **时间规划习惯**: 学习你是否喜欢设置截止日期
3. **任务类型偏好**: 记住你常规划的任务类型

### 如何使用学习功能

- **自动学习**: 每次生成任务后,插件会自动分析并记录显著的偏好模式
- **查看记忆**: 使用开发者工具调用 `ai-task-planner.get-memories` 查看学习内容
- **重置偏好**: 调用 `ai-task-planner.clear-memories` 清除所有学习记忆

### 示例

**首次使用**（无历史偏好）:
```
任务: 准备产品发布会
AI 生成: 5个标准任务,均衡的重要/紧急分布
```

**多次使用后**（学习了偏好）:
```
任务: 准备产品发布会
系统记忆:
- 用户偏好标记紧急任务,占比 80%
- 用户习惯为所有任务设置明确截止日期

AI 生成: 5个任务,80%标记为紧急,全部包含截止日期
```

## 🚀 使用方法

### 1. 安装插件

1. 打开 Flota
2. 进入"插件商店" → "本地开发"
3. 点击"刷新本地插件"
4. 找到"AI 任务规划助手"并点击"安装"
5. 启用插件

### 2. 打开任务规划

- 在待办页面工具栏找到"AI 任务规划"按钮（✨ 图标）
- 点击按钮打开规划窗口

### 3. 生成任务

1. 在输入框中描述你的任务，例如：
   ```
   准备下周的产品发布会，包括：
   - 准备演示文稿
   - 搭建测试环境
   - 邀请参会嘉宾
   - 安排场地和设备
   ```

2. 点击"✨ 生成任务计划"按钮

3. AI 会分析你的描述，生成结构化的子任务列表

### 4. 编辑任务

- **修改标题**:直接在输入框中编辑
- **标记重要**:勾选"重要"复选框
- **标记紧急**:勾选"紧急"复选框
- **添加描述**:在描述框中补充详细信息
- **设置日期**:选择建议的完成日期
- **删除任务**:点击删除图标按钮移除不需要的任务

### 5. 创建待办

- 确认所有任务信息无误后，点击"💾 创建所有待办"
- 插件会将任务批量添加到 Flota 的待办列表
- 创建成功后会显示通知

## 💡 使用技巧

### 获得更好的 AI 结果

1. **描述要详细**：提供足够的上下文信息
2. **分点说明**：使用列表形式组织思路
3. **明确目标**：说清楚最终要达成什么
4. **包含细节**：提及关键步骤和注意事项

### 示例任务描述

**好的示例** ✅：
```
组织公司团建活动（下个月）：
1. 调研 3-5 个活动方案（户外拓展、密室逃脱等）
2. 收集同事意见和时间安排
3. 预订场地和预算审批
4. 准备活动物料和应急预案
5. 活动当天的流程安排
```

**不够好的示例** ❌：
```
搞个团建
```

## 🛠️ 技术实现

### UI 技术栈

- **React 18**: 使用主应用共享的 React 库
- **Material-UI v5**: 完整的 MUI 组件库(Button, TextField, Card, Checkbox 等)
- **主题同步**: 自动使用 `window.appTheme` 保持与主应用一致
- **零依赖**: 所有依赖由主应用提供,插件无需打包

### 使用的 API

- `runtime.ai.chat()` - AI 对话生成任务
- `runtime.ai.isAvailable()` - 检查 AI 可用性
- `runtime.todos.create()` - 创建待办事项
- `runtime.ui.openWindow()` - 打开规划窗口
- `runtime.notifications.show()` - 显示通知

### 权限说明

```json
{
  "todos:read": "读取现有待办列表",
  "todos:write": "创建新的待办事项",
  "ai:inference": "使用 AI 生成任务计划",
  "ui:open-window": "打开规划编辑窗口",
  "notifications:show": "显示操作结果通知",
  "mem0:read": "读取用户偏好记忆",
  "mem0:write": "记录学习的偏好"
}
```

## 📋 API 参考

### 待办数据结构说明

**重要**: 插件使用的字段与数据库字段不完全相同，PluginManager会自动进行映射。

#### 插件 API ↔ 数据库字段映射

| 插件API字段 | 数据库字段 | 类型 | 说明 |
|-----------|-----------|------|------|
| `title` | `content` | string | 任务标题(必填) |
| `description` | `description` | string | 详细描述(可选) |
| `completed` | `is_completed` | boolean | 完成状态 |
| `priority` | `is_important` + `is_urgent` | 'low'\|'medium'\|'high' | 优先级(计算得出) |
| `due_date` | `due_date` | string | 截止日期 YYYY-MM-DD |
| `tags` | `tags` | string | 标签(逗号分隔) |

#### Priority 映射规则（由PluginManager自动处理）

创建待办时:
- `priority: 'high'` → 数据库: `is_important=1, is_urgent=1`
- `priority: 'medium'` → 数据库: `is_important=1, is_urgent=0`
- `priority: 'low'` → 数据库: `is_important=0, is_urgent=0`

读取待办时:
- 数据库: `is_important=1 AND is_urgent=1` → API: `priority: 'high'`
- 数据库: `is_important=1 OR is_urgent=1` (不同时) → API: `priority: 'medium'`
- 数据库: `is_important=0 AND is_urgent=0` → API: `priority: 'low'`

### 命令列表

#### `ai-task-planner.open`
打开任务规划窗口

#### `ai-task-planner.generate`
生成任务计划

**参数**：
```javascript
{
  taskDescription: string  // 任务描述
}
```

**返回**：
```javascript
{
  status: 'success' | 'error',
  tasks: [
    {
      title: string,         // 任务标题（会映射到content）
      description: string,   // 详细说明
      priority: 'low' | 'medium' | 'high',  // 优先级（会映射到is_important+is_urgent）
      due_date: string | null  // YYYY-MM-DD 格式
    }
  ]
}
```

#### `ai-task-planner.create-todos`
批量创建待办事项

**参数**：
```javascript
{
  tasks: Array<{
    title: string,           // 必填，映射到数据库的content字段
    description?: string,    // 可选，存入description字段
    priority?: 'low' | 'medium' | 'high',  // 可选，默认medium，映射到is_important+is_urgent
    due_date?: string,       // 可选，格式 YYYY-MM-DD
    completed?: boolean,     // 可选，默认false，映射到is_completed
    tags?: string            // 可选，逗号分隔的标签字符串
  }>
}
```

**返回**：
```javascript
{
  status: 'success' | 'error',
  results: Array<{
    success: boolean,
    todo?: {
      id: number,
      title: string,           // 从数据库content字段映射
      completed: boolean,      // 从is_completed映射
      priority: string,        // 从is_important+is_urgent计算
      description: string,     // 仅在有todos:read:full权限时返回
      // ... 其他字段
    },
    error?: string
  }>,
  summary: {
    total: number,
    success: number,
    failed: number
  }
}
```

### 数据库实际结构参考

todos表实际字段（供开发者参考）:
- `id` INTEGER PRIMARY KEY
- `content` TEXT NOT NULL - 对应API的title
- `description` TEXT - 详细描述
- `is_completed` INTEGER - 对应API的completed
- `is_important` INTEGER - 用于计算priority
- `is_urgent` INTEGER - 用于计算priority
- `due_date` DATETIME
- `tags` TEXT
- `focus_time_seconds` INTEGER
- `created_at`, `updated_at`, `completed_at` DATETIME

**注意**: 数据库中**没有**`priority`字段，这是插件API层面的抽象。
```

**返回**：
```javascript
{
  status: 'success' | 'error',
  results: Array<{
    success: boolean,
    todo?: object,
    error?: string
  }>,
  summary: {
    total: number,
    success: number,
    failed: number
  }
}
```

## 🎨 界面预览

插件界面使用 **Material-UI** 组件库,与 Flota 主应用风格完全一致:

- **Material Design**: 遵循 Google Material Design 规范
- **MUI 组件**: Button, TextField, Card, Chip, Checkbox, List 等
- **主题同步**: 自动同步主应用的浅色/深色主题
- **响应式布局**: 适配不同窗口尺寸
- **交互反馈**: 按钮波纹效果、加载状态、错误提示

## 🔧 开发说明

### 目录结构

```
ai-task-planner/
├── manifest.json      # 插件配置
├── index.js           # 主逻辑(Worker 线程)
├── planner-mui.html   # UI 界面(Material-UI 版本)
├── planner.html       # UI 界面(已废弃,保留作参考)
├── icon.svg           # 插件图标
└── README.md          # 文档
```

### React + Material-UI 实现

插件使用主应用共享的依赖,无需打包:

```javascript
// 在 planner-mui.html 中
const React = window.React;
const ReactDOM = window.ReactDOM;
const { 
  Button, TextField, Card, Checkbox, 
  Typography, Container, CircularProgress 
} = window.MaterialUI;
const { Delete, Add } = window.MaterialIcons;
const theme = window.appTheme;  // 主应用主题
```

主要 MUI 组件使用:
- `Container`: 页面容器
- `Paper/Card`: 卡片布局
- `TextField`: 输入框
- `Button`: 按钮(带波纹效果)
- `Checkbox/FormControlLabel`: 复选框
- `Chip`: 标签
- `List/ListItem`: 列表
- `CircularProgress`: 加载动画
- `Alert`: 提示信息

### 本地开发

1. 克隆项目到 `plugins/examples/ai-task-planner/`
2. 启动 Flota 开发环境：`npm run electron-dev`
3. 在插件商店刷新并安装插件
4. 修改代码后点击"重载插件"

### 调试技巧

- 使用 `runtime.logger.info/warn/error()` 记录日志
- 按 `Ctrl+Shift+I` 打开开发者工具查看日志
- 检查网络请求和 AI 响应内容
- 验证生成的 JSON 格式是否正确

## 🐛 常见问题

### AI 不可用

**问题**：提示"AI 服务不可用"

**解决**：
1. 检查 Flota 设置中是否配置了 AI 服务
2. 确认 API Key 是否有效
3. 检查网络连接

### 生成的任务为空

**问题**：AI 返回空列表

**解决**：
1. 提供更详细的任务描述
2. 使用分点列表格式
3. 包含更多上下文信息

### 创建待办失败

**问题**：部分或全部待办创建失败

**解决**：
1. 检查任务标题是否为空
2. 确认日期格式是否正确（YYYY-MM-DD）
3. 查看日志了解具体错误信息

## 📝 更新日志

### v2.0.0 (2025-01-12)

- 🎨 **升级到 Material-UI**: 使用 MUI 组件库重写界面
- 🧠 **智能学习**: 集成 Mem0 框架,自动学习用户偏好
- � **个性化规划**: 基于历史习惯优化任务生成
- �🔄 **移除字段映射**: 直接使用数据库字段名
- ✅ **重要/紧急标记**: 替代旧的优先级(高/中/低)系统
- 📦 **零依赖**: 使用主应用共享的 React/MUI,无需打包
- 🌈 **主题同步**: 自动跟随主应用主题切换
- 🗓️ **日期智能**: AI 生成任务时知道当前日期

### v1.0.0 (2025-11-10)

- ✨ 首次发布
- 🤖 AI 任务拆解功能
- ✏️ 可视化编辑界面
- 💾 批量创建待办
- 🎨 主题自适应

## 🔬 技术细节

### Mem0 知识记忆

- **本地运行**: 无需 API Key,使用本地向量模型
- **语义搜索**: 基于 all-MiniLM-L6-v2 模型(384维向量)
- **快速查询**: <10k 条记忆查询 <20ms
- **自动分类**: 使用 `task_planning` 类别区分不同类型的记忆
- **隐私保护**: 所有数据存储在本地 SQLite 数据库

### 学习算法

插件在每次任务生成后分析以下特征:
- 紧急任务占比 ≥60% → 记录"用户偏好标记紧急任务"
- 重要任务占比 ≥60% → 记录"用户倾向标记重要任务"  
- 全部任务有截止日期 → 记录"用户习惯设置明确截止日期"
- 全部任务无截止日期 → 记录"用户倾向保持时间灵活性"
- 记录任务类型描述（前100字符）

下次生成时,系统会:
1. 搜索与当前任务相似的历史偏好(Top 5,相似度阈值0.65)
2. 将偏好注入 AI 提示词
3. AI 参考偏好生成个性化任务列表

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

---

**享受智能任务规划！** 🚀
