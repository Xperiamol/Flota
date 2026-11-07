# FlashNote 2.0

中文 | [English](./README_EN.md)

一个现代化的桌面笔记应用，专为高效记录和管理笔记而设计。
旧的1.x版本已经随风而逝了，迎接现在更开放更赏心悦目的新版本。
<img width="1492" height="995" alt="image" src="https://github.com/user-attachments/assets/04957a50-7fdb-4d66-8271-337aaf85f8c6" />

## 感谢百度文心快码（BAIDU COMATE）支持！🙏

## 🌟 主要特性

### 📝 智能笔记编辑
- **富文本编辑器**：支持Markdown语法，实时预览
- **白板编辑器**：Excalidraw 作为白板引擎，支持白板、绘图等功能。
- **快速格式化**：一键应用粗体、斜体、下划线等格式
- **丰富MD格式**：Wiki 链接、标签、彩色文本、Callout 等
- **自动保存**：实时保存，永不丢失内容

### 🎯 高效操作
- **全局快捷键**：随时随地快速创建笔记
- **系统托盘**：最小化到托盘，后台运行不占用任务栏
- **快速搜索**：全文搜索，快速定位所需内容

### 🎨 个性化定制
- **主题切换**：支持亮色/暗色主题/强调色
- **快捷键配置**：个性化快捷键设置
- **界面布局**：灵活的窗口布局选项
- **预装背景插件**：提供多种纹路背景插件，美化你的笔记界面


### 📊 数据管理
- **本地SQLITE存储**：数据安全存储在本地
- **向量存储**：使用 @xenova/transformers 在本地设备上进行文本向量化
- **本地Mem0Service集成**：实现基于余弦相似度的语义搜索和记忆管理系统
- **分类管理**：支持标签和分类整理
- **导入导出**：支持多种格式的数据迁移
- **备份恢复**：自动备份，一键恢复

### 📅 日历同步
- **CalDAV 协议**：支持 iCloud、Nextcloud 等标准 CalDAV 服务
- **Google Calendar**：OAuth 2.0 安全授权，无需密码
- **双向同步**：待办事项与日历事件自动同步
- **多设备协同**：通过日历服务实现多设备数据同步

### 🎤 语音转文字（v2.2.2+）
- **多服务支持**：OpenAI Whisper、阿里云语音识别等
- **高准确率**：支持多语言自动识别
- **插件调用**：为语音笔记等场景提供API支持
- **灵活配置**：支持自定义服务端点


## 🚀 快速开始

### 系统要求
- Windows 10 或更高版本
- 至少 100MB 可用磁盘空间

### 安装方式

#### 方式一：下载安装包（推荐）
1. 前往 [Releases](https://github.com/Xperiamol/FlashNote/releases) 页面
2. 下载最新版本的 `FlashNote 2.x.x. Setup 2.x.x.exe`
3. 运行安装程序，按照提示完成安装
4. 安装完成后，应用会自动启动

#### 方式二：便携版(暂时弃用)
1. 下载 `win-unpacked` 文件夹
2. 解压到任意目录
3. 运行 `FlashNote 2.0.exe` 即可使用

### 首次使用
1. **启动应用**：双击桌面图标或从开始菜单启动
2. **创建笔记**：使用快捷键 `Ctrl+N` 或点击"新建笔记"
3. **快速输入**：使用快捷键 `Ctrl+Shift+N` 打开快速输入窗口
4. **系统托盘**：应用会最小化到系统托盘，右键查看更多选项


## 🛠️ 开发者指南

### 技术栈
- **前端框架**：React + Vite
- **桌面框架**：Electron
- **数据库**：SQLite (better-sqlite3)
- **UI组件**：Material-UI
- **状态管理**：Zustand

### 本地开发

```bash
# 克隆项目
git clone https://github.com/Xperiamol/FlashNote.git
cd FlashNote

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 启动Electron开发模式
npm run electron-dev
```

### 构建打包

```bash
# 构建前端
npm run build

# 打包Electron应用
npm run electron-build
```

### 🔌 插件开发

FlashNote 2+ 支持强大的插件系统，你可以创建自己的插件来扩展功能！

#### 快速开始

```javascript
// 创建 plugins/examples/my-plugin/manifest.json 和 index.js
runtime.onActivate(async () => {
  runtime.registerCommand({
    id: 'hello',
    title: '打招呼'
  }, async () => {
    await runtime.notifications.show({
      title: '你好！',
      body: '欢迎使用 FlashNote 插件系统',
      type: 'success'
    })
  })
})
```

#### 插件文档

- 📚 **[插件开发文档](./plugins/docs/README.md)** - 完整文档索引
- 🚀 **[开发者指南](./plugins/docs/development-guide.md)** - 完整的开发者指南
- 💡 **[示例插件](./plugins/examples/)** - 学习参考
  - [random-note](./plugins/examples/random-note/) - 简单命令示例
  - [ai-task-planner](./plugins/examples/ai-task-planner/) - 自定义窗口示例

#### 插件特性

- ✅ **安全沙箱**: 插件在独立 Worker 中运行
- ✅ **权限系统**: 细粒度权限控制
- ✅ **Runtime API**: 访问笔记、待办、标签等数据
- ✅ **自定义 UI**: 创建 Dialog 窗口展示界面
- ✅ **热重载**: 开发时无需重启应用
- ✅ **本地开发**: 方便的本地调试工具

开始创建你的第一个插件吧！查看 [开发者完整指南](./plugins/docs/development-guide.md) 了解详情。

### 项目结构

```
FlashNote/
├── src/                    # 前端源码
│   ├── components/         # React组件
│   ├── utils/             # 工具函数
│   ├── styles/            # 样式文件
│   └── main.jsx           # 入口文件
├── electron/              # Electron主进程
│   └── main.js            # 主进程入口
├── public/                # 静态资源
└── dist-electron/         # 构建输出
```

## 🤝 贡献指南

我们欢迎所有形式的贡献！请直接提issue。插件系统目前仅支持本地添加，您可以本地开发后安装。

### 如何贡献
1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 问题反馈
- 发现Bug？请创建 Issue
- 有新想法？欢迎在 Discussions中讨论

## 🙏 致谢

感谢所有使用过这个项目demo的用户！我们致力于创造一个用最小交互完成记录的、有摩擦的笔记应用。

---

**FlashNote 2** - 让笔记记录变得更加高效和愉悦！

如果这个项目对你有帮助，请给我们一个 ⭐️！
