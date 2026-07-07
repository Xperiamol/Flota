<div align="center">
  <p>
    <a href="./README.md">中文</a>
    ·
    <a href="./README_EN.md">English</a>
  </p>

  <img src="./logo.png" width="96" alt="Flota Logo" />

  <h1>Flota</h1>
  <p><strong>简洁、高效、开放的桌面记录应用</strong></p>
  <p>
    面向笔记、待办、白板、日历同步与 AI 助手的一体化本地优先工作台。
  </p>

  <p>
    <img src="https://img.shields.io/badge/version-3.5.0-5B8DEF?style=flat-square" alt="Version 3.5.0" />
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2E3440?style=flat-square" alt="Platforms" />
    <img src="https://img.shields.io/badge/stack-React%20%2B%20Electron-61DAFB?style=flat-square" alt="React + Electron" />
    <img src="https://img.shields.io/badge/storage-SQLite-003B57?style=flat-square" alt="SQLite" />
  </p>

  <p>
    <a href="https://github.com/Xperiamol/Flota/releases"><strong>下载最新版</strong></a>
    ·
    <a href="#quick-start"><strong>快速开始</strong></a>
    ·
    <a href="#plugin-development"><strong>插件开发</strong></a>
    ·
    <a href="./docs/RELEASE_FLOW.md"><strong>发布流程</strong></a>
  </p>
</div>

<br />

<div align="center">
  <img width="1492" alt="Flota light preview" src="https://github.com/user-attachments/assets/04957a50-7fdb-4d66-8271-337aaf85f8c6" />
  <br />
  <br />
  <img width="1495" alt="Flota dark preview" src="https://github.com/user-attachments/assets/e52d7d6f-ffb3-4cde-a0c5-988ba006a278" />
</div>

<br />

<a id="overview"></a>

<h2>✨ 项目概览</h2>

<p>
  Flota 是一个现代化桌面笔记应用，专为高效记录、整理知识、规划待办和连接 AI 工作流而设计。
  相比旧版 1.x，当前版本拥有更开放的插件系统、更完整的数据同步能力以及更赏心悦目的交互体验。
</p>

<table>
  <tr>
    <td><strong>📝 本地优先</strong></td>
    <td>笔记、待办、设置等核心数据存储在本地 SQLite 中，优先保障隐私与可控性。</td>
  </tr>
  <tr>
    <td><strong>🧠 AI 增强</strong></td>
    <td>支持 AI 问答、上下文理解、待办规划、文本润色、会议待办提取与白板生成。</td>
  </tr>
  <tr>
    <td><strong>🔌 插件开放</strong></td>
    <td>通过安全沙箱、权限系统和 Runtime API 扩展笔记、待办、标签、UI 与命令能力。</td>
  </tr>
  <tr>
    <td><strong>☁️ 多端同步</strong></td>
    <td>支持 WebDAV、CalDAV、Google Calendar 等同步方式，适配不同数据流转场景。</td>
  </tr>
</table>

<a id="features"></a>

<h2>🌟 主要特性</h2>

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>📝 智能笔记编辑</h3>
      <ul>
        <li><strong>富文本编辑器</strong>：支持 Markdown 语法与实时预览。</li>
        <li><strong>所见即所得</strong>：基于 TipTap 的连续编辑体验。</li>
        <li><strong>画布编辑器</strong>：以 Excalidraw 作为白板引擎，支持绘图、草图和结构化表达。</li>
        <li><strong>丰富 Markdown 扩展</strong>：支持 Wiki 链接、标签、彩色文本、Callout 等。</li>
        <li><strong>自动保存</strong>：实时保存，降低内容丢失风险。</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>🎯 高效操作</h3>
      <ul>
        <li><strong>全局快捷键</strong>：随时快速创建笔记或待办。</li>
        <li><strong>系统托盘</strong>：最小化到托盘，后台运行不占用任务栏。</li>
        <li><strong>全文搜索</strong>：快速定位笔记、待办和上下文内容。</li>
        <li><strong>多选管理</strong>：支持批量删除、恢复、完成与标签处理。</li>
        <li><strong>独立窗口</strong>：适合快速记录、专注编辑和浮窗使用。</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🎨 个性化定制</h3>
      <ul>
        <li><strong>主题切换</strong>：支持亮色、暗色、系统主题和强调色。</li>
        <li><strong>快捷键配置</strong>：按个人习惯调整全局与应用内快捷键。</li>
        <li><strong>界面布局</strong>：支持灵活的侧边栏、工具栏和视图组合。</li>
        <li><strong>背景插件</strong>：内置多种纹理背景插件，美化记录空间。</li>
        <li><strong>节日模式</strong>：提供轻量化装饰与氛围效果。</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>📊 数据管理</h3>
      <ul>
        <li><strong>SQLite 本地存储</strong>：核心数据安全保存在本机。</li>
        <li><strong>向量检索</strong>：使用 @xenova/transformers 在本地进行文本向量化。</li>
        <li><strong>语义记忆</strong>：基于余弦相似度实现语义搜索与记忆召回。</li>
        <li><strong>分类管理</strong>：通过标签与分类整理知识资产。</li>
        <li><strong>导入导出</strong>：支持多种格式的数据迁移、备份和恢复。</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📅 待办与日历同步</h3>
      <ul>
        <li><strong>CalDAV 协议</strong>：支持 iCloud、Nextcloud、坚果云等标准服务。</li>
        <li><strong>Google Calendar</strong>：OAuth 2.0 授权，无需保存账户密码。</li>
        <li><strong>双向同步</strong>：待办事项与日历事件可自动同步。</li>
        <li><strong>重复待办</strong>：适合习惯追踪、周期任务和长期计划。</li>
        <li><strong>提醒通知</strong>：到期待办通过系统通知提醒。</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>🎤 语音与 AI 工作流</h3>
      <ul>
        <li><strong>语音转文字</strong>：支持 OpenAI Whisper、阿里云语音识别等服务。</li>
        <li><strong>AI 命令中心</strong>：可总结笔记、规划待办、生成日报和关联内容。</li>
        <li><strong>白板生成</strong>：支持根据自然语言生成结构图、流程图和思维导图。</li>
        <li><strong>上下文增强</strong>：整合当前笔记、近期待办、相关记忆与历史会话。</li>
        <li><strong>插件调用</strong>：为语音笔记、自动化任务等场景提供 API 支持。</li>
      </ul>
    </td>
  </tr>
</table>

<a id="quick-start"></a>

<h2>🚀 快速开始</h2>

<h3>系统要求</h3>

<table>
  <tr>
    <th>平台</th>
    <th>建议环境</th>
  </tr>
  <tr>
    <td>Windows</td>
    <td>Windows 10 或更高版本</td>
  </tr>
  <tr>
    <td>macOS</td>
    <td>支持 Electron 当前运行时的 macOS 版本</td>
  </tr>
  <tr>
    <td>Linux</td>
    <td>支持 AppImage 的主流桌面发行版</td>
  </tr>
  <tr>
    <td>磁盘空间</td>
    <td>建议预留 300MB 以上空间；启用模型、插件或附件后需要更多空间</td>
  </tr>
</table>

<h3>安装方式</h3>

<ol>
  <li>前往 <a href="https://github.com/Xperiamol/Flota/releases">GitHub Releases</a> 页面。</li>
  <li>下载与你的系统匹配的安装包或便携版本。</li>
  <li>运行安装程序，并根据提示完成安装。</li>
  <li>启动 Flota，开始创建第一条笔记或待办。</li>
</ol>

<h3>首次使用建议</h3>

<table>
  <tr>
    <td><strong>1. 创建笔记</strong></td>
    <td>使用快捷键 <code>Ctrl/Cmd + N</code> 或点击“新建笔记”。</td>
  </tr>
  <tr>
    <td><strong>2. 快速输入</strong></td>
    <td>使用快捷键 <code>Ctrl/Cmd + Shift + N</code> 打开快速输入窗口。</td>
  </tr>
  <tr>
    <td><strong>3. 管理待办</strong></td>
    <td>使用快捷键 <code>Ctrl/Cmd + T</code> 创建待办，并在四象限或日历视图中管理。</td>
  </tr>
  <tr>
    <td><strong>4. 配置同步</strong></td>
    <td>在设置页按需启用 WebDAV、CalDAV 或 Google Calendar。</td>
  </tr>
  <tr>
    <td><strong>5. 使用插件</strong></td>
    <td>安装或开发插件，扩展自己的记录工作流。</td>
  </tr>
</table>

<a id="development"></a>

<h2>🛠️ 开发者指南</h2>

<h3>技术栈</h3>

<table>
  <tr>
    <th>方向</th>
    <th>技术</th>
  </tr>
  <tr>
    <td>前端框架</td>
    <td>React 18 + Vite</td>
  </tr>
  <tr>
    <td>桌面框架</td>
    <td>Electron</td>
  </tr>
  <tr>
    <td>UI 组件</td>
    <td>Material UI + Emotion</td>
  </tr>
  <tr>
    <td>编辑器</td>
    <td>TipTap + Markdown-it + Excalidraw</td>
  </tr>
  <tr>
    <td>状态管理</td>
    <td>Zustand</td>
  </tr>
  <tr>
    <td>本地存储</td>
    <td>SQLite / better-sqlite3</td>
  </tr>
  <tr>
    <td>AI / 向量</td>
    <td>@xenova/transformers + OpenAI 兼容接口</td>
  </tr>
  <tr>
    <td>同步</td>
    <td>WebDAV、CalDAV、Google Calendar</td>
  </tr>
</table>

<h3>本地开发</h3>

<pre><code class="language-bash"># 克隆项目
git clone https://github.com/Xperiamol/Flota.git
cd Flota

# 安装依赖
npm install

# 启动前端开发服务器
npm run dev

# 启动 Electron 开发模式
npm run electron-dev
</code></pre>

<h3>构建打包</h3>

<pre><code class="language-bash"># 构建前端资源
npm run build

# 打包 Electron 应用
npm run electron-build

# 修复本地数据库索引或损坏问题
npm run repair-db
</code></pre>

<h3>常用脚本</h3>

<table>
  <tr>
    <th>命令</th>
    <th>说明</th>
  </tr>
  <tr>
    <td><code>npm run dev</code></td>
    <td>启动 Vite 开发服务器。</td>
  </tr>
  <tr>
    <td><code>npm run electron-dev</code></td>
    <td>启动完整 Electron 开发环境。</td>
  </tr>
  <tr>
    <td><code>npm run build</code></td>
    <td>构建前端静态资源。</td>
  </tr>
  <tr>
    <td><code>npm run electron-build</code></td>
    <td>预下载模型、构建前端并打包桌面应用。</td>
  </tr>
  <tr>
    <td><code>npm run repair-db</code></td>
    <td>尝试修复损坏的本地数据库与 FTS 索引。</td>
  </tr>
  <tr>
    <td><code>npm run release:notes</code></td>
    <td>提取发布说明。</td>
  </tr>
</table>

<a id="plugin-development"></a>

<h2>🔌 插件开发</h2>

<p>
  Flota 2+ 支持插件系统。你可以通过插件扩展命令、视图、通知、笔记、待办、标签和自定义 UI。
</p>

<h3>快速示例</h3>

<pre><code class="language-javascript">// 创建 plugins/examples/my-plugin/manifest.json 和 index.js
runtime.onActivate(async () =&gt; {
  runtime.registerCommand({
    id: 'hello',
    title: '打招呼'
  }, async () =&gt; {
    await runtime.notifications.show({
      title: '你好！',
      body: '欢迎使用 Flota 插件系统',
      type: 'success'
    })
  })
})
</code></pre>

<h3>插件能力</h3>

<table>
  <tr>
    <td><strong>✅ 安全沙箱</strong></td>
    <td>插件在独立 Worker 中运行，降低对主应用的影响。</td>
  </tr>
  <tr>
    <td><strong>✅ 权限系统</strong></td>
    <td>通过细粒度权限控制笔记、待办、标签、附件、事件等能力。</td>
  </tr>
  <tr>
    <td><strong>✅ Runtime API</strong></td>
    <td>访问笔记、待办、标签、分析统计和 UI 能力。</td>
  </tr>
  <tr>
    <td><strong>✅ 自定义 UI</strong></td>
    <td>支持创建 Dialog、插件视图和更丰富的交互界面。</td>
  </tr>
  <tr>
    <td><strong>✅ 热重载</strong></td>
    <td>本地开发时无需频繁重启应用。</td>
  </tr>
</table>

<h3>插件文档</h3>

<ul>
  <li>📚 <a href="./plugins/docs/README.md"><strong>插件开发文档</strong></a>：完整文档索引。</li>
  <li>🚀 <a href="./plugins/docs/development-guide.md"><strong>开发者指南</strong></a>：完整插件开发流程与 API 说明。</li>
  <li>💡 <a href="./plugins/examples/"><strong>示例插件</strong></a>：从示例中学习插件能力。</li>
</ul>

<a id="project-structure"></a>

<h2>📁 项目结构</h2>

<pre><code class="language-text">Flota/
├── src/                    # 前端源码
│   ├── api/                # 渲染进程 API 封装
│   ├── components/         # React 组件
│   ├── hooks/              # 业务与 UI hooks
│   ├── locales/            # 国际化文案
│   ├── markdown/           # Markdown 渲染与扩展
│   ├── store/              # Zustand 状态管理
│   ├── styles/             # 主题与样式
│   └── utils/              # 通用工具函数
├── electron/               # Electron 主进程与服务
│   ├── dao/                # SQLite 数据访问层
│   ├── ipc/                # IPC handlers
│   └── services/           # 同步、AI、插件、图片等服务
├── plugins/                # 内置插件、示例插件与插件文档
├── models/                 # 本地嵌入模型资源
├── public/                 # 静态资源
├── scripts/                # 构建、发布和维护脚本
└── docs/                   # 项目文档
</code></pre>

<a id="roadmap"></a>

<h2>🧭 维护方向</h2>

<table>
  <tr>
    <th>方向</th>
    <th>说明</th>
  </tr>
  <tr>
    <td>测试体系</td>
    <td>补充同步、待办、协议访问、插件 API 和核心工具函数的自动化测试。</td>
  </tr>
  <tr>
    <td>同步诊断</td>
    <td>完善 WebDAV / CalDAV / Google Calendar 的诊断报告、冲突预览和错误定位。</td>
  </tr>
  <tr>
    <td>代码拆分</td>
    <td>继续拆分主进程入口、前端入口和大型页面组件，降低维护成本。</td>
  </tr>
  <tr>
    <td>插件生态</td>
    <td>增强插件市场、插件权限 UI、插件版本兼容与示例覆盖。</td>
  </tr>
  <tr>
    <td>AI 稳定性</td>
    <td>优化 AI 上下文、流式输出、失败重试、白板生成和工具调用链路。</td>
  </tr>
</table>

<a id="contributing"></a>

<h2>🤝 贡献指南</h2>

<p>
  欢迎提交 Issue、提出想法、贡献插件或发起 Pull Request。
  如果你正在开发插件，也可以先在本地完成调试后再分享给社区。
</p>

<ol>
  <li>Fork 本项目。</li>
  <li>创建特性分支：<code>git checkout -b feature/AmazingFeature</code>。</li>
  <li>提交更改：<code>git commit -m "Add some AmazingFeature"</code>。</li>
  <li>推送到分支：<code>git push origin feature/AmazingFeature</code>。</li>
  <li>创建 Pull Request。</li>
</ol>

<h3>问题反馈</h3>

<ul>
  <li>发现 Bug：请创建 <a href="https://github.com/Xperiamol/Flota/issues">Issue</a> 并附上复现步骤。</li>
  <li>功能建议：欢迎在 Issues 或 Discussions 中描述你的使用场景。</li>
  <li>同步问题：建议附带日志、同步服务类型和大致操作时间，方便定位。</li>
</ul>

<a id="thanks"></a>

<h2>🙏 致谢</h2>

<p>
  感谢所有使用、反馈和贡献过 Flota 的朋友。
  我们希望它能成为一个用更少交互完成记录、整理与行动规划的高效工具。
</p>

<hr />

<div align="center">
  <p><strong>Flota 3.5</strong> · 让笔记记录变得更加高效和愉悦。</p>
  <p>如果这个项目对你有帮助，欢迎给它一个 ⭐️。</p>
</div>
