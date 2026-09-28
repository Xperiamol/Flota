# Flota 隐私政策 / Privacy Policy

生效日期 / Effective date: 2026-09-28

[中文](#中文) · [English](#english)

---

## 中文

本政策适用于 Flota 桌面应用（包括 Microsoft Store 上的「Flota Notes」）和 Flota 网页剪藏浏览器扩展。

### 简单来说

- **你的数据保存在你自己的电脑上。** 笔记、待办、画布、附件和设置都存放在本机的 Flota 数据文件夹里。
- **我们不收集你的任何数据。** Flota 没有账号系统，不包含统计、埋点、崩溃上报或广告，开发者无法访问你的内容。
- **只有你开启的功能才会联网。** 这时数据会直接发送给你选择并自行配置的第三方服务，不经过开发者的服务器。

### 会联网的功能

以下功能默认关闭或需要你自己填写服务地址、账号或密钥后才会工作：

| 功能 | 发送的内容 | 发送给 |
| --- | --- | --- |
| AI 助手、AI 生成组件、记忆引擎 | 你的提问，以及你让 AI 读取或处理的笔记、待办内容 | 你配置的 AI 服务商，例如 OpenAI、DeepSeek、阿里云百炼（通义千问），或你填写的自定义接口 |
| 联网搜索 | 搜索关键词 | 你配置的搜索服务（默认接口为 open.feedcoopapi.com） |
| 语音转文字 | 你录制的语音 | 火山引擎语音识别服务 |
| 云同步 | 笔记、待办、组件等需要同步的数据 | 你自己的 WebDAV 服务（如坚果云）、Google 日历或 CalDAV 服务器 |
| 检查更新（仅官网和 GitHub 下载的版本） | 当前版本号 | GitHub |

这些服务如何处理数据，以它们各自的隐私政策为准。如果你在设置里配置了网络代理，上述请求会经过你的代理。

从 Microsoft Store 安装的版本由商店负责更新，不会自己去检查更新。

### 本机功能

- **网页剪藏扩展**：只把你主动剪藏的网页内容发送到你电脑上运行的 Flota（127.0.0.1），不会发送到其他地方。
- **MCP 服务**：开启后，你连接的 AI 客户端可以读取和修改你的笔记与待办。这些数据之后如何处理，由该客户端及其服务商决定。
- **插件**：插件在你授予的权限范围内运行。第三方插件由其开发者负责。

### 密钥和密码

AI、语音识别、同步等服务的密钥和密码只保存在本机。系统支持时，会用操作系统提供的安全存储加密后再保存。

### 你的控制权

- 你可以随时在应用里删除笔记和待办，或清空回收站。
- 你可以随时关闭任何联网功能，或删除已填写的密钥。
- 你可以直接删除 Flota 的数据文件夹来清除全部本地数据。已同步到云端的数据，需要在对应服务里删除。

### 儿童

Flota 不面向 13 岁以下的儿童，也不会有意收集儿童的信息。

### 政策变更

如果本政策有变化，我们会更新本页面和上方的生效日期。

### 联系我们

如有任何隐私相关的问题，请在 GitHub 提交 issue：https://github.com/Xperiamol/Flota/issues

---

## English

This policy applies to the Flota desktop app (including "Flota Notes" on the Microsoft Store) and the Flota Web Clipper browser extension.

### In short

- **Your data stays on your computer.** Notes, to-dos, canvases, attachments and settings are stored in Flota's data folder on your device.
- **We don't collect any of your data.** Flota has no accounts, analytics, tracking, crash reporting or ads, and the developer cannot access your content.
- **Only features you turn on use the network.** When they do, data goes directly to the third-party service you chose and configured, never through the developer's servers.

### Features that use the network

These features are off by default or only work after you enter your own service address, account or key:

| Feature | What is sent | Sent to |
| --- | --- | --- |
| AI assistant, AI-generated widgets, memory engine | Your prompts and the notes or to-dos you ask the AI to read or work on | The AI provider you configure, such as OpenAI, DeepSeek, Alibaba Cloud Model Studio (Qwen), or a custom endpoint you enter |
| Web search | Search queries | The search service you configure (the default endpoint is open.feedcoopapi.com) |
| Speech to text | Your voice recordings | Volcengine speech recognition |
| Cloud sync | The notes, to-dos, widgets and other data being synced | Your own WebDAV service (such as Nutstore), Google Calendar or CalDAV server |
| Update check (only in versions downloaded from the website or GitHub) | The current app version | GitHub |

How these services handle your data is governed by their own privacy policies. If you set up a network proxy in Settings, these requests go through your proxy.

The Microsoft Store version is updated by the Store and does not check for updates on its own.

### On-device features

- **Web Clipper extension**: sends only the pages you choose to clip, and only to Flota running on your computer (127.0.0.1).
- **MCP server**: when turned on, the AI clients you connect can read and change your notes and to-dos. What happens to that data afterwards is up to those clients and their providers.
- **Plugins**: plugins run within the permissions you grant. Third-party plugins are the responsibility of their developers.

### Keys and passwords

Keys and passwords for AI, speech recognition, sync and other services are stored only on your device. Where the operating system supports it, they are encrypted with the system's secure storage.

### Your choices

- You can delete notes and to-dos in the app, or empty the trash, at any time.
- You can turn off any network feature or remove saved keys at any time.
- You can delete Flota's data folder to remove all local data. Data already synced to a cloud service has to be deleted in that service.

### Children

Flota is not directed at children under 13 and does not knowingly collect information from children.

### Changes

If this policy changes, we will update this page and the effective date above.

### Contact

For any privacy questions, please open an issue on GitHub: https://github.com/Xperiamol/Flota/issues
