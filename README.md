<div align="center">

[中文](./README.md) · [English](./README_EN.md)

<br />

<img src="./logo.png" width="92" alt="Flota" />

# Flota

**越用越懂你的本地优先个人工作空间**

把笔记、待办、白板画布和个人 Agent 放在同一个桌面里。<br />
记下零散的想法，让它逐渐记住你的习惯与上下文，陪你把事情一步步推进下去。

<p>
  <a href="https://github.com/Xperiamol/Flota/releases"><img src="https://img.shields.io/github/v/release/Xperiamol/Flota?style=flat-square&label=Release&color=1976D2" alt="GitHub Release" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-2E3440?style=flat-square" alt="Windows | macOS | Linux" />
  <img src="https://img.shields.io/badge/Data-Local--First%20SQLite-0F766E?style=flat-square" alt="Local-First SQLite" />
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Xperiamol/Flota?style=flat-square&color=555555" alt="License" /></a>
</p>

<p>
  <a href="https://github.com/Xperiamol/Flota/releases"><strong>下载桌面版</strong></a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="./CHANGELOG.md">更新日志</a>
  ·
  <a href="./PRIVACY.md">隐私说明</a>
  ·
  <a href="./docs/history/README.md">怀旧版档案</a>
</p>

</div>

<br />

![Flota 首页：快速记录、今日待办与笔记卡片](./docs/images/home-light-zh.png)

## 为什么是 Flota？

很多时候，记录和行动是割裂的：想法记在笔记里，任务列在待办软件里，每次打开 AI 又得把背景重新交代一遍。

Flota 把这几件事自然地连在了一起：

- **记得你是谁**：不用每次从自我介绍开始。你的写作偏好、常用格式、长期在做的项目，都可以沉淀为可管理的长期记忆。
- **读得懂你的资料**：AI 不只是聊天窗口，它可以检索你的笔记、读取全文、提炼待办、修改画布，所有改动先经过你确认。
- **写下就是下一步**：笔记里的勾选项一键变成待办，状态和标题双向同步；双链、标签和知识图谱帮你把零散记录串成网络。
- **长成你顺手的样子**：少一个趁手的小工具？直接跟 AI 说句话，生成一个能交互、能存数据的组件，摆在首页或嵌入笔记里用。

---

## 核心体验

### 1. 记得你，而且记忆归你管

大多数 AI 对话关掉窗口就忘了你是谁。在 Flota 里，你可以告诉它你习惯怎样写字、喜欢先看结论还是细节、最近在忙什么。

- **自然沉淀，按需召回**：开启自动记忆后，Flota 会从日常对话里挑出值得保留的偏好和背景；你也可以随时说一句「记住这件事」。下次聊到相关话题，它会自动带上这些上下文。
- **透明、可改、可撤回**：所有记忆都保存在本机。你可以在设置里随时搜索、编辑、删除任何一条记忆，或者在对话下方一键撤销刚写入的记忆。

![Flota 长期记忆：偏好、知识与可管理的记忆列表](./docs/images/memory-personal-zh.png)

### 2. 围绕你的笔记和画布干活

不用再把笔记复制粘贴到网页版 AI 里来回折腾。Flota 的 Agent 直接围绕你的本地资料工作，涉及新建或修改时，默认先弹出一张**确认卡**，由你拍板后再执行。

你可以直接这样吩咐它：

> 「记住：我喜欢先看结论，再列三条以内的行动项。」
>
> 「找一下这周和发版有关的笔记，通读一遍，把还没做的事情整理成待办让我确认。」
>
> 「把这篇方案画成流程图，保留画布里已有的节点，只补上缺少的步骤。」

![Flota 个人 Agent：自定义快捷方式与待发送的工作请求](./docs/images/ai-agent-zh.png)

### 3. 缺什么面板，让 AI 现场给你做一个

每个人的工作流都不一样。与其在无数模板里找将就，不如把需求说出来，让 AI 帮你写一个能交互、能存数据的小组件（Widget）：

> 「帮我做一个阅读打卡面板：能记书名、进度和一句感想，首页卡片显示这周读了几天，再加个一键打卡按钮。」

生成后可以先挑喜欢的设计风格，接着在对话里继续微调配色和逻辑。做好的组件可以摆在首页、嵌进笔记，或者拎出来当独立桌面小窗；同一个组件还能开多份实例，分别跟踪不同项目。

---

## 日常记录与整理

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>📝 顺手的编辑与白板</h4>
      <ul>
        <li><strong>所见即所得 + Markdown</strong>：支持实时渲染与源码模式自由切换。</li>
        <li><strong>丰富块与内联语法</strong>：支持双链 <code>[[笔记]]</code>、标签、数学公式、代码块、高亮提示块（Callout）。</li>
        <li><strong>Excalidraw 白板</strong>：手绘草图、流程图与笔记无缝结合，AI 也能在保留原有结构的前提下局部修改画布。</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h4>✅ 笔记与待办双向联动</h4>
      <ul>
        <li><strong>一行任务就是一条待办</strong>：笔记里的勾选项一键「加入待办」，两边勾选、改名实时同步；删掉笔记里的那行只解除关联，不丢待办。</li>
        <li><strong>笔记内嵌清单</strong>：在笔记里直接嵌入单条待办，或按标签、当前笔记动态展示待办列表。</li>
        <li><strong>四象限与日历视图</strong>：按重要紧急程度排布优先级，支持重复任务与到期提醒。</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h4>🕸️ 知识图谱与时间轴</h4>
      <ul>
        <li><strong>看得见的联系</strong>：双链、内嵌笔记 / 画布链接、共同标签会自动织成图谱；支持聚焦当前笔记的局部网络。</li>
        <li><strong>时间轴回溯</strong>：按天回顾零散闪念，支持原地编辑、合并当天记录、一键转为待办。</li>
        <li><strong>可定制首页</strong>：自由摆放快速输入、今日待办、最近笔记、专注计时、热力图和自定义组件。</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h4>🧰 剪藏、语音与扩展</h4>
      <ul>
        <li><strong>浏览器剪藏</strong>：通过 Chrome / Edge 扩展一键保存网页正文、选中内容或书签（<a href="./extensions/chrome-clipper/README.md">安装说明</a>）。</li>
        <li><strong>语音转文字</strong>：支持下载 Whisper 模型在本机离线识别，也支持接入火山引擎云端识别。</li>
        <li><strong>多格式导入导出</strong>：支持导入 Markdown、Word / WPS / Excel / PPT、PDF、EPUB、Obsidian 库等，支持本地快照与历史版本恢复。</li>
        <li><strong>插件与 MCP</strong>：支持沙箱插件扩展；开启 MCP 后，外部 AI 客户端也能安全读写你的笔记和待办。</li>
      </ul>
    </td>
  </tr>
</table>

### 笔记：写下想法，顺手变成要做的事

![Flota 笔记编辑器、任务列表和双链](./docs/images/notes-light-zh.png)

### 待办：四象限分清轻重缓急

![Flota 深色主题的四象限待办](./docs/images/todos-dark-zh.png)

---

## 数据与隐私：本地优先，去留随你

- **无账号，零打扰**：Flota 没有账号系统，不埋点、不统计、无广告、不上传崩溃日志。
- **数据落在本地**：所有笔记、待办、画布、记忆和附件都存放在你电脑本地的 SQLite 数据库与数据目录里，断网也能完整使用基础记录功能。
- **同步与 AI 由你接管**：
  - **AI 与语音**：只有当你填入自己的服务地址与密钥（如 OpenAI 兼容接口、DeepSeek、通义千问等）并主动使用时，相关上下文才会直接发往你选定的服务商。
  - **多端同步与备份**：支持坚果云或自建 **WebDAV** 同步、多网盘完整备份，以及 **CalDAV / Google Calendar** 日历双向同步。

详细的联网行为说明请查看 [隐私政策](./PRIVACY.md)。

---

## 快速开始

### 1. 下载安装

前往 [GitHub Releases](https://github.com/Xperiamol/Flota/releases) 下载对应系统的安装包：

| 平台 | 安装说明 |
| --- | --- |
| **Windows** (10 及以上) | 下载 `.exe` 安装程序运行即可；也可在 Microsoft Store 搜索 **Flota Notes** 安装（由商店自动更新） |
| **macOS** (Apple Silicon / Intel) | 下载对应 `arm64` 或 `x64` 的 `.dmg`，将 Flota 拖入「应用程序」 |
| **Linux** (x64) | 下载 `.AppImage`，赋予可执行权限（`chmod +x`）后直接运行 |

> 注：Android 版本独立发布，本仓库与文档主要面向桌面版。

### 2. 上手三步

1. **随手记**：按 `Ctrl/Cmd + N` 新建笔记，或用全局快捷键 `Ctrl/Cmd + Shift + N` 呼出快速输入小窗。
2. **列计划**：按 `Ctrl/Cmd + T` 新建待办，或者在笔记的任务行右侧点击「加入待办」。
3. **配服务（可选）**：纯净记录无需任何配置；需要 AI、WebDAV 同步或语音识别时，再到「设置」中填入自己的接口即可。

---

## 开发与参与

想在本地跑起源码，只需四行命令（`electron-dev` 会自动准备 SQLite 并同时启动 Vite 与 Electron）：

```bash
git clone https://github.com/Xperiamol/Flota.git
cd Flota
npm install
npm run electron-dev
```

- 🛠️ **[开发与构建指南](./docs/DEVELOPMENT.md)**：环境要求、测试脚本、目录结构与数据库维护说明
- 🔌 **[插件开发文档](./plugins/docs/README.md)** · **[示例插件](./plugins/examples/)**：在安全 Worker 沙箱中扩展命令与界面
- 📦 **[发布流程](./docs/RELEASE_FLOW.md)** · **[更新日志](./CHANGELOG.md)** · **[MIT 许可证](./LICENSE)**
- 💬 **[提交 Issue 或建议](https://github.com/Xperiamol/Flota/issues)**：反馈 Bug 时请附上系统版本、应用版本号和复现步骤

---

## 🕰️ 彩蛋：从 FlashNote 到 Flota

老朋友可能还记得，Flota 最早叫 **FlashNote**——那时候它顶着另一个头像，刚从 1.x 重写成 2.0，刚加上 Excalidraw 画布和本地插件系统。

如果你怀念当年的样子，或者想看看它是怎么一路长成今天这样的，欢迎去翻翻我们的 **[怀旧版 README 与老界面档案](./docs/history/README.md)**。

<div align="center">
  <br />
  <p>如果 Flota 让你的记录和推进事情变得更顺手，欢迎点亮一颗 ⭐️ Star 支持我们！</p>
</div>
