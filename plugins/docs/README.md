# Flota 插件开发文档# Flota 插件开发文档



欢迎来到 Flota 插件开发!欢迎来到 Flota 插件开发文档！这里包含了开发高质量插件所需的所有资源。



## 📚 开发指南## 📚 文档导航



**[development-guide.md](./development-guide.md)** - 完整的插件开发文档### 新手入门



这是唯一且权威的插件开发指南,包含:- **[快速开始](./QUICK_START.md)** ⭐ 推荐从这里开始

  - 5 分钟创建你的第一个插件

- ⚠️ **核心要求**: manifest.json 必须包含 entry 字段  - 包含完整的示例代码

- 🚀 **快速开始**: 5分钟创建第一个插件  - 常见问题解答

- 📋 **Manifest 配置**: 完整的配置说明

- 🔧 **Runtime API**: 所有可用 API 的详细文档### 核心文档

- 🎨 **UI 窗口开发**: 创建自定义界面

- 🌈 **UI Bridge 系统**: 访问主应用的主题资源- **[开发指南](./development-guide.md)**

- ✅ **最佳实践**: 开发规范和技巧  - 插件系统架构概览

- 🐛 **调试与测试**: 开发流程和问题排查  - Manifest 配置规范

- 📦 **API 速查表**: 快速查阅常用 API  - 开发流程和调试方法

  - 安装与分发指南

## 💡 示例插件

- **[API 参考](./API_REFERENCE.md)**

在 `plugins/examples/` 目录下有多个示例插件:  - 完整的 Runtime API 文档

  - 所有方法的参数和返回值

- **random-note** - 简单示例:随机打开笔记  - 代码示例和用法说明

- **ui-bridge-demo** - UI Bridge 完整演示

- **react-demo** - React 插件演示- **[UI Bridge API](./UI_BRIDGE_API.md)** ⭐ 新功能

- **comprehensive-api-demo** - 全功能 API 演示  - 插件 UI 主题资源访问

- **test-extended-permissions** - 权限系统测试  - 40+ CSS 变量自动同步主题

  - JavaScript API 和主题监听

## ⚠️ 重要提示  - 完整示例和最佳实践



**所有插件的 `manifest.json` 都必须包含 `entry` 字段!**- **[最佳实践](./BEST_PRACTICES.md)** ⭐ 必读

  - 使用全局 `runtime` 对象（黄金法则）

这是插件系统的核心要求,在 `electron/services/PluginManager.js` 的 `validateManifest()` 方法中强制校验。  - 完整的开发规范和建议

  - 性能优化技巧

示例:  - 安全建议

```json  - 错误处理模式

{

  "id": "my-plugin",### 设计文档

  "name": "我的插件",

  "version": "1.0.0",- **[UI Resources Design](./UI_RESOURCES_DESIGN.md)**

  "entry": "index.js",  - UI Bridge 系统架构设计

  "permissions": [],  - 多阶段实现计划

  "minAppVersion": "2.1.0"  - 技术细节和实现方案

}

```## 🎯 核心概念



## 🚀 快速开始### Runtime 对象



1. 创建插件目录: `plugins/examples/my-plugin/`插件使用全局 `runtime` 对象访问所有 API：

2. 编写 `manifest.json` (必须包含 entry 字段!)

3. 编写 `index.js````javascript

4. 启动开发: `npm run electron-dev`runtime.onActivate(async (context) => {

5. 在插件商店加载测试  runtime.logger.info('插件激活')

  

详细步骤请查看 [development-guide.md](./development-guide.md)。  runtime.registerCommand({ id: 'hello', title: '打招呼' }, async () => {

    await runtime.notifications.show({

## 🤝 贡献      title: '你好',

      body: '欢迎使用 Flota',

欢迎提交 Issue 和 Pull Request!      type: 'success'

    })

---  })

})

**祝你开发愉快!** 🎉```


### 权限系统

插件必须在 `manifest.json` 中声明所需权限：

```json
{
  "permissions": [
    "notes:read",
    "ui:open-note",
    "notifications:show"
  ]
}
```

### 沙箱隔离

- 插件运行在独立的 Worker 线程中
- 无法直接访问 Node.js 模块或文件系统
- 所有操作通过 Runtime API 进行

## 💡 示例插件

### 简单示例

- **[random-note](../examples/random-note/)** - 随机打开一篇笔记
  - 演示基础命令注册
  - 数据访问和 UI 操作
  - 错误处理

### 高级示例

- **[ai-task-planner](../examples/ai-task-planner/)** - AI 任务规划助手
  - 自定义 UI 窗口
  - 待办事项操作
  - AI 推理集成

## 🔧 开发工具

### 本地开发

1. 将插件放在 `plugins/examples/` 目录
2. 启动开发服务器：`npm run electron-dev`
3. 打开插件商店 → 本地开发 → 刷新本地插件

### 调试工具

- **开发者工具**: `Ctrl+Shift+I`（Windows/Linux）或 `Cmd+Option+I`（Mac）
- **日志输出**: 使用 `runtime.logger.info/warn/error()`
- **热重载**: 在插件商店点击"重载插件"按钮

## 📦 Manifest 配置

### 必需字段

```json
{
  "id": "unique-plugin-id",
  "name": "插件名称",
  "version": "1.0.0",
  "description": "插件描述",
  "entry": "index.js",
  "permissions": [],
  "minAppVersion": "2.1.0"
}
```

### 可选字段

```json
{
  "author": {
    "name": "作者名",
    "email": "email@example.com"
  },
  "icon": "icon.svg",
  "toolbar": {
    "location": "notes",
    "tooltip": "插件提示"
  },
  "commands": [
    {
      "id": "command-id",
      "title": "命令标题"
    }
  ],
  "categories": ["效率"],
  "tags": ["productivity"]
}
```

## 🔐 权限列表

| 权限 | 说明 |
|------|------|
| `notes:read` | 读取笔记 |
| `notes:write` | 创建/修改笔记 |
| `todos:read` | 读取待办 |
| `todos:write` | 创建/修改待办 |
| `tags:read` | 读取标签 |
| `tags:write` | 创建/修改标签 |
| `ui:open-note` | 打开笔记 |
| `ui:open-window` | 打开自定义窗口 |
| `ai:inference` | 使用 AI |
| `notifications:show` | 显示通知 |
| `storage:read` | 读取存储 |
| `storage:write` | 写入存储 |
| `network:request` | 网络请求 |
| `clipboard:read/write` | 剪贴板访问 |
| `filesystem:read/write` | 文件系统访问 |

完整列表见 [API 参考](./API_REFERENCE.md)。

## 🎨 UI 开发

### Dialog 窗口（推荐）

```javascript
await runtime.ui.openWindow({
  url: '/settings.html',
  title: '设置',
  width: 800,
  height: 600,
  resizable: true,
  closable: true
})
```

### HTML 页面示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>插件界面</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 20px;
    }
  </style>
</head>
<body>
  <h1>插件界面</h1>
  <p>这是一个自定义窗口</p>
</body>
</html>
```

## 🚀 发布插件

### 发布前检查

- [ ] manifest.json 填写完整
- [ ] 版本号符合语义化规范
- [ ] 权限最小化
- [ ] 包含 README.md
- [ ] 提供插件图标
- [ ] 所有功能测试通过
- [ ] 错误处理完善
- [ ] 无敏感信息

### 版本管理

使用语义化版本（Semver）：

- **主版本号**: 不兼容的 API 变更
- **次版本号**: 向下兼容的功能新增
- **修订号**: 向下兼容的问题修复

示例：`1.2.3`

## 🤝 贡献与支持

### 获取帮助

- 📖 阅读文档
- 💬 社区讨论
- 🐛 提交 Issue
- 📧 联系开发团队

### 贡献方式

- 报告 Bug
- 提出功能建议
- 提交示例插件
- 完善文档

## 📋 常见问题

### runtime 未定义

**问题**: 代码中 `runtime` 显示未定义

**解决**: 
- 确保插件在 Worker 中运行
- 不要使用 `require('@flota/sdk')`
- 直接使用全局 `runtime` 对象

### 权限被拒绝

**问题**: API 调用返回权限错误

**解决**:
- 在 `manifest.json` 的 `permissions` 中添加所需权限
- 重新加载插件

### 命令不显示

**问题**: 工具栏没有显示插件按钮

**解决**:
- 检查 `manifest.json` 中的 `toolbar` 配置
- 确保 `location` 字段正确（`notes`/`todos`/`calendar`）
- 重新加载插件

### 窗口无法打开

**问题**: 调用 `runtime.ui.openWindow()` 没有反应

**解决**:
- 确保有 `ui:open-window` 权限
- URL 必须以 `/` 开头
- HTML 文件必须在插件根目录

### Material-UI 样式在打包后丢失

**问题**: 插件 UI 使用 Material-UI，开发模式正常，打包后完全没有样式

**原因**: 
- Material-UI v5 使用 emotion CSS-in-JS，样式会在组件渲染时动态生成
- 插件运行在 iframe 中，默认情况下 emotion 会将样式注入到主文档的 `<head>`
- 生产环境中，Vite 会将 emotion 样式提取到外部 CSS 文件，但 MUI 组件的样式是懒加载的，不在提取的 CSS 中

**解决方案** ⭐ 必须使用独立的 emotion cache：

1. **主应用注入依赖**（在 `src/App.jsx` 中）：

```javascript
import { CacheProvider } from '@emotion/react'
import createCache from '@emotion/cache'

// 为 iframe 创建独立的 emotion cache
const iframeDoc = iframe.contentDocument || iframe.contentWindow.document
const iframeCache = createCache({
  key: 'iframe-emotion',
  container: iframeDoc.head,  // 样式注入到 iframe 的 head
  prepend: true
})

// 暴露给插件使用
iframe.contentWindow.emotionCache = iframeCache
iframe.contentWindow.CacheProvider = CacheProvider
```

2. **插件 HTML 使用 CacheProvider**：

```javascript
// 获取主应用注入的依赖
const { React, ReactDOM, MaterialUI, emotionCache, CacheProvider } = window

function App() {
  // 你的 Material-UI 组件
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Box>{/* ... */}</Box>
    </ThemeProvider>
  )
}

// 使用 CacheProvider 包裹应用
const root = ReactDOM.createRoot(document.getElementById('root'))
if (emotionCache && CacheProvider) {
  root.render(
    <CacheProvider cache={emotionCache}>
      <App />
    </CacheProvider>
  )
} else {
  root.render(<App />)
}
```

**关键点**：
- 使用 `cache` 属性传递 emotion cache（不是 `value`）
- `CacheProvider` 必须在最外层，包裹整个应用
- `ThemeProvider` 在 `CacheProvider` 内部
- 这样 Material-UI 组件的样式会自动注入到 iframe 的 `<head>` 中

**参考示例**: `plugins/examples/ai-task-planner/planner-mui.html`

## 🔗 相关链接

- [GitHub 仓库](https://github.com/Xperiamol/Flota)
- [官方网站](https://Flota.app)
- [社区论坛](https://community.Flota.app)

## 📝 更新日志

### 2025-11-19

- 🐛 修复：Material-UI 插件在打包后样式丢失的问题
- 📚 新增：插件 UI 中使用 Material-UI 的完整解决方案
- ⭐ 重要：添加 emotion CacheProvider 使用指南

### 2025-11-10

- ✨ 新增：完整的最佳实践文档
- ✨ 新增：详细的 API 参考文档
- ✨ 新增：快速开始指南
- 🔧 更新：开发指南，强调使用全局 `runtime` 对象
- 📚 改进：文档结构和导航

---

**让我们一起构建强大的 Flota 插件生态！** 🎉
